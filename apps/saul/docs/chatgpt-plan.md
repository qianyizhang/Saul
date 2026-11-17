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

The [Call guide](calls.md#source-capture-and-pdfs) owns PDF behavior.
The native allowlist admits one bounded HTTP(S) attachment, without URL
userinfo, arbitrary content parts, bytes, credentials or caller-supplied
endpoint. The helper maps it to `input_file.file_url` beside `input_text` and
uses the existing OAuth/Responses path, never the Files upload API. Text-only
callers retain their request shape. Update the helper with the extension.

The [direct-flow limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
support file input for accepting models but exclude the Files upload API. The
[file-input guide](https://developers.openai.com/api/docs/guides/file-inputs)
defines PDF URL input and text/page-image processing. See
[dated live evidence](testing.md#pdf-url-attachment--2026-10-29) for the original
account/model/URL result.

## Credentials and sign-out

- In shared macOS mode, tokens stay in Keychain behind the signed Saul owner. Standalone mode keeps `~/.saul/chatgpt/accounts.json` with directory permissions `0700` and file permissions `0600`. Neither mode exposes tokens to browser storage, page messages or reading exports.
- The selected credential owner owns OAuth state, nonce, PKCE, token exchange and signature validation. The standalone Node helper uses `jose`; the shared signed owner uses native Swift verification. A stable opaque host ID is written before authorization. Access/refresh/ID tokens and scopes rotate together through the owner's verified storage write.
- A new issued client ID is retained before token exchange. If exchange fails, select that signed-out registration and reauthorize it to get a fresh code without creating another app registration. Managed setup uses **Sign in and allow plan use**; standalone setup uses **Continue with ChatGPT**. Pending registrations cannot authorize inference until identity validation succeeds.
- Refresh operations use a cross-process lock. Temporary network errors preserve credentials; terminal refresh errors clear unusable tokens while retaining the account registration.
- **Sign out** attempts refresh-token revocation using OpenAI's discovery document. Local tokens are cleared even if remote revocation fails; the UI reports that case and directs you to disconnect Saul in ChatGPT settings. Managed sign-out affects both apps. Sign-out retains the registration and host ID for reauthorization.
- Browser profiles using the same helper installation share its saved accounts. Each reading job freezes the selected account and model; changing Settings never reroutes an existing job to a different account.

The plan helper does not expose a general HTTP proxy, shell tool, MCP server, or tab operations. Replies are validated against the requested operation. Its background transport in [chatgpt-plan.ts](../src/providers/chatgpt-plan.ts)
also handles history port/control requests. It admits account controls only from
Settings/workspace and generation from those pages or the trusted offscreen runner. Codex tab access remains separately opt-in.

For shared mode, disconnect the app in Preferences → Integrations; sign out first only if you intend to disconnect the shared account in both apps. For standalone mode, sign out, disconnect its native connection, and remove `com.saul.chatgpt.json` from the browser's `NativeMessagingHosts` directory. Retain its versioned payload; do not delete individual files through `bin` or `bridge`. Remove `~/.saul/chatgpt` only if you also want to discard the saved host/account mappings. Full runtime cleanup requires all installed helpers and MCP to be disconnected; see the [helper lifecycle](native-messaging.md).

## Verification and limits

[Plan checks](testing.md#evidence-limits) use signed fixture identities,
private temporary credentials and real native framing. They do not establish
live account eligibility, consent availability, quota charging or model quality.

Protocol sources (sign-in, sessions, and model guidance rechecked 2026-10-18):

- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)

## Speech preview

Settings → Presets uses the saved, explicit Realtime model and voice. The
[background speech bridge](../src/speech/bridge.ts) admits one request per trusted
Settings port and checks that the saved Speak preset and official API
connection still match. The [Realtime session](../src/speech/realtime.ts) obtains
an ephemeral secret through the local key or the signed owner's `api-realtime`
operation. Neither plan OAuth nor another connection is a fallback.

One WebSocket response converts up to 512 text characters into PCM16 at 24 kHz.
Audio is capped at 6 MB and the session at 90 seconds; malformed or incomplete
responses and redirects fail without replay. Only completed WAV audio is playable.
Stop, caller loss and leaving Presets abort/close the session; choice changes
clear audio and unmount revokes the playback URL. No microphone, history writes
or remote error bodies. Text, audio and secrets stay out of persistent data and
diagnostics. Realtime is generative and does not guarantee exact wording.

See [the dated OAuth route probe](testing.md#direct-oauth-route-probe--2026-10-21)
for historical evidence about the removed experiment. It does not verify Realtime.
