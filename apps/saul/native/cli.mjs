#!/usr/bin/env node
import { CLI_COMMANDS, TOOLS } from './protocol.mjs';
import { callTool } from './client.mjs';
import { errorMessage } from './transport.mjs';

const [command, json, ...extra] = process.argv.slice(2);
if (!command || ['help', '--help', '-h'].includes(command)) {
  const commands = [...Object.keys(CLI_COMMANDS), 'tools'].join(', ');
  console.log(
    `Saul tab bridge\n\nUsage: node native/cli.mjs <command> '[JSON arguments]'\n\nCommands: ${commands}\n\nExamples:\n  node native/cli.mjs list\n  node native/cli.mjs sort '{"windowId":123,"by":"domain"}'\n  node native/cli.mjs group '{"tabIds":[12,34],"title":"Research","dryRun":false}'\n\nMutations preview by default. Set dryRun:false to apply. Use tools for schemas.`,
  );
} else {
  try {
    if (extra.length) throw new Error('Pass arguments as a single JSON object');
    const name = Object.hasOwn(CLI_COMMANDS, command) ? CLI_COMMANDS[command] : command;
    const result =
      command === 'tools'
        ? TOOLS
        : await callTool(name, json === undefined ? {} : JSON.parse(json));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: errorMessage(error) }));
    process.exitCode = 1;
  }
}
