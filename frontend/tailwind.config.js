/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: 'var(--navy)',
          light: 'var(--navy-light)',
          dark: 'var(--navy-dark)',
          50: '#E8EDF5', 100: '#C5D0E5', 200: '#8FA3C5', 300: '#5A76A5',
          400: '#3A5280', 500: '#1B2A4A', 600: '#162240', 700: '#111A33',
          800: '#0C1226', 900: '#070A19',
        },
        gold: {
          DEFAULT: '#D4A843', light: '#E4C373', dark: '#B08A2E',
          50: '#FBF5E6', 100: '#F5E6BF', 200: '#EDD48F', 300: '#E4C373',
          400: '#D4A843', 500: '#B08A2E', 600: '#8C6E24', 700: '#68521B',
          800: '#443611', 900: '#201A08',
        },
        // JotForm brand colors
        jf: {
          blue:   '#0075E3',
          'blue-dark': '#005BB5',
          'blue-light': '#E8F3FF',
          orange: '#FF6100',
          'orange-dark': '#CC4E00',
          green:  '#00B695',
          'green-dark': '#008F75',
          navy:   '#0A1551',
          purple: '#9C4DD3',
          bg:     '#f3f7ff',
          border: '#C1C5E2',
          'text-secondary': '#757ea7',
          'text-muted': '#494f67',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        jf: '4px',   // JotForm's card/button radius
        'jf-lg': '8px',
        'jf-xl': '12px',
      },
      boxShadow: {
        jf: '0 2px 8px rgba(10, 21, 81, 0.08)',
        'jf-md': '0 4px 16px rgba(10, 21, 81, 0.12)',
        'jf-lg': '0 8px 32px rgba(10, 21, 81, 0.16)',
      },
    },
  },
  plugins: [],
}
