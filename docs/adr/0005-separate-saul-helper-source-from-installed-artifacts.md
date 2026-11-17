# Separate Saul helper source from installed artifacts

Accepted 2026-11-17.

Saul's history helper also owns settings, presets and Calls persistence. Browser
and Node source had crossed runtime boundaries, and a separate one-shot settings
client silently lost later frames from that helper. Give the browser one
framing-aware storage transport; give Node the SQL code; keep shared schemas and
data models independent of both runtimes. The credential client speaks only to
the signed owner. EZ retains direct Swift access to shared SQLite and settings.

Moving source must not invalidate an existing Chrome native host manifest or
launcher. Map the component's source entrypoints to the stable installed names
and build the assets from the same inventory that installation verifies.
Serialize builders for a checkout and prepare a fresh payload before replacing
the previous output. The build still needs Node 24; the installed modules need
no TypeScript loader or checkout access.

The [Saul architecture](../../apps/saul/docs/architecture.md#source-and-build-ownership)
owns the current boundary. The [configuration contract](../../contracts/configuration.md)
owns revisions and reconciliation after uncertain saves.
