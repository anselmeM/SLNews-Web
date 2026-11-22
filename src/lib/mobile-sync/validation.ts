/**
 * Parsing and validation for the sync endpoints.
 *
 * Everything here returns a structured result rather than throwing: the route
 * turns an `{ ok: false }` into the contract's 400/413 and only a genuine
 * fault becomes a 500.
 */
import {
  SYNC_LIMITS,
  type BookmarkSnapshot,
  type FollowSnapshot,
  type ReactionSnapshot,
  type SyncCollection,
  type SyncPushPayload,
} from "./types";

export interface PullQuery {
  since: Date | null;
  limit: number;
}

export interface ValidationIssue {
  collection?: SyncCollection;
  field: string;
  index?: number;
  message: string;
}

/**
 * A collection or the body as a whole broke a size limit. Kept separate from
 * `issues` so the route can pick 413 without pattern-matching error text.
 */
export interface SizeViolation {
  collection?: SyncCollection;
  limit: "rows" | "bytes";
  received: number;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      status: 400 | 413;
      issues: ValidationIssue[];
      size?: SizeViolation;
    };

/** Client clocks may run slightly fast; anything beyond this is not trusted. */
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

export const FOLLOW_KINDS = [
  "team",
  "league",
  "location",
  "topic",
  "publisher",
] as const;
export const REACTION_KINDS = ["like"] as const;

export function issue(
  field: string,
  message: string,
  index?: number
): ValidationIssue {
  return index === undefined ? { field, message } : { field, message, index };
}

function invalid<T>(
  status: 400 | 413,
  issues: ValidationIssue[],
  size?: SizeViolation
): ValidationResult<T> {
  return size
    ? { ok: false, status, issues, size }
    : { ok: false, status, issues };
}

/**
 * `Date.parse` alone is too generous for a contract that promises ISO-8601 UTC
 * with milliseconds — it accepts "2026" and "Oct 16 2026" — so require the
 * canonical shape and then confirm the calendar agrees with it (that check is
 * also what rejects 2026-02-31, which `Date.parse` quietly rolls over).
 */
export function parseIsoInstant(input: unknown): Date | null {
  if (typeof input !== "string") return null;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})$/.test(
      input
    )
  ) {
    return null;
  }
  const millis = Date.parse(input);
  if (Number.isNaN(millis)) return null;
  const parsed = new Date(millis);
  const [datePart] = input.split("T");
  if (datePart && parsed.toISOString().slice(0, 10) !== datePart) return null;
  return parsed;
}

type FieldReader<T> = (
  row: Record<string, unknown>,
  add: (field: string, message: string) => void
) => T | null;

function readString(
  row: Record<string, unknown>,
  field: string,
  max: number,
  add: (field: string, message: string) => void,
  { required, allowEmpty = false }: { required: boolean; allowEmpty?: boolean }
): string | null {
  const value = row[field];
  if (value === undefined || value === null) {
    if (required) add(field, "is required");
    return null;
  }
  if (typeof value !== "string") {
    add(field, "must be a string");
    return null;
  }
  if (value.length > max) {
    add(field, `must be at most ${max} characters`);
    return null;
  }
  if (!allowEmpty && value.length === 0) {
    add(field, "must not be empty");
    return null;
  }
  return value;
}

function readOptionalString(
  row: Record<string, unknown>,
  field: string,
  max: number,
  add: (field: string, message: string) => void
): string | null {
  return readString(row, field, max, add, {
    required: false,
    allowEmpty: true,
  });
}

function readKind(
  row: Record<string, unknown>,
  allowed: readonly string[],
  add: (field: string, message: string) => void
): string | null {
  const value = row.kind;
  if (value === undefined || value === null) {
    add("kind", "is required");
    return null;
  }
  if (typeof value !== "string" || !allowed.includes(value)) {
    add("kind", `must be one of: ${allowed.join(", ")}`);
    return null;
  }
  return value;
}

