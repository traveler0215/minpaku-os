import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: '#e5e7eb',
        input: '#d1d5db',
        ring: '#06C755',
        background: '#f9fafb',
        foreground: '#111827',
        primary: {
          DEFAULT: '#06C755',
          foreground: '#ffffff',
        },
        secondary: {
          DEFAULT: '#f3f4f6',
          foreground: '#111827',
        },
        muted: {
          DEFAULT: '#f9fafb',
          foreground: '#6b7280',
        },
        accent: {
          DEFAULT: '#f3f4f6',
          foreground: '#111827',
        },
        card: {
          DEFAULT: '#ffffff',
          foreground: '#111827',
        },
        destructive: {
          DEFAULT: '#ef4444',
          foreground: '#ffffff',
        },
      },
      borderRadius: {
        lg: '0.5rem',
        md: '0.375rem',
        sm: '0.25rem',
      },
      fontFamily: {
        sans: ['"Noto Sans JP"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
