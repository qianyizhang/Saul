# Saul credentials on macOS

The signed macOS Saul owner serves opted-in connections in both apps. See
[ADR 0002](../docs/adr/0002-share-signed-credential-owner.md) for the trade-off.

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
  A browser or native Realtime preview may receive only its short-lived client secret.
- Preserve the original Saul host ID, issued client IDs, identities and grants
  when importing. Never combine one registration's tokens with another's client
  ID. New registrations use `agent_name_hint=Saul`. Serialize refresh and writes
  across processes. Pin the account, provider, model and billing route for a run.
- Shared mode requires explicit opt-in. A lost owner blocks affected operations. It never triggers an
  app-local credential fallback, automatic replay or a different billing route.
  Explicitly added custom endpoints use connection-keyed records with a fixed
  endpoint. Legacy browser-only profiles remain local until explicitly replaced.

## OAuth invariants

Preserve the host ID and each issued client ID, including for equal email
labels. Register with `dynamic_agent_client` and save the issued ID before
exchange; reauthorize that ID with fresh state, nonce and PKCE. Bind only
`127.0.0.1` and `/auth/callback`, retaining the exact redirect URI and validating
the callback and client ID. Verify RS256/ES256 signatures against discovered
JWKS, including issuer, audience, expiry, subject and nonce. Identity is separate
from the `chatgpt.tokens.use.direct` grant.

Persist rotations together. Clear unusable credentials on terminal refresh
failure; network/5xx errors preserve them. Blocking reads stay off the UI actor;
cancellation never publishes a partial restore or prevents history access.
Keep OAuth URLs, codes, tokens and raw diagnostics out of history.

## Migration and removal

1. Establish Apple-issued signing continuity without changing the installed app,
   extension or native-host identities. Keep the previous pin and app recoverable.
2. Adopt Saul’s existing connections. Import valid Saul OAuth state and its selected official OpenAI API key into
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

See [dated installed evidence](../apps/ez/docs/verification.md#installed-baseline--2026-11-04).
The credential migration preserves history schema and app/extension identities.

Implementation: `native/credentials` owns the pipe, caller checks, framing and
Keychain access; `apps/ez/Sources/SaulCredentialOwner` owns authentication and
official OpenAI and bound custom-endpoint operations. `com.saul.credentials` is a separate native host
from the existing standalone `com.saul.chatgpt` history/configuration helper.
Shared mode is explicit; standalone browser installations keep their existing route.

## Connection identity and catalogs

The Connections UI stores public definitions in the shared settings document.
The signed owner stores API keys with their immutable endpoint, separately from
that document. Key replacement cannot change the endpoint. Removal leaves a
retired binding so the same ID cannot later send another key to another origin.
Plan definitions pin their account registration; an unbound migrated entry asks
for an explicit selection. Setup writes credentials before the public definition;
a failed definition save keeps the setup draft and same ID for an explicit retry.
It does not silently switch or delete another connection. Both setup forms reauthorize
the selected registration, including on a new or unbound connection. Only the explicit
Add another account action omits the account ID to create a registration. Equal email
labels never justify merging registrations or their tokens.

`connection-status` returns identity, endpoint, masked key suffix and availability.
`connection-catalog` returns current models, last successful fetch time and a
separate refresh error. The owner keeps only `connection-catalogs.json`, a bounded,
owner-only current cache, and never stores prompts or tokens there. Discovery uses
the same cross-process lease as refresh. HTTP redirects are refused. Custom HTTPS
endpoints and HTTP loopback endpoints use stored destinations, never a caller's
arbitrary generation URL. Catalogue and status calls time out after 30 seconds.

The shared owner serializes discovery with refresh, caching one validated
snapshot per connection for five minutes. Settings entry, setup and stale request
preparation can refresh it; Check forces refresh. A complete empty catalog means
no models; malformed or incomplete replies retain the last good models with a
separate error. There is no background polling or catalog history. Presets are
never rewritten to a different model.

[Browser Speak](../apps/saul/docs/chatgpt-plan.md#speech-preview) and
[EZ Speak](../apps/ez/docs/design.md#speak-preview) use short-lived Realtime
authorization, with no long-lived secret in preview state.
