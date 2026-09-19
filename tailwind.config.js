/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        /* Page background and the sheet that sits on it. */
        canvas: "#eef0f2",
        paper: {
          DEFAULT: "#ffffff",
          tint: "#fafaf8",
        },
        surface: {
          DEFAULT: "#ffffff",
          700: "#f7f8f9",
          800: "#ffffff",
          900: "#eef0f2",
        },
        /* Hairline rules: the backbone of a printed form. */
        rule: {
          DEFAULT: "#c9ccd2",
          soft: "#e3e5e9",
          strong: "#98a0a8",
        },
        /* Text ramp. */
        ink: {
          900: "#14181d",
          700: "#3a4048",
          500: "#5c636d",
          400: "#6b7280",
          300: "#a1a7af",
        },
        /* Institutional navy: the single accent the whole system shares. */
        accent: {
          DEFAULT: "#14416b",
          soft: "#e9eff5",
          deep: "#0c2c4a",
        },
        /* Muted, print-safe severity ramp. */
        risk: {
          critical: "#a4232b",
          high: "#a1590f",
          moderate: "#8a6a06",
          normal: "#1c6b3c",
        },
      },
      /* Compressed type ramp: clinical staff scan dense records, not hero copy. */
      fontSize: {
        xs: ["11px", { lineHeight: "15px" }],
        sm: ["12px", { lineHeight: "17px" }],
        base: ["13px", { lineHeight: "19px" }],
        lg: ["15px", { lineHeight: "21px" }],
        xl: ["17px", { lineHeight: "23px" }],
        "2xl": ["21px", { lineHeight: "26px" }],
        "3xl": ["26px", { lineHeight: "30px" }],
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        serif: [
          "Iowan Old Style",
          "Palatino Linotype",
          "Palatino",
          "Book Antiqua",
          "Georgia",
          "Times New Roman",
          "serif",
        ],
        mono: ["Consolas", "SFMono-Regular", "Menlo", "Liberation Mono", "monospace"],
      },
      /* Squared corners throughout: a document, not a dashboard card. */
      borderRadius: {
        none: "0",
        sm: "1px",
        DEFAULT: "1px",
        md: "2px",
        lg: "2px",
        xl: "2px",
        "2xl": "3px",
        "3xl": "3px",
        full: "9999px",
      },
      boxShadow: {
        /* Hairline lift only; no glow, no blur haze. */
        panel: "0 1px 0 0 rgba(20, 24, 29, 0.03)",
        sheet: "0 1px 2px rgba(20, 24, 29, 0.07)",
        none: "none",
      },
      keyframes: {
        "pulse-ring": {
          "0%, 100%": { opacity: "0.25" },
          "50%": { opacity: "0.9" },
        },
        "rise-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-ring": "pulse-ring 2.2s ease-in-out infinite",
        "rise-in": "rise-in 180ms ease-out both",
      },
    },
  },
  plugins: [],
};
