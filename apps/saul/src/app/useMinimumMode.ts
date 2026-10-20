import { useEffect, useRef, useState } from 'react';
import {
  getMinimumMode,
  setMinimumMode,
  minimumModeFromStorage,
  MINIMUM_MODE_STORAGE_KEY,
} from '../storage/presentation';

export function useMinimumMode() {
  const [minimum, setMinimum] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const storageRevision = useRef(0);
  useEffect(() => {
    let active = true;
    let changed = false;
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !(MINIMUM_MODE_STORAGE_KEY in changes)) return;
      changed = true;
      storageRevision.current += 1;
      setMinimum(minimumModeFromStorage(changes[MINIMUM_MODE_STORAGE_KEY]!.newValue));
      setLoaded(true);
    };
    chrome.storage.onChanged.addListener(listener);
    getMinimumMode().then(
      (value) => {
        if (!active) return;
        if (!changed) setMinimum(value);
        setLoaded(true);
      },
      () => {
        if (active) setError('Could not load appearance. Reload to retry.');
      },
    );
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);
  async function toggle(value: boolean) {
    const previous = minimum;
    const revision = storageRevision.current;
    setMinimum(value);
    setSaving(true);
    setError('');
    try {
      await setMinimumMode(value);
    } catch {
      if (storageRevision.current === revision) setMinimum(previous);
      setError('Could not save appearance. Try again.');
    } finally {
      setSaving(false);
    }
  }
  return { minimum, loaded, saving, error, toggle };
}
