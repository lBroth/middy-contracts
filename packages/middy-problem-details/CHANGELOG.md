# Changelog

All notable changes to `middy-problem-details` are documented here. Format: [Keep a Changelog](https://keepachangelog.com), versioning: [SemVer](https://semver.org).

## [Unreleased]

### Added

- `problemDetailsHandler` Middy onError middleware: RFC 9457 `application/problem+json` responses from any thrown error, http-errors convention support, carried-`problem` pass-through, `mapError` override, opaque 500 for unexpected errors.
- `problem()` builder with RFC 9457 extension members.
