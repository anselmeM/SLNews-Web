/**
 * Native push via Firebase Cloud Messaging (HTTP v1).
 *
 * The web app already sends browser pushes (`web-push` + VAPID) from
 * `src/app/actions/push-actions.ts`. A phone cannot receive those: it needs an
 * FCM token, which the Flutter app registers in `MobileDevice`
 * (`/api/mobile/v1/devices`). This module is that second delivery channel, and it
 * hangs off the same call site so every existing alert (breaking news, briefing,
 * price alerts) reaches phones without touching the services that raise them.
 *
 * Credentials are a Firebase service account, supplied as JSON in
 * `FIREBASE_SERVICE_ACCOUNT`. Without it this module is inert — the callers keep
 * working for the web and the return value says why nothing was sent, rather than
 * throwing during a cron job.
 */
import { createSign } from "node:crypto";

/** Where Google's OAuth token endpoint and FCM live. */
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
/** Cold-starting free tiers and 200k-token fan-outs both deserve headroom. */
const SEND_TIMEOUT_MS = 10_000;
/** Concurrent sends per batch; FCM allows far more, but this keeps logs sane. */
const SEND_CONCURRENCY = 20;
/** Refresh the access token a minute before Google expires it. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

export interface FcmConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export interface NativeMessage {
  title: string;
  body: string;
  /** App route to open on tap, e.g. `/article/abc`. */
  url: string;
  /** Extra data for the device-side inbox; values are stringified by FCM. */
  data?: Record<string, unknown>;
  /** Category used by the in-app inbox ("breaking" | "briefing" | "market"). */
  category?: string;
}

export interface NativeSendResult {
  sent: number;
  failed: number;
  /** Tokens FCM reported as unregistered; they are deleted from the registry. */
  invalid: number;
  /** Set when nothing was attempted, e.g. credentials missing. */
  skipped?: "not-configured";
}

interface AccessToken {
  value: string;
  expiresAt: number;
}

let cachedToken: AccessToken | null = null;

/** True when a service account is configured; callers use it to stay inert. */
export function isFcmConfigured(): boolean {
  return parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT) !== null;
}

/**
 * Parses the service-account JSON. Supports the common deployment habit of
 * storing it base64-encoded as well as raw, because a raw JSON blob with newlines
 * in `private_key` is awkward in some dashboards.
 */
export function parseServiceAccount(raw: string | undefined): FcmConfig | null {
  if (!raw || raw.trim().length === 0) return null;

  const candidates = [raw];
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    if (decoded.trimStart().startsWith("{")) candidates.push(decoded);
  } catch {
    // Not base64; the raw attempt below is the only option.
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as {
        project_id?: unknown;
        client_email?: unknown;
        private_key?: unknown;
      };
      if (
        typeof parsed.project_id === "string" &&
        typeof parsed.client_email === "string" &&
        typeof parsed.private_key === "string" &&
        parsed.project_id.trim() &&
        parsed.client_email.includes("@") &&
        parsed.private_key.includes("BEGIN PRIVATE KEY")
      ) {
        return {
          projectId: parsed.project_id.trim(),
          clientEmail: parsed.client_email.trim(),
          privateKey: parsed.private_key,
        };
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Signed JWT for Google's OAuth2 service-account flow. */
export function buildAssertion(config: FcmConfig, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: config.clientEmail,
      scope: FCM_SCOPE,
      aud: OAUTH_TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(config.privateKey);
  return `${header}.${claims}.${base64url(signature)}`;
}

async function accessToken(config: FcmConfig): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + TOKEN_EXPIRY_MARGIN_MS) {
    return cachedToken.value;
  }

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: buildAssertion(config, Math.floor(now / 1000)),
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Firebase token exchange failed: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (
    typeof payload.access_token !== "string" ||
    payload.access_token.length === 0
  ) {
    throw new Error("Firebase token exchange returned no access_token");
  }
  const ttl =
    typeof payload.expires_in === "number"
      ? payload.expires_in * 1000
      : 3_600_000;
  cachedToken = { value: payload.access_token, expiresAt: now + ttl };
  return cachedToken.value;
}

/** Exposed for tests: forget the cached OAuth token. */
export function resetTokenCache(): void {
  cachedToken = null;
}

