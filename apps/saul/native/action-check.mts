import ts from 'typescript';
import { type ActionModule, validateActionModule } from './action-protocol.mts';

// Parsing and compilation only. This function must NEVER import or evaluate the candidate.
export function checkAction(value: unknown): { module: ActionModule; javascript: string } {
  validateActionModule(value);
  const module = value;
  const file = ts.createSourceFile('action.ts', module.source, ts.ScriptTarget.ES2022, true);
  let defaults = 0;
  const forbidden = new Set([
    'require',
    'process',
    'global',
    'globalThis',
    'eval',
    'Function',
    'fetch',
    'WebSocket',
    'XMLHttpRequest',
    'chrome',
    'browser',
    'Deno',
    'Bun',
  ]);
  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      node.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node) && forbidden.has(node.text))
    )
      throw new Error(
        'Actions use only ctx.source, ctx.generate, ctx.progress and ctx.signal. Imports, direct network, shell and browser access are outside contract 1.',
      );
    if (
      ts.isExportAssignment(node) ||
      (ts.canHaveModifiers(node) &&
        ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword))
    )
      defaults++;
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (defaults !== 1) throw new Error('Export exactly one default run(ctx) function.');
  const compiled = ts.transpileModule(module.source, {
    fileName: module.language === 'typescript' ? 'action.ts' : 'action.js',
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      isolatedModules: true,
    },
  });
  const errors = compiled.diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors?.length)
    throw new Error(ts.flattenDiagnosticMessageText(errors[0]!.messageText, '\n'));
  return { module, javascript: compiled.outputText };
}
