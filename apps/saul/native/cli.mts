import { addAbortSignal, type Readable } from 'node:stream';
import { parseArgs } from 'node:util';
import packageInfo from '../package.json' with { type: 'json' };
import { isRecord } from '../shared/model/value.mts';
import { MAX_MESSAGE } from '../shared/protocol/native-messaging.mts';
import {
  CLI_COMMANDS,
  TOOL_OPERATIONS,
  TOOLS,
  validateCall,
  type ToolName,
} from '../shared/protocol/protocol.mts';
import { callToolFromInput, MultipleBrowserSessionsError } from './client.mts';
import { errorMessage } from './transport.mts';

export interface CliIO {
  callTool: (name: ToolName, args: unknown) => Promise<unknown>;
  readStdin: () => Promise<string>;
  env: NodeJS.ProcessEnv;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const toolsByName = new Map(TOOLS.map((tool) => [tool.name, tool]));
const catalog = Object.entries(CLI_COMMANDS).map(([command, name]) => ({
  ...toolsByName.get(name)!,
  command,
  access: TOOL_OPERATIONS[name].access,
}));
type CliTool = (typeof catalog)[number];

const paths = catalog
  .map((tool) => ({ tool, tokens: tool.command.split(' ') }))
  .sort((a, b) => b.tokens.length - a.tokens.length);

const sectionTitles = new Map<string, string>([
  ['sessions', 'Connection'],
  ['tabs', 'Tabs'],
  ['groups', 'Groups'],
  ['windows', 'Windows'],
  ['page', 'Pages'],
  ['history', 'History'],
  ['annotations', 'Annotations'],
]);

const accessHelp = {
  discovery: 'Lists bridge sessions without reading browser content.',
  'tabs-read': 'Requires Local tool access.',
  'tabs-preview': 'Preview with Tabs Read. Applying requires Organize tabs and windows.',
  'pages-read': 'Requires Pages Read or Write.',
  'pages-preview': 'Preview with Pages Read. Applying requires Pages Write.',
  'history-read': 'Requires History Read in Local tool access.',
  annotations:
    'List or read with Annotations Read. Create or change immediately with Annotations Write.',
};

function matchCommand(positionals: string[]) {
  return paths.find(({ tokens }) => tokens.every((token, index) => token === positionals[index]));
}

function commandsIn(group: string) {
  return catalog.filter(({ command }) => command.startsWith(group + ' '));
}

function supportsApply(tool: CliTool) {
  return tool.access.endsWith('-preview');
}

function shorthand(tool: CliTool) {
  const definition = TOOL_OPERATIONS[tool.name];
  return 'cliShorthand' in definition ? definition.cliShorthand : undefined;
}

function overview() {
  const nouns = new Set([
    ...sectionTitles.keys(),
    ...catalog.map(({ command }) => command.split(' ')[0]!),
  ]);
  return [
    'Saul local browser tools',
    'Usage: saul <command> [arguments]',
    ...Array.from(nouns).flatMap((noun) => {
      const entries = catalog.filter(
        ({ command }) => command === noun || command.startsWith(noun + ' '),
      );
      const title = sectionTitles.get(noun) ?? noun.charAt(0).toUpperCase() + noun.slice(1);
      return entries.length
        ? [`${title}\n  ${entries.map(({ command }) => command).join(', ')}`]
        : [];
    }),
    'Help and schemas\n  help [group | command], tools',
    [
      'Options',
      '  --session <id>  Select a browser session. Defaults to SAUL_SESSION when supported.',
      '  --apply         Apply a tab or page change with Write access.',
      '  --json <object> Pass arguments as JSON.',
      '  -               Read a JSON object from stdin.',
      '  --compact       Write JSON on one line.',
      '  -h, --help      Show help.',
      '  -V, --version   Show the Saul version.',
    ].join('\n'),
    [
      'Examples',
      '  saul sessions',
      '  saul tabs sort \'{"windowId":123,"by":"domain"}\'',
      '  saul history search "gradient"',
    ].join('\n'),
    'Tab and page changes preview by default. Review visual tab organization in the Tab Board. Annotation writes apply immediately.',
  ].join('\n\n');
}

function helpFor(positionals: string[]) {
  if (!positionals.length) return overview();
  const [group] = positionals;
  if (positionals.length === 1) {
    if (group === 'tools')
      return 'Usage: saul tools [--compact]\n\nPrint the public command catalog as JSON.';
    if (group === 'help') return 'Usage: saul help [group | command]';
    const entries = commandsIn(group!);
    if (entries.length) {
      return [
        `Usage: saul ${group} <command> [arguments]`,
        ...entries.map(
          ({ command, access, description }) => `  ${command} [${access}]\n    ${description}`,
        ),
      ].join('\n\n');
    }
  }
  const match = matchCommand(positionals);
  if (!match || match.tokens.length !== positionals.length)
    throw new Error(`Unknown command or help topic: ${positionals.join(' ')}.`);
  const { tool } = match;
  const literal = shorthand(tool);
  const input = literal ? `<${literal}>` : "'<JSON object>'";
  return [
    `Usage: saul ${tool.command} [${input} | --json '<JSON object>' | -]`,
    '',
    tool.description,
    `Access: ${tool.access}. ${accessHelp[tool.access]}`,
    ...(supportsApply(tool) ? ['Use --apply or set dryRun to false in JSON to apply.'] : []),
    ...(literal
      ? ['Positional input is literal. Use -- before a literal that starts with a dash.']
      : []),
    ...(Object.hasOwn(tool.inputSchema.properties, 'session')
      ? ['Select a session with --session <id>, JSON session, or SAUL_SESSION.']
      : []),
    '',
    'Arguments',
    JSON.stringify(tool.inputSchema, null, 2),
  ].join('\n');
}

export async function readCliStdin(input: Readable, deadline = AbortSignal.timeout(10_000)) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const chunk of addAbortSignal(deadline, input)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_MESSAGE) throw new Error('Stdin JSON exceeds 1 MiB.');
      chunks.push(buffer);
    }
  } catch (error) {
    if (deadline.aborted) throw new Error('Timed out waiting for EOF on stdin.', { cause: error });
    throw error;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes));
  } catch {
    throw new Error('Stdin must contain valid UTF-8.');
  }
}

