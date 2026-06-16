"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PitStopLogo from "@/components/PitStopLogo";
import { Suspense } from "react";

function LoginForm() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") ?? "/dashboard";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantId: "elite-racing", pin }),
      });
      if (res.ok) {
        router.push(from);
        router.refresh();
      } else {
        const data = await res.json() as { error?: string };
        setError(data.error ?? "Invalid PIN");
        setPin("");
      }
    } catch {
      setError("Connection error — try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <PitStopLogo className="text-accent justify-center" />
          <p className="text-text-secondary text-sm mt-2">Elite Racing Cycles — Internal ops tool</p>
        </div>
        <div className="bg-surface-1 border border-border-1 p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="pin" className="block text-sm font-medium text-text-primary mb-1">
                Access PIN
              </label>
              <input
                id="pin"
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter your PIN"
                autoComplete="current-password"
                className="w-full px-3 py-2 border border-border-1 rounded-lg text-sm text-text-primary bg-surface-2 placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
                required
              />
            </div>
            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading || !pin}
              className="w-full bg-accent text-white py-2 px-4 rounded-lg text-sm font-semibold hover:bg-accent-dim disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {loading && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
              {loading ? "Checking…" : "Access PitStop"}
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-text-tertiary mt-4">
          Perth, WA · Elite Racing Cycles
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
