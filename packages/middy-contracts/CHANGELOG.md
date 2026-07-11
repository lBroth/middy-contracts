# Changelog

All notable changes to `middy-contracts` are documented here. Format: [Keep a Changelog](https://keepachangelog.com), versioning: [SemVer](https://semver.org).

## [Unreleased]

### Added

- `defineContract` with per-part input schemas (`body`/`query`/`params`/`headers`, bare schema = body shorthand) over any Standard Schema validator.
- `contractValidator` Middy middleware: request + response validation, RFC 9457 error integration, base64 body decoding, v1/v2 event normalization (lowercased headers, cookie rehydration, multi-value query params), header issue redaction.
- `validatedInput` typed event accessor for handlers.
- `toOpenAPI`: OpenAPI 3.1 generation via Standard JSON Schema.
- Type utilities: `InferInput`, `InferClientInput`, `InferOutput`, `InferErrorCodes`.
