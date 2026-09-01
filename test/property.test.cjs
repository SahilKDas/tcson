const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const fc = require("fast-check");

const { evaluate } = require("../dist/cjs/index.js");
const decoder = new TextDecoder();

function withTemporaryEntry(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tcson-property-"));
  const previous = process.cwd();
  try {
    process.chdir(directory);
    return callback(path.join(directory, "value.tcson"));
  } finally {
    process.chdir(previous);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("arbitrary JSON trees round-trip deterministically", { timeout: 30_000 }, () => {
  withTemporaryEntry((entry) => {
    fc.assert(
      fc.property(fc.jsonValue(), (input) => {
        fs.writeFileSync(entry, `export default ${JSON.stringify(input)};`);
        const first = decoder.decode(evaluate("value.tcson"));
        const second = decoder.decode(evaluate("value.tcson"));
        assert.equal(second, first);
        assert.deepEqual(JSON.parse(first), input);
      }),
      { numRuns: 250, seed: 0x5443534f },
    );
  });
});

test("arbitrary finite binary64 values round-trip deterministically", { timeout: 30_000 }, () => {
  withTemporaryEntry((entry) => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (input) => {
        fs.writeFileSync(entry, `export default ${input.toString()};`);
        const first = decoder.decode(evaluate("value.tcson"));
        const second = decoder.decode(evaluate("value.tcson"));
        assert.equal(second, first);
        const output = JSON.parse(first);
        assert.equal(output, Object.is(input, -0) ? 0 : input);
      }),
      { numRuns: 500, seed: 0x4e554d42 },
    );
  });
});