function readInstant(
  row: Record<string, unknown>,
  field: string,
  add: (field: string, message: string) => void,
  { required, fallback }: { required: boolean; fallback?: Date }
): Date | null {
  const value = row[field];
  if (value === undefined || value === null) {
    if (fallback) return fallback;
    if (required) add(field, "is required");
    return null;
  }
  const parsed = parseIsoInstant(value);
  if (!parsed) {
    add(field, "must be an ISO-8601 UTC timestamp with milliseconds");
    return null;
  }
  // Client timestamps drive last-write-wins. A fast or malicious clock must not
  // be able to park a row permanently in the future for every other device.
  const latest = new Date(Date.now() + MAX_FUTURE_SKEW_MS);
  return parsed > latest ? latest : parsed;
}

function readDeleted(
  row: Record<string, unknown>,
  add: (field: string, message: string) => void
): boolean {
  const value = row.deleted;
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") {
    add("deleted", "must be a boolean");
    return false;
  }
  return value;
}

/** The contract defaults `savedAt` to `updatedAt` on both push and pull. */
function resolveSavedAt(updatedAt: Date, explicit: Date | null): Date {
  return explicit ?? updatedAt;
}

const bookmarkReader: FieldReader<BookmarkSnapshot> = (row, add) => {
  const itemId = readString(row, "itemId", SYNC_LIMITS.maxIdLength, add, {
    required: true,
  });
  const title = readString(row, "title", SYNC_LIMITS.maxTitleLength, add, {
    required: true,
  });
  const updatedAt = readInstant(row, "updatedAt", add, { required: true });
  const sourceUrl = readOptionalString(
    row,
    "sourceUrl",
    SYNC_LIMITS.maxUrlLength,
    add
  );
  const imageUrl = readOptionalString(
    row,
    "imageUrl",
    SYNC_LIMITS.maxUrlLength,
    add
  );
  const publisher = readOptionalString(
    row,
    "publisher",
    SYNC_LIMITS.maxLabelLength,
    add
  );
  const publishedAt = readInstant(row, "publishedAt", add, { required: false });
  const savedAt = readInstant(row, "savedAt", add, { required: false });
  const deleted = readDeleted(row, add);

  if (!itemId || !title || !updatedAt) return null;
  return {
    itemId,
    title,
    updatedAt,
    savedAt: resolveSavedAt(updatedAt, savedAt),
    sourceUrl,
    imageUrl,
    publisher,
    publishedAt,
    deleted,
  };
};

const reactionReader: FieldReader<ReactionSnapshot> = (row, add) => {
  const itemId = readString(row, "itemId", SYNC_LIMITS.maxIdLength, add, {
    required: true,
  });
  const kind = readKind(row, REACTION_KINDS, add);
  const updatedAt = readInstant(row, "updatedAt", add, { required: true });
  const deleted = readDeleted(row, add);

  if (!itemId || !kind || !updatedAt) return null;
  return { itemId, kind, updatedAt, deleted };
};

const followReader: FieldReader<FollowSnapshot> = (row, add) => {
  const targetId = readString(row, "targetId", SYNC_LIMITS.maxIdLength, add, {
    required: true,
  });
  const kind = readKind(row, FOLLOW_KINDS, add);
  const updatedAt = readInstant(row, "updatedAt", add, { required: true });
  const label = readOptionalString(
    row,
    "label",
    SYNC_LIMITS.maxLabelLength,
    add
  );
  const deleted = readDeleted(row, add);

  if (!targetId || !kind || !updatedAt) return null;
  return { targetId, kind, label, updatedAt, deleted };
};

