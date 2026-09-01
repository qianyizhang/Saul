# Technical Specification: Saul (AI Reading & Concept Explorer Extension)

**Status:** Locked Architecture & Decision Record  
**Target Platform:** Chrome Extension Manifest V3 (MV3)  
**Core Framework:** WXT + TypeScript + React + Tailwind CSS  
**Package Manager:** pnpm  

---

## 1. Executive Summary & Vision

**Saul** is a local-first, highly configurable AI reading assistant and concept explorer Chrome extension. It lets users highlight any text on a webpage, inspect inline term-level explanations (rendered as interactive underlined terms with hoverable tooltips), and tune every "knob" of the interaction:
- **Model Providers:** OpenAI-compatible (OpenAI, DeepSeek, Ollama, Kimi, OpenRouter), Anthropic, Gemini, Chrome Built-in Prompt API, and future `pi-llm` / `pi-core` integration.
- **Context Policies:** Surrounding paragraph, section, full article, page metadata (fully customizable by policy).
- **Prompt Engineering:** Customizable system & widget prompt templates with versioning.
- **Local-First SQLite Memory:** Durable, queryable history of all selections, context, prompts, tokens, latency, and model outputs with Full-Text Search (FTS5).

---

## 2. Decision Log & Staged Scope

| # | Topic | Locked Decision | Caveats & Extension Points |
|---|---|---|---|
| **1** | **Streaming Protocol** | XML-like inline tags (`<term note="...">word</term>`) with a token-by-token state machine parser. | Allows instant typewriter render with live pulsing underlines that convert to interactive tooltips upon tag close. |
| **2** | **Storage Engine** | Official `@sqlite.org/sqlite-wasm` + OPFS in a dedicated Worker inside Offscreen Document + FTS5. | Direct pure SQL from Day 1. Automatic schema migrations and instant full-text search over all selections and explanations. |
| **3** | **Selection & Trigger UX** | Floating Action Button (FAB) positioned via `@floating-ui/dom` near the selection end. | **Extensibility:** UI trigger decoupled via `TriggerStrategy` interface so post-MVP we can experiment with auto-trigger, multi-action toolbars, and shortcuts. |
| **4** | **Model Providers & BYOK** | Generic OpenAI-Compatible streaming adapter + Chrome Built-in Prompt API (`window.ai`). | **Extensibility:** Adapter-based `LLMProvider` interface allows drop-in integration of `pi-llm` / `pi-core` or bespoke BYOK providers. |
| **5** | **Context Extraction** | Default: `Selection + Containing Paragraph + Page Title + Canonical URL`. | **Extensibility:** `ContextPolicy` config schema is isolated from `ContextBuilder`. Settings UI sliders for custom window sizes will be wired in Phase 2. |

---

## 3. System Architecture

```text
┌──────────────────────────────── Web Page ────────────────────────────────┐
│                                                                          │
│  User selects text                                                       │
│       │                                                                  │
│       ▼                                                                  │
│  Content Script (Isolated World)                                         │
│  ├─ SelectionCapture (TextQuoteSelector: exact, prefix, suffix, rects)   │
│  └─ ShadowRoot (<saul-root>)                                             │
│       ├─ FloatingActionButton (@floating-ui/dom positioning)             │
│       ├─ CardContainer                                                   │
│       └─ AnnotatedStreamView (Typewriter streaming + Tooltip portals)    │
│                                                                          │
└───────────────────────────────────┬──────────────────────────────────────┘
                                    │ chrome.runtime.connect (Port)
                                    ▼
┌────────────────────── Extension Runtime (Background) ────────────────────┐
│                                                                          │
│  MV3 Service Worker (Ephemeral router & lifecycle coordinator)           │
│       │                                                                  │
│       ▼ ensureOffscreenDocument()                                         │
│  Offscreen Document / Dedicated Worker                                   │
│  ├─ ContextBuilder (Extracts paragraph, title, url per policy)           │
│  ├─ PromptRenderer (Substitutes context into versioned templates)        │
│  ├─ LLMStreamer (OpenAI / Anthropic / Gemini / Chrome Prompt API)        │
│  │    └─ Streaming Token Engine (Tag parser)                             │
│  └─ SQLite WASM + OPFS Engine                                            │
│       ├─ Schema Migrations                                               │
│       ├─ Full-Text Search (FTS5)                                         │
│       └─ Selections, Runs & Interactions persistence                     │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Core Data Contracts

### 4.1 SelectionSnapshot
```typescript
export interface SelectionSnapshot {
  id: string; // nanoid / uuid
  text: string;
  page: {
    url: string;
    canonicalUrl?: string;
    title: string;
    favicon?: string;
  };
  anchor: {
    exact: string;
    prefix: string;
    suffix: string;
    textStart?: number;
    textEnd?: number;
    domPath?: string;
  };
  viewport: {
    x: number;
    y: number;
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
  };
  capturedAt: number; // Unix timestamp ms
}
```

### 4.2 Context Policy & Builder
```typescript
export interface ContextPolicy {
  includeSelection: boolean;
  surroundingCharacters?: {
    before: number;
    after: number;
  };
  includeContainingParagraph: boolean;
  includeContainingHeading: boolean;
  includePageMetadata: boolean;
  maxContextTokens?: number;
}

