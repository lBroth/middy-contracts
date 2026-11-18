# Changelog

All notable changes to `middy-contracts` are documented here. Format: [Keep a Changelog](https://keepachangelog.com), versioning: [SemVer](https://semver.org).

## [0.1.0] - 2026-11-18

First release. This documents the initial surface rather than a delta.

### Added

- `defineContract` with per-part input schemas (`body`/`query`/`params`/`headers`, bare schema = body shorthand) over any Standard Schema validator.
- `contractValidator` Middy middleware: request + response validation, RFC 9457 error integration, base64 body decoding, v1/v2 event normalization (lowercased headers, cookie rehydration, multi-value query params), header issue redaction.
- `validatedInput` typed event accessor for handlers.
- `toOpenAPI`: OpenAPI 3.1 generation via Standard JSON Schema.
- Type utilities: `InferInput`, `InferClientInput`, `InferOutput`, `InferErrorCodes`.

### Notes

- `warn` (the default response validation mode) is observational: it logs violations and never rewrites the response, so it gives no output-filtering guarantee. Use `hard` when the output schema is what strips sensitive fields.
- `hard` cannot inspect a body that arrives already serialized as a string; it logs that it skipped the check. Mount `contractValidator` inner to any serializer when you rely on stripping.
- Declared `errors` drive the OpenAPI responses and `InferErrorCodes`; nothing emits those codes at runtime unless you attach a `problem` carrying one.
- `toOpenAPI` refuses to emit an invalid document: unknown validators, `$ref`/`$defs`, duplicate operation ids, duplicate or ambiguous paths, and path templates that disagree with the declared `params` all throw.
- Verified against `@middy/core` 5.4.0, 6.4.0, 7.1.0, 7.7.0 and 7.9.2, and against TypeScript down to 5.4. Middy 7.0.0 and 7.0.1 are excluded from the peer range.
