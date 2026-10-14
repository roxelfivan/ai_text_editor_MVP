# Reference other documents with `@`

Type `@` in any of these surfaces to attach another document (or a
specific paragraph of one) to the outgoing turn:

- the **chat input** (right-hand panel)
- a **new comment** (select text → toolbar **Comment**)
- a **comment popover** in edit mode (open a comment badge → **Edit**)
- a **Proposed Edit card's Comment (optional)** (rejection feedback)

The reference is folded into the AI prompt as a separate system
message so the model sees the exact document you pointed at. The
chat history itself stays readable: the mention is rendered as a
chip in the input / popover, and the user-visible body shows only
the prose you typed.

## Quick start

1. Type `@` in any of the surfaces above. A doc picker opens at the
   caret, listing every other document in the **Documents** panel.
2. Pick a document — a second picker lists its paragraphs
   (numbered with the same 60-char preview the AI sees).
3. Tick one or more paragraphs to scope the reference, or press
   **Whole document** for the default (token-cheap outline).
4. A chip appears above the input. The top line is the doc title;
   the bottom line is the section summary (`full document` or
   `§ preview +N more`). The chip is deletable (×) and click-to-edit
   (click the bottom line to re-open the section picker).
5. Send as normal (Send / Send to AI / Send N rejection comments).
   The reference rides along with the message.

## Whole-document vs section-scoped

- **Whole document** is the default. The model sees a compact
  outline (one line per paragraph, ≤ 60 chars each) — enough to
  reason about the document's shape without burning the prompt
  budget.
- **Section-scoped** is what you pick when the question is about
  a specific passage. The model sees the verbatim text of the
  picked paragraphs (≤ 4,000 chars total across all picked
  sections), so it can quote / propose edits against the exact
  wording. If the picked text would exceed the cap, ApEditor
  falls back to the outline plus a truncation note.

## Keyboard

- `↑` / `↓` — move through the picker
- `Enter` / `Tab` — confirm the highlighted row
- `Space` (section picker) — toggle the current paragraph
- `Esc` — close the picker (does not consume the `@` you typed)

## What the model sees

Each reference becomes a separate system message:

- `sys-referenced-doc-1` — names the doc and inlines either the
  compact outline (whole-doc) or the verbatim paragraph text
  (section-scoped).
- `sys-referenced-doc-2`, `…-3`, etc. — same shape, one per
  referenced doc. References to the same doc are deduped.

The current document is still passed in `sys-current-doc`, so the
AI understands both "the document you're editing" and the other
docs the user pointed at. The Google AI Mode (keyless) path
includes the same references, wrapped in `[Context — referenced
document "<title>"]` blocks.

## Reading references back

In a **comment popover's read view**, each reference renders as an
inline clickable pill. Clicking the pill switches the editor to
the referenced document so you can read the source in context.

## Persistence and deletion

- **Comments** — references are persisted on each comment round
  (`CommentRound.mentions`), so they survive reloads. Re-editing a
  comment (Edit) reopens the picker with the round's references
  pre-selected, so you can add, remove, or re-pick.
- **Rejection feedback** — references are transient. They live on
  the staged rejection entry; once you Send / Clear staged, the
  card is gone.
- **Deleted source doc** — the chip flips to `(deleted)` and is
  dropped from the prompt.

## Tips

- Use whole-document references when the question is
  cross-document ("compare this with…"). The model uses both
  outlines to answer.
- Use section-scoped references when the question is about a
  specific passage ("is this paragraph consistent with § Risks
  in `<Other Doc>`?"). The model gets the verbatim text and can
  quote it back.
- You can attach multiple references to the same message — they
  appear as a stack of chips, and the prompt carries one
  `sys-referenced-doc-N` per deduped doc.
