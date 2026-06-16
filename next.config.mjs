/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Stop MIME-type sniffing
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Enforce HTTPS for 1 year
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          // Restrict referrer information leakage
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Allow the barcode scanner to use the camera on our own origin (self).
          // camera=() blocks getUserMedia for EVERYONE — including us.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          // Content Security Policy
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Firebase, Stripe, and Anthropic APIs
              "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://api.stripe.com https://api.anthropic.com",
              // Scripts: self + Stripe.js
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://js.stripe.com",
              // Styles: self + inline (Tailwind inlines styles)
              "style-src 'self' 'unsafe-inline'",
              // Images: self + data URIs (for any base64 encoded images)
              "img-src 'self' data: blob: https://cdn.shopify.com",
              // Fonts
              "font-src 'self'",
              // Camera access for barcode scanner (worker context)
              "worker-src 'self' blob:",
              // Media (video element for barcode scanner)
              "media-src 'self' blob:",
              // Frame sources for Stripe
              "frame-src https://js.stripe.com https://hooks.stripe.com",
              // Allow Shopify Admin to embed this app in an iframe
              "frame-ancestors https://admin.shopify.com https://*.myshopify.com",
              // Object/embed
              "object-src 'none'",
              // Base URI restriction
              "base-uri 'self'",
            ].join("; "),
          },
        ],
      },
      // API routes: also add CORS prevention
      {
        source: "/api/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex" },
        ],
      },
    ];
  },
};

export default nextConfig;
