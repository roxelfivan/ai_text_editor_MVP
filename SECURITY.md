# Security notes — ApEditor (v0.5.2+)

Local-first React/Vite markdown editor. There is **no backend**; the browser
talks directly to the AI endpoint you configure.

## Secret hygiene (repo)

As of the v0.5.2 tree on GitHub:

- No `.env` / `.env.local` committed (gitignored; only `.env.example` with
  public default endpoint/model strings).
- No hardcoded API keys, tokens, or private keys in source or git history.
- Build-time `VITE_*` vars are limited to endpoint/model/provider/version —
  never a secret key (Vite embeds `VITE_*` into the client bundle).

**Do not** put API keys in `.env` as `VITE_*` values. Paste keys only in
Settings; they stay in this browser’s `localStorage`.

## Residual risks & recommendations

| Severity | Issue | Status / recommendation |
| -------- | ----- | ----------------------- |
| High (mitigated) | Stored XSS via `rehype-raw` without sanitization could steal the API key from `localStorage` | **Mitigated:** `rehype-sanitize` after `rehype-raw` (allows `<u>` only beyond the default schema). |
| High (by design) | API key stored plaintext in `localStorage` | **Mitigated (opt-in):** Settings → “Forget API key when this tab closes” keeps the key in `sessionStorage`. Prefer a local proxy or passphrase-wrapped Web Crypto for stronger hygiene. Avoid shared browsers. |
| Medium (mitigated) | Bearer token sent to any user-typed URL | **Mitigated:** HTTPS required (localhost `http://` allowed). Consider an allowlist of known providers. |
| Medium | Full document sent to the model each chat turn | **Mitigated (opt-in):** Chat **selection only** omits the document outline. Highlights use `BEGIN/END EDITOR SELECTION` delimiters. Outbound prompts redact common API-key / Bearer shapes. Comment **Send to AI** still includes a compact outline. |
| Medium | No host-level CSP beyond the meta tag | Prefer HTTP headers (`Content-Security-Policy`) on production hosting. Vercel already sends COOP/COEP via `vercel.json` so SharedArrayBuffer / threaded ORT WASM works. |
| Medium | In-browser OCR (OpenCV.js embind) needs `'unsafe-eval'` | Required by PaddleOCR's OpenCV.js `Function` constructor. Vite aliases `onnxruntime-web` to the WASM-only build so the WebGPU/JSEP glue is not loaded. `connect-src` allows `data:` for OpenCV's embedded WASM. |
| Medium (mitigated) | Large PDF/image import has no size/page caps | **Mitigated:** `src/utils/ocr.ts` enforces `OCR_MAX_FILE_BYTES = 50 MB`, `OCR_MAX_BATCH_BYTES = 200 MB`, and `OCR_MAX_PDF_PAGES = 500`, refusing oversized batches with friendly inline errors before any rasterisation runs. |
| Low | Backup JSON files reveal content + chat | `src/utils/backup.ts` emits a versioned `DocumentBackup` shape (`schema: 'apeditor-document-backup'`, `version: 1`) so a future re-importer cannot be silently fed an incompatible payload. Treat downloaded `.json` files like the documents they describe — keep them in a trusted location. |
| Low | Outdated comments reveal snippet text that no longer matches the document | The tray surfaces **Outdated** badges so the user can **Re-attach** to the current selection or **Dismiss outdated** to clean them up. |
| Low | `npm audit` high findings mostly in Tailwind/Vite toolchain (`braces`, Vite path traversal) | Dev-server / build-time exposure; keep Vite updated; not runtime XSS in the shipped editor. |
| Low | `uuid` buffer issue | App uses `v4()`; low practical impact. Upgrade when convenient. |

## Good practices already in place

- OCR (PaddleOCR + ONNX + pdf.js) runs fully in-browser; models served from `/public`.
- pdf.js configured with `isEvalSupported: false`.
- User chat bubbles render as plain text (not markdown).
- Settings UI documents that the key lives in `localStorage` by default (toggle to `sessionStorage`) and is sent as `Authorization: Bearer`.
- Import size / page caps in `src/utils/ocr.ts` reject oversized batches before any heavy work begins.
- `src/utils/backup.ts` emits a versioned JSON shape so future re-imports cannot be silently fed incompatible data.

## Reporting

Open a GitHub issue or contact the maintainer if you find a vulnerability.
Do not commit real API keys when filing bugs — redact them.
