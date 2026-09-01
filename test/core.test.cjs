const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const tcson = require("../dist/cjs/index.js");
const cli = path.resolve(__dirname, "../dist/esm/cli.js");

function withFixture(files, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tcson-test-"));
  const previous = process.cwd();
  try {
    for (const [name, contents] of Object.entries(files)) {
      const destination = path.join(directory, name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, contents);
    }
    process.chdir(directory);
    return callback(directory);
  } finally {
    process.chdir(previous);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function text(entry) {
  return new TextDecoder().decode(tcson.evaluate(entry));
}

function value(entry) {
  return JSON.parse(text(entry));
}

function expectError(entry, code, pattern) {
  assert.throws(
    () => tcson.evaluate(entry),
    (error) => {
      assert.ok(error instanceof tcson.TcsonError);
      assert.equal(error.name, "TcsonError");
      assert.equal(error.code, code);
      assert.ok(Array.isArray(error.diagnostics));
      if (pattern) assert.match(error.message, pattern);
      return true;
    },
  );
}

function runCli(args, cwd = process.cwd()) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
}

test("evaluate returns canonical UTF-8 JSON", () => {
  withFixture(
    { "config.tcson": 'export default { zebra: 9, alpha: "mint", middle: false };' },
    () => {
      const bytes = tcson.evaluate("config.tcson");
      assert.ok(bytes instanceof Uint8Array);
      assert.equal(
        new TextDecoder().decode(bytes),
        '{\n  "alpha": "mint",\n  "middle": false,\n  "zebra": 9\n}',
      );
    },
  );
});

test("a single top-level object may omit export default", () => {
  withFixture(
    { "shorthand.tcson": '// configuration\n{ port: 4107, enabled: true, labels: ["east"] }' },
    () =>
      assert.deepEqual(value("shorthand.tcson"), { enabled: true, labels: ["east"], port: 4107 }),
  );
});

test("synchronous TypeScript helpers, templates, and spreads execute", () => {
  withFixture(
    {
      "computed.tcson":
        "function badge(team: string, rank: number) { return `$" +
        "{team}-$" +
        "{rank + 3}`; }\n" +
        'const base = { region: "north", replicas: 2 };\n' +
        'export default { ...base, badge: badge("orion", 4), replicas: 5 };',
    },
    () =>
      assert.deepEqual(value("computed.tcson"), {
        badge: "orion-7",
        region: "north",
        replicas: 5,
      }),
  );
});

test("relative default imports may traverse directories", () => {
  withFixture(
    {
      "fragments/base.tcson": '{ host: "db.internal", port: 6432 }',
      "app/main.tcson":
        'import database from "../fragments/base.tcson";\n' +
        "export default { endpoint: `$" +
        "{database.host}:$" +
        "{database.port}` };",
    },
    () => assert.deepEqual(value("app/main.tcson"), { endpoint: "db.internal:6432" }),
  );
});

test("TypeScript types are erased and are not enforced", () => {
  withFixture(
    {
      "unchecked.tcson":
        'interface Expected { count: number }\nexport default { count: "five" } satisfies Expected;',
    },
    () => assert.deepEqual(value("unchecked.tcson"), { count: "five" }),
  );
});

test("every evaluation receives a fresh realm and fresh bytes", () => {
  withFixture(
    {
      "isolated.tcson":
        "globalThis.visits = (globalThis.visits ?? 0) + 1; export default { visits: globalThis.visits };",
    },
    () => {
      const first = tcson.evaluate("isolated.tcson");
      first.fill(0);
      assert.equal(text("isolated.tcson"), '{\n  "visits": 1\n}');
      assert.equal(text("isolated.tcson"), '{\n  "visits": 1\n}');
    },
  );
});

test("empty JSON containers, strings, null, and primitive exports are supported", () => {
  withFixture(
    {
      "values.tcson": 'export default { array: [], object: {}, text: "", nil: null };',
      "primitive.tcson": 'export default "standalone";',
    },
    () => {
      assert.deepEqual(value("values.tcson"), { array: [], nil: null, object: {}, text: "" });
      assert.equal(text("primitive.tcson"), '"standalone"');
    },
  );
});

test("negative zero is serialized as zero", () => {
  withFixture({ "negative-zero.tcson": "export default -0;" }, () => {
    assert.equal(text("negative-zero.tcson"), "0");
  });
});

test("a UTF-8 byte order mark is accepted", () => {
  withFixture(
    {
      "bom.tcson": Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from("export default { accepted: true };"),
      ]),
    },
    () => assert.deepEqual(value("bom.tcson"), { accepted: true }),
  );
});

