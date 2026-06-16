"use client";

import Link from "next/link";
import PitStopLogo from "@/components/PitStopLogo";

interface TopBarProps {
  onOpenSidebar: () => void;
}

export default function TopBar({ onOpenSidebar }: TopBarProps) {
  return (
    <header className="bg-surface-1 border-b border-border-0 px-4 h-11 flex items-center justify-between sticky top-0 z-20 lg:hidden">
      {/* Hamburger — 3 lines, 1px each */}
      <button
        onClick={onOpenSidebar}
        className="flex flex-col gap-[5px] p-1.5 text-text-secondary hover:text-text-primary transition-colors"
        aria-label="Open menu"
      >
        <span className="block w-[18px] h-px bg-current" />
        <span className="block w-[18px] h-px bg-current" />
        <span className="block w-[18px] h-px bg-current" />
      </button>

      <Link href="/dashboard">
        <PitStopLogo />
      </Link>

      {/* Balance placeholder */}
      <span className="w-9" aria-hidden="true" />
    </header>
  );
}
