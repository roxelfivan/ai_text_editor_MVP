/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      // ApEditor design tokens.
      //   - `ape.*` is the DARK palette: pure-black base, dark panels, plum
      //     primary CTA. Driven by the logo's black + crimson-purple.
      //   - `paper.*` is the LIGHT (Muji) palette: warm cream paper, soft
      //     kraft panels, sumi ink text. Activated when <html> does NOT
      //     have the `.dark` class.
      //   - `cyber.*` holds shared brand accents (cyan, green, status
      //     colours) and is the same in both themes; light overrides for
      //     text/border/primary are in `index.css` under
      //     `html:not(.dark)`.
      colors: {
        ape: {
          // Dark tokens
          base: '#000000',
          panel: '#0B0B0F',
          elevated: '#14141A',
          hairline: '#1F1F28',
        },
        paper: {
          // Light / Muji tokens
          base: '#F5F1EA',     // warm cream (page background)
          panel: '#EDE6D8',    // kraft beige (sidebar, modals)
          elevated: '#E5DCC9',  // oat (hover rows, cards)
          hairline: '#D9D0BE',  // soft border
          ink: '#2B2620',      // sumi ink (primary text)
          inkSoft: '#6B6258',  // muted text
        },
        cyber: {
          // Border / divider tokens (used by dark mode; light uses paper.*)
          border: '#1F1F28',
          borderLight: '#D9D0BE',
          // Brand accents
          cyan: '#00E5E5',
          cyanSoft: '#7BF0F0',
          green: '#00FF7A',
          // Crimson-purple gradient (replaces the flame gradient).
          fire: '#7A1B3D',
          fireMid: '#4B1640',
          fireTo: '#2A0E2E',
          plum: '#3B0F2B',
          // Muji primary CTA — deep espresso, used in light mode only.
          clay: '#3B2A1F',
          claySoft: '#5A4636',
          // Text tokens
          primary: '#F5F5F7',     // dark mode body text
          primaryLight: '#2B2620', // light mode body text (overridden in CSS)
          muted: '#9CA3AF',        // dark muted
          mutedLight: '#6B6258',   // light muted (overridden in CSS)
          // Status
          danger: '#FF5252',
          warn: '#FFB300',
        },
      },
      boxShadow: {
        'ape-glow': '0 0 12px rgba(0, 229, 229, 0.45), 0 0 2px rgba(0, 229, 229, 0.6)',
        'ape-glow-soft': '0 0 6px rgba(0, 229, 229, 0.3)',
        'ape-glow-green': '0 0 12px rgba(0, 255, 122, 0.45), 0 0 2px rgba(0, 255, 122, 0.6)',
        'ape-fire': '0 0 14px rgba(122, 27, 61, 0.55), 0 0 4px rgba(75, 22, 64, 0.7)',
        'ape-fire-soft': '0 0 8px rgba(122, 27, 61, 0.35)',
        // Muji paper shadow — barely-there, like a sheet of paper resting
        // on a kraft desk. Used in light mode.
        'ape-paper': '0 1px 2px rgba(43, 38, 32, 0.04), 0 1px 3px rgba(43, 38, 32, 0.06)',
        'ape-paper-lift': '0 2px 4px rgba(43, 38, 32, 0.06), 0 4px 8px rgba(43, 38, 32, 0.05)',
      },
      backgroundImage: {
        // Crimson-purple gradient (replaces the old red→orange→yellow).
        // Direction: 135deg, deep crimson at the start fading through dark
        // purple into near-black plum at the end.
        'ape-fire': 'linear-gradient(135deg, #7A1B3D 0%, #4B1640 50%, #2A0E2E 100%)',
        'ape-fire-hover': 'linear-gradient(135deg, #8E2347 0%, #5A1B4D 50%, #321238 100%)',
        'ape-circuit': 'radial-gradient(circle at 20% 0%, rgba(0,229,229,0.08), transparent 50%), radial-gradient(circle at 80% 100%, rgba(0,255,122,0.05), transparent 50%)',
      },
    },
  },
  plugins: [],
};