for (const [name, source] of [
  ["semicolon-terminated object", '{ only: "object" };'],
  ["parenthesized object", "({ wrapped: true })"],
  ["multiple top-level objects", "{ first: 1 }\n{ second: 2 }"],
]) {
  test(`${name} is not implicit object shorthand`, () => {
    withFixture({ "invalid-shorthand.tcson": source }, () => {
      expectError("invalid-shorthand.tcson", "TCSON_EXPORT_MISSING");
    });
  });
}

test("entry paths must be non-empty strings ending in lowercase .tcson", () => {
  expectError("", "TCSON_INVALID_PATH");
  assert.throws(() => tcson.evaluate(1), { code: "TCSON_INVALID_PATH" });
  withFixture(
    {
      "config.ts": "export default {};",
      "config.tson": "export default {};",
      "config.TCSON": "export default {};",
    },
    () => {
      expectError("config.ts", "TCSON_INVALID_PATH");
      expectError("config.tson", "TCSON_INVALID_PATH");
      expectError("config.TCSON", "TCSON_INVALID_PATH");
    },
  );
});

test("a missing entry reports TCSON_FILE_NOT_FOUND", () => {
  withFixture({}, () => expectError("absent.tcson", "TCSON_FILE_NOT_FOUND", /absent\.tcson/));
});

test("a directory entry and unreadable entry report TCSON_IO_ERROR", (t) => {
  withFixture({ "directory.tcson/inside": "x" }, (directory) => {
    expectError("directory.tcson", "TCSON_IO_ERROR");
    if (process.platform === "win32") {
      t.diagnostic("POSIX permission behavior is covered by the Linux CI matrix");
      return;
    }
    const filename = path.join(directory, "unreadable.tcson");
    fs.writeFileSync(filename, "export default {};");
    fs.chmodSync(filename, 0);
    try {
      expectError("unreadable.tcson", "TCSON_IO_ERROR");
    } finally {
      fs.chmodSync(filename, 0o600);
    }
  });
});

test("malformed entry source has located compile diagnostics", () => {
  withFixture({ "malformed.tcson": "export default { answer: ;" }, () => {
    assert.throws(
      () => tcson.evaluate("malformed.tcson"),
      (error) => {
        assert.equal(error.code, "TCSON_COMPILE_ERROR");
        assert.ok(error.diagnostics.length >= 1);
        assert.match(error.diagnostics[0].file, /malformed\.tcson$/);
        assert.equal(error.diagnostics[0].line, 1);
        assert.ok(error.diagnostics[0].column >= 1);
        return true;
      },
    );
  });
});

test("a missing relative import reports TCSON_IMPORT_NOT_FOUND", () => {
  withFixture(
    { "main.tcson": 'import missing from "./not-here.tcson"; export default missing;' },
    () => expectError("main.tcson", "TCSON_IMPORT_NOT_FOUND", /not-here\.tcson/),
  );
});

test("malformed source and malformed UTF-8 in imported files identify that file", () => {
  withFixture(
    {
      "main.tcson": 'import item from "./bad.tcson"; export default item;',
      "bad.tcson": "export default { broken: ??? };",
    },
    () => {
      assert.throws(
        () => tcson.evaluate("main.tcson"),
        (error) =>
          error.code === "TCSON_COMPILE_ERROR" && /bad\.tcson$/.test(error.diagnostics[0].file),
      );
    },
  );
  withFixture(
    {
      "main.tcson": 'import item from "./bad.tcson"; export default item;',
      "bad.tcson": Buffer.from([0xff, 0xfe, 0xfd]),
    },
    () => {
      assert.throws(
        () => tcson.evaluate("main.tcson"),
        (error) =>
          error.code === "TCSON_COMPILE_ERROR" && /bad\.tcson$/.test(error.diagnostics[0].file),
      );
    },
  );
});

