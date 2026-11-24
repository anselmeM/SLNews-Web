import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived signed token attached to a served sponsorship.
 *
 * The event endpoint rejects events without a token that matches the campaign
 * and has not expired. This does not replace device attestation, but it stops
 * blind counter inflation by campaign id and makes the event contract explicit.
 */
export type EventTokenPayload = {
  id: string;
  exp: number;
};

const TOKEN_TTL_MS = 60 * 60_000;
const TOKEN_VERSION = 1;

function secret(): string | null {
  const value =
    process.env.SPONSORSHIP_EVENT_SECRET?.trim() ||
    process.env.SPONSORSHIP_ADMIN_KEY?.trim();
  return value || null;
}

function sign(encoded: string, key: string): string {
  return createHmac("sha256", key).update(encoded).digest("base64url");
}

export function createEventToken(
  sponsorshipId: string,
  now = Date.now()
): string | null {
  const key = secret();
  if (!key) return null;
  const payload: EventTokenPayload & { v: number } = {
    id: sponsorshipId,
    exp: now + TOKEN_TTL_MS,
    v: TOKEN_VERSION,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded, key)}`;
}

export function verifyEventToken(
  token: unknown,
  sponsorshipId: string,
  now = Date.now()
): boolean {
  const key = secret();
  if (!key || typeof token !== "string") return false;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra !== undefined) return false;

  const expected = sign(encoded, key);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return false;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    ) as Partial<EventTokenPayload & { v: number }>;
    return (
      payload.v === TOKEN_VERSION &&
      payload.id === sponsorshipId &&
      typeof payload.exp === "number" &&
      payload.exp > now
    );
  } catch {
    return false;
  }
}

export function eventTokenTtlMs(): number {
  return TOKEN_TTL_MS;
}

/**
 * The app's anonymous install id.
 *
 * The contract intends 32 lowercase hex characters, but the value is opaque to
 * the server: any URL-safe token between 16 and 128 characters is accepted so a
 * future app build can change the format without a backend release. The raw id
 * must never be stored — `hashInstallId` turns it into an HMAC before the event
 * row is written.
 */
const INSTALL_ID = /^[A-Za-z0-9_-]{16,128}$/;

export function isInstallId(value: unknown): value is string {
  return typeof value === "string" && INSTALL_ID.test(value);
}

/**
 * Hashes an install id for reach reporting.
 *
 * Uses the same secret as the event token (dedicated secret first, admin key as
 * fallback) with a prefix so the value cannot collide with a signed token. The
 * digest is stable for as long as the secret is, which is what makes distinct
 * installs countable per campaign; rotating the secret starts a new reach
 * population (documented in docs/SPONSORSHIP-OPERATIONS.md). Returns null when
 * no secret is configured: the event still counts, but its reach is unknown.
 */
export function hashInstallId(installId: string): string | null {
  const key = secret();
  if (!key) return null;
  return createHmac("sha256", key)
    .update(`install:${installId}`)
    .digest("hex");
}
