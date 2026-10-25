import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CACHE_MS = 5 * 60_000;
const KEY = process.env.THESPORTSDB_KEY ?? "123";
const BASE =
  process.env.THESPORTSDB_BASE ?? "https://www.thesportsdb.com/api/v1/json";

const LEAGUES = [
  { id: "4387", label: "NBA", table: true, season: "2026-2027" },
  { id: "4328", label: "Premier League", table: true, season: "2026-2027" },
  { id: "4391", label: "NFL", table: false, season: "2026" },
  { id: "4380", label: "NHL", table: false, season: "2026-2027" },
  { id: "4424", label: "MLB", table: false, season: "2026" },
] as const;

type Cached = { at: number; payload: unknown };
let cache: Cached | null = null;

type DbEvent = {
  idEvent?: string;
  strHomeTeam?: string;
  strAwayTeam?: string;
  intHomeScore?: string;
  intAwayScore?: string;
  strStatus?: string;
  dateEvent?: string;
  strTime?: string;
  strVenue?: string;
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

function toGame(event: DbEvent, leagueLabel: string) {
  const finished = /ft|finished/i.test(event.strStatus ?? "");
  const home = event.strHomeTeam ?? "";
  const away = event.strAwayTeam ?? "";
  if (!event.idEvent || !home || !away) return null;
  return {
    id: `thesportsdb:${event.idEvent}`,
    leagueLabel,
    away: {
      id: `team:thesportsdb-${event.strAwayTeam}`,
      name: away,
      code: initials(away),
      logoUrl: null,
      colourHex: "#C8102E",
    },
    home: {
      id: `team:thesportsdb-${event.strHomeTeam}`,
      name: home,
      code: initials(home),
      logoUrl: null,
      colourHex: "#1E7A3C",
    },
    status: finished ? "final" : "scheduled",
    awayScore: event.intAwayScore
      ? Number.parseInt(event.intAwayScore, 10)
      : null,
    homeScore: event.intHomeScore
      ? Number.parseInt(event.intHomeScore, 10)
      : null,
    startsAt: event.dateEvent
      ? `${event.dateEvent}T${event.strTime ?? "00:00:00"}Z`
      : null,
    periodLabel: null,
    venue: event.strVenue ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchJson(path: string): Promise<any> {
  try {
    const res = await fetch(`${BASE}/${KEY}/${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function buildPayload() {
  const games: unknown[] = [];
  const standings: Record<string, unknown[]> = {};
  await Promise.all(
    LEAGUES.map(async (league) => {
      for (const path of [
        `eventspastleague.php?id=${league.id}`,
        `eventsnextleague.php?id=${league.id}`,
      ]) {
        const body = await fetchJson(path);
        for (const event of (body?.events ?? []) as DbEvent[]) {
          const game = toGame(event, league.label);
          if (game) games.push(game);
        }
      }
      if (league.table) {
        const body = await fetchJson(
          `lookuptable.php?l=${league.id}&s=${league.season}`
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = ((body?.table ?? []) as any[])
          .map((row) => ({
            team: {
              id: `team:thesportsdb-${row.idTeam}`,
              name: row.strTeam,
              code: initials(row.strTeam ?? ""),
              logoUrl: row.strTeamBadge ?? null,
              colourHex: "#387AFF",
            },
            leagueId: `league:${league.label === "NBA" ? "nba" : "epl"}`,
            leagueLabel: league.label,
            record:
              row.intLoss !== undefined && row.intWin !== undefined
                ? `${row.intWin}-${row.intLoss}`
                : `${row.intWin ?? 0}-${row.intDraw ?? 0}-${row.intLoss ?? 0}`,
            rank: Number.parseInt(row.intRank ?? "0", 10),
          }))
          .filter((row) => row.rank > 0)
          .sort((a, b) => a.rank - b.rank);
        if (rows.length >= 10) {
          standings[league.label === "NBA" ? "nba" : "epl"] = rows;
        }
      }
    })
  );
  return {
    providerLabel: "thesportsdb",
    updatedAt: new Date().toISOString(),
    games,
    standings,
  };
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) {
    return NextResponse.json(cache.payload, {
      headers: { "x-cache": "hit", "cache-control": "public, max-age=300" },
    });
  }
  const payload = await buildPayload();
  cache = { at: now, payload };
  return NextResponse.json(payload, {
    headers: { "x-cache": "miss", "cache-control": "public, max-age=300" },
  });
}
