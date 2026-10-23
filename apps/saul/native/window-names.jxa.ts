// JXA globals supplied by macOS, not Node or a browser.
interface ChromeWindow {
  id(): number;
  tabs: { id(): number[] };
  get givenName(): () => string;
  set givenName(value: string);
}
declare function Application(pid: number): {
  running(): boolean;
  windows: { (): ChromeWindow[]; id(): number[]; mode(): string[] };
};
interface NameRequest {
  browserPid: number;
  action: 'read' | 'apply';
  windows: { windowId: number; tabIds: number[]; title: string; expectedTitle?: string }[];
}
// All untrusted titles/IDs arrive as JSON data, never script source.
function run(argv: string[]) {
  const request: NameRequest = JSON.parse(argv[0]);
  const app = Application(request.browserPid);
  if (!app.running()) throw new Error('Connected Chrome process is no longer running');
  const windows = app.windows();
  // Batch scalar properties: resolving each ID inside find() sends O(n²) Apple events.
  const ids = app.windows.id().map(Number);
  const modes = app.windows.mode();
  if (
    modes.length !== ids.length ||
    JSON.stringify(app.windows.id().map(Number)) !== JSON.stringify(ids)
  )
    throw new Error('Native windows changed while reading names');
  const targets = request.windows.map(function (expected) {
    const index = ids.indexOf(expected.windowId);
    const window = windows[index];
    if (!window || Number(window.id()) !== expected.windowId || modes[index] !== 'normal')
      throw new Error('Normal window no longer exists');
    const actual = window.tabs
      .id()
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      });
    const tabIds = expected.tabIds.slice().sort(function (a, b) {
      return a - b;
    });
    if (JSON.stringify(actual) !== JSON.stringify(tabIds))
      throw new Error('Window tabs changed before native naming');
    // Only read names for the normal windows in the extension's scoped inventory.
    const title = window.givenName();
    if (expected.expectedTitle !== undefined && title !== expected.expectedTitle)
      throw new Error('Native window name changed since preview');
    return { window: window, input: expected, title: title };
  });
  // Validate every destination before writing the first name.
  if (request.action === 'apply')
    targets.forEach(function (target) {
      if (target.window.givenName() !== target.title)
        throw new Error('Native window name changed during apply');
      target.window.givenName = target.input.title;
      if (target.window.givenName() !== target.input.title)
        throw new Error('Native window rename could not be verified');
    });
  return JSON.stringify(
    targets.map(function (target) {
      return {
        windowId: target.input.windowId,
        title: request.action === 'apply' ? target.window.givenName() : target.title,
      };
    }),
  );
}
