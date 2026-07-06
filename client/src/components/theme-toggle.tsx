import { Moon, Sun, Monitor, Leaf } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark" | "system" | "aero";

function getEffectiveTheme(mode: ThemeMode): "light" | "dark" | "aero" {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
}

function applyTheme(mode: ThemeMode) {
  const effective = getEffectiveTheme(mode);
  document.documentElement.classList.toggle("dark", effective === "dark");
  document.documentElement.classList.toggle("aero", effective === "aero");
  window.dispatchEvent(new Event("theme-change"));
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>("system");

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") as ThemeMode | null;
    const initialTheme = savedTheme || "system";
    setTheme(initialTheme);
    applyTheme(initialTheme);
  }, []);

  // Listen for system theme changes when in system mode
  useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [theme]);

  const cycleTheme = () => {
    const order: ThemeMode[] = ["light", "dark", "aero", "system"];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
    localStorage.setItem("theme", next);
    applyTheme(next);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycleTheme}
      title={
        theme === "system"
          ? "System theme"
          : theme === "light"
          ? "Light mode"
          : theme === "dark"
          ? "Dark mode"
          : "Frutiger Aero mode"
      }
      data-testid="button-theme-toggle"
    >
      {theme === "system" ? (
        <Monitor className="h-5 w-5" />
      ) : theme === "light" ? (
        <Moon className="h-5 w-5" />
      ) : theme === "dark" ? (
        <Leaf className="h-5 w-5 text-emerald-500" />
      ) : (
        <Sun className="h-5 w-5" />
      )}
    </Button>
  );
}

