"use client";

/**
 * ShopifyConfigModal — pitch-black, sharp-edged, monospace.
 *
 * Shown when the user clicks "Sync to Shopify" but the merchant has not yet
 * connected a Shopify store. On submit, validates + persists credentials,
 * then calls onSuccess() so the parent can resume the sync.
 */
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/apiClient";

export interface ShopifyConfigModalProps {
  merchantId: string;
  onSuccess: () => void;
  onClose:   () => void;
}

const DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export default function ShopifyConfigModal({ merchantId, onSuccess, onClose }: ShopifyConfigModalProps) {
  const [domain, setDomain] = useState("");
  const [token, setToken]   = useState("");
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const firstInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstInput.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const adminAppsUrl = domain && DOMAIN_RE.test(domain)
    ? `https://${domain.toLowerCase()}/admin/apps/development`
    : "https://your-store.myshopify.com/admin/apps/development";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const d = domain.trim().toLowerCase();
    const t = token.trim();

    if (!DOMAIN_RE.test(d)) {
      setError("Domain must look like your-store.myshopify.com");
      return;
    }
    if (t.length < 10) {
      setError("Admin API token looks too short.");
      return;
    }

    setBusy(true);
    try {
      const res = await apiFetch("/api/merchants/config", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          merchantId,
          shopifyStoreDomain: d,
          shopifyAdminToken:  t,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || data.error || "Could not save Shopify config");
        return;
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full bg-[#0a0a0a] border border-border-1 px-3 py-2.5 font-mono text-sm text-text-primary " +
    "placeholder:text-text-tertiary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent " +
    "disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in"
      onClick={() => { if (!busy) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shopify-config-title"
        className="w-full max-w-md mx-4 bg-canvas border border-border-1 shadow-hard-md animate-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-1">
          <div>
            <p className="font-mono text-2xs uppercase tracking-widest text-text-tertiary">Step 1 of 1</p>
            <h2 id="shopify-config-title" className="font-mono text-base text-accent mt-0.5">
              CONNECT SHOPIFY
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="font-mono text-text-tertiary hover:text-text-primary disabled:opacity-40 text-lg leading-none px-1"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-5 space-y-5">
          <p className="font-mono text-xs text-text-secondary leading-relaxed">
            Paste your store domain and a Shopify Admin API access token. PitStop
            verifies the token with Shopify before saving — nothing is stored if it
            doesn&apos;t work.
          </p>

          {/* Domain */}
          <div>
            <label htmlFor="ps-shop-domain" className="block font-mono text-2xs uppercase tracking-widest text-text-tertiary mb-1.5">
              Store Domain
            </label>
            <input
              ref={firstInput}
              id="ps-shop-domain"
              type="text"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="your-store.myshopify.com"
              className={inputCls}
            />
          </div>

          {/* Token */}
          <div>
            <label htmlFor="ps-shop-token" className="block font-mono text-2xs uppercase tracking-widest text-text-tertiary mb-1.5">
              Admin API Token
            </label>
            <input
              id="ps-shop-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="shpat_xxxx"
              className={inputCls}
            />
            <p className="mt-2 font-mono text-2xs text-text-tertiary leading-relaxed">
              Create one at{" "}
              <a
                href={adminAppsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline break-all"
              >
                {adminAppsUrl.replace(/^https:\/\//, "")}
              </a>
              {" "}— scopes: read/write products, inventory, orders.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="border border-red-500/40 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-400 animate-error-shake">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="font-mono text-2xs uppercase tracking-widest text-text-tertiary hover:text-text-primary px-3 py-2 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !domain || !token}
              className="inline-flex items-center gap-2 bg-accent hover:bg-accent-dim disabled:opacity-50 disabled:cursor-not-allowed text-text-inverse font-mono text-2xs uppercase tracking-widest px-4 py-2.5 transition-colors"
            >
              {busy ? (
                <>
                  <svg className="w-3 h-3 animate-spinner" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                    <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Verifying…
                </>
              ) : (
                "Connect & Sync"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
