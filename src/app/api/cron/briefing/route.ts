import { NextResponse } from "next/server";
import { sendMorningBriefing } from "@/lib/briefing-service";

export async function GET(request: Request) {
  // Bearer only: a ?secret= would leak into logs, referrers and caches.
  const authHeader = request.headers.get("authorization");
  const isValid =
    Boolean(process.env.CRON_SECRET) &&
    authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isValid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const briefing = await sendMorningBriefing();

  return NextResponse.json({
    success: true,
    briefing,
  });
}
