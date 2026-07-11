import type { StandardSchemaV1 } from "@standard-schema/spec";
import { problem, type ProblemDetails } from "middy-problem-details";
import type { Contract, InferInput, PartName } from "../contract/index.ts";

export type ResponseValidationMode = "off" | "warn" | "hard";

export interface ContractValidatorOptions {
  /**
   * Response validation mode. Default "warn": violations are logged, never
   * turned into client-facing failures — which also means warn mode gives NO
   * output-filtering guarantee. Use "hard" where the output schema is relied
   * on to strip sensitive fields.
   */
  readonly responseValidation?: ResponseValidationMode;
  /**
   * Called for warn-mode response violations. Default logs to console.error
   * with JSON-stringified issues.
   */
  readonly logger?: (message: string, details: unknown) => void;
  /**
   * Parts whose validator-generated issue messages are replaced with a
   * generic one in the client-facing 400 (paths are kept). Some validators
   * echo the received value in their messages, and echoing header values
   * leaks credentials. Default: ["headers"]. Pass [] to disable.
   */
  readonly redactedParts?: readonly PartName[];
}

/** One validation failure. `path` is dot-separated ("address.street"); response violations use part "response". */
export interface ValidationIssue {
  readonly part: PartName | "response";
  readonly path: string;
  readonly message: string;
}

/**
 * Thrown when the request does not satisfy the contract. Follows the
 * http-errors convention (statusCode, expose) so any Middy error handler
 * responds 400; carries `problem` so middy-problem-details emits full
 * RFC 9457 output with the issue list.
 */
export class ContractValidationError extends Error {
  readonly statusCode = 400;
  readonly expose = true;
  readonly problem: ProblemDetails;
  readonly issues: readonly ValidationIssue[];

  constructor(contractName: string, issues: readonly ValidationIssue[]) {
    super(`Request does not satisfy contract "${contractName}"`);
    this.name = "ContractValidationError";
    this.issues = issues;
    this.problem = problem({
      status: 400,
      title: "Validation failed",
      detail: this.message,
      errors: issues,
    });
    Error.captureStackTrace?.(this, new.target);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      issues: this.issues,
      problem: this.problem,
    };
  }
}

/** Thrown in "hard" mode when the response violates the contract. Opaque to clients. */
export class ContractResponseError extends Error {
  readonly statusCode = 500;
  readonly expose = false;
  readonly issues: readonly ValidationIssue[];

  constructor(contractName: string, issues: readonly ValidationIssue[]) {
    super(`Response does not satisfy contract "${contractName}"`);
    this.name = "ContractResponseError";
    this.issues = issues;
    Error.captureStackTrace?.(this, new.target);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      issues: this.issues,
    };
  }
}

/** Structural view of the API Gateway event fields this middleware touches. */
export interface LambdaHttpEvent {
  body?: unknown;
  isBase64Encoded?: unknown;
  queryStringParameters?: unknown;
  multiValueQueryStringParameters?: unknown;
  pathParameters?: unknown;
  headers?: unknown;
  cookies?: unknown;
  [key: string]: unknown;
}

export interface MiddyLikeRequest {
  event: LambdaHttpEvent;
  response?: unknown;
  error?: unknown;
}

export interface ContractMiddleware {
  readonly before: (request: MiddyLikeRequest) => Promise<void>;
  readonly after: (request: MiddyLikeRequest) => Promise<void>;
}

const REQUEST_PARTS: readonly PartName[] = ["body", "query", "params", "headers"];

const EVENT_KEYS: Readonly<Record<PartName, string>> = {
  body: "body",
  query: "queryStringParameters",
  params: "pathParameters",
  headers: "headers",
};

/**
 * Middy middleware validating request and response against a contract.
 *
 * `before` parses the JSON body (base64-decoded when isBase64Encoded is set),
 * validates every declared part, and merges the parsed (transformed/coerced)
 * values back onto the event — undeclared fields of query/params/headers are
 * preserved. Header handling: keys are lowercased before validation AND in
 * the written-back headers map, so REST (v1) and HTTP API (v2) events behave
 * identically — headers schemas must use lowercase keys, and downstream code
 * must read lowercase keys after this middleware ran. HTTP API v2 cookies
 * are rehydrated into the headers part as a "; "-joined `cookie` header.
 * Repeated query params surface as string arrays via the REST v1 multi-value
 * map (single values unwrap to scalars); HTTP API v2 delivers them
 * comma-joined by AWS instead.
 *
 * `after` validates the handler's response against the output schema; when
 * the response is a { statusCode, body } envelope, only success responses
 * (2xx, or exactly http.successStatus when set) are validated.
 *
 * Mount AFTER any body-parsing middleware (e.g. @middy/http-json-body-parser):
 * this middleware writes the parsed body object back onto the event, which a
 * downstream string parser would choke on.
 */
