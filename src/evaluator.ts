import * as fs from "node:fs";
import * as path from "node:path";
import * as vm from "node:vm";
import ts from "typescript";

import {
  TysonError,
  type TysonDiagnostic,
  readableThrown,
} from "./errors";

interface CompiledModule {
  readonly file: string;
  readonly javascript: string;
  readonly imports: ReadonlyMap<string, string>;
}

interface ParsedModule {
  readonly file: string;
  readonly source: string;
  readonly sourceFile: ts.SourceFile;
  readonly compileSource: string;
  readonly imports: Map<string, string>;
  readonly hasSelectedResult: boolean;
}

interface MutableDiagnostic extends TysonDiagnostic {
  message: string;
  file?: string;
  line?: number;
  column?: number;
  length?: number;
}

type SourceFileWithDiagnostics = ts.SourceFile & {
  readonly parseDiagnostics: readonly ts.DiagnosticWithLocation[];
};

const decoder = new TextDecoder("utf-8", { fatal: true });

function makeDiagnostic(
  message: string,
  sourceFile?: ts.SourceFile,
  start?: number,
  length?: number,
): TysonDiagnostic {
  const diagnostic: MutableDiagnostic = { message };
  if (sourceFile) {
    diagnostic.file = sourceFile.fileName;
    if (start !== undefined) {
      const location = sourceFile.getLineAndCharacterOfPosition(start);
      diagnostic.line = location.line + 1;
      diagnostic.column = location.character + 1;
    }
  }
  if (length !== undefined) {
    diagnostic.length = length;
  }
  return diagnostic;
}

function fromTypescriptDiagnostic(diagnostic: ts.Diagnostic): TysonDiagnostic {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  return makeDiagnostic(
    message,
    diagnostic.file,
    diagnostic.start,
    diagnostic.length,
  );
}

function throwCompile(diagnostics: readonly TysonDiagnostic[]): never {
  const sorted = [...diagnostics].sort((left, right) => {
    const fileOrder = (left.file ?? "").localeCompare(right.file ?? "");
    if (fileOrder !== 0) return fileOrder;
    const lineOrder = (left.line ?? 0) - (right.line ?? 0);
    if (lineOrder !== 0) return lineOrder;
    return (left.column ?? 0) - (right.column ?? 0);
  });
  const message = sorted[0]?.message ?? "compile failed";
  throw new TysonError("TYSON_COMPILE_ERROR", `Compile failed: ${message}`, sorted);
}

function parseSource(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function hasExportSyntax(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some((statement) => {
    if (ts.isExportAssignment(statement) || ts.isExportDeclaration(statement)) {
      return true;
    }
    const modifiers = ts.canHaveModifiers(statement)
      ? ts.getModifiers(statement)
      : undefined;
    return modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  });
}

function hasExplicitDefault(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some((statement) => {
    if (ts.isExportAssignment(statement)) {
      return !statement.isExportEquals;
    }
    const modifiers = ts.canHaveModifiers(statement)
      ? ts.getModifiers(statement)
      : undefined;
    const kinds = new Set(modifiers?.map((modifier) => modifier.kind));
    return kinds.has(ts.SyntaxKind.ExportKeyword) && kinds.has(ts.SyntaxKind.DefaultKeyword);
  });
}

function implicitObjectSource(file: string, source: string): string | undefined {
  const prefix = "const __tcson_result = (";
  const wrapped = `${prefix}${source}\n);`;
  const wrappedFile = parseSource(file, wrapped) as SourceFileWithDiagnostics;
  if (wrappedFile.parseDiagnostics.length !== 0 || wrappedFile.statements.length !== 1) {
    return undefined;
  }

  const statement = wrappedFile.statements[0];
  if (!statement || !ts.isVariableStatement(statement)) {
    return undefined;
  }
  const declaration = statement.declarationList.declarations[0];
  const initializer = declaration?.initializer;
  if (!initializer || !ts.isParenthesizedExpression(initializer)) {
    return undefined;
  }
  if (!ts.isObjectLiteralExpression(initializer.expression)) {
    return undefined;
  }

  return `export default (${source}\n);`;
}

function readUtf8(file: string, entry: boolean, importSpecifier?: string, importer?: string): string {
  let bytes: Buffer;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) {
      throw new Error("path does not name a regular file");
    }
    bytes = fs.readFileSync(file);
  } catch (cause) {
    if (!entry) {
      throw new TysonError(
        "TYSON_IMPORT_NOT_FOUND",
        `Cannot read import ${JSON.stringify(importSpecifier)} from ${importer}: ${readableThrown(cause)}`,
        [],
        cause,
      );
    }

    const hostCode = (cause as NodeJS.ErrnoException | undefined)?.code;
    if (hostCode === "ENOENT") {
      throw new TysonError(
        "TYSON_FILE_NOT_FOUND",
        `File not found: ${importSpecifier ?? file}`,
        [],
        cause,
      );
    }
    throw new TysonError(
      "TYSON_IO_ERROR",
      `Cannot read path ${importSpecifier ?? file}: ${readableThrown(cause)}`,
      [],
      cause,
    );
  }

  try {
    return decoder.decode(bytes);
  } catch (cause) {
    throwCompile([
      makeDiagnostic("File is not valid UTF-8", parseSource(file, ""), 0),
    ]);
  }
}

