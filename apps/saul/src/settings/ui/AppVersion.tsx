export function AppVersion() {
  const manifest = chrome.runtime.getManifest();
  const build = manifest.version_name?.match(/\(([a-f0-9]{12})\)$/)?.[1] ?? 'Unavailable';
  return (
    <p className="small muted" aria-label="Saul version">
      Version {manifest.version} · Build {build}
    </p>
  );
}
