import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-black text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <Link href="/" className="text-2xl font-bold tracking-tight">
          PitStop
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm text-white/80 hover:text-white px-3 py-2"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="text-sm bg-[#FF5A00] hover:bg-[#ff6a1a] text-white font-semibold px-4 py-2 transition-colors"
          >
            Start free →
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 pt-16 pb-24 max-w-4xl mx-auto text-center">
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight leading-tight">
          Stop doing inventory by hand.
        </h1>
        <p className="text-xl md:text-2xl text-white/80 mt-6 leading-relaxed">
          PitStop reads your supplier invoices and updates your Shopify stock automatically.
        </p>
        <p className="text-base text-white/60 mt-4 max-w-2xl mx-auto">
          Upload a PDF. We extract every line item, match it to your Shopify catalog,
          and sync quantities in minutes.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-10">
          <Link
            href="/signup"
            className="bg-[#FF5A00] hover:bg-[#ff6a1a] text-white font-semibold px-6 py-3 transition-colors"
          >
            Start free — 3 invoices/month
          </Link>
          <a
            href="#how"
            className="border border-white/20 hover:border-white/40 text-white px-6 py-3 transition-colors"
          >
            See how it works ↓
          </a>
        </div>
      </section>

      {/* Features */}
      <section id="how" className="px-6 py-20 border-t border-white/10 max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
          <Feature
            icon={<DocIcon />}
            title="Upload any invoice PDF"
            body="AI reads supplier invoices from any format — Shimano, Trek, QBP, your local distributor."
          />
          <Feature
            icon={<TargetIcon />}
            title="Smart product matching"
            body="Matches by SKU, barcode, and product name. Learns from every correction you make."
          />
          <Feature
            icon={<BoxIcon />}
            title="One-click Shopify sync"
            body="Landed cost calculation included. Updates inventory levels and cost prices together."
          />
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="px-6 py-20 border-t border-white/10 max-w-6xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-4">Simple pricing</h2>
        <p className="text-center text-white/60 mb-12">Pay for what you use. Upgrade or cancel anytime.</p>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <PriceCard name="Free"    price="$0"   period="/mo" features="3 invoices/month" />
          <PriceCard name="Starter" price="$39"  period="/mo" features="25 invoices/month" />
          <PriceCard name="Growth"  price="$89"  period="/mo" features="100 invoices/month" recommended />
          <PriceCard name="Pro"     price="$179" period="/mo" features="250 invoices/month" />
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-10 border-t border-white/10 text-center text-white/50 text-sm">
        <p>PitStop — Built for bike shops.</p>
        <p className="mt-1">© 2026</p>
      </footer>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div>
      <div className="text-[#FF5A00] mb-4">{icon}</div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-white/70 leading-relaxed">{body}</p>
    </div>
  );
}

function PriceCard({
  name,
  price,
  period,
  features,
  recommended,
}: {
  name: string;
  price: string;
  period: string;
  features: string;
  recommended?: boolean;
}) {
  return (
    <div
      className={`relative border p-6 flex flex-col ${
        recommended ? "border-[#FF5A00]" : "border-white/15"
      }`}
    >
      {recommended && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#FF5A00] text-white text-xs font-semibold px-2 py-0.5">
          Recommended
        </span>
      )}
      <h3 className="text-xl font-semibold">{name}</h3>
      <div className="mt-3 mb-3">
        <span className="text-3xl font-bold">{price}</span>
        <span className="text-white/60 text-sm">{period}</span>
      </div>
      <p className="text-white/70 text-sm mb-6">{features}</p>
      <Link
        href="/signup"
        className={`mt-auto text-center font-semibold py-2 transition-colors ${
          recommended
            ? "bg-[#FF5A00] hover:bg-[#ff6a1a] text-white"
            : "border border-white/20 hover:border-white/40 text-white"
        }`}
      >
        Get started
      </Link>
    </div>
  );
}

function DocIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
    </svg>
  );
}

function TargetIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}
