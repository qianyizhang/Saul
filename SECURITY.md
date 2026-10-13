# Security and privacy

Do not include credentials, authorization URLs, local history, or private prompts
in issues or logs. Reproduce failures with synthetic text and redact request bodies.
Preserve error codes and OpenAI request IDs when reporting service failures.

EZ stores OAuth credentials in macOS Keychain and history as owner-only plaintext.
It sends the current query and mode instructions to OpenAI. It does not request
ChatGPT conversation access or offer model-controlled local tools. OS/network and
OpenAI account policies still apply; `store: false` is not an offline mode.

Before distributing externally, establish a private reporting channel and complete
the signing/notarization review in `docs/releasing.md`. Do not publish a security
report containing live tokens. Disconnect EZ in ChatGPT Settings if tokens may
have been compromised.
