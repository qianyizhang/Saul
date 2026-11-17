# Saul credentials on macOS

The signed macOS Saul owner serves opted-in connections in both apps. It is the
only active owner of ChatGPT sign-in and plan requests. See
[ADR 0003](../docs/adr/0003-retire-standalone-chatgpt-sign-in.md) for the
retirement decision.

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
- Preserve the shared owner's host ID, issued client IDs, identities and grants
  on existing registrations. Never combine one registration's tokens with
  another's client ID. New registrations use `agent_name_hint=Saul`. Serialize
  refresh and writes across processes. Pin the account, provider, model and
  billing route for a run.
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

## Retirement and removal

The owner reads existing shared Keychain state and retains any saved account
pause. If no shared registration is available, sign in through Connections and
bind the account explicitly. No runtime imports or removes old standalone
credential files or old Keychain items. An app opt-in does not import an API key
or bind an account automatically. Saved attempts remain inspectable; Retry
cannot use a retired standalone route or switch to another registration.

New clients send request envelope version 2. The new signed owner accepts both
versions 1 and 2 for supported operations. Retired import and cleanup operations
are rejected in either version. Older owners reject version 2 before reading or
importing credentials. Update the signed owner if a new client cannot connect.
Keep app, extension, native-host and signing identities stable across upgrades.

Sign out or Remove key affects the shared connection in both apps and states
that scope before confirmation. Disconnecting one app only removes its binding.
OAuth sign-out attempts revocation, then clears local tokens; report unconfirmed
remote revocation. Keep the original registration and host ID for re-sign-in.

## Acceptance

Keep one verification plan: isolated storage and cross-process refresh checks,
native and browser protocol checks, both app gates, and installed acceptance
with the same signed owner across changed builds. Exercise mixed versions,
empty shared state beside legacy sources, and retained registrations and
pauses. Live sign-in, model discovery and inference are separate observations.

See [dated installed evidence](../apps/ez/docs/verification.md#installed-baseline--2026-11-04)
for the earlier migration baseline.

Implementation: `native/credentials` owns the pipe, caller checks, framing and
Keychain access; `apps/ez/Sources/SaulCredentialOwner` owns authentication and
official OpenAI and bound custom-endpoint operations. The signed
`com.saul.credentials` host is separate from `com.saul.chatgpt`, which keeps
its installed identity and handles browser history, configuration and presets.
Browser-owned API connections continue to use their local profiles.

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

The shared owner checks the credential and route before using a cached catalog
and caches one validated snapshot per ChatGPT registration or API connection
key and endpoint. Plan execution requires an unpaused registration and fresh
evidence (under five minutes, with no refresh error) for the requested model,
reasoning effort and service tier. API execution keeps its last-good membership
policy. A complete empty catalog means no models; malformed or incomplete
replies retain the last good models for display with a separate error. There is
no background polling or catalog history. Presets are never rewritten to a
different model.

The version 2 `connection-catalog` request accepts `intent: "display"` (use a
fresh cache or refresh), `"refresh"` (force discovery, including during setup),
or `"check"` (explicit Connections Check). Among these operations, only Check
clears a plan usage pause. It fetches, validates and persists a complete catalog
before clearing the bound registration’s pause under the same lease. A failed or cancelled Check leaves
the pause in place. Check never starts generation or confirms quota. Older
requests without `intent` keep their original model fields; legacy `force: true`
only refreshes. An explicit `intent` opts into optional `isDefault`; EZ uses it
when choosing the unassigned starter. Update the signed owner with clients that
send these fields.

[Browser Speak](../apps/saul/docs/chatgpt-plan.md#speech-preview) and
[EZ Speak](../apps/ez/docs/design.md#speak-preview) use short-lived Realtime
authorization, with no long-lived secret in preview state.
