# Use your ChatGPT plan

Saul supports the direct **Sign in with ChatGPT** preview for local and open-source apps. Choose **ChatGPT plan** as the provider to use eligible plan requests for explanations and generation tests. Availability and limits depend on your account, workspace and app permissions. API-key profiles remain a separate billing choice; Saul never falls back to them automatically.

## Setup

1. Build and install the selected apps and helpers using the [setup guide](../../../docs/setup.md).
2. Open **Settings → Preferences → Integrations → Connect to Saul** in Chrome. EZ uses the same signed owner by default; reconnect it in Preferences → Integrations if disconnected.
3. Open **Settings → Connections** in either app. For a saved connection, choose **Sign in again**. For a new connection, add **ChatGPT plan** and choose a saved account or **Register a new app**. Select **Copy name and open ChatGPT**, then replace `Saul` with the copied name in ChatGPT before approving. Back in Settings, check **I used … in ChatGPT** if you pasted that name, then save the connection.
4. In **Presets**, choose the saved connection, an available model, effort and speed, then Save. Catalog checks do not generate. Unavailable saved model options block until explicitly changed.

A connection saved in either app is available to both. Managed connections pin the
registration, and the signed Saul owner serializes refresh. Signing out affects both
apps; Disconnect app only removes that app's binding. Account registrations remain
distinct even when their email labels match. Never merge tokens or change a saved
connection's account to resolve duplicate labels.

To switch presets to another saved account, choose **More → Move presets** on
the old connection. Select the destination, review the presets that will move,
and apply. Use **Rename connection** to change the local label. **Delete
connection** is available once the old connection has no preset references.

The account picker and saved connection show the confirmed app name beside the
email. Look for that name in **ChatGPT Settings → Usage → Connected App Limits**.
If you kept the default name or used a different name, leave the confirmation
unchecked. Picker labels ending in six characters show the end of the issued
client ID.

To use a plan connection for built-in **Summarize**, select its saved **Model
preset** in **Settings → Calls** and Save. Custom Call presets retain the runtime
model preset chosen at approval. The preset's connection determines the account.
A removed, signed-out or permission-disabled account blocks without a fallback.
**Original summary setup** uses a bound shared plan connection.

Standalone ChatGPT sign-in is retired. If you only had a standalone account,
sign in through the signed owner and bind the connection in Settings. Legacy
credential files remain untouched. Saved attempts remain readable, but Retry
cannot switch the original account or route. The existing `com.saul.chatgpt`
helper still handles history, configuration and presets, including for
browser-owned API connections. See [installation](../../../docs/setup.md).

## Supported request surface

| Provider          | Authentication                                                 | Inference                        | Options                                              |
| ----------------- | -------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------- |
| ChatGPT plan      | OAuth authorization code with PKCE and validated OIDC identity | Public `/v1/responses`, HTTP/SSE | [Chrome plan request](#chrome-plan-request)          |
| OpenAI compatible | Profile-specific API key or unauthenticated loopback           | `/chat/completions`, HTTP/SSE    | Existing model, temperature and token-limit behavior |
| Chrome on-device  | Retired                                                        | Legacy saved selections only     | Choose ChatGPT plan or OpenAI compatible explicitly  |

### Chrome plan request

The signed owner sends `model` and top-level `instructions`. The user `input`
contains text and can also carry a [PDF URL](#pdf-url-attachments) and image
evidence for an [annotation reply](annotations.md#records-and-replies). Requests use
`store: false`, `stream: true`, and catalog-supported reasoning effort and
service tier.

This route sends no temperature, output-token limit, stored conversation ID, background job, or tools. It sends the captured context needed for each explanation or follow-up. Only `response.completed` marks successful generation; failed, incomplete and disconnected streams retain honest partial-output status. A usage-limit failure pauses new requests for that account. Review usage in ChatGPT; a successful model listing does not prove that the limit has reset.

Standard requests the default service tier. Fast requests the account catalog's
advertised faster tier and may use more plan allowance; it does not promise a
particular latency or prove which tier ultimately served the response. The helper
validates the model's capabilities again before inference. A model listed in
the public API docs is not proof that it is available on a given plan account.

## PDF URL attachments

The [Call guide](calls.md#source-capture-and-pdfs) owns PDF behavior.
The native allowlist admits one bounded HTTP(S) attachment, without URL
userinfo, arbitrary content parts, bytes, credentials or caller-supplied
endpoint. The helper maps it to `input_file.file_url` beside `input_text` and
uses the existing OAuth/Responses path, never the Files upload API. Text-only
callers retain their request shape. Update the signed owner before the extension.

The [direct-flow limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
support file input for accepting models but exclude the Files upload API. The
[file-input guide](https://developers.openai.com/api/docs/guides/file-inputs)
defines PDF URL input and text/page-image processing. See
[dated live evidence](testing.md#pdf-url-attachment--2026-10-29) for the original
account/model/URL result.

## Credentials and sign-out

Tokens stay in Keychain behind the signed owner. The
[credential contract](../../../contracts/credentials.md) owns OAuth, refresh,
version compatibility and sign-out. If token exchange fails after a client ID
was issued, select the pending registration under **Saved account** and choose
**Sign in again**. If the signed-in account lacks plan permission, choose
**Enable plan use**. Inference requires validated identity and plan permission.

Use **Disconnect app** in Preferences → Integrations to disconnect Chrome
without changing EZ's access. Use **Sign out** in Connections only if you
intend to end the shared account session in both apps. A history or
configuration helper removal is a separate [native helper operation](native-messaging.md).
Codex tab access remains separately opt-in.

## Verification and limits

[Plan checks](testing.md#evidence-limits) use disposable fixture credentials and
native framing. They do not establish live account eligibility, consent
availability, quota charging or model quality.

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
