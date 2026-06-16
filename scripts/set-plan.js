/**
 * Set a merchant's plan. Uses the Firebase CLI access token (no service account).
 * Usage: node scripts/set-plan.js <merchantId> <plan>
 * Example: node scripts/set-plan.js elite-racing unlimited
 */
const fs = require("fs");
const os = require("os");
const https = require("https");

const PROJECT_ID = "pitstop-ea39d";
const merchantId = process.argv[2] || "elite-racing";
const plan = process.argv[3] || "unlimited";

// Firebase CLI's public OAuth client (embedded in firebase-tools)
const FB_CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const FB_CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";

function readTokens() {
  const p = os.homedir() + "/.config/configstore/firebase-tools.json";
  return JSON.parse(fs.readFileSync(p, "utf8")).tokens;
}

function refreshAccessToken(refreshToken) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      client_id: FB_CLIENT_ID,
      client_secret: FB_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString();
    const req = https.request(
      { hostname: "oauth2.googleapis.com", path: "/token", method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) } },
      (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => {
        try { const j = JSON.parse(d); j.access_token ? resolve(j.access_token) : reject(new Error(d)); }
        catch { reject(new Error(d)); }
      }); }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function getAccessToken() {
  const tokens = readTokens();
  if (tokens.refresh_token) {
    try { return await refreshAccessToken(tokens.refresh_token); } catch { /* fall back */ }
  }
  return tokens.access_token;
}

function patch(path, fields, token) {
  return new Promise((resolve, reject) => {
    const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join("&");
    const body = JSON.stringify({ fields });
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents${path}?${mask}`);
    const req = https.request(
      { hostname: url.hostname, path: url.pathname + url.search, method: "PATCH",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ status: res.statusCode, body: d })); }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  const token = await getAccessToken();
  const res = await patch(
    `/merchants/${merchantId}`,
    { plan: { stringValue: plan }, updatedAt: { timestampValue: new Date().toISOString() } },
    token
  );
  console.log(`Set ${merchantId} → plan="${plan}" · HTTP ${res.status}`);
  if (res.status >= 300) { console.error(res.body); process.exit(1); }
})();
