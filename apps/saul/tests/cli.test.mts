import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { readCliStdin, runCli, type CliIO } from '../native/cli.mts';
import { MultipleBrowserSessionsError } from '../native/client.mts';
import packageInfo from '../package.json' with { type: 'json' };
import { MAX_MESSAGE } from '../shared/protocol/native-messaging.mts';
import { TOOL_OPERATIONS, TOOLS } from '../shared/protocol/protocol.mts';

const session = 'a'.repeat(16);
const otherSession = 'b'.repeat(16);

async function invoke(
  argv: string[],
  overrides: Partial<Pick<CliIO, 'callTool' | 'readStdin' | 'env'>> = {},
) {
  let stdout = '';
  let stderr = '';
  const callTool = vi.fn<CliIO['callTool']>(overrides.callTool ?? (async () => ({ ok: true })));
  const readStdin = vi.fn(overrides.readStdin ?? (async () => '{"windowId":7}'));
  const code = await runCli(argv, {
    callTool,
    readStdin,
    env: overrides.env ?? {},
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  return { code, stdout, stderr, callTool, readStdin };
}

describe('CLI help and discovery', () => {
  it.each([{ argv: [] }, { argv: ['help'] }, { argv: ['-h'] }])(
    'shows grouped overview for $argv',
    async ({ argv }) => {
      const result = await invoke(argv);
      expect(result).toMatchObject({ code: 0, stderr: '' });
      for (const heading of [
        'Connection',
        'Tabs',
        'Groups',
        'Windows',
        'Pages',
        'History',
        'Annotations',
      ]) {
        expect(result.stdout).toContain(`\n${heading}\n`);
      }
      expect(result.stdout).toContain('--apply');
      expect(result.callTool).not.toHaveBeenCalled();
      expect(result.readStdin).not.toHaveBeenCalled();
    },
  );

  it.each(['tabs', 'groups', 'windows', 'page', 'history'])(
    'shows group help for %s',
    async (group) => {
      const bare = await invoke([group]);
      const explicit = await invoke(['help', group]);
      expect(bare).toMatchObject({ code: 0, stdout: explicit.stdout, stderr: '' });
      expect(bare.stdout).toContain(`Usage: saul ${group} <command>`);
      expect(bare.stdout).toMatch(/\[(tabs|pages|history)-(read|preview)\]/);
      expect(bare.callTool).not.toHaveBeenCalled();
    },
  );

  it('shows accepted syntax, permissions, and the registry schema for a command', async () => {
    const result = await invoke(['--help', 'tabs', 'sort']);
    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(result.stdout).toContain(
      "Usage: saul tabs sort ['<JSON object>' | --json '<JSON object>' | -]",
    );
    expect(result.stdout).toContain('Access: tabs-preview');
    expect(result.stdout).toContain('--apply');
    expect(JSON.parse(result.stdout.split('\nArguments\n')[1]!)).toEqual(
      TOOLS.find((tool) => tool.name === 'saul_tabs_sort')?.inputSchema,
    );

    const history = await invoke(['help', 'history', 'search']);
    expect(history.stdout).toContain("<query> | --json '<JSON object>' | -");
    expect(history.stdout).not.toContain('--apply');

    const annotations = await invoke(['annotations', '-h']);
    expect(annotations.stdout).toContain('Operations: list/read/create/change');
    expect(annotations.stdout).toContain('Annotations Write');
  });

  it('reports the package version and emits a CLI-specific catalog without altering MCP schemas', async () => {
    for (const flag of ['-V', '--version']) {
      expect(await invoke([flag])).toMatchObject({
        code: 0,
        stdout: `saul ${packageInfo.version}\n`,
        stderr: '',
      });
    }
    const compact = await invoke(['tools', '--compact']);
    expect(compact).toMatchObject({ code: 0, stderr: '' });
    expect(compact.stdout.trimEnd()).not.toContain('\n');
    expect(JSON.parse(compact.stdout)).toEqual(
      TOOLS.map((tool) => ({
        ...tool,
        command: TOOL_OPERATIONS[tool.name].command,
        access: TOOL_OPERATIONS[tool.name].access,
      })),
    );
    for (const tool of TOOLS) {
      expect(tool).not.toHaveProperty('command');
      expect(tool).not.toHaveProperty('access');
    }
    expect(compact.callTool).not.toHaveBeenCalled();
  });
});

describe('CLI input and failures', () => {
  it('accepts options before, inside, and after a command and prints JSON', async () => {
    const result = await invoke([
      '--session',
      session,
      'tabs',
      '--compact',
      'list',
      '--json',
      '{"windowId":7}',
    ]);
    expect(result).toMatchObject({ code: 0, stdout: '{"ok":true}\n', stderr: '' });
    expect(result.callTool).toHaveBeenCalledWith('saul_tabs_list', { session, windowId: 7 });
    expect(result.readStdin).not.toHaveBeenCalled();
    expect(await invoke(['tabs', 'list'])).toMatchObject({ stdout: '{\n  "ok": true\n}\n' });
  });

  it('applies session precedence and ignores the environment for session discovery', async () => {
    const env = { SAUL_SESSION: session };
    const fallback = await invoke(['tabs', 'list'], { env });
    expect(fallback.callTool).toHaveBeenCalledWith('saul_tabs_list', { session });
    const flag = await invoke(['tabs', 'list', '--session', otherSession], { env });
    expect(flag.callTool).toHaveBeenCalledWith('saul_tabs_list', { session: otherSession });
    const payload = await invoke(['tabs', 'list', JSON.stringify({ session: otherSession })], {
      env,
    });
    expect(payload.callTool).toHaveBeenCalledWith('saul_tabs_list', { session: otherSession });
    const discovery = await invoke(['sessions'], { env });
    expect(discovery.callTool).toHaveBeenCalledWith('saul_sessions', {});
  });

  it('only reads stdin when requested and translates --apply for preview tools', async () => {
    const preview = await invoke(['tabs', 'sort', '{"windowId":7,"by":"domain"}']);
    expect(preview.callTool).toHaveBeenCalledWith('saul_tabs_sort', { windowId: 7, by: 'domain' });
    expect(preview.readStdin).not.toHaveBeenCalled();

    const apply = await invoke(['tabs', 'sort', '--apply', '-'], {
      readStdin: async () => '{"windowId":7,"by":"domain"}',
    });
    expect(apply).toMatchObject({ code: 0, stderr: '' });
    expect(apply.readStdin).toHaveBeenCalledOnce();
    expect(apply.callTool).toHaveBeenCalledWith('saul_tabs_sort', {
      windowId: 7,
      by: 'domain',
      dryRun: false,
    });
  });

  it('treats History positionals as literal and accepts structured History input explicitly', async () => {
    const search = await invoke(['history', 'search', '{"query":"literal"}']);
    expect(search.callTool).toHaveBeenCalledWith('saul_history_search', {
      query: '{"query":"literal"}',
    });
    const read = await invoke(['history', 'read', '{record}']);
    expect(read.callTool).toHaveBeenCalledWith('saul_history_read', { id: '{record}' });
    const leadingDash = await invoke(['history', 'search', '--', '--help']);
    expect(leadingDash.callTool).toHaveBeenCalledWith('saul_history_search', { query: '--help' });
    const json = await invoke(['history', 'search', '--json', '{"query":"gradient","limit":10}']);
    expect(json.callTool).toHaveBeenCalledWith('saul_history_search', {
      query: 'gradient',
      limit: 10,
    });
    const stdin = await invoke(['history', 'read', '-'], {
      readStdin: async () => '{"id":"record","textCursor":"next"}',
    });
    expect(stdin.callTool).toHaveBeenCalledWith('saul_history_read', {
      id: 'record',
      textCursor: 'next',
    });
  });

  it.each([
    [['list'], 'Unknown command'],
    [['groups-update'], 'Unknown command'],
    [['saul_tabs_list'], 'Unknown command'],
    [['saul_tabs_edit'], 'Unknown command'],
    [['tabs list'], 'Unknown command'],
    [['tabs', 'missing'], 'Unknown command'],
    [['help', 'list'], 'Unknown command'],
    [['tabs', 'list', '--unknown'], 'Unknown option'],
    [['tabs', 'list', '--session'], 'argument missing'],
    [['sessions', '--session', session], '--session is not supported'],
    [['sessions', '--apply'], '--apply is only supported'],
    [['annotations', '--apply'], '--apply is only supported'],
    [['tabs', 'sort', '--apply', '{"dryRun":false}'], 'either --apply or dryRun'],
    [['tabs', 'list', '--session', session, JSON.stringify({ session })], 'either via --session'],
    [['tabs', 'list', '--session', session, '--session', session], 'Pass --session only once'],
    [['tabs', 'list', '--json', '{}', '--json', '{}'], 'Pass --json only once'],
    [['tabs', 'list', '-', '--json', '{}'], 'single positional value'],
    [['history', 'search', 'literal', '--json', '{"query":"gradient"}'], 'single positional value'],
    [['history', 'read', 'id', '-'], 'single positional value'],
    [['tabs', 'list', '{'], 'Invalid JSON'],
    [['tabs', 'list', '[]'], 'Pass a JSON object'],
    [['tabs', 'list', 'null'], 'Pass a JSON object'],
    [['tabs', 'list', '"text"'], 'Pass a JSON object'],
    [['tabs', 'list', '123'], 'Pass a JSON object'],
    [['tabs', 'list', '{"windowId":"7"}'], 'windowId'],
    [['history', 'search'], 'query'],
  ])('returns usage exit 2 for %j', async (argv, message) => {
    const result = await invoke(argv);
    expect(result).toMatchObject({ code: 2, stdout: '' });
    expect(JSON.parse(result.stderr)).toEqual({
      error: expect.stringContaining(message),
      hint: expect.stringMatching(/^Run saul help/),
    });
    expect(result.callTool).not.toHaveBeenCalled();
    expect(result.readStdin).not.toHaveBeenCalled();
  });

  it('exposes stdin failure as usage and client failures as runtime errors', async () => {
    const stdin = await invoke(['tabs', 'list', '-'], {
      readStdin: async () => {
        throw new Error('Timed out waiting for EOF on stdin.');
      },
    });
    expect(stdin).toMatchObject({ code: 2, stdout: '' });
    expect(JSON.parse(stdin.stderr)).toEqual({
      error: 'Timed out waiting for EOF on stdin.',
      hint: 'Run saul help tabs list.',
    });
    expect(stdin.callTool).not.toHaveBeenCalled();

    const runtime = await invoke(['tabs', 'list'], {
      callTool: async () => {
        throw new Error('Bridge disconnected');
      },
    });
    expect(runtime).toMatchObject({ code: 1, stdout: '' });
    expect(JSON.parse(runtime.stderr)).toEqual({ error: 'Bridge disconnected' });

    const ambiguous = await invoke(['tabs', 'list'], {
      callTool: async () => {
        throw new MultipleBrowserSessionsError();
      },
    });
    expect(ambiguous).toMatchObject({ code: 1, stdout: '' });
    expect(JSON.parse(ambiguous.stderr)).toEqual({
      error:
        'Multiple browsers/profiles connected. Run saul sessions and pass --session <id> (or set SAUL_SESSION).',
    });
  });
});

describe('CLI stdin', () => {
  it('reads UTF-8 across chunks and rejects invalid UTF-8', async () => {
    const utf8 = Buffer.from('中文');
    await expect(
      readCliStdin(Readable.from([utf8.subarray(0, 2), utf8.subarray(2)])),
    ).resolves.toBe('中文');
    await expect(readCliStdin(Readable.from([Buffer.from([0xff])]))).rejects.toThrow('valid UTF-8');
  });

  it('accepts exactly 1 MiB and rejects additional bytes across chunks', async () => {
    const full = Buffer.alloc(MAX_MESSAGE, 0x61);
    await expect(readCliStdin(Readable.from([full]))).resolves.toHaveLength(MAX_MESSAGE);
    await expect(readCliStdin(Readable.from([full, Buffer.from('a')]))).rejects.toThrow(
      'exceeds 1 MiB',
    );
  });

  it('closes a pipe that leaves a complete JSON value open past the deadline', async () => {
    const pipe = new PassThrough();
    pipe.write('{}');
    const deadline = new AbortController();
    const result = readCliStdin(pipe, deadline.signal);
    deadline.abort();
    await expect(result).rejects.toThrow('waiting for EOF');
    expect(pipe.destroyed).toBe(true);
  });
});
