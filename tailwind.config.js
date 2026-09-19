/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          900: "#070d1a",
          800: "#0c1424",
          700: "#121c30",
          600: "#1a2740",
          500: "#25344f",
        },
        accent: {
          DEFAULT: "#22d3ee",
          soft: "#67e8f9",
          deep: "#0e7490",
        },
        risk: {
          critical: "#f43f5e",
          high: "#fb923c",
          moderate: "#facc15",
          normal: "#34d399",
        },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Consolas", "Liberation Mono", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 12px 30px -18px rgba(0,0,0,0.9)",
      },
      keyframes: {
        "pulse-ring": {
          "0%, 100%": { opacity: "0.35" },
          "50%": { opacity: "1" },
        },
        "rise-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-ring": "pulse-ring 2.2s ease-in-out infinite",
        "rise-in": "rise-in 220ms ease-out both",
      },
    },
  },
  plugins: [],
};