function readCollection<T>(
  body: Record<string, unknown>,
  collection: SyncCollection,
  reader: FieldReader<T>,
  issues: ValidationIssue[],
  sizes: SizeViolation[]
): T[] {
  const raw = body[collection];
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    issues.push({
      collection,
      field: collection,
      message: "must be an array of rows",
    });
    return [];
  }
  if (raw.length > SYNC_LIMITS.maxRowsPerCollection) {
    // The row cap is a size limit (413), not a malformed row (400).
    issues.push({
      collection,
      field: collection,
      message: `must contain at most ${SYNC_LIMITS.maxRowsPerCollection} rows`,
    });
    sizes.push({ collection, limit: "rows", received: raw.length });
    return [];
  }

  const rows: T[] = [];
  raw.forEach((entry, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      issues.push({
        collection,
        field: collection,
        index,
        message: "must be an object",
      });
      return;
    }
    const add = (field: string, message: string) =>
      issues.push({ collection, field, index, message });
    const parsed = reader(entry as Record<string, unknown>, add);
    if (parsed) rows.push(parsed);
  });
  return rows;
}

/**
 * Validates a raw request body. `rawBody` is the decoded text so the byte cap is
 * measured on what the client actually sent, before any parsing.
 */
export function parsePushBody(
  rawBody: string
): ValidationResult<SyncPushPayload> {
  const bytes = new TextEncoder().encode(rawBody).length;
  if (bytes > SYNC_LIMITS.maxBodyBytes) {
    return invalid(
      413,
      [
        issue(
          "body",
          `must be at most ${SYNC_LIMITS.maxBodyBytes} bytes (received ${bytes})`
        ),
      ],
      { limit: "bytes", received: bytes }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return invalid(400, [issue("body", "must be valid JSON")]);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return invalid(400, [
      issue("body", "must be a JSON object of collections"),
    ]);
  }

  const body = parsed as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  const sizes: SizeViolation[] = [];
  const bookmarks = readCollection(
    body,
    "bookmarks",
    bookmarkReader,
    issues,
    sizes
  );
  const reactions = readCollection(
    body,
    "reactions",
    reactionReader,
    issues,
    sizes
  );
  const follows = readCollection(body, "follows", followReader, issues, sizes);

  if (issues.length > 0) {
    const size = sizes[0];
    return invalid(size ? 413 : 400, issues, size);
  }

  return { ok: true, value: { bookmarks, reactions, follows } };
}

/** Validates `?since=` / `?limit=`; a malformed value is a 400, not a default. */
export function parsePullQuery(
  params: URLSearchParams
): ValidationResult<PullQuery> {
  const issues: ValidationIssue[] = [];

  let since: Date | null = null;
  const rawSince = params.get("since");
  if (rawSince !== null && rawSince !== "") {
    since = parseIsoInstant(rawSince);
    if (!since) {
      issues.push(
        issue("since", "must be an ISO-8601 UTC timestamp with milliseconds")
      );
    }
  }

  let limit: number = SYNC_LIMITS.defaultPullLimit;
  const rawLimit = params.get("limit");
  if (rawLimit !== null && rawLimit !== "") {
    const parsed = Number(rawLimit);
    if (
      !Number.isInteger(parsed) ||
      parsed < SYNC_LIMITS.minPullLimit ||
      parsed > SYNC_LIMITS.maxPullLimit
    ) {
      issues.push(
        issue(
          "limit",
          `must be an integer between ${SYNC_LIMITS.minPullLimit} and ${SYNC_LIMITS.maxPullLimit}`
        )
      );
    } else {
      limit = parsed;
    }
  }

  if (issues.length > 0) return invalid(400, issues);
  return { ok: true, value: { since, limit } };
}

/** A compact, client-safe description of what was wrong. */
export function describeIssues(issues: ValidationIssue[]): string {
  return issues
    .slice(0, 5)
    .map((entry) => {
      const where = `${entry.collection ? `${entry.collection}` : "body"}${
        entry.index === undefined ? "" : `[${entry.index}]`
      }.${entry.field}`;
      return `${where} ${entry.message}`;
    })
    .join("; ");
}
