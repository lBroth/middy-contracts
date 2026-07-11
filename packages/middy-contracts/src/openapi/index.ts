import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Contract, PartName } from "../contract/index.ts";

/** The `info` object of the generated OpenAPI 3.1 document. */
export interface OpenApiInfo {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
}

/** A converted JSON Schema fragment (draft 2020-12). */
export type JsonSchema = Record<string, unknown>;

/** Minimal OpenAPI 3.1 document shape produced by toOpenAPI. */
export interface OpenApiDocument {
  readonly openapi: "3.1.0";
  readonly info: OpenApiInfo;
  readonly paths: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/** Thrown by toOpenAPI; `code` identifies the failure mode for tooling. */
export class OpenApiGenerationError extends Error {
  readonly code:
    | "unsupported-schema"
    | "duplicate-operation"
    | "duplicate-operation-id"
    | "ambiguous-path"
    | "non-object-parameters"
    | "unresolvable-ref";
  readonly contractName: string;

  constructor(code: OpenApiGenerationError["code"], contractName: string, message: string) {
    super(message);
    this.name = "OpenApiGenerationError";
    this.code = code;
    this.contractName = contractName;
    Error.captureStackTrace?.(this, new.target);
  }
}

/**
 * Generate an OpenAPI 3.1 document from contracts, via each schema's
 * Standard JSON Schema conversion (draft-2020-12 — OpenAPI 3.1's native
 * dialect). Build-time only — never import this module from a Lambda
 * handler.
 *
 * Throws when a schema's validator does not implement Standard JSON Schema
 * (request schemas convert with `.input()` — wire types — and the output
 * schema with `.output()` — parsed types), on duplicate method+path across
 * contracts, on two paths differing only in parameter names, and when a
 * params/query/headers schema does not convert to an object JSON Schema
 * with properties.
 */
export function toOpenAPI(
  contracts: readonly Contract[] | Readonly<Record<string, Contract>>,
  info: OpenApiInfo,
): OpenApiDocument {
  const list = Array.isArray(contracts) ? contracts : Object.values(contracts);
  const paths: Record<string, Record<string, unknown>> = {};
  const byErasedPath = new Map<string, string>();
  const seenNames = new Set<string>();

  for (const contract of list) {
    const path = toOpenApiPath(contract.http.path);
    const method = contract.http.method.toLowerCase();

    // Contract names become operationIds, which OpenAPI requires to be
    // unique across the whole document.
    if (seenNames.has(contract.name)) {
      throw new OpenApiGenerationError(
        "duplicate-operation-id",
        contract.name,
        `middy-contracts/openapi: duplicate contract name "${contract.name}" — operationId must be unique across the document`,
      );
    }
    seenNames.add(contract.name);

    // "/users/{id}" and "/users/{userId}" are the same route to a server but
    // two entries to OpenAPI tooling — reject the ambiguity.
    const erased = path.replace(/\{[^}]+\}/g, "{}");
    const knownPath = byErasedPath.get(erased);
    if (knownPath !== undefined && knownPath !== path) {
      throw new OpenApiGenerationError(
        "ambiguous-path",
        contract.name,
        `middy-contracts/openapi: paths "${knownPath}" and "${path}" differ only in parameter names (contract "${contract.name}")`,
      );
    }
    byErasedPath.set(erased, path);

    const operations = (paths[path] ??= {});
    if (method in operations) {
      throw new OpenApiGenerationError(
        "duplicate-operation",
        contract.name,
        `middy-contracts/openapi: duplicate operation ${contract.http.method} ${path} (contract "${contract.name}")`,
      );
    }
    operations[method] = toOperation(contract);
  }

  return { openapi: "3.1.0", info, paths };
}

/** "/users/:id" → "/users/{id}" */
function toOpenApiPath(path: string): string {
  return path.replace(/:([^/]+)/g, "{$1}");
}

function toOperation(contract: Contract): Record<string, unknown> {
  const operation: Record<string, unknown> = { operationId: contract.name };

  const parameters = [
    ...toParameters(contract, "params"),
    ...toParameters(contract, "query"),
    ...toParameters(contract, "headers"),
  ];
  if (parameters.length > 0) operation.parameters = parameters;

  const bodySchema = contract.input?.body;
  if (bodySchema) {
    operation.requestBody = {
      required: true,
      content: {
        "application/json": { schema: toJsonSchema(bodySchema, "input", contract, "body") },
      },
    };
  }

  operation.responses = toResponses(contract);
  return operation;
}

const PARAMETER_LOCATION: Readonly<Record<Exclude<PartName, "body">, string>> = {
  params: "path",
  query: "query",
  headers: "header",
};

