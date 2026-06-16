"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

interface BillingStatus {
  status?: string;
  plan?: string;
  planName?: string;
  planPriceCents?: number;
  effectivePriceCents?: number;
  currentPeriodEnd?: string;
  quota?: number;
  used?: number;
  remaining?: number;
  percentUsed?: number;
  overageCount?: number;
  isOverage?: boolean;
  freeCredits?: number;
  freeUsed?: number;
  freeRemaining?: number;
  isFounder?: boolean;
  founderLockedPrice?: number;
  referralCode?: string;
  referredBy?: string;
}

interface ReferralStatus {
  hasReferralCode: boolean;
  code?: string;
  link?: string;
  totalReferrals?: number;
  totalCreditsEarnedAUD?: string;
  referrals?: Array<{ email: string; joinedAt: string; creditEarned: string }>;
}

const PLANS = [
  {
    id: "starter",
    name: "Starter",
    price: 39,
    invoices: 25,
    desc: "Perfect for a single-location shop processing a handful of invoices per month.",
  },
  {
    id: "growth",
    name: "Growth",
    price: 89,
    invoices: 100,
    desc: "The sweet spot for multi-brand retailers with regular supplier deliveries.",
    recommended: true,
  },
  {
    id: "pro",
    name: "Pro",
    price: 179,
    invoices: 250,
    desc: "High-volume shops and buying groups with multiple locations.",
  },
];

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Past due",
  canceled: "Cancelled",
  unpaid: "Unpaid",
  paused: "Paused",
};

const STATUS_COLOR: Record<string, string> = {
  active: "text-emerald-700 bg-emerald-50 border-emerald-200",
  trialing: "text-blue-700 bg-blue-50 border-blue-200",
  past_due: "text-amber-700 bg-amber-50 border-amber-200",
  canceled: "text-red-700 bg-red-50 border-red-200",
  unpaid: "text-red-700 bg-red-50 border-red-200",
  paused: "text-text-secondary bg-surface-2 border-border-1",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric", month: "long", year: "numeric",
  });
}

function QuotaMeter({ used, quota, freeRemaining, isOverage }: {
  used: number; quota: number; freeRemaining: number; isOverage: boolean;
}) {
  const pct = Math.min(100, Math.round((used / Math.max(quota, 1)) * 100));
  const barColor = isOverage
    ? "bg-red-500"
    : pct >= 80
    ? "bg-amber-400"
    : "bg-accent";

  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-text-secondary">Invoices this period</span>
        <span className={`font-semibold ${isOverage ? "text-red-600" : "text-text-secondary"}`}>
          {used} / {quota}
          {isOverage && <span className="ml-1 text-red-500">(+{used - quota} overage @ $0.99 each)</span>}
        </span>
      </div>
      <div className="h-2 w-full bg-surface-2 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between mt-1.5 text-[11px] text-text-tertiary">
        <span>{used} used</span>
        <span>{Math.max(0, quota - used)} remaining</span>
      </div>
      {freeRemaining > 0 && (
        <div className="mt-2 text-[11px] text-accent font-medium">
          + {freeRemaining} free invoice{freeRemaining !== 1 ? "s" : ""} from referral bonus
        </div>
      )}
    </div>
  );
}