for (const [name, source, pattern] of [
  ["bare package import", 'import value from "pkg"; export default value;', /relative imports/i],
  [
    "URL import",
    'import value from "https://example.test/value.tcson"; export default value;',
    /relative imports/i,
  ],
  ["wrong import suffix", 'import value from "./value.ts"; export default value;', /\.tcson/i],
  [
    "named import",
    'import { value } from "./value.tcson"; export default value;',
    /default imports/i,
  ],
  ["dynamic import", 'export default import("./value.tcson");', /dynamic import/i],
]) {
  test(`${name} is rejected during compilation`, () => {
    withFixture(
      {
        "main.tcson": source,
        "value.tcson": "export default 1;",
      },
      () => expectError("main.tcson", "TCSON_COMPILE_ERROR", pattern),
    );
  });
}

for (const [name, source, pattern] of [
  ["async function", "async function later() { return 8; } export default 1;", /async/i],
  ["await expression", "export default await Promise.resolve(1);", /await/i],
  ["generator function", "function* values() { yield 1; } export default 1;", /generator|yield/i],
]) {
  test(`${name} is outside the synchronous language subset`, () => {
    withFixture({ "unsupported.tcson": source }, () => {
      expectError("unsupported.tcson", "TCSON_COMPILE_ERROR", pattern);
    });
  });
}

test("runtime exceptions are wrapped with their cause", () => {
  withFixture({ "throw.tcson": 'throw new Error("violet failure"); export default true;' }, () => {
    assert.throws(
      () => tcson.evaluate("throw.tcson"),
      (error) => {
        assert.equal(error.code, "TCSON_RUNTIME_ERROR");
        assert.match(error.message, /violet failure/);
        assert.ok(error.cause);
        return true;
      },
    );
  });
});

for (const [name, source] of [
  ["process", "export default process.env;"],
  ["fetch", 'export default fetch("https://example.invalid/");'],
]) {
  test(`host binding ${name} is unavailable`, () => {
    withFixture({ "host.tcson": source }, () => {
      expectError("host.tcson", "TCSON_RUNTIME_ERROR", new RegExp(name));
    });
  });
}

test("a missing default export reports TCSON_EXPORT_MISSING", () => {
  withFixture({ "none.tcson": "const local = 19;" }, () => {
    expectError("none.tcson", "TCSON_EXPORT_MISSING");
  });
});

for (const [name, expression, pattern] of [
  ["undefined", "{ value: undefined }", /undefined/i],
  ["positive infinity", "1 / 0", /finite/i],
  ["negative infinity", "-1 / 0", /finite/i],
  ["NaN", "0 / 0", /finite/i],
  ["function", "() => 3", /function/i],
  ["symbol", 'Symbol("value")', /symbol/i],
  ["bigint", "1n", /bigint/i],
  ["Date", "new Date(0)", /plain object/i],
  ["RegExp", "/value/u", /plain object/i],
  ["Map", "new Map()", /plain object/i],
  ["Set", "new Set()", /plain object/i],
]) {
  test(`${name} is rejected as non-JSON`, () => {
    withFixture({ "non-json.tcson": `export default ${expression};` }, () => {
      expectError("non-json.tcson", "TCSON_NOT_JSON", pattern);
    });
  });
}

test("cyclic graphs are rejected but shared acyclic references are accepted", () => {
  withFixture(
    {
      "cycle.tcson": 'const item: any = { name: "loop" }; item.self = item; export default item;',
      "shared.tcson": "const item = { ok: true }; export default { first: item, second: item };",
    },
    () => {
      expectError("cycle.tcson", "TCSON_NOT_JSON", /cyclic/i);
      assert.deepEqual(value("shared.tcson"), {
        first: { ok: true },
        second: { ok: true },
      });
    },
  );
});

