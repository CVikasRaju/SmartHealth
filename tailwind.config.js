/** @type {import('tailwindcss').Config} */
function withOpacity(variableName) {
  return ({ opacityValue }) => {
    if (opacityValue !== undefined) {
      return `rgb(var(${variableName}) / ${opacityValue})`;
    }
    return `rgb(var(${variableName}))`;
  };
}

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        /* CSS variable-driven dynamic Light/Dark theme tokens with full alpha channel support */
        canvas: withOpacity("--color-canvas"),
        paper: {
          DEFAULT: withOpacity("--color-paper"),
          tint: withOpacity("--color-paper-tint"),
          subtle: withOpacity("--color-paper-subtle"),
        },
        surface: {
          DEFAULT: withOpacity("--color-paper"),
          700: withOpacity("--color-paper-tint"),
          800: withOpacity("--color-paper"),
          900: withOpacity("--color-paper-subtle"),
        },
        /* Crisp hairline rules */
        rule: {
          DEFAULT: withOpacity("--color-rule"),
          soft: withOpacity("--color-rule-soft"),
          strong: withOpacity("--color-rule-strong"),
        },
        /* Text ramp */
        ink: {
          900: withOpacity("--color-ink-900"),
          800: withOpacity("--color-ink-800"),
          700: withOpacity("--color-ink-700"),
          600: withOpacity("--color-ink-600"),
          500: withOpacity("--color-ink-500"),
          400: withOpacity("--color-ink-400"),
          300: withOpacity("--color-ink-300"),
        },
        /* Institutional navy & cyan accents */
        accent: {
          DEFAULT: withOpacity("--color-accent"),
          soft: withOpacity("--color-accent-soft"),
          deep: withOpacity("--color-accent-deep"),
          hover: withOpacity("--color-accent-hover"),
        },
        /* Disciplined clinical severity ramp */
        risk: {
          critical: "#dc2626",
          high: "#d97706",
          moderate: "#ca8a04",
          normal: "#16a34a",
        },
      },
      /* Clean, balanced typography ramp */
      fontSize: {
        xs: ["12px", { lineHeight: "16px" }],
        sm: ["13px", { lineHeight: "18px" }],
        base: ["14px", { lineHeight: "20px" }],
        lg: ["16px", { lineHeight: "22px" }],
        xl: ["18px", { lineHeight: "24px" }],
        "2xl": ["22px", { lineHeight: "28px" }],
        "3xl": ["26px", { lineHeight: "32px" }],
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "SF Pro Display",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        serif: [
          "Charter",
          "Iowan Old Style",
          "Palatino Linotype",
          "Palatino",
          "Book Antiqua",
          "Georgia",
          "serif",
        ],
        mono: ["SFMono-Regular", "Consolas", "Menlo", "Liberation Mono", "monospace"],
      },
      /* Refined, structured radii */
      borderRadius: {
        none: "0",
        sm: "3px",
        DEFAULT: "5px",
        md: "6px",
        lg: "8px",
        xl: "10px",
        "2xl": "12px",
        "3xl": "16px",
        full: "9999px",
      },
      boxShadow: {
        panel: "0 1px 3px 0 rgba(var(--shadow-panel-color), 0.05), 0 1px 2px -1px rgba(var(--shadow-panel-color), 0.03)",
        sheet: "0 8px 24px -4px rgba(var(--shadow-panel-color), 0.08), 0 4px 8px -2px rgba(var(--shadow-panel-color), 0.04)",
        card: "0 1px 3px 0 rgba(var(--shadow-panel-color), 0.06), 0 1px 2px 0 rgba(var(--shadow-panel-color), 0.03)",
        apple: "0 2px 8px 0 rgba(var(--shadow-panel-color), 0.06)",
        none: "none",
      },
      keyframes: {
        "pulse-ring": {
          "0%, 100%": { opacity: "0.3" },
          "50%": { opacity: "0.9" },
        },
        "rise-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-ring": "pulse-ring 2.2s ease-in-out infinite",
        "rise-in": "rise-in 160ms ease-out both",
      },
    },
  },
  plugins: [],
};
