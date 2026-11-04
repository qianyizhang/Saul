# Roadmap

Shipped behavior belongs in the [README](../README.md) and
[changelog](../CHANGELOG.md); acceptance and remaining verification gaps belong
in [verification](verification.md).

Apple Development signing and the shared Saul credential owner are implemented.
Changed-build acceptance and its limits are recorded in [verification](verification.md).

## Candidates, not commitments

- Spotlight query entry alongside the existing Raycast integration.
- Language preferences and optional richer action field rules.
- Bulk history deletion, retention controls, and larger-history indexing.
- Action chaining (out of scope for the current typed-action integration).
- Additional provider instances/accounts and provider model discovery.
- Optional selection of follow-up context beyond the saved conversation.
- Signed/notarized distribution and an update channel.

For each addition, define the interaction, data boundary, and acceptance checks
before implementation. Keep the default experience fast and compact.
