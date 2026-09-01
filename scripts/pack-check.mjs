import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const keepTarball = process.argv.includes("--keep");
const npmCli =
  process.env.npm_execpath ??
  resolve(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const runNpm = (args, options = {}) => execFileSync(process.execPath, [npmCli, ...args], options);
const packed = JSON.parse(
  runNpm(["pack", "--json", "--ignore-scripts"], {
    encoding: "utf8",
  }),
)[0];

if (!packed?.filename || !Array.isArray(packed.files)) {
  throw new Error("npm pack did not return the expected manifest");
}

const allowedFiles = new Set(["LICENSE", "README.md", "SECURITY.md", "package.json"]);
const allowedPrefixes = ["dist/", "docs/"];
const unexpected = packed.files
  .map((entry) => entry.path.replaceAll("\\", "/"))
  .filter(
    (file) => !allowedFiles.has(file) && !allowedPrefixes.some((prefix) => file.startsWith(prefix)),
  );
if (unexpected.length > 0) {
  throw new Error(`Unexpected packed files:\n${unexpected.join("\n")}`);
}

for (const required of [
  "dist/esm/index.js",
  "dist/esm/cli.js",
  "dist/cjs/index.js",
  "dist/types/index.d.ts",
  "dist/types/index.d.mts",
  "dist/types/index.d.cts",
  "docs/api.md",
  "docs/language.md",
]) {
  if (!packed.files.some((entry) => entry.path.replaceAll("\\", "/") === required)) {
    throw new Error(`Required packed file is missing: ${required}`);
  }
}

if (packed.size > 500_000 || packed.unpackedSize > 2_000_000) {
  throw new Error(
    `Package size budget exceeded: ${packed.size} packed, ${packed.unpackedSize} unpacked`,
  );
}

const tarball = resolve(packed.filename);
const consumer = mkdtempSync(join(tmpdir(), "tcson-packed-consumer-"));
try {
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "tcson-packed-consumer", private: true }, null, 2),
  );
  runNpm(["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock"], {
    cwd: consumer,
    stdio: "inherit",
  });

  const fixture = join(consumer, "packed.tcson");
  writeFileSync(fixture, "export default { packed: true, value: 7 };");

  const commonJs = execFileSync(
    process.execPath,
    [
      "-e",
      'const { load } = require("@sahilkdas/tcson"); process.stdout.write(JSON.stringify(load("packed.tcson")));',
    ],
    { cwd: consumer, encoding: "utf8" },
  );
  if (commonJs !== '{"packed":true,"value":7}') {
    throw new Error(`CommonJS packed consumer failed: ${commonJs}`);
  }

  const esm = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import { load } from "@sahilkdas/tcson"; process.stdout.write(JSON.stringify(load("packed.tcson")));',
    ],
    { cwd: consumer, encoding: "utf8" },
  );
  if (esm !== commonJs) {
    throw new Error(`ESM packed consumer failed: ${esm}`);
  }

  const installedRoot = join(consumer, "node_modules", "@sahilkdas", "tcson");
  const cliOutput = execFileSync(
    process.execPath,
    [join(installedRoot, "dist", "esm", "cli.js"), "--version"],
    { cwd: consumer, encoding: "utf8" },
  );
  if (cliOutput !== `tcson ${packageJson.version}\n`) {
    throw new Error(`Packed CLI version failed: ${cliOutput}`);
  }

  const binOutput = runNpm(["exec", "--offline", "--", "tcson", "eval", basename(fixture)], {
    cwd: consumer,
    encoding: "utf8",
  });
  if (binOutput !== '{\n  "packed": true,\n  "value": 7\n}\n') {
    throw new Error(`Packed binary failed: ${binOutput}`);
  }

  mkdirSync(join(consumer, "done"));
  process.stdout.write(
    `Validated ${packed.filename}: ${packed.files.length} files, ESM, CommonJS, and CLI consumers passed.\n`,
  );
} finally {
  rmSync(consumer, { recursive: true, force: true });
  if (!keepTarball) {
    rmSync(tarball, { force: true });
  }
}
