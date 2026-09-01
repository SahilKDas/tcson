# TcSON v1 API and CLI contract

## Library exports

```ts
export function evaluate(inputPath: string): Uint8Array;
export function load<T = JsonValue>(inputPath: string): T;
```

`evaluate` resolves `inputPath` from the process working directory, evaluates the graph, validates
the result, and returns a new `Uint8Array` containing canonical UTF-8 JSON. The returned array is
mutable but is never reused.

`load` calls `evaluate`, decodes its UTF-8 JSON, and returns a newly parsed value. Its type
parameter is unchecked at runtime.

```ts
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

export interface JsonObject {
  readonly [key: string]: JsonValue;
}
```

The package provides native ESM and CommonJS entry points through conditional exports and shared
declarations.

## Errors

```ts
export class TcsonError extends Error {
  readonly name: "TcsonError";
  readonly code: TcsonErrorCode;
  readonly diagnostics: readonly TcsonDiagnostic[];
  readonly cause?: unknown;
}
```

`diagnostics` is a frozen array. Located compile diagnostics may include file, one-based line,
one-based column, and source length.

| Code | Meaning |
| --- | --- |
| `TCSON_INVALID_PATH` | Entry path is empty, non-string, or has the wrong extension |
| `TCSON_FILE_NOT_FOUND` | Entry file does not exist |
| `TCSON_IMPORT_NOT_FOUND` | A relative import cannot be read |
| `TCSON_IO_ERROR` | Another entry I/O failure occurred |
| `TCSON_COMPILE_ERROR` | Parsing, subset validation, graph validation, or transpilation failed |
| `TCSON_EXPORT_MISSING` | A module has no selected default result |
| `TCSON_RUNTIME_ERROR` | Configuration execution threw |
| `TCSON_NOT_JSON` | The selected value cannot be represented without JSON data loss |

## CLI

```text
tcson
tcson -h
tcson --help
tcson help
tcson --version
tcson eval <file.tcson>
tcson eval -h
tcson eval --help
```

`--version` writes exactly `tcson <version>\n`.

`eval` writes canonical JSON plus one newline to stdout. Errors and located diagnostics are
written to stderr. The CLI does not emit color codes. Successful help, version, and evaluation
commands exit with status 0; all usage and evaluation failures exit with status 1.
