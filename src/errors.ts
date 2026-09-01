export type TysonErrorCode =
  | "TYSON_INVALID_PATH"
  | "TYSON_FILE_NOT_FOUND"
  | "TYSON_IMPORT_NOT_FOUND"
  | "TYSON_COMPILE_ERROR"
  | "TYSON_RUNTIME_ERROR"
  | "TYSON_EXPORT_MISSING"
  | "TYSON_NOT_JSON"
  | "TYSON_IO_ERROR";

export interface TysonDiagnostic {
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly length?: number;
}

export class TysonError extends Error {
  public override readonly name = "TysonError" as const;
  public readonly code: TysonErrorCode;
  public readonly diagnostics: readonly TysonDiagnostic[];
  public override readonly cause?: unknown;

  /** @internal */
  public constructor(
    code: TysonErrorCode,
    message: string,
    diagnostics: readonly TysonDiagnostic[] = [],
    cause?: unknown,
  ) {
    super(message);
    this.code = code;
    this.diagnostics = Object.freeze([...diagnostics]);
    if (cause !== undefined) {
      this.cause = cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function readableThrown(value: unknown): string {
  if (value instanceof Error && value.message) {
    return value.message;
  }
  if (typeof value === "object" && value !== null) {
    try {
      const message = Reflect.get(value, "message");
      if (typeof message === "string" && message.length > 0) {
        return message;
      }
    } catch {
      // Fall through to stable string conversion.
    }
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return String(value);
  } catch {
    return "Unknown thrown value";
  }
}
