# TcSON

TcSON evaluates synchronous TypeScript configuration files and emits deterministic JSON. It
supports typed source syntax, helper functions, object spread, template strings, and relative
configuration imports while keeping the final value strictly JSON-compatible.

TcSON is intended for trusted, source-controlled project configuration. It reduces ambient host
access, but it is not a security boundary or a malicious-code sandbox.

## Runtime support

| Runtime | Support | Platforms |
| --- | --- | --- |
| Node.js 22 and 24 | First-class | Linux, Windows, macOS |
| Bun 1.3.14 or newer | First-class | Linux, Windows, macOS |
| Deno 2.8 or newer | Compatibility | Linux |

## Install from GitHub Packages

GitHub Packages requires an authenticated, classic personal access token for npm package
downloads, including public packages. Create a classic PAT with `read:packages`, then put the
registry and token in your **user-level** npm configuration—not this repository:

```ini
@sahilkdas:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```

Set `GITHUB_PACKAGES_TOKEN` in your shell, then install with your package manager:

```sh
npm install @sahilkdas/tcson
bun add @sahilkdas/tcson
deno add npm:@sahilkdas/tcson
```

See GitHub's
[npm registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry)
for token creation, SSO authorization, and registry configuration.

## Write a configuration

```ts
// app.tcson
const defaults = {
  host: "127.0.0.1",
  port: 8080,
};

export default {
  ...defaults,
  endpoint: `http://${defaults.host}:${defaults.port}`,
};
```

A file containing only one object literal may omit `export default`:

```ts
{
  environment: "production",
  replicas: 3,
}
```

Relative configuration imports are lowercase `.tcson` default imports:

```ts
import database from "./database.tcson";

export default {
  database,
  service: "api",
};
```

## Library API

ES modules:

```ts
import { evaluate, load, TcsonError } from "@sahilkdas/tcson";

const bytes = evaluate("app.tcson");
const config = load<{ endpoint: string }>("app.tcson");

try {
  load("broken.tcson");
} catch (error) {
  if (error instanceof TcsonError) {
    console.error(error.code, error.diagnostics);
  }
}
```

CommonJS:

```js
const { evaluate, load } = require("@sahilkdas/tcson");
```

`evaluate(path)` returns fresh canonical UTF-8 JSON bytes. `load<T>(path)` parses those bytes and
returns a fresh value; its generic parameter is a TypeScript assertion and performs no runtime
validation.

## CLI

```sh
tcson eval app.tcson
tcson --version
tcson --help
tcson eval --help
```

Successful evaluation writes canonical JSON followed by one newline to stdout. Help and version
also use stdout. Failures write diagnostics to stderr. Exit status is `0` for success and `1` for
failure.

With Deno:

```sh
deno run --allow-read npm:@sahilkdas/tcson eval app.tcson
```

## Language and output

TcSON performs syntax-only TypeScript transpilation. It does not run the semantic type checker.
Each call evaluates a complete relative import graph in a fresh realm, runs dependencies before
their parents, and evaluates each file once per call.

The selected value must consist only of null, booleans, strings, finite numbers, dense arrays, and
plain objects with enumerable string-keyed data properties. Cycles, accessors, sparse arrays,
functions, symbols, bigints, proxies, special object instances, and non-finite numbers are rejected.

Output is deterministic: object keys use Unicode scalar ordering, JSON is two-space indented,
unsafe HTML separators are escaped, numbers use a shortest round-tripping representation, and no
trailing newline is included in library bytes.

The normative details are in [the language contract](docs/language.md) and [the API contract](docs/api.md).

## Deliberate v1 limitations

- No semantic type checking
- No asynchronous evaluation or dynamic imports
- No package or URL imports from configuration files
- No plugins
- No caching or watch mode
- No guarantee of isolation from intentionally hostile configuration

## License and security

TcSON is available under the [BSD 3-Clause License](LICENSE). Review [SECURITY.md](SECURITY.md)
before processing configuration from outside your trust boundary.
