import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "dashed";
type Size = "md" | "sm" | "icon";

const variants: Record<Variant, string> = {
  primary: "bg-(--ad-ice) text-(--ad-bg) border-transparent hover:bg-white",
  secondary: "bg-(--ad-raised) text-(--ad-text) border-(--ad-border) hover:border-(--ad-muted)/50",
  danger: "bg-transparent text-(--ad-error) border-(--ad-error-border) hover:bg-(--ad-error-bg)",
  ghost: "bg-transparent text-(--ad-muted) border-transparent hover:bg-(--ad-raised) hover:text-(--ad-text)",
  dashed: "bg-transparent text-(--ad-muted) border-dashed border-(--ad-muted)/40 hover:border-(--ad-muted) hover:text-(--ad-text)",
};
const sizes: Record<Size, string> = {
  md: "h-10 px-4 text-sm gap-2",
  sm: "h-9 px-3 text-[13px] gap-1.5",
  icon: "h-8 w-8 justify-center",
};

export const buttonClass = (variant: Variant = "secondary", size: Size = "md", className?: string) =>
  cn("inline-flex shrink-0 items-center rounded-lg border font-medium whitespace-nowrap transition-colors",
    "disabled:cursor-not-allowed disabled:border-(--ad-border) disabled:bg-transparent disabled:text-(--ad-muted)/50",
    variants[variant], sizes[size], className);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size };

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({ variant, size, className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}
