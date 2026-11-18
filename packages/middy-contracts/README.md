# middy-contracts

[![CI](https://github.com/lBroth/middy-contracts/actions/workflows/ci.yml/badge.svg)](https://github.com/lBroth/middy-contracts/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Contract-first toolkit for [Middy](https://middy.js.org). Define an operation once with any [Standard Schema](https://standardschema.dev) validator (conformance-tested against Zod and Joi 18+) and get request/response validation, RFC 9457 errors, and OpenAPI 3.1 from the same artifact. OpenAPI generation additionally needs the validator's Standard JSON Schema support.

> Status: pre-1.0. The API may change between minor versions until 1.0.0.

## Why

On a typical Lambda API these are three disconnected tools: `@middy/validator` takes a precompiled ajv validator built from a JSON Schema that lives apart from your types, error formats are ad-hoc per team, and the OpenAPI document is maintained by hand until it drifts from reality. Your schemas already know all of it. A contract makes them the single source of truth:

```ts
import { z } from "zod";
import { defineContract } from "middy-contracts";

const CreateUser = defineContract("users.create", {
  input: z.object({ email: z.email(), age: z.number().min(18) }),
  output: z.object({ id: z.string(), email: z.email() }),
  errors: [{ code: "USER_EXISTS", status: 409 }],
  http: { method: "POST", path: "/users", successStatus: 201 },
});
```

One object drives the middleware, the error responses, and the spec. No adapter per validator: anything implementing Standard Schema plugs in as-is.

## Install

```sh
pnpm add middy-contracts middy-problem-details @middy/core
# plus your validator, e.g.
pnpm add zod
```

`middy-problem-details` must be a direct dependency when you import it yourself (as in the example below), even though `contractValidator` works without it.

## Usage

### Validate a request

```ts
import middy from "@middy/core";
import { contractValidator, validatedInput } from "middy-contracts/middy";
import { problemDetailsHandler } from "middy-problem-details";

export const handler = middy(async (event: { body: unknown }) => {
  // Fully typed, no casts: contractValidator validated and wrote the parsed
  // values back in `before`.
  const { body } = validatedInput(CreateUser, event);
  return { statusCode: 201, body: { id: "1", email: body.email } };
})
  .use(contractValidator(CreateUser, { responseValidation: "hard" }))
  .use(problemDetailsHandler());
```

An invalid request never reaches the handler — it becomes one `application/problem+json` response listing every issue:

```json
{
  "type": "about:blank",
  "status": 400,
  "title": "Validation failed",
  "detail": "Request does not satisfy contract \"users.create\"",
  "errors": [
    { "part": "body", "path": "email", "message": "Invalid email address" },
    { "part": "body", "path": "age", "message": "Too small: expected number to be >=18" }
  ]
}
```

### Validate each part separately

A bare schema is shorthand for `{ body: schema }`. Declare parts explicitly to validate the rest of the request, each against the event field it comes from:

| Part | Event field | Notes |
|---|---|---|
| `body` | `event.body` | JSON-parsed, base64-decoded first when flagged |
| `query` | `event.queryStringParameters` | multi-value map preferred on REST v1 |
| `params` | `event.pathParameters` | must match the `{var}`s in `http.path` |
| `headers` | `event.headers` | keys lowercased, so schema keys must be lowercase too |

```ts
export const GetUser = defineContract("users.get", {
  input: {
    params: z.object({ id: z.coerce.number().int() }),
    query: z.object({ expand: z.coerce.boolean().default(false) }),
    headers: z.object({ "x-api-key": z.string() }),
  },
  output: z.object({ id: z.number(), email: z.email() }),
  errors: [{ code: "USER_NOT_FOUND", status: 404 }],
  http: { method: "GET", path: "/users/:id" },
});
```

Everything AWS delivers as a string arrives at your handler already coerced, defaults applied, and typed as such:

```ts
import type { InferOutput } from "middy-contracts";

export const getUser = middy(async (event: { pathParameters: unknown }) => {
  const { params, query } = validatedInput(GetUser, event);
  const id: number = params.id;        // coerced from the string AWS delivers
  const expand: boolean = query.expand; // default applied

  const body: InferOutput<typeof GetUser> = { id, email: "ada@example.com" };
  return { statusCode: 200, body };
})
  .use(contractValidator(GetUser, { responseValidation: "hard" }))
  .use(problemDetailsHandler());
```

`validatedInput` returns only the parts the contract declares, so reading `body` off a contract that declares none is a compile error rather than a runtime `undefined`.

### Fail with a declared error

`errors` is **documentation**: it shapes the OpenAPI responses and gives you `InferErrorCodes`, but nothing emits those codes for you. Any error following the http-errors convention (`statusCode`, `expose`) already becomes a Problem Details response:

```ts
throw Object.assign(new Error(`No user with id ${params.id}`), {
  statusCode: 404,
  expose: true,
});
```

To put the machine-readable code on the wire, attach a `problem` and let the declared codes type-check it:

```ts
import { problem } from "middy-problem-details";
import type { InferErrorCodes } from "middy-contracts";

function fail(code: InferErrorCodes<typeof GetUser>, status: number, detail: string) {
  return Object.assign(new Error(detail), {
    statusCode: status,
    expose: true,
    problem: problem({ status, title: "Not Found", detail, code }),
  });
}

throw fail("USER_NOT_FOUND", 404, `No user with id ${params.id}`);
```

```json
{
  "type": "about:blank",
  "status": 404,
  "title": "Not Found",
  "detail": "No user with id 42",
  "code": "USER_NOT_FOUND"
}
```

A typo in the code is now a compile error, and the same string appears in the generated spec.

### Choose a response validation mode

| Mode | On violation | On a valid response |
|---|---|---|
| `"off"` | nothing | untouched |
| `"warn"` (default) | logged | untouched, **never stripped** |
| `"hard"` | opaque `500` | rewritten with the parsed value, so undeclared fields are stripped |

Only success responses are checked: any 2xx, or exactly `http.successStatus` when you set one. Reach for `"hard"` when the output schema is what keeps internal fields out of responses, and read the caveat about already-serialized bodies below.

### Generate OpenAPI 3.1

Build-time only, from the same contracts. Never import this from a handler:

```ts
import { writeFileSync } from "node:fs";
import { toOpenAPI } from "middy-contracts/openapi";

const document = toOpenAPI([CreateUser, GetUser], { title: "Users API", version: "1.0.0" });
writeFileSync("openapi.json", JSON.stringify(document, null, 2));
```

The generator fails loudly rather than emitting a document that lies: unknown validators, duplicate operation ids, ambiguous paths, and path templates that disagree with the declared `params` all throw `OpenApiGenerationError` with a `code` you can switch on.

See [`examples/users-api`](https://github.com/lBroth/middy-contracts/tree/main/examples/users-api) for a runnable end-to-end demo (`pnpm demo`, `pnpm openapi`).

## Compared to

| | [`@middy/validator`](https://middy.js.org/docs/middlewares/validator) | [`middy-standard-schema`](https://github.com/flubber2077/middy-standard-schema) | `middy-contracts` |
|---|---|---|---|
| Schemas | JSON Schema, precompiled ajv validator | Standard Schema | Standard Schema |
| Request validation | event | event | per part: body / query / params / headers |
| Response validation | ✅ | ✅ | ✅ with `off`/`warn`/`hard` modes, 2xx-gated |
| Typed handler input | ❌ | event type merge | ✅ `validatedInput`, coercion-aware |
| OpenAPI generation | ❌ | ❌ | ✅ 3.1, from the same contract |
| RFC 9457 errors | ❌ | ❌ | ✅ via `middy-problem-details` |
| Reusable contract artifact | ❌ | ❌ | ✅ frozen data, drives everything above |

Both alternatives are solid at what they scope to. Use them if you validate the event and response as a whole and don't need per-part validation, OpenAPI, or a shared contract artifact.

## Modules

| Import | Purpose |
|---|---|
| `middy-contracts` | `defineContract` + type utilities. Isomorphic; imports no runtime code from validators or Middy |
| `middy-contracts/middy` | Middy middleware: request + response validation |
| `middy-contracts/openapi` | OpenAPI 3.1 generation (build-time) |

RFC 9457 error responses are provided by the standalone companion package [`middy-problem-details`](https://github.com/lBroth/middy-contracts/tree/main/packages/middy-problem-details).

No client package by design: generate one from the OpenAPI document (e.g. [orval](https://orval.dev), [Hey API](https://heyapi.dev)), or hand-roll a typed fetch with the exported `InferClientInput`/`InferOutput` utilities — they model the wire (pre-validation) and parsed types for you.

## Middleware options and caveats

- **`responseValidation`** — `"off" | "warn" | "hard"`, default `"warn"`. In warn mode violations are logged and never become failures, and the response is left exactly as the handler returned it: warn never rewrites or strips a body, so it gives **no output-filtering guarantee**. If the output schema is what strips sensitive fields, use `"hard"`, which rewrites the response with the parsed value and fails closed with an opaque 500 on violation.
- **Hard mode cannot check an already-serialized body.** If the response body reaches this middleware as a string, there is nothing to validate or strip, so it is passed through and hard mode logs that it skipped it. Mount `contractValidator` inner to any serializer (it runs on the raw handler output) whenever you rely on the output schema to strip fields.
- **`redactedParts`** — parts whose validator issue messages are replaced with a generic one in the 400 response (some validators echo received values). Default `["headers"]`, so header values such as credentials never appear in error responses. Pass `[]` to disable.
- **Headers schemas must use lowercase keys.** Header keys are lowercased before validation (and in the written-back map) so REST (v1) and HTTP API (v2) events behave identically. HTTP API v2 cookies are rehydrated as a `cookie` header.
- **Mount after any body-parsing middleware** (e.g. `@middy/http-json-body-parser`): the parsed body object is written back onto the event.
- Base64-encoded bodies (`isBase64Encoded: true`) are decoded before JSON parsing.
- **Repeated query params.** REST v1 surfaces them as string arrays via the multi-value map, but a single occurrence unwraps to a scalar, so a plain `z.array(z.string())` rejects `?tag=a` while accepting `?tag=a&tag=b`. Declare array params so they accept both shapes:

  ```ts
  const tag = z
    .union([z.string(), z.array(z.string())])
    .transform((value) => (Array.isArray(value) ? value : [value]));

  const ListItems = defineContract("items.list", {
    input: { query: z.object({ tag }) },
    http: { method: "GET", path: "/items" },
  });
  ```

  HTTP API v2 has no multi-value map: AWS delivers repeated params comma-joined into a single string, so split them in the schema if you need a list.

Published declaration files reference sibling files with `.ts` specifiers; TypeScript resolves these to the emitted `.d.ts` files (verified down to TS 5.4).

The supported `@middy/core` range is verified end to end against 5.4.0, 6.4.0, 7.1.0, 7.7.0 and 7.9.2. Middy 7.0.0 and 7.0.1 are excluded from the peer range: 7.0.1 imports an optional peer dependency unconditionally and fails to load at all, which Middy fixed in 7.1.0.

## License

MIT