function toParameters(
  contract: Contract,
  part: Exclude<PartName, "body">,
): Array<Record<string, unknown>> {
  const schema = contract.input?.[part];
  if (!schema) return [];

  const converted = toJsonSchema(schema, "input", contract, part);
  const properties = converted.properties;
  if (typeof properties !== "object" || properties === null) {
    throw new OpenApiGenerationError(
      "non-object-parameters",
      contract.name,
      `middy-contracts/openapi: the ${part} schema of contract "${contract.name}" must convert to an object JSON Schema with properties`,
    );
  }
  const required = new Set(Array.isArray(converted.required) ? converted.required : []);

  return Object.entries(properties).map(([name, propertySchema]) => ({
    name,
    in: PARAMETER_LOCATION[part],
    // OpenAPI mandates required: true for path parameters.
    required: part === "params" ? true : required.has(name),
    schema: propertySchema,
  }));
}

function toResponses(contract: Contract): Record<string, unknown> {
  const responses: Record<string, unknown> = {};

  const successStatus = contract.http.successStatus ?? 200;
  responses[String(successStatus)] = contract.output
    ? {
        description: "Success",
        content: {
          "application/json": {
            schema: toJsonSchema(contract.output, "output", contract, "output"),
          },
        },
      }
    : { description: "Success" };

  // Several error codes may share one HTTP status: merge them into a single
  // response instead of silently keeping only the last one.
  const errorsByStatus = new Map<number, typeof contract.errors[number][]>();
  for (const error of contract.errors) {
    const group = errorsByStatus.get(error.status) ?? [];
    group.push(error);
    errorsByStatus.set(error.status, group);
  }

  for (const [status, errors] of errorsByStatus) {
    const declared = errors.flatMap((error) =>
      error.schema ? [toJsonSchema(error.schema, "output", contract, `error ${error.code}`)] : [],
    );
    const schemas = declared.length < errors.length
      ? [...declared, structuredClone(PROBLEM_DETAILS_SCHEMA)]
      : declared;

    responses[String(status)] = {
      description: errors.map((error) => error.code).join(" | "),
      content: {
        "application/problem+json": {
          schema: schemas.length === 1 ? schemas[0] : { oneOf: schemas },
        },
      },
    };
  }

  return responses;
}

/**
 * Generic RFC 9457 Problem Details schema for errors declared without one.
 * Frozen and cloned per use: documents must never share a mutable schema
 * object with each other or with this module.
 */
const PROBLEM_DETAILS_SCHEMA: JsonSchema = Object.freeze({
  type: "object",
  properties: {
    type: { type: "string" },
    title: { type: "string" },
    status: { type: "integer" },
    detail: { type: "string" },
    instance: { type: "string" },
  },
  required: ["type", "title", "status"],
});

/**
 * Structural view of the Standard JSON Schema capability. Kept local: the
 * generator probes for it instead of depending on any validator.
 */
interface JsonSchemaCapability {
  readonly "~standard": {
    readonly vendor: string;
    readonly jsonSchema?: {
      readonly input?: (options?: { target?: string }) => JsonSchema;
      readonly output?: (options?: { target?: string }) => JsonSchema;
    };
  };
}

function toJsonSchema(
  schema: StandardSchemaV1,
  direction: "input" | "output",
  contract: Contract,
  where: string,
): JsonSchema {
  const standard: JsonSchemaCapability["~standard"] = schema["~standard"];
  const convert = standard.jsonSchema?.[direction];
  if (typeof convert !== "function") {
    throw new OpenApiGenerationError(
      "unsupported-schema",
      contract.name,
      `middy-contracts/openapi: the ${where} schema of contract "${contract.name}" ` +
        `(validator "${standard.vendor}") does not implement Standard JSON Schema — ` +
        `upgrade the validator or use one that supports JSON Schema conversion`,
    );
  }
  const { $schema: _dialect, ...converted } = convert({ target: "draft-2020-12" });
  return assertEmbeddable(converted, contract, where);
}

/**
 * Converted schemas containing $ref/$defs cannot be embedded as-is: relative
 * refs would resolve against the OpenAPI document root and silently break
 * every consumer. Fail loud until ref hoisting into components.schemas is
 * implemented.
 */
function assertEmbeddable(schema: JsonSchema, contract: Contract, where: string): JsonSchema {
  const stack: unknown[] = [schema];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (typeof node !== "object" || node === null) continue;
    const record = node as Record<string, unknown>;
    if ("$ref" in record || "$dynamicRef" in record || "$defs" in record) {
      throw new OpenApiGenerationError(
        "unresolvable-ref",
        contract.name,
        `middy-contracts/openapi: the ${where} schema of contract "${contract.name}" ` +
          `converts to JSON Schema containing $ref/$defs (recursive or shared ` +
          `definitions), which this generator cannot embed yet — flatten the schema`,
      );
    }
    stack.push(...Object.values(record));
  }
  return schema;
}
