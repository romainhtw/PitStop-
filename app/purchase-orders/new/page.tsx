"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import BackButton from "@/components/BackButton";

const STEPS = [
  { label: "Reading document",              pct: 12 },
  { label: "Identifying line items",        pct: 32 },
  { label: "Extracting prices & quantities",pct: 54 },
  { label: "Matching SKUs & barcodes",      pct: 70 },
  { label: "Calculating totals",            pct: 83 },
  { label: "Almost ready",                  pct: 94 },
];

function ParseProgress({ filename }: { filename: string | null }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [pct, setPct] = useState(0);
  const [slow, setSlow] = useState(false);

  // Honest stall reassurance — the bar is perceived-progress, so once it parks
  // near the end tell the user we're still working rather than looking frozen.
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 12000);
    return () => clearTimeout(id);
  }, []);

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

  useEffect(() => {
    if (stepIdx >= STEPS.length - 1) return;
    const delay = stepIdx === 0 ? 1800 : 4500;
    const id = setTimeout(() => setStepIdx((i) => i + 1), delay);
    return () => clearTimeout(id);
  }, [stepIdx]);

  const label = STEPS[stepIdx]?.label ?? "Almost ready";

  return (
    <div className="flex flex-col items-center gap-5 w-full max-w-sm mx-auto">
      <div className="text-5xl font-display font-bold text-accent tabular-nums leading-none">
        {pct}<span className="text-2xl">%</span>
      </div>
      <div className="w-full h-1.5 bg-surface-2 rounded-full overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
        </span>
        <span className="font-medium text-accent">{label}&hellip;</span>
      </div>
      {filename && (
        <p className="text-xs text-text-tertiary truncate max-w-full px-4">{filename}</p>
      )}
      {slow && (
        <p className="text-xs text-text-tertiary text-center px-4">
          Still working — large or scanned invoices can take a little longer.
        </p>
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
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      // Phone "Files"/scan flows often hand back an empty or octet-stream MIME for
      // a real PDF — fall back to the .pdf extension before rejecting.
      const looksPdf =
        file.type === "application/pdf" ||
        ((file.type === "" || file.type === "application/octet-stream") &&
          /\.pdf$/i.test(file.name));
      if (!looksPdf) {
        setError("Please upload a PDF file.");
        return;
      }
      setFilename(file.name);
      setLoading(true);

      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await apiFetch("/api/parse-invoice", { method: "POST", body: fd });

        let data: Record<string, unknown>;
        try {
          data = await res.json();
        } catch {
          throw new Error(
            `Server error (HTTP ${res.status}). The request may have timed out — try again.`
          );
        }

        // Prefer a human-readable `message` (e.g. billing check couldn't be
        // verified — 503) over the raw error code.
        if (data.error) throw new Error((data.message as string) || (data.error as string));
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
      <h1 className="text-2xl font-sans font-semibold tracking-tight text-text-primary mb-2">
        New Purchase Order
      </h1>
      <p className="text-text-secondary mb-2 text-sm">
        Drop a supplier invoice PDF below — we&apos;ll extract the line items for you to review.
      </p>
      <p className="mb-8 text-sm">
        <span className="text-text-tertiary">No PDF? </span>
        <a href="/purchase-orders/new/manual" className="text-accent hover:underline font-medium">Build the order manually →</a>
      </p>

      <div
        role="button"
        tabIndex={loading ? -1 : 0}
        aria-label="Upload invoice PDF"
        aria-disabled={loading || undefined}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        onClick={() => !loading && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !loading) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`border-2 border-dashed py-16 px-12 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          loading
            ? "border-border-1 bg-surface-1 cursor-default"
            : dragging
            ? "border-accent bg-surface-2 cursor-copy"
            : "border-border-1 bg-surface-1 hover:border-accent hover:bg-surface-2 cursor-pointer"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          aria-label="Invoice PDF file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />

        {loading ? (
          <ParseProgress filename={filename} />
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
