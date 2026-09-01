#!/usr/bin/env node

import * as fs from "node:fs";

import { readFileSync } from "node:fs";

import { evaluate, TcsonError } from "./index.js";

const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

const ROOT_HELP = `TcSON — deterministic TypeScript configuration

Usage:
  tcson
  tcson --help
  tcson help
  tcson --version
  tcson eval <file.tcson>

Commands:
  eval    Evaluate a .tcson file as canonical JSON
`;

const EVAL_HELP = `Usage: tcson eval <file.tcson>

Evaluate a .tcson configuration file and print the JSON result to stdout.
`;

function write(stream: 1 | 2, text: string | Uint8Array): void {
  fs.writeFileSync(stream, text);
}

function usageError(message: string): number {
  write(2, `[ERROR] ${message}\n`);
  return 1;
}

function formatFailure(error: unknown): void {
  if (error instanceof TcsonError) {
    if (error.code === "TCSON_COMPILE_ERROR" && error.diagnostics.length > 0) {
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
  const command = args[0];
  if (
    args.length === 0 ||
    (args.length === 1 && ["--help", "-h", "help"].includes(command ?? ""))
  ) {
    write(1, ROOT_HELP);
    return 0;
  }

  if (args.length === 1 && command === "--version") {
    write(1, `tcson ${version}\n`);
    return 0;
  }

  if (command !== "eval") {
    return usageError(
      command?.startsWith("-") ? `Unknown flag: ${command}` : `Unknown command: ${command}`,
    );
  }

  const operands = args.slice(1);
  if (operands.length === 1 && ["--help", "-h"].includes(operands[0] ?? "")) {
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
    const bytes = evaluate(operands[0] ?? "");
    write(1, bytes);
    write(1, "\n");
    return 0;
  } catch (error) {
    formatFailure(error);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
