import type { StandardSchemaV1 } from "@standard-schema/spec";

/** HTTP binding for a contract. Transport metadata only — validation lives in the schemas. */
export interface HttpBinding {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: `/${string}`;
  /**
   * Success status code. Defaults to 200 in the generated OpenAPI document;
   * when set, response validation only applies to envelope responses with
   * exactly this status (otherwise any 2xx).
   */
  readonly successStatus?: number;
}

/** Declared error: stable machine-readable code plus its HTTP projection. */
export interface ErrorShape {
  readonly code: string;
  readonly status: number;
  /**
   * Response body schema for this error, used only by the OpenAPI generator;
   * when absent, a generic RFC 9457 Problem Details schema is documented.
   */
  readonly schema?: StandardSchemaV1;
}

export type PartName = "body" | "query" | "params" | "headers";

/** Request input declared per part, so OpenAPI and generated clients know where each field lives. */
export interface InputSchemas {
  readonly body?: StandardSchemaV1;
  readonly query?: StandardSchemaV1;
  readonly params?: StandardSchemaV1;
  readonly headers?: StandardSchemaV1;
}

/** A bare schema is shorthand for `{ body: schema }`. */
export type InputInit = StandardSchemaV1 | InputSchemas;

export type NormalizedInput<T> = T extends StandardSchemaV1
  ? { readonly body: T }
  : T extends InputSchemas
    ? T
    : undefined;

export type AnyInput = InputSchemas | undefined;

/** A Standard Schema of any validator, or none. */
export type AnySchema = StandardSchemaV1 | undefined;

/** Argument to defineContract; `input` accepts a bare schema as shorthand for `{ body: schema }`. */
export interface ContractInit<
  TInput extends InputInit | undefined = InputInit | undefined,
  TOutput extends AnySchema = AnySchema,
  TErrors extends readonly ErrorShape[] = readonly ErrorShape[],
> {
  readonly input?: TInput;
  readonly output?: TOutput;
  readonly errors?: TErrors;
  readonly http: HttpBinding;
}

/**
 * A defined operation: name, per-part input schemas, output schema, declared
 * errors, and an HTTP binding. Produced by defineContract as frozen, inert
 * data; the middleware and the OpenAPI generator are functions over it.
 */
export interface Contract<
  TInput extends AnyInput = AnyInput,
  TOutput extends AnySchema = AnySchema,
  TErrors extends readonly ErrorShape[] = readonly ErrorShape[],
> {
  readonly name: string;
  readonly input: TInput;
  readonly output: TOutput;
  readonly errors: TErrors;
  readonly http: HttpBinding;
}

type PartOf<T, K extends PartName> = K extends keyof T ? T[K] : undefined;

type PartOutput<S> = S extends StandardSchemaV1 ? StandardSchemaV1.InferOutput<S> : never;
type PartInput<S> = S extends StandardSchemaV1 ? StandardSchemaV1.InferInput<S> : never;

/**
 * Parsed (post-validation) input parts — what the handler receives.
 * Distributes over union inputs: `{ body } | { query }` infers as a union,
 * not as the (empty) intersection of keys.
 */
export type InferInput<C extends Contract> = C["input"] extends infer I
  ? I extends InputSchemas
    ? {
        readonly [K in PartName as PartOf<I, K> extends StandardSchemaV1
          ? K
          : never]: PartOutput<PartOf<I, K>>;
      }
    : undefined
  : never;

/**
 * Wire (pre-validation) input parts — what a client sends. Differs from
 * InferInput whenever a schema transforms, coerces, or defaults.
 */
export type InferClientInput<C extends Contract> = C["input"] extends infer I
  ? I extends InputSchemas
    ? {
        readonly [K in PartName as PartOf<I, K> extends StandardSchemaV1
          ? K
          : never]: PartInput<PartOf<I, K>>;
      }
    : undefined
  : never;

/** Declared output type of a contract, before response serialization. */
export type InferOutput<C extends Contract> = C["output"] extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<C["output"]>
  : undefined;

/** Union of the contract's declared error codes, preserved as literals. */
export type InferErrorCodes<C extends Contract> = C["errors"][number]["code"];

/**
 * Define a contract: a named operation with per-part input schemas, an output
 * schema, declared errors, and an HTTP binding. Returns inert, frozen data —
 * every other module (middleware, OpenAPI generator) is a function over this
 * object.
 */
export function defineContract<
  TInput extends InputInit | undefined = undefined,
  TOutput extends AnySchema = undefined,
  const TErrors extends readonly ErrorShape[] = readonly [],
>(
  name: string,
  init: ContractInit<TInput, TOutput, TErrors>,
): Contract<NormalizedInput<TInput>, TOutput, TErrors> {
  const { successStatus } = init.http;
  if (
    successStatus !== undefined &&
    (!Number.isInteger(successStatus) || successStatus < 100 || successStatus > 599)
  ) {
    throw new RangeError(
      `defineContract: successStatus must be an integer HTTP status code, got ${successStatus}`,
    );
  }
  const errors = (init.errors ?? []).map((e) => Object.freeze({ ...e }));
  return Object.freeze({
    name,
    input: normalizeInput(init.input) as NormalizedInput<TInput>,
    output: init.output as TOutput,
    errors: Object.freeze(errors) as unknown as TErrors,
    http: Object.freeze({ ...init.http }),
  });
}

export function isSchema(value: unknown): value is StandardSchemaV1 {
  // ArkType schemas are callable: the guard must accept functions or the
  // runtime would misclassify them as part objects while the type level
  // takes the StandardSchemaV1 branch — a silent validation bypass.
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "~standard" in value
  );
}

function normalizeInput(input: InputInit | undefined): InputSchemas | undefined {
  if (input === undefined) return undefined;
  if (isSchema(input)) return Object.freeze({ body: input });
  return Object.freeze({ ...input });
}
