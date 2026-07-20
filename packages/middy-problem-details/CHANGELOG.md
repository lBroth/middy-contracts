# Changelog

All notable changes to `middy-problem-details` are documented here. Format: [Keep a Changelog](https://keepachangelog.com), versioning: [SemVer](https://semver.org).

## [0.1.0] - 2026-07-20

First release. Nothing is published yet, so this documents the initial surface rather than a delta.

### Added

- `problemDetailsHandler` Middy onError middleware: RFC 9457 `application/problem+json` responses from any thrown error, http-errors convention support, carried-`problem` pass-through, `mapError` override, opaque 500 for unexpected errors.
- `problem()` builder with RFC 9457 extension members.
- Status phrases for every error status in the IANA registry, so `about:blank` problems carry the title RFC 9457 §4.2.1 recommends (`410` gives `"Gone"`).

### Notes

- Only integer statuses in 400-599 are honoured from a thrown error; anything else becomes an opaque 500.
- A response already set by an earlier `onError` middleware is left untouched.
- A carried `problem` is copied onto a fresh object, which drops any `toJSON` and applies the `about:blank` type default.
- `mapError` may return `undefined` to fall back to the default mapping for errors it does not handle.
