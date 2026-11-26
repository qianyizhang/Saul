# Custom Calls

Use [Calls and summaries](calls.md) for page selection, reader and retry behavior.
This guide covers authoring and running trusted local modules. A custom Call runs
once per page; there is no combined-tab workflow, agent loop, package install,
file watcher or custom UI.

## Create, check and load

In **Settings → Calls → Customize Call Saul**, describe the call in **Call request** and
choose a model preset in **Build with**. **Create call** or **Revise call** sends one
request using that preset. Revision includes the current candidate (or selected source)
and the previous error/response as context. There is no automatic repair or retry.
Unsubmitted request, preset and file-path fields stay in the current tab's session
through navigation and reload. This draft cache starts no model work and changes
no approved Call.

The model returns exactly one JSON object:

```json
{
  "contractVersion": 1,
  "name": "Main claim",
  "description": "Explain the main claim and weakest evidence.",
  "language": "typescript",
  "source": "export default async function run(ctx) { return await ctx.generate({ instructions: 'Explain the main claim and its weakest evidence.' }); }"
}
```

The optional helper checks syntax and supported constructs and stages immutable
source bytes. Checking does not import the module. Malformed, refused and
incomplete output remains available for an explicit revision. Nothing is loaded
automatically.

Review **Candidate source**, choose a model preset in **Run with**, then click
**Save and select**. That click authorizes initialization of
trusted local code. Saul verifies the actual default export in a fresh Node worker
before changing the selected revision. Loading does not call the Call handler
or start model inference. Initialization errors preserve the old selection;
initialization side effects that already occurred cannot be undone.

**Run with** can use a different model preset from **Build with**. Save or reload
settings before changing either choice. Each page job freezes the connection,
model and options. The script cannot pass replacement model or billing choices to
`generate`. Missing capabilities block explicitly; there is no fallback.

## Action contract 1

“Action contract 1” is the existing native protocol name for custom Calls;
its stored fields, host identity and revision format are unchanged.

Modules are self-contained JavaScript or erasable TypeScript with one default
`async run(ctx)` function. No imports, npm packages, shell tools, direct network
calls or browser mutations are supported. Use these capabilities:

| Capability                             | Meaning                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `ctx.source`                           | Frozen `{title, url, coverage, text?, pdfUrl?}` for one captured page        |
| `ctx.generate({instructions, input?})` | Generate text using the frozen preset; returns a complete response or throws |
| `ctx.progress(text)`                   | Show a short progress message (at most 500 characters)                       |
| `ctx.signal`                           | Cancellation signal; use `throwIfAborted()` in longer workflows              |

