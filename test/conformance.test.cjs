const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const tcson = require("../dist/index.js");
const cli = path.resolve(__dirname, "../dist/cli.js");

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
  return new TextDecoder().decode(tcson.eval(entry));
}

function value(entry) {
  return JSON.parse(text(entry));
}

function expectError(entry, code, pattern) {
  assert.throws(
    () => tcson.eval(entry),
    (error) => {
      assert.ok(error instanceof tcson.TysonError);
      assert.equal(error.name, "TysonError");
      assert.equal(error.code, code);
      assert.ok(Array.isArray(error.diagnostics));
      if (pattern) assert.match(error.message, pattern);
      return true;
    },
  );
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
}

test("BB-EVAL-001 explicit default object and canonical order", () => {
  withFixture({ "config.tson": 'export default { zebra: 9, alpha: "mint", middle: false };' }, () => {
    assert.equal(text("config.tson"), '{\n  "alpha": "mint",\n  "middle": false,\n  "zebra": 9\n}');
  });
});

test("BB-EVAL-002 implicit single-object shorthand", () => {
  withFixture({ "shorthand.tson": '// only item\n{ port: 4107, enabled: true, labels: ["east", "night"] }' }, () => {
    assert.deepEqual(value("shorthand.tson"), { enabled: true, labels: ["east", "night"], port: 4107 });
  });
});

test("BB-EVAL-003 template interpolation and synchronous helper", () => {
  withFixture({
    "computed.tson": 'function badge(team: string, rank: number) { return `${team}-${rank + 3}`; }\nexport default { badge: badge("orion", 4), score: 6 * 7 };',
  }, () => assert.deepEqual(value("computed.tson"), { badge: "orion-7", score: 42 }));
});

test("BB-EVAL-004 spread with later override", () => {
  withFixture({
    "override.tson": 'const base = { region: "north", replicas: 2, secure: false };\nexport default { ...base, replicas: 5, secure: true };',
  }, () => assert.deepEqual(value("override.tson"), { region: "north", replicas: 5, secure: true }));
});

test("BB-EVAL-005 relative import graph", () => {
  withFixture({
    "fragments/base.tson": '{ host: "db.internal", port: 6432 }',
    "app/main.tson": 'import database from "../fragments/base.tson";\nexport default { endpoint: `${database.host}:${database.port}` };',
  }, () => assert.deepEqual(value("app/main.tson"), { endpoint: "db.internal:6432" }));
});

test("BB-EVAL-006 arrays, null, Unicode, and escapes", () => {
  withFixture({ "values.tson": 'export default [null, "café", "line\\nbreak", { ok: true }];' }, () => {
    assert.deepEqual(value("values.tson"), [null, "café", "line\nbreak", { ok: true }]);
  });
});

test("BB-EVAL-007 primitive default export", () => {
  withFixture({ "primitive.tson": 'export default "standalone";' }, () => {
    assert.equal(text("primitive.tson"), '"standalone"');
  });
});

test("BB-EVAL-008 erasable types are not enforced", () => {
  withFixture({
    "unchecked.tson": 'interface Expected { count: number }\nexport default { count: "five" } satisfies Expected;',
  }, () => assert.deepEqual(value("unchecked.tson"), { count: "five" }));
});

test("BB-EVAL-009 fresh realm on every call", () => {
  withFixture({
    "isolated.tson": 'const marker = { visits: 0 }; marker.visits += 1; export default marker;',
  }, () => {
    assert.deepEqual(value("isolated.tson"), { visits: 1 });
    assert.deepEqual(value("isolated.tson"), { visits: 1 });
  });
});

test("BB-EVAL-010 canonical nested key order", () => {
  withFixture({
    "ordering.tson": 'export default { outerZ: { y: 1, b: 2 }, outerA: [{ q: 3, a: 4 }] };',
  }, () => {
    assert.equal(text("ordering.tson"), '{\n  "outerA": [\n    {\n      "a": 4,\n      "q": 3\n    }\n  ],\n  "outerZ": {\n    "b": 2,\n    "y": 1\n  }\n}');
  });
});

