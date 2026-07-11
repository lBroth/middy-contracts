# Contributing

## Setup

Requires Node ≥ 24 (see `.nvmrc`) and pnpm.

```sh
pnpm install
pnpm check   # typecheck every package (includes type-level tests)
pnpm test    # node --test, directly on the TypeScript sources
pnpm build   # emit dist/ (publish only — dev never needs a build)
```

There is no build step in development: Node 24 runs the `.ts` sources natively (type stripping), and workspace packages resolve to `src/` via their dev `exports`.

## Repository layout

- `packages/middy-contracts` — contract model, Middy middleware, OpenAPI generator
- `packages/middy-problem-details` — standalone RFC 9457 middleware
- `examples/users-api` — end-to-end demo, typechecked and tested in CI like any package

## Conventions

- TypeScript-first, `strict` + `erasableSyntaxOnly`: no enums, no namespaces, no parameter properties. Relative imports use explicit `.ts` extensions.
- ESM only. Named exports only. No classes in the public API except error types.
- Public API changes need type tests (`contract.type-tests.ts` pattern) alongside runtime tests.
- Node `engines` is `>=20` for published packages: the compiled output must not use APIs newer than Node 20 (rationale: AWS Lambda `nodejs20.x` is still widely deployed). Dev tooling may assume Node 24.

## Releases

Publish always goes through pnpm (`pnpm run release` at the root): pnpm rewrites `workspace:^` ranges and applies `publishConfig.exports`. `npm publish`/`npm pack` are blocked by guard scripts on purpose.
