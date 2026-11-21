import { describe, expect, it, vi } from "vitest";
import { recordSponsorshipAudit } from "../sponsorship-audit";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  db: { adminAuditLog: { create: vi.fn() } },
}));
vi.mock("@/lib/error-reporting", () => ({ reportError: vi.fn() }));

describe("recordSponsorshipAudit", () => {
  it("writes the action, target and actor", async () => {
    await recordSponsorshipAudit({
      action: "archive",
      targetId: "sp_1",
      detail: "manual",
    });
    expect(db.adminAuditLog.create).toHaveBeenCalledWith({
      data: {
        action: "archive",
        targetId: "sp_1",
        actor: "admin",
        detail: "manual",
      },
    });
  });

  it("never throws when the audit write fails", async () => {
    vi.mocked(db.adminAuditLog.create).mockRejectedValueOnce(new Error("db"));
    await expect(
      recordSponsorshipAudit({ action: "stop", targetId: "sp_1" })
    ).resolves.toBeUndefined();
  });
});
