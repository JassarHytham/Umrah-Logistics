/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './index.tsx', './App.tsx', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // UM Track brand palette — matches public/home.css so the app and
        // marketing site read as one product.
        gold: {
          50: '#faf6ef',
          100: '#f4ead9',
          200: '#ecdcc0',
          300: '#d9bd8a',
          400: '#c4a267',
          500: '#b38b4d',
          600: '#a57d42',
          700: '#96723b',
          800: '#7a5d31',
          900: '#5f4826',
        },
        gray: {
          50: '#f7f5f2',
          100: '#f0ece4',
          200: '#e9e4da',
          300: '#d3cec2',
          400: '#9aa0a6',
          500: '#6b7178',
          600: '#3d434a',
          700: '#2b3036',
          800: '#21262c',
          900: '#15181b',
        },
      },
    },
  },
  plugins: [],
};
