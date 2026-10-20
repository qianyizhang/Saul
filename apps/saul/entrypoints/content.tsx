import { createRoot, type Root } from 'react-dom/client';
import { SaulRoot } from '../src/surface/SaulRoot';
import '../assets/tailwind.css';

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'saul-root',
      position: 'inline',
      anchor: 'body',
      append: 'last',
      onMount: (container: HTMLElement) => {
        const root = createRoot(container);
        root.render(<SaulRoot isContextValid={() => ctx.isValid} />);
        return root;
      },
      onRemove: (root: Root | undefined) => {
        root?.unmount();
      },
    });

    ui.mount();
  },
});
