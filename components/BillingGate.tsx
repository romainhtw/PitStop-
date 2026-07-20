"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { apiFetch } from "@/lib/apiClient";

type GateState = "checking" | "ready" | "blocked";

interface BillingStatus {
  authenticated?: boolean;
  active: boolean;
  tier?: string | null;
  confirmationUrl?: string | null;
}

// Public, no-auth routes required by Shopify App Store review (privacy policy,
// support). These must render WITHOUT App Bridge or the billing gate, since
// they're opened outside the embedded admin iframe.
const PUBLIC_PREFIXES = ["/privacy", "/support"];

export default function BillingGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublic = !!pathname && PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  const [state, setState] = useState<GateState>("checking");
  const [slow, setSlow] = useState(false);

  const runCheck = useCallback(async () => {
    setState("checking");
    // Wait for App Bridge v4 to expose shopify.idToken (max ~5 s).
    const deadline = Date.now() + 5000;
    while (
      typeof window !== "undefined" &&
      typeof (globalThis as unknown as { shopify?: { idToken?: () => Promise<string> } }).shopify?.idToken !== "function" &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 100));
    }

    try {
      const res = await apiFetch("/api/shopify/billing/status");
      const data: BillingStatus = res.ok ? await res.json() : { authenticated: false, active: false };
      // Freemium: any authenticated shop (free or paid) gets into the app. The
      // monthly invoice quota is enforced server-side at parse time, not here.
      setState(data.authenticated ? "ready" : "blocked");
    } catch {
      setState("blocked");
    }
  }, []);

  useEffect(() => {
    if (isPublic) return;
    runCheck();
  }, [isPublic, runCheck]);

  // Reassure on slow connections instead of looking frozen.
  useEffect(() => {
    if (state !== "checking") { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, [state]);

  // Public routes bypass the gate entirely.
  if (isPublic) return <>{children}</>;

  if (state === "checking") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center justify-center gap-3 min-h-screen bg-canvas text-text-secondary"
      >
        <span className="w-6 h-6 border-2 border-border-1 border-t-accent rounded-full animate-spin" />
        <p className="text-sm font-mono">{slow ? "Taking longer than usual…" : "Loading…"}</p>
      </div>
    );
  }

  if (state === "ready") {
    return <>{children}</>;
  }

  // state === "blocked" — we couldn't authenticate the shop (opened outside the
  // Shopify admin, or a transient error). This is NOT a paywall: free and paid
  // merchants both reach the app once authenticated.
  const btnStyle: React.CSSProperties = {
    marginTop: "0.5rem",
    padding: "0.75rem 1.75rem",
    fontSize: "1rem",
    fontWeight: 600,
    background: "var(--ps-accent)",
    color: "#fff",
    border: "none",
    borderRadius: "0.5rem",
    cursor: "pointer",
  };

  return (
    <div role="alert" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", textAlign: "center", padding: "2rem", fontFamily: "sans-serif", gap: "1rem" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>Couldn&apos;t load PitStop</h1>
      <p style={{ margin: 0, opacity: 0.75 }}>
        Open PitStop from your Shopify admin, then retry. If this keeps happening, check your connection.
      </p>
      <button onClick={() => runCheck()} style={btnStyle}>Retry</button>
    </div>
  );
}