for (const [name, source, pattern] of [
  ["sparse array", "const value = new Array(2); value[1] = 1; export default value;", /sparse/i],
  [
    "augmented array",
    "const value: any = [1]; value.extra = 2; export default value;",
    /non-index/i,
  ],
  [
    "array accessor",
    'const value: any[] = []; Object.defineProperty(value, "0", { get() { return 1; }, enumerable: true }); value.length = 1; export default value;',
    /data property/i,
  ],
  [
    "object accessor",
    'const value = {}; Object.defineProperty(value, "x", { get() { return 1; }, enumerable: true }); export default value;',
    /data property/i,
  ],
  [
    "non-enumerable object property",
    'const value = {}; Object.defineProperty(value, "x", { value: 1 }); export default value;',
    /enumerable/i,
  ],
  ["symbol object key", 'export default { [Symbol("x")]: 1 };', /symbol key/i],
  ["transparent proxy", "export default new Proxy({ accepted: false }, {});", /proxy/i],
  [
    "throwing proxy",
    'export default new Proxy({}, { ownKeys() { throw new Error("trap"); } });',
    /proxy/i,
  ],
]) {
  test(`${name} is rejected without silent data loss`, () => {
    withFixture({ "shape.tcson": source }, () => {
      expectError("shape.tcson", "TCSON_NOT_JSON", pattern);
    });
  });
}

test("load decodes JSON and returns a fresh unchecked value", () => {
  withFixture(
    { "decoded.tcson": 'export default { quantity: "many", nested: { clean: true } };' },
    () => {
      const first = tcson.load("decoded.tcson");
      first.nested.clean = false;
      assert.deepEqual(tcson.load("decoded.tcson"), {
        nested: { clean: true },
        quantity: "many",
      });
    },
  );
});

test("dependencies execute before the parent and once per call", () => {
  withFixture(
    {
      "dependency.tcson":
        "globalThis.sequence = (globalThis.sequence ?? 0) + 1; export default globalThis.sequence;",
      "order.tcson":
        'const before = globalThis.sequence ?? 0; import first from "./dependency.tcson"; ' +
        'import second from "./dependency.tcson"; export default { before, first, second, after: globalThis.sequence };',
    },
    () => {
      assert.deepEqual(value("order.tcson"), { after: 1, before: 1, first: 1, second: 1 });
      assert.deepEqual(value("order.tcson"), { after: 1, before: 1, first: 1, second: 1 });
    },
  );
});

test("relative import cycles fail deterministically", () => {
  withFixture(
    {
      "a.tcson": 'import b from "./b.tcson"; export default b;',
      "b.tcson": 'import a from "./a.tcson"; export default a;',
    },
    () => expectError("a.tcson", "TCSON_COMPILE_ERROR", /cycle/i),
  );
});

test("compilation and graph failures precede missing-export selection", () => {
  withFixture({ "compile-first.tcson": "async function nope() {} const value = 1;" }, () => {
    expectError("compile-first.tcson", "TCSON_COMPILE_ERROR", /async/i);
  });
  withFixture(
    { "read-first.tcson": 'import missing from "./missing.tcson"; const value = missing;' },
    () => expectError("read-first.tcson", "TCSON_IMPORT_NOT_FOUND"),
  );
  withFixture(
    {
      "entry.tcson": 'import dependency from "./dependency.tcson"; export default dependency;',
      "dependency.tcson": "const noDefault = true;",
    },
    () => expectError("entry.tcson", "TCSON_EXPORT_MISSING", /dependency\.tcson/),
  );
});

for (const [binding, source] of [
  ["require", 'export default require.constructor("return process")();'],
  ["arguments", "export default arguments[1];"],
  ["exports", "export default exports;"],
]) {
  test(`internal wrapper binding ${binding} cannot be referenced`, () => {
    withFixture({ "wrapper.tcson": source }, () => {
      expectError("wrapper.tcson", "TCSON_COMPILE_ERROR", new RegExp(binding));
    });
  });
}

