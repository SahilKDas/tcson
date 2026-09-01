import { TysonError } from "./errors";

function notJson(condition: string, path: string): never {
  throw new TysonError(
    "TYSON_NOT_JSON",
    `Result is not JSON: ${condition} at ${path}`,
  );
}

function compareUnicodeScalars(left: string, right: string): number {
  const leftScalars = Array.from(left, (char) => char.codePointAt(0)!);
  const rightScalars = Array.from(right, (char) => char.codePointAt(0)!);
  const count = Math.min(leftScalars.length, rightScalars.length);

  for (let index = 0; index < count; index += 1) {
    const difference = leftScalars[index]! - rightScalars[index]!;
    if (difference !== 0) {
      return difference;
    }
  }
  return leftScalars.length - rightScalars.length;
}

function quote(value: string): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function normalizeExponent(value: string): string {
  return value
    .replace(/e\+/, "e")
    .replace(/e(-?)0+(\d+)/, "e$1$2");
}

function numberToCanonical(value: number): string {
  if (!Number.isFinite(value)) {
    notJson("number must be finite", "$");
  }
  if (Object.is(value, -0)) {
    return "0";
  }

  const ordinary = normalizeExponent(value.toString());
  const exponential = normalizeExponent(value.toExponential());
  return exponential.length < ordinary.length ? exponential : ordinary;
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

function childPath(parent: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/u.test(key)
    ? `${parent}.${key}`
    : `${parent}[${quote(key)}]`;
}

function serialize(
  value: unknown,
  depth: number,
  path: string,
  ancestors: Set<object>,
): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "string":
      return quote(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        notJson("number must be finite", path);
      }
      return numberToCanonical(value);
    case "undefined":
      return notJson("undefined is unsupported", path);
    case "function":
      return notJson("function is unsupported", path);
    case "symbol":
      return notJson("symbol is unsupported", path);
    case "bigint":
      return notJson("bigint is unsupported", path);
    case "object":
      break;
    default:
      return notJson(`unsupported value type ${typeof value}`, path);
  }

  if (ancestors.has(value)) {
    return notJson("cyclic object graph", path);
  }
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      for (const key of ownKeys) {
        if (key === "length") {
          continue;
        }
        if (typeof key !== "string" || !/^(0|[1-9]\d*)$/u.test(key)) {
          notJson("array has a non-index property", path);
        }
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index >= value.length) {
          notJson("array has an invalid index", path);
        }
      }

      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          notJson("sparse array slot is undefined", `${path}[${index}]`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          notJson("array index is not a plain data property", `${path}[${index}]`);
        }
        items.push(serialize(descriptor.value, depth + 1, `${path}[${index}]`, ancestors));
      }

      if (items.length === 0) {
        return "[]";
      }
      const inner = items
        .map((item) => `${"  ".repeat(depth + 1)}${item}`)
        .join(",\n");
      return `[\n${inner}\n${"  ".repeat(depth)}]`;
    }

    if (!isPlainObject(value)) {
      return notJson("value is not a plain object", path);
    }

    const keys: string[] = [];
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        notJson("object has a symbol key", path);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        notJson("object property is not a plain enumerable data property", childPath(path, key));
      }
      keys.push(key);
    }
    keys.sort(compareUnicodeScalars);

    if (keys.length === 0) {
      return "{}";
    }
    const properties = keys.map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      const encoded = serialize(descriptor.value, depth + 1, childPath(path, key), ancestors);
      return `${"  ".repeat(depth + 1)}${quote(key)}: ${encoded}`;
    });
    return `{\n${properties.join(",\n")}\n${"  ".repeat(depth)}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalStringify(value: unknown): string {
  return serialize(value, 0, "$", new Set<object>());
}
