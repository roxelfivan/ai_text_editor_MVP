# Comments

Comments let you mark a passage, write what you want changed, and send every note to the AI in one turn. After you apply an edit, the same badge holds the AI’s rationale.

## Add a comment

1. In **Write** (or the Write side of **Split**), select the passage.
2. Click **Comment** on the toolbar. The button is disabled until you have a selection.
3. Type in the composer (**Write a comment…**).
4. Click **Save**, or press `Ctrl+Enter` / `⌘Enter`. **Cancel** or Escape discards the draft.

The passage is highlighted. A numbered badge appears in the margin (1, 2, 3… in document order).

Comments have a soft limit of 2,000 characters (the counter turns into a long-comment warning) and a hard limit of 4,000.

## Open, edit, or delete

Click a badge. The popover title is **Comment**, **Sent to AI**, or **Outdated — anchor needs attention**.

- **Edit** — change the note, then **Save**. After a comment has already been sent, editing the body starts a **new round**. Earlier rounds stay in the history.
- **Delete** — removes the comment and highlight.
- **Cancel** / Escape — close without saving an edit.

You can resize the popover by dragging its edges.

## Undo a comment change

With the editor focused, press `Ctrl+Z` / `⌘Z` after you add, edit, or delete a comment. A toast appears (**Comment removed**, **Comment restored**, or **Comment edit undone**) with **Undo**. The toast disappears after a few seconds.

This undo is only for comment operations, not for typing in the document (the browser still handles ordinary text undo).

## Outdated comments

If you heavily edit or delete the anchored text and ApEditor cannot find it again, the badge becomes **Outdated**. The popover explains that the text moved or was deleted. Edit the comment to re-attach it, or delete it.

Outdated comments are **not** included when you **Send to AI**.

## Send to AI

Under the editor, the tray shows how many comments are ready, for example **2 comments** or **1 of 2 comments ready (1 outdated)**.

Click **Send to AI**. While the request is in flight the button reads **Sending…**.

The tray is disabled if:

- There are no sendable (non-outdated) comments, or
- Chat is already streaming a reply

ApEditor saves a **Before AI send** revision first, then sends the comments (in document order) with nearby context. Replies arrive in Chat as [proposed-edit cards](proposed-edits.md), typically one per comment plus any extra changes the model suggests for consistency.

## Rationale after you Apply

When you **Apply** a proposed edit, open the related badge. Under **Rationale** you will see rounds:

- **Round 1 / 1**, **Round 2 / 2**, and so on if you follow up
- Meta such as **Draft**, **Sent · no applied edits**, or **1 applied edit**
- The comment text, anchored passage, and the AI explanation for each applied change

A small mark on the badge means at least one applied-edit rationale is stored.

Expand or collapse rounds with the **+** / **−** controls when there is more than one round.

## Follow-up rounds

1. Open the badge and **Edit** the comment (for example, “still too long”).
2. **Send to AI** again.
3. **Apply** the new card.
4. Open the badge and compare Round 1 and Round 2.

## Reference other documents

Type `@` in the composer (or in the popover's edit box) to attach another document to the comment. The reference shows up as an inline pill in the popover's read view; clicking the pill switches the editor to the referenced document. Details: [Reference other documents](reference-other-documents.md).
