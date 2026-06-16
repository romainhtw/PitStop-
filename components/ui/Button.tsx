"use client";

import { forwardRef, ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
type ButtonSize = "xs" | "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const VARIANTS: Record<ButtonVariant, string> = {
  // Primary — accent fill. ONE per screen maximum.
  primary: [
    "bg-accent hover:bg-accent-dim active:bg-[#A83B00]",
    "text-white",
    "border border-accent hover:border-accent-dim",
    "disabled:bg-surface-2 disabled:text-text-tertiary disabled:border-border-0 disabled:cursor-not-allowed",
  ].join(" "),

  // Secondary — flat surface, hard border
  secondary: [
    "bg-surface-2 hover:bg-surface-3 active:bg-surface-3",
    "text-text-primary",
    "border border-border-0 hover:border-border-1 active:border-border-2",
    "disabled:text-text-tertiary disabled:cursor-not-allowed",
  ].join(" "),

  // Ghost — invisible until interacted
  ghost: [
    "bg-transparent hover:bg-surface-2 active:bg-surface-3",
    "text-text-secondary hover:text-text-primary",
    "border border-transparent hover:border-border-0",
    "disabled:text-text-tertiary disabled:cursor-not-allowed",
  ].join(" "),

  // Destructive — red tint, requires deliberate intent
  destructive: [
    "bg-transparent hover:bg-[rgba(239,68,68,0.06)] active:bg-[rgba(239,68,68,0.1)]",
    "text-status-shortage",
    "border border-[rgba(239,68,68,0.25)] hover:border-status-shortage",
    "disabled:opacity-40 disabled:cursor-not-allowed",
  ].join(" "),
};

const SIZES: Record<ButtonSize, string> = {
  xs: "h-6  px-2   text-2xs gap-1",
  sm: "h-7  px-2.5 text-xs  gap-1.5",
  md: "h-8  px-3   text-sm  gap-2",
  lg: "h-9  px-4   text-sm  gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "md", loading = false, children, className = "", disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={[
          "inline-flex items-center justify-center font-sans font-medium",
          "transition-colors duration-75",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-focus)]",
          "select-none whitespace-nowrap",
          VARIANTS[variant],
          SIZES[size],
          loading && "pointer-events-none opacity-75",
          className,
        ].join(" ")}
        {...props}
      >
        {loading && (
          <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spinner shrink-0 opacity-60" />
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
