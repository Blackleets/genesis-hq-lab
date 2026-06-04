/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        carbon: {
          50:  '#1a1d24',
          100: '#15171d',
          200: '#10131a',
          300: '#0a0c12',
        },
        trim: '#262d3d',
        // Lighter hairline for the "top-light" edge on elevated surfaces
        'trim-lit': '#323a4d',
        wall: '#181d28',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      // ── Canonical type scale (replaces 13 ad-hoc text-[Npx] sizes) ──
      // Named by role, each carries its own line-height for vertical rhythm.
      fontSize: {
        'gx-micro': ['9px',  { lineHeight: '1.25', letterSpacing: '0.04em' }],
        'gx-label': ['10px', { lineHeight: '1.3' }],
        'gx-body':  ['11px', { lineHeight: '1.45' }],
        'gx-base':  ['12px', { lineHeight: '1.5' }],
        'gx-sub':   ['13px', { lineHeight: '1.45' }],
        'gx-h3':    ['15px', { lineHeight: '1.3',  letterSpacing: '-0.005em' }],
        'gx-h2':    ['18px', { lineHeight: '1.25', letterSpacing: '-0.01em' }],
        'gx-h1':    ['24px', { lineHeight: '1.15', letterSpacing: '-0.015em' }],
      },
      // ── Canonical tracking (replaces 7 ad-hoc tracking-[Nem]) ──
      letterSpacing: {
        'gx-label': '0.12em',  // standard uppercase labels
        'gx-over':  '0.2em',   // overlines / section eyebrows
        'gx-hero':  '0.3em',   // hero eyebrows
      },
      // ── Premium elevation: subtle depth, never heavy ──
      boxShadow: {
        // Card: soft drop + inset top highlight (the "light from above" edge)
        'gx-card': '0 2px 10px -4px rgba(0,0,0,0.55), inset 0 1px 0 0 rgba(255,255,255,0.04)',
        // Pop: elevated panels / hover
        'gx-pop':  '0 10px 30px -8px rgba(0,0,0,0.7), inset 0 1px 0 0 rgba(255,255,255,0.06)',
        // Inset: recessed wells (charts, code areas)
        'gx-well': 'inset 0 1px 4px 0 rgba(0,0,0,0.45)',
      },
    },
  },
  plugins: [],
};
