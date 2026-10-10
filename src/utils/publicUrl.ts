/**
 * Absolute same-origin URL for a file under `public/`.
 * Honors Vite's `BASE_URL` so subdirectory deploys still resolve
 * `/ort/` and `/pdfjs/` instead of 404ing HTML (which the browser
 * reports as "Importing a module script failed").
 */
export function publicUrl(path: string): string {
  const rel = path.replace(/^\//, '');
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  return new URL(rel, `${origin}${base}`).href;
}
