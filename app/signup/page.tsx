"use client";

import { useState } from "react";
import Link from "next/link";

export default function SignupPage() {
  const [shopName, setShopName]   = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail]         = useState("");
  const [staffPin, setStaffPin]   = useState("");
  const [ownerPin, setOwnerPin]   = useState("");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [success, setSuccess]     = useState<{ merchantId: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/merchants/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopName, ownerName, email, ownerPin, staffPin }),
      });
      const data = (await res.json()) as { merchantId?: string; error?: string; message?: string };
      if (!res.ok) {
        setError(data.message ?? data.error ?? "Signup failed");
        return;
      }
      setSuccess({ merchantId: data.merchantId ?? "" });
    } catch {
      setError("Connection error — try again");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
        <div className="w-full max-w-md text-center">
          <h1 className="text-4xl font-bold mb-2">PitStop</h1>
          <div className="border border-white/10 bg-white/[0.02] p-8 mt-8">
            <div className="text-[#FF5A00] text-5xl mb-4">✓</div>
            <h2 className="text-2xl font-semibold mb-2">Account created</h2>
            <p className="text-white/70 mb-6">
              Your shop ID: <span className="text-white font-mono">{success.merchantId}</span>
            </p>
            <p className="text-white/60 text-sm mb-6">
              Use your staff PIN to log in each day, your owner PIN for billing and settings.
            </p>
            <Link
              href="/login"
              className="inline-block bg-[#FF5A00] hover:bg-[#ff6a1a] text-white font-semibold px-6 py-3 transition-colors"
            >
              Go to login →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="text-4xl font-bold tracking-tight">
            PitStop
          </Link>
          <p className="text-white/60 text-sm mt-2">Get your shop set up in under a minute.</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="border border-white/10 bg-white/[0.02] p-6 space-y-4"
        >
          <Field
            label="Shop name"
            value={shopName}
            onChange={setShopName}
            placeholder="Elite Racing Cycles"
            required
          />
          <Field
            label="Your name"
            value={ownerName}
            onChange={setOwnerName}
            placeholder="Romain"
          />
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@yourshop.com"
          />
          <Field
            label="Staff PIN"
            type="password"
            value={staffPin}
            onChange={(v) => setStaffPin(v.replace(/\D/g, "").slice(0, 8))}
            placeholder="4-8 digits"
            hint="Your staff use this to log in each day"
            inputMode="numeric"
            required
          />
          <Field
            label="Owner PIN"
            type="password"
            value={ownerPin}
            onChange={(v) => setOwnerPin(v.replace(/\D/g, "").slice(0, 8))}
            placeholder="4-8 digits"
            hint="You use this for billing and settings"
            inputMode="numeric"
            required
          />

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#FF5A00] hover:bg-[#ff6a1a] disabled:opacity-50 text-white font-semibold py-3 transition-colors"
          >
            {loading ? "Creating…" : "Create my account →"}
          </button>

          <p className="text-center text-xs text-white/50 pt-2">
            Already have an account?{" "}
            <Link href="/login" className="text-[#FF5A00] hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  hint,
  required,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  inputMode?: "numeric" | "text" | "email";
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-white/90 mb-1">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        inputMode={inputMode}
        className="w-full bg-black border border-white/15 text-white placeholder:text-white/30 px-3 py-2 focus:outline-none focus:border-[#FF5A00]"
      />
      {hint && <span className="block text-xs text-white/50 mt-1">{hint}</span>}
    </label>
  );
}
