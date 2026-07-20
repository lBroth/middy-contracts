# middy-contracts

[![CI](https://github.com/lBroth/middy-contracts/actions/workflows/ci.yml/badge.svg)](https://github.com/lBroth/middy-contracts/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Contract-first toolkit for [Middy](https://middy.js.org). Define an operation once with any [Standard Schema](https://standardschema.dev) validator (conformance-tested against Zod and Joi 18+) and get request/response validation, RFC 9457 errors, and OpenAPI 3.1 from the same artifact. OpenAPI generation additionally needs the validator's Standard JSON Schema support.

> Status: early development, API unstable. Not published to npm yet.

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

Validate requests and responses in a Middy chain:

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

Generate OpenAPI 3.1 from the same contracts (build-time, e.g. in CI):

```ts
import { toOpenAPI } from "middy-contracts/openapi";

const document = toOpenAPI([CreateUser, GetUser], { title: "Users API", version: "1.0.0" });
```

See [`examples/users-api`](https://github.com/lBroth/middy-contracts/tree/main/examples/users-api) for a runnable end-to-end demo (`pnpm demo`).

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

The supported `@middy/core` range is verified end to end against 5.4.0, 6.4.0, 7.1.0 and 7.7.0. Middy 7.0.0 and 7.0.1 are excluded from the peer range: 7.0.1 imports an optional peer dependency unconditionally and fails to load at all, which Middy fixed in 7.1.0.

## License

MIT
