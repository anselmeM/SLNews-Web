/**
 * The Clerk Frontend API origin, derived from the publishable key.
 *
 * A publishable key is `pk_<env>_<base64(frontendApiHost + "$")>` — the third
 * underscore-separated segment decodes to the host ClerkJS actually talks to
 * (e.g. `optimal-shepherd-5919.clerk.accounts.dev`, or `clerk.slnews.sl` on a
 * production instance with its own-domain Frontend API).
 *
 * Deriving it means the Content-Security-Policy built in `src/lib/csp.ts` always
 * matches whichever instance is configured. Hardcoding a host instead leaves a
 * policy that silently blocks ClerkJS the moment the keys change — and that
 * happens in production, during the one change where debugging is hardest.
 *
 * Evaluated by the per-request CSP builder (middleware/edge runtime); the key is
 * embedded in the build environment, not read from the request.
 *
 * @returns e.g. `"https://clerk.slnews.sl"`, or `null` when the key is absent or
 *   malformed (callers should then fall back to the static Clerk origins).
 */
export function clerkFrontendApiOrigin(
  key: string | undefined = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
): string | null {
  // pk_<test|live>_<base64>
  const encoded = key?.split("_")[2];
  if (!encoded) return null;

  let host: string;
  try {
    // Clerk terminates the encoded host with "$".
    host = atob(encoded).replace(/\$$/, "");
  } catch {
    return null;
  }

  // Only accept a plausible hostname, so a malformed key can never inject an
  // arbitrary value into the policy (no spaces, wildcards, paths or ports).
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)) return null;

  return `https://${host}`;
}
