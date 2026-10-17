# ONNX Runtime WASM (self-hosted)

Only the **WASM-only** pair belongs here:

- `ort-wasm-simd-threaded.wasm`
- `ort-wasm-simd-threaded.mjs`

Do **not** copy the rest of `node_modules/onnxruntime-web/dist`. The
`.jsep`, `.asyncify`, and `.jspi` builds are for WebGPU / WebNN and
are unused (`ortOptions.backend: 'wasm'` in `src/utils/ocr.ts`). They
add ~69 MB to every Vercel deployment snapshot.

Regenerate with `npm run sync:ocr-assets` (also runs on `postinstall`
and `prebuild`).
