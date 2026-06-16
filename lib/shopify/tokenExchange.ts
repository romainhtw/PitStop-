/**
 * Shopify OAuth token exchange — trades an App Bridge session token (id_token)
 * for an expiring offline access token via the token-exchange grant type.
 *
 * Required for public-distribution embedded apps as Shopify no longer accepts
 * non-expiring offline tokens via the Admin API.
 */

export interface ExchangedToken {
  accessToken: string;
  scope: string;
  /** Absolute ms-epoch timestamp when the token expires (with fallback of 23 h). */
  expiresAt: number;
}

export async function exchangeSessionToken(
  shop: string,
  sessionToken: string
): Promise<ExchangedToken | null> {
  const url = `https://${shop}/admin/oauth/access_token`;

  const body = {
    client_id: process.env.SHOPIFY_API_KEY,
    client_secret: process.env.SHOPIFY_API_SECRET,
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: sessionToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    requested_token_type:
      "urn:shopify:params:oauth:token-type:offline-access-token",
    // REQUIRED: without expiring=1 Shopify returns a NON-expiring offline token,
    // which the Admin API now rejects with 403. expiring=1 → expiring token + expires_in.
    expiring: "1",
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("[tokenExchange] network error", err);
    return null;
  }

  if (!res.ok) {
    let detail = "(no body)";
    try {
      detail = await res.text();
    } catch {
      // ignore
    }
    console.error(
      `[tokenExchange] ${shop} — HTTP ${res.status}: ${detail}`
    );
    return null;
  }

  const json = (await res.json()) as {
    access_token?: string;
    scope?: string;
    expires_in?: number;
  };

  if (!json.access_token) {
    console.error("[tokenExchange] response missing access_token", json);
    return null;
  }

  // expires_in (seconds) is present only for expiring tokens. If it is ABSENT,
  // we got a non-expiring token (Admin API will reject it) — stamp expiresAt in
  // the past so the caller never treats it as fresh and always re-exchanges.
  const expiresAt = json.expires_in
    ? Date.now() + json.expires_in * 1000
    : 0;

  return {
    accessToken: json.access_token,
    scope: json.scope ?? "",
    expiresAt,
  };
}
