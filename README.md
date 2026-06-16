# PitStop — Elite Racing Cycles Internal Ops Tool

Internal inventory and purchasing tool built for Elite Racing Cycles, Perth WA.

## Stack

- **Frontend**: Next.js 14 App Router, TypeScript, Tailwind CSS
- **Backend**: Firebase Firestore (Lite), Next.js API Routes
- **Integrations**: Shopify Admin GraphQL API, Claude AI (invoice parsing)
- **Deployment**: Vercel

## Features

- **Purchase Orders** — Upload supplier PDFs (AI-parsed) or enter manually. Review, sync inventory to Shopify, auto-reverse on delete.
- **Catalog** — Synced Shopify product list with one-click refresh.
- **Stock Take** — Category-grouped product list with per-item counters and checkboxes. Progress saved locally.
- **Price Audit** — (upcoming)
- **Build** — (upcoming)

## Environment Variables

Copy `.env.local.example` to `.env.local` and fill in:

```
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
SHOPIFY_SHOP=
SHOPIFY_ADMIN_ACCESS_TOKEN=
SHOPIFY_LOCATION_ID_STORE=
SHOPIFY_LOCATION_ID_WAREHOUSE=
ANTHROPIC_API_KEY=
```

## Development

```bash
npm install
npm run dev
```

## Deployment

Deployed automatically via Vercel on push to `main`. Environment variables are set in the Vercel dashboard.
