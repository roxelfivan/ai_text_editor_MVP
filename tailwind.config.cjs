/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Source Sans 3"', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        serif: ['"Newsreader"', 'Georgia', '"Times New Roman"', 'serif'],
        display: ['"Newsreader"', 'Georgia', '"Times New Roman"', 'serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      // ApEditor design tokens (v0.3.0 — aligned with apeditor-landing).
      //   - `ape.*`      DARK palette: warm near-black surfaces.
      //   - `paper.*`    LIGHT palette: cream paper, sumi ink.
      //   - `cyber.*`    Shared brand accents: moss-green primary,
      //                crimson-purple gradient (dark mode CTA).
      // Each token is the only one the codebase uses — old aliases that
      // accumulated during the v0.2.5 → v0.3.0 rebrand have been pruned.
      colors: {
        ape: {
          base: '#11171B',
          panel: '#1A2026',
          elevated: '#222932',
        },
        paper: {
          base: '#F4F1EA',
          surface: '#FFFCF8',
          panel: '#FFFCF8',
          elevated: '#EBE6DC',
          hairline: '#E3DDD1',
          ink: '#171614',
          inkSoft: '#5C574F',
        },
        cyber: {
          // Shared borders.
          border: '#2A2F35',

          // Moss-green primary (deep in light mode, bright in dark mode).
          clay: '#1B4636',
          cyan: '#6FBF99',
          cyanSoft: '#A8D6BB',

          // Soft variants for primary-tinted backgrounds.
          claySoft: '#E5F0EA',
          brickSoft: '#F6E8E4',
          brickSoftDark: '#3D2620',

          // Crimson-purple gradient (dark-mode CTA accent).
          fire: '#7A1B3D',

          // Strike (brick-red).
          brick: '#8D3A30',
          brickBright: '#D39080',

          // Text — flipped per theme via CSS custom properties so the
          // same `text-cyber-primary` / `text-cyber-muted` class resolves
          // to a high-contrast colour in BOTH themes.
          primary: 'rgb(var(--cyber-primary) / <alpha-value>)',
          muted: 'rgb(var(--cyber-muted) / <alpha-value>)',

          // Status.
          danger: '#C0432B',
          warn: '#B7791F',
        },
      },
      boxShadow: {
        // Paper shadow — barely-there, like a sheet of paper on a kraft
        // desk. Used in light mode for surfaces and floating panels.
        'ape-paper': '0 1px 2px rgba(23, 22, 20, 0.04), 0 1px 3px rgba(23, 22, 20, 0.06)',
        'ape-paper-lift': '0 2px 4px rgba(23, 22, 20, 0.06), 0 4px 8px rgba(23, 22, 20, 0.05)',
        // Dark-mode moss glow on focus/hover.
        'ape-glow-soft': '0 0 6px rgba(111, 191, 153, 0.3)',
        // Crimson-purple CTA glow.
        'ape-fire': '0 0 14px rgba(122, 27, 61, 0.55), 0 0 4px rgba(75, 22, 64, 0.7)',
        'ape-fire-soft': '0 0 8px rgba(122, 27, 61, 0.35)',
      },
      backgroundImage: {
        'ape-fire': 'linear-gradient(135deg, #7A1B3D 0%, #4B1640 50%, #2A0E2E 100%)',
        'ape-fire-hover': 'linear-gradient(135deg, #8E2347 0%, #5A1B4D 50%, #321238 100%)',
      },
    },
  },
  plugins: [],
};