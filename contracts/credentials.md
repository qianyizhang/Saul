# Saul credentials on macOS

Implemented contract — 2026-11-04: use one signed native credential owner for Saul and EZ on
this Mac. The user selected Saul's existing connections as authoritative and
accepted discarding EZ's duplicates or signing in again. This is an intentional
replacement of the previous app-owned credential boundary, not account merging.

## Ownership and lifecycle

- The independently installed native helper is named Saul. It starts on demand
  and exits when its client disconnects. Neither application's UI must be running
  for the other to work. It is not a persistent background daemon.
- Only this signed executable accesses shared Keychain records and performs
  ChatGPT OAuth, refresh and authenticated official OpenAI HTTP operations.
  Chrome connects through Native Messaging; EZ connects through a native pipe.
  A Swift library or general-purpose Node executable is not a Keychain identity.
- Validate native callers and the exact operation at the boundary. Requests are
  versioned, bounded and cancelable. Account summaries and provider results may
  leave the owner; access/refresh/identity tokens and long-lived API keys may not.
  A browser Realtime session may receive only its short-lived client secret.
- Preserve the original Saul host ID, issued client IDs, identities and grants
  when importing. Never combine one registration's tokens with another's client
  ID. New registrations use `agent_name_hint=Saul`. Serialize refresh and writes
  across processes. Pin the account, provider, model and billing route for a run.
- Shared mode is explicitly selected for both current installations by this
  migration. A lost owner blocks affected operations. It never triggers an
  app-local credential fallback, automatic replay or a different billing route.
  Custom OpenAI-compatible endpoints remain Saul-specific.

## Migration and removal

1. Establish Apple-issued signing continuity without changing the installed app,
   extension or native-host identities. Keep the previous pin and app recoverable.
2. Import valid Saul OAuth state and its selected official OpenAI API key into
   separate shared Keychain records. Existing shared records win over a repeated
   import. Do not import EZ's duplicate registrations or keys.
3. Verify Keychain writes by reading them back and verify the new bindings in
   both applications. An unreadable or malformed source is preserved and reported;
   an absent source means signed out, not a storage failure.
4. Retire only verified source copies. Before verification, denial, cancellation,
   storage errors and interruption leave the originals intact. Do not keep an old
   active writer or automatically restore discarded credentials.
5. A saved app binding remains successful if later source retirement fails. Show
   pending cleanup separately and offer an explicit retry. Cleanup must not wait
   on a hidden Keychain authorization dialog.
6. Sign out or Remove key affects the shared connection in both apps and states
   that scope before confirmation. Disconnecting one app only removes its binding.
   OAuth sign-out attempts revocation, then clears local tokens; report unconfirmed
   remote revocation. Keep the original registration and host ID for re-sign-in.

## Acceptance

Keep one verification plan: isolated storage/failure and cross-process refresh
checks, independent native/browser protocol checks, affected app gates, installed
both-app migration, then the same signed owner across two changed binaries.
Probe success does not establish actual-credential or installed-app acceptance.
Live sign-in, model discovery and inference are separate observations.

The history-refactor rollout handed off the installed baseline before this migration.
History schema, app identifiers and extension identity remain unchanged.

Implementation: `native/credentials` owns the pipe, caller checks, framing and
Keychain access; `apps/ez/Sources/SaulCredentialOwner` owns authentication and
fixed official OpenAI operations. `com.saul.credentials` is a separate native host
from the existing standalone `com.saul.chatgpt` history/configuration helper.
Shared mode is explicit; standalone browser installations keep their existing route.
