import { describe, expect, it } from "vitest";
import { sponsorshipStatus } from "./sponsorship-status";

const now = new Date("2026-11-21T12:00:00Z");
const base = {
  active: true,
  archivedAt: null,
  startsAt: new Date("2026-11-21T10:00:00Z"),
  endsAt: new Date("2026-11-21T18:00:00Z"),
};

describe("sponsorshipStatus", () => {
  it("derives live, scheduled, paused, expired and archived", () => {
    expect(sponsorshipStatus(base, now)).toBe("live");
    expect(
      sponsorshipStatus({ ...base, startsAt: new Date("2026-11-21T13:00:00Z") }, now)
    ).toBe("scheduled");
    expect(sponsorshipStatus({ ...base, active: false }, now)).toBe("paused");
    expect(
      sponsorshipStatus({ ...base, endsAt: new Date("2026-11-20T18:00:00Z") }, now)
    ).toBe("expired");
    expect(
      sponsorshipStatus({ ...base, archivedAt: now }, now)
    ).toBe("archived");
  });
});
