"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import PitStopLogo from "@/components/PitStopLogo";

type ViewMode = "auto" | "mobile" | "desktop";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

const NAV_GROUPS = [
  {
    label: "Stock",
    items: [
      { href: "/purchase-orders/new", label: "Purchase Orders" },
      { href: "/stock-take",          label: "Stock Take"      },
    ],
  },
  {
    label: "Catalog",
    items: [
      { href: "/catalog",     label: "Catalog"     },
      { href: "/price-audit", label: "Price Audit" },
      { href: "/transfers",   label: "Transfers"   },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/dashboard", label: "Dashboard"  },
      { href: "/audit",     label: "Audit Trail" },
    ],
  },
];

const VIEW_LABELS: Record<ViewMode, string> = { auto: "AUTO", mobile: "MOB", desktop: "DSK" };

export default function Sidebar({ open, onClose }: SidebarProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("auto");
  const pathname = usePathname();

  useEffect(() => {
    const stored = localStorage.getItem("pitStop_viewMode") as ViewMode | null;
    if (stored === "mobile" || stored === "desktop") {
      setViewMode(stored);
      applyViewMode(stored);
    }
  }, []);

  function applyViewMode(mode: ViewMode) {
    const html = document.documentElement;
    html.classList.remove("force-mobile", "force-desktop");
    if (mode === "mobile")  html.classList.add("force-mobile");
    if (mode === "desktop") html.classList.add("force-desktop");
  }

  function cycleViewMode() {
    const next: Record<ViewMode, ViewMode> = { auto: "mobile", mobile: "desktop", desktop: "auto" };
    const nextMode = next[viewMode];
    setViewMode(nextMode);
    applyViewMode(nextMode);
    if (nextMode === "auto") localStorage.removeItem("pitStop_viewMode");
    else localStorage.setItem("pitStop_viewMode", nextMode);
  }

  function isActive(href: string) {
    if (href === "/purchase-orders/new") return pathname.startsWith("/purchase-orders");
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-[rgba(0,0,0,0.65)] z-30 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        data-open={open ? "true" : "false"}
        className={[
          "fixed left-0 top-0 h-screen w-56 flex flex-col z-40",
          "bg-surface-1 border-r border-border-0",
          "transition-transform duration-200 ease-in-out",
          "lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        ].join(" ")}
      >
        {/* Mobile close */}
        <button
          onClick={onClose}
          className="absolute top-3.5 right-3.5 w-5 h-5 flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors lg:hidden"
          aria-label="Close menu"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square"/>
          </svg>
        </button>

        {/* Wordmark + logo */}
        <div className="flex-none px-5 pt-4 pb-3.5 border-b border-border-0">
          <Link href="/dashboard" onClick={onClose}>
            <PitStopLogo />
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-1">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-0.5">
              <p className="px-5 pt-3 pb-1 text-2xs font-mono font-medium text-text-tertiary uppercase tracking-widest select-none">
                {group.label}
              </p>
              {group.items.map(({ href, label }) => {
                const active = isActive(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={onClose}
                    className={[
                      "flex items-center h-8 px-5 text-sm transition-colors duration-75 border-l-2",
                      active
                        ? "border-accent text-text-primary font-medium bg-accent-muted"
                        : "border-transparent text-text-secondary hover:text-text-primary hover:bg-surface-2",
                    ].join(" ")}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer strip */}
        <div className="flex-none border-t border-border-0">
          <Link
            href="/billing"
            onClick={onClose}
            className={[
              "flex items-center gap-2.5 h-9 px-5 text-sm transition-colors duration-75 border-l-2",
              pathname === "/billing"
                ? "border-accent text-text-primary font-medium bg-accent-muted"
                : "border-transparent text-text-tertiary hover:text-text-secondary",
            ].join(" ")}
          >
            {/* Card icon — minimal, no rounding */}
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 16 12" stroke="currentColor" strokeWidth={1.2}>
              <rect x="0.6" y="0.6" width="14.8" height="10.8" strokeLinejoin="miter"/>
              <line x1="0.6" y1="3.5" x2="15.4" y2="3.5"/>
              <line x1="3" y1="7.5" x2="7" y2="7.5"/>
              <line x1="3" y1="9.2" x2="5.5" y2="9.2"/>
            </svg>
            Billing
          </Link>
          <button
            onClick={cycleViewMode}
            className="flex items-center gap-2 h-8 px-5 w-full text-xs text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <span className="font-mono text-2xs tracking-widest">{VIEW_LABELS[viewMode]}</span>
            <span>View mode</span>
          </button>
          <p className="px-5 pb-1 text-2xs font-mono text-text-tertiary opacity-50">Perth · WA</p>
          {/* Arc Labs credit */}
          <a
            href="https://www.arc-labs.com.au"
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 pb-3 flex items-center gap-1.5 opacity-30 hover:opacity-60 transition-opacity"
          >
            {/* Cocarde / rosette — pink, 8-petal */}
            <svg width="10" height="10" viewBox="0 0 20 20" fill="#FF69B4" xmlns="http://www.w3.org/2000/svg">
              <ellipse cx="10" cy="5.5" rx="2" ry="3.5"/>
              <ellipse cx="10" cy="14.5" rx="2" ry="3.5"/>
              <ellipse cx="5.5" cy="10" rx="3.5" ry="2"/>
              <ellipse cx="14.5" cy="10" rx="3.5" ry="2"/>
              <ellipse cx="6.9" cy="6.9" rx="2" ry="3.5" transform="rotate(45 6.9 6.9)"/>
              <ellipse cx="13.1" cy="6.9" rx="2" ry="3.5" transform="rotate(-45 13.1 6.9)"/>
              <ellipse cx="6.9" cy="13.1" rx="2" ry="3.5" transform="rotate(-45 6.9 13.1)"/>
              <ellipse cx="13.1" cy="13.1" rx="2" ry="3.5" transform="rotate(45 13.1 13.1)"/>
              <circle cx="10" cy="10" r="2.5"/>
            </svg>
            <span className="text-2xs font-mono text-text-tertiary">built by Arc Labs</span>
          </a>
        </div>
      </aside>
    </>
  );
}
