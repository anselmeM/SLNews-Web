export type SponsorshipStatus =
  | "draft"
  | "scheduled"
  | "live"
  | "paused"
  | "expired"
  | "archived";

type StatusInput = {
  active: boolean;
  archivedAt: Date | null;
  startsAt: Date;
  endsAt: Date | null;
};

/** Derived status shown in the admin; never trust the raw `active` flag alone. */
export function sponsorshipStatus(
  row: StatusInput,
  now = new Date()
): SponsorshipStatus {
  if (row.archivedAt !== null) return "archived";
  if (!row.active) return "paused";
  if (row.startsAt > now) return "scheduled";
  if (row.endsAt !== null && row.endsAt < now) return "expired";
  return "live";
}

export const STATUS_LABEL: Record<SponsorshipStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  live: "Live",
  paused: "Paused",
  expired: "Expired",
  archived: "Archived",
};
