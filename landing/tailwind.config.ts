import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          50:  '#f0f3f9',
          100: '#d9e0ef',
          200: '#b3c1df',
          300: '#8da2cf',
          400: '#6783bf',
          500: '#4a69a9',
          600: '#3a5287',
          700: '#2a3c65',
          800: '#1a2744',
          900: '#0f172a',
          950: '#080d19',
        },
      },
    },
  },
  plugins: [],
}

export default config
