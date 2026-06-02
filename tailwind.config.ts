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
        // Subtle attention pulse for compliance banners — warm yellow
        // glow plus a small opacity dip. Soft enough to live in
        // peripheral vision without becoming the only thing on the
        // screen.
        "soft-blink": {
          "0%, 100%": {
            backgroundColor: "rgb(254 240 138)", // yellow-200
            boxShadow: "0 0 0 0 rgba(234, 179, 8, 0.0)",
          },
          "50%": {
            backgroundColor: "rgb(253 224 71)", // yellow-300
            boxShadow: "0 0 0 6px rgba(234, 179, 8, 0.12)",
          },
        },
      },
      animation: {
        "fade-in": "fade-in 160ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        "soft-blink": "soft-blink 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
