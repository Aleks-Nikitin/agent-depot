"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    // Sync the icon to the theme the inline head script already applied to the DOM.
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
      onClick={toggle}
      aria-label="Toggle light or dark theme"
      title={theme === "dark" ? "Switch to light" : "Switch to dark"}
      className="mono flex h-8 w-8 items-center justify-center rounded-full border border-line bg-panel text-[13px] text-muted hover:text-ink"
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
