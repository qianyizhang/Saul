// Source layout and installed entry names can evolve independently.
export const helperComponents = {
  tabs: {
    entries: {
      'host.mjs': 'native/hosts/tabs.mts',
      'cli.mjs': 'native/cli.mts',
      'mcp.mjs': 'native/mcp.mts',
      'board-web.mjs': 'native/board-web.mts',
    },
    modules: {
      'value.mjs': 'shared/model/value.mts',
      'transport.mjs': 'native/transport.mts',
      'protocol.mjs': 'shared/protocol/protocol.mts',
      'board-resource.mjs': 'native/board-resource.mts',
      'board-http.mjs': 'native/board-http.mts',
    },
    assets: {
      'ui/workspace.html': 'board/workspace.html',
      'ui/workspace.css': 'board/workspace.css',
      'ui/design-tokens.css': 'board/design-tokens.css',
    },
    generated: ['window-names.jxa', 'ui/workspace.bundle.js'],
  },
  chatgpt: {
    entries: { 'plan-host.mjs': 'native/hosts/storage.mts' },
    modules: {
      'value.mjs': 'shared/model/value.mts',
      'transport.mjs': 'native/transport.mts',
      'protocol.mjs': 'shared/protocol/protocol.mts',
      'installation-paths.mjs': 'native/installation/paths.mts',
      'history.mjs': 'native/storage/history.mts',
      'plan-service.mjs': 'native/storage/service.mts',
    },
    assets: { 'history.sql': '../../contracts/history.sql' },
    generated: [],
  },
  actions: {
    entries: { 'action-host.mjs': 'native/hosts/actions.mts' },
    modules: {
      'value.mjs': 'shared/model/value.mts',
      'transport.mjs': 'native/transport.mts',
      'protocol.mjs': 'shared/protocol/protocol.mts',
      'installation-paths.mjs': 'native/installation/paths.mts',
      'action-protocol.mjs': 'shared/protocol/action-protocol.mts',
      'action-check.mjs': 'native/action-check.mts',
      'action-store.mjs': 'native/action-store.mts',
      'action-runtime.mjs': 'native/action-runtime.mts',
      'action-worker.mjs': 'native/action-worker.mts',
    },
    assets: {},
    generated: [],
  },
} as const;

export const helperPayloads: Record<string, string[]> = Object.fromEntries(
  Object.entries(helperComponents).map(([id, spec]) => [
    id,
    [
      ...Object.keys(spec.entries),
      ...Object.keys(spec.modules),
      ...Object.keys(spec.assets),
      ...spec.generated,
    ],
  ]),
);

// Emit stable modules and bundle private implementation details with their owner.
export const nativeModules: Record<string, string> = {
  ...Object.assign(
    {},
    ...Object.values(helperComponents).map(({ entries, modules }) => ({ ...entries, ...modules })),
  ),
  'install.mjs': 'native/installation/cli.mts',
  'installation.mjs': 'native/installation/installer.mts',
};
export const nativeAssets: Record<string, string> = Object.assign(
  {},
  ...Object.values(helperComponents).map(({ assets }) => assets),
);
