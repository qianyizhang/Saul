# Project Idea
i want to build a chrome extension does the following

- basically simplified kimi explorer, but i tune the knobs, eg. prompt, context, and model provider etc
- can highlight text, then widget pop up (currently one, maybe extend to more)
- current widget does explaination with underscore -> hover to tooltip
- have a local first sql records all the clicked text/url/position and llm returned message

# GPT response
Yes. This is a fairly clean extension architecture. I would **not** model the core as an “agent” yet. It is better as a deterministic interaction pipeline with pluggable widgets, context policies, prompts, and LLM providers.

## Architecture I would use

```text
┌──────────────────────── Web Page ────────────────────────┐
│                                                         │
│  user selects text                                      │
│       │                                                 │
│       ▼                                                 │
│  Content Script                                         │
│  ├─ SelectionCapture                                    │
│  ├─ SelectionAnchor                                     │
│  └─ FloatingWidgetHost  ← Shadow DOM                    │
│          │                                              │
└──────────│───────────────────────────────────────────────┘
           │ ExplainRequest
           ▼
┌──────────────── Extension Runtime ───────────────────────┐
│                                                         │
│  MV3 Service Worker                                     │
│  └─ message/router + permissions                        │
│           │                                             │
│           ▼                                             │
│  Offscreen Runtime                                     │
│  ├─ WidgetRuntime                                      │
│  ├─ ContextBuilder                                     │
│  ├─ PromptRenderer                                     │
│  ├─ LLMProvider                                        │
│  │    ├─ OpenAI                                        │
│  │    ├─ Anthropic                                     │
│  │    └─ Gemini / OpenRouter / local                   │
│  │                                                     │
│  └─ SQLite Worker                                      │
│       └─ SQLite WASM + OPFS                             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

I would use **WXT + TypeScript + React/Preact**. WXT is currently at v0.21.x, supports MV3, generates the manifest, handles content/background entrypoints, and supports React/Svelte/Vue/Solid cleanly. ([WXT][1])

The separation above matters because MV3 service workers are deliberately ephemeral; Chrome normally terminates one after around 30 seconds of inactivity. Persisted state therefore should not live in service-worker globals. ([Chrome for Developers][2])

---

# 1. Treat the selected text as a first-class object

Don't just pass:

```ts
{
  text: "some selected text",
  url: location.href
}
```

Create something closer to:

```ts
interface SelectionSnapshot {
  id: string

  text: string

  page: {
    url: string
    canonicalUrl?: string
    title: string
  }

  anchor: {
    // robust way to relocate selection later
    exact: string
    prefix: string
    suffix: string

    // useful when document hasn't changed
    textStart?: number
    textEnd?: number

    // debugging/fallback
    domPath?: string
    startOffset?: number
    endOffset?: number
  }

  viewport: {
    x: number
    y: number
    width: number
    height: number
    scrollX: number
    scrollY: number
  }

  capturedAt: number
}
```

This distinction is important:

**screen position**

```text
x=421, y=372
```

is useful for reproducing the UI event but nearly useless for locating the text again.

**DOM XPath / CSS selector**

```text
article > div:nth-child(3) > p:nth-child(7)
```

is better but brittle when the page changes.

What you actually want for durable history is conceptually the Web Annotation `TextQuoteSelector` approach:

```text
prefix + exact selected text + suffix
```

So if the DOM changes slightly, you can usually find the selection again.

I would store **all three** because storage is cheap.

---

# 2. Make `Widget` the primary extension point

Your current widget is:

```text
Explain
```

But don't encode "explanation" throughout the extension.

Define:

```ts
interface WidgetDefinition {
  id: string
  label: string

  trigger: "selection"

  contextPolicy: ContextPolicy
  prompt: PromptTemplate
  model: ModelRoute

  renderer: WidgetRenderer
}
```

For example:

```ts
const explainWidget: WidgetDefinition = {
  id: "explain",

  label: "Explain",

  trigger: "selection",

  contextPolicy: {
    selection: true,
    surroundingParagraph: true,
    pageTitle: true,
    pageUrl: true,
    articleContext: false,
  },

  prompt: EXPLAIN_PROMPT,

  model: {
    provider: "openai",
    model: "gpt-5-mini",
  },

  renderer: "annotated-text",
}
```

Later you can add:

```text
Explain
Translate
Define
Critique
Find evidence
Ask about this
ELI5
Technical deep dive
Save as note
```

without changing selection capture.

That's the boundary I would preserve aggressively:

```text
SelectionCapture
       ↓
