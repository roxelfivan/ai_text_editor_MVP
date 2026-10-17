// Copy only the ONNX Runtime / pdf.js files the Import pipeline
// actually loads. `onnxruntime-web/dist` also ships WebGPU (jsep),
// Asyncify, and JSPI WASM builds (~69 MB). Those are unused because
// `src/utils/ocr.ts` sets `ortOptions.backend: 'wasm'` and Vite
// aliases the package to `ort.wasm.min.mjs`. Shipping them in
// `public/` would copy them into every Vercel deployment artifact
// and burn Hobby-tier storage (10 GB across retained deploys).
//
// Usage:
//   node scripts/sync-ocr-runtime-assets.mjs
//   npm run sync:ocr-assets
//
// Hooked as `postinstall` + `prebuild` so `public/ort` and
// `public/pdfjs` stay in lockstep with the installed package versions.

import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

/** WASM-only, SIMD + threads — matches ort.wasm.min.mjs. */
const ORT_FILES = [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
];

const PDF_WORKER = 'pdf.worker.min.mjs';

function mustExist(path) {
  try {
    statSync(path);
  } catch {
    throw new Error(`missing source file: ${path} (run npm install)`);
  }
}

function syncDir(srcDir, destDir, files) {
  mkdirSync(destDir, { recursive: true });
  for (const name of files) {
    const src = join(srcDir, name);
    mustExist(src);
    copyFileSync(src, join(destDir, name));
  }
  const keep = new Set([...files, 'README.md']);
  for (const name of readdirSync(destDir)) {
    if (!keep.has(name)) {
      rmSync(join(destDir, name), { force: true });
    }
  }
}

const ortSrc = join(ROOT, 'node_modules/onnxruntime-web/dist');
const ortDest = join(ROOT, 'public/ort');
syncDir(ortSrc, ortDest, ORT_FILES);

const pdfSrcDir = join(ROOT, 'node_modules/pdfjs-dist/build');
const pdfDest = join(ROOT, 'public/pdfjs');
syncDir(pdfSrcDir, pdfDest, [PDF_WORKER]);

const ortBytes = ORT_FILES.reduce((n, name) => n + statSync(join(ortDest, name)).size, 0);
const pdfBytes = statSync(join(pdfDest, PDF_WORKER)).size;
const mb = (n) => `${(n / (1024 * 1024)).toFixed(1)} MB`;

console.log(`synced OCR runtime assets:`);
console.log(`  public/ort    ${ORT_FILES.join(', ')} (${mb(ortBytes)})`);
console.log(`  public/pdfjs  ${PDF_WORKER} (${mb(pdfBytes)})`);
