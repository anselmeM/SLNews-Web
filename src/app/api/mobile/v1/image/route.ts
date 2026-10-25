import { NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limiter";
import { fetchImageSafely, UnsafeImageUrlError } from "@/lib/safe-image-fetch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

export async function GET(request: Request) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`image-proxy:${ip}`, {
    maxRequests: 120,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate limited" },
      { status: 429, headers: { "retry-after": String(limit.retryAfter) } }
    );
  }

  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  try {
    const image = await fetchImageSafely(raw);
    return new NextResponse(image.bytes, {
      headers: {
        "content-type": image.contentType,
        "cache-control": "public, max-age=86400, s-maxage=86400, immutable",
        "x-image-proxy": "hit",
      },
    });
  } catch (error) {
    if (error instanceof UnsafeImageUrlError) {
      return NextResponse.json({ error: "url not allowed" }, { status: 400 });
    }
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
}
