# TcSON v1 language and serialization contract

This document is the normative language contract for TcSON v1. The terms MUST, MUST NOT, SHOULD,
and MAY are interpreted as requirements.

## Entry and source encoding

- An entry path MUST be a non-empty string ending in lowercase `.tcson`.
- Imported files MUST also end in lowercase `.tcson`.
- Source MUST be valid UTF-8. A leading UTF-8 byte order mark is accepted.
- Paths are resolved from the current working directory. Relative imports are resolved from the
  importing file's directory.

## Selected result

A module MUST select exactly one result through an explicit `export default`. As a convenience, a
source file consisting of exactly one unparenthesized object literal, with no terminating
semicolon or other statement, is treated as that default export.

The shorthand does not apply to primitives, arrays, parenthesized objects, multiple objects, or
semicolon-terminated object statements.

## TypeScript subset

TcSON parses and transpiles TypeScript syntax using pinned
`@typescript/typescript6@6.0.2`. It intentionally performs no semantic type checking. Interfaces,
type annotations, `satisfies`, and other erasable syntax therefore do not validate runtime values.

Synchronous language features that survive transpilation MAY execute, including declarations,
functions, conditionals, loops, template strings, object and array literals, spreads, and class
syntax.

The following are rejected:

- async functions, `await`, generators, and `yield`;
- dynamic `import()`;
- decorators;
- `export =` and module re-exports;
- direct references to the internal `arguments`, `exports`, and `require` wrapper bindings.

## Imports and graph execution

Only static relative default imports with an explicit lowercase `.tcson` suffix are supported:

```ts
import defaults from "../shared/defaults.tcson";
```

Named, namespace, type-only, package, built-in, absolute, and URL imports are rejected. Import
cycles are rejected.

For each call:

1. TcSON reads, parses, validates, and transpiles the reachable graph.
2. Graph and compile failures take precedence over result-selection failures.
3. Dependencies execute before their importing module.
4. A module executes at most once.
5. The graph executes in a new realm with no state shared with another call.

## Host boundary

The evaluation realm does not inject Node module bindings, `process`, `fetch`, timers, or a module
loader. VM string and WebAssembly code generation are disabled. These restrictions reduce
accidental ambient access; they are not a security boundary. Configuration MUST be trusted.

## JSON value model

The selected result MUST recursively contain only:

- `null`;
- booleans;
- strings;
- finite IEEE 754 binary64 numbers;
- dense arrays whose own elements are enumerable data properties; and
- plain objects (including cross-realm and null-prototype objects) whose own keys are strings and
  whose properties are enumerable data properties.

The following are rejected rather than silently changed:

- `undefined`, functions, symbols, and bigints;
- `NaN`, positive infinity, and negative infinity;
- cyclic references;
- sparse or augmented arrays;
- accessors, non-enumerable properties, and symbol keys;
- proxy objects, whether or not their traps are transparent;
- dates, regular expressions, maps, sets, promises, typed arrays, and other special instances;
- proxy traps or other inspection failures.

Shared acyclic references are permitted and serialize as repeated JSON values.

## Canonical JSON

`evaluate` returns UTF-8 bytes with these properties:

- two-space indentation;
- no insignificant trailing spaces;
- no final newline;
- object keys sorted lexicographically by Unicode scalar value;
- standard JSON string escaping, plus `<`, `>`, `&`, U+2028, and U+2029 escaped with lowercase
  `\u` sequences;
- `-0` serialized as `0`;
- finite numbers serialized using the shorter of ordinary and normalized exponential forms that
  round-trips to the same binary64 value;
- exponent plus signs and redundant exponent-leading zeroes removed.

Repeated evaluation of the same deterministic source graph and host files MUST produce identical
bytes.

## Error precedence

TcSON reports the earliest applicable stage:

1. invalid entry path;
2. entry or import I/O;
3. parsing, subset validation, import graph, or transpilation;
4. missing selected result;
5. runtime execution;
6. JSON validation and serialization.

Within a compile failure, diagnostics are ordered by file, line, and column.
