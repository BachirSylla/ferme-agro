/** @type {import('tailwindcss').Config} */
// Palette via variables CSS (cf. CLAUDE.md) → chargées au runtime depuis `organization`.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'rgb(var(--brand-rgb) / <alpha-value>)',
          fg: 'rgb(var(--brand-fg-rgb) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
