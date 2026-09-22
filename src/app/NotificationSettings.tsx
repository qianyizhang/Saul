import { useEffect, useState } from 'react';
import {
  getErrorNotificationsMuted,
  setErrorNotificationsMuted,
  NOTIFICATION_STORAGE_KEY,
} from '../storage/notifications';

export function NotificationSettings() {
  const [muted, setMuted] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let changed = false;
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && NOTIFICATION_STORAGE_KEY in changes) {
        changed = true;
        setMuted(changes[NOTIFICATION_STORAGE_KEY]!.newValue === true);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    getErrorNotificationsMuted().then(
      (value) => {
        if (active && !changed) setMuted(value);
      },
      () => {
        if (active) setError('Could not load notification preferences. Reopen Settings to retry.');
      },
    );
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);
  async function toggle(value: boolean) {
    const previous = muted;
    setMuted(value);
    setSaving(true);
    setError('');
    try {
      await setErrorNotificationsMuted(value);
      setMuted(value);
    } catch {
      setMuted(previous);
      setError('Could not save notification preferences. Try again.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="panel settings-section">
      <h3>Notifications</h3>
      <label className="toggle">
        Mute error notifications
        <input
          type="checkbox"
          checked={muted === true}
          disabled={muted === null || saving}
          onChange={(e) => void toggle(e.target.checked)}
        />
      </label>
      <p className="small muted">
        Hide error toasts on web pages, including “Saul did not respond.” Errors remain visible in
        explanations and Settings. Saves immediately on this device.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
