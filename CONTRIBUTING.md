# Contributing to TcSON

## Requirements

- Node.js 22 or 24
- npm with lockfile support
- Bun 1.3.14 or newer for first-class runtime validation
- Deno 2.8 or newer for the Linux compatibility smoke test

Install exact locked dependencies:

```sh
npm ci
```

## Development checks

```sh
npm run format
npm run check
npm test
npm run test:coverage
npm run test:bun
npm run test:deno
npm run pack:check
```

`npm run pack:check` validates package metadata and declarations, enforces the published-file and
size allowlists, installs the exact tarball in a clean temporary consumer, and tests ESM, CommonJS,
and the CLI.

Keep dependencies pinned exactly. Add conformance tests for every public behavior change. Changes
to [docs/language.md](docs/language.md) or [docs/api.md](docs/api.md) are public contract changes and
must be called out explicitly in the changelog.

The runtime compiler API is pinned to `@typescript/typescript6@6.0.2`. TypeScript 7.0 does not
provide the programmatic API TcSON requires. Reconsider TypeScript 7.1 or newer only after that API
is stable and the complete conformance suite produces unchanged results. See Microsoft's
[TypeScript 7 transition guidance](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).

## Pull requests

Pull requests should be focused, include tests and documentation, and pass all blocking quality
jobs on Node.js and Bun across Linux, Windows, and macOS. Deno compatibility is monitored on Linux
and is non-blocking.

## Release process

Releases are tag-driven and must originate from a commit already on `main`.

1. Set the intended version in `package.json` and update `CHANGELOG.md`.
2. Run all development checks from a clean `npm ci`.
3. Commit the release changes and create a signed `v<version>` tag.
4. Push the commit and tag. The release workflow verifies the tag, reruns quality jobs, builds and
   validates one tarball, produces an SBOM and provenance, publishes to GitHub Packages, and
   creates the matching GitHub Release.

Prereleases use the `next` package tag. Stable releases use `latest`.
