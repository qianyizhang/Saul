# Shared vocabulary

These meanings apply across applications; surface-specific names live in the
[Chrome glossary](apps/saul/GLOSSARY.md) and [macOS glossary](apps/ez/GLOSSARY.md).

| Term                    | Meaning                                                                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Action                  | A configurable operation with declared inputs, one capability, instructions, a default preset and a result contract. Illustration is a Draw action.                                                   |
| Capability              | The operation a provider supports and an action requires: `Write` returns text; `Draw` returns an image; `Speak` returns speech in a preset preview. These are domain operations, not endpoint names. |
| Preset                  | Named choices binding a connection, capability, model and supported options. Credentials are resolved separately.                                                                                     |
| Provider                | A supported service integration: its authentication method, generation protocols and capabilities. Many saved connections can use the same provider.                                                  |
| Connection              | A saved account or endpoint instance of a provider, with a stable identity. A preset selects one connection; adding another account or endpoint creates another connection.                           |
| Attempt / run           | One explicit execution with frozen inputs, preset, provider, status and available output. Local types may retain established names.                                                                   |
| Source context          | Captured text and optional provenance supplied by the surface.                                                                                                                                        |
| Surface                 | A presentation and input mechanism, such as a browser card or native panel.                                                                                                                           |
| Input/output inspection | Read-only view of a run's saved instructions, inputs, prompt and literal response.                                                                                                                    |

**Recipe** is a legacy storage/code name for Action, not a separate product concept.
Existing JSON keys such as `recipes` and `recipeSnapshot` remain migration contracts.

Use Settings, History, Details, More, Save, Cancel, Copy and Stop consistently.
Explain submits a captured passage; Run executes an EZ action; Send submits a message or follow-up. Reuse restores a
draft; Regenerate starts another attempt. Shared words do not imply shared storage.

**Min Mode** is the compact everyday presentation with routine guidance omitted.
**Refresh** reads current state; **Reload** reads saved settings. Neither generates.
