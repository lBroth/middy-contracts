# middy-problem-details

[![CI](https://github.com/lBroth/middy-contracts/actions/workflows/ci.yml/badge.svg)](https://github.com/lBroth/middy-contracts/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) Problem Details error responses for [Middy](https://middy.js.org): every thrown error becomes a consistent `application/problem+json` response, unless an earlier `onError` middleware already set one, which is left untouched.

Standalone — works with any Middy stack, no other dependency.

> Status: early development. Not published to npm yet.

## Install

```sh
pnpm add middy-problem-details @middy/core
```

```ts
import middy from "@middy/core";
import { problemDetailsHandler } from "middy-problem-details";

export const handler = middy(baseHandler)
  .use(problemDetailsHandler());
```

A thrown http-errors-style `createError(409, "User already exists")` becomes:

```json
{
  "type": "about:blank",
  "status": 409,
  "title": "Conflict",
  "detail": "User already exists"
}
```

- Errors following the http-errors convention (`statusCode`, `expose`) keep their status, as long as it is an integer in 400-599; anything else is treated as unexpected and becomes an opaque `500`. The `expose` flag controls whether the message becomes `detail` (default: exposed for 4xx, opaque for 5xx).
- Titles follow RFC 9457 §4.2.1: with the default `about:blank` type, the title is the HTTP status phrase for every status in the IANA registry (`410` gives `"Gone"`). Unregistered codes such as `499` fall back to `"Error"`.
- Unexpected errors become an opaque `500` (opt in to messages with `exposeInternalErrors: true`).
- Throw an error carrying a `problem` property (build one with `problem()`) to emit it, extension members included. It is copied onto a fresh object, so a `toJSON` on it never controls serialization and `type` defaults to `about:blank`; malformed or non-error statuses fall back to the safe default mapping.
- Fully customizable via `mapError: (error: unknown) => ProblemDetails | undefined` (takes precedence over a carried `problem`). Return `undefined` to handle only some errors and leave the rest to the default mapping.
- `problem()` builder for hand-crafted responses, extension members included.

## License

MIT
