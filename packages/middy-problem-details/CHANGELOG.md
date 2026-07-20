# Changelog

All notable changes to `middy-problem-details` are documented here. Format: [Keep a Changelog](https://keepachangelog.com), versioning: [SemVer](https://semver.org).

## [Unreleased]

### Added

- `problemDetailsHandler` Middy onError middleware: RFC 9457 `application/problem+json` responses from any thrown error, http-errors convention support, carried-`problem` pass-through, `mapError` override, opaque 500 for unexpected errors.
- `problem()` builder with RFC 9457 extension members.
- Status phrases for every error status in the IANA registry, so `about:blank` problems carry the title RFC 9457 §4.2.1 recommends (`410` gives `"Gone"`). Previously only 13 statuses were covered and the rest degraded to `"Error"`.
