# Chat

Chat is the right-hand panel. Use it for free-form questions, selection-based rewrites, and replies that include proposed edits.

## Header

- **Chat** plus the current model name (or `google-ai-mode`)
- **Clear** — empties this document’s conversation (disabled when empty)
- **×** — hides the panel (show it again from the right-edge chevron)

If you have never sent a message, Chat shows: *Ask anything, or highlight text in the editor and send a prompt from the library.*

## Send a message (Minimax or OpenAI)

1. Type in the box (*Ask, or ⌘/Ctrl+Enter to send…*).
2. Optionally check **include selection** so the highlighted editor text is sent with the message.
3. **paste selection (n)** inserts the highlight into the input if you would rather see it in the box.
4. Click **Send** or press `Ctrl+Enter` / `⌘Enter`.

While a reply is streaming, **Send** becomes **Stop**. The assistant may show **thinking…** until text arrives.

Before each send, ApEditor stores a revision labeled **Before AI send**.

If the request fails, a red error appears (or **Unknown error**). Check your key, endpoint, and network, then try again. See [Troubleshooting](troubleshooting.md).

## Include selection

**include selection** is on by default. User messages that included a highlight can show **▸ selection (n chars)** on the bubble.

Use this when you want a rewrite of a specific passage without creating comments. For many notes on one draft, [Comments](comments.md) plus **Send to AI** is usually clearer.

## Google AI Mode (no key)

If Settings → **Provider** is **Google AI Mode (no key)**:

1. Type your prompt. The send button is **Open in AI Mode**.
2. A Google AI Mode tab opens with the prompt filled in.
3. Read the answer there, copy it, and paste into **Paste the AI Mode answer**.
4. Click **Submit**.

You can **Re-open AI Mode tab** or **Cancel**.

If the pasted answer contains `proposed-edit` blocks, they become the same track-changes cards as a normal streaming reply.

**Predict** and in-app streaming are not used on this path. You still need an API key if you want [import](import.md) to format OCR as Markdown.

## Prompt library

Saved prompts can fill the Chat input, including the current selection. See [Prompt library](prompt-library.md).

## Staged rejection comments

If you **Reject with feedback** on a proposed-edit card, Chat shows how many rejection comments are staged. Use **Send n rejection comments** to send them together, or **Clear staged** to drop them. Details: [Proposed edits](proposed-edits.md).
