# Proposed edits

When the AI wants to change the document, the reply includes one or more **cards** instead of silently rewriting your draft. You decide what lands in the file.

## Read a card

Each card has a short **summary** (or **Proposed edit** if none was given) and a change id.

**Split** (default) shows two rendered Markdown columns: **Original** and **Proposed**. Empty sides show *Empty*.

**Inline** shows a line-by-line diff of the same two texts.

If the model quoted text that is not in the current document, you may see **Potential mismatch detected**. Normal **Apply** is then unavailable.

## Apply

**Apply** replaces the quoted original with the proposed text **only if** that original still exists in the document.

After a successful apply:

- The document updates
- The related comment highlight moves to the new wording
- The rationale is stored on the comment’s current round (open the badge to read it)
- The card shows **Applied to document.**

If the quote is gone, the card cannot apply normally. Click in the editor where the new text should go, then use **Force-apply…**. Force-apply inserts at the caret; use it carefully.

A card may also note **Not anchored to current text — applying uses Force-apply.**

If Original and Proposed are identical, the card can show **(no textual change)**.

## Apply several changes at once

At the bottom of an assistant message you may see **1 proposed change in this reply** or **n proposed changes in this reply**, plus **Apply n change(s)**.

That action:

1. Saves a revision labeled **Before Apply All**
2. Applies every change that still matches the document
3. Skips the rest

You will see **Applied all n change(s).** or **Applied x of y changes (z skipped — not anchored in the current document).**

## Reject

**Reject** discards that card without changing the document.

## Reject with feedback

Use this when you want the model to try again with your reason:

1. Optionally fill **Comment (optional)** — *Why reject? (sent to the AI as revision feedback)*
2. Click **Reject with feedback**

The reason is **staged**, not sent yet. The tip reads: *Staged. Click "Send rejection comments" in the message footer to send.* If you leave the box empty, you can still use plain **Reject**.

In the message footer, **Send n rejection comments** sends every staged reason in one Chat turn. **Clear staged** drops them.

## Missing quotes and Force-apply

Edits only apply automatically when **original** is an exact substring of the current document. Common reasons it fails:

- You edited that paragraph after the reply started
- The model paraphrased instead of quoting
- You already applied a nearby change that shifted the wording

Open **Show what the AI was looking for** on the card if you need to see the quote. Then either restore the old wording from [Revision history](revisions.md), or Force-apply at the caret.

## Reference other documents in rejection feedback

The **Comment (optional)** box on a proposed-edit card supports `@`, so you can attach another document to your rejection reason. For example, *“see the policy in `<Other Doc>` § Risk Owners”* — the model gets that context when you **Send N rejection comments**. Details: [Reference other documents](reference-other-documents.md).
