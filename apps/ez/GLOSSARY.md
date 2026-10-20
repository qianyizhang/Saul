# EZ language

EZ has two lookup surfaces in one app. Their responsibilities are defined in
[the surface contract](docs/surfaces.md).

## Language

**Main window**:
The full EZ workspace for lookups, history, and configuration.
_Avoid_: Full app

**Quick Lookup panel**:
The compact lookup surface available while working in another app.
_Avoid_: Lite app, quick app, Quick Look

**Recipe**:
A named prompt template with input fields and a default model preset.
_Avoid_: Mode, nugget

**Model preset**:
A named choice of model, reasoning effort, and Fast/Normal service.

**Lookup**:
One independent request and its answer, using a recipe, input values, and a preset.

**Input/output inspection**:
A view of one lookup's saved prompt, context or input fields, and response.
_Avoid_: Debug mode

**Preset override**:
A temporary preset choice for the current lookup, replacing the recipe's default.
