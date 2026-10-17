# Use your ChatGPT plan

Saul supports the direct **Sign in with ChatGPT** preview for local and open-source apps. Choose **ChatGPT plan** as the provider to use eligible plan requests for explanations and generation tests. Availability and limits depend on your account, workspace and app permissions. API-key profiles remain a separate billing choice; Saul never falls back to them automatically.

## Setup

1. Install dependencies and build Saul using Node 24 and the pinned pnpm version: `pnpm install --frozen-lockfile`, then `pnpm build`.
2. Load or reload `.output/chrome-mv3` in Chrome. Open Saul Settings and select **ChatGPT plan**.
3. Expand **ChatGPT helper setup** and run its command from the checkout:

   ```sh
   node native/install.mjs --chatgpt --extension-id YOUR_32_LETTER_EXTENSION_ID
   ```

   This registers `com.saul.chatgpt` for the exact extension ID and copies the helper and its JWT verifier dependency into `~/.saul/bridge`. The launcher records the current Node path and any HTTP/HTTPS proxy and bypass settings from the installing shell, then enables Node's environment proxy support. This keeps auth, signing-key retrieval, and inference on the same route when Chrome launches the helper without your shell environment. Rerun after updating Saul, moving Node, or changing your proxy. The launcher is private (`0700`); do not share it if your proxy URL contains credentials. The existing installer's `--browser`, `--install-dir`, `--manifest-dir`, and `--dry-run` options also apply.

4. Choose **Continue with ChatGPT** and complete consent in the opened browser tab. The helper listens only on `127.0.0.1`, with a temporary port and `/auth/callback` path. Sign-in survives the popup closing; reopen Settings to choose the saved account afterward.
5. Return to Settings. A sole saved account is selected automatically, and eligible accounts load their models automatically. Name the preset, choose an available model, effort and speed, then **Save**. **Refresh models** retries catalog loading. **Test generation** sends a small prompt and consumes plan quota. A model catalog entry alone does not prove inference access.

Use the full Saul workspace for a sign-in flow that stays visible while the authorization tab is open. Saved accounts use distinct registration labels even when their email addresses match. Adding another account or workspace creates a separate registration; returning sign-in reuses the existing client and host IDs.

EZ uses the same direct ChatGPT flow and account-control vocabulary. Its saved
sign-ins remain separate from Saul's; signing out of one app does not sign out of
the other. A recipe selects a named preset; unavailable saved models, effort, or
Fast choices block the request until explicitly changed. Catalog refresh never
silently replaces a saved choice.

## Supported request surface

| Provider          | Authentication                                                 | Inference                        | Options                                                                                                                             |
| ----------------- | -------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| ChatGPT plan      | OAuth authorization code with PKCE and validated OIDC identity | Public `/v1/responses`, HTTP/SSE | `model`, `instructions`, complete text `input`, `store: false`, `stream: true`, catalog-supported reasoning effort and service tier |
| OpenAI compatible | Profile-specific API key or unauthenticated loopback           | `/chat/completions`, HTTP/SSE    | Existing model, temperature and token-limit behavior                                                                                |
| Chrome on-device  | Temporarily disabled                                           | Retained for later verification  | Choose ChatGPT plan or OpenAI compatible explicitly                                                                                 |

Plan mode sends no temperature, output-token limit, stored conversation ID, background job, or tools. It sends the captured context needed for each explanation or follow-up. Only `response.completed` marks successful generation; failed, incomplete and disconnected streams retain honest partial-output status. A usage-limit failure pauses new requests in the helper. Use **Manage usage**, then deliberately **Refresh models** to resume attempts; successful model listing does not guarantee the limit has reset.

Standard requests the default service tier. Fast requests the account catalog's
advertised faster tier and may use more plan allowance; it does not promise a
particular latency or prove which tier ultimately served the response. The helper
validates the model's capabilities again before inference.

## Credentials and sign-out

- Tokens stay in the helper's `~/.saul/chatgpt/accounts.json`, with directory permissions `0700` and file permissions `0600`. They are excluded from browser storage, page messages and reading exports. Treat the credential directory as private; do not sync or commit it.
- The native helper owns OAuth state, nonce, PKCE, token exchange and signature validation using `jose`. A stable opaque host ID is written before authorization. Access/refresh/ID tokens and scopes rotate together in an atomic file replacement.
- A new issued client ID is retained before token exchange. If exchange fails, select that signed-out registration and choose **Continue with ChatGPT** to get a fresh code without creating another app registration. Pending registrations cannot authorize inference until identity validation succeeds.
- Refresh operations use a cross-process lock. Temporary network errors preserve credentials; terminal refresh errors clear unusable tokens while retaining the account registration.
- **Sign out** cancels that account's requests in the connected helper and attempts refresh-token revocation using OpenAI's discovery document. Local tokens are cleared even if remote revocation fails; the UI reports that case and directs you to disconnect Saul in ChatGPT settings. Sign-out retains the registration and host ID for reauthorization.
- Browser profiles using the same helper installation share its saved accounts. Each reading job freezes the selected account and model; changing Settings never reroutes an existing job to a different account.

The plan helper does not expose a general HTTP proxy, shell tool, MCP server, or tab operations. Replies are validated against the requested operation. Its extension port accepts account controls only from Saul's settings/workspace pages and generation from those pages or the trusted offscreen runner. Codex tab access remains separately opt-in.

To remove this integration, sign out, close/reload Saul to stop its native connection, and remove `com.saul.chatgpt.json` from the browser's `NativeMessagingHosts` directory and `~/.saul/bin/saul-chatgpt-host`. Remove `~/.saul/chatgpt` only if you also want to discard the saved host/account mappings. Keep the shared `bridge` directory if you use Codex tab access.

## Verification and limits

Automated checks use signed fixture identities, mocked OpenAI endpoints, a real loopback OAuth callback, private temporary credential files, installed native-host framing, and disposable browser profiles. Browser tests replace only native messaging and exercise Settings, the runner, saved history, partial failures and cancellation. They do not establish live account eligibility, consent availability, actual quota charging, or model quality. No real tokens or personal browser profiles are needed for tests.

Protocol sources (sign-in, sessions, and model guidance rechecked 2026-10-18):

- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)
