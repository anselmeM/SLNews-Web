/**
 * `/api/mobile/v1/sponsorships/[id]` — campaign lifecycle.
 *
 * PATCH `{ active?: boolean, endsAt?: ISO string | null }` stops a campaign early or
 * extends it; DELETE is a soft delete (`active: false`) that keeps the counters for the
 * monthly report. Both require `x-admin-key`.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { reportError } from "@/lib/error-reporting";
import { adminKeyMatches } from "@/lib/admin-key";

const WHERE = "api/mobile/v1/sponsorships/[id]";

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function authorized(request: Request): NextResponse | null {
  const expected = process.env.SPONSORSHIP_ADMIN_KEY?.trim();
  if (!expected)
    return json({ error: "Sponsorship admin is not configured." }, 503);
  if (!adminKeyMatches(request.headers.get("x-admin-key"), expected)) {
    return json({ error: "Unauthorized" }, 401);
  }
  return null;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const denied = authorized(request);
  if (denied) return denied;
  const { id } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Expected a JSON body." }, 400);
  }

  const data: { active?: boolean; endsAt?: Date | null } = {};
  if (typeof body.active === "boolean") data.active = body.active;
  if (body.endsAt === null) data.endsAt = null;
  else if (typeof body.endsAt === "string") {
    const parsed = new Date(body.endsAt);
    if (Number.isNaN(parsed.getTime())) {
      return json({ error: "endsAt must be an ISO date." }, 400);
    }
    data.endsAt = parsed;
  }
  if (Object.keys(data).length === 0) {
    return json({ error: "Nothing to update (active|endsAt)." }, 400);
  }

  try {
    const updated = await db.sponsorship.update({ where: { id }, data });
    return json({
      ok: true,
      id: updated.id,
      active: updated.active,
      endsAt: updated.endsAt,
    });
  } catch (error) {
    reportError(error, { where: `${WHERE} (patch)` });
    return json({ error: "Could not update the campaign." }, 404);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const denied = authorized(request);
  if (denied) return denied;
  const { id } = await context.params;
  try {
    await db.sponsorship.update({ where: { id }, data: { active: false } });
    return json({ ok: true, id, active: false });
  } catch (error) {
    reportError(error, { where: `${WHERE} (delete)` });
    return json({ error: "Could not stop the campaign." }, 404);
  }
}
