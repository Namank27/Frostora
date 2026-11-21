"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ShinyButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}

/**
 * ShinyButton (user-supplied source). The source ships its CSS in a
 * Next.js `<style jsx>` block; here the same rules live in
 * theme.css under `.shiny-cta` (this project has no styled-jsx),
 * with the same conic-gradient rotating border, dots pattern,
 * inner shimmer, breathe animation, 3s gradient-angle cycle, and
 * hover/focus expansion. Only the palette differs from the
 * source, per the user's request: frosted white / grey instead
 * of the black base and blue highlight, so the buttons sit
 * cleanly over the app's shifting ambient gradients. Props are
 * the source's children / onClick / className, widened to
 * standard button attributes so call sites keep their aria
 * labels and disabled states.
 */
export function ShinyButton({ children, onClick, className = "", type = "button", ...rest }: ShinyButtonProps) {
  return (
    <button type={type} className={`shiny-cta ${className}`} onClick={onClick} {...rest}>
      <span>{children}</span>
    </button>
  );
}
