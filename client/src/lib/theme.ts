import { useEffect } from "react";

export type ThemeMode = "light" | "dark" | "system";

export function getThemeMode(): ThemeMode {
  return (localStorage.getItem("theme") as ThemeMode | null) || "system";
}

function applyTheme(mode: ThemeMode) {
  const effective = mode === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : mode;
  document.documentElement.classList.toggle("dark", effective === "dark");
  window.dispatchEvent(new Event("theme-change"));
}

export function setThemeMode(mode: ThemeMode) {
  localStorage.setItem("theme", mode);
  applyTheme(mode);
}

// Applies the saved theme on mount and follows the OS setting while in system mode.
export function useThemeSync() {
  useEffect(() => {
    applyTheme(getThemeMode());
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (getThemeMode() === "system") applyTheme("system");
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
}
