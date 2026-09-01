import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const compiler = resolve("node_modules", "@typescript", "typescript6", "bin", "tsc6");

rmSync(resolve("dist"), { recursive: true, force: true });

for (const project of ["tsconfig.esm.json", "tsconfig.cjs.json", "tsconfig.types.json"]) {
  execFileSync(process.execPath, [compiler, "-p", project], { stdio: "inherit" });
}

mkdirSync(resolve("dist", "esm"), { recursive: true });
mkdirSync(resolve("dist", "cjs"), { recursive: true });
writeFileSync(resolve("dist", "esm", "package.json"), '{"type":"module"}\n');
writeFileSync(resolve("dist", "cjs", "package.json"), '{"type":"commonjs"}\n');
copyFileSync(resolve("dist", "types", "index.d.ts"), resolve("dist", "types", "index.d.mts"));
copyFileSync(resolve("dist", "types", "index.d.ts"), resolve("dist", "types", "index.d.cts"));

if (process.platform !== "win32") {
  chmodSync(resolve("dist", "esm", "cli.js"), 0o755);
}
