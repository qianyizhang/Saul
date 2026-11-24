# Saul

Shared language for reading and organizing open browser tabs across Saul's surfaces.

See the [shared vocabulary](../../GLOSSARY.md) for actions, presets and inspection.

## Language

**Call Saul**:
The page-level command, named for _Better Call Saul_. It runs the selected Call
over captured page context; a selection of tabs runs once per page.

**Call**:
A configurable operation over captured page context. Summarize is the first and
default Call. A custom Call can prepare text and chain model requests within one
page run, sharing cancellation and producing one final result. Page scope does
not imply complete capture; coverage and truncation remain explicit.
_Avoid_: Action (when referring to page-level Calls)

**Action**:
In Saul, an operation over local context, such as selected text. It uses the
[shared Action model](../../GLOSSARY.md), distinct from a page-level Call.

**Call preset**:
A saved Call choice and its model preset. The model preset selects connection,
model and options; the Call defines what to do with the page.

**Window**:
A Chrome window containing an ordered set of tabs and tab groups. In Saul's
extension navigation, Window names the view of the window containing Saul.
_Avoid_: Tabs workspace, current workspace

**Tab board**:
The surface for viewing and organizing tabs across open Chrome windows.
_Avoid_: Tabs, Windows & tabs, workspace

**Tab group**:
A named collection of tabs within one window.
_Avoid_: Folder, window group

**Local tool access**:
The profile’s permission for local clients such as the CLI and Codex to use Saul.
It includes tab inventory and controls access to additional browser operations.
_Avoid_: Codex tab access

**Tabs**, **Pages**, **Annotations**:
The Local tool access groups for tab and window inventory and organization, live
page content and interaction, and saved notes and their evidence, respectively.

**Read** and **Write**:
Read permits inspection and supported previews. Write includes Read and permits
applying changes or taking actions in the group.

**Selection**:
The tabs explicitly chosen for an action.
_Avoid_: Queue, batch

**Summary**:
A bilingual reading result produced by the default Summarize Call. **Summaries**
remains the existing name of the saved-results surface, which also holds custom
Call text results.
_Avoid_: Digest, window digest

**Summary reader**:
A disposable view of a saved Call result and its progress. Closing the reader
does not delete the result.
_Avoid_: Export preview, downloaded report

**Proposal**:
A suggested browser reorganization awaiting the user's Apply action.
_Avoid_: Manual edit, live layout

**Annotation**:
A saved comment on a page target, with its evidence, status and attributed replies.

**Target**:
The selected text, element or area an annotation refers to.

**Annotation marker**:
A numbered control that opens the annotation beside its target.

**Page index**:
The Annotations sidebar list of records for the current page.
