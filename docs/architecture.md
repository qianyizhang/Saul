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

## Installation

Extension, ChatGPT helper, tab helper and native app are explicit setup selections.
The extension works with an OpenAI-compatible provider without a native app or helper.
ChatGPT plan features and summaries need the ChatGPT helper. External tab access
and native window names need the tab helper. Codex registration is separate.

The optional setup CLI runs with Node; the native installed app does not.
Current browser helpers retain the installation-time Node executable dependency.
A future npm package may distribute this coordinator. Public distribution,
notarization, app stores and mobile packaging are separate release work.

## Optional shared capabilities

Decision: allow an explicit opt-in replacement for duplicated behavior, including
a possible shared desktop account module. This is a design contract only; no
shared daemon, credential migration or runtime interface is introduced here.

A replacement must define a small versioned interface covering discovery,
capabilities, explicit connection selection, operation/cancellation, and typed
unavailable/recovery outcomes. For accounts, identity and usage permission remain
separate; model/tier availability and refresh ownership are explicit.

Before implementing a concrete replacement:

1. Demonstrate two real consumers and a maintenance benefit over bespoke adapters.
2. Keep standalone installation and the app-local implementation available.
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
mobile installation. Concrete transport, implementation language and credential
migration are future decisions, informed by the provider's supported authorization flow.

## Data ownership

Each app retains its current configuration, credentials and history. There is no
shared-record format, recipe import workflow, sync queue, remote library or Git
sync in this migration. Future two-way sync must first define stable identities,
revision/conflict rules, deletion/retention and device-local connection binding.

## Naming reminder

Saul is the current repository name; Saul and EZ remain application names.
Revisit umbrella and application names before public distribution. Shared concepts
and fixture formats use domain names, not branding. Installed identities such as
`local.ez.app`, `ez:`, native host names, extension IDs and Keychain service IDs
remain stable until a separately tested identity migration is designed. A display
rename must not accidentally relocate data or create a new account registration.