WidgetDefinition
       ↓
ContextBuilder
       ↓
LLM Runtime
       ↓
WidgetRenderer
```

---

# 3. Don't use `_underscore_` as the actual LLM protocol

This is the one piece I would change immediately.

You can **render** the result as:

> The model uses *self-attention* to construct a contextual representation.

and hovering `_self-attention_` shows an explanation.

But don't ask the model to encode semantic information into Markdown punctuation.

Instead have the model return something like:

```json
{
  "text": "The model uses self-attention to construct a contextual representation.",
  "annotations": [
    {
      "start": 15,
      "end": 29,
      "label": "self-attention",
      "tooltip": "A mechanism where each token selectively attends to other tokens."
    }
  ]
}
```

Then your renderer does:

```text
text
 ↓
annotation spans
 ↓
<span class="annotated">self-attention</span>
 ↓ hover
tooltip
```

Even better, avoid character offsets because LLMs occasionally screw them up:

```json
{
  "segments": [
    {
      "type": "text",
      "text": "The model uses "
    },
    {
      "type": "annotation",
      "text": "self-attention",
      "tooltip": "A mechanism where ..."
    },
    {
      "type": "text",
      "text": " to construct a contextual representation."
    }
  ]
}
```

This is much more robust.

The UI can still display the annotated segment with an underline.

---

# 4. Context should itself be configurable

I suspect this will become one of the most useful knobs in your version of Kimi Explorer.

Something like:

```ts
interface ContextPolicy {
  selection: boolean

  nearbyText?: {
    beforeChars: number
    afterChars: number
  }

  containingParagraph?: boolean
  containingSection?: boolean

  pageTitle?: boolean
  pageUrl?: boolean

  article?: {
    enabled: boolean
    maxChars: number
  }

  metadata?: boolean
}
```

Then your UI could eventually expose:

```text
Context

[x] selection
[x] containing paragraph
[x] page title
[x] URL
[ ] surrounding section
[ ] full article

Max context: 8K
```

This is much better than having prompts themselves scrape/request context.

### Important boundary

`ContextBuilder` decides **what information exists**.

`PromptRenderer` decides **how that information is presented to the model**.

Don't combine them.

```text
bad

getExplainPrompt(selection, document, url, paragraph, ...)


better

context = contextBuilder.build(selection, policy)

messages = promptRenderer.render(template, context)
```

That lets you independently experiment with:

```text
same context + different prompt

different context + same prompt

same everything + different model
```

which sounds like exactly what you want.

---

# 5. Local-first SQL

Since you specifically want SQL, I would actually use SQLite rather than pretending IndexedDB is SQL-shaped.

Official SQLite WASM supports browser-persistent SQLite through **OPFS**, and its distribution provides worker-oriented interfaces for running the DB outside the UI thread. ([sqlite.org][3])

For an MV3 extension you also need to explicitly permit WebAssembly:

```json
{
  "content_security_policy": {
    "extension_pages":
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  }
}
```

Chrome explicitly supports `'wasm-unsafe-eval'` for extension pages. ([Chrome for Developers][4])

I would start with roughly this schema:

```sql
CREATE TABLE page (
    id              TEXT PRIMARY KEY,
    url             TEXT NOT NULL,
    canonical_url   TEXT,
    title           TEXT,
    first_seen_at   INTEGER NOT NULL,
    last_seen_at    INTEGER NOT NULL
);

CREATE TABLE selection (
    id              TEXT PRIMARY KEY,
    page_id         TEXT NOT NULL REFERENCES page(id),

    text            TEXT NOT NULL,
    prefix          TEXT,
    suffix          TEXT,

    text_start      INTEGER,
    text_end        INTEGER,

    dom_path        TEXT,
    dom_start       INTEGER,
    dom_end         INTEGER,

    rect_json       TEXT,

    created_at      INTEGER NOT NULL
);

