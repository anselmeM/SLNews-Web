import { describe, expect, it } from "vitest";
import {
  formatClock,
  isWithinQuietHours,
  localMinuteOfDay,
  parseClock,
} from "../quiet-hours";

describe("localMinuteOfDay", () => {
  it("applies the reader's offset and wraps past midnight", () => {
    const at = new Date("2026-11-20T22:30:00Z");
    expect(localMinuteOfDay(at, 0)).toBe(22 * 60 + 30);
    expect(localMinuteOfDay(at, 120)).toBe(30);
    expect(localMinuteOfDay(at, -120)).toBe(20 * 60 + 30);
  });
});

describe("isWithinQuietHours", () => {
  const at = new Date("2026-11-20T23:30:00Z");

  it("suppresses inside a window that wraps midnight", () => {
    expect(isWithinQuietHours(at, 0, 22 * 60, 7 * 60)).toBe(true);
    expect(isWithinQuietHours(new Date("2026-11-21T03:00:00Z"), 0, 22 * 60, 7 * 60)).toBe(true);
    expect(isWithinQuietHours(new Date("2026-11-21T07:00:00Z"), 0, 22 * 60, 7 * 60)).toBe(false);
    expect(isWithinQuietHours(new Date("2026-11-20T12:00:00Z"), 0, 22 * 60, 7 * 60)).toBe(false);
  });

  it("suppresses inside a same-day window", () => {
    expect(isWithinQuietHours(at, 0, 23 * 60, 24 * 60 - 1)).toBe(true);
    expect(isWithinQuietHours(at, 0, 8 * 60, 17 * 60)).toBe(false);
  });

  it("evaluates the window in the reader's local time", () => {
    // 23:30 UTC is 08:30 in a +9 zone: a 07:00–09:00 window applies there.
    expect(isWithinQuietHours(at, 9 * 60, 7 * 60, 9 * 60)).toBe(true);
    expect(isWithinQuietHours(at, 9 * 60, 22 * 60, 7 * 60)).toBe(false);
  });

  it("never suppresses when the window is unset, empty or invalid", () => {
    expect(isWithinQuietHours(at, 0, null, null)).toBe(false);
    expect(isWithinQuietHours(at, 0, 22 * 60, 22 * 60)).toBe(false);
    expect(isWithinQuietHours(at, 0, -1, 60)).toBe(false);
    expect(isWithinQuietHours(at, 0, 22 * 60, 24 * 60)).toBe(false);
  });
});

describe("clock helpers", () => {
  it("parses and formats HH:MM", () => {
    expect(parseClock("22:05")).toBe(22 * 60 + 5);
    expect(parseClock("00:00")).toBe(0);
    expect(formatClock(22 * 60 + 5)).toBe("22:05");
    expect(formatClock(0)).toBe("00:00");
  });

  it("rejects malformed clocks", () => {
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("9:30")).toBeNull();
    expect(parseClock("noon")).toBeNull();
    expect(formatClock(-1)).toBeNull();
    expect(formatClock(24 * 60)).toBeNull();
  });
});
