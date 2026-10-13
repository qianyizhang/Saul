# Architecture and decisions

## Components

| Component | Responsibility |
| --- | --- |
| `Sources/EZ/EZApp.swift` | Native window and app commands |
| `ContentView` / `SettingsView` / `AppStyle` | Lookup interface, account settings, shared appearance |
| `Sources/EZ/AppModel.swift` | User actions, selected account/model, task lifecycle, visible errors |
| `ChatGPTAuth` | OAuth registration, validated identity, consent, refresh, logout |
| `LoopbackListener` | Bounded HTTP callback listener bound only to 127.0.0.1 |
| `OIDC` | PKCE and RS256 identity verification using CryptoKit/Security |
| `AuthStorage` | Keychain records and exclusive runtime lock |
| `ResponsesClient` | Account model discovery and stateless streamed Responses requests |
| `ResponseAccumulator` / `SSEParser` | Wire-event parsing and terminal completion checks |
| `HistoryStore` | Owner-only, locked append-only JSONL snapshots and recovery |

## Direct plan-backed requests

Decision: use the documented Sign in with ChatGPT direct flow. EZ does not run an
agent, Codex app-server, CLI, or tool executor. Native `URLSession` avoids bundling
a second runtime; it sends the same public HTTP requests an OpenAI SDK sends.
There are no model tools in the request. Account/model choices come from the live
`/v1/models` catalog. Unsupported Fast is disabled rather than silently ignored.

Inference sends one user message with mode instructions. Every request explicitly
sets `store: false`, `stream: true`, and the chosen/default service tier. Effort
is sent only when available. No temperature, max-output-tokens, saved response ID,
or unsupported preview fields are added. Completion requires a terminal
`response.completed`; a partial stream is not a successful answer.

## Authentication invariants

- The installation host ID is stable. Each issued client ID has its own identity
  and credentials, even when email addresses match.
- New registration uses `dynamic_agent_client`; save the issued ID before code
  exchange. Reauthentication uses the saved ID and fresh state, nonce, and PKCE.
- Listen on `127.0.0.1`, use `/auth/callback`, and preserve the exact redirect URI
  across authorization and exchange. Validate state, callback parameters, and client ID.
- Verify RS256 signatures against OpenAI's discovered JWKS, plus issuer, audience,
  expiry, subject, and nonce. Reject unsupported algorithms. Do not trust decoded JWTs.
- Identity sign-in and plan permission are distinct. Require granted
  `chatgpt.tokens.use.direct` before model discovery/inference.
- Credentials stay in Keychain. Persist rotations together; serialize refresh in
  the process and hold an exclusive runtime lock to prevent cross-process races.
- Clear tokens on terminal refresh failure, not on network/5xx errors. Logout
  attempts revocation; an unconfirmed remote revocation is shown explicitly.
- OAuth URLs, codes, tokens, and raw auth diagnostics never enter chat history.

See [Keychain access](keychain.md) for the exact stored item and development
signing limitations. Model, effort, and Fast preferences persist when changed;
they contain no credentials and remain separate from lookup history.

## Persistence contract

History entries carry `schemaVersion: 1` and UUID identity. Append before sending;
append again on completion, interruption, or failure. Retain partial visible text
on cancellation. Record requested and, when returned, actual service tier separately.
Loading keeps the last valid entry for each ID. Invalid lines are counted and
preserved. A missing final newline is separated before appending the next record.
Writes use `flock`, mode `0600`, and `fsync`. Never silently submit an unrecorded query.

Known scale boundary: history loads into memory. Introduce indexed storage only
when real history size warrants it, with a tested import and export path.

## Extension points

Add a new text workflow through `QueryMode` and its instructions. Features requiring
conversation context need an explicit conversation model and retention decisions.
Add API-key billing only as an explicit user choice, with separate credentials;
never silently use it after a plan-usage failure. Global shortcuts and menu-bar
access should call the same app actions. See the roadmap for deferred work.