test("BB-BOUND-001 empty containers and empty string", () => {
  withFixture({ "empty-values.tson": 'export default { array: [], object: {}, text: "" };' }, () => {
    assert.deepEqual(value("empty-values.tson"), { array: [], object: {}, text: "" });
  });
});

test("BB-BOUND-002 negative zero", () => {
  withFixture({ "negative-zero.tson": "export default -0;" }, () => assert.equal(text("negative-zero.tson"), "0"));
});

test("BB-BOUND-003 UTF-8 BOM", () => {
  withFixture({ "bom.tson": Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("export default { accepted: true };")]) }, () => {
    assert.deepEqual(value("bom.tson"), { accepted: true });
  });
});

test("BB-BOUND-004 semicolon disables implicit shorthand", () => {
  withFixture({ "semicolon.tson": '{ only: "object" };' }, () => expectError("semicolon.tson", "TYSON_EXPORT_MISSING", /default export/i));
});

test("BB-BOUND-005 parenthesized object is not shorthand", () => {
  withFixture({ "wrapped.tson": "({ wrapped: true })" }, () => expectError("wrapped.tson", "TYSON_EXPORT_MISSING"));
});

test("BB-BOUND-006 two top-level objects are not shorthand", () => {
  withFixture({ "double.tson": "{ first: 1 }\n{ second: 2 }" }, () => expectError("double.tson", "TYSON_EXPORT_MISSING"));
});

test("BB-ERR-001 empty path", () => {
  expectError("", "TYSON_INVALID_PATH");
  try { tcson.eval(""); } catch (error) { assert.equal(error.diagnostics.length, 0); }
});

test("BB-ERR-002 unsupported entry suffix", () => {
  withFixture({ "config.ts": "export default {};" }, () => expectError("config.ts", "TYSON_INVALID_PATH"));
});

test("BB-ERR-003 missing entry", () => {
  withFixture({}, () => expectError("absent.tson", "TYSON_FILE_NOT_FOUND", /absent\.tson/));
});

test("BB-ERR-004 malformed source", () => {
  withFixture({ "malformed.tson": "export default { answer: ;" }, () => {
    try {
      tcson.eval("malformed.tson");
      assert.fail("expected compile error");
    } catch (error) {
      assert.equal(error.code, "TYSON_COMPILE_ERROR");
      assert.ok(error.diagnostics.length >= 1);
      assert.match(error.diagnostics[0].file, /malformed\.tson$/);
      assert.equal(error.diagnostics[0].line, 1);
      assert.ok(error.diagnostics[0].column >= 1);
    }
  });
});

test("BB-ERR-005 missing import", () => {
  withFixture({
    "main.tson": 'import missing from "./not-here.tson"; export default missing;',
  }, () => expectError("main.tson", "TYSON_IMPORT_NOT_FOUND", /not-here\.tson/));
});

test("BB-ERR-006 imported syntax failure identifies imported file", () => {
  withFixture({
    "main.tson": 'import item from "./bad.tson"; export default item;',
    "bad.tson": "export default { broken: ??? };",
  }, () => {
    try {
      tcson.eval("main.tson");
      assert.fail("expected compile error");
    } catch (error) {
      assert.equal(error.code, "TYSON_COMPILE_ERROR");
      assert.match(error.diagnostics[0].file, /bad\.tson$/);
    }
  });
});

test("BB-ERR-007 bare package import rejected", () => {
  withFixture({
    "package.tson": 'import helper from "some-package"; export default helper;',
  }, () => expectError("package.tson", "TYSON_COMPILE_ERROR", /(package|import|resolve)/i));
});

test("BB-ERR-008 async is outside the subset", () => {
  withFixture({
    "async.tson": "async function later() { return 8; } export default await later();",
  }, () => expectError("async.tson", "TYSON_COMPILE_ERROR", /(async|await)/i));
});

