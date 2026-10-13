# Privacy and your data

ApEditor is built to keep drafts on your machine. There is no ApEditor account and no ApEditor server that stores your documents.

## What stays in the browser

This browser keeps:

- Documents and their text
- Chat history per document
- Comments, rounds, and applied rationales
- Revisions
- Prompt library
- Settings (including API keys)
- Layout, theme, and font sizes

Closing the tab or restarting the computer does **not** wipe this. Another browser profile, private window, or device will **not** see it.

## What leaves the browser

You send data when you:

- **Send** a Chat message, **Send to AI** comments, or send rejection feedback — to the **Minimax or OpenAI endpoint** you configured
- **Import** a photo or PDF — recognition is local; the extracted text is then sent to that same endpoint to format as Markdown
- Use **Google AI Mode** — Google’s site loads in a new tab with a prompt you chose to open there

ApEditor does not intermediate those requests. Your API key is sent only as `Authorization: Bearer …` to the HTTPS URL in Settings. Non-HTTPS endpoints are refused, except `http://localhost` for local development.

## Shared and public computers

Anyone with access to this browser profile can open ApEditor and read your drafts and key.

When you finish on a shared machine, clear this site’s data (or use a private window and close it). That removes documents, chats, keys, and layout.

## Import and OCR

Choosing **Import text from photos or PDFs** runs recognition on-device. Files are not uploaded to ApEditor. After recognition, only the extracted text is sent to your AI provider for Markdown formatting.

## What clearing data does

Clearing cookies/site storage for ApEditor resets you to a first-run state (sample **Welcome** and **Ideas** documents, empty Chat, no key). Export anything you need first by copying Markdown out of the editor.
