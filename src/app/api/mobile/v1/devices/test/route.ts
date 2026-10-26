/**
 * `/api/mobile/v1/devices/test` — send a test notification to every registered
 * device.
 *
 * Admin-only (`x-admin-key`), same key as the sponsorship console. It uses the
 * exact `sendNativePush` path production uses, so a success here proves the
 * service account, token registry and app registration all work together.
 */
import { NextResponse } from "next/server";
import { reportError } from "@/lib/error-reporting";
import { sendNativePush } from "@/lib/push/fcm";
import { adminKeyMatches } from "@/lib/admin-key";

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const expected = process.env.SPONSORSHIP_ADMIN_KEY?.trim();
  if (!expected)
    return json({ error: "Sponsorship admin is not configured." }, 503);
  if (!adminKeyMatches(request.headers.get("x-admin-key"), expected)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // Body is optional; a JSON content-type with no body is fine.
  }
  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : "SLNews test notification";
  const text =
    typeof body.body === "string" && body.body.trim()
      ? body.body.trim()
      : "If you can read this, push notifications are working.";

  try {
    const result = await sendNativePush({
      title,
      body: text,
      url: "/",
      category: "test",
    });
    return json({
      ok: result.sent > 0,
      sent: result.sent,
      failed: result.failed,
      invalid: result.invalid,
      skipped: result.skipped ?? null,
    });
  } catch (error) {
    reportError(error, { where: "api/mobile/v1/devices/test" });
    return json({ error: "Could not send the test notification." }, 500);
  }
}
