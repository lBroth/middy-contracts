# middy-problem-details

[![CI](https://github.com/lBroth/middy-contracts/actions/workflows/ci.yml/badge.svg)](https://github.com/lBroth/middy-contracts/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) Problem Details error responses for [Middy](https://middy.js.org): every thrown error becomes a consistent `application/problem+json` response.

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
  "title": "Conflict",
  "status": 409,
  "detail": "User already exists"
}
```

- Errors following the http-errors convention (`statusCode`, `expose`) keep their status; the `expose` flag controls whether the message becomes `detail` (default: exposed for 4xx, opaque for 5xx).
- Unexpected errors become an opaque `500` (opt in to messages with `exposeInternalErrors: true`).
- Throw an error carrying a `problem` property (build one with `problem()`) to emit it verbatim — extension members included; malformed or non-error statuses fall back to the safe default mapping.
- Fully customizable via `mapError(error) => ProblemDetails` (takes precedence over a carried `problem`).
- `problem()` builder for hand-crafted responses, extension members included.

## License

MIT
