"use client";

import { useEffect, useState } from "react";
import { SunIcon, MoonIcon } from "./icons";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    // Sync the icon to whatever the inline head script already applied.
    const current = (document.documentElement.getAttribute("data-theme") as Theme) || "light";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(current);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {}
    setTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle light or dark theme"
      title={theme === "dark" ? "Switch to light" : "Switch to dark"}
      className="grid h-8 w-8 place-items-center rounded-lg border border-(--page-border) hover:opacity-80"
    >
      {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
    </button>
  );
}