test("dynamic code generation cannot escape the realm", () => {
  withFixture(
    {
      "constructor.tcson": 'export default globalThis.constructor.constructor("return process")();',
      "function.tcson": 'export default Function("return 1")();',
      "eval.tcson": 'export default eval("1");',
    },
    () => {
      expectError("constructor.tcson", "TCSON_RUNTIME_ERROR");
      expectError("function.tcson", "TCSON_RUNTIME_ERROR");
      expectError("eval.tcson", "TCSON_RUNTIME_ERROR");
    },
  );
});

test("canonical output uses Unicode scalar key ordering and safe escaping", () => {
  withFixture(
    { "canonical.tcson": 'export default { "\uE000": 1, "😀": 2, text: "<>&\u2028\u2029" };' },
    () => {
      assert.equal(
        text("canonical.tcson"),
        '{\n  "text": "\\u003c\\u003e\\u0026\\u2028\\u2029",\n  "": 1,\n  "😀": 2\n}',
      );
    },
  );
});

test("canonical number output round-trips finite binary64 boundary values", () => {
  const numbers = [
    Number.MIN_VALUE,
    Number.MAX_VALUE,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
    1e-7,
    1e-6,
    1e20,
    1e21,
    Math.PI,
    -123.456,
  ];
  for (const [index, number] of numbers.entries()) {
    withFixture({ "number.tcson": `export default ${number.toString()};` }, () => {
      const encoded = text("number.tcson");
      assert.equal(JSON.parse(encoded), number, `case ${index}: ${encoded}`);
      assert.equal(text("number.tcson"), encoded);
    });
  }
});

test("Unicode and platform-native path separators are supported", () => {
  withFixture({ "配置/émoji-😀.tcson": "export default { path: true };" }, () => {
    const entry = path.join("配置", "émoji-😀.tcson");
    assert.deepEqual(value(entry), { path: true });
  });
});

test("symlinked entry files are evaluated when the host permits symlink creation", (t) => {
  withFixture({ "target.tcson": "export default { linked: true };" }, (directory) => {
    try {
      fs.symlinkSync(
        path.join(directory, "target.tcson"),
        path.join(directory, "link.tcson"),
        "file",
      );
    } catch (error) {
      if (error && ["EPERM", "EACCES"].includes(error.code)) {
        t.diagnostic("symlink creation is unavailable on this host");
        return;
      }
      throw error;
    }
    assert.deepEqual(value("link.tcson"), { linked: true });
  });
});

test("CLI eval writes canonical JSON to stdout", () => {
  withFixture({ "command.tcson": "export default { delta: 4, beta: 2 };" }, (directory) => {
    const result = runCli(["eval", "command.tcson"], directory);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '{\n  "beta": 2,\n  "delta": 4\n}\n');
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.includes("\u001b["), false);
  });
});

test("CLI root and eval help support -h and --help", () => {
  for (const args of [[], ["-h"], ["--help"], ["help"], ["eval", "-h"], ["eval", "--help"]]) {
    const result = runCli(args);
    assert.equal(result.status, 0);
    assert.notEqual(result.stdout, "");
    assert.equal(result.stderr, "");
  }
});

test("CLI --version has the exact public format", () => {
  const { version } = require("../package.json");
  const result = runCli(["--version"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `tcson ${version}\n`);
  assert.equal(result.stderr, "");
});

for (const [name, args, pattern] of [
  ["missing eval operand", ["eval"], /exactly one argument/i],
  ["too many eval operands", ["eval", "a.tcson", "b.tcson"], /exactly one argument/i],
  ["unknown command", ["transform"], /unknown command/i],
  ["unknown root flag", ["--other"], /unknown flag/i],
  ["unknown eval flag", ["eval", "--other"], /unknown flag/i],
]) {
  test(`CLI ${name} exits with a diagnostic`, () => {
    const result = runCli(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^\[ERROR\]/);
    assert.match(result.stderr, pattern);
  });
}

test("CLI compile errors are written only to stderr", () => {
  withFixture({ "bad.tcson": "export default { value: @ };" }, (directory) => {
    const result = runCli(["eval", "bad.tcson"], directory);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /bad\.tcson/);
  });
});