CREATE TABLE llm_run (
    id                  TEXT PRIMARY KEY,
    selection_id        TEXT NOT NULL REFERENCES selection(id),

    widget_id           TEXT NOT NULL,

    provider            TEXT NOT NULL,
    model               TEXT NOT NULL,

    prompt_version      TEXT,
    prompt_json         TEXT NOT NULL,
    context_json        TEXT NOT NULL,

    response_text       TEXT,
    response_json       TEXT,

    input_tokens        INTEGER,
    output_tokens       INTEGER,
    latency_ms          INTEGER,

    status              TEXT NOT NULL,
    error               TEXT,

    created_at          INTEGER NOT NULL
);

CREATE TABLE interaction (
    id              TEXT PRIMARY KEY,
    selection_id    TEXT REFERENCES selection(id),
    llm_run_id      TEXT REFERENCES llm_run(id),

    event_type      TEXT NOT NULL,
    event_json      TEXT,

    created_at      INTEGER NOT NULL
);
```

Notice that I deliberately store:

```text
prompt
context
provider
model
response
```

rather than only:

```text
selected_text → response
```

That gives you **experiment reproducibility**.

Six months later you can query:

```sql
SELECT
    model,
    prompt_version,
    avg(latency_ms),
    avg(input_tokens + output_tokens)
FROM llm_run
GROUP BY model, prompt_version;
```

or:

```sql
SELECT *
FROM llm_run
WHERE widget_id = 'explain'
  AND model = 'gemini-3-flash';
```

That becomes surprisingly valuable.

---

# 6. I would give SQLite its own runtime

This is where the Chrome-specific architecture gets slightly weird.

Chrome's offscreen API gives MV3 extensions a hidden extension document, and explicitly supports a `WORKERS` reason for spawning workers. ([Chrome for Developers][5])

So I'd use:

```text
background service worker
        │
        │ ensureRuntime()
        ▼
offscreen.html
        │
        ├── sqlite.worker.ts
        │
        └── perhaps LLM runtime
```

Conceptually:

```ts
// service-worker
async function execute(req: RuntimeRequest) {
  await ensureOffscreenRuntime()

  return chrome.runtime.sendMessage({
    target: "runtime",
    ...req
  })
}
```

The offscreen runtime can then own:

```ts
class Runtime {
  db: LocalStore
  models: ModelRegistry
  widgets: WidgetRegistry

  explain(request) { ... }
}
```

This is much cleaner than pretending the MV3 service worker is your long-lived Node process.

---

# 7. Provider abstraction: keep it deliberately boring

Don't introduce LangChain or a large agent framework here.

Something like this is enough:

```ts
interface LLMProvider {
  generate(
    request: GenerateRequest,
    signal?: AbortSignal
  ): AsyncIterable<LLMEvent>
}
```

with:

```ts
type LLMEvent =
  | { type: "text-delta"; text: string }
  | { type: "structured-result"; value: unknown }
  | { type: "usage"; input: number; output: number }
  | { type: "done" }
```

and:

```ts
class OpenAIProvider implements LLMProvider {}
class AnthropicProvider implements LLMProvider {}
class GeminiProvider implements LLMProvider {}
class OpenAICompatibleProvider implements LLMProvider {}
```

Then model configuration becomes data:

```ts
{
  id: "fast",
  provider: "openai-compatible",
  baseUrl: "https://...",
  model: "...",
  temperature: 0.2
}
```

rather than:

```ts
if (model === ...)
```

throughout your application.

---

# 8. UI: content script + Shadow DOM

The floating widget should live in a **ShadowRoot**.

Otherwise every sufficiently strange website eventually destroys your UI with:

```css
div {
  all: ...
}

button {
  ...
}

* {
  box-sizing: ...
}
```

Structure:

```html
<body>
  webpage...
  
  #shadow-root
    <explorer-root>
      <selection-menu />
      <explanation-card>
         <annotated-text />
         <tooltip />
      </explanation-card>
    </explorer-root>
</body>
```

Your content script should be responsible only for:

```text
mouse/pointer selection
selection geometry
widget placement
rendering
messages to runtime
```

It should **not** contain provider API keys, prompt logic, SQLite, etc.

---

# 9. API keys

For BYOK, I would put credentials in `chrome.storage.local`, not SQLite, and restrict the storage area to trusted extension contexts.

By default `storage.local` is accessible to content scripts, but Chrome lets an extension change that with `setAccessLevel()` and restrict it to `TRUSTED_CONTEXTS`. ([Chrome for Developers][6])

For example:

```ts
await chrome.storage.local.setAccessLevel({
  accessLevel: "TRUSTED_CONTEXTS"
})
```

Then:

```text
API credentials
    → chrome.storage.local

