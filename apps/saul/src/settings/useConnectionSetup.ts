import { useEffect, useState, useSyncExternalStore } from 'react';
import { createConnectionEditor, type ConnectionEditorOptions } from '../connections/editor';

export function useConnectionSetup(options: ConnectionEditorOptions, visible: boolean) {
  const [session] = useState(() => createConnectionEditor(options));
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { settings, commit, onDirty } = options;
  useEffect(
    () => session.updateOptions({ settings, commit, onDirty }),
    [session, settings, commit, onDirty],
  );
  useEffect(() => session.enter(), [session]);
  useEffect(() => {
    if (visible) void session.refreshPending();
    else session.cancelSignIn();
  }, [session, visible]);
  return { ...snapshot, ...session };
}
