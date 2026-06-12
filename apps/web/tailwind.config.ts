import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: 'oklch(var(--color-surface-l) var(--color-surface-c) var(--color-surface-h) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'oklch(var(--color-accent-l) var(--color-accent-c) var(--color-accent-h) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
