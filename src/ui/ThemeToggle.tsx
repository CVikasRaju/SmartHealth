import { useEffect, useState } from "react";

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    const saved = localStorage.getItem("smartmedic_theme");
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
      root.setAttribute("data-theme", "dark");
      localStorage.setItem("smartmedic_theme", "dark");
    } else {
      root.classList.remove("dark");
      root.setAttribute("data-theme", "light");
      localStorage.setItem("smartmedic_theme", "light");
    }
  }, [theme]);

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
      title={isDark ? "Switch to Soothing Light Theme" : "Switch to Slate Dark Theme"}
      className={`inline-flex items-center gap-1.5 rounded border border-rule bg-paper px-2.5 py-1.5 text-xs text-ink-700 transition hover:border-accent hover:text-ink-900 shadow-2xs ${className ?? ""}`}
      aria-label="Toggle color theme"
    >
      <span className="text-sm leading-none">
        {isDark ? "🌙" : "☀️"}
      </span>
      <span className="font-semibold text-[11px] leading-none">
        {isDark ? "Dark Theme" : "Light Theme"}
      </span>
    </button>
  );
}

export default ThemeToggle;
