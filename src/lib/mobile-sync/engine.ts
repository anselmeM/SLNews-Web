/**
 * The mobile sync merge engine.
 *
 * Everything that touches Prisma lives here so the route stays thin and the
 * merge rules can be tested against a fake database (see
 * `src/lib/mobile-sync/__tests__/engine.test.ts`).
 *
 * Merge invariants, from the frozen contract:
 *
 *  - Last-write-wins per row on the client's `updatedAt`, compared as instants.
 *  - `<` stored → rejected as `stale`; `==` → idempotent, nothing is written;
 *    `>` → applied.
 *  - Deletions are tombstones. `deletedAt` is derived from the winning
 *    `updatedAt` on every write, never carried in from the client, so a stale
 *    non-deleted push cannot resurrect a row (it loses the compare and is
 *    rejected).
 *  - Pushing a tombstone for a row that does not exist records one, so an
 *    offline delete is not undone by the next pull.
 *  - `state` returns the server's row for everything the client touched —
 *    including rejected rows — so the client converges in one round trip.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  STALE_REASON,
  type BookmarkDTO,
  type BookmarkSnapshot,
  type FollowDTO,
  type FollowSnapshot,
  type ReactionDTO,
  type ReactionSnapshot,
  type RejectedRow,
  type SyncCollection,
  type SyncPullResult,
  type SyncPushPayload,
  type SyncPushResult,
  type SyncState,
} from "./types";

/**
 * Only the pieces of the Prisma client this engine uses. Narrowing it keeps the
 * engine callable from tests with a fake database and makes it obvious that it
 * needs no other model.
 */
export interface MobileSyncDb {
  mobileBookmark: {
    findMany(args: unknown): Promise<BookmarkDbRow[]>;
  };
  mobileReaction: {
    findMany(args: unknown): Promise<ReactionDbRow[]>;
  };
  mobileFollow: {
    findMany(args: unknown): Promise<FollowDbRow[]>;
  };
  $executeRaw(query: Prisma.Sql): Promise<number>;
  $transaction<T>(
    fn: (tx: MobileSyncDb) => Promise<T>,
    options?: { timeout?: number; maxWait?: number }
  ): Promise<T>;
}