function validateAndCollectImports(module: ParsedModule): string[] {
  const dependencies: string[] = [];
  const diagnostics: TysonDiagnostic[] = [];

  const reject = (node: ts.Node, message: string): void => {
    diagnostics.push(makeDiagnostic(message, module.sourceFile, node.getStart(module.sourceFile), node.getWidth(module.sourceFile)));
  };

  const visit = (node: ts.Node): void => {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
      reject(node, "async functions are not supported");
    }
    if (ts.canHaveDecorators(node) && (ts.getDecorators(node)?.length ?? 0) > 0) {
      reject(node, "decorators are not supported");
    }
    if (ts.isAwaitExpression(node)) {
      reject(node, "await is not supported");
    }
    const isGenerator =
      (ts.isFunctionDeclaration(node)
        || ts.isFunctionExpression(node)
        || ts.isMethodDeclaration(node))
      && node.asteriskToken !== undefined;
    if (ts.isYieldExpression(node) || isGenerator) {
      reject(node, "generator functions are not supported");
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        reject(node, "dynamic import() is not supported");
      }
    }
    if (ts.isIdentifier(node) && ["arguments", "exports", "require"].includes(node.text)) {
      const parent = node.parent;
      const isPropertyName =
        (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent))
          && parent.name === node
        || (ts.isPropertySignature(parent) && parent.name === node)
        || (ts.isPropertyAccessExpression(parent) && parent.name === node);
      if (!isPropertyName) {
        reject(node, `the host-specific ${node.text} binding is not available`);
      }
    }
    if (ts.isImportDeclaration(node)) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) {
        reject(node, "import specifier must be a string literal");
      } else {
        const specifier = node.moduleSpecifier.text;
        const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
        if (!isRelative || !specifier.endsWith(".tson")) {
          reject(node, `only relative imports with a lowercase .tson suffix are supported: ${specifier}`);
        } else if (
          !node.importClause
          || node.importClause.isTypeOnly
          || !node.importClause.name
          || node.importClause.namedBindings
        ) {
          reject(node, "only relative default imports are supported");
        } else {
          const resolved = path.resolve(path.dirname(module.file), specifier);
          module.imports.set(specifier, resolved);
          dependencies.push(resolved);
        }
      }
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      reject(node, "re-exports from another module are not supported");
    }
    if (ts.isExportAssignment(node) && node.isExportEquals) {
      reject(node, "export = is not supported; use export default");
    }
    ts.forEachChild(node, visit);
  };

  visit(module.sourceFile);
  if (diagnostics.length > 0) {
    throwCompile(diagnostics);
  }
  return dependencies;
}

function transpile(module: ParsedModule): CompiledModule {
  const result = ts.transpileModule(module.compileSource, {
    fileName: module.file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2015,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      newLine: ts.NewLineKind.LineFeed,
      sourceMap: false,
      inlineSourceMap: false,
      inlineSources: false,
      removeComments: false,
    },
  });
  const errors = (result.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map(fromTypescriptDiagnostic);
  if (errors.length > 0) {
    throwCompile(errors);
  }
  return {
    file: module.file,
    javascript: result.outputText,
    imports: module.imports,
  };
}

