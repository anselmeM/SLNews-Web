import { db } from "@/lib/db";
import { reportError } from "@/lib/error-reporting";

/**
 * Best-effort audit entry for an admin mutation. An audit failure must not undo
 * the mutation or block the redirect, but it is reported for follow-up.
 */
export async function recordSponsorshipAudit(input: {
  action: string;
  targetId?: string | null;
  detail?: string;
}): Promise<void> {
  try {
    await db.adminAuditLog.create({
      data: {
        action: input.action,
        targetId: input.targetId ?? null,
        actor: "admin",
        detail: input.detail ?? null,
      },
    });
  } catch (error) {
    reportError(error, { where: "admin/sponsorships/audit" });
  }
}
