import Joi from "joi";
import { z } from "zod";
import {
  defineContract,
  type InferClientInput,
  type InferErrorCodes,
  type InferInput,
  type InferOutput,
} from "./index.ts";
import { fakeSchema } from "./test-support.ts";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type Expect<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;

// Bare schema shorthand: input becomes { body: schema }.
const shorthand = defineContract("users.create", {
  input: fakeSchema<{ email: string; age: number }>(),
  output: fakeSchema<{ id: string }>(),
  http: { method: "POST", path: "/users" },
});

const bare = defineContract("health.check", {
  http: { method: "GET", path: "/health" },
});

// Per-part schemas with coercion: handler sees parsed types, client sends wire types.
const withParts = defineContract("orders.get", {
  input: {
    query: z.object({ limit: z.coerce.number().optional() }),
    params: z.object({ id: z.coerce.number() }),
  },
  output: z.object({ total: z.number() }),
  http: { method: "GET", path: "/orders/:id" },
});

// Joi has no static inference from the schema shape: the contract must still
// compile and its inferred types must degrade to a usable type, never to `never`.
const withJoi = defineContract("users.create", {
  input: Joi.object({ email: Joi.string().email().required() }),
  http: { method: "POST", path: "/users" },
});

// Union inputs must distribute instead of collapsing to the empty key intersection.
declare const flip: boolean;
const unionInput = defineContract("union.case", {
  input: flip ? fakeSchema<{ a: string }>() : { query: fakeSchema<{ q: string }>() },
  http: { method: "GET", path: "/union" },
});

const withErrors = defineContract("users.create", {
  errors: [
    { code: "USER_EXISTS", status: 409 },
    { code: "USER_BANNED", status: 403 },
  ],
  http: { method: "POST", path: "/users" },
});

export type Cases = [
  Expect<
    Equal<InferInput<typeof shorthand>, { readonly body: { email: string; age: number } }>
  >,
  Expect<Equal<InferOutput<typeof shorthand>, { id: string }>>,
  Expect<Equal<InferInput<typeof bare>, undefined>>,
  Expect<Equal<InferOutput<typeof bare>, undefined>>,
  // An optional coerced field keeps the `| undefined` on the handler-side type:
  // z `.optional()` is `T | undefined`, which TS 7 preserves under
  // exactOptionalPropertyTypes (TS 5.x used to strip it on the mapped property).
  Expect<
    Equal<
      InferInput<typeof withParts>,
      { readonly query: { limit?: number | undefined }; readonly params: { id: number } }
    >
  >,
  Expect<
    Equal<
      InferClientInput<typeof withParts>,
      { readonly query: { limit?: unknown }; readonly params: { id: unknown } }
    >
  >,
  Expect<Equal<InferOutput<typeof withParts>, { total: number }>>,
  Expect<Equal<IsNever<InferInput<typeof withJoi>>, false>>,
  Expect<
    Equal<
      InferInput<typeof unionInput>,
      { readonly body: { a: string } } | { readonly query: { q: string } }
    >
  >,
  // const type param preserves error codes as a literal union
  Expect<Equal<InferErrorCodes<typeof withErrors>, "USER_EXISTS" | "USER_BANNED">>,
  Expect<Equal<InferErrorCodes<typeof bare>, never>>,
];
