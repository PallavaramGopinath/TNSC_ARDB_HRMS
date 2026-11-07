/** @type {import('tailwindcss').Config} */
// Palette ported from TNCU_GAMS tncu-theme.css (coral brand, warm grays).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '"Noto Sans Tamil"', 'system-ui', 'sans-serif'],
        tamil: ['"Noto Sans Tamil"', 'sans-serif'],
      },
      colors: {
        brand: {
          25: '#FFF8F4', 50: '#FFEFE7', 100: '#FCD9C8', 200: '#F8B89C', 300: '#F2906B', 400: '#EE6F42',
          500: '#E45626', 600: '#C8431B', 700: '#A2360F', 800: '#7E2C0D', 900: '#5C220C', 950: '#3A1606',
        },
        ink: {
          25: '#FBFAF9', 50: '#F6F5F3', 100: '#EEEDEA', 200: '#E3E1DC', 300: '#CDC9C2', 400: '#9E988E',
          500: '#6F6A61', 600: '#524E47', 700: '#3C3833', 800: '#292621', 900: '#1A1714', 950: '#0E0C0A',
        },
        danger: { 50: '#FEF2F1', 100: '#FEE3E1', 500: '#F04437', 600: '#D92C20', 700: '#B32218' },
        warning: { 50: '#FFF9EB', 100: '#FEEFC6', 500: '#F78F08', 600: '#DB6803', 700: '#B54707' },
        success: { 50: '#ECFCF2', 100: '#DBF9E6', 500: '#17B26A', 600: '#079455', 700: '#067647' },
      },
      boxShadow: { card: '0 1px 2px rgba(26,23,20,.06), 0 1px 3px rgba(26,23,20,.08)' },
    },
  },
  plugins: [],
};
