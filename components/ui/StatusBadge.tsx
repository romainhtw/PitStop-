/**
 * StatusBadge
 * Border-only badges with 2px left accent bar. Never filled.
 * Designed to sit inside dense tables without visual noise.
 */

export type StatusType =
  | "EXACT_MATCH"
  | "COST_DRIFT"
  | "QTY_SHORTAGE"
  | "NEW_ITEM"
  | "PENDING"
  | "LOCKED"
  | "APPROVED"
  | "DRAFT"
  | "ORDERED"
  | "AWAITING_REVIEW";

interface BadgeConfig {
  label: string;
  color: string;
  bg: string;
}

const STATUS_CONFIG: Record<StatusType, BadgeConfig> = {
  EXACT_MATCH:     { label: "MATCH",   color: "var(--ps-status-match)",    bg: "var(--ps-status-match-bg)"    },
  APPROVED:        { label: "MATCH",   color: "var(--ps-status-match)",    bg: "var(--ps-status-match-bg)"    },
  COST_DRIFT:      { label: "DRIFT",   color: "var(--ps-status-drift)",    bg: "var(--ps-status-drift-bg)"    },
  QTY_SHORTAGE:    { label: "SHORT",   color: "var(--ps-status-shortage)", bg: "var(--ps-status-shortage-bg)" },
  NEW_ITEM:        { label: "NEW",     color: "var(--ps-status-new)",      bg: "var(--ps-status-new-bg)"      },
  PENDING:         { label: "PENDING", color: "var(--ps-status-pending)",  bg: "var(--ps-status-pending-bg)"  },
  AWAITING_REVIEW: { label: "REVIEW",  color: "var(--ps-status-pending)",  bg: "var(--ps-status-pending-bg)"  },
  ORDERED:         { label: "ORDERED", color: "var(--ps-status-pending)",  bg: "var(--ps-status-pending-bg)"  },
  DRAFT:           { label: "DRAFT",   color: "var(--ps-text-tertiary)",   bg: "transparent"                  },
  LOCKED:          { label: "LOCKED",  color: "var(--ps-text-tertiary)",   bg: "transparent"                  },
};

interface StatusBadgeProps {
  status: StatusType;
  className?: string;
}

export function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.LOCKED;
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 font-mono text-2xs font-medium tracking-[0.08em] select-none ${className}`}
      style={{
        color: cfg.color,
        backgroundColor: cfg.bg,
        border: `1px solid ${cfg.color}35`,
        borderLeftWidth: "2px",
        borderLeftColor: cfg.color,
      }}
    >
      {cfg.label}
    </span>
  );
}

/** Dot-only variant for inline status (no label) */
export function StatusDot({ status }: { status: StatusType }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.LOCKED;
  return (
    <span
      className="inline-block w-1.5 h-1.5 shrink-0"
      style={{ backgroundColor: cfg.color }}
      aria-hidden="true"
    />
  );
}
