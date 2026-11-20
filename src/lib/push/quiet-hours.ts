/**
 * Quiet hours: a local-time window in which the daily digest is not delivered.
 *
 * Times are minutes since local midnight. A window may wrap past midnight
 * (22:00–07:00), and an unset or empty window never suppresses anything.
 */

export const MINUTES_PER_DAY = 24 * 60;

/** The reader's local minute-of-day for [now] at [offsetMinutes] east of UTC. */
export function localMinuteOfDay(now: Date, offsetMinutes: number): number {
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (((utcMinutes + offsetMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) %
    MINUTES_PER_DAY;
}

/** True when [now] falls inside the reader's quiet window. */
export function isWithinQuietHours(
  now: Date,
  offsetMinutes: number,
  start: number | null,
  end: number | null
): boolean {
  if (start === null || end === null) return false;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
  if (start < 0 || start >= MINUTES_PER_DAY) return false;
  if (end < 0 || end >= MINUTES_PER_DAY) return false;
  if (start === end) return false;

  const minute = localMinuteOfDay(now, offsetMinutes);
  // A window that does not wrap: start <= minute < end. A wrapping window is its
  // complement: minute >= start or minute < end.
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/** Parses a `HH:MM` string into minutes; null when malformed. */
export function parseClock(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Formats minutes as `HH:MM`, for logs and API responses. */
export function formatClock(minutes: number | null): string | null {
  if (minutes === null || !Number.isInteger(minutes)) return null;
  if (minutes < 0 || minutes >= MINUTES_PER_DAY) return null;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}
