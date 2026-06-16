/**
 * Throws a clear error when a required environment variable is missing,
 * instead of surfacing a cryptic runtime error downstream.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
      `Set it in Vercel → Settings → Environment Variables.`
    );
  }
  return value;
}
