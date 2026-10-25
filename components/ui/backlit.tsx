import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export type BacklitEdge = "top" | "top-right" | "right" | "corner" | "all";

/**
 * Soft spectral glow from behind a solid element. Use on at most 1-2 elements per screen.
 * Decorative only: never use it to signal status. Children must have their own solid surface.
 */
export function Backlit({ edge = "top-right", live = false, className, ...props }:
  HTMLAttributes<HTMLDivElement> & { edge?: BacklitEdge; live?: boolean }) {
  return <div data-edge={edge} data-live={live || undefined} className={cn("ad-backlit rounded-xl", className)} {...props} />;
}
