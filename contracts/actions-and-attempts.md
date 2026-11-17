# Actions and attempts

## Action preparation

Prepare an action with its supplied inputs and an explicit preset. Return the
rendered instructions and prompt plus frozen choices, or a validation error.
Preparation never sends, changes configuration or silently selects another route.

- Substitute `{{field name}}` literally once. Preserve Unicode and whitespace.
- Reject blank required values, unavailable fields, malformed delimiters,
  expressions, control blocks and oversized templates.
- Saul requires `text` and accepts a fixed set of page-context fields; enabled
  source context may be appended once. EZ forms support up to 16 named fields.
  Actions are app-scoped, with no interchange guarantee.
- Inspection reads the selected attempt's saved input and output, without
  rebuilding it from current settings.

[Template fixtures](fixtures/templates.json) cover the shared substitution
subset in production TypeScript and Swift. Native checks resolve them relative
to the test source.

## Execution

An attempt freezes instructions, input and model choices when submitted.
Later edits affect new work. A retry uses the frozen connection, endpoint,
account, model and billing route; an unavailable or changed route blocks without
fallback. Restoring a draft does not send, and dismissing a view does not Stop.

Publish saved success only after provider completion and a successful local
commit. Distinguish interruption, cancellation and provider or storage failure.
Keep partial output when it can be saved. A failed save can lose unsaved output;
report it as unsaved. There is no save-only recovery queue or automatic
inference replay after import, restart or uncertain loss. Another generation
requires explicit action. Saved history and configuration remain intact unless
explicitly deleted or reset.

[Attempt fixtures](fixtures/attempts.json) exercise Saul's ReadingRunner and EZ's
AttemptExecution through AppModel. They check send counts, output and saved
success across initial/terminal save failure, provider error, missing completion,
cancellation and success. A terminal save failure can omit transient output.
[History](history.md) covers shared persistence; capture, anchors and scheduling
are app-specific.