test("BB-RUN-001 explicit throw", () => {
  withFixture({
    "throw.tson": 'throw new Error("violet failure"); export default { unreachable: true };',
  }, () => expectError("throw.tson", "TYSON_RUNTIME_ERROR", /violet failure/));
});

test("BB-RUN-002 host process is unavailable", () => {
  withFixture({ "process.tson": "export default { home: process.env.HOME };" }, () => {
    expectError("process.tson", "TYSON_RUNTIME_ERROR", /process/);
  });
});

test("BB-RUN-003 host fetch is unavailable", () => {
  withFixture({ "network.tson": 'export default fetch("https://example.invalid/");' }, () => {
    expectError("network.tson", "TYSON_RUNTIME_ERROR", /fetch/);
  });
});

test("BB-JSON-001 missing default export", () => {
  withFixture({ "none.tson": "const local = 19;" }, () => expectError("none.tson", "TYSON_EXPORT_MISSING"));
});

test("BB-JSON-002 undefined rejected without data loss", () => {
  withFixture({ "undefined.tson": "export default { present: 1, lost: undefined };" }, () => {
    expectError("undefined.tson", "TYSON_NOT_JSON", /undefined/i);
  });
});

test("BB-JSON-003 non-finite number rejected", () => {
  withFixture({ "infinity.tson": "export default { value: 1 / 0 };" }, () => {
    expectError("infinity.tson", "TYSON_NOT_JSON", /(finite|infinity|number)/i);
  });
});

test("BB-JSON-004 function result rejected", () => {
  withFixture({ "function.tson": "export default { action: () => 3 };" }, () => {
    expectError("function.tson", "TYSON_NOT_JSON", /function/i);
  });
});

test("BB-JSON-005 cyclic graph rejected", () => {
  withFixture({
    "cycle.tson": 'const item: any = { name: "loop" }; item.self = item; export default item;',
  }, () => expectError("cycle.tson", "TYSON_NOT_JSON", /cyc/i));
});

test("BB-UNMARSHAL-001 decoded value", () => {
  withFixture({
    "decoded.tson": 'export default { count: 12, tags: ["copper", "rain"] };',
  }, () => assert.deepEqual(tcson.unmarshal("decoded.tson"), { count: 12, tags: ["copper", "rain"] }));
});

test("BB-UNMARSHAL-002 generic parameter does not validate", () => {
  withFixture({ "generic.tson": 'export default { quantity: "many" };' }, () => {
    assert.deepEqual(tcson.unmarshal("generic.tson"), { quantity: "many" });
  });
});

test("BB-UNMARSHAL-003 result values are not shared", () => {
  withFixture({ "fresh.tson": 'export default { nested: { state: "clean" } };' }, () => {
    const first = tcson.unmarshal("fresh.tson");
    first.nested.state = "changed";
    assert.deepEqual(tcson.unmarshal("fresh.tson"), { nested: { state: "clean" } });
  });
});

test("BB-CLI-001 eval through redirected stdout", () => {
  withFixture({ "command.tson": "export default { delta: 4, beta: 2 };" }, (directory) => {
    const result = runCli(["eval", "command.tson"], directory);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '{\n  "beta": 2,\n  "delta": 4\n}\n');
    assert.equal(result.stderr, "");
    assert.doesNotMatch(result.stdout, /\x1b\[/);
  });
});

test("BB-CLI-002 root without arguments", () => {
  const result = runCli([], process.cwd());
  assert.equal(result.status, 0);
  assert.match(result.stdout, /TypeScript.*configuration/is);
  assert.match(result.stdout, /eval/);
  assert.equal(result.stderr, "");
});

test("BB-CLI-003 wrong argument count", () => {
  const result = runCli(["eval"], process.cwd());
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^\[ERROR\]/);
  assert.match(result.stderr, /arg/i);
});

test("BB-CLI-004 unknown command", () => {
  const result = runCli(["transform"], process.cwd());
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^\[ERROR\]/);
  assert.match(result.stderr, /unknown command/i);
});

