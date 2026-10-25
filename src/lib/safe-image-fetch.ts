import { lookup } from "node:dns/promises";
import net from "node:net";

/** Thrown when a URL must not be fetched (scheme, host or resolved address). */
export class UnsafeImageUrlError extends Error {}

const BLOCKED_HOSTS = ["localhost", "metadata.google.internal"];

/** TRUE for loopback, RFC1918, link-local, CGNAT, multicast and v6 equivalents. */
export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const parts = address.split(".").map(Number);
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (net.isIPv6(address)) {
    const value = address.toLowerCase();
    if (value === "::1" || value === "::") return true;
    if (
      value.startsWith("fe8") ||
      value.startsWith("fe9") ||
      value.startsWith("fea") ||
      value.startsWith("feb")
    )
      return true;
    if (value.startsWith("fc") || value.startsWith("fd")) return true;
    if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7));
    return false;
  }
  return true;
}

/** Rejects non-https, private literals and hostnames that resolve privately. */
export async function assertPublicImageUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeImageUrlError("invalid url");
  }
  // Publisher feeds still advertise http; upgrade before validating.
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:") throw new UnsafeImageUrlError("scheme");

  const host = url.hostname.toLowerCase();
  if (
    BLOCKED_HOSTS.includes(host) ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new UnsafeImageUrlError("host");
  }
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new UnsafeImageUrlError("address");
    return url;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new UnsafeImageUrlError("dns");
  }
  if (addresses.length === 0) throw new UnsafeImageUrlError("dns");
  // Any private answer is fatal: a mixed-answer host could otherwise race the
  // public address during the fetch (DNS rebinding).
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new UnsafeImageUrlError("address");
  }
  return url;
}

export interface FetchedImage {
  bytes: ArrayBuffer;
  contentType: string;
  finalUrl: string;
}

const MAX_REDIRECTS = 3;
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Fetches an image without following redirects blindly.
 *
 * Every hop is re-validated (scheme, private literal, DNS answer), which closes
 * the redirect-to-internal SSRF the previous `redirect: "follow"` allowed.
 */
export async function fetchImageSafely(
  raw: string,
  options: { timeoutMs?: number; userAgent?: string } = {}
): Promise<FetchedImage> {
  let current = await assertPublicImageUrl(raw);
  const timeout = options.timeoutMs ?? 12_000;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: {
        "user-agent":
          options.userAgent ??
          "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36 SLNews/1.0",
        accept: "image/avif,image/webp,image/*,*/*;q=0.8",
        referer: `${current.origin}/`,
      },
      signal: AbortSignal.timeout(timeout),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new UnsafeImageUrlError("redirect");
      const next = new URL(location, current).toString();
      current = await assertPublicImageUrl(next);
      continue;
    }

    if (!response.ok) throw new Error(`upstream ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/"))
      throw new UnsafeImageUrlError("content-type");
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_BYTES) throw new UnsafeImageUrlError("too-large");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES)
      throw new UnsafeImageUrlError("too-large");
    return { bytes, contentType, finalUrl: current.toString() };
  }
  throw new UnsafeImageUrlError("too-many-redirects");
}