history / selections / responses / analytics
    → SQLite
```

There is no meaningful way for a purely client-side extension to make a user-supplied API key cryptographically secret from the user who owns the machine, but you can and should isolate it from arbitrary webpages/content-script access.

---

# The bounded contexts I would actually implement

| Boundary    | Responsibility                                          |
| ----------- | ------------------------------------------------------- |
| `capture`   | Turn browser selection into durable `SelectionSnapshot` |
| `surface`   | Floating UI, widget positioning, tooltips               |
| `widgets`   | Define available operations                             |
| `context`   | Turn selection + page into model context                |
| `prompting` | Render context through prompt templates                 |
| `models`    | Provider/model abstraction and streaming                |
| `history`   | Persist selections, runs and interactions               |
| `settings`  | Provider, model, prompt and context configuration       |

Crucially:

```text
capture knows nothing about LLMs

widgets know nothing about Chrome DOM

models know nothing about selected text

history knows nothing about UI
```

That will keep this small even when features accumulate.

---

# MVP repository shape

```text
src/
├── entrypoints/
│   ├── background.ts
│   │
│   ├── content/
│   │   ├── index.tsx
│   │   └── style.css
│   │
│   ├── offscreen/
│   │   ├── index.html
│   │   └── main.ts
│   │
│   └── options/
│   │   ├── index.html
│   │   └── App.tsx
│
├── capture/
│   ├── selection.ts
│   └── anchor.ts
│
├── surface/
│   ├── FloatingWidget.tsx
│   ├── AnnotatedText.tsx
│   └── Tooltip.tsx
│
├── widgets/
│   ├── types.ts
│   ├── registry.ts
│   └── explain.ts
│
├── context/
│   ├── types.ts
│   └── builder.ts
│
├── prompting/
│   ├── template.ts
│   └── prompts/
│       └── explain.ts
│
├── models/
│   ├── provider.ts
│   ├── registry.ts
│   ├── openai.ts
│   ├── anthropic.ts
│   └── gemini.ts
│
├── storage/
│   ├── db.ts
│   ├── schema.sql
│   ├── history-repository.ts
│   └── sqlite.worker.ts
│
└── shared/
    ├── messages.ts
    └── ids.ts
```

## The first vertical slice I would build

```text
select text
   ↓
SelectionSnapshot
   ↓
floating "Explain" button
   ↓
click
   ↓
save SelectionSnapshot
   ↓
ContextBuilder
   ↓
ExplainWidget
   ↓
OpenAI-compatible provider
   ↓
stream structured explanation
   ↓
AnnotatedText renderer
   ↓
save LLMRun
```

Nothing else.

Specifically, **do not build the widget framework UI, prompt editor, model-management interface, history browser, sync or full-page context yet**. Put the abstractions in place, but hard-code one instance through them.

Once that works, your second vertical slice can simply change:

```ts
widgets.register(explain)
```

into:

```ts
widgets.register(explain)
widgets.register(translate)
widgets.register(eli5)
```

and you will know whether the abstractions are real rather than speculative.

This is small enough that the first implementation can remain on the order of a few thousand lines, while the architecture already supports the larger “Kimi Explorer where every knob is mine” direction.

[1]: https://wxt.dev/?utm_source=chatgpt.com "Next-gen Web Extension Framework – WXT"
[2]: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle?hl=en&utm_source=chatgpt.com "The extension service worker lifecycle  |  Chrome for Developers"
[3]: https://sqlite.org/wasm/doc/c1244b92ce/building.md?utm_source=chatgpt.com "Building JS/WASM Bundles"
[4]: https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy?utm_source=chatgpt.com "Manifest - Content Security Policy  |  Chrome Extensions  |  Chrome for Developers"
[5]: https://developer.chrome.com/docs/extensions/reference/api/offscreen?utm_source=chatgpt.com "chrome.offscreen  |  API  |  Chrome for Developers"
[6]: https://developer.chrome.com/docs/extensions/reference/api/storage?utm_source=chatgpt.com "chrome.storage  |  API  |  Chrome for Developers"
