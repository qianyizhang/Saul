# Shared vocabulary

These meanings apply across applications; surface-specific names live in the
[Chrome glossary](apps/saul/GLOSSARY.md) and [macOS glossary](apps/ez/GLOSSARY.md).

| Term                    | Meaning                                                                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Action                  | A configurable operation with declared inputs, one capability, instructions, a default preset and a result contract. Illustration is a Draw action.                                                              |
| Capability              | The operation a provider supports and an action requires: **Write** returns text; **Draw** returns an image; **Speak** returns speech in Saul’s preset preview. These are domain operations, not endpoint names. |
| Preset                  | Named choices binding a provider key, capability, model and supported options. Image size and quality belong here. Credentials are resolved separately.                                                          |
| Provider                | A named generation connection with a stable unique key, authentication route and supported capabilities. `gpt-plan` supports Write; `openai-api` supports Write, Draw and Speak.                                 |
| Connection              | The app-local endpoint or authorized account used by a provider. Credentials and active account selection remain app-owned.                                                                                      |
| Attempt / run           | One explicit execution with frozen inputs, preset, provider, status and available output. Local types may retain established names.                                                                              |
| Source context          | Captured text and optional provenance supplied by the surface.                                                                                                                                                   |
| Surface                 | A presentation and input mechanism, such as a browser card or native panel.                                                                                                                                      |
| Input/output inspection | Read-only view of a run's saved instructions, inputs, prompt and literal response.                                                                                                                               |

**Recipe** is a legacy storage/code name for Action, not a separate product concept.
Existing JSON keys such as `recipes` and `recipeSnapshot` remain migration contracts.

Use Settings, History, Details, More, Save, Cancel, Copy and Stop consistently.
Explain submits a captured passage; Run executes an EZ action; Send submits a follow-up. Use again restores a
draft; Regenerate starts another attempt. Shared words do not imply shared storage.
