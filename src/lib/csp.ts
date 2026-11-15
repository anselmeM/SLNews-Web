import { clerkFrontendApiOrigin } from "./clerk-csp";

/**
 * Per-request Content Security Policy for the App Router.
 *
 * The policy used to live in `next.config.ts` as a static header. A static
 * header cannot contain a nonce, so it had to allow `'unsafe-inline'` scripts.
 * This module builds the same policy with the per-request nonce supplied by the
 * middleware; script URLs that are not nonce-bearing are blocked.
 */

const CLERK_FAPI = clerkFrontendApiOrigin();

// `connect-src` needs the `:*` form because the bot-protection challenge uses
// ephemeral ports, which a bare host does not match.
const CLERK_SCRIPTS = ["https://*.protect.clerk.com", CLERK_FAPI]
  .filter(Boolean)
  .join(" ");
const CLERK_CONNECTIONS = ["https://*.protect.clerk.com:*", CLERK_FAPI]
  .filter(Boolean)
  .join(" ");
const CLERK_IMAGES = [CLERK_FAPI].filter(Boolean).join(" ");
const CLERK_FRAMES = "https://*.protect.clerk.com";

/**
 * A domain allow-list is only a fallback for browsers that do not understand
 * `'strict-dynamic'`; the nonce is what authorises scripts in current browsers.
 * The inline theme bootstrap and Clerk's script tags both receive the nonce.
 */
const CLERK_SCRIPT_FALLBACK = [
  "https://*.clerk.accounts.dev",
  "https://clerk.com",
  "https://*.clerk.com",
  "https://challenges.cloudflare.com",
  CLERK_SCRIPTS,
]
  .filter(Boolean)
  .join(" ");

/** Where browsers send CSP violation reports. */
export const CSP_REPORT_URI = "/api/csp-report";

/** CSP level-3 nonce: 16 random bytes, base64 encoded. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Builds the complete policy for one response.
 *
 * `style-src` deliberately keeps `'unsafe-inline'`: Next and third-party embeds
 * inject inline styles, and style injection is not a script-execution vector.
 * `script-src` has no `'unsafe-inline'`; the nonce plus `'strict-dynamic'` lets
 * Next's hydration bootstrap, Clerk's scripts and their dynamic imports run.
 */
export function buildCspHeader(nonce: string): string {
  const allowEval =
    process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${allowEval} ${CLERK_SCRIPT_FALLBACK}`,
    "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
    `img-src 'self' data: https: blob: https://img.clerk.com https://*.clerk.accounts.dev ${CLERK_IMAGES}`,
    "font-src 'self' fonts.gstatic.com",
    `frame-src 'self' https://*.youtube.com https://youtube.com https://*.youtube-nocookie.com https://youtube-nocookie.com https://*.youtu.be https://youtu.be https://*.google.com https://consent.youtube.com https://accounts.google.com https://*.facebook.com https://facebook.com https://*.fb.watch https://fb.watch https://*.instagram.com https://instagram.com https://*.tiktok.com https://tiktok.com https://challenges.cloudflare.com ${CLERK_FRAMES}`,
    `child-src 'self' https://*.youtube.com https://youtube.com https://*.youtube-nocookie.com https://youtube-nocookie.com https://*.youtu.be https://youtu.be https://*.google.com https://consent.youtube.com https://accounts.google.com https://*.facebook.com https://facebook.com https://*.fb.watch https://fb.watch https://*.instagram.com https://instagram.com https://*.tiktok.com https://tiktok.com https://challenges.cloudflare.com ${CLERK_FRAMES}`,
    "media-src 'self' https: data: blob:",
    `connect-src 'self' https://*.vercel.app https://*.neon.tech https://*.currentsapi.services https://slnewsapiscapper.onrender.com https://*.youtube.com https://youtube.com https://*.google.com https://*.clerk.accounts.dev https://clerk.com https://*.clerk.com https://clerk-telemetry.com ${CLERK_CONNECTIONS}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    `report-uri ${CSP_REPORT_URI}`,
  ]
    .map((directive) => directive.replace(/\s+/g, " ").trim())
    .join("; ");
}
