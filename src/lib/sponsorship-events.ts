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
