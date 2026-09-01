export type TcsonErrorCode =
  | "TCSON_INVALID_PATH"
  | "TCSON_FILE_NOT_FOUND"
  | "TCSON_IMPORT_NOT_FOUND"
  | "TCSON_COMPILE_ERROR"
  | "TCSON_RUNTIME_ERROR"
  | "TCSON_EXPORT_MISSING"
  | "TCSON_NOT_JSON"
  | "TCSON_IO_ERROR";

export interface TcsonDiagnostic {
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly length?: number;
}

export class TcsonError extends Error {
  public override readonly name = "TcsonError" as const;
  public readonly code: TcsonErrorCode;
  public readonly diagnostics: readonly TcsonDiagnostic[];
  public override readonly cause?: unknown;

  /** @internal */
  public constructor(
    code: TcsonErrorCode,
    message: string,
    diagnostics: readonly TcsonDiagnostic[] = [],
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

/** @internal */
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
