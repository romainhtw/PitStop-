"use client";

import { forwardRef, InputHTMLAttributes } from "react";

interface DataInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  prefix?: string;
  suffix?: string;
  error?: string;
  /** true for SKU, price, quantity — forces font-mono + tabular-nums */
  mono?: boolean;
}

export const DataInput = forwardRef<HTMLInputElement, DataInputProps>(
  ({ label, prefix, suffix, error, mono = false, className = "", ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label className="text-2xs font-mono font-medium text-text-tertiary uppercase tracking-widest select-none">
            {label}
          </label>
        )}
        <div
          className={[
            "flex items-stretch h-8 bg-surface-1 border",
            "transition-colors duration-75",
            "focus-within:border-border-2 focus-within:ring-2 focus-within:ring-[var(--ps-focus)]",
            error
              ? "border-status-shortage focus-within:ring-[rgba(239,68,68,0.35)]"
              : "border-border-0",
          ].join(" ")}
        >
          {prefix && (
            <span className="flex items-center px-2 text-2xs font-mono text-text-tertiary border-r border-border-0 bg-surface-2 select-none shrink-0">
              {prefix}
            </span>
          )}
          <input
            ref={ref}
            className={[
              "flex-1 min-w-0 px-2 bg-transparent text-sm outline-none border-none",
              "placeholder:text-text-tertiary",
              mono
                ? "font-mono tracking-tight data-num"
                : "font-sans text-text-primary",
              className,
            ].join(" ")}
            {...props}
          />
          {suffix && (
            <span className="flex items-center px-2 text-2xs font-mono text-text-tertiary border-l border-border-0 bg-surface-2 select-none shrink-0">
              {suffix}
            </span>
          )}
        </div>
        {error && (
          <span className="text-2xs text-status-shortage font-sans">{error}</span>
        )}
      </div>
    );
  }
);

DataInput.displayName = "DataInput";
