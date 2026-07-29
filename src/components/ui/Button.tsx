import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

/**
 * The three button variants from the design system, as one component rather
 * than three raw class names scattered per call site. Every state (rest,
 * hover, focus-visible, active, disabled) is defined once in globals.css
 * (.btn-primary / .btn / .btn-ghost) -- this component just picks the right
 * class and enforces the icon-gap/sizing contract consistently.
 */
export default function Button({
  variant = "secondary",
  icon,
  children,
  className = "",
  ...props
}: {
  variant?: Variant;
  icon?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const base = variant === "primary" ? "btn-primary" : variant === "ghost" ? "btn-ghost" : "btn";
  return (
    <button className={`${base} ${className}`} {...props}>
      {icon}
      {children}
    </button>
  );
}
