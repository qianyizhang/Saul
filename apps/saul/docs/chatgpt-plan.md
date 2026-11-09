# Use your ChatGPT plan

Saul supports the direct **Sign in with ChatGPT** preview for local and open-source apps. Choose **ChatGPT plan** as the provider to use eligible plan requests for explanations and generation tests. Availability and limits depend on your account, workspace and app permissions. API-key profiles remain a separate billing choice; Saul never falls back to them automatically.

## Setup

1. Build and install the selected apps and helpers using the [setup guide](../../../docs/setup.md).
2. For shared macOS credentials, open **Settings → Preferences → Integrations → Connect to Saul** in Chrome. EZ uses the same signed owner by default; reconnect it in Preferences → Integrations if disconnected.
3. Open **Settings → Connections → ChatGPT plan → Set up** in either app. Choose an existing account and Save to reuse its sign-in. **Sign in and allow plan use** reauthorizes the selected registration. **Add another account** explicitly creates a registration and opens browser consent.
4. In **Presets**, choose the saved connection, an available model, effort and speed, then Save. Catalog checks do not generate; **Test generation** consumes plan allowance. Unavailable saved model options block until explicitly changed.

A connection saved in either app is available to both. Managed connections pin the
registration, and the signed Saul owner serializes refresh. Signing out affects both
apps; Disconnect app only removes that app's binding. Account registrations remain
distinct even when their email labels match. Never merge tokens or change a saved
connection's account to resolve duplicate labels.

To use a plan connection for built-in **Summarize**, select its saved **Model
preset** in **Settings → Calls** and Save. Custom Call presets retain the runtime
model preset chosen at approval. The preset's connection determines the account.
A removed, signed-out or permission-disabled account blocks without a fallback.
**Original summary setup** retains the previous plan binding for existing installs.

Standalone browser installations retain the `com.saul.chatgpt` helper and local
credential store. Install it with Node 24 and the pinned pnpm version:

```sh
pnpm native:install --chatgpt --extension-id YOUR_32_LETTER_EXTENSION_ID
```

