import { canonicalStringify } from "./canonical-json";
import { evaluateFile } from "./evaluator";
import { TysonError, readableThrown } from "./errors";

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | JsonObject;

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export {
  TysonError,
  type TysonDiagnostic,
  type TysonErrorCode,
} from "./errors";

const encoder = new TextEncoder();

/** Evaluates a .tson entry file and returns canonical UTF-8 JSON bytes. */
function evaluate(inputPath: string): Uint8Array {
  let result: unknown;
  try {
    result = evaluateFile(inputPath);
  } catch (cause) {
    if (cause instanceof TysonError) {
      throw cause;
    }
    throw new TysonError(
      "TYSON_RUNTIME_ERROR",
      `Evaluation failed: ${readableThrown(cause)}`,
      [],
      cause,
    );
  }

  try {
    return encoder.encode(canonicalStringify(result));
  } catch (cause) {
    if (cause instanceof TysonError) {
      throw cause;
    }
    throw new TysonError(
      "TYSON_NOT_JSON",
      `Result is not JSON: ${readableThrown(cause)}`,
      [],
      cause,
    );
  }
}

export { evaluate as eval };

/** Evaluates a .tson entry file and decodes its canonical JSON value. */
export function unmarshal<T = JsonValue>(inputPath: string): T {
  const bytes = evaluate(inputPath);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
