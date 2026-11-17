import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createSettingsEditor } from '../editor';
import { requestSettings } from '../../configuration/client';

export function useSettingsEditor(onDirty?: (dirty: boolean) => void) {
  const [editor] = useState(() => createSettingsEditor(requestSettings));
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const notifyDirty = useRef(onDirty);
  notifyDirty.current = onDirty;
  useEffect(() => {
    let previous = editor.getSnapshot().dirty;
    const unsubscribe = editor.subscribe(() => {
      const dirty = editor.getSnapshot().dirty;
      if (dirty !== previous) {
        previous = dirty;
        notifyDirty.current?.(dirty);
      }
    });
    void editor.open();
    return () => {
      unsubscribe();
      editor.close();
    };
  }, [editor]);
  useEffect(() => {
    if (!state.dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state.dirty]);
  return {
    ...state,
    edit: editor.edit,
    save: editor.save,
    reviewLatest: editor.reviewLatest,
    applyReview: editor.applyReview,
    cancelReview: editor.cancelReview,
    resetInvalidSettings: editor.resetInvalidSettings,
    setCredentialOwner: editor.setCredentialOwner,
    commitConnections: editor.commitConnections,
    reload: async () => {
      if (
        editor.getSnapshot().dirty &&
        !window.confirm('Discard your draft and reload the latest saved settings?')
      )
        return;
      await editor.reload();
    },
  };
}
