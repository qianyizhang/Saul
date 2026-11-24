#!/usr/bin/env node
import { CLI_COMMANDS, TOOL_OPERATIONS, TOOLS } from '../shared/protocol/protocol.mts';
import { callTool } from './client.mts';
import { errorMessage } from './transport.mts';

const helpFlags = ['help', '--help', '-h'];
const sections = [
  { name: 'Connection', policy: 'discovery' },
  { name: 'Tabs', policy: 'tabs-' },
  { name: 'Pages', policy: 'pages-' },
  { name: 'Annotations', policy: 'annotations' },
];

function publicCommand(command: string) {
  const name = Object.hasOwn(CLI_COMMANDS, command) ? CLI_COMMANDS[command] : command;
  return TOOLS.find((tool) => tool.name === name);
}

const accessHelp = {
  discovery: 'Lists bridge sessions. No browser content is read.',
  'tabs-read': 'Requires Local tool access.',
  'tabs-preview': 'Preview with Tabs Read. Apply with Organize tabs and windows and dryRun:false.',
  'pages-read': 'Requires Pages Read or Write.',
  'pages-preview': 'Preview with Pages Read. Apply with Pages Write and dryRun:false.',
  annotations: 'List or read with Annotations Read. Create or change with Annotations Write.',
};

function commandHelp(command: string) {
  const tool = publicCommand(command);
  if (command === 'tools') return 'Usage: saul tools\n\nPrint the public command schemas as JSON.';
  if (!tool) throw new Error(`Unknown command: ${command}. Run saul help.`);
  const definition = TOOL_OPERATIONS[tool.name];
  const section = sections.find(({ policy }) => definition.access.startsWith(policy))?.name;
  return [
    `Usage: saul ${definition.command} '[JSON arguments]'`,
    '',
    section,
    tool.description,
    ...(definition.access in accessHelp
      ? [accessHelp[definition.access as keyof typeof accessHelp]]
      : []),
    '',
    'Arguments',
    JSON.stringify(tool.inputSchema, null, 2),
  ].join('\n');
}

function overview() {
  const groups = sections.map(({ name, policy }) => {
    const commands = Object.entries(CLI_COMMANDS)
      .filter(([, tool]) => TOOL_OPERATIONS[tool].access.startsWith(policy))
      .sort(
        ([, a], [, b]) => Number(TOOL_OPERATIONS[b].readOnly) - Number(TOOL_OPERATIONS[a].readOnly),
      )
      .map(([command]) => command);
    return `${name}\n  ${commands.join(', ')}`;
  });
  return [
    'Saul local browser tools',
    "Usage: saul <command> '[JSON arguments]'",
    ...groups,
    'Help and schemas\n  help [command], tools',
    'Start with saul sessions and saul list. With multiple profiles, pass session in the JSON.',
    `Example preview
  saul sort '{"windowId":123,"by":"domain"}'`,
    'Tabs Read comes with Local tool access. Organize tabs and windows enables applying changes.',
    'Pages and Annotations use Off, Read or Write.',
    'Tab and page changes preview by default. Use dryRun:false to apply with Write.',
    'Annotation writes apply immediately. Use command help for details.',
  ].join('\n\n');
}

const [command, json, ...extra] = process.argv.slice(2);
try {
  if (extra.length) throw new Error('Pass arguments as a single JSON object');
  if (!command || helpFlags.includes(command)) console.log(json ? commandHelp(json) : overview());
  else if (json && helpFlags.includes(json)) console.log(commandHelp(command));
  else if (command === 'tools') console.log(JSON.stringify(TOOLS, null, 2));
  else {
    const tool = publicCommand(command);
    if (!tool) throw new Error(`Unknown command: ${command}. Run saul help.`);
    const result = await callTool(tool.name, json === undefined ? {} : JSON.parse(json));
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ error: errorMessage(error) }));
  process.exitCode = 1;
}
