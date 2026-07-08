"use client";

/**
 * App Bridge native navigation.
 *
 * `<ui-nav-menu>` is an App Bridge v4 web component (provided by the CDN
 * app-bridge.js script in layout.tsx). It renders these links in Shopify
 * Admin's OWN left sidebar — the native, expected pattern for embedded apps —
 * instead of a custom sidebar drawn inside our iframe.
 *
 * Rules (per App Bridge): the FIRST <a> must carry rel="home" and point to the
 * app's home route; App Bridge intercepts clicks and performs in-frame
 * client-side navigation, keeping the Admin URL in sync.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "ui-nav-menu": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}

export default function NavMenu() {
  return (
    <ui-nav-menu>
      <a href="/dashboard" rel="home">
        Dashboard
      </a>
      <a href="/purchase-orders/new">Purchase Orders</a>
      <a href="/stock-take">Stock Take</a>
      <a href="/catalog">Catalog</a>
    </ui-nav-menu>
  );
}
