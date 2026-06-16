"use client";

import { useEffect } from "react";
import { Button } from "./Button";

type ModalType = "error" | "warning" | "info";

interface HardModalProps {
  type: ModalType;
  title: string;
  body: string;
  /** Optional monospace code block (invoice ref, discrepancy data, etc.) */
  code?: string;
  confirmLabel?: string | null;
  cancelLabel?: string;
  onConfirm?: () => void;
  onCancel: () => void;
}

const TYPE_COLOR: Record<ModalType, string> = {
  error:   "var(--ps-status-shortage)",
  warning: "var(--ps-status-drift)",
  info:    "var(--ps-status-pending)",
};

export function HardModal({
  type,
  title,
  body,
  code,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: HardModalProps) {
  // Escape key closes
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ps-overlay)]"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="w-full max-w-[400px] mx-4 bg-surface-1 border border-border-0 animate-modal-in"
        style={{ borderTop: `2px solid ${TYPE_COLOR[type]}` }}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-4 pt-4 pb-3 border-b border-border-0">
          <span className="text-sm font-medium text-text-primary font-sans leading-snug pr-4">
            {title}
          </span>
          <button
            onClick={onCancel}
            className="shrink-0 w-5 h-5 flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-2.5">
          <p className="text-sm text-text-secondary font-sans leading-relaxed">{body}</p>
          {code && (
            <pre className="bg-surface-2 border border-border-0 px-3 py-2 text-xs font-mono text-text-secondary overflow-x-auto whitespace-pre-wrap">
              {code}
            </pre>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-0">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          {confirmLabel !== null && onConfirm && (
            <Button
              variant={type === "error" ? "destructive" : "primary"}
              size="sm"
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
