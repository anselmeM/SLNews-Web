/**
 * Serves creatives from a private Vercel Blob store.
 *
 * Campaigns point at an unguessable UUID path; the Blob token stays server-side.
 * Immutable caching keeps repeat views off the database/blob read path.
 */
import { NextResponse } from "next/server";
import { readCreative } from "@/lib/admin/ad-upload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const pathname = new URL(request.url).searchParams.get("path") ?? "";
  try {
    const creative = await readCreative(pathname);
    if (!creative) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return new NextResponse(creative.stream, {
      headers: {
        "content-type": creative.contentType,
        "content-length": String(creative.size),
        "cache-control":
          "public, max-age=31536000, s-maxage=31536000, immutable",
        "x-creative-proxy": "hit",
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
