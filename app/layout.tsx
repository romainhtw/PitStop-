import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import NavMenu from "@/components/NavMenu";
import BillingGate from "@/components/BillingGate";

export const metadata: Metadata = {
  title: "PitStop",
  description: "Supplier invoices → accurate Shopify stock & costs, in minutes.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "PitStop",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#FF5A00",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Shopify App Bridge v4 — MUST be the first <head> entries, loaded
            synchronously (no async/defer) so window.shopify + idToken() are
            ready before app code runs. */}
        <meta
          name="shopify-api-key"
          content={process.env.NEXT_PUBLIC_SHOPIFY_API_KEY ?? ""}
        />
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
        {/* Inline script prevents FOUC — applies the theme before first paint.
            Default is LIGHT to match the Shopify Admin chrome (embedded apps
            should feel native); honours a stored preference if one exists. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem('ps-theme');document.documentElement.setAttribute('data-theme',t||'light');})();`,
          }}
        />
      </head>
      <body className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}>
        {/* Native Admin navigation (App Bridge) — renders in Shopify's own sidebar */}
        <NavMenu />
        <BillingGate>
          <main className="min-h-screen">{children}</main>
        </BillingGate>
      </body>
    </html>
  );
}
