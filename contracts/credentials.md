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
- Validate native callers and the exact operation at the boundary. Decode the
  existing JSON wire into a typed operation before dispatch. Requests are
  versioned, bounded and cancelable. Account summaries and provider results may
  leave the owner; access/refresh/identity tokens and long-lived API keys may not.
  A browser or native Realtime preview may receive only its short-lived client secret.
- Preserve the shared owner's host ID, issued client IDs, identities and grants
  on existing registrations. Never combine one registration's tokens with
  another's client ID. New registrations use `agent_name_hint=Saul`. Serialize
  refresh and changes to stored account records across processes. Interactive
  OAuth releases that storage lock while waiting for browser approval. The
  owner rereads the registration before saving the verified result. Pin the account, provider, model and
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
are rejected in either version. Owners predating envelope version 2 reject it
before reading credentials. Some version 2 installations predate connection
coordination. Managed setup checks the signed owner’s capability before a
credential change. Saul also checks its separately installed settings writer
before setup that saves a definition.
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

Implementation: [the native credentials package](../native/credentials/Package.swift)
owns the signed executable. Its client target owns the public pipe and framing;
its owner target owns authentication, catalog admission, Keychain access and
provider operations. The owner and the EZ settings writer share
`SaulNativeValues` and `SaulConnectionCoordination`, which uses `CSQLite` for
local reservation and lease state. EZ adapts and writes its app scope. See the
[independent build decision](../docs/adr/0004-build-credential-owner-independently.md).
The signed
`com.saul.credentials` host is separate from `com.saul.chatgpt`, which keeps
its installed identity and handles browser history, configuration and presets.
Browser-owned API connections continue to use their local profiles.

## Connection identity and catalogs

The Connections UI stores public definitions in the shared settings document.
The signed owner stores API keys with their immutable endpoint, separately from
that document. Key replacement cannot change the endpoint. Removal leaves a
retired binding so the same ID cannot later send another key to another origin.
Plan definitions pin their account registration; an unbound migrated entry asks
for an explicit selection. A connection key keeps its original endpoint or plan
registration through setup and Retry. The [setup and execution rules](#shared-connection-setup-and-execution)
apply to both apps. Both setup forms reauthorize
the selected registration, including on a new or unbound connection. Only
**Register a new app → Copy name and open ChatGPT** omits the account ID to create a
registration. Equal email labels never justify merging registrations or their tokens.

On a new registration, version 2 clients can send a `suggestedAppName` in
the form `Saul <12 uppercase hex digits>`. The owner retains the suggestion
with the issued client ID before token exchange. ChatGPT's callback supplies
no approved name. Once the user confirms they used the copied name,
`confirm-app-name` records that confirmation for the verified registration
under the credential lease. Account labels and connection status show the
name only after confirmation. Older stored suggestions have no confirmation.
Reauthorization preserves the name and selects the account only after identity
validation. Only explicit **Enable plan use** for a signed-in account missing
the grant requests `prompt=consent`.

`connection-status` returns identity, endpoint, masked key suffix and availability.
During setup, `connection-key-status` accepts a connection ID and its fixed endpoint.
It checks the local binding before a public definition exists, returning availability
and endpoint only. A different stored endpoint fails the check. No provider call is
involved. `connection-catalog` returns current models, last successful fetch time and a
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
no background polling or catalog history. A corrupt cache entry is discarded
while valid entries are retained. An undecodable cache starts empty. Permission
and write failures are reported; repair never rewrites credentials, settings or
registrations and does not clear pauses. No raw cache archive is kept.

Browser-local and managed API discovery use the same capability policy.
A compatible endpoint's models are Write models regardless of their IDs.
For the official endpoint, `gpt-image-` is Draw, `gpt-realtime` is Speak, other
`gpt-` and `o` followed by a digit are Write; unknown IDs imply no capability.
[Shared fixtures](fixtures/api-model-capabilities.json) check this policy. An
unsupported saved selection remains visible for repair. Presets are never
rewritten to a different model.

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

## Shared connection setup and execution

When Saul starts replacing a shared API key, EZ can see who owns setup for
that connection. While setup is active, the other app directs the user to
its origin. Each app retains its own reviewed definition, previous definition,
phase, operation identity and optional confirmed app name. Recovery records
contain public metadata. Existing single-record recovery files and browser
records remain readable.

The signed owner reserves the connection and its bound registration, if any.
It admits multiple readers of the same credential. A conflicting credential
change reports that the connection is in use. A Saul Call batch holds the
credential from its first signed model request until settlement or Stop. A
custom Call that completes locally acquires no hold. Each signed request in
a batch checks the binding generation. Lost protection stops the batch. A
Realtime preview needs the shared credential to obtain its short-lived client
secret. Local playback uses the issued authorization.

Credential and settings saves have separate acknowledgements. After the
credential succeeds, the coordinator rechecks the reviewed definition against
current settings and saves using the current revision. The writer validates
the reservation token while holding the settings transaction. Independent
preset edits survive. An already applied definition needs no second write.
After a lost credential acknowledgement the user must explicitly review and
submit the credential action. **Discard setup** releases its reservation and
clears the local recovery record.

If the origin has stopped, the other app can offer **Release setup**. Confirmation
explains that the credential may already have changed. Release rechecks inactivity
and the exact reservation, preserves the credential and settings, and invalidates
the old token. A returning app must start a new setup to write again.

Upgrade the signed owner, the Node settings helper, Saul and EZ together for
the full guarantee. An older settings writer can ignore a reservation. An
older batch client announces only individual provider requests, so a newer
owner can protect those requests but cannot see the gap between them.
[Coordination decision](../docs/adr/0008-coordinate-shared-connection-work.md) ·
[Settings files and locking](configuration.md#unified-configuration-scopes) ·
[Recovery fixtures](fixtures/connection-setup.json)