Omitting `input` supplies the captured page input. A PDF URL remains attached even
when the Call supplies additional input text. URL attachments require a ChatGPT
plan preset. Choose Local PDF processing explicitly to use extracted text with
another provider. Existing PDF capture validation, limits and retry semantics
live in [source capture and PDFs](calls.md#source-capture-and-pdfs).

Return nonempty plain text or Markdown, at most 60,000 characters. The reader
renders Markdown through React nodes; raw HTML is literal text, images are not
loaded, and links accept only HTTP(S). Exports contain escaped plain text. Source
links and coverage remain Saul-owned. Intermediate model output appears only in
inspection. A failed Call never presents that output as a completed answer.

Each page Call allows at most **three model calls** and **five minutes**. Stop,
timeouts and disconnects cancel outstanding calls. A worker that cannot cooperate
is terminated; other active pages in that worker also fail honestly. There are no
automatic retries; see [saved Call behavior](calls.md#reuse-retry-and-run-again)
for interruption and frozen Retry.

### Text preparation and chains

A custom Call can clean `ctx.source.text` locally, pass the prepared text to
`ctx.generate`, then use the answer as input to a later request. This is one
page run with shared cancellation and one final result; intermediate model
requests remain available in inspection. Cleanup does not change the live page
or overwrite the saved capture. A PDF URL is not locally available text and stays
attached when explicit input is supplied.

The Call execution module owns these results and transcripts behind detached
progress snapshots; the runner owns scheduling and persistence. See
[Call runtime owners](calls.md#runtime-owners) for the implementation seam.
Site-specific Call selection (for example Hacker News versus Reddit) is a future
admission feature. Site-specific DOM extraction belongs to capture. This refactor
adds neither automatic site rules nor a separate workflow language, cross-page
chains or resumable steps. Existing scripts can branch on the captured URL.

## Local files, reload and recovery

**Local module and recovery → Check file** reads a regular local `.js`, `.mjs`,
`.ts` or `.mts` file under 60 KB. Review the staged candidate, then **Save and select**.
Editing the file alone changes neither selected code nor active work. Active jobs
remain pinned to their saved revision while future jobs can use a newly loaded one.
Use **Restore previous call** or **Use Summarize** explicitly to roll back.

The helper starts on demand and exits after 60 seconds without requests, loading
or active runs. Its next connection reloads the exact approved revision only when
requested. An idle restart is not a retry of any job.

The unified JSON `apps.saul.calls` scope owns saved custom Call choices and the
current Write preset reference for Summarize when the configuration helper is
available. The [Custom Actions store](../src/custom-actions/store.ts) writes
that scope and supplies approved revisions to Calls and Annotations. Browser-only
installations keep these choices locally. The Call editor
owns selection commands and the active build. Chrome's trusted extension storage
holds its draft separately from saved choices, through validated background messages.
Draft saves never rewrite selection. A failed or uncertain selection save is reported
without a compensating write; the next read reports the persistent owner's state.
The helper owns immutable revision files under `~/.saul/actions/revisions`, outside
installed runtime generations. History saves the exact Call source, revision,
frozen preset and model-call input/output. Reuse includes the Call revision and
preset ID as well as ordered URLs, so different Calls cannot reuse each other's
answers. Model-option edits under the same preset retain the saved result.
[Run again](calls.md#reuse-retry-and-run-again) freezes the current choices
after any required launch review.

Demand-driven cleanup during Call editing protects history-referenced revisions,
all saved call presets, the selected and previous revisions, the current candidate and live workers. Other
revisions older than seven days are removed. This is separate from disposable
developer artifacts; no permanent janitor runs.

## Optional installation and trust

```sh
node scripts/setup.mts --components actions --extension-id YOUR_EXTENSION_ID
```

`com.saul.actions` is a third independently selectable native host. It does not
replace `com.saul.chatgpt` or `com.saul.tabs`. The installer preserves their payloads
and registrations and retains runtime generations for explicit recovery. ChatGPT
inference still passes through the signed credential owner. Custom Calls
receive no tokens or direct SQLite interface. Browser-owned API keys remain in
trusted extension contexts. The signed owner keeps shared API keys in Keychain. See [setup](../../../docs/setup.md).

**User modules are trusted local Node code with OS permissions.** Static checks
define the supported contract. Workers and import restrictions are not a security
sandbox. Only load code you trust. Personal installations and live-provider calls
require their own explicit installation/testing actions.

## Annotation Calls

The annotation editor offers **Respond to annotations** and approved custom Calls.
Each selected annotation is a separate invocation with the existing three-model-call
and five-minute limits, at most two invocations active at once. Its frozen
`ctx.source.annotations` contains `{id, comment, evidence}`; `ctx.source.text` holds
that annotation's evidence. Screenshot input stays attached to `ctx.generate`, even
when the script supplies custom text. **Text evidence only** must be chosen explicitly.

Within annotation invocations, `ctx.annotations(operation)` uses the shared
[annotation operation contract](../shared/protocol/annotations.ts), limited to the assigned
annotation ID and at most 50 operations. Read/list and revision-checked changes use the
same owner as the editor. A successful change returns the new revision; failures are
per item. Ordinary page Calls cannot use this capability. Returning nonempty text
appends one final attributed reply. Use edits, completion or deletion only when the
user's Call request asks for them; page evidence never grants authority.

Each model request and output is retained in attempt inspection. Failed or interrupted
invocations do not append incomplete replies. A completed response that cannot be saved
reports failure; unsaved output may be discarded. Another response requires an explicit
action. The runner never retries inference on restart.
Annotation replies are limited to 16,000 characters; oversized evidence or output fails
explicitly. Shared generation connection/model validation remains unchanged.
