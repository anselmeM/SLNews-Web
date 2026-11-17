"use server";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import webpush from "web-push";
import { db } from "@/lib/db";
import {
  isFcmConfigured,
  sendNativePush,
  sendTopicPush,
  type NativeSendResult,
} from "@/lib/push/fcm";
import { topicForTarget } from "@/lib/push/topics";

export interface PushNotificationOptions {
  userId?: string;
  userIds?: string[];
  /**
   * Follow ids this alert is about (`topic:politics`, `publisher:awoko`,
   * `team:lal`). When set, delivery goes to those FCM topics and the device
   * fan-out is skipped — the app has already subscribed the right devices.
   * Leave unset for account-scoped alerts.
   */
  targets?: string[];
  /**
   * Skips the browser (VAPID) channel. Set it for subject-targeted alerts:
   * browser subscriptions are per device and carry no follows, so fanning a
   * targeted alert out to them would reach every reader, not the followers.
   */
  skipWebPush?: boolean;
  tag?: string;
  icon?: string;
  badge?: string;
  actions?: Array<{ action: string; title: string }>;
  data?: Record<string, unknown>;
  /** In-app inbox badge: "breaking" | "market" | "briefing" | "announcement". */
  category?: string;
  /** Overrides the generated id. Only needed for re-sending a known alert. */
  id?: string;
}

export interface PushResult {
  /** Browser pushes delivered. */
  sent: number;
  /** Native deliveries, present only when Firebase is configured. */
  native?: NativeSendResult;
  /** Per-topic native deliveries, present for targeted alerts. */
  nativeTopics?: Array<{ topic: string; ok: boolean }>;
  error?: string;
}

/**
 * Sends one alert to every channel that can receive it.
 *
 * Two delivery channels exist because two kinds of client do: browsers register a
 * VAPID endpoint (`PushSubscription`) and phones register an FCM token
 * (`MobileDevice`). Both are attempted from this one function so the services
 * that raise alerts — breaking news, briefing, price alerts — stay unaware of
 * which devices exist.
 *
 * A missing credential for one channel disables that channel only: an operator who
 * has configured Firebase but not VAPID (or vice versa) still reaches the devices
 * they can, and is told which channel was skipped.
 */
export async function sendPushNotifications(
  title: string,
  body: string,
  url: string,
  opts: PushNotificationOptions = {}
): Promise<PushResult> {
  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const contactEmail =
    process.env.VAPID_CONTACT_EMAIL || "admin@slnews.vercel.app";

  const payload = JSON.stringify({
    title,
    body,
    url,
    icon: opts.icon || "/icon-192x192.png",
    badge: opts.badge || "/icon-192x192.png",
    tag: opts.tag || "slnews-general",
    actions: opts.actions || [{ action: "open", title: "Open" }],
    data: {
      // A stable per-send id, so the device-side inbox can dedupe a redelivered
      // push exactly instead of relying on the tag (which repeats by design).
      id: opts.id || randomUUID(),
      category: opts.category || "breaking",
      url,
      ...opts.data,
    },
  });

  let sent = 0;
  let error: string | undefined;

  // Browser subscriptions carry no follow information, so a subject-targeted
  // alert can only be filtered on phones. Skipping web push there is the
  // difference between "the readers who follow Awoko" and "every reader who
  // ever enabled browser notifications", six times a day.
  if (vapidPublic && vapidPrivate && !opts.skipWebPush) {
    webpush.setVapidDetails(
      `mailto:${contactEmail}`,
      vapidPublic,
      vapidPrivate
    );

    let where: Prisma.PushSubscriptionWhereInput | undefined;
    if (opts.userIds && opts.userIds.length > 0) {
      where = { userId: { in: opts.userIds } };
    } else if (opts.userId) {
      where = { userId: opts.userId };
    }

    const subscriptions = await db.pushSubscription.findMany({
      take: 1000,
      where,
    });

    const expiredEndpoints: string[] = [];

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: sub.keys as { p256dh: string; auth: string },
            },
            payload
          );
          sent++;
        } catch (err: unknown) {
          const errBody = (err as { statusCode?: number; body?: string }) ?? {};
          if (errBody.statusCode === 410 || errBody.statusCode === 404) {
            expiredEndpoints.push(sub.endpoint);
          }
        }
      })
    );

    if (expiredEndpoints.length > 0) {
      await db.pushSubscription.deleteMany({
        where: { endpoint: { in: expiredEndpoints } },
      });
    }
  } else {
    error = "VAPID keys not configured";
  }

  // Phones: the same alert, through Firebase. Inert without a service account.
  //
  // A targeted alert goes out on FCM **topics** rather than the device fan-out:
  // the app subscribes `slnews_<follow id>` per follow, so one send reaches
  // exactly the readers who follow that subject, without the server having to
  // know who they are. Account-scoped alerts (price alerts, briefing) still fan
  // out to the user's devices because they are not subject-based.
  let native: NativeSendResult | undefined;
  let nativeTopics: Array<{ topic: string; ok: boolean }> | undefined;
  if (isFcmConfigured()) {
    const message = {
      title,
      body,
      url,
      category: opts.category,
      data: { id: opts.id || randomUUID(), ...opts.data },
    };
    const targets = Array.from(
      new Set((opts.targets ?? []).map((target) => target.trim()).filter(Boolean))
    );
    if (targets.length > 0) {
      nativeTopics = [];
      for (const target of targets) {
        const topic = topicForTarget(target);
        const result = await sendTopicPush(topic, message);
        nativeTopics.push({ topic: result.topic, ok: result.ok });
      }
    } else {
      native = await sendNativePush(message, {
        userId: opts.userId,
        userIds: opts.userIds,
      });
    }
  }

  return { sent, native, nativeTopics, ...(error ? { error } : {}) };
}
