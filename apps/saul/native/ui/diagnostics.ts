import { z } from 'zod';
import { Recorder, eventSchema, eventMetadataSchema, type Event } from '../diagnostic-events.mts';

type Remote = (name: string, args: Record<string, unknown>) => Promise<unknown>;
export type Flow = { name: string; steps: string[]; request: unknown; reads: string[] };
export const plainMessageFlow: Flow = {
  name: 'Plain message · fixture',
  steps: [
    'App freezes the text',
    'App → Host: ui/message',
    'Host → App: acknowledgment',
    'Main conversation: arrival and response require separate observation',
  ],
  request: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
  reads: [],
};
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '') {
  const value = document.createElement(tag);
  value.textContent = text;
  return value;
}
/** Product views keep their layout. This optional inspector owns only diagnostics. */
export class AppDiagnostics {
  readonly log: Recorder;
  remote?: Remote;
  private persistence = new Set<Promise<void>>();
  private recording = 'Live memory only; no payloads saved';
  private dialog?: HTMLDialogElement;
  private render?: () => void;
  lastInteraction?: string;
  readonly options: {
    name: string;
    version: string;
    build: string;
    mode: string;
    info?: () => unknown;
    flows?: Flow[];
  };
  constructor(options: AppDiagnostics['options']) {
    this.options = options;
    this.log = new Recorder('app', (event) => {
      if (!this.remote) return;
      const pending = this.remote('diagnostics_append', { event })
        .then((value) => {
          const result = z.object({ stored: z.boolean() }).parse(value);
          this.recording = result.stored
            ? 'Metadata recorded; payloads remain live until explicitly captured'
            : 'Metadata write failed; observations remain in memory';
        })
        .catch(() => {
          this.recording = 'Recording unavailable; observations remain in memory';
        });
      this.persistence.add(pending);
      void pending.finally(() => this.persistence.delete(pending));
    });
  }
  async observe<T>(method: string, request: unknown, action: () => Promise<T>): Promise<T> {
    const interaction = crypto.randomUUID();
    this.lastInteraction = interaction;
    this.log.record(
      interaction,
      method,
      this.options.mode === 'hosted' ? 'App → Host' : 'App → Local server',
      'request',
      'sending',
      request,
    );
    try {
      const result = await action();
      const rejected =
        result !== null &&
        typeof result === 'object' &&
        'isError' in result &&
        result.isError === true;
      this.log.record(
        interaction,
        method,
        this.options.mode === 'hosted' ? 'Host → App' : 'Local server → App',
        'result',
        rejected ? 'rejected' : 'received',
        result,
      );
      this.render?.();
      return result;
    } catch (error) {
      this.log.record(interaction, method, 'Adapter → App', 'error', 'unconfirmed', String(error));
      this.render?.();
      throw error;
    }
  }
  button() {
    const button = node('button', 'ⓘ');
    button.type = 'button';
    button.setAttribute('aria-label', 'App info');
    button.title = 'App info';
    button.onclick = () => this.show();
    return button;
  }
  show(
    initial: 'Info' | 'Tools' | 'Conversation flow' | 'Interactions' = 'Info',
    interaction?: string,
  ) {
    this.dialog?.remove();
    const dialog = node('dialog');
    this.dialog = dialog;
    dialog.className = 'mcp-observability';
    dialog.setAttribute('aria-label', `${this.options.name} · App info`);
    const style = node(
      'style',
      `.mcp-observability{color-scheme:inherit;color:var(--ink,CanvasText);background:var(--panel,var(--surface,Canvas));border:1px solid var(--line,GrayText);border-radius:12px;width:min(900px,94vw);max-height:90vh;padding:20px;font:14px/1.5 system-ui;box-sizing:border-box}.mcp-observability *{box-sizing:border-box}.mcp-observability::backdrop{background:#0006}.mcp-observability header,.mcp-observability nav{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:0 0 14px}.mcp-observability header strong{flex:1}.mcp-observability button,.mcp-observability summary{font:inherit;cursor:pointer}.mcp-observability button{padding:6px 10px;color:inherit;background:transparent;border:1px solid var(--line,GrayText);border-radius:6px}.mcp-observability button:disabled{opacity:.5;cursor:default}.mcp-observability button[aria-pressed=true]{outline:2px solid var(--accent,Highlight)}.mcp-observability pre,.mcp-observability p{white-space:pre-wrap;overflow-wrap:anywhere}.mcp-observability pre{font:12px/1.5 ui-monospace,monospace;border:1px solid var(--line,GrayText);padding:12px;max-height:45vh;overflow:auto}.mcp-observability li{margin:8px 0}.mcp-observability details{margin:12px 0}.mcp-observability [hidden]{display:none!important}`,
    );
    const header = node('header'),
      close = node('button', 'Close');
    close.onclick = () => dialog.close();
    header.append(node('strong', `${this.options.name} · App info`), close);
    const nav = node('nav');
    nav.setAttribute('aria-label', 'Diagnostics');
    const content = node('section');
    dialog.append(style, header, nav, content);
    document.body.append(dialog);
    const info = () => ({
      ...this.options,
      info: this.options.info?.(),
      flows: undefined,
      recording: this.recording,
      retainedEvents: this.log.events.length,
      evicted: this.log.dropped,
      coverage:
        'App SDK/HTTP observations; server wire IDs are separate. Host internals and model responses are not observed.',
      payloadPolicy:
        'Masked, bounded live payloads. Automatic disk logs contain metadata only. Restart or close can lose uncaptured payloads.',
    });
    let generation = 0;
    const display = (tab: string) => {
      const current = ++generation;
      this.render = undefined;
      content.replaceChildren();
      nav
        .querySelectorAll('button')
        .forEach((button) =>
          button.setAttribute('aria-pressed', String(button.textContent === tab)),
        );
      if (tab === 'Info') {
        content.append(node('pre', JSON.stringify(info(), null, 2)));
        const server = node(
          'pre',
          this.remote
            ? 'Reading server identity…'
            : 'No server diagnostics adapter. This view keeps observations in memory; an explicit capture is downloaded.',
        );
        content.append(server);
        if (this.remote)
          void this.remote('diagnostics_info', {})
            .then((value) => {
              if (generation === current) server.textContent = JSON.stringify(value, null, 2);
            })
            .catch((error) => {
              server.textContent = String(error);
            });
      } else if (tab === 'Tools') {
        const status = node(
          'p',
          this.remote
            ? 'Reading registered tool contracts…'
            : 'No MCP tools are registered in this standalone document. Domain controls remain available.',
        );
        content.append(status);
        if (this.remote)
          void this.remote('diagnostics_tools', {})
            .then((value) => {
              if (generation !== current) return;
              const tools = z
                .object({ tools: z.array(z.record(z.string(), z.unknown())) })
                .parse(value).tools;
              status.textContent = `${tools.length} tools from the active server registrations. Each tool is an MCP entrypoint; schemas describe its API boundary.`;
              for (const tool of tools) {
                const detail = node('details');
                detail.append(
                  node('summary', String(tool.name)),
                  node('pre', JSON.stringify(tool, null, 2)),
                );
                content.append(detail);
              }
            })
            .catch((error) => {
              status.textContent = String(error);
            });
      } else if (tab === 'Conversation flow') {
        content.append(
          node(
            'p',
            'Fixtures explain the route; they do not execute actions. An acknowledgment does not prove conversation arrival.',
          ),
        );
        for (const flow of this.options.flows ?? [plainMessageFlow]) {
          const block = node('section'),
            steps = node('ol');
          flow.steps.forEach((step) => steps.append(node('li', step)));
          block.append(
            node('h3', flow.name),
            steps,
            node('pre', JSON.stringify({ request: flow.request, reads: flow.reads }, null, 2)),
          );
          content.append(block);
        }
      } else {
        this.interactions(content, interaction);
      }
    };
    for (const tab of ['Info', 'Tools', 'Conversation flow', 'Interactions']) {
      const button = node('button', tab);
      button.onclick = () => display(tab);
      nav.append(button);
    }
    dialog.onclose = () => {
      generation++;
      this.render = undefined;
    };
    display(initial);
    dialog.showModal();
  }
  private interactions(content: HTMLElement, interaction?: string) {
    const status = node('p', this.recording),
      list = node('ol'),
      payload = node('pre', 'Select one observation. Inspection never repeats the action.');
    const refresh = node('button', 'Read server event summaries'),
      save = node('button', 'Save diagnostic capture');
    status.setAttribute('role', 'status');
    save.disabled = true;
    refresh.disabled = !this.remote;
    const receipt = node(
      'p',
      'Capture includes one selected interaction’s retained masked payloads, up to 2 MiB. Server captures share the displayed session retention.',
    );
    receipt.setAttribute('role', 'status');
    const remoteEvents: Omit<Event, 'payload'>[] = [];
    let selected: string | undefined,
      revision = 0,
      saving = false;
    const render = () => {
      list.replaceChildren();
      for (const event of [
        ...this.log.events.filter((event) => !interaction || event.interaction === interaction),
        ...remoteEvents,
      ]) {
        const item = node('li'),
          button = node(
            'button',
            `${event.time.slice(11, 19)} · ${event.source} · ${event.method} · ${event.phase} · ${event.status}`,
          );
        button.onclick = () => {
          const current = ++revision;
          selected = undefined;
          save.disabled = true;
          payload.textContent = 'Reading selected observation…';
          void (async () => {
            const local = this.log.events.find((candidate) => candidate.id === event.id);
            const captured =
              local ??
              eventSchema.parse(
                z
                  .object({ event: z.unknown().transform((value) => eventSchema.parse(value)) })
                  .parse(await this.remote?.('diagnostics_event', { id: event.id })).event,
              );
            if (current !== revision || !content.isConnected) return;
            payload.textContent = JSON.stringify(captured, null, 2);
            selected = captured.interaction;
            save.disabled = saving;
            receipt.textContent = `Selected interaction ${selected}. Save only its retained masked payloads.`;
          })().catch((error) => {
            if (current === revision) {
              payload.textContent = String(error);
              selected = undefined;
              save.disabled = true;
            }
          });
        };
        item.append(button);
        list.append(item);
      }
    };
    this.render = render;
    refresh.onclick = () => {
      refresh.disabled = true;
      void this.remote?.('diagnostics_events', { limit: 20 })
        .then((value) => {
          const result = z
            .object({
              events: z.array(z.unknown().transform((value) => eventMetadataSchema.parse(value))),
            })
            .parse(value);
          remoteEvents.splice(0, remoteEvents.length, ...result.events);
          render();
          status.textContent =
            'Latest 20 server summaries; server wire IDs do not establish app interaction correlation.';
        })
        .catch((error) => {
          status.textContent = String(error);
        })
        .finally(() => {
          refresh.disabled = false;
        });
    };
    save.onclick = () => {
      const target = selected;
      if (!target || saving) return;
      saving = true;
      save.disabled = true;
      void (async () => {
        if (this.remote) {
          await Promise.all([...this.persistence]);
          // Reconcile retained local events after a previous metadata write gap.
          // This only records frozen observations; it never repeats their action.
          for (const event of this.log.events.filter((event) => event.interaction === target))
            await this.remote('diagnostics_append', { event });
          const result = z
            .object({ path: z.string(), eventCount: z.number() })
            .parse(await this.remote('diagnostics_capture', { interaction: target }));
          receipt.textContent = `Saved ${result.eventCount} observations for ${target} to ${result.path}`;
        } else {
          const events = this.log.events.filter((event) => event.interaction === target);
          if (!events.length) throw new Error('Interaction expired');
          const body = JSON.stringify({ interaction: target, events }, null, 2);
          if (new TextEncoder().encode(body).length > 2 * 1024 * 1024)
            throw new Error('Capture exceeds 2 MiB');
          const url = URL.createObjectURL(new Blob([body], { type: 'application/json' })),
            link = node('a');
          link.href = url;
          link.download = `diagnostic-${target}.json`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          receipt.textContent = `Download requested for ${target}; check the browser for file receipt.`;
        }
      })()
        .catch((error) => {
          receipt.textContent = `Capture not confirmed for ${target}: ${String(error)}`;
        })
        .finally(() => {
          saving = false;
          save.disabled = !selected;
        });
    };
    content.append(status, refresh, list, payload, save, receipt);
    render();
  }
}
