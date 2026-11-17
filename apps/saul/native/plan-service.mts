import { SharedHistory } from './history.mts';
import type { PlanResult, StorageHelperRequest } from './plan-protocol.mts';
import { SharedPresetsStore } from './shared-presets.mts';

/** Local SQLite history and shared settings over the existing native-host identity. */
export class HistoryConfigService {
  private readonly presets = new SharedPresetsStore();
  private history?: SharedHistory;

  close() {
    this.history?.close();
  }

  async run(request: StorageHelperRequest, emit: (event: PlanResult) => void) {
    switch (request.action) {
      case 'history':
        this.history ??= new SharedHistory();
        emit({ type: 'result', value: (await this.history.run(request.request)) ?? null });
        return;
      case 'config-read':
        emit({ type: 'result', config: this.presets.readScope(request.section) });
        return;
      case 'config-save':
        emit({
          type: 'result',
          config: this.presets.saveScope(request.section, request.revision, request.value),
        });
        return;
      case 'config-commit':
        emit({
          type: 'result',
          ...this.presets.commit(
            request.section,
            request.revision,
            request.value,
            request.presetRevision,
            request.presets,
            request.connections,
          ),
        });
        return;
      case 'presets-read':
        emit({ type: 'result', library: this.presets.read() });
        return;
      case 'presets-import':
        emit({ type: 'result', library: this.presets.import(request.presets) });
        return;
      case 'presets-save':
        emit({
          type: 'result',
          library: this.presets.save(request.revision, request.presets, request.connections),
        });
        return;
    }
  }
}
