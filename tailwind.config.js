/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: "#0f1117", card: "#1a1d27", hover: "#242836" },
        border: "#2a2e3d",
        primary: { DEFAULT: "#6366f1", hover: "#818cf8" },
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
