import {
  ACTION_STATE_KEY,
  actionState,
  validateActionState,
  type ActionState,
} from '../actions/contract';
import { scopedCall, ConfigUnavailableError } from './scoped-config';

/** Durable choices live in JSON when the optional config helper is available.
 * Builder activity/output remains in Chrome. Once migrated, helper loss blocks writes. */
export function callPresetStorage() {
  let revision: number | undefined;
  return {
    async read(): Promise<ActionState> {
      const local = await actionState();
      const marker = (await chrome.storage.local.get('saul_calls_unified')).saul_calls_unified;
      let config;
      try {
        config = await scopedCall({ action: 'config-read', section: 'calls' });
      } catch (error) {
        if (marker || !(error instanceof ConfigUnavailableError)) throw error;
        return local;
      }
      revision = config.revision;
      if (!config.value) return local;
      const choices = config.value;
      validateActionState(choices);
      await chrome.storage.local.set({ saul_calls_unified: true });
      const validated: ActionState = choices;
      return {
        ...local,
        selected: validated.selected,
        previous: validated.previous,
        library: validated.library,
      };
    },
    async write(state: ActionState) {
      // The service worker can restart while the offscreen owner remains alive.
      if (revision === undefined) await this.read();
      if (revision !== undefined) {
        const config = await scopedCall({
          action: 'config-save',
          section: 'calls',
          revision,
          value: {
            ...(state.selected ? { selected: state.selected } : {}),
            ...(state.previous ? { previous: state.previous } : {}),
            library: state.library || [],
          },
        });
        revision = config.revision;
        await chrome.storage.local.set({ saul_calls_unified: true });
      }
      await chrome.storage.local.set({ [ACTION_STATE_KEY]: state });
    },
  };
}
