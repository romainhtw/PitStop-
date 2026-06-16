"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiClient";

type GateState = "checking" | "active" | "required";

interface BillingStatus {
  active: boolean;
  confirmationUrl?: string | null;
}

export default function BillingGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>("checking");
  const [confirmationUrl, setConfirmationUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
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
        if (cancelled) return;

        const data: BillingStatus = res.ok ? await res.json() : { active: false };
        if (cancelled) return;

        if (data.active) {
          setState("active");
        } else {
          setConfirmationUrl(data.confirmationUrl ?? null);
          setState("required");
        }
      } catch {
        if (!cancelled) setState("required");
      }
    }

    check();
    return () => { cancelled = true; };
  }, []);

  if (state === "checking") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          fontFamily: "sans-serif",
          color: "inherit",
        }}
      >
        Loading…
      </div>
    );
  }

  if (state === "active") {
    return <>{children}</>;
  }

  // state === "required"
  function handleStartTrial() {
    if (!confirmationUrl) return;
    try {
      window.top!.location.href = confirmationUrl;
    } catch {
      window.open(confirmationUrl, "_top");
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        textAlign: "center",
        padding: "2rem",
        fontFamily: "sans-serif",
        gap: "1rem",
      }}
    >
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>
        Start your PitStop subscription
      </h1>
      <p style={{ margin: 0, opacity: 0.75 }}>
        $19/month &middot; 30-day free trial &middot; cancel anytime
      </p>

      {confirmationUrl ? (
        <button
          onClick={handleStartTrial}
          style={{
            marginTop: "0.5rem",
            padding: "0.75rem 1.75rem",
            fontSize: "1rem",
            fontWeight: 600,
            background: "#FF5A00",
            color: "#fff",
            border: "none",
            borderRadius: "0.5rem",
            cursor: "pointer",
          }}
        >
          Start free trial
        </button>
      ) : (
        <p style={{ margin: 0, opacity: 0.6 }}>
          Couldn&apos;t start billing — please refresh to retry.
        </p>
      )}
    </div>
  );
}
