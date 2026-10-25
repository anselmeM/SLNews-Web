import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36 SLNews/1.0";
const MAX_BYTES = 8 * 1024 * 1024;

/** Reject anything that could reach the private network (SSRF). */
function isPublicHttps(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return false;
  return true;
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw)
    return NextResponse.json({ error: "url required" }, { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
    // Many Sierra Leone outlets still advertise http:// images; Android blocks
    // cleartext, so normalise before validating.
    if (target.protocol === "http:") target.protocol = "https:";
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (!isPublicHttps(target)) {
    return NextResponse.json({ error: "host not allowed" }, { status: 400 });
  }

  try {
    const upstream = await fetch(target, {
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: "image/avif,image/webp,image/*,*/*;q=0.8",
        // Some CDNs require a referer from the publisher's own origin.
        referer: `${target.origin}/`,
      },
      signal: AbortSignal.timeout(12000),
    });
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!upstream.ok || !contentType.startsWith("image/")) {
      return NextResponse.json({ error: "not an image" }, { status: 502 });
    }
    const length = Number(upstream.headers.get("content-length") ?? "0");
    if (length > MAX_BYTES) {
      return NextResponse.json({ error: "image too large" }, { status: 413 });
    }
    const bytes = await upstream.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "image too large" }, { status: 413 });
    }
    return new NextResponse(bytes, {
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=86400, s-maxage=86400, immutable",
        "x-image-proxy": "hit",
      },
    });
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
}
