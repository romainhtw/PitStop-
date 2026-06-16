"use client";

/** fetch wrapper that attaches the Shopify App Bridge session token to same-origin /api calls. */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let token: string | undefined;
  try {
    // App Bridge v4 global (present only when embedded in Shopify admin)
    const sh = (globalThis as unknown as { shopify?: { idToken?: () => Promise<string> } }).shopify;
    if (sh?.idToken) token = await sh.idToken();
  } catch { /* not embedded — no token */ }
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