test("BB-CLI-005 compile failure", () => {
  withFixture({ "cli-bad.tson": "export default { value: @ };" }, (directory) => {
    const result = runCli(["eval", "cli-bad.tson"], directory);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /error/i);
    assert.match(result.stderr, /cli-bad\.tson/);
  });
});

test("BB-CLI-006 help paths", () => {
  for (const args of [["--help"], ["help"], ["eval", "--help"]]) {
    const result = runCli(args, process.cwd());
    assert.equal(result.status, 0);
    assert.notEqual(result.stdout, "");
    assert.equal(result.stderr, "");
  }
});

test("invalid UTF-8 is a located compile error", () => {
  withFixture({ "invalid.tson": Buffer.from([0xff, 0xfe, 0xfd]) }, () => {
    try {
      tcson.eval("invalid.tson");
      assert.fail("expected compile error");
    } catch (error) {
      assert.equal(error.code, "TYSON_COMPILE_ERROR");
      assert.match(error.diagnostics[0].file, /invalid\.tson$/);
    }
  });
});

test("relative import cycles fail deterministically", () => {
  withFixture({
    "a.tson": 'import b from "./b.tson"; export default b;',
    "b.tson": 'import a from "./a.tson"; export default a;',
  }, () => expectError("a.tson", "TYSON_COMPILE_ERROR", /cycle/i));
});

test("canonical escaping and Unicode scalar key ordering", () => {
  withFixture({
    "canonical.tson": 'export default { "": 1, "😀": 2, text: "<>&  " };',
  }, () => {
    assert.equal(text("canonical.tson"), '{\n  "text": "\\u003c\\u003e\\u0026\\u2028\\u2029",\n  "": 1,\n  "😀": 2\n}');
  });
});

test("compilation and graph reads precede result selection", () => {
  withFixture({ "compile-first.tson": "async function nope() {} const value = 1;" }, () => {
    expectError("compile-first.tson", "TYSON_COMPILE_ERROR", /async/i);
  });
  withFixture({
    "read-first.tson": 'import missing from "./missing.tson"; const value = missing;',
  }, () => expectError("read-first.tson", "TYSON_IMPORT_NOT_FOUND", /missing\.tson/));
});

test("dependencies execute before the parent and once per evaluation", () => {
  withFixture({
    "dependency.tson": "globalThis.sequence = (globalThis.sequence ?? 0) + 1; export default globalThis.sequence;",
    "order.tson": 'const before = globalThis.sequence ?? 0; import first from "./dependency.tson"; import second from "./dependency.tson"; export default { before, first, second, after: globalThis.sequence };',
  }, () => {
    assert.deepEqual(value("order.tson"), { after: 1, before: 1, first: 1, second: 1 });
  });
});

test("internal CommonJS wrapper bindings cannot be referenced", () => {
  withFixture({
    "require.tson": 'export default require.constructor("return process")();',
  }, () => expectError("require.tson", "TYSON_COMPILE_ERROR", /require/i));
  withFixture({
    "arguments.tson": "export default arguments[1];",
  }, () => expectError("arguments.tson", "TYSON_COMPILE_ERROR", /arguments/i));
});

test("dynamic code generation cannot escape the isolated realm", () => {
  withFixture({
    "escape.tson": 'export default globalThis.constructor.constructor("return process")();',
  }, () => expectError("escape.tson", "TYSON_RUNTIME_ERROR"));
});

test("eval returns fresh mutable byte arrays", () => {
  withFixture({ "bytes.tson": "export default { stable: true };" }, () => {
    const first = tcson.eval("bytes.tson");
    first.fill(0);
    assert.equal(new TextDecoder().decode(tcson.eval("bytes.tson")), '{\n  "stable": true\n}');
  });
});

test("unexpected proxy serialization failures remain typed", () => {
  withFixture({
    "proxy.tson": 'const value = new Proxy({}, { ownKeys() { throw new Error("trap"); } }); export default value;',
  }, () => expectError("proxy.tson", "TYSON_NOT_JSON", /trap/i));
});
