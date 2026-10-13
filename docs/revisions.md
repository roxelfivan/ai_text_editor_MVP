# Revision history

A **revision** is a snapshot of one document at a point in time. The live draft still auto-saves; revisions are the restore points you can browse and roll back to.

## Open history

Click the **clock** in the top bar, or press `Ctrl+H` / `⌘H` when you are not typing in a field.

The title is **Revisions — {document title}**.

## Create a snapshot

- **Floppy disk** on the editor toolbar — *Save current content as a revision*
- **Snapshot now** inside the history window

Snapshots from these buttons appear as **Snapshot**.

ApEditor also snapshots for you:

| Label | When |
| --- | --- |
| **Before AI send** | Just before Chat **Send** or **Send to AI** |
| **Before Apply All** | Just before **Apply n changes** |

If the list is empty: *No revisions yet. Click Snapshot now or use Save revision in the toolbar.*

## Preview and Diff

Select a revision on the left. The right pane defaults to **Preview** (rendered Markdown of that snapshot). Switch to **Diff** to compare **{label} → current**.

An empty snapshot previews as *Empty revision.* If nothing is selected: *Select a revision on the left to preview…*

## Restore

Click **Restore**. Confirm: *Restore this revision? Current content will be replaced (you can save a snapshot first to preserve it).*

Restoring replaces the live document. Chat and comments are not rebuilt from that snapshot. If you might want the current draft back, click **Snapshot now** first.

## Delete a revision

Click **Delete** and confirm **Delete this revision?** This does not change the live document.

Revisions belong to one document. Deleting the document removes its history too.