function messageBody(config: FcmConfig, token: string, message: NativeMessage) {
  const data: Record<string, string> = {
    url: message.url,
    category: message.category ?? "breaking",
  };
  for (const [key, value] of Object.entries(message.data ?? {})) {
    if (value !== undefined && value !== null) data[key] = String(value);
  }

  return {
    message: {
      token,
      notification: { title: message.title, body: message.body },
      data,
      android: {
        priority: "high",
        notification: { channel_id: "slnews_alerts", default_sound: true },
      },
      apns: {
        headers: { "apns-priority": "10" },
        payload: { aps: { sound: "default", "content-available": 1 } },
      },
    },
  };
}

/**
 * Sends one message to one token. Returns `"invalid"` for tokens FCM says are
 * gone (so the registry can be pruned), `"sent"` on success and `"failed"`
 * otherwise — a per-token failure must not abort the batch.
 */
export async function sendToToken(
  config: FcmConfig,
  accessTokenValue: string,
  token: string,
  message: NativeMessage
): Promise<"sent" | "invalid" | "failed"> {
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessTokenValue}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messageBody(config, token, message)),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    }
  );

  if (response.ok) return "sent";

  const text = await response.text().catch(() => "");
  const unregistered =
    response.status === 404 ||
    text.includes("UNREGISTERED") ||
    text.includes("NOT_FOUND") ||
    text.includes("registration-token-not-registered");
  return unregistered ? "invalid" : "failed";
}

/**
 * Fan-out to every token of the given users (or every registered device).
 *
 * Returns counts instead of throwing: push delivery is best-effort and must never
 * fail the alert that triggered it.
 */
export async function sendNativePush(
  message: NativeMessage,
  options: { userId?: string; userIds?: string[]; db?: NativePushDb } = {}
): Promise<NativeSendResult> {
  const config = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
  if (!config)
    return { sent: 0, failed: 0, invalid: 0, skipped: "not-configured" };
  // Narrowed copy: the closure below loses the guard's narrowing otherwise.
  const fcm: FcmConfig = config;

  const store =
    options.db ?? ((await import("@/lib/db")).db as unknown as NativePushDb);

  const where =
    options.userIds && options.userIds.length > 0
      ? { userId: { in: options.userIds } }
      : options.userId
        ? { userId: options.userId }
        : undefined;

  const devices = await store.mobileDevice.findMany({ where, take: 5_000 });
  if (devices.length === 0) return { sent: 0, failed: 0, invalid: 0 };

  let access: string;
  try {
    access = await accessToken(fcm);
  } catch (error) {
    console.warn(
      `push: ${error instanceof Error ? error.message : "token exchange failed"}`
    );
    return { sent: 0, failed: devices.length, invalid: 0 };
  }

  const invalidTokens: string[] = [];
  let sent = 0;
  let failed = 0;

  const queue = [...devices];
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const device = queue.shift();
      if (!device) return;
      try {
        const outcome = await sendToToken(fcm, access, device.token, message);
        if (outcome === "sent") sent++;
        else if (outcome === "invalid") {
          invalidTokens.push(device.token);
          failed++;
        } else failed++;
      } catch {
        failed++;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(SEND_CONCURRENCY, devices.length) }, () =>
      worker()
    )
  );

  if (invalidTokens.length > 0) {
    try {
      await store.mobileDevice.deleteMany({
        where: { token: { in: invalidTokens } },
      });
    } catch (error) {
      console.warn(
        `push: could not prune ${invalidTokens.length} unregistered token(s): ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
    }
  }

  return { sent, failed, invalid: invalidTokens.length };
}

/** The slice of Prisma this module needs; kept small so tests can stub it. */
export interface NativePushDb {
  mobileDevice: {
    findMany: (args?: unknown) => Promise<Array<{ token: string }>>;
    deleteMany: (args: unknown) => Promise<{ count: number }>;
  };
}

/**
 * Sends one notification to an FCM topic (client-subscribed segment).
 * Topic names are validated by the caller; delivery is best-effort.
 */
export async function sendTopicPush(
  topic: string,
  message: NativeMessage
): Promise<{ ok: boolean; topic: string; skipped?: string }> {
  const config = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
  if (!config) return { ok: false, topic, skipped: "not-configured" };
  if (!/^[A-Za-z0-9-_.~%]{1,200}$/.test(topic)) {
    return { ok: false, topic, skipped: "invalid-topic" };
  }
  let access: string;
  try {
    access = await accessToken(config);
  } catch {
    return { ok: false, topic, skipped: "token-exchange-failed" };
  }
  const body = messageBody(config, "", message) as {
    message: Record<string, unknown>;
  };
  delete body.message.token;
  body.message.topic = topic;
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    }
  );
  return { ok: response.ok, topic };
}