function parseObject(json: string) {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON. Pass a single JSON object.');
  }
  if (!isRecord(value)) throw new Error('Pass a JSON object.');
  return value;
}

async function toolArguments(
  tool: CliTool,
  positionals: string[],
  options: { json?: string; session?: string; apply?: boolean },
  io: CliIO,
) {
  const { json, session, apply } = options;
  const [argument] = positionals;
  if (positionals.length > 1 || (argument !== undefined && json !== undefined))
    throw new Error('Pass arguments as a single positional value, --json, or - for stdin.');

  const acceptsSession = Object.hasOwn(tool.inputSchema.properties, 'session');
  if (session !== undefined && !acceptsSession)
    throw new Error(`--session is not supported on ${tool.command}.`);
  if (apply && !supportsApply(tool))
    throw new Error('--apply is only supported on preview commands.');

  const literal = shorthand(tool);
  let args: Record<string, unknown> = {};
  if (json !== undefined) args = parseObject(json);
  else if (argument === '-') args = parseObject(await io.readStdin());
  else if (argument !== undefined) args = literal ? { [literal]: argument } : parseObject(argument);

  if (session !== undefined && Object.hasOwn(args, 'session'))
    throw new Error('Pass session either via --session or in the JSON payload, not both.');
  if (apply && Object.hasOwn(args, 'dryRun'))
    throw new Error('Pass either --apply or dryRun in the JSON payload, not both.');

  const defaultSession = session ?? io.env.SAUL_SESSION;
  if (acceptsSession && !Object.hasOwn(args, 'session') && defaultSession !== undefined)
    args.session = defaultSession;
  if (apply) args.dryRun = false;
  return validateCall(tool.name, args);
}

export async function runCli(argv: string[], overrides: Partial<CliIO> = {}): Promise<number> {
  const io: CliIO = {
    callTool: callToolFromInput,
    readStdin: () => readCliStdin(process.stdin),
    env: process.env,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    ...overrides,
  };
  const print = (text: string) => io.stdout(text + '\n');
  let hint = 'Run saul help.';
  let tool: CliTool;
  let args: unknown;
  let indent: number;
  try {
    const { positionals, values } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        session: { type: 'string', multiple: true },
        apply: { type: 'boolean' },
        json: { type: 'string', multiple: true },
        compact: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'V' },
      },
    });
    const [first] = positionals;
    const match = matchCommand(positionals);
    if (match) hint = `Run saul help ${match.tool.command}.`;
    if ((values.session?.length ?? 0) > 1) throw new Error('Pass --session only once.');
    if ((values.json?.length ?? 0) > 1) throw new Error('Pass --json only once.');
    const session = values.session?.[0];
    const json = values.json?.[0];
    indent = values.compact ? 0 : 2;

    if (values.help || values.version || !match) {
      if (session !== undefined || values.apply || json !== undefined)
        throw new Error('--session, --apply, and --json require a tool command.');
      if (values.version) print(`saul ${packageInfo.version}`);
      else if (first === 'help') print(helpFor(positionals.slice(1)));
      else if (values.help || !first || (positionals.length === 1 && commandsIn(first).length))
        print(helpFor(positionals));
      else if (first === 'tools' && positionals.length === 1)
        print(JSON.stringify(catalog, null, indent));
      else throw new Error(`Unknown command: ${positionals.join(' ')}.`);
      return 0;
    }

    tool = match.tool;
    args = await toolArguments(
      tool,
      positionals.slice(match.tokens.length),
      { session, json, apply: values.apply },
      io,
    );
  } catch (error) {
    io.stderr(JSON.stringify({ error: errorMessage(error), hint }) + '\n');
    return 2;
  }

  try {
    print(JSON.stringify(await io.callTool(tool.name, args), null, indent));
    return 0;
  } catch (error) {
    const message =
      error instanceof MultipleBrowserSessionsError
        ? 'Multiple browsers/profiles connected. Run saul sessions and pass --session <id> (or set SAUL_SESSION).'
        : errorMessage(error);
    io.stderr(JSON.stringify({ error: message }) + '\n');
    return 1;
  }
}
