# Security notes — ApEditor (v0.3.3+)

Local-first React/Vite markdown editor. There is **no backend**; the browser
talks directly to the AI endpoint you configure.

## Secret hygiene (repo)

As of the v0.3.3 tree on GitHub:

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
| High (by design) | API key stored plaintext in `localStorage` | Prefer a local proxy that holds the key, session-only storage, or passphrase-wrapped Web Crypto. Avoid shared browsers. |
| Medium (mitigated) | Bearer token sent to any user-typed URL | **Mitigated:** HTTPS required (localhost `http://` allowed). Consider an allowlist of known providers. |
| Medium | Full document sent to the model each chat turn | Prompt injection / data exfiltration to the provider. Add “send selection only”, delimiters, and secret redaction. |
| Medium | No host-level CSP beyond the meta tag | Prefer HTTP headers (`Content-Security-Policy`, COOP/COEP) on production hosting. |
| Medium | In-browser OCR (OpenCV.js embind) needs `'unsafe-eval'` | Required by PaddleOCR's OpenCV.js `Function` constructor. Vite aliases `onnxruntime-web` to the WASM-only build so the WebGPU/JSEP glue is not loaded. `connect-src` allows `data:` for OpenCV's embedded WASM. |
| Medium | Large PDF/image import has no size/page caps | Add max file size / page limits to avoid tab DoS. |
| Low | `npm audit` high findings mostly in Tailwind/Vite toolchain (`braces`, Vite path traversal) | Dev-server / build-time exposure; keep Vite updated; not runtime XSS in the shipped editor. |
| Low | `uuid` buffer issue | App uses `v4()`; low practical impact. Upgrade when convenient. |

## Good practices already in place

- OCR (PaddleOCR + ONNX + pdf.js) runs fully in-browser; models served from `/public`.
- pdf.js configured with `isEvalSupported: false`.
- User chat bubbles render as plain text (not markdown).
- Settings UI documents that the key lives in `localStorage` and is sent as `Authorization: Bearer`.

## Reporting

Open a GitHub issue or contact the maintainer if you find a vulnerability.
Do not commit real API keys when filing bugs — redact them.
