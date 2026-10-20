// Bundled only into a disposable extension snapshot, never the production build.
const state = {
  availability: location.pathname === '/offscreen.html' ? 'available' : 'downloadable',
  availabilityError: '',
  readyAfterCreate: true,
  generationError: false,
  calls: [] as { activated: boolean; systemPrompt: string }[],
  destroyed: 0,
};
Object.assign(globalThis, { chromeAiFixture: state });
Object.defineProperty(globalThis, 'LanguageModel', {
  configurable: true,
  value: {
    availability: async () => {
      if (state.availabilityError) throw new Error(state.availabilityError);
      return state.availability;
    },
    create: async (options: {
      signal?: AbortSignal;
      initialPrompts?: { role: string; content: string }[];
      monitor?: (target: EventTarget) => void;
    }) => {
      options.signal?.throwIfAborted();
      const activated = navigator.userActivation.isActive;
      if (state.availability !== 'available' && !activated)
        throw new DOMException('Download requires user activation', 'NotAllowedError');
      state.calls.push({ activated, systemPrompt: options.initialPrompts?.[0]?.content || '' });
      const monitor = new EventTarget();
      options.monitor?.(monitor);
      const progress = new Event('downloadprogress');
      Object.assign(progress, { loaded: 1 });
      monitor.dispatchEvent(progress);
      if (state.readyAfterCreate) state.availability = 'available';
      return {
        destroy: () => state.destroyed++,
        async *promptStreaming(_prompt: string, { signal }: { signal?: AbortSignal }) {
          signal?.throwIfAborted();
          yield 'A local ';
          if (state.generationError) throw new Error('Local inference failed');
          yield 'explanation.';
        },
      };
    },
  },
});
