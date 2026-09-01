#!/usr/bin/env node

import * as fs from "node:fs";

import { eval as evaluate, TysonError } from "./index";

const ROOT_HELP = `TcSON — a TySON-compatible TypeScript configuration language evaluator

Usage:
  tcson
  tcson --help
  tcson help
  tcson eval <file.tson>

Commands:
  eval    Evaluate a .tson file as canonical JSON
`;

const EVAL_HELP = `Usage: tcson eval <file.tson>

Evaluate a .tson configuration file and print the JSON result to stdout.
`;

function write(stream: 1 | 2, text: string | Uint8Array): void {
  fs.writeFileSync(stream, text);
}

function usageError(message: string): number {
  write(2, `[ERROR] ${message}\n`);
  return 1;
}

function formatFailure(error: unknown): void {
  if (error instanceof TysonError) {
    if (error.code === "TYSON_COMPILE_ERROR" && error.diagnostics.length > 0) {
      for (const diagnostic of error.diagnostics) {
        const location = diagnostic.file
          ? `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}${diagnostic.column ? `:${diagnostic.column}` : ""}` : ""}: `
          : "";
        write(2, `ERROR ${location}${diagnostic.message}\n`);
      }
      return;
    }
    write(2, `[ERROR] ${error.message}\n`);
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  write(2, `[ERROR] ${message}\n`);
}

function main(args: readonly string[]): number {
  if (args.length === 0 || (args.length === 1 && ["--help", "-h", "help"].includes(args[0]!))) {
    write(1, ROOT_HELP);
    return 0;
  }

  if (args[0] !== "eval") {
    return usageError(args[0]!.startsWith("-")
      ? `Unknown flag: ${args[0]}`
      : `Unknown command: ${args[0]}`);
  }

  const operands = args.slice(1);
  if (operands.length === 1 && ["--help", "-h"].includes(operands[0]!)) {
    write(1, EVAL_HELP);
    return 0;
  }
  if (operands.some((operand) => operand.startsWith("-"))) {
    return usageError(`Unknown flag: ${operands.find((operand) => operand.startsWith("-"))}`);
  }
  if (operands.length !== 1) {
    return usageError(`eval requires exactly one argument; received ${operands.length}`);
  }

  try {
    const bytes = evaluate(operands[0]!);
    write(1, Buffer.concat([Buffer.from(bytes), Buffer.from("\n")]));
    return 0;
  } catch (error) {
    formatFailure(error);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