export function contractValidator(
  contract: Contract,
  options: ContractValidatorOptions = {},
): ContractMiddleware {
  const mode = options.responseValidation ?? "warn";
  const logger = options.logger ?? defaultLogger;
  const redacted = new Set<PartName>(options.redactedParts ?? ["headers"]);

  return {
    async before(request) {
      const input = contract.input;
      if (!input) return;

      const issues: ValidationIssue[] = [];
      const parsed = new Map<PartName, unknown>();

      for (const part of REQUEST_PARTS) {
        const schema = input[part];
        if (!schema) continue;

        const extraction = extractPart(request.event, part);
        if (!extraction.ok) {
          issues.push(extraction.issue);
          continue;
        }

        const result = await runValidate(schema, extraction.value);
        if (result.issues) {
          issues.push(...toIssues(part, result.issues, { redact: redacted.has(part) }));
        } else {
          parsed.set(part, result.value);
        }
      }

      if (issues.length > 0) throw new ContractValidationError(contract.name, issues);
      for (const [part, value] of parsed) writeBack(request.event, part, value);
    },

    async after(request) {
      if (mode === "off" || !contract.output) return;

      const envelope = asEnvelope(request.response);
      if (envelope && !isSuccessStatus(envelope.statusCode, contract.http.successStatus)) {
        return;
      }
      const payload = envelope ? envelope.body : request.response;
      // An already-serialized body cannot be validated meaningfully here;
      // mount this middleware so it runs on the raw handler output instead.
      if (typeof payload === "string") return;

      const result = await runValidate(contract.output, payload);
      if (result.issues) {
        const issues = toIssues("response", result.issues, { redact: false });
        if (mode === "hard") throw new ContractResponseError(contract.name, issues);
        logger(`middy-contracts: response does not satisfy contract "${contract.name}"`, issues);
        return;
      }

      if (envelope) envelope.body = result.value;
      else request.response = result.value;
    },
  };
}

/**
 * Typed accessor for the parts contractValidator wrote back onto the event.
 * The single audited cast in the chain: safe because `before` already
 * validated every declared part and replaced the event values with the
 * parsed results. Reading a part the middleware did not run on is unsafe —
 * only call this from handlers mounted with contractValidator(contract).
 */
export function validatedInput<C extends Contract>(
  contract: C,
  event: LambdaHttpEvent,
): InferInput<C> {
  const input = contract.input;
  if (!input) return undefined as InferInput<C>;

  const parts: Record<string, unknown> = {};
  for (const part of REQUEST_PARTS) {
    if (input[part]) parts[part] = event[EVENT_KEYS[part]];
  }
  return parts as unknown as InferInput<C>;
}

async function runValidate(
  schema: StandardSchemaV1,
  value: unknown,
): Promise<StandardSchemaV1.Result<unknown>> {
  // await unwraps any thenable, not just same-realm Promise instances.
  return await schema["~standard"].validate(value);
}

type Extraction =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly issue: ValidationIssue };

function extractPart(event: LambdaHttpEvent, part: PartName): Extraction {
  switch (part) {
    case "body":
      return extractBody(event);
    case "query":
      return { ok: true, value: extractQuery(event) };
    case "headers":
      return { ok: true, value: extractHeaders(event) };
    case "params":
      return { ok: true, value: event.pathParameters ?? {} };
  }
}

function extractBody(event: LambdaHttpEvent): Extraction {
  const raw = event.body;
  if (typeof raw !== "string") return { ok: true, value: raw };

  const text =
    event.isBase64Encoded === true ? Buffer.from(raw, "base64").toString("utf8") : raw;
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      issue: { part: "body", path: "", message: "Request body is not valid JSON" },
    };
  }
}

/**
 * Prefer multiValueQueryStringParameters (REST v1) so repeated params surface
 * as arrays instead of silently keeping only the last value; single-element
 * arrays unwrap to the scalar shape schemas usually expect. HTTP API v2 has
 * no multi-value map — repeated params arrive comma-joined by AWS.
 */
