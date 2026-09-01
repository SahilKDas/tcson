import { canonicalStringify } from "./canonical-json.js";
import { readableThrown, TcsonError } from "./errors.js";
import { evaluateFile } from "./evaluator.js";

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export {
  type TcsonDiagnostic,
  TcsonError,
  type TcsonErrorCode,
} from "./errors.js";

const encoder = new TextEncoder();

/** Evaluates a .tcson entry file and returns canonical UTF-8 JSON bytes. */
export function evaluate(inputPath: string): Uint8Array {
  let result: unknown;
  try {
    result = evaluateFile(inputPath);
  } catch (cause) {
    if (cause instanceof TcsonError) {
      throw cause;
    }
    throw new TcsonError(
      "TCSON_RUNTIME_ERROR",
      `Evaluation failed: ${readableThrown(cause)}`,
      [],
      cause,
    );
  }

  try {
    return encoder.encode(canonicalStringify(result));
  } catch (cause) {
    if (cause instanceof TcsonError) {
      throw cause;
    }
    throw new TcsonError(
      "TCSON_NOT_JSON",
      `Result is not JSON: ${readableThrown(cause)}`,
      [],
      cause,
    );
  }
}

/** Evaluates a .tcson entry file and decodes its canonical JSON value without runtime type checking. */
export function load<T = JsonValue>(inputPath: string): T {
  const bytes = evaluate(inputPath);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
