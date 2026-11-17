import { expect, it, vi } from 'vitest';
import type { AnnotationSummary } from '../shared/protocol/annotations.ts';
import { createAnnotationPanelSession } from '../src/annotations/panel-session';

const a = { url: 'https://example.test/a', title: 'Page A', tabId: 1 };
const b = { url: 'https://example.test/b', title: 'Page B', tabId: 2 };
function annotation(page: typeof a): AnnotationSummary {
  return {
    id: String(page.tabId),
    url: page.url,
    title: page.title,
    number: 1,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    author: { kind: 'user', name: 'Tester' },
    target: {
      kind: 'element',
      label: 'Paragraph',
      frame: 'top document',
      rect: { x: 0, y: 0, width: 10, height: 10 },
      viewport: { width: 100, height: 100, scrollX: 0, scrollY: 0, scale: 1 },
    },
    comment: 'Explain this paragraph.',
    state: 'open',
    hasImage: false,
    replyCount: 0,
  };
}
function fixture() {
  let page = a;
  const list = vi.fn(async (url: string) => ({ records: [annotation(url === a.url ? a : b)] }));
  const respond = vi.fn<() => Promise<unknown>>();
  const session = createAnnotationPanelSession({
    activePage: async () => page,
    list,
    routedSelection: async () => undefined,
    acknowledgeRoute: async () => {},
    choices: async () => ({ presets: [], calls: [] }),
    capture: async () => {},
    respond,
  });
  return {
    session,
    list,
    respond,
    visit(next: typeof a) {
      page = next;
      return session.changePage();
    },
  };
}

it('drops old Respond outcomes even while the new page list is still loading', async () => {
  const { session, list, respond, visit } = fixture();
  const dispose = session.start();
  await session.refresh();
  const admitted = Promise.withResolvers<void>();
  respond.mockReturnValueOnce(admitted.promise);
  const run = session.respond({ presetId: 'fixture', textOnly: false, current: false });
  expect(respond).toHaveBeenCalledWith({
    url: a.url,
    targets: [{ id: '1', revision: 1 }],
    presetId: 'fixture',
    textOnly: false,
    current: false,
  });
  expect(session.getSnapshot().busy).toBe(true);

  const loading = Promise.withResolvers<{ records: AnnotationSummary[] }>();
  list.mockReturnValueOnce(loading.promise);
  const nav = visit(b);
  admitted.resolve();
  await run;
  expect(session.getSnapshot().selected).toBeUndefined();
  loading.resolve({ records: [annotation(b)] });
  await nav;
  session.select('2');
  expect(session.getSnapshot()).toMatchObject({ page: b, selected: '2', busy: false });
  dispose();
});

it('clears a list error on refresh without changing the legitimate page selection', async () => {
  const { session, list, respond, visit } = fixture();
  const dispose = session.start();
  await session.refresh();
  const oldCommand = Promise.withResolvers<void>();
  respond.mockReturnValueOnce(oldCommand.promise);
  const oldRun = session.respond({ presetId: 'fixture', textOnly: false, current: false });
  list.mockRejectedValueOnce(new Error('Storage unavailable'));
  await visit(b);
  expect(session.getSnapshot().readError).toBe('Storage unavailable');
  await session.refresh();
  session.select('2');
  oldCommand.reject(new Error('Old page tab permission expired'));
  await oldRun;
  expect(session.getSnapshot()).toMatchObject({
    page: b,
    selected: '2',
    readError: '',
    commandError: '',
    busy: false,
  });
  dispose();
});
