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
commit. Explicit Stop records cancellation; loss or recovery of an active
attempt records interruption. Both may retain partial output and allow an
explicit retry. Older interrupted records retain their saved status because
their cause is unknown. Provider and storage failures remain separate.
EZ removes its pending row when generation or completion validation fails.
It keeps the error and any partial output in the current result for explicit
Retry. Saul retains its own failed attempts. A failed save can lose unsaved output;
report it as unsaved. There is no save-only recovery queue or automatic
inference replay after import, restart or uncertain loss. Another generation
requires explicit action. Saved history and configuration remain intact unless
explicitly deleted or reset.

[Attempt fixtures](fixtures/attempts.json) exercise Saul's ReadingRunner and EZ's
AttemptExecution through LookupSession. They check send counts, output and saved
success across initial/terminal save failure, provider error, missing completion
and success. The fixtures assert the saved cause for Stop and interruption.
A terminal save failure can omit transient output.
[History](history.md) covers shared persistence; capture, anchors and scheduling
are app-specific.

## Stream completion

Saul's direct and signed Chat Completions routes and EZ's compatible endpoints
consume the same [compatible chat fixtures](fixtures/compatible-chat.json).
A `stop` finish reason ends the stream. A bare `[DONE]` marker also ends it
if the provider has sent nonblank text. Use the first accepted terminal marker
and stop reading. Role-only deltas, null content, empty delta objects and a
usage chunk with empty choices do not signal completion. Preserve text as sent.

Malformed events, provider errors, non-stop finish reasons and EOF without an
accepted terminal marker fail the attempt. Stop cancels the stream. Neither
failure nor Stop turns retained partial output into saved success. A separate
output check still applies to a completed stream.

Native OpenAI Responses and the ChatGPT plan use the Responses protocol:
`response.completed` must carry status `completed`. `[DONE]` alone cannot
complete a Responses stream.
