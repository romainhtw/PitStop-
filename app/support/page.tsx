import type { Metadata } from "next";
import Link from "next/link";
import PitStopLogo from "@/components/PitStopLogo";

export const metadata: Metadata = {
  title: "Support — PitStop",
  description: "Get help with PitStop.",
};

// Public, no-auth page (required for Shopify App Store review).
// BillingGate lets /support through without App Bridge.
export default function SupportPage() {
  return (
    <main className="min-h-screen px-6 py-12">
      <article className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between border-b border-border-0 pb-4">
          <PitStopLogo className="text-accent" />
          <Link href="/privacy" className="text-sm text-accent hover:text-accent-dim transition-colors">Privacy</Link>
        </div>
        <h1 className="text-2xl font-sans font-semibold tracking-tight text-text-primary mb-1">
          Support
        </h1>
        <p className="text-text-tertiary text-sm mb-8">
          We&rsquo;re here to help you keep your inventory accurate.
        </p>

        <div className="space-y-6 text-sm leading-relaxed text-text-secondary">
          <section>
            <h2 className="text-base font-semibold text-text-primary mb-2">Contact us</h2>
            <p>
              Email{" "}
              <a className="text-accent underline" href="mailto:romain@arc-labs.com.au">
                romain@arc-labs.com.au
              </a>{" "}
              and we&rsquo;ll get back to you within 1 business day. Please include your store name and a short
              description of the issue.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-text-primary mb-2">Common questions</h2>
            <dl className="space-y-4">
              <div>
                <dt className="font-medium text-text-primary">How does PitStop update my stock?</dt>
                <dd className="mt-1">
                  Upload a supplier invoice or run a stocktake, review the proposed changes, then confirm — PitStop
                  writes the new quantities and costs to Shopify at the correct location.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-text-primary">Will it change anything without my approval?</dt>
                <dd className="mt-1">
                  No. Every inventory change is shown for review and only applied after you confirm.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-text-primary">How do I cancel?</dt>
                <dd className="mt-1">
                  Uninstall PitStop from your Shopify admin (Settings → Apps). Your subscription stops and your
                  stored data is deleted automatically.
                </dd>
              </div>
            </dl>
          </section>

          <section>
            <h2 className="text-base font-semibold text-text-primary mb-2">Privacy</h2>
            <p>
              See our <a className="text-accent underline" href="/privacy">Privacy Policy</a> for how your data is
              handled.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
