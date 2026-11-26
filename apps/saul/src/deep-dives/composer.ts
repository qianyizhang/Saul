import type { Handoff } from './model';

type ComposerResult = Extract<Handoff, { phase: 'draft' | 'sent' | 'uncertain' }>;

// Chrome serializes this function into the selected tab's isolated world.
export async function runChatGPTComposer(
  action: 'send' | 'draft' | 'verify',
  prompt: string,
  origin: string,
  chatPathPattern: string,
  sendBy: number,
): Promise<ComposerResult> {
  const chatPath = new RegExp(chatPathPattern, 'i');
  const fresh = () =>
    (action !== 'send' || Date.now() < sendBy) &&
    location.origin === origin &&
    location.pathname === '/' &&
    !location.search;
  const normalize = (value: string) => value.replace(/\s+/gu, ' ').trim();
  const expected = normalize(prompt);
  const rendered = (element: HTMLElement) =>
    element.getClientRects().length > 0 && !element.closest('[aria-hidden="true"], [inert]');
  const visible = <T extends HTMLElement>(selector: string) =>
    Array.from(document.querySelectorAll<T>(selector)).filter(rendered);
  const single = <T extends HTMLElement>(selector: string) => {
    const elements = visible<T>(selector);
    return elements.length === 1 ? elements[0] : undefined;
  };
  const profile =
    'button[data-testid="accounts-profile-button"], button[data-testid="profile-button"], button[aria-label="Open profile menu"]';
  const signedOut = () =>
    visible('button[data-testid="login-button"], button[data-testid="signup-button"]').length > 0;
  const authenticated = () => visible(profile).length > 0 && !signedOut();
  const temporary = () =>
    visible(
      '[aria-label="Temporary Chat"][aria-pressed="true"], [data-testid="temporary-chat-button"][aria-pressed="true"]',
    ).length > 0;
  const userTurns = () =>
    visible<HTMLElement>(
      '[data-message-author-role="user"], [data-chatgpt-search-unit-key$=":user"]',
    );

  function waitFor<T>(read: () => T | undefined, milliseconds: number) {
    return new Promise<T | undefined>((resolve) => {
      const observer = new MutationObserver(check);
      const interval = setInterval(check, 200);
      const timeout = setTimeout(() => finish(read()), milliseconds);
      function finish(value: T | undefined) {
        observer.disconnect();
        clearInterval(interval);
        clearTimeout(timeout);
        resolve(value);
      }
      function check() {
        const value = read();
        if (value !== undefined) finish(value);
      }
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      check();
    });
  }

  const confirmation = (): ComposerResult | undefined => {
    const route = location.pathname;
    if (location.origin !== origin || !chatPath.test(route) || !authenticated() || temporary())
      return;
    const [first] = userTurns();
    if (first && normalize(first.innerText) === expected)
      return { phase: 'sent', url: origin + route.replace(/\/$/, '') };
  };

  if (action === 'verify') return (await waitFor(confirmation, 5_000)) ?? { phase: 'uncertain' };
  const composer = () =>
    single<HTMLElement>(
      '#prompt-textarea, [contenteditable="true"][aria-label="Chat with ChatGPT"], [contenteditable="true"][aria-label="Ask ChatGPT"], form[data-chatgpt-composer] [contenteditable="true"]',
    );
  const text = (input: HTMLElement) =>
    input instanceof HTMLTextAreaElement ? input.value : input.innerText;
  const input = await waitFor(() => (fresh() && !temporary() ? composer() : undefined), 8_000);
  if (!input || !fresh() || temporary() || userTurns().length > 0 || normalize(text(input)))
    return { phase: 'draft' };
  input.focus();
  if (input instanceof HTMLTextAreaElement) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
      input,
      prompt,
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (input.isContentEditable) {
    document.execCommand('insertText', false, prompt);
  }
  if (action === 'draft' || signedOut()) return { phase: 'draft' };

  const sendControl = () => {
    if (
      !fresh() ||
      temporary() ||
      !authenticated() ||
      !input.isConnected ||
      normalize(text(input)) !== expected ||
      userTurns().length > 0
    )
      return;
    const button = single<HTMLButtonElement>(
      'button[data-testid="send-button"], button[aria-label="Send message"], button[aria-label="Send prompt"]',
    );
    if (
      button &&
      !button.disabled &&
      button.getAttribute('aria-disabled') !== 'true' &&
      (!input.closest('form') || input.closest('form') === button.closest('form'))
    )
      return button;
  };
  const button = await waitFor(sendControl, 3_000);
  if (!button || sendControl() !== button) return { phase: 'draft' };
  button.click();
  return (await waitFor(confirmation, 12_000)) ?? { phase: 'uncertain' };
}
