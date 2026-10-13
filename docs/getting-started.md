# Getting started

This page walks you through opening ApEditor for the first time and writing with AI.

## Open the app

Use the hosted copy of ApEditor, or a copy you run locally. The browser tab title is **ApEditor — AI Markdown Editor**.

On first visit you should see:

- Two sample documents in the left sidebar: **Welcome** and **Ideas**
- The **Welcome** document open in the center
- The **Chat** panel on the right
- **Settings** may open automatically if your provider needs an API key and you have not saved one yet

Read **Welcome** in the editor for a short in-app tour. This guide goes into more detail.

## Connect an AI provider

Click the **gear** in the top bar (**Settings**), or press `Ctrl+.` (Windows/Linux) / `⌘.` (Mac).

You have three choices:

| Provider | API key | What happens when you send a message |
| --- | --- | --- |
| **Minimax** (default) | Required | The reply streams in the Chat panel |
| **OpenAI** | Required | Same as Minimax |
| **Google AI Mode (no key)** | None | A new tab opens with your prompt; you paste the answer back |

If you use Minimax or OpenAI:

1. Choose the provider.
2. Paste your API key. Use **Show** if you need to check it.
3. Leave the default **API endpoint** and **Model** unless you know you need something else.
4. Click **Save**.

If the gear shows a small amber dot, no API key is saved yet. That is expected until you finish this step (or switch to Google AI Mode).

Keys stay in this browser only. See [Privacy and your data](privacy.md).

## Choose a document

Click **Welcome** or **Ideas** in the sidebar, or click **+ New** to start a blank **Untitled** document.

Type in the center pane. Your work auto-saves in the browser. Next to the title you will see a hint such as **saved just now**.

## Ask the AI to help

1. Highlight a sentence in **Write** (or the Write side of **Split**).
2. In Chat, leave **include selection** checked (it is on by default).
3. Type a request, for example `Make this more concise.`
4. Click **Send**, or press `Ctrl+Enter` / `⌘Enter`.

The assistant reply may include **proposed-edit cards**. Open [Proposed edits](proposed-edits.md) to apply or reject them one by one.

Alternatively, select text, click **Comment**, write a note, then use **Send to AI** under the editor. That path is covered in [Comments](comments.md).

## Next steps

- [Your workspace](workspace.md) — hide panels, change theme, resize columns
- [Writing](writing.md) — Write / Preview / Split, bold/italic/underline, Predict
- [Settings](settings.md) — system message, temperature, UI font size
