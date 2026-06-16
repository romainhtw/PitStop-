import { redirect } from "next/navigation";

// Embedded entry. Shopify loads the app at "/" with ?host=&shop=&embedded= params
// that App Bridge needs to initialize. Preserve them when redirecting to the app home.
export default function Home({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === "string") qs.set(k, v);
    else if (Array.isArray(v) && v[0]) qs.set(k, v[0]);
  }
  const s = qs.toString();
  redirect(s ? `/dashboard?${s}` : "/dashboard");
}
