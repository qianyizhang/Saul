import { randomUUID } from 'node:crypto';
import { mcpTools } from './app-protocol.mts';
import { createWorkspace } from './workspace.mts';
import { callTool } from './client.mts';
import { errorMessage } from './transport.mts';
import { validate } from './protocol.mts';
import { DIAGNOSTIC_TOOLS } from './diagnostic-protocol.mts';
import { isRecord } from './value.mts';
import { Recorder, eventSchema } from './diagnostic-events.mts';
import { LogStore } from './diagnostic-store.mts';

export function createBoardService(options: {
  resourceUri: string;
  workspace?: ReturnType<typeof createWorkspace>;
  logRoot?: string;
}) {
  const workspace = options.workspace ?? createWorkspace();
  const store = new LogStore('saul-tab-board', options.logRoot);
  const log = new Recorder('server', (event) => store.append(event));
  const tools = mcpTools(options.resourceUri);
  function diagnostic(name: string, args: unknown) {
    const definition = DIAGNOSTIC_TOOLS.find((tool) => tool.name === name);
    if (!definition) throw new Error('Unknown diagnostic operation');
    validate(definition.inputSchema, args, name);
    if (!isRecord(args)) throw new Error('Expected diagnostic arguments');
    switch (name) {
      case 'diagnostics_info':
        return {
          app: 'Saul Tab board',
          version: '1.4.0',
          resourceUri: options.resourceUri,
          instance: store.instance,
          ...store.status(),
          appObservations:
            'Untrusted app-origin reports; server observations have separate interaction IDs',
        };
      case 'diagnostics_tools':
        return { tools };
      case 'diagnostics_append':
        store.append({ ...eventSchema.parse(args.event), source: 'app' });
        return { stored: !store.error };
      case 'diagnostics_events':
        return {
          events: store.events
            .filter(
              (e) =>
                e.source === 'server' && (!args.interaction || e.interaction === args.interaction),
            )
            .slice(-(typeof args.limit === 'number' ? args.limit : 20))
            .map((event) =>
              Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'payload')),
            ),
        };
      case 'diagnostics_event': {
        const event = store.events.find((e) => e.id === args.id);
        if (!event) throw new Error('Observation expired or belongs to another server');
        return { event };
      }
      case 'diagnostics_capture':
        return store.capture(String(args.interaction));
      default:
        throw new Error('Unknown diagnostic operation');
    }
  }
  return {
    tools,
    store,
    async call(name: string, args: unknown = {}) {
      if (name.startsWith('diagnostics_')) {
        try {
          const value = diagnostic(name, args);
          return {
            content: [{ type: 'text', text: JSON.stringify(value) }],
            structuredContent: value,
          };
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: errorMessage(error) }] };
        }
      }
      if (!tools.some((tool) => tool.name === name)) throw new Error('Unknown MCP tool');
      const interaction = randomUUID();
      log.record(interaction, name, 'Client → Server', 'request', 'received', args);
      try {
        let result;
        if (name.startsWith('saul_workspace_')) {
          result = await workspace(name, args);
          if (name === 'saul_workspace_show')
            result._meta.ui = { resourceUri: options.resourceUri };
        } else {
          const value = await callTool(name, args);
          result = {
            content: [{ type: 'text', text: JSON.stringify(value) }],
            structuredContent: value,
          };
        }
        log.record(interaction, name, 'Server → Client', 'result', 'returned', result);
        return result;
      } catch (error) {
        const result = { isError: true, content: [{ type: 'text', text: errorMessage(error) }] };
        log.record(interaction, name, 'Server → Client', 'result', 'rejected', result);
        return result;
      }
    },
  };
}