function extractQuery(event: LambdaHttpEvent): unknown {
  const multi = event.multiValueQueryStringParameters;
  if (typeof multi === "object" && multi !== null && Object.keys(multi).length > 0) {
    return Object.fromEntries(
      Object.entries(multi as Record<string, unknown>).map(([key, values]) =>
        Array.isArray(values) && values.length === 1 ? [key, values[0]] : [key, values],
      ),
    );
  }
  return event.queryStringParameters ?? {};
}

/**
 * HTTP API v2 removes Cookie from headers into event.cookies; rehydrate it
 * so headers schemas behave identically on v1 and v2.
 */
function extractHeaders(event: LambdaHttpEvent): unknown {
  const headers = lowercaseKeys(event.headers);
  const cookies = event.cookies;
  if (
    Array.isArray(cookies) &&
    cookies.length > 0 &&
    typeof headers === "object" &&
    headers !== null &&
    !("cookie" in headers)
  ) {
    return { ...headers, cookie: cookies.join("; ") };
  }
  return headers;
}

function lowercaseKeys(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value ?? {};
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key.toLowerCase(), entry]),
  );
}

/**
 * Body replaces the event value wholesale; the other parts merge over the
 * original map so undeclared query params/headers survive strip-by-default
 * validators. Headers merge over the lowercased originals to avoid duplicate
 * keys with mixed casing.
 */
function writeBack(event: LambdaHttpEvent, part: PartName, value: unknown): void {
  const key = EVENT_KEYS[part];
  // Body and array-shaped results replace wholesale — spreading an array into
  // an object would mangle it.
  if (part === "body" || Array.isArray(value)) {
    event[key] = value;
    return;
  }
  // A schema resolving to undefined must not destroy the original map.
  if (value === undefined) return;
  const original = part === "headers" ? lowercaseKeys(event[key]) : event[key];
  event[key] =
    typeof original === "object" &&
    original !== null &&
    !Array.isArray(original) &&
    typeof value === "object" &&
    value !== null
      ? { ...original, ...value }
      : value;
}

function toIssues(
  part: ValidationIssue["part"],
  issues: readonly StandardSchemaV1.Issue[],
  options: { readonly redact: boolean },
): ValidationIssue[] {
  // A failure result with an empty issues array is spec-legal but would
  // otherwise fail the request with zero reported issues.
  if (issues.length === 0) {
    return [{ part, path: "", message: "Validation failed" }];
  }
  return issues.map((issue) => ({
    part,
    path: formatPath(issue.path),
    message: options.redact ? "Value does not satisfy schema" : issue.message,
  }));
}

function formatPath(path: StandardSchemaV1.Issue["path"]): string {
  if (!path || path.length === 0) return "";
  return path
    .map((segment) =>
      typeof segment === "object" && segment !== null && "key" in segment
        ? String(segment.key)
        : String(segment),
    )
    .join(".");
}

const ENVELOPE_KEYS = new Set([
  "statusCode",
  "body",
  "headers",
  "multiValueHeaders",
  "isBase64Encoded",
  "cookies",
]);

/**
 * A response is an envelope only when it looks exactly like a Lambda proxy
 * response — a numeric statusCode and no keys outside the proxy shape.
 * Otherwise a raw payload whose schema legitimately declares a statusCode
 * field would be misclassified.
 */
function asEnvelope(response: unknown): { statusCode: unknown; body: unknown } | undefined {
  if (typeof response !== "object" || response === null || Array.isArray(response)) {
    return undefined;
  }
  const record = response as Record<string, unknown>;
  if (typeof record.statusCode !== "number") return undefined;
  if (!Object.keys(record).every((key) => ENVELOPE_KEYS.has(key))) return undefined;
  return record as { statusCode: unknown; body: unknown };
}

function isSuccessStatus(statusCode: unknown, successStatus: number | undefined): boolean {
  if (typeof statusCode !== "number") return true;
  if (successStatus !== undefined) return statusCode === successStatus;
  return statusCode >= 200 && statusCode < 300;
}

function defaultLogger(message: string, details: unknown): void {
  let text: string;
  try {
    text = JSON.stringify(details);
  } catch {
    text = String(details);
  }
  console.error(message, text);
}
