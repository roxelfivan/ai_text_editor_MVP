## v0.3.1 — Inline sentence completion + roomier editor toolbar

Feature + polish release on top of [v0.3.0](https://github.com/roxelfivan/ai_text_editor_MVP/releases/tag/v0.3.0).

### Added

- **Inline sentence completion in the editor (new `src/hooks/useInlineCompletion.ts`).** While you write, the editor suggests the next single sentence using the chat model and endpoint you already set up in Settings. You don't need to configure anything new.
  - **Triggering:** a request is sent after a 300 ms pause in typing. No request is sent while you have text selected, after a deletion or undo, or while a suggestion is already showing.
  - **Manual trigger:** `⌘ / Ctrl + \` requests a suggestion immediately. It skips the 300 ms wait and also works when text is selected.
  - **Accept or dismiss:** press `Tab` to accept the suggestion and `Esc` to dismiss it. Typing any other key also discards it.
  - **Suggestion panel:** suggestions appear in a panel at the bottom of the editor, sized to the suggestion and capped at 40% of the editor's height. While a request is in progress it shows a pulsing "…" indicator. The panel also has an **Accept** button for mouse users.
  - **Token-saving limits:** at most 600 characters before the cursor are sent as context. Output is capped at `max_tokens: 500` and stops at the first line break, so you get at most one sentence. Temperature is capped at 0.4. Any earlier request still in flight is cancelled as soon as you keep typing.
  - **Output cleanup:** `<think>…</think>` reasoning blocks are removed while the reply streams in. If the model repeats the last words you typed, the repeated part is removed so accepting a suggestion doesn't duplicate text.
- **Three new controls in the editor toolbar:**
  - **Status pill.** Shows `idle`, `thinking` (pulsing dot) or `ready · tab`.
  - **Counter pill.** Shows how many suggestions were requested and how many were accepted in this session (`requested / accepted`). Click it to reset both counts.
  - **On/Off toggle.** A switch with an I/O knob that turns inline completion on or off. It is greyed out until an API key and endpoint are configured. Turning it off cancels any request in progress and clears the current suggestion.

### Changed

- **Editor toolbar controls are a bit taller (28 px → 36 px, `h-7` → `h-9`).** This affects the View dropdown, the font-size `−` / `+` buttons (now `w-9 h-9`) and the three new controls. The text stays at **15 px**, the same as the topbar buttons. Import and Save keep the topbar button style (`btn-cyan-sm !text-[15px] !py-1.5`).
- **`src/components/Editor.tsx`** — the textarea is now wrapped in a column that also holds the suggestion panel. Two new window events were added: `mvp:accept-completion` (applies an accepted suggestion and puts the cursor at its end) and a global `⌘ / Ctrl + \` key handler.
- **`package.json`** — version bumped to `0.3.1`.

### Notes

- Inline completion is turned off automatically when no API key or endpoint is configured. Store and persisted state are unchanged. The on/off setting and the counters reset when the page reloads.
- Each suggestion is a separate API request to your configured provider, so it uses tokens. Use the On/Off toggle to turn the feature off.

### Verification

- `npm run build` — clean (TypeScript + Vite production build).

## v0.2.5 — ApEditor cyberpunk UI + Muji light theme

UI overhaul on top of [v0.2.4](https://github.com/roxelfivan/ai_text_editor_MVP/releases/tag/v0.2.4).
The app now ships with two coherent themes and a real brand identity extracted from the
ApEditor logo (black + neon cyan + neon green + crimson-purple gradient).

### Added

- **ApEditor brand mark.** The full logo is now rendered in the topbar (h-14 / 56px) alongside a tracked-out "ApEditor" wordmark. A matching inline-SVG favicon ships in `index.html`, and the file `public/apeditor-logo.jpg` is bundled with the build.
- **Two-coherent-theme system.** The `.dark` class on `<html>` drives both themes via a single set of utility classes:
  - **Dark (default)**: pure black, neon cyan, neon green, crimson-purple gradient on primary CTAs, neon halos on focus / hover.
  - **Light (Muji)**: warm cream paper, kraft panels, sumi ink text, deep-espresso outlined pills, no glow, no gradient — comfortable for long focus sessions.
- **New design tokens** in `tailwind.config.cjs`:
  - `ape.*` — dark surfaces (`base`, `panel`, `elevated`, `hairline`).
  - `paper.*` — Muji surfaces (`base`, `panel`, `elevated`, `hairline`, `ink`, `inkSoft`).
  - `cyber.*` — shared brand accents (cyan, green, status) plus the new `clay` espresso and crimson-purple `fire` / `fireMid` / `fireTo`.
  - New shadows: `ape-glow`, `ape-glow-green`, `ape-fire`, `ape-paper`, `ape-paper-lift`.
  - New background image: `ape-fire` crimson-purple gradient (replaces the old red→orange→yellow flame).
- **New component classes** (auto-themed via CSS in `src/index.css`):
  - `.btn-fire` — primary CTA (plum gradient in dark, clay pill in light).
  - `.btn-cyan` — secondary CTA (cyan outline in dark, hairline outline in light).
  - `.btn-ghost`, `.btn-danger`, `.ape-field`, `.text-glow-cyan` / `text-glow-green` (dark-only).
- **Default theme is now dark** for new installs (`useStore.ts` default `theme: 'dark'`; `main.tsx` applies the class on first paint). Existing users with a persisted `light` preference are still respected.

### Changed

- `index.html` — title → "ApEditor — AI Markdown Editor"; inline-SVG favicon (cyan ape-eye on black); theme color `#000000`.
- `tailwind.config.cjs` — full design-system token extension; new shadows; new `ape-fire` gradient.
- `src/index.css` — rewritten around two themes: prose, diff, proposed-edit card, scrollbar, resize handle, edge anchor and the shared button classes all carry `html.dark` and `html:not(.dark)` blocks so components stay class-name-agnostic.
- `src/main.tsx` — applies `.dark` on first paint from the persisted store (defaults to dark if no preference).
- `src/store/useStore.ts` — default `theme: 'dark'`.
- All surface components (`App.tsx`, `Sidebar`, `Editor`, `ChatPanel`, `SettingsModal`, `PromptLibrary`, `RevisionHistory`, `ProposedEditCard`, `PhotoImportButton`, `EdgeAnchor`) — every Tailwind utility that maps to a brand token now carries a `dark:` variant, so flipping the theme toggle swaps the whole UI without remount.

### Notes

- No backend, store API, or component logic was changed. The default-theme flip and the `useStore` flip are the only behavioural changes; everything else is visual.
- `npm run build` and `npm run dev` both pass clean.

## v0.2.1 — bug fix

Patch release on top of [v0.2](https://github.com/roxelfivan/ai_text_editor_MVP/releases/tag/v0.2).
Fixes the regression where a failed anchor match in `ProposedEditCard` left the user with no recoverable action.

### Fixed

- **Anchor mismatch no longer dead-ends.** When the AI's quoted "find this" text
  doesn't match the current document, the card now keeps the diff visible
  (original vs. replacement, side by side) and shows a yellow _Potential mismatch detected_ banner instead of a static error.
- **New _Force apply_ action** lets the user apply the proposed edit at their current caret or selection when the AI's anchor is missing. Disabled until
  the editor is focused; auto-disabled if the user switches documents  mid-card.

### Changed

- `utils/proposedEdit.ts` — new `applyEditAtCaret(content, replacement, { selectionStart, selectionEnd })`
  helper that replaces the selection if present, inserts at caret otherwise,
  and returns `{ ok: false, reason: 'caret-missing' }` for out-of-range carets.
- `store/useStore.ts` — new non-persisted `editorFocus` slice (`EditorFocusState` +
  `setEditorFocus(docId, info)` action) keyed by document id.
- `components/Editor.tsx` — reports `{ focused, selectionStart, selectionEnd }`
  via `onFocus` / `onBlur` / `onSelect` / `onKeyUp` / `onClick`; clears focus  on the previous document when switching. Fixes `HTMLTextAreaElement` casing.
- `components/ProposedEditCard.tsx` — always renders the diff; adds force-apply; drops the prose error.

### Behaviour matrix

| Scenario | Apply | Force apply |
| --- | --- | --- |
| AI quote found (exact / whitespace / Setext / ATX / escapes) | replaces first match | — (not needed) |
| AI quote not found | disabled | disabled until editor focused, then replaces/inserts at caret |
| User switches documents mid-card | disabled | disabled (auto) |

### Verification

- `npm run typecheck` — clean
- `npm run build` — 333 modules, no warnings
- ReadLints — no linter errors