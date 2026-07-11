# users-api example

End-to-end demo: one contract file drives request validation, typed handlers, RFC 9457 errors, and OpenAPI 3.1.

```sh
pnpm demo     # invoke the Lambda handlers locally with fake API Gateway events
pnpm openapi  # print the OpenAPI 3.1 document generated from the same contracts
```

No AWS account needed — handlers are invoked directly. Node ≥ 24 runs the TypeScript sources natively.
