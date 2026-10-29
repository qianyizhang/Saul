# Custom Summarize action

Saul has one replaceable Summarize slot. Its default remains the built-in bilingual
summary and needs no action helper. Custom actions run once per selected page, in
source order with two pages processed concurrently. There is no combined-tab
workflow, agent loop, package installation, file watcher or custom executable UI.

## Create, check and load

In **Settings → Summaries → Customize Summarize**, choose a saved **Builder preset**
and describe the action. **Create action** or **Revise action** sends one request
using that preset. Revision includes the current candidate (or selected source)
and the previous error/response as context. There is no automatic repair or retry.
Unsubmitted request, preset and file-path fields stay in the current tab's session
through navigation and reload. This draft cache starts no model work and changes
no approved action.

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

Review **Candidate source**, choose an existing **Action preset**, then click
**Load action** or **Replace action**. That click authorizes initialization of
trusted local code. Saul verifies the actual default export in a fresh Node worker
before changing the selected revision. Loading does not call the action handler
or start model inference. Initialization errors preserve the old selection;
initialization side effects that already occurred cannot be undone.

The next deliberate Summarize uses the selected action. The action preset can
differ from the builder preset. Saved model settings must be saved/reloaded before
using either choice. Each page job freezes its provider, account/connection, model
and options. The script cannot pass replacement model or billing choices to
`generate`. Missing capabilities block explicitly; there is no fallback.

## Action contract 1

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
when the action supplies additional input text. URL attachments require a ChatGPT
plan preset. Choose Local PDF processing explicitly to use extracted text with
another provider. Existing PDF capture validation, limits and retry semantics
remain in [the summary owner](architecture.md#summary-ownership).

Return nonempty plain text or Markdown, at most 60,000 characters. The reader
renders Markdown through React nodes; raw HTML is literal text, images are not
loaded, and links accept only HTTP(S). Exports contain escaped plain text. Source
links and coverage remain Saul-owned. Intermediate model output appears only in
inspection. A failed action never presents that output as a completed answer.

Each page action allows at most **three model calls** and **five minutes**. Stop,
timeouts and disconnects cancel outstanding calls. A worker that cannot cooperate
is terminated; other active pages in that worker also fail honestly. There are no
automatic retries. Browser restart marks unfinished jobs interrupted and never
resends them. Explicit Retry retains the original source, revision and model
choices; credentials are resolved only through their existing owner.

## Local files, reload and recovery

**Local module and recovery → Check file** reads a regular local `.js`, `.mjs`,
`.ts` or `.mts` file under 60 KB. Review the staged candidate, then Load/Replace.
Editing the file alone changes neither selected code nor active work. Active jobs
remain pinned to their saved revision while future jobs can use a newly loaded one.
Use **Restore previous action** or **Use built-in summary** explicitly to roll back.

The helper starts on demand and exits after 60 seconds without requests, loading
or active runs. Its next connection reloads the exact approved revision only when
requested. An idle restart is not a retry of any job.

Chrome's trusted extension storage owns the selected/previous choices and builder
draft. The offscreen owner accesses it through validated background messages.
The helper owns immutable revision files under `~/.saul/actions/revisions`, outside
installed runtime generations. History saves the exact action source, revision,
frozen preset and model-call input/output. Reuse includes the action revision and
preset ID as well as ordered URLs, so different actions cannot reuse each other's
answers. Model-option edits under the same preset retain the saved result; Run
again explicitly freezes the current choices.

Demand-driven cleanup on create, stage and load operations protects history-referenced revisions,
the selected and previous revisions, the current candidate and live workers. Other
revisions older than seven days are removed. This is separate from disposable
developer artifacts; no permanent janitor runs.

## Optional installation and trust

```sh
node scripts/setup.mts --components actions --extension-id YOUR_EXTENSION_ID
```

`com.saul.actions` is a third independently selectable native host. It does not
replace `com.saul.chatgpt` or `com.saul.tabs`. The installer preserves their payloads
and registrations and retains runtime generations for explicit recovery. ChatGPT
inference still passes through the existing ChatGPT credential/refresh owner;
actions receive no tokens or direct SQLite interface. API credentials remain in
trusted extension contexts. See [setup](../../../docs/setup.md).

**User modules are trusted local Node code with OS permissions.** Static checks
define the supported contract. Workers and import restrictions are not a security
sandbox. Only load code you trust. Personal installations and live-provider calls
require their own explicit installation/testing actions.
