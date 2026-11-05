# Raycast integration

## Setup

1. Follow [signing setup](releasing.md#local-signing-and-installation), quit EZ,
   then run `make install` from `apps/ez`.
2. Raycast Settings → Script Commands → Add Script Folder (v1: Extensions →
   Script Commands → Add Directories): add `apps/ez/integrations/raycast` from this
   repository. Give **EZ Lookup** the alias **ez**.
3. In Raycast, type **ez**, Space, query, Return.

The Bash command uses macOS `open`; it adds no app runtime dependency. Raycast
supplies one percent-encoded argument; never pass raw query text to the script.
Moving the repository requires updating Raycast's folder entry.
See [arguments](https://github.com/raycast/script-commands/blob/master/documentation/ARGUMENTS.md)
and [Script Commands](https://manual.raycast.com/script-commands).

## Behavior

- `ez://lookup?query=<encoded text>` decodes once. `LauncherQuery` rejects blank
  input, unknown/duplicate parameters, other routes, URL credentials/fragments and
  queries over 16,384 UTF-8 bytes.
- Return fills the selected action's first field/default preset. Single-field
  **Write** waits for startup account/model loading, then submits; Draw/multi-field
  opens Quick Lookup for explicit Run. EZ owns provider/account choices. Restart
  selects the first remaining action; removed starters stay removed.
- Active generation/pending launcher work is preserved; a second submission is
  refused, never queued or substituted. Blocked submissions retain the draft/error
  for manual ⌘Return; later sign-in does not send automatically.
- `open -g -a` targets `~/Applications/EZ.app`, avoiding other indexed builds.
  `--ez-launcher` suppresses the main window on macOS 15+; macOS 14 cold launch may
  also show it. Esc hides the panel.
- Query text passes through Raycast/local URL events and, on submission, ordinary
  plaintext history and OpenAI. It is visible to launcher/process inspection.
  No clipboard, Accessibility access or Raycast AI request is involved.
- Any local app can invoke the scheme and consume the selected plan/API allowance.
  URLs cannot choose account, model, action, effort, billing path or tier. EZ has
  no shell/tool executor.