export interface BookmarkDbRow {
  itemId: string;
  title: string;
  sourceUrl: string | null;
  imageUrl: string | null;
  publisher: string | null;
  publishedAt: Date | null;
  savedAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ReactionDbRow {
  itemId: string;
  kind: string;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface FollowDbRow {
  targetId: string;
  kind: string;
  label: string | null;
  updatedAt: Date;
  deletedAt: Date | null;
}

interface MergeOutcome<T> {
  /** Rows the server wrote. */
  changed: T[];
  /** Rows already at that exact instant: idempotent, nothing to write. */
  equal: T[];
  rejected: RejectedRow[];
  /** The server's view of every key the client touched. */
  state: Map<string, T>;
}

/** The fields a merge compares: the client clock and the tombstone flag. */
interface Mergeable {
  updatedAt: Date;
  deleted: boolean;
}

/**
 * Last-write-wins per row. `stored` holds the rows the database already has for
 * the keys in this batch; rows the client sends that are not in it are new.
 */
function mergeRows<T extends Mergeable>(
  incoming: T[],
  stored: Map<string, T>,
  keyOf: (row: T) => string,
  collection: SyncCollection
): MergeOutcome<T> {
  const outcome: MergeOutcome<T> = {
    changed: [],
    equal: [],
    rejected: [],
    state: new Map(),
  };
  // A batch that mentions the same key twice is not described by the contract;
  // the last row wins, mirroring a client that queued two edits for one item.
  const settled = new Set<string>();

  for (const row of incoming) {
    const key = keyOf(row);
    const storedRow = stored.get(key);
    const storedAt = storedRow?.updatedAt.getTime();
    const incomingAt = row.updatedAt.getTime();

    if (settled.has(key)) {
      outcome.changed = outcome.changed.filter((entry) => keyOf(entry) !== key);
      outcome.equal = outcome.equal.filter((entry) => keyOf(entry) !== key);
      outcome.rejected = outcome.rejected.filter(
        (entry) => entry.itemId !== key
      );
    }
    settled.add(key);

    if (storedAt === undefined || incomingAt > storedAt) {
      outcome.state.set(key, row);
      outcome.changed.push(row);
      continue;
    }
    if (incomingAt === storedAt && storedRow) {
      // Same instant: one representation has to win, and the tombstone flag does
      // not agree. Letting the incoming row win would mean a client could clear a
      // deletion by re-sending the row with the timestamp the deletion already
      // has, which is exactly what tombstones exist to prevent.
      const storedWins = storedRow.deleted && !row.deleted;
      outcome.state.set(key, storedWins ? storedRow : row);
      outcome.equal.push(row);
      continue;
    }
    // Stale: the client's row lost, so the server's row is what `state` reports.
    // This is what makes a stale non-deleted push unable to plant a live row on a
    // tombstone in the client's own view.
    if (storedRow) outcome.state.set(key, storedRow);
    outcome.rejected.push({ collection, itemId: key, reason: STALE_REASON });
  }

  return outcome;
}

const CHUNK_SIZE = 300;
const BASE_TX_TIMEOUT_MS = 10_000;
const PER_ROW_TX_BUDGET_MS = 10;

/**
 * SQL type per column. A `VALUES` list is untyped, so Postgres resolves every
 * bound parameter as `text` and then refuses to put it in a `timestamp` column
 * (`42804: column "publishedAt" is of type timestamp without time zone but
 * expression is of type text`). The casts are what make the batch legal.
 */
const COLUMN_TYPES: Record<string, string> = {
  userId: "text",
  itemId: "text",
  targetId: "text",
  title: "text",
  sourceUrl: "text",
  imageUrl: "text",
  publisher: "text",
  label: "text",
  kind: "text",
  publishedAt: "timestamp(3)",
  savedAt: "timestamp(3)",
  updatedAt: "timestamp(3)",
  deletedAt: "timestamp(3)",
};

function castFor(column: string): Prisma.Sql {
  const type = COLUMN_TYPES[column];
  return type ? Prisma.raw(`::${type}`) : Prisma.empty;
}

/**
 * One `INSERT … VALUES` plus one guarded `UPDATE … FROM (VALUES …)` per chunk,
 * instead of one upsert per row, so a 500-row push costs a handful of round
 * trips rather than 500. Three properties are load-bearing:
 *
 *  - The insert is `ON CONFLICT DO NOTHING` and the update is a separate
 *    statement, because Prisma's `createMany`/`upsert` cannot express a
 *    conditional `DO UPDATE WHERE`. Two round trips per chunk is the price of
 *    last-write-wins holding under concurrency.
 *  - `WHERE source."updatedAt" > target."updatedAt"` re-checks the compare inside
 *    the database. The engine already filtered the rows, but two devices can push
 *    the same item concurrently and this is what makes the loser a no-op instead
 *    of an overwrite.
 *  - `"deletedAt"` is recomputed from the surviving `updatedAt` rather than taken
 *    from the client, so the tombstone can never disagree with the timestamp that
 *    won.
 *
 * `values` is positional and must match `columns`: `[id, userId, itemId, …,
 * updatedAt, deletedAt]`, with `deletedAt` already resolved by the caller.
 *
 * `keyColumn` is the second half of the row's unique key — `"itemId"` for
 * bookmarks and reactions, `"targetId"` for follows.
 */
async function chunkedWrite<T>(
  tx: MobileSyncDb,
  table: string,
  keyColumn: string,
  columns: string[],
  valuesOf: (row: T) => unknown[],
  rows: T[]
): Promise<void> {
  if (rows.length === 0) return;
  const allowed = SYNC_TABLES[table];
  if (
    !allowed ||
    allowed.keyColumn !== keyColumn ||
    allowed.columns.join(",") !== columns.join(",")
  ) {
    // Tables and columns are interpolated as SQL identifiers (Prisma.raw).
    // Keep that safe by making the only accepted values module constants.
    throw new Error(`Refusing unknown sync table shape: ${table}`);
  }

  const columnList = columns.map((column) => `"${column}"`).join(", ");
  // `excluded` exists only inside `ON CONFLICT DO UPDATE`; here the incoming row
  // is the `source` alias of the VALUES list.
  const itemAssignments = columns
    .filter((column) => column !== "id")
    .map((column) => `"${column}" = source."${column}"`)
    .join(", ");

  for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
    const chunk = rows.slice(start, start + CHUNK_SIZE);
    const lists: Prisma.Sql[] = chunk.map((row) => {
      const tuple = valuesOf(row).map(
        (value, index) =>
          Prisma.sql`${toSqlValue(value)}${castFor(columns[index] ?? "")}`
      );
      return Prisma.sql`(${Prisma.join(tuple)})`;
    });

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO ${Prisma.raw(`"${table}"`)} (${Prisma.raw(columnList)})
      SELECT * FROM (VALUES ${Prisma.join(lists)}) AS source(${Prisma.raw(columnList)})
      ON CONFLICT DO NOTHING
    `);

    await tx.$executeRaw(Prisma.sql`
      UPDATE ${Prisma.raw(`"${table}"`)} AS target
      SET
        ${Prisma.raw(itemAssignments)}
      FROM (VALUES ${Prisma.join(lists)}) AS source(${Prisma.raw(columnList)})
      WHERE target."userId" = source."userId"
        AND target.${Prisma.raw(`"${keyColumn}"`)} = source.${Prisma.raw(`"${keyColumn}"`)}
        AND source."updatedAt" > target."updatedAt"
    `);
  }
}

/**
 * `undefined` would make Prisma throw on an untyped parameter; a caller that
 * hand-built a row meant SQL NULL.
 */
function toSqlValue(
  value: unknown
): string | number | bigint | Date | boolean | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean" ||
    value instanceof Date
  ) {
    return value;
  }
  return String(value);
}

// --- pull -------------------------------------------------------------------

export function toBookmarkDTO(row: BookmarkDbRow): BookmarkDTO {
  return {
    itemId: row.itemId,
    title: row.title,
    sourceUrl: row.sourceUrl,
    imageUrl: row.imageUrl,
    publisher: row.publisher,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    savedAt: row.savedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deleted: row.deletedAt !== null,
  };
}

export function toReactionDTO(row: ReactionDbRow): ReactionDTO {
  return {
    itemId: row.itemId,
    kind: row.kind,
    updatedAt: row.updatedAt.toISOString(),
    deleted: row.deletedAt !== null,
  };
}

export function toFollowDTO(row: FollowDbRow): FollowDTO {
  return {
    targetId: row.targetId,
    kind: row.kind,
    label: row.label,
    updatedAt: row.updatedAt.toISOString(),
    deleted: row.deletedAt !== null,
  };
}

/**
 * Delta pull. `since` is exclusive (`updatedAt > since`); tombstones are part of
 * the stream because a deletion on one device has to reach the others. The limit
 * applies per collection, and `hasMore` is set when any collection was truncated
 * — re-issue with `since` = the largest `updatedAt` received.
 *
 * `take: limit + 1` is what makes `hasMore` exact without a second count query.
 */
export async function pullChanges(
  db: MobileSyncDb,
  userId: string,
  { since, limit }: { since: Date | null; limit: number }
): Promise<SyncPullResult> {
  const where = since ? { userId, updatedAt: { gt: since } } : { userId };
  const orderBy = [{ updatedAt: "asc" as const }];

  const [bookmarks, reactions, follows] = await Promise.all([
    db.mobileBookmark.findMany({ where, orderBy, take: limit + 1 }),
    db.mobileReaction.findMany({ where, orderBy, take: limit + 1 }),
    db.mobileFollow.findMany({ where, orderBy, take: limit + 1 }),
  ]);

  return {
    bookmarks: bookmarks.slice(0, limit).map(toBookmarkDTO),
    reactions: reactions.slice(0, limit).map(toReactionDTO),
    follows: follows.slice(0, limit).map(toFollowDTO),
    hasMore:
      bookmarks.length > limit ||
      reactions.length > limit ||
      follows.length > limit,
  };
}

// --- push -------------------------------------------------------------------

/** `updatedAt` wins the compare; a deletion is `deletedAt = updatedAt`. */
function deletedAtFor(row: { updatedAt: Date; deleted: boolean }): Date | null {
  return row.deleted ? row.updatedAt : null;
}

/**
 * `@default(cuid())` is applied by Prisma Client, not by the database, and these
 * rows are written with raw SQL — so the id has to be generated here. A UUID is
 * the same shape of opaque, collision-free key and needs no extra dependency.
 */
function newId(): string {
  return randomUUID();
}

export function bookmarkValues(
  row: BookmarkSnapshot,
  userId: string
): unknown[] {
  return [
    newId(),
    userId,
    row.itemId,
    row.title,
    row.sourceUrl ?? null,
    row.imageUrl ?? null,
    row.publisher ?? null,
    row.publishedAt ?? null,
    row.savedAt,
    row.updatedAt,
    deletedAtFor(row),
  ];
}

export function reactionValues(
  row: ReactionSnapshot,
  userId: string
): unknown[] {
  return [
    newId(),
    userId,
    row.itemId,
    row.kind,
    row.updatedAt,
    deletedAtFor(row),
  ];
}

export function followValues(row: FollowSnapshot, userId: string): unknown[] {
  return [
    newId(),
    userId,
    row.targetId,
    row.kind,
    row.label ?? null,
    row.updatedAt,
    deletedAtFor(row),
  ];
}

/**
 * Column order of the `VALUES` lists above. `id` is supplied by `newId()`;
 * `createdAt` is left to its database default.
 */
const BOOKMARK_COLUMNS = [
  "id",
  "userId",
  "itemId",
  "title",
  "sourceUrl",
  "imageUrl",
  "publisher",
  "publishedAt",
  "savedAt",
  "updatedAt",
  "deletedAt",
];

const REACTION_COLUMNS = [
  "id",
  "userId",
  "itemId",
  "kind",
  "updatedAt",
  "deletedAt",
];

const FOLLOW_COLUMNS = [
  "id",
  "userId",
  "targetId",
  "kind",
  "label",
  "updatedAt",
  "deletedAt",
];

/** The only table/column shapes chunkedWrite may interpolate into raw SQL. */
const SYNC_TABLES: Record<
  string,
  { keyColumn: string; columns: readonly string[] }
> = {
  MobileBookmark: { keyColumn: "itemId", columns: BOOKMARK_COLUMNS },
  MobileReaction: { keyColumn: "itemId", columns: REACTION_COLUMNS },
  MobileFollow: { keyColumn: "targetId", columns: FOLLOW_COLUMNS },
};

function toStateBookmark(row: BookmarkSnapshot): BookmarkDbRow {
  return { ...row, deletedAt: deletedAtFor(row) };
}

function toStateReaction(row: ReactionSnapshot): ReactionDbRow {
  return { ...row, deletedAt: deletedAtFor(row) };
}

function toStateFollow(row: FollowSnapshot): FollowDbRow {
  return { ...row, deletedAt: deletedAtFor(row) };
}

/**
 * Applies a validated batch and returns what the client needs to converge.
 *
 * The whole batch runs in one transaction: a push either lands or it does not,
 * so a mid-batch failure cannot leave the client's `state` half-true.
 */
export async function applySync(
  db: MobileSyncDb,
  userId: string,
  payload: SyncPushPayload
): Promise<SyncPushResult> {
  const reactionItemIds = [
    ...new Set(payload.reactions.map((row) => row.itemId)),
  ];
  const changeCount =
    payload.bookmarks.length +
    payload.reactions.length +
    payload.follows.length;

  return db.$transaction(
    async (tx) => {
      const [storedBookmarks, storedReactions, storedFollows] =
        await Promise.all([
          payload.bookmarks.length > 0
            ? tx.mobileBookmark.findMany({
                where: {
                  userId,
                  itemId: { in: payload.bookmarks.map((row) => row.itemId) },
                },
              })
            : Promise.resolve([] as BookmarkDbRow[]),
          reactionItemIds.length > 0
            ? tx.mobileReaction.findMany({
                where: { userId, itemId: { in: reactionItemIds } },
              })
            : Promise.resolve([] as ReactionDbRow[]),
          payload.follows.length > 0
            ? tx.mobileFollow.findMany({
                where: {
                  userId,
                  targetId: { in: payload.follows.map((row) => row.targetId) },
                },
              })
            : Promise.resolve([] as FollowDbRow[]),
        ]);

      // `kind` is the third part of the reaction key, but v1 has exactly one kind,
      // so a row is uniquely identified by its item id here.
      const bookmarkMerge = mergeRows<BookmarkSnapshot>(
        payload.bookmarks,
        new Map(
          storedBookmarks.map((row) => [
            row.itemId,
            {
              itemId: row.itemId,
              title: row.title,
              sourceUrl: row.sourceUrl,
              imageUrl: row.imageUrl,
              publisher: row.publisher,
              publishedAt: row.publishedAt,
              savedAt: row.savedAt,
              updatedAt: row.updatedAt,
              deleted: row.deletedAt !== null,
            },
          ])
        ),
        (row) => row.itemId,
        "bookmarks"
      );

      const reactionMerge = mergeRows<ReactionSnapshot>(
        payload.reactions,
        new Map(
          storedReactions.map((row) => [
            row.itemId,
            {
              itemId: row.itemId,
              kind: row.kind,
              updatedAt: row.updatedAt,
              deleted: row.deletedAt !== null,
            },
          ])
        ),
        (row) => row.itemId,
        "reactions"
      );

      const followMerge = mergeRows<FollowSnapshot>(
        payload.follows,
        new Map(
          storedFollows.map((row) => [
            row.targetId,
            {
              targetId: row.targetId,
              kind: row.kind,
              label: row.label,
              updatedAt: row.updatedAt,
              deleted: row.deletedAt !== null,
            },
          ])
        ),
        (row) => row.targetId,
        "follows"
      );

      await chunkedWrite(
        tx,
        "MobileBookmark",
        "itemId",
        BOOKMARK_COLUMNS,
        (row: BookmarkSnapshot) => bookmarkValues(row, userId),
        bookmarkMerge.changed
      );
      await chunkedWrite(
        tx,
        "MobileReaction",
        "itemId",
        REACTION_COLUMNS,
        (row: ReactionSnapshot) => reactionValues(row, userId),
        reactionMerge.changed
      );
      await chunkedWrite(
        tx,
        "MobileFollow",
        "targetId",
        FOLLOW_COLUMNS,
        (row: FollowSnapshot) => followValues(row, userId),
        followMerge.changed
      );

      const state: SyncState = {
        bookmarks: [...bookmarkMerge.state.values()].map((row) =>
          toBookmarkDTO(toStateBookmark(row))
        ),
        reactions: [...reactionMerge.state.values()].map((row) =>
          toReactionDTO(toStateReaction(row))
        ),
        follows: [...followMerge.state.values()].map((row) =>
          toFollowDTO(toStateFollow(row))
        ),
      };

      return {
        applied: {
          bookmarks: bookmarkMerge.changed.length,
          reactions: reactionMerge.changed.length,
          follows: followMerge.changed.length,
        },
        rejected: [
          ...bookmarkMerge.rejected,
          ...reactionMerge.rejected,
          ...followMerge.rejected,
        ],
        state,
      } satisfies SyncPushResult;
    },
    {
      timeout: BASE_TX_TIMEOUT_MS + changeCount * PER_ROW_TX_BUDGET_MS,
      maxWait: 5_000,
    }
  );
}
