# Security and privacy

Do not include credentials, authorization URLs, local history, or private prompts
in issues or logs. Reproduce failures with synthetic text and redact request bodies.
Preserve error codes and OpenAI request IDs when reporting service failures.

See [local data](README.md#local-data) for history and credential storage.
Provider actions send the compiled prompt to the endpoint bound to the preset's
connection. EZ does not request ChatGPT conversation access or offer
model-controlled local tools. `store: false` still sends a network request.

Before distributing externally, establish a private reporting channel and complete
the [signing and distribution review](docs/releasing.md). If a token may have
been compromised, see [shared account sign-out](docs/keychain.md#history-and-sign-out).