export interface ResolvedContext {
  selection: string;
  surroundingText?: string;
  paragraph?: string;
  heading?: string;
  pageTitle: string;
  pageUrl: string;
}
```

### 4.3 Widget Definition
```typescript
export interface WidgetDefinition {
  id: string;
  label: string;
  icon?: string;
  description: string;
  defaultPromptVersion: string;
  defaultModelRouteId: string;
  contextPolicy: ContextPolicy;
  renderMode: 'annotated-inline' | 'markdown-card' | 'replacement';
}
```

---

## 5. Streaming & Annotation Protocol

To achieve high-speed, typewriter-style streaming without waiting for full JSON response payloads, the LLM outputs a clean DSL markup:

```text
The transformer utilizes <term note="A neural mechanism computing dynamic weightings across all tokens">self-attention</term> to capture global sequence dependencies.
```

### Streaming Parser Pipeline:
1. **Lexer / State Machine:** Reads incoming token chunks character-by-character.
2. **Text Nodes:** Rendered immediately to the UI DOM.
3. **Term Nodes:** When `<term note="...">...</term>` is encountered:
   - Live partial text is underlined with a subtle pulsating indicator while streaming.
   - When closed, converts into an interactive `<span class="saul-term" data-tooltip="...">` with floating tooltip popover.

---

## 6. Local-First SQLite Schema

```sql
-- Track pages visited / highlighted
CREATE TABLE IF NOT EXISTS page (
    id              TEXT PRIMARY KEY,
    url             TEXT NOT NULL UNIQUE,
    canonical_url   TEXT,
    title           TEXT,
    first_seen_at   INTEGER NOT NULL,
    last_seen_at    INTEGER NOT NULL
);

-- Selections made on pages
CREATE TABLE IF NOT EXISTS selection (
    id              TEXT PRIMARY KEY,
    page_id         TEXT NOT NULL REFERENCES page(id) ON DELETE CASCADE,
    text            TEXT NOT NULL,
    prefix          TEXT,
    suffix          TEXT,
    text_start      INTEGER,
    text_end        INTEGER,
    dom_path        TEXT,
    rect_json       TEXT,
    created_at      INTEGER NOT NULL
);

-- Full-Text Search on selections
CREATE VIRTUAL TABLE IF NOT EXISTS selection_fts USING fts5(
    text,
    content='selection',
    content_rowid='rowid'
);

-- Record of every LLM generation
CREATE TABLE IF NOT EXISTS llm_run (
    id                  TEXT PRIMARY KEY,
    selection_id        TEXT NOT NULL REFERENCES selection(id) ON DELETE CASCADE,
    widget_id           TEXT NOT NULL,
    provider            TEXT NOT NULL,
    model               TEXT NOT NULL,
    prompt_version      TEXT NOT NULL,
    prompt_raw          TEXT NOT NULL,
    context_json        TEXT NOT NULL,
    response_raw        TEXT,
    response_structured TEXT,
    input_tokens        INTEGER,
    output_tokens       INTEGER,
    latency_ms          INTEGER,
    status              TEXT NOT NULL, -- 'running' | 'completed' | 'failed' | 'aborted'
    error_message       TEXT,
    created_at          INTEGER NOT NULL
);

-- Full-Text Search on LLM explanations
CREATE VIRTUAL TABLE IF NOT EXISTS llm_run_fts USING fts5(
    response_raw,
    content='llm_run',
    content_rowid='rowid'
);

-- User interaction logs (hover tooltips, copies, ratings)
CREATE TABLE IF NOT EXISTS interaction (
    id              TEXT PRIMARY KEY,
    selection_id    TEXT REFERENCES selection(id) ON DELETE SET NULL,
    llm_run_id      TEXT REFERENCES llm_run(id) ON DELETE SET NULL,
    event_type      TEXT NOT NULL, -- 'tooltip_hover', 'copy_explanation', 'thumbs_up'
    event_data      TEXT,
    created_at      INTEGER NOT NULL
);
```

---

## 7. Security & Storage Boundaries

1. **API Keys Isolation:**
   - Stored in `chrome.storage.local` with `setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })`.
   - Never exposed or sent to Content Scripts.
2. **Shadow DOM Sandbox:**
   - UI elements live inside a closed/open Shadow Root attached to `document.body`.
   - Isolated from host page CSS and event bleeding (`stopPropagation` on internal clicks).
3. **CSP Compliance:**
   - Manifest V3 compliant, no inline script tags, `'wasm-unsafe-eval'` configured for SQLite WASM.

---

## 8. Implementation Roadmap

- **Phase 1 (MVP Vertical Slice):**
  - Project initialization with WXT + React + Tailwind + TypeScript.
  - Text selection capture (`SelectionCapture` with `TextQuoteSelector`) & Shadow DOM floating trigger button.
  - Port-based streaming communication with OpenAI-compatible API + Chrome Built-in Prompt API (`window.ai`).
  - Streaming `<term note="...">` parser and interactive tooltip UI.
- **Phase 2 (Knobs, Settings & Alternative Triggers):**
  - Options UI for API endpoints, keys, models, temperature, and custom prompt templates.
  - Context policy configuration (paragraph vs. section vs. page).
  - Experimentation with trigger strategies (auto-trigger, shortcut).
  - Potential `pi-llm` / `pi-core` provider adapter integration.
- **Phase 3 (Local-First SQL & Second Brain):**
  - SQLite WASM with OPFS & FTS5 indexing.
  - Selections and history browser / search dashboard.
  - Export capabilities (JSON, Markdown, Obsidian format).
