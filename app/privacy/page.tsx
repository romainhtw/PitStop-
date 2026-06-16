import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — PitStop",
  description: "How PitStop collects, uses, and protects data.",
};

// Public, no-auth page (required for Shopify App Store review).
// BillingGate lets /privacy through without App Bridge.
export default function PrivacyPage() {
  return (
    <main className="min-h-screen px-6 py-12">
      <article className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-sans font-semibold tracking-tight text-text-primary mb-1">
          Privacy Policy
        </h1>
        <p className="text-text-tertiary text-sm mb-8">Last updated: 16 June 2026</p>

        <div className="space-y-6 text-sm leading-relaxed text-text-secondary">
          <p>
            PitStop (&ldquo;the App&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is published by ARC LABS. This policy
            explains what data the App accesses when you install it on your Shopify store, how we use it, and
            your rights. By installing PitStop you agree to this policy.
          </p>

          <section>
            <h2 className="text-base font-semibold text-text-primary mb-2">What we access</h2>
            <p>
              PitStop only accesses the data it needs to keep your inventory accurate. With your approval at
              install, we access:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Your store domain and a Shopify access token (stored encrypted).</li>
              <li>Products, variants, SKUs, barcodes, prices, and inventory levels (read).</li>
              <li>Inventory quantities and item costs, which the App updates on your instruction (write).</li>
              <li>Store locations (read), to apply stock changes to the correct location.</li>
              <li>
                Supplier invoices and purchase-order details you upload or enter, and an audit log of the sync
                actions you perform.
              </li>
            </ul>
            <p className="mt-2 font-medium text-text-primary">
              PitStop does not access, request, or store your customers&rsquo; personal data.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-text-primary mb-2">How we use it</h2>
            <p>
              Data is used solely to provide the App&rsquo;s features: syncing inventory and costs to Shopify,
              running stocktakes, and parsing supplier invoices into reviewable purchase orders. We do not sell
              your data or use it for advertising.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-text-primary mb-2">Sub-processors</h2>
            <p>To operate the App we share the minimum necessary data with:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li><strong>Shopify</strong> — the source of, and destination for, your store data.</li>
              <li><strong>Google Firebase / Firestore</strong> — encrypted storage of tokens and App data.</li>
              <li><strong>Vercel</strong> — application hosting.</li>
              <li>
                <strong>Anthropic</strong> — invoice files you upload are sent to Anthropic&rsquo;s Claude API to
                extract line items. They are processed for parsing only and are not used to train models.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-text-primary mb-2">Retention &amp; deletion</h2>
            <p>
              When you uninstall the App, we automatically delete your stored token and App data. We also honour
              Shopify&rsquo;s mandatory data-request, customer-redact, and shop-redact webhooks. You may request
              deletion at any time using the contact below.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-text-primary mb-2">Contact</h2>
            <p>
              Questions or data requests: <a className="text-accent underline" href="mailto:support@arc-labs.com.au">support@arc-labs.com.au</a>.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
