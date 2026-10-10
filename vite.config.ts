import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin, Connect } from 'vite';
import { fileURLToPath, URL } from 'url';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';

// Read the single source of truth for the app version. The value is
// injected as a build-time constant so the UI header can render it
// without a runtime fetch or env-var step. Bump the version in
// package.json and it propagates here automatically.
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
const APP_VERSION = pkg.version;

// COOP/COEP headers are required so the browser exposes SharedArrayBuffer
// to the page. onnxruntime-web (PaddleOCR's runtime) needs SAB for the
// threaded WASM build. These same headers are needed by both `vite dev`
// and `vite preview`. For production deploys, set the same headers in
// the hosting layer (Netlify _headers, Vercel vercel.json, etc.).
const coopCoepHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// Dev-only middleware: Vite's import-analysis adds a `?import` suffix
// to URLs in `import(url)` calls. For our self-hosted assets in
// /ocr/, /pdfjs/, and /ort/, the `?import` query doesn't resolve to a
// real file, so Vite's SPA fallback returns the index HTML — which
// then breaks the dynamic import. We intercept the request, strip
// the `?import` suffix, and serve the actual file from public/.
// This middleware is a no-op in `vite build` / `vite preview` since
// those don't have the import-analysis layer rewriting URLs.
const stripImportQueryPlugin: Plugin = {
  name: 'strip-import-query',
  apply: 'serve',
  configureServer(server) {
    const handler: Connect.NextHandleFunction = (req, res, next) => {
      const url = req.url ?? '';
      // Only strip `?import` for our self-hosted asset directories.
      if (
        url.includes('?') &&
        (/^\/ocr\//.test(url) ||
          /^\/pdfjs\//.test(url) ||
          /^\/ort\//.test(url))
      ) {
        const [path] = url.split('?');
        // Vite's middlewares use the URL including query — rewrite the
        // request URL so the static middleware downstream serves the
        // real file.
        req.url = path;
      }
      next();
    };
    server.middlewares.use(handler);
  },
};

export default defineConfig({
  // Inject the app version (read from package.json at config-load time)
  // so `import.meta.env.VITE_APP_VERSION` is available in source. Using
  // a Vite env var keeps it tree-shakable and visible in the type
  // definition in src/vite-env.d.ts.
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(APP_VERSION),
  },
  plugins: [react(), stripImportQueryPlugin],
  resolve: {
    alias: [
      {
        find: '@',
        replacement: fileURLToPath(new URL('./src', import.meta.url)),
      },
      // Default `onnxruntime-web` is ort.bundle.min.mjs, which embeds the
      // WebGPU/JSEP glue. The WASM-only extern build matches
      // ortOptions.backend: 'wasm' and loads binaries from wasmPaths.
      {
        find: /^onnxruntime-web$/,
        replacement: resolve(
          __dirname,
          'node_modules/onnxruntime-web/dist/ort.wasm.min.mjs'
        ),
      },
    ],
  },
  server: {
    port: 5174,
    headers: coopCoepHeaders,
  },
  preview: {
    headers: coopCoepHeaders,
  },
  optimizeDeps: {
    // ORT ships its own WASM worker; let Vite leave it alone.
    exclude: ['onnxruntime-web', '@paddleocr/paddleocr-js'],
    // Force prebundle of nested CJS deps that PaddleOCR pulls in but
    // Vite can't discover from the import graph alone (it's loaded via
    // a dynamic import() inside src/utils/ocr.ts, not a static import).
    include: [
      'clipper-lib',
      'js-yaml',
      '@techstark/opencv-js',
    ],
  },
});
