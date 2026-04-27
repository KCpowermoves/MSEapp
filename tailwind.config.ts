import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        mse: {
          red: "#C8102E",
          "red-hover": "#A60D26",
          gold: "#F4A11D",
          "gold-soft": "#FFF4DC",
          navy: "#1A2332",
          "navy-soft": "#2A3447",
          light: "#F5F5F5",
          text: "#333333",
          muted: "#6B7280",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 3px rgba(26, 35, 50, 0.08), 0 1px 2px rgba(26, 35, 50, 0.04)",
        elevated:
          "0 4px 12px rgba(26, 35, 50, 0.10), 0 2px 4px rgba(26, 35, 50, 0.06)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 160ms cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
    },
  },
  plugins: [],
};
export default config;
