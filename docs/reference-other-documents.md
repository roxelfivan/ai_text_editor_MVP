# Reference other documents with `@`

Type `@` in any of these places to attach **another** document (or selected
headings / sections from it) to the outgoing turn:

- the **chat input** (right-hand panel)
- a **new comment** (select text → toolbar **Comment**)
- a **comment popover** in edit mode (open a comment badge → **Edit**)
- a **Proposed Edit** card’s **Comment (optional)** (rejection feedback)

The reference is folded into the AI prompt as a separate system message so
the model sees the document you pointed at. Your visible message stays
readable: chips and short `§…` captions stand in for the attachment.

The document you are editing is **not** listed in the picker (you already
have that context). You need at least one other document in the sidebar.

## Quick start

1. Type `@`. A document picker opens, listing every other document. Type
   more letters to filter. If nothing matches, you see **No matching
   documents.**
2. Pick a document. A **section picker** opens for that title.
3. Tick one or more headings / sections, or click **Whole document**.
4. Click **Use selection** (or **Whole document**). **Cancel** or Escape
   closes without changing the reference and leaves the `@…` text as you
   typed it.
5. A chip appears above the input. The top line is the document title;
   the bottom line is the scope (`full document`, or `§ Heading` /
   `§ Heading +N more`). An inline `§…` caption can also appear in the
   text. Click the chip summary or the caption to change sections.
6. Send as usual (**Send**, **Send to AI**, or **Send n rejection
   comments**). The reference rides along.

## Heading-grouped sections

The section list is built from Markdown headings (`#` … `######`). Text
before the first heading appears as a preamble row (`¶`). Documents with
no headings fall back to paragraph-style blocks in the same picker.

- Parent ticks **cascade to children** (sub-headings under that heading).
- Unticking a parent clears its descendants too.
- Ticking a child alone does **not** force the parent on.
- Level badges show `H1`…`H6` (or `¶` for the preamble).
- Missing titles show as **(untitled section)**.
- An empty source document shows **Empty document.**

The footer shows **n selected**, plus **Whole document**, **Cancel**, and
**Use selection** (**Use selection** stays disabled until at least one
section is ticked).

## Whole document vs section-scoped

| Scope | What the model sees |
| --- | --- |
| **Whole document** | A compact outline (about one short line per paragraph) — good for compare / shape questions, cheaper on tokens |
| **Section-scoped** | The **verbatim** text of the paragraphs inside the headings you picked |

Caps (so long references do not blow the prompt):

- About **4,000 characters** of verbatim section text **per referenced document**
- About **8,000 characters** across **all** references in one turn — later
  references may fall back to outline form if the budget is used up

## Inline `§` captions

When you confirm a section (or whole-doc) reference, ApEditor can insert a
short caption in the text (for example `§ Risk Owners`). Captions are for
you to read and click; they are not sent as the model’s source of truth —
the chip and the system prompt carry the real attachment.

- Click the caption (or the chip’s bottom line) to re-open the section
  picker for that document.
- If the source document was deleted, the chip shows **(deleted)** and
  that reference is dropped from the prompt.

## Keyboard

### Document picker

| Shortcut | Action |
| --- | --- |
| `↑` / `↓` | Move through documents |
| `Enter` / `Tab` | Pick the highlighted document |
| `Esc` | Close (does not remove the `@` you typed) |

### Section picker

| Shortcut | Action |
| --- | --- |
| `↑` / `↓` | Move through sections |
| `Space` / `Enter` | Toggle the highlighted section (parent cascade) |
| `Esc` | **Cancel** — close without applying |
| Click **Use selection** | Confirm the ticked sections |
| Click **Whole document** | Reference the entire document |

## What the model sees

Each reference becomes a separate system message naming the document and
inlining either the outline (whole-doc) or the picked section text.
Several references on one message are allowed; the same document is not
duplicated.

The current document is still described in the usual current-doc system
message. On **Google AI Mode (no key)**, references appear as
`[Context — referenced document "…"]` blocks in the opened prompt
(length-limited for the URL).

## Reading references back

In a **comment popover’s read view**, each reference is a clickable pill.
Click it to switch the editor to that document.

## Persistence

- **Comments** — references are saved on each comment round, so they
  survive reloads. **Edit** reopens them so you can add, remove, or
  re-pick sections.
- **Rejection feedback** — references live on the staged rejection until
  you **Send n rejection comments** or **Clear staged**. You can stage
  feedback with `@` chips even if the comment box is empty.
- **Deleted source** — chip shows **(deleted)** and is omitted from the
  prompt.

## Tips

- Use **Whole document** for cross-document questions (“compare this
  with…”).
- Use heading sections when you need exact wording (“is this consistent
  with § Risks in the other memo?”).
- Keep a second document in the sidebar — with only one document, the
  `@` picker has nothing to list.
