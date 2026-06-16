import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import AppShell from "@/components/AppShell";

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
        {/* Inline script prevents FOUC — applies dark theme before first paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem('ps-theme');document.documentElement.setAttribute('data-theme',t||'dark');})();`,
          }}
        />
        {/* Shopify App Bridge v4 — harmless on non-embedded pages */}
        <meta
          name="shopify-api-key"
          content={process.env.NEXT_PUBLIC_SHOPIFY_API_KEY ?? ""}
        />
        <script
          src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
          async
        />
      </head>
      <body className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}>
        {/* Orange halo — fixed overlay, pointer-events off so it never blocks clicks */}
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            zIndex: 9999,
            boxShadow: "inset 0 0 120px 20px rgba(255,90,0,0.08)",
          }}
        />
        <AppShell />
        <main className="lg:ml-56 min-h-screen">{children}</main>
      </body>
    </html>
  );
}
