"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  ADMIN_COOKIE,
  expectedToken,
  isAdminConfigured,
  isAdminRequest,
  keyMatches,
} from "@/lib/admin/sponsorship-auth";
import { parseCampaignForm } from "@/lib/admin/sponsorship-form";
import { sendNativePush } from "@/lib/push/fcm";
import { db } from "@/lib/db";
import { checkDbRateLimit } from "@/lib/rate-limiter";
import { AdUploadError, uploadCreative } from "@/lib/admin/ad-upload";

export async function login(formData: FormData): Promise<void> {
  // Slow down key guessing: ten attempts per IP per ten minutes.
  const headerBag = await headers();
  const ip =
    headerBag.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerBag.get("x-real-ip") ??
    "unknown";
  const limit = await checkDbRateLimit(`admin-login:${ip}`, {
    maxRequests: 10,
    windowMs: 10 * 60_000,
  });
  if (!limit.allowed) redirect("/admin/sponsorships/login?error=rate");

  const submitted = String(formData.get("key") ?? "");
  if (!isAdminConfigured() || !keyMatches(submitted)) {
    redirect("/admin/sponsorships/login?error=1");
  }
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, expectedToken(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 60 * 60 * 8,
  });
  redirect("/admin/sponsorships");
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE);
  redirect("/admin/sponsorships/login");
}

async function requireAdmin(): Promise<void> {
  if (!(await isAdminRequest())) redirect("/admin/sponsorships/login");
}

export async function createCampaign(formData: FormData): Promise<void> {
  await requireAdmin();
  const upload = formData.get("imageFile");
  const hasUpload = upload instanceof File && upload.size > 0;
  // A selected file wins over the optional URL, so a stale/invalid URL in the
  // field must not block a file-only campaign.
  if (hasUpload) formData.set("imageUrl", "");
  const parsed = parseCampaignForm(formData);
  if (!parsed.ok) {
    redirect(
      `/admin/sponsorships/new?error=${encodeURIComponent(parsed.errors.join(" "))}`
    );
  }
  let imageUrl = parsed.value.imageUrl;
  if (hasUpload) {
    try {
      imageUrl = await uploadCreative(upload);
    } catch (error) {
      console.error("Creative upload failed", {
        name: (error as Error)?.name,
        message: (error as Error)?.message,
        fileName: upload.name,
        fileSize: upload.size,
        fileType: upload.type,
        blobConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
        storeId: process.env.BLOB_STORE_ID ? "set" : "unset",
      });
      const message =
        error instanceof AdUploadError
          ? error.message
          : `Creative upload failed: ${
              error instanceof Error ? error.message : "unknown Blob error"
            }`;
      redirect(`/admin/sponsorships/new?error=${encodeURIComponent(message)}`);
    }
  }

  await db.sponsorship.create({
    data: {
      ...parsed.value,
      imageUrl,
      assetLabel: parsed.value.assetLabel ?? null,
      disclosure: parsed.value.disclosure ?? null,
    },
  });
  redirect("/admin/sponsorships?created=1");
}

export async function stopCampaign(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (id)
    await db.sponsorship.update({ where: { id }, data: { active: false } });
  redirect("/admin/sponsorships?stopped=1");
}

export async function extendCampaign(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const days = Number(formData.get("days") ?? 7);
  if (id) {
    await db.sponsorship.update({
      where: { id },
      data: { active: true, endsAt: new Date(Date.now() + days * 86_400_000) },
    });
  }
  redirect("/admin/sponsorships?extended=1");
}

/** Inserts a browser-safe demo campaign so the whole loop can be tried without PowerShell. */
export async function seedDemoCampaign(): Promise<void> {
  await requireAdmin();
  await db.sponsorship.create({
    data: {
      placement: "feed",
      advertiser: "SLNews Demo",
      headline: "DEMO CAMPAIGN",
      body: "Inserted from the admin console",
      ctaLabel: "View more",
      ctaUrl: "https://slnews.sl",
      brandHex: "#0B6FD1",
      brandAccentHex: "#2E9BF5",
      endsAt: new Date(Date.now() + 2 * 3_600_000),
    },
  });
  redirect("/admin/sponsorships?created=1");
}

/** Sends a test notification through the production FCM path. */
export async function sendTestPush(): Promise<void> {
  await requireAdmin();
  let result = { sent: 0, failed: 0 };
  try {
    result = await sendNativePush({
      title: "SLNews test notification",
      body: "If you can read this, push notifications are working.",
      url: "/",
      category: "test",
    });
  } catch {
    // Report zeroes rather than leaking internals to the console URL.
  }
  redirect(
    `/admin/sponsorships?pushSent=${result.sent}&pushFailed=${result.failed}`
  );
}
