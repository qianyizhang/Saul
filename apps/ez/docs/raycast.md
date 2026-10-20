# Raycast integration

## Setup

1. Build with `make app` and install the resulting `dist/EZ.app` in
   `~/Applications/EZ.app`. Quit a running EZ before replacing its bundle.
2. In Raycast Settings, choose **Script Commands → Add Script Folder**. Raycast
   v1 calls this **Extensions → Script Commands → Add Directories**.
3. Add the repository's `integrations/raycast` directory. Give **EZ Lookup** the
   alias **ez**.
4. Open Raycast, type **ez**, press **Space**, enter text, and press **Return**.

Raycast's [argument contract](https://github.com/raycast/script-commands/blob/master/documentation/ARGUMENTS.md)
documents alias-plus-Space entry and percent-encoded arguments. Folder registration
is described in its [Script Commands manual](https://manual.raycast.com/script-commands).
The command script is plain Bash using macOS `open`; EZ gains no runtime dependency.
Do not pass raw query text directly to the shell script: its single argument is
already percent-encoded by Raycast.

## Behavior and boundaries

- EZ receives `ez://lookup?query=<percent-encoded text>` and decodes it once.
  Blank input, unknown/duplicate parameters, other routes, credentials, fragments,
  and queries over **16,384 UTF-8 bytes** are rejected before submission.
- Return fills the selected recipe’s first input. For single-field recipes, EZ
  waits for initial account/model loading and submits through the shared flow.
  Multi-field recipes open Quick Lookup for the remaining inputs and explicit Send.
  The recipe’s preset and current account remain EZ choices. After restart, EZ
  selects the first remaining recipe; removed starters are not restored.
- Existing generation or a pending launcher query is preserved. A second query
  is refused visibly; there is no queue, cancellation, or replacement.
- A blocked submission remains a draft with a visible error. Connecting an account
  later does not send it automatically; use **⌘ Return** when ready.
- The script explicitly addresses `~/Applications/EZ.app` using `open -g -a`, even
  if Spotlight indexes other EZ bundles. A `--ez-launcher` launch argument suppresses
  the full SwiftUI window on macOS 15+. On macOS 14, the panel works but the full
  window may appear on cold launch.
- Launcher queries are passed through Raycast and a local URL event, then stored
  in EZ's ordinary plaintext history when submitted and sent to OpenAI. They are
  not hidden from the launcher or local process inspection. No clipboard reading,
  Accessibility permission, or separate Raycast AI request is required.
- Any local app can invoke this URL scheme. EZ has no tools or shell executor;
  invoking the URL can consume the selected ChatGPT plan allowance. URLs cannot
  select a different account, model, mode, effort, billing path, or service tier.

The command folder remains in this repository. Moving the repository requires
updating its folder entry in Raycast.