function BillingContent() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [referral, setReferral] = useState<ReferralStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, setSelectedPlan] = useState("growth");
  const [referralInput, setReferralInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();

  const success = searchParams.get("success");
  const cancelled = searchParams.get("cancelled");
  const refParam = searchParams.get("ref");

  useEffect(() => {
    if (refParam) setReferralInput(refParam);
  }, [refParam]);

  useEffect(() => {
    async function load() {
      try {
        const [statusRes, referralRes] = await Promise.all([
          fetch("/api/billing/status"),
          fetch("/api/billing/referral/status"),
        ]);
        const statusData = await statusRes.json() as BillingStatus;
        setStatus(statusData);
        if (statusData.plan) setSelectedPlan(statusData.plan);
        if (referralRes.ok) {
          const refData = await referralRes.json() as ReferralStatus;
          setReferral(refData);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load billing info");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [success]);

  const isActive = status?.status === "active" || status?.status === "trialing";

  async function handleSubscribe(plan: string) {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, referralCode: referralInput || undefined }),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (data.error) throw new Error(data.error);
      if (data.url) window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start checkout");
      setActionLoading(false);
    }
  }

  async function handleManage() {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json() as { url?: string; error?: string };
      if (data.error) throw new Error(data.error);
      if (data.url) window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open portal");
      setActionLoading(false);
    }
  }

  async function handleGenerateReferralCode() {
    setGeneratingCode(true);
    try {
      const res = await fetch("/api/billing/referral/generate", { method: "POST" });
      const data = await res.json() as ReferralStatus & { error?: string };
      if (data.error) throw new Error(data.error);
      setReferral(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate referral code");
    } finally {
      setGeneratingCode(false);
    }
  }

  async function copyLink(link: string) {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="p-10 flex items-center gap-3 text-text-tertiary justify-center">
        <div className="w-5 h-5 border-2 border-border-1 border-t-accent rounded-full animate-spin" />
        Loading billing…
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-10 max-w-3xl space-y-8">

      {/* Header */}
      <div>
        <h1 className="font-display text-4xl leading-none tracking-wide text-accent mb-1">Billing</h1>
        <p className="text-text-secondary text-sm">Manage your PitStop subscription and referrals.</p>
      </div>

      {/* Flash banners */}
      {success === "1" && (
        <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium">
          ✅ Subscription activated — welcome to PitStop!
        </div>
      )}
      {cancelled === "1" && (
        <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          Checkout cancelled. Your subscription was not changed.
        </div>
      )}
      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
      )}

      {/* ── CURRENT PLAN CARD ──────────────────────────────────────────── */}
      {isActive && status && (
        <div className="bg-surface-1 border border-border-1 overflow-hidden">
          <div className="px-6 py-5 border-b border-border-0 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div>
                <p className="text-[11px] text-text-tertiary uppercase tracking-widest font-semibold mb-0.5">Current plan</p>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-semibold text-text-primary">{status.planName}</p>
                  {status.isFounder && (
                    <span className="text-[10px] font-bold uppercase tracking-widest bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                      Founder
                    </span>
                  )}
                </div>
              </div>
              <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${STATUS_COLOR[status.status ?? ""] ?? "text-text-secondary bg-surface-2 border-border-1"}`}>
                {STATUS_LABEL[status.status ?? ""] ?? status.status}
              </span>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-accent">
                ${((status.effectivePriceCents ?? status.planPriceCents ?? 0) / 100).toFixed(0)}
                <span className="text-sm font-normal text-text-tertiary">/mo</span>
              </p>
              {status.isFounder && status.planPriceCents && status.founderLockedPrice && (
                <p className="text-xs text-text-tertiary line-through">
                  ${(status.planPriceCents / 100).toFixed(0)}/mo
                </p>
              )}
            </div>
          </div>

          <div className="px-6 py-5 space-y-5">
            {/* Quota meter */}
            <QuotaMeter
              used={status.used ?? 0}
              quota={status.quota ?? 100}
              freeRemaining={status.freeRemaining ?? 0}
              isOverage={status.isOverage ?? false}
            />

            {/* Renewal */}
            {status.currentPeriodEnd && (
              <div className="flex items-center justify-between text-sm text-text-secondary">
                <span>Next renewal</span>
                <span className="font-medium text-text-primary">{fmt(status.currentPeriodEnd)}</span>
              </div>
            )}

            {/* Founder lock notice */}
            {status.isFounder && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                <span className="text-base leading-none">🔒</span>
                <span>
                  <strong>Founder rate locked forever</strong> — your $
                  {((status.founderLockedPrice ?? 0) / 100).toFixed(0)}/mo rate will never increase,
                  even as we raise prices for new customers.
                </span>
              </div>
            )}

            {/* Referred by */}
            {status.referredBy && (
              <p className="text-xs text-text-tertiary">
                Referred by <span className="font-mono font-medium">{status.referredBy}</span>
              </p>
            )}
          </div>

          <div className="px-6 py-4 border-t border-border-0 bg-surface-2 flex justify-end">
            <button
              onClick={handleManage}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 text-sm font-medium border border-border-1 text-text-secondary hover:border-accent hover:text-accent px-4 py-2 rounded transition-colors disabled:opacity-50"
            >
              {actionLoading && <span className="w-4 h-4 border-2 border-border-1 border-t-accent rounded-full animate-spin" />}
              Manage subscription →
            </button>
          </div>
        </div>
      )}

      {/* ── PLAN PICKER (no active subscription) ──────────────────────── */}
      {!isActive && (
        <div>
          <h2 className="text-sm font-semibold text-text-secondary mb-4">Choose a plan</h2>

          {/* Referral code input */}
          <div className="mb-6 flex items-center gap-2">
            <input
              type="text"
              value={referralInput}
              onChange={(e) => setReferralInput(e.target.value.toUpperCase())}
              placeholder="Have a referral code? Enter it here (e.g. PITSTOP-ELITE)"
              className="flex-1 border border-border-1 rounded px-3 py-2 text-sm focus:outline-none focus:border-accent bg-surface-2 text-text-primary placeholder:text-text-tertiary"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {PLANS.map((p) => (
              <button
                key={p.id}
                onClick={() => !actionLoading && handleSubscribe(p.id)}
                disabled={actionLoading}
                className={`relative text-left border-2 p-5 transition-all ${
                  p.recommended
                    ? "border-accent bg-surface-2"
                    : "border-border-1 hover:border-accent/50"
                } disabled:opacity-60`}
              >
                {p.recommended && (
                  <span className="absolute -top-3 left-4 text-[10px] font-bold uppercase tracking-widest bg-accent text-white px-2 py-0.5 rounded-full">
                    Most popular
                  </span>
                )}
                <p className="text-sm font-bold text-text-primary mb-0.5">{p.name}</p>
                <p className="text-2xl font-bold text-accent mb-1">
                  ${p.price}<span className="text-sm font-normal text-text-tertiary">/mo</span>
                </p>
                <p className="text-xs text-text-secondary mb-3">{p.invoices} invoices/mo included</p>
                <p className="text-xs text-text-secondary">{p.desc}</p>
                <div className="mt-4 text-center">
                  <span className={`inline-block text-xs font-semibold px-4 py-1.5 rounded transition-colors ${
                    p.recommended
                      ? "bg-accent text-white"
                      : "bg-surface-2 text-text-secondary hover:bg-accent hover:text-white"
                  }`}>
                    {actionLoading ? "Loading…" : "Get started →"}
                  </span>
                </div>
              </button>
            ))}
          </div>

          <p className="mt-4 text-xs text-text-tertiary text-center">
            All plans include overage at $0.99/invoice beyond your quota. Cancel anytime. Powered by Stripe.
          </p>
        </div>
      )}

      {/* ── REFERRAL WIDGET (active subscribers only) ────────────────── */}
      {isActive && (
        <div className="bg-surface-1 border border-border-1 overflow-hidden">
          <div className="px-6 py-4 border-b border-border-0">
            <h2 className="text-sm font-semibold text-text-primary">Refer & Earn</h2>
            <p className="text-xs text-text-secondary mt-0.5">
              Share your link. When a shop signs up, you get <strong>$50 AUD credit</strong> and they get
              <strong> 20% off for 3 months</strong>.
            </p>
          </div>

          <div className="px-6 py-5">
            {referral?.hasReferralCode ? (
              <div className="space-y-4">
                {/* Referral link */}
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={referral.link ?? ""}
                    className="flex-1 border border-border-1 rounded px-3 py-2 text-sm font-mono bg-surface-1 text-text-secondary"
                  />
                  <button
                    onClick={() => referral.link && copyLink(referral.link)}
                    className="shrink-0 px-4 py-2 text-sm font-medium bg-accent text-white rounded hover:bg-accent-dim transition-colors"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-surface-1 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-accent">{referral.totalReferrals ?? 0}</p>
                    <p className="text-xs text-text-secondary mt-0.5">Shops referred</p>
                  </div>
                  <div className="bg-surface-1 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-accent">${referral.totalCreditsEarnedAUD ?? "0.00"}</p>
                    <p className="text-xs text-text-secondary mt-0.5">Credits earned</p>
                  </div>
                </div>

                {/* Referral list */}
                {(referral.referrals ?? []).length > 0 && (
                  <div className="border border-border-0 rounded-lg divide-y divide-border-0">
                    {referral.referrals!.map((r, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-2.5 text-xs">
                        <span className="text-text-secondary font-mono">{r.email}</span>
                        <span className="text-emerald-600 font-semibold">{r.creditEarned} ✓</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-text-secondary mb-4">
                  Generate your unique referral link. Your code will give referees 20% off for 3 months.
                </p>
                <button
                  onClick={handleGenerateReferralCode}
                  disabled={generatingCode}
                  className="inline-flex items-center gap-2 text-sm font-semibold bg-accent text-white px-5 py-2.5 rounded hover:bg-accent-dim transition-colors disabled:opacity-50"
                >
                  {generatingCode && (
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  )}
                  {generatingCode ? "Generating…" : "Get my referral link →"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Features list */}
      {!isActive && (
        <div className="bg-surface-1 border border-border-1 p-6">
          <p className="text-xs font-semibold text-text-tertiary uppercase tracking-widest mb-4">What&apos;s included in every plan</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              "AI invoice parsing (any PDF format)",
              "Shopify inventory sync — all locations",
              "Landed cost tracking + multi-currency",
              "Barcode stock take (offline-first)",
              "Supplier learning — gets smarter over time",
              "Multi-location transfers",
              "Price audit & catalogue management",
              "Duplicate invoice detection",
              "Audit log for every sync",
            ].map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm text-text-secondary">
                <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense>
      <BillingContent />
    </Suspense>
  );
}
