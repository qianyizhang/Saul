#!/usr/bin/env node
import { TOOLS } from './protocol.mjs';
import { callTool } from './client.mjs';

const [command, json, ...extra] = process.argv.slice(2);
if (!command || ['help', '--help', '-h'].includes(command)) {
  console.log(
    `Saul tab bridge\n\nUsage: node native/cli.mjs <command> '[JSON arguments]'\n\nCommands: sessions, list, sort, group, ungroup, move, groups-update, tools\n\nExamples:\n  node native/cli.mjs list\n  node native/cli.mjs sort '{"windowId":123,"by":"domain"}'\n  node native/cli.mjs group '{"tabIds":[12,34],"title":"Research","dryRun":false}'\n\nMutations preview by default. Set dryRun:false to apply. Use tools for schemas.`,
  );
} else {
  try {
    if (extra.length) throw new Error('Pass arguments as a single JSON object');
    const aliases = {
      sessions: 'saul_sessions',
      list: 'saul_tabs_list',
      sort: 'saul_tabs_sort',
      group: 'saul_tabs_group',
      ungroup: 'saul_tabs_ungroup',
      move: 'saul_tabs_move',
      'groups-update': 'saul_groups_update',
    };
    const result =
      command === 'tools'
        ? TOOLS
        : await callTool(aliases[command] ?? command, json === undefined ? {} : JSON.parse(json));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  }
}
