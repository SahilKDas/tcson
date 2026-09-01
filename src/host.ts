import * as fs from "node:fs";
import * as path from "node:path";
import { types } from "node:util";
import * as vm from "node:vm";

export interface HostStat {
  isFile(): boolean;
}

export interface HostScript {
  runInContext(context: object): unknown;
}

export interface HostAdapter {
  cwd(): string;
  resolve(...segments: string[]): string;
  dirname(file: string): string;
  basename(file: string): string;
  stat(file: string): HostStat;
  readFile(file: string): Uint8Array;
  isProxy(value: object): boolean;
  createContext(): object;
  createScript(source: string, filename: string): HostScript;
}

export const host: HostAdapter = {
  cwd: () => process.cwd(),
  resolve: (...segments) => path.resolve(...segments),
  dirname: (file) => path.dirname(file),
  basename: (file) => path.basename(file),
  stat: (file) => fs.statSync(file),
  readFile: (file) => fs.readFileSync(file),
  isProxy: (value) => types.isProxy(value),
  createContext: () =>
    vm.createContext(Object.create(null) as object, {
      name: "tcson-evaluation",
      codeGeneration: { strings: false, wasm: false },
    }),
  createScript: (source, filename) => {
    const script = new vm.Script(source, { filename });
    return {
      runInContext: (context) => script.runInContext(context as vm.Context),
    };
  },
};
