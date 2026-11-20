/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'sans-serif'],
        num: ['Outfit', 'Inter', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 0 rgba(255, 236, 210, 0.04) inset',
      },
    },
  },
  plugins: [],
}
