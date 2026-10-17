// Initial-state constants for the zustand store: provider presets,
// API defaults, seed prompts, and the two starter documents (`Welcome`
// + `Ideas`) that ship on first run.
//
// Kept in its own module so the store creation file stays focused on
// wiring (persistence, rehydration, action implementations) and so
// future onboarding tweaks don't have to touch store.ts.

import { v4 as uuid } from 'uuid';
import type { ApiConfig, ApiProvider, DocumentRecord, Prompt } from '@/types';
import { getProvider } from '@/config/providers';

// Resolve the build-time default provider, then derive endpoint/model
// defaults from the matching preset. VITE_DEFAULT_PROVIDER lets a
// hosting environment (e.g. an OpenAI-keyed production deploy) ship
// with a different default than the in-repo "minimax" default.
// `google-ai-mode` is also accepted as a build-time default — the
// settings modal will still need to be opened once so the user
// acknowledges the keyless workflow.
export const initialProvider: ApiProvider =
  import.meta.env.VITE_DEFAULT_PROVIDER === 'openai'
    ? 'openai'
    : import.meta.env.VITE_DEFAULT_PROVIDER === 'google-ai-mode'
      ? 'google-ai-mode'
      : 'minimax';

const initialPreset = getProvider(initialProvider);

export const defaultApiConfig: ApiConfig = {
  provider: initialProvider,
  apiKey: '',
  apiEndpoint:
    import.meta.env.VITE_DEFAULT_API_ENDPOINT || initialPreset.defaultEndpoint,
  model: import.meta.env.VITE_DEFAULT_MODEL || initialPreset.defaultModel,
  systemMessage: undefined,
  temperature: 0.7,
  // Rationale rules default to undefined so the chat pipeline falls
  // back to the hard-coded `PROPOSED_EDIT_RULES_DEFAULT` in
  // `src/api/chat.ts`. Existing persisted payloads (which never
  // wrote this field) keep the same behaviour.
  rationaleRulesOverride: undefined,
};

export const seedPrompts: Prompt[] = [
  {
    id: 'p-rewrite',
    name: 'Improve writing',
    body: 'Rewrite the selected text to be clearer and more concise. Preserve the meaning and tone.',
    createdAt: Date.now(),
  },
  {
    id: 'p-summarize',
    name: 'Summarize',
    body: 'Summarize the selected text in 3-5 bullet points.',
    createdAt: Date.now(),
  },
  {
    id: 'p-eli5',
    name: "Explain like I'm 5",
    body: "Explain the selected text as if speaking to a 5-year-old. Use simple words and a short example.",
    createdAt: Date.now(),
  },
  {
    id: 'p-continuation',
    name: 'Continue writing',
    body: 'Continue the document naturally from where the cursor/selection ends. Match the existing style and voice. Write 2-3 paragraphs.',
    createdAt: Date.now(),
  },
];

/**
 * Build a fresh `DocumentRecord` with a uuid + timestamps. Used by the
 * store's `createDocument` action and by the welcome-doc seeding pass.
 */
export function makeDoc(title: string, content = ''): DocumentRecord {
  const now = Date.now();
  return { id: uuid(), title, content, createdAt: now, updatedAt: now };
}

export const initialDocs: DocumentRecord[] = [
  makeDoc(
    'Welcome',
    `# 👋 Welcome to ApEditor

A local-first AI markdown editor. Everything you write stays in your
browser.

## 1. 🔑 Connect an AI

**Open Settings (gear, top right) and paste your API key.** That's
the only setup. Or choose **Google AI Mode (no key)** in Settings if
you prefer opening Google AI Mode in a new tab instead. The chat
panel on the right can then answer questions and rewrite passages.

## 2. ❓ Open Help anytime

**Click ? in the top bar** (or press \`⌘/Ctrl + /\`) for the full
user guide. Help uses the same Light / Dark theme as the app.

## 3. ✍️ Just write

**Type in Write.** Markdown renders live in Preview. Use the editor
view dropdown to switch **Write**, **Preview**, or **Split**.

## 4. 💬 Comment on a passage

**Select text → click Comment in the editor toolbar → write your
note.** A highlight and a numbered margin badge mark the passage.
Open a badge to **Edit** or **Delete** any comment (including after
send). When ready, click **Send to AI** under the editor to send the
article plus every comment as one batch. \`⌘/Ctrl + Z\` undoes the
last comment change. Comments that can no longer be found show as
**Outdated**.

## 5. @ Reference another document

**Type @ in Chat, a comment, or rejection feedback.** Pick another
document, then **Whole document** or tick headings and **Use
selection**. A chip (and often a § caption) shows what you attached.
You need at least two documents in the sidebar.

## 6. 💾 Save a snapshot

**Click Save in the editor toolbar** when you like a draft. Open
**Revision history** (clock, top bar) later to diff and restore
(\`⌘/Ctrl + h\`).

## 7. 📚 Use a saved prompt

**Open Prompt library** (bookmark, top bar) or press \`⌘/Ctrl + ,\`.
Click any prompt to drop it into the chat input, or write your own
and ask the AI to rewrite / shorten / expand the selection. Check
**include selection** in the chat panel when you want the selected
text sent with your message.

## 8. ✅ Apply or Reject AI edits

**AI rewrites show up as cards** with a rationale. Click **Apply** or
**Reject** on each one. For several changes in one reply, use
**Apply N changes** in the chat footer. After Apply, open the comment
badge to read the rationale (multi-round history if you follow up).
If a quote no longer matches the document, click in the editor and
use **Force-apply…**.

## 9. ✨ Get sentence suggestions while writing

**Predict starts off.** Click **Predict** (or \`⌘/Ctrl + \\\`) to turn
it on and request a suggestion. Press \`Tab\` or **Accept** to insert,
\`Esc\` or **Reject** to dismiss.

## 10. 📷 Import text from photos or PDFs

**Click Import text from photos or PDFs in the editor toolbar.** Pick
an image or a PDF. Recognition stays in the browser; the extracted
text is rewritten as readable Markdown by your configured model
before it is inserted at your caret.`
  ),
  makeDoc(
    'Ideas',
    `# Ideas\n\n- A short story about a lighthouse keeper who hears the sea speak.\n- A field guide to imaginary birds.\n- An essay on why we read in the bath.\n`
  ),
];
