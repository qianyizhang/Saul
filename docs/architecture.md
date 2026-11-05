# Architecture and decisions

## Repository ownership

The repository coordinates independently installed applications. `apps/saul`
owns Chrome UI, capture, anchors, persistence and optional Node helpers.
`apps/ez` owns native macOS UI, authentication, inference and persistence.
[Shared contracts](../contracts/README.md), [vocabulary](../GLOSSARY.md) and
[design](../DESIGN.md) have one root owner. Swift and browser builds retain their
own toolchains. Root commands coordinate them; they are not runtime dependencies.

The Git history includes both original repositories. Application-local docs remain
the authority for platform details. CI has separate browser and native jobs; each
release artifact can be built and installed independently.

## Behavior owners

| Boundary                                   | Owner                                                                                       | Stable check                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Native attempt execution and final save    | [AttemptExecution](../apps/ez/Sources/EZCore/AttemptExecution.swift), projected by AppModel | Production Send/Stop/Save again actions in the [native state suite](../apps/ez/Tests/README.md) |
| Browser attempt execution and persistence  | [ReadingRunner](../apps/saul/src/reading/runner.ts)                                         | Both apps consume the [Attempt contract fixtures](../contracts/README.md#execution)             |
| Browser configuration writes and conflicts | [Settings owner](../apps/saul/src/storage/settings.ts) in the trusted background            | Concurrent owner requests and two real Settings surfaces                                        |
| Helper installation and recovery           | [Installation transaction](../apps/saul/native/installation.mts)                            | Disposable installs, failure injection and old/new running processes                            |
| Tab board host connection                  | [Host adapter](../apps/saul/native/ui/host-adapter.ts) using the pinned MCP Apps SDK        | Independent SDK host and the delivered document under CSP                                       |

Views express user intent and render state. These owners hold the ordering,
durability and lifecycle rules. Shared fixtures compare behavior; history uses the shared SQLite schema. App-local details remain
in the [Saul](../apps/saul/docs/architecture.md) and
[EZ](../apps/ez/docs/architecture.md) architecture documents.

## TypeScript maintenance

Decision — 2026-10-23: maintain substantial JavaScript-family code as TypeScript.
The extension already used strict TypeScript; direct Node helpers, board logic and
maintenance scripts had escaped implementation checking behind handwritten declaration
files. Types now live with their implementation. External JSON still needs runtime
validation; a cast does not establish trust. EZ remains Swift.

| Compiler scope    | Runtime and output                                                                  |
| ----------------- | ----------------------------------------------------------------------------------- |
| Extension         | WXT strict browser program; retains indexed-access checks                           |
| Board             | Strict DOM-only program; esbuild bundles the pinned MCP Apps SDK                    |
| Native helpers    | Strict ESM `.mts`; TypeScript emits `.mjs` and declarations; history SQL is bundled |
| JXA               | Strict macOS script context; emits `window-names.jxa` with global `run`             |
| Tooling and tests | Strict Node or mixed test programs; Node 24 runs erasable tooling source            |

`pnpm --dir apps/saul build:native` produces the complete disposable
`apps/saul/.build/native/` tree: emitted modules, JXA, HTML, CSS and bundled board.
It sits outside WXT's output tree so rebuilding the extension cannot erase helper
assets. Installation copies that complete output into the existing immutable
generation layout. Public pnpm commands and installed `bridge/*.mjs`/`bin/*`
paths stay stable; direct checkout commands use `.mts` tooling or the emitted tree.
Development ChatGPT metadata preserves `apps/saul/chatgpt`; installed credentials
remain under the existing installation root.

`pnpm typecheck` covers every authored compiler scope. The normal check gates
include it by scope, and lint rejects new authored JS outside the two small ESLint
configs. Unit tests import TypeScript; delivered-board, subprocess and installation
checks use emitted artifacts. No TypeScript loader is required by installed helpers.
The cost is an explicit build before helper execution, already owned by package
commands. There are no source compatibility shims or independently maintained `.d.mts`
contracts. Build outputs are never hand-edited or committed.

## Installation

Extension, ChatGPT helper, tab helper, action helper and native app are explicit setup selections.
The extension requires the ChatGPT/history helper for shared persistence, including API-provider reading. It does not require EZ.
ChatGPT plan features and built-in summaries need the ChatGPT helper. Custom
Summarize modules use a third optional action helper and retain their selected
provider's credential owner. External tab access
and native window names need the tab helper. Codex registration is separate.

The optional setup CLI runs with Node; the native installed app does not.
Current browser helpers retain the installation-time Node executable dependency.
A future npm package may distribute this coordinator. Public distribution,
notarization, app stores and mobile packaging are separate release work.

The helper installer owns one serialized transaction: stage a complete runtime
generation, validate its payload and managed paths, then activate it atomically.
Stable launcher and Codex entry paths resolve into immutable generations. Running
processes keep their original generation, including lazy-loaded assets; later
connections use the new generation. Credential and runtime data roots stay fixed.
An interrupted install has an explicit recovery path and never kills or replays work.

Migrating the old mutable installation requires one manual disconnect/reconnect
window. If both legacy helpers are installed, the first migration includes both;
subsequent updates preserve an unselected helper's payload and registration.
See [setup](setup.md) for migration and recovery commands.

## Optional shared capabilities

This section governs optional account and execution replacements. Shared history
below is the selected persistence owner and has no app-local fallback.

Decision: allow an explicit opt-in replacement for duplicated behavior, including
the macOS [Saul credential owner](../contracts/credentials.md). That concrete
replacement is implemented; other replacements remain subject to this contract.

A replacement must define a small versioned interface covering discovery,
capabilities, explicit connection selection, operation/cancellation, and typed
unavailable/recovery outcomes. For accounts, identity and usage permission remain
separate; model/tier availability and refresh ownership are explicit.

Before implementing a concrete replacement:

1. Demonstrate two real consumers and a maintenance benefit over bespoke adapters.
2. Keep independent installation. Retain standalone browser and custom-endpoint
   routes for installations that do not opt in.
3. Require explicit per-app opt-in; show which module owns the connection.
4. Serialize credential refresh through one owner. Never have two implementations
   independently rotate the same refresh token. An account label is not identity.
5. Validate local callers, restrict each operation and keep credentials behind the
   owner. User records and tokens do not become shared merely by installing it.
6. Freeze a request's selected implementation and account. Loss blocks explicitly;
   it never silently falls back, resends, switches billing or copies credentials.
7. Define disconnect, uninstall and recovery before enabling the replacement.
   Returning to app-local execution is explicit and may require local sign-in.
8. Test both adapters against the common contract and their own lifecycle failures.

A desktop replacement cannot become a mandatory dependency for browser-only or
mobile installation. The macOS credential owner uses signed Swift, native pipes
and Chrome Native Messaging. It starts on demand and has no daemon.

## Data ownership

ChatGPT model presets share one local JSON document through native Swift and
Node adapters; [the shared contract](../contracts/README.md#providers-and-presets)
defines migration, revisions and account-independent presets. App-specific
preferences and recipes use `apps.saul` and `apps.ez` scopes in that document.
Runtime state remains app-owned. In opted-in macOS installations, official OpenAI
credentials use the [Saul owner](../contracts/credentials.md); other browser
connections keep their existing local owner. Saved history uses one shared SQLite database. There is no
cross-app recipe import, sync queue, remote library or
Git sync. Multi-device sync remains separate work.

## Shared history

Decision — 2026-11-04: Saul and EZ use
`~/Library/Application Support/Little Clarity/history.sqlite3`.
The [schema](../contracts/history.sql) has one source, packaged as a native resource
and copied into Saul's installed helper. Swift accesses SQLite directly; Saul
uses its existing native-messaging helper. EZ has no Node runtime dependency.
SQLite transactions serialize both adapters, with owner-only files, a busy timeout,
foreign keys and secure deletion. There is no second history writer, sync queue,
daemon, local fallback or compatibility shim.

Browser relational records preserve page anchors, submissions, complete attempt
history, bookmarks and saved summaries. Native records retain frozen JSON metadata
and input/output image blobs in the same database. Both History views project
reading passages and EZ lookups. Cross-app entries are readable, searchable,
copyable and deletable; browser-specific execution stays in Saul. Saved summaries
retain their existing dedicated Saul surfaces. Drafts, credentials and active
execution stay app-owned. Browser recovery is scoped to the originating profile.
History reloads on activation/focus rather than a recurring background timer.
The [History operation contract](../contracts/README.md#history-operations) shares
recovery/deletion meanings and real-store fixtures across Swift and Node. Saul's
typed operation catalogue owns Native Messaging admission and reconnect policy;
EZ keeps direct SQLite access and explicit save-only recovery.
Bridge loss permits at most three connection attempts for safe history operations,
using the same operation identity for submission/claim/save acknowledgement. These
retries never repeat inference. Uncertain delete, clear and bookmark operations are
not retried automatically. Operation IDs live with the existing run/submission
rows; there is no separate receipt log containing deleted history.

Migration imports the old browser OPFS database and EZ JSONL/images once. It
validates records and attachments and commits a durable migration marker before
removing the old files. Reopening after interrupted cleanup never reimports or
resurrects deleted records. Conflicting, malformed, missing-attachment or unknown
newer-schema data stops migration and preserves the source. Migration is the
only reader of the retired formats; they are never used as runtime fallbacks.

## Naming reminder

Saul is the current repository name; Saul and EZ remain application names.
Revisit umbrella and application names before public distribution. Shared concepts
and fixture formats use domain names, not branding. Installed identities such as
`local.ez.app`, `ez:`, native host names, extension IDs and Keychain service IDs
remain stable until a separately tested identity migration is designed. A display
rename must not accidentally relocate data or create a new account registration.