function buildGraph(entryFile: string, entryDisplayPath: string): Map<string, CompiledModule> {
  const parsed = new Map<string, ParsedModule>();
  const compiled = new Map<string, CompiledModule>();
  const active: string[] = [];

  const load = (file: string, entry: boolean, specifier?: string, importer?: string): void => {
    const cycleStart = active.indexOf(file);
    if (cycleStart !== -1) {
      const cycle = [...active.slice(cycleStart), file].map((item) => path.basename(item)).join(" -> ");
      throwCompile([makeDiagnostic(`Import cycle detected: ${cycle}`, parseSource(file, ""), 0)]);
    }
    if (parsed.has(file)) {
      return;
    }

    active.push(file);
    try {
      const source = readUtf8(file, entry, specifier, importer);
      const sourceFile = parseSource(file, source);
      const exportSyntax = hasExportSyntax(sourceFile);
      const implicit = exportSyntax ? undefined : implicitObjectSource(file, source);

      if (!implicit) {
        const parseDiagnostics = (sourceFile as SourceFileWithDiagnostics).parseDiagnostics;
        if (parseDiagnostics.length > 0) {
          throwCompile(parseDiagnostics.map(fromTypescriptDiagnostic));
        }
      }

      const module: ParsedModule = {
        file,
        source,
        sourceFile: implicit ? parseSource(file, implicit) : sourceFile,
        compileSource: implicit ?? source,
        imports: new Map<string, string>(),
        hasSelectedResult: implicit !== undefined || hasExplicitDefault(sourceFile),
      };
      const dependencies = validateAndCollectImports(module);
      parsed.set(file, module);
      for (const dependency of dependencies) {
        const dependencySpecifier = [...module.imports]
          .find(([, resolved]) => resolved === dependency)?.[0];
        load(dependency, false, dependencySpecifier, file);
      }
    } finally {
      active.pop();
    }
  };

  load(entryFile, true, entryDisplayPath);
  for (const module of parsed.values()) {
    compiled.set(module.file, transpile(module));
  }
  for (const module of parsed.values()) {
    if (!module.hasSelectedResult) {
      throw new TysonError(
        "TYSON_EXPORT_MISSING",
        `No eligible default export in ${module.file}`,
      );
    }
  }
  return compiled;
}

function executeGraph(entryFile: string, graph: ReadonlyMap<string, CompiledModule>): unknown {
  const context = vm.createContext(Object.create(null) as object, {
    name: "tcson-evaluation",
    codeGeneration: { strings: false, wasm: false },
  });
  const evaluated = new Map<string, Record<string, unknown>>();

  const execute = (file: string): Record<string, unknown> => {
    const cached = evaluated.get(file);
    if (cached) {
      return cached;
    }
    const compiled = graph.get(file);
    if (!compiled) {
      throw new Error(`Internal module graph error for ${file}`);
    }

    const exportsObject: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    evaluated.set(file, exportsObject);
    for (const dependency of compiled.imports.values()) {
      execute(dependency);
    }
    const localRequire = (specifier: string): Record<string, unknown> => {
      const resolved = compiled.imports.get(specifier);
      if (!resolved) {
        throw new Error(`Prohibited or unresolved import: ${specifier}`);
      }
      return execute(resolved);
    };

    const wrapper = `(function (exports, require) {\n${compiled.javascript}\n})`;
    const script = new vm.Script(wrapper, { filename: file });
    const run = script.runInContext(context) as (
      exports: Record<string, unknown>,
      require: (specifier: string) => Record<string, unknown>,
    ) => void;
    run(exportsObject, localRequire);
    return exportsObject;
  };

  try {
    const exportsObject = execute(entryFile);
    if (!Object.hasOwn(exportsObject, "default")) {
      throw new TysonError(
        "TYSON_EXPORT_MISSING",
        `No eligible default export in ${entryFile}`,
      );
    }
    return exportsObject.default;
  } catch (cause) {
    if (cause instanceof TysonError) {
      throw cause;
    }
    throw new TysonError(
      "TYSON_RUNTIME_ERROR",
      `Configuration runtime error: ${readableThrown(cause)}`,
      [],
      cause,
    );
  }
}

export function evaluateFile(inputPath: string): unknown {
  if (typeof inputPath !== "string" || inputPath.trim().length === 0) {
    throw new TysonError(
      "TYSON_INVALID_PATH",
      "Invalid path: expected a non-empty string",
    );
  }
  if (!inputPath.endsWith(".tson")) {
    throw new TysonError(
      "TYSON_INVALID_PATH",
      `Invalid path ${JSON.stringify(inputPath)}: expected a lowercase .tson suffix`,
    );
  }

  const entryFile = path.resolve(process.cwd(), inputPath);
  const graph = buildGraph(entryFile, inputPath);
  return executeGraph(entryFile, graph);
}