Reload the extension after building, then use the standalone account controls in
Settings. The helper listens only on `127.0.0.1` with a temporary `/auth/callback`
route. Its versioned runtime and private launcher preserve the installation-time
Node and proxy configuration; rerun installation after changing them. See the
[helper migration](../../../docs/setup.md#one-time-helper-migration). Standalone
Summarize remembers its local account choice without changing the shared library.

## Supported request surface

| Provider          | Authentication                                                 | Inference                        | Options                                                                                                                                                   |
| ----------------- | -------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ChatGPT plan      | OAuth authorization code with PKCE and validated OIDC identity | Public `/v1/responses`, HTTP/SSE | `model`, `instructions`, text input with optional PDF URL file input, `store: false`, `stream: true`, catalog-supported reasoning effort and service tier |
| OpenAI compatible | Profile-specific API key or unauthenticated loopback           | `/chat/completions`, HTTP/SSE    | Existing model, temperature and token-limit behavior                                                                                                      |
| Chrome on-device  | Retired                                                        | Legacy saved selections only     | Choose ChatGPT plan or OpenAI compatible explicitly                                                                                                       |

Plan mode sends no temperature, output-token limit, stored conversation ID, background job, or tools. It sends the captured context needed for each explanation or follow-up. Only `response.completed` marks successful generation; failed, incomplete and disconnected streams retain honest partial-output status. A usage-limit failure pauses new requests in the helper. Use **Manage usage**, then deliberately **Refresh models** to resume attempts; successful model listing does not guarantee the limit has reset.

Standard requests the default service tier. Fast requests the account catalog's
advertised faster tier and may use more plan allowance; it does not promise a
particular latency or prove which tier ultimately served the response. The helper
validates the model's capabilities again before inference.

## PDF URL attachments

PDF summaries default to a URL attachment on the same Responses route. The helper
maps a validated `pdf-url` attachment to `input_file.file_url` alongside the text
message. It does not call the Files upload API, download the PDF or switch accounts
or billing providers. Model/URL rejection stays explicit. Update the existing
helper as well as the extension before using this new request field. See
[PDF behavior](product.md#summaries) and [verification](testing.md#pdf-summaries).

The [direct-flow limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
support file input for accepting models but exclude the Files upload API. The
[file-input guide](https://developers.openai.com/api/docs/guides/file-inputs)
defines PDF URL input and text/page-image processing. On October 29, 2026, one
live request with Saul's existing eligible account, `gpt-6-luna`, medium effort
and the supplied public Herzlinger PDF URL returned `response.completed` and a
document-specific English–Chinese summary. Saul downloaded/uploaded no PDF bytes.
This establishes that account/model/URL combination on that date, not universal
access or a guarantee that every page was read; the API does not return extracted
text or an exact page-coverage record.

## Credentials and sign-out

- In shared macOS mode, tokens stay in Keychain behind the signed Saul owner. Standalone mode keeps `~/.saul/chatgpt/accounts.json` with directory permissions `0700` and file permissions `0600`. Neither mode exposes tokens to browser storage, page messages or reading exports.
- The selected credential owner owns OAuth state, nonce, PKCE, token exchange and signature validation. The standalone Node helper uses `jose`; the shared signed owner uses native Swift verification. A stable opaque host ID is written before authorization. Access/refresh/ID tokens and scopes rotate together through the owner's verified storage write.
- A new issued client ID is retained before token exchange. If exchange fails, select that signed-out registration and reauthorize it to get a fresh code without creating another app registration. Managed setup uses **Sign in and allow plan use**; standalone setup uses **Continue with ChatGPT**. Pending registrations cannot authorize inference until identity validation succeeds.
- Refresh operations use a cross-process lock. Temporary network errors preserve credentials; terminal refresh errors clear unusable tokens while retaining the account registration.
- **Sign out** attempts refresh-token revocation using OpenAI's discovery document. Local tokens are cleared even if remote revocation fails; the UI reports that case and directs you to disconnect Saul in ChatGPT settings. Managed sign-out affects both apps. Sign-out retains the registration and host ID for reauthorization.
- Browser profiles using the same helper installation share its saved accounts. Each reading job freezes the selected account and model; changing Settings never reroutes an existing job to a different account.

The plan helper does not expose a general HTTP proxy, shell tool, MCP server, or tab operations. Replies are validated against the requested operation. Its extension port accepts account controls only from Saul's settings/workspace pages and generation from those pages or the trusted offscreen runner. Codex tab access remains separately opt-in.

For shared mode, disconnect the app in Preferences → Integrations; sign out first only if you intend to disconnect the shared account in both apps. For standalone mode, sign out, disconnect its native connection, and remove `com.saul.chatgpt.json` from the browser's `NativeMessagingHosts` directory. Retain its versioned payload; do not delete individual files through `bin` or `bridge`. Remove `~/.saul/chatgpt` only if you also want to discard the saved host/account mappings. Full runtime cleanup requires all installed helpers and MCP to be disconnected; see the [helper lifecycle](native-messaging.md).

## Verification and limits

Automated checks use signed fixture identities, mocked OpenAI endpoints, a real loopback OAuth callback, private temporary credential files, installed native-host framing, and disposable browser profiles. Browser tests replace only native messaging and exercise Settings, the runner, saved history, partial failures and cancellation. They do not establish live account eligibility, consent availability, actual quota charging, or model quality. No real tokens or personal browser profiles are needed for tests.

Protocol sources (sign-in, sessions, and model guidance rechecked 2026-10-18):

- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)

## Speech preview

Settings → Presets supports Speak presets with an OpenAI Realtime model and voice.
Settings → Connections owns the separate API connection and key. The preview generates
up to 512 characters, offers Stop and an audio player, and discards input/audio when
you leave. It requires saved choices, does not use ChatGPT sign-in, and never saves
audio or text to reading history. Both apps preserve/edit Speak presets and execute the preview through the shared
credential owner in managed macOS mode.

The [Speech API guide](https://developers.openai.com/api/docs/guides/text-to-speech)
schedules `gpt-4o-mini-tts` shutdown for January 6, 2027 and directs integrations to
Realtime. Saul uses `gpt-realtime-2.1-mini` by default through the documented
[Realtime WebSocket flow](https://developers.openai.com/api/docs/guides/voice-websockets?api=realtime),
with a short-lived secret created by the trusted extension background. The old
experimental OAuth `speech` operation has been removed from the helper and UI.
Realtime output is generative; exact spoken wording is not guaranteed.

The probe below is historical evidence about the removed OAuth experiment, not a
verification of current API access.

### Live result — October 21, 2026

A single refreshed access token from Saul's existing, plan-enabled direct OAuth
registration was held in memory and used for every request in this run:

| Endpoint                      | Model / control                                        | Observed result                             |
| ----------------------------- | ------------------------------------------------------ | ------------------------------------------- |
| `GET /v1/models`              | Account catalog                                        | HTTP 200                                    |
| `POST /v1/responses`          | `gpt-6-luna`, “Reply with exactly OK.”                 | HTTP 200, `response.completed`, output `OK` |
| `POST /v1/audio/speech`       | `gpt-4o-mini-tts`, coral                               | HTTP 401, `no_matching_rule`                |
| `POST /v1/images/generations` | `gpt-image-2.5-flare`, one low-quality 1024×1024 image | HTTP 401, `hardened_oauth_rule_missing`     |
| `POST /v1/embeddings`         | `text-embedding-3-small`                               | HTTP 401, `no_matching_rule`                |
| `POST /v1/chat/completions`   | `gpt-6-luna`                                           | HTTP 401, `no_matching_rule`                |

Responses completed before the other endpoints were tested: these rejections do
not indicate a generally broken sign-in. They establish rejection for this account,
client registration, route and date; they do not prove that every OAuth client or
rollout behaves identically. No audio or image was generated. Other endpoints,
Realtime sessions, and private ChatGPT backend routes were not tested.

To repeat explicitly (uses live plan allowance), run from `apps/saul` with Node 24:

```sh
node --use-env-proxy scripts/probe-capabilities.mts
```

The probe requires exactly one signed-in, plan-enabled Saul account, uses the
existing locked refresh owner, then freezes one token for the run. It stops if the
live Responses control fails. It never prints or copies credentials. Sanitized
status/error receipts and any successful generated media go to root
`.artifacts/saul/capability-probe/`. Probe prompts are synthetic; no browsing history
is read. Endpoint bodies follow the official
[image](https://developers.openai.com/api/docs/guides/image-generation) and
[embedding](https://developers.openai.com/api/docs/guides/embeddings) references.

The widget is verified in the disposable browser harness for input validation,
account locking, cancellation, sanitized rejection, audio-control rendering,
keyboard disclosure, draft retention, and narrow/wide light/dark presentation in
both display modes. Audio-control success uses synthetic bytes; live audio decoding
and playback remain unverified because the endpoint rejected the credential.
Source and the app-owned build were updated; the loaded personal extension and
installed helper were not upgraded by this experiment.
