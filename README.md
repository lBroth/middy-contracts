# middy-contracts

[![CI](https://github.com/lBroth/middy-contracts/actions/workflows/ci.yml/badge.svg)](https://github.com/lBroth/middy-contracts/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Contract-first toolkit for [Middy](https://middy.js.org): define an operation once, get request/response validation, RFC 9457 errors, and OpenAPI 3.1 from the same artifact.

> Status: pre-1.0. The API may change between minor versions until 1.0.0.

## Packages

| Package | Purpose |
|---|---|
| [`middy-contracts`](packages/middy-contracts) | `defineContract` over any [Standard Schema](https://standardschema.dev) validator, plus subpath modules: `/middy` (validation middleware), `/openapi` (spec generation) |
| [`middy-problem-details`](packages/middy-problem-details) | Standalone RFC 9457 Problem Details (`application/problem+json`) error middleware — works with or without contracts |

New middlewares live as new folders under `packages/`.

## Development

Requires Node ≥ 24 (`.nvmrc`) and pnpm. TypeScript runs natively via Node type stripping — no build step in development.

```sh
pnpm install
pnpm check   # typecheck all packages (includes type-level tests)
pnpm test    # node --test, directly on .ts sources
pnpm build   # emit dist/ (publish only)
```

## License

MIT
