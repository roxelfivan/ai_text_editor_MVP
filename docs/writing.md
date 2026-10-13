# Writing

The center pane is your Markdown editor. You always edit plain Markdown; Preview and Split show how it will look.

## Write, Preview, and Split

Use the dropdown on the left of the editor toolbar:

| Mode | What you see |
| --- | --- |
| **Write** | Editable text. Placeholder: *Start writing in Markdown…* |
| **Preview** | Rendered Markdown (headings, lists, links, tables, and so on) |
| **Split** | Write on the left, Preview on the right. Drag the divider. |

An empty Preview shows *Nothing to preview yet.*

You can comment only in **Write** or on the Write side of **Split**. Select text there, then use **Comment**.

## Bold, italic, underline

Select text, then:

| Button | Shortcut | Markdown |
| --- | --- | --- |
| **B** | `Ctrl+B` / `⌘B` | `**bold**` |
| **I** | `Ctrl+I` / `⌘I` | `*italic*` |
| **U** | `Ctrl+U` / `⌘U` | `<u>underline</u>` |

Click the same control again to unwrap the markers. These shortcuts work while the editor is focused.

## Editor font size

Use **−** and **+** on the toolbar. Range is 10–24 pixels. This does not change menus or Chat — those use UI font size in [Settings](settings.md).

## Predict (optional sentence completion)

**Predict** is **off** until you turn it on. It needs a Minimax or OpenAI key. It is not available with **Google AI Mode (no key)**.

1. Click **Predict** on the toolbar, or press `Ctrl+\` / `⌘\` (when the control is enabled).
2. A suggestion panel appears under the write pane: **Suggestion · Tab to accept · Esc to dismiss**.
3. Press **Tab** or **Accept** to insert the suggestion.
4. Press **Esc** or **Reject** to dismiss it.

Click **Predict** again to stop requesting suggestions.

If the button is disabled, the tooltip explains why (missing key, or Google AI Mode).

You can drag the top of the suggestion panel to make it taller or shorter.

## Import photos and PDFs

The camera-style control on the toolbar imports text from images or PDFs. Full steps: [Import from photos or PDFs](import.md).

## Save a revision

The floppy-disk control saves a snapshot of the current document. Open the clock in the top bar to browse snapshots. See [Revision history](revisions.md).

Chat **Send** and **Apply N changes** also save snapshots automatically (`Before AI send` and `Before Apply All`) so you can undo a large AI change from history.
