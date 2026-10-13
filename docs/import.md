# Import from photos or PDFs

You can pull text out of images or PDF files and insert it as Markdown at the caret. Recognition runs **in this browser**. Turning the raw text into readable Markdown uses the same AI settings as Chat, so Minimax or OpenAI with an API key is required for that last step.

## What you can import

- **Images** — common formats such as PNG, JPEG, and WebP
- **PDFs** — text PDFs are read as text; scanned PDFs are treated as images and recognized on-device
- Several files in one batch, processed in order

## How to import

1. Open a document and click where the text should appear.
2. Click **Import text from photos or PDFs** on the editor toolbar.
3. Choose at least one **OCR language**: **English**, **Simplified Chinese**, **Traditional Chinese**.
4. Click **Choose Import File(s)** and pick files.
5. Wait for the progress chip (for example `2/5`, then **formatting as Markdown…**).
6. Formatted Markdown is inserted at the caret.

**Close** dismisses the language popover without importing.

The popover explains: recognition stays in the browser; after a successful import, extracted text is rewritten as readable Markdown using only the API key, endpoint, and model from Settings.

## Requirements

- At least one language checked, or you will see **Select at least one language.**
- An API key and endpoint in Settings (not the keyless Google AI Mode path) for Markdown formatting, or **Open Settings and add an API key so imported text can be formatted as Markdown.**
- Recognizable text in the files, or **No text was recognized in the selected file(s).**
- If the engine fails: **OCR failed.**

While work is in progress, the toolbar control shows **Reading file…**

## Privacy

Image and PDF recognition does **not** upload your files to ApEditor (there is no ApEditor server). The recognized text is then sent to **your** configured AI endpoint so it can be rewritten as Markdown, the same way Chat sends prompts.

Clear the inserted text from the document if you do not want it kept in local storage with the rest of the draft.
