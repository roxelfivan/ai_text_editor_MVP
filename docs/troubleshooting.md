# Troubleshooting

## Settings keeps asking for a key

Minimax and OpenAI need an API key. Paste it in **Settings** and click **Save**. Or switch **Provider** to **Google AI Mode (no key)** if you do not want a key.

The amber dot on the gear means no key is stored yet.

## Chat shows an error

- Confirm **Save** in Settings (unsaved key/endpoint will not be used)
- Check that the key is valid for that provider
- Confirm you are online
- Try **Stop** if a reply is stuck, then send again

The red box shows the provider message, or **Unknown error**.

## Proposed edits will not Apply

**Apply** needs an exact match of the quoted original in the current document. If you edited while waiting, restore a **Before AI send** revision, or click in the document and use **Force-apply…**. See [Proposed edits](proposed-edits.md).

**Apply n changes** may report that some items were skipped because they were not anchored.

## Comment says Outdated

The highlighted sentence changed too much to find. Edit or delete the comment from the badge. Outdated comments are skipped by **Send to AI**.

## Predict is greyed out

Turn on Minimax or OpenAI and save a key. Predict is off by default; click **Predict** to start. It does not run under Google AI Mode.

## Import will not format Markdown

OCR can read the file in the browser, but rewriting as Markdown needs a keyed provider. Add a key in Settings. Also select at least one OCR language.

If you see **No text was recognized in the selected file(s).**, try a clearer image, a different language, or a text-based PDF.

## Chat or sidebar disappeared

Use the chevrons on the left, right, or top edge of the window. Shortcuts: `Ctrl+B` / `⌘B` for the sidebar (when not typing in the editor), `Ctrl+Shift+C` / `⌘Shift+C` for Chat.

If you clicked **×** on Chat, use the right-edge chevron to show it again.

## My documents vanished

They lived in this browser’s storage. Another browser, a private window, or cleared site data starts fresh. ApEditor cannot recover that data from the cloud.

If you still have a **revision** in the same profile, open [Revision history](revisions.md) before deleting documents.

## Google AI Mode did not open

Allow pop-ups for the site, then use **Open in AI Mode** or **Re-open AI Mode tab**. Paste the answer into Chat and **Submit**.

## Undo typed the wrong thing

`Ctrl+Z` / `⌘Z` in the editor undoes the last **comment** operation if one is on the stack; otherwise the browser undoes typing. Use **Revision history** to roll back a large AI apply.

## Debug numbers on the toolbar

**Debug Mode** is on in Settings. Turn it off and **Save** if you do not need completion counters.
