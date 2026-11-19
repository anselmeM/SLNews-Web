import { NextResponse } from "next/server";

import { db } from "@/lib/db";

/**
 * When the follow digest last ran, and how many subjects it found.
 *
 * `DigestRun` is the idempotency claim: one row per UTC day, written only when
 * the digest has something to send. Its `createdAt` is therefore the moment the
 * 06:30 cron produced a digest, and its absence means the day was quiet (or the
 * digest threw before claiming).
 *
 * This exists because Vercel's historical runtime logs are not retrievable from
 * the CLI, so a scheduled "did the digest run?" check had no durable source.
 * It exposes counts and the day only — no story ids, no reader identity.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const last = await db.digestRun.findFirst({
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      digest: last
        ? {
            day: last.day,
            topics: last.topics,
            at: last.createdAt.toISOString(),
          }
        : null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        digest: null,
        error: error instanceof Error ? error.message : "digest status failed",
      },
      { status: 503 },
    );
  }
}
