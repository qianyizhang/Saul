# Shared vocabulary

These meanings apply across applications; surface-specific names live in the
[Chrome glossary](apps/saul/GLOSSARY.md) and [macOS glossary](apps/ez/GLOSSARY.md).

| Term                    | Meaning                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Recipe                  | Named prompt template, required inputs and a default model preset. Explain and Lookup are recipes, not widgets or providers.            |
| Model preset            | Named provider/model choices and supported options. Credentials are resolved separately.                                                |
| Provider                | Service that executes generation. It is distinct from a preset and an account.                                                          |
| Connection              | App-local binding to a provider endpoint or authorized account.                                                                         |
| Attempt                 | One explicit execution with frozen inputs, chosen configuration, status and available output. Local types may retain established names. |
| Source context          | Captured text and optional provenance supplied by the surface.                                                                          |
| Surface                 | A presentation and input mechanism, such as a browser card or native panel.                                                             |
| Input/output inspection | Read-only view of an attempt's saved instructions, inputs, prompt and literal response.                                                 |

Use Settings, History, Details, More, Save, Cancel, Copy and Stop consistently.
Explain submits a captured passage; Send submits a draft. Use again restores a
draft; Regenerate starts another attempt. Shared words do not imply shared storage.
