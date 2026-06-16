"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import BackButton from "@/components/BackButton";

const STEPS = [
  { label: "Reading document",       pct: 12 },
  { label: "Identifying line items", pct: 32 },
  { label: "Extracting prices & quantities", pct: 54 },
  { label: "Matching SKUs & barcodes", pct: 70 },
  { label: "Calculating totals",     pct: 83 },
  { label: "Almost ready",           pct: 94 },
];

function ParseProgress({ filename }: { filename: string | null }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [pct, setPct] = useState(0);

  // Animate progress toward the current step target
  useEffect(() => {
    const target = STEPS[stepIdx]?.pct ?? 94;
    if (pct >= target) return;
    const id = setInterval(() => {
      setPct((p) => {
        const next = p + 1;
        if (next >= target) { clearInterval(id); return target; }
        return next;
      });
    }, 30);
    return () => clearInterval(id);
  }, [stepIdx, pct]);

  // Advance steps on a timer
  useEffect(() => {
    if (stepIdx >= STEPS.length - 1) return;
    const delay = stepIdx === 0 ? 1800 : 4500;
    const id = setTimeout(() => setStepIdx((i) => i + 1), delay);
    return () => clearTimeout(id);
  }, [stepIdx]);

  const label = STEPS[stepIdx]?.label ?? "Almost ready";

  return (
    <div className="flex flex-col items-center gap-5 w-full max-w-sm mx-auto">
      {/* Percentage */}
      <div className="text-5xl font-display font-bold text-accent tabular-nums leading-none">
        {pct}<span className="text-2xl">%</span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 bg-surface-2 rounded-full overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Step label with pulsing dot */}
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
        </span>
        <span className="font-medium text-accent">{label}&hellip;</span>
      </div>

      {/* Filename */}
      {filename && (
        <p className="text-xs text-text-tertiary truncate max-w-full px-4">{filename}</p>
      )}
    </div>
  );
}

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<{
    invoicesUsed: number;
    invoiceLimit: number;
    remaining: number;
    isBlocked: boolean;
    plan: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/merchants/usage")
      .then((r) => r.json())
      .then(setUsage)
      .catch(() => {});
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      if (file.type !== "application/pdf") {
        setError("Please upload a PDF file.");
        return;
      }
      setFilename(file.name);
      setLoading(true);

      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/parse-invoice", { method: "POST", body: fd });

        let data: Record<string, unknown>;
        try {
          data = await res.json();
        } catch {
          throw new Error(
            `Server error (HTTP ${res.status}). The request may have timed out — try again.`
          );
        }

        // Free-tier limit hit — flip to the salesy upgrade state instead of a raw error
        if (res.status === 402 || data.limitReached) {
          setUsage((u) =>
            u ? { ...u, isBlocked: true, invoicesUsed: (data.used as number) ?? u.invoiceLimit, remaining: 0 } : u
          );
          setFilename(null);
          setLoading(false);
          return;
        }

        if (data.error) throw new Error(data.error as string);
        if (!data.id) throw new Error("Unexpected response from server — please try again.");
        router.push(`/purchase-orders/${data.id}/review`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
        setLoading(false);
      }
    },
    [router]
  );

  return (
    <div className="p-10 max-w-4xl">
      <div className="mb-4"><BackButton /></div>
      <h1 className="font-display text-4xl leading-none tracking-wide text-text-primary mb-2">
        New Purchase Order
      </h1>
      <p className="text-text-secondary mb-2 text-sm">
        Drop a supplier invoice PDF below — we&apos;ll extract the line items for you to review.
      </p>
      <p className="mb-8 text-sm">
        <span className="text-text-tertiary">No PDF? </span>
        <a href="/purchase-orders/new/manual" className="text-accent hover:underline font-medium">Build the order manually →</a>
      </p>

      {usage?.plan === "free" && (
        <div className={`mb-6 flex items-center justify-between gap-4 rounded-lg px-4 py-3 border text-sm ${
          usage.isBlocked
            ? "bg-red-50 border-red-200 text-red-700"
            : usage.remaining <= 1
            ? "bg-amber-50 border-amber-200 text-amber-700"
            : "bg-surface-2 border-border-1 text-text-secondary"
        }`}>
          <div className="flex items-center gap-2">
            <span className="font-semibold">
              {usage.invoicesUsed} / {usage.invoiceLimit}
            </span>
            <span>free invoices used this month</span>
            {usage.isBlocked && <span className="font-semibold">— limit reached</span>}
          </div>
          <a
            href="/billing"
            className="shrink-0 inline-flex items-center gap-1 font-semibold text-accent hover:underline"
          >
            Upgrade &rarr;
          </a>
        </div>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (usage?.isBlocked) return;
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        onClick={() => !loading && !usage?.isBlocked && inputRef.current?.click()}
        className={`border-2 border-dashed py-16 px-12 text-center transition-colors ${
          loading
            ? "border-border-1 bg-surface-1 cursor-default"
            : usage?.isBlocked
            ? "border-red-200 bg-red-50 cursor-not-allowed"
            : dragging
            ? "border-accent bg-surface-2 cursor-copy"
            : "border-border-1 bg-surface-1 hover:border-accent hover:bg-surface-2 cursor-pointer"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />

        {loading ? (
          <ParseProgress filename={filename} />
        ) : usage?.isBlocked ? (
          <div className="flex flex-col items-center gap-3 max-w-md mx-auto">
            <span className="text-3xl">🚀</span>
            <p className="text-text-primary font-display text-2xl tracking-wide">You&apos;re flying through invoices</p>
            <p className="text-text-secondary text-sm leading-relaxed">
              You&apos;ve used all <span className="font-semibold text-text-primary">3 free invoices</span> this month — that&apos;s real time saved on stock-keeping.
              Unlock unlimited-feel plans and keep your Shopify inventory perfectly in sync.
            </p>
            <div className="flex items-center gap-4 text-xs text-text-tertiary font-mono my-1">
              <span>Starter · 25/mo · $39</span>
              <span className="text-accent">Growth · 100/mo · $89</span>
              <span>Pro · 250/mo · $179</span>
            </div>
            <a
              href="/billing"
              className="mt-1 inline-flex items-center gap-2 bg-accent hover:bg-accent-dim text-white text-sm font-semibold px-6 py-3 rounded-lg transition-colors shadow-lg shadow-accent/20"
            >
              Choose your plan
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
            </a>
            <p className="text-[11px] text-text-tertiary mt-1">Cancel anytime · upgrade in 30 seconds</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <svg className="w-10 h-10 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m.75 12l3 3m0 0l3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <p className="text-text-primary font-semibold">Drop a PDF invoice here</p>
            <p className="text-text-secondary text-sm">or click to choose a file</p>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-6 p-4 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
