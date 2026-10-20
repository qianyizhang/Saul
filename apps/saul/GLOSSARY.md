# Saul

Shared language for reading and organizing open browser tabs across Saul's surfaces.

See the [shared vocabulary](../../GLOSSARY.md) for recipes, presets and inspection.

## Language

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

**Selection**:
The tabs explicitly chosen for an action.
_Avoid_: Queue, batch

**Summary**:
A saved reading result based on captured tab content. Summaries is the shared
name for these results on both surfaces.
_Avoid_: Digest, window digest

**Summary reader**:
A disposable view of a saved summary and its progress. Closing the reader does
not delete the summary.
_Avoid_: Export preview, downloaded report

**Proposal**:
A suggested browser reorganization awaiting the user's Apply action.
_Avoid_: Manual edit, live layout
