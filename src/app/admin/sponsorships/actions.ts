"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdUploadError, uploadCreative } from "@/lib/admin/ad-upload";
import { recordSponsorshipAudit } from "@/lib/admin/sponsorship-audit";
import {
  ADMIN_COOKIE,
  expectedToken,
  isAdminConfigured,
  isAdminRequest,
  keyMatches,
} from "@/lib/admin/sponsorship-auth";
import { parseCampaignForm } from "@/lib/admin/sponsorship-form";
import { db } from "@/lib/db";
import { sendNativePush } from "@/lib/push/fcm";
import { checkDbRateLimit } from "@/lib/rate-limiter";
import { revalidateSponsorships } from "@/lib/sponsorship-cache";
import { asDatabasePlacement } from "@/lib/sponsorship-validation";

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

async function resolveCreative(
  formData: FormData,
  fallback?: string
): Promise<string | undefined> {
  const upload = formData.get("imageFile");
  const hasUpload = upload instanceof File && upload.size > 0;
  if (!hasUpload) return fallback;
  // A selected file wins over the optional URL, so a stale/invalid URL in the
  // field must not block a file-only campaign.
  formData.set("imageUrl", "");
  try {
    return await uploadCreative(upload);
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

export async function createCampaign(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = parseCampaignForm(formData);
  if (!parsed.ok) {
    redirect(
      `/admin/sponsorships/new?error=${encodeURIComponent(parsed.errors.join(" "))}`
    );
  }
  const imageUrl = await resolveCreative(formData, parsed.value.imageUrl);
  const altText = parsed.value.altText ?? (imageUrl ? parsed.value.advertiser : undefined);
  const created = await db.sponsorship.create({
    data: {
      ...parsed.value,
      placement: asDatabasePlacement(parsed.value.placement),
      imageUrl,
      altText,
      disclosure:
        parsed.value.disclosure ?? `Sponsored by ${parsed.value.advertiser}`,
    },
  });
  await recordSponsorshipAudit({
    action: "create",
    targetId: created.id,
    detail: `${parsed.value.advertiser}: ${parsed.value.headline}`,
  });
  revalidateSponsorships();
  redirect("/admin/sponsorships?created=1");
}

export async function updateCampaign(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) redirect("/admin/sponsorships?updateFailed=1");
  const parsed = parseCampaignForm(formData);
  if (!parsed.ok) {
    redirect(
      `/admin/sponsorships/${encodeURIComponent(id)}/edit?error=${encodeURIComponent(
        parsed.errors.join(" ")
      )}`
    );
  }
  const existing = await db.sponsorship.findUnique({ where: { id } });
  if (!existing) redirect("/admin/sponsorships?updateFailed=1");
  const imageUrl = await resolveCreative(formData, parsed.value.imageUrl);
  const altText = parsed.value.altText ?? (imageUrl ? parsed.value.advertiser : undefined);
  await db.sponsorship.update({
    where: { id },
    data: {
      ...parsed.value,
      placement: asDatabasePlacement(parsed.value.placement),
      imageUrl,
      altText,
      disclosure:
        parsed.value.disclosure ?? `Sponsored by ${parsed.value.advertiser}`,
    },
  });
  await recordSponsorshipAudit({
    action: "update",
    targetId: id,
    detail: `${parsed.value.advertiser}: ${parsed.value.headline}`,
  });
  revalidateSponsorships();
  redirect("/admin/sponsorships?updated=1");
}

export async function duplicateCampaign(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  const source = id
    ? await db.sponsorship.findUnique({ where: { id } })
    : null;
  if (!source) redirect("/admin/sponsorships?duplicateFailed=1");
  const now = new Date();
  const copy = await db.sponsorship.create({
    data: {
      placement: source.placement,
      advertiser: source.advertiser,
      headline: source.headline,
      body: source.body,
      ctaLabel: source.ctaLabel,
      ctaUrl: source.ctaUrl,
      brandHex: source.brandHex,
      brandAccentHex: source.brandAccentHex,
      assetLabel: source.assetLabel,
      disclosure: source.disclosure,
      imageUrl: source.imageUrl,
      altText: source.altText,
      startsAt: now,
      endsAt: new Date(now.getTime() + 7 * 86_400_000),
      active: false,
      priority: source.priority,
      weight: source.weight,
      maxImpressions: source.maxImpressions,
      dailyImpressionCap: source.dailyImpressionCap,
    },
  });
  await recordSponsorshipAudit({
    action: "duplicate",
    targetId: copy.id,
    detail: `from ${id}`,
  });
  revalidateSponsorships();
  redirect("/admin/sponsorships?duplicated=1");
}

export async function stopCampaign(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (id) {
    await db.sponsorship.update({
      where: { id },
      data: { active: false },
    });
    await recordSponsorshipAudit({ action: "stop", targetId: id });
    revalidateSponsorships();
  }
  redirect("/admin/sponsorships?stopped=1");
}

export async function archiveCampaign(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (id) {
    await db.sponsorship.update({
      where: { id },
      data: { active: false, archivedAt: new Date() },
    });
    await recordSponsorshipAudit({ action: "archive", targetId: id });
    revalidateSponsorships();
  }
  redirect("/admin/sponsorships?archived=1");
}

export async function extendCampaign(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  const days = Number(formData.get("days") ?? 7);
  if (!Number.isFinite(days) || days <= 0 || days > 90) {
    redirect("/admin/sponsorships?extendBlocked=1");
  }
  if (id) {
    const campaign = await db.sponsorship.findUnique({ where: { id } });
    const now = new Date();
    // Extending is not a revival: only an active, unexpired campaign can move
    // its end date. Stopped/expired campaigns use the explicit reactivate path.
    if (
      !campaign ||
      campaign.archivedAt !== null ||
      !campaign.active ||
      (campaign.endsAt !== null && campaign.endsAt <= now)
    ) {
      redirect("/admin/sponsorships?extendBlocked=1");
    }
    const base =
      campaign.endsAt !== null && campaign.endsAt !== undefined
        ? campaign.endsAt
        : now;
    await db.sponsorship.update({
      where: { id },
      data: { endsAt: new Date(base.getTime() + days * 86_400_000) },
    });
    await recordSponsorshipAudit({
      action: "extend",
      targetId: id,
      detail: `+${days}d`,
    });
    revalidateSponsorships();
  }
  redirect("/admin/sponsorships?extended=1");
}

/** Explicitly brings a stopped/expired campaign back for a fresh 7-day window. */
export async function reactivateCampaign(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (id) {
    const campaign = await db.sponsorship.findUnique({ where: { id } });
    const now = new Date();
    if (!campaign || campaign.archivedAt !== null) {
      redirect("/admin/sponsorships?reactivateFailed=1");
    }
    const keepEnd =
      campaign.endsAt !== null && campaign.endsAt > now
        ? campaign.endsAt
        : new Date(now.getTime() + 7 * 86_400_000);
    await db.sponsorship.update({
      where: { id },
      data: { active: true, endsAt: keepEnd },
    });
    await recordSponsorshipAudit({ action: "reactivate", targetId: id });
    revalidateSponsorships();
  }
  redirect("/admin/sponsorships?reactivated=1");
}

/** Inserts a browser-safe demo campaign so the whole loop can be tried without PowerShell. */
export async function seedDemoCampaign(): Promise<void> {
  await requireAdmin();
  const created = await db.sponsorship.create({
    data: {
      placement: asDatabasePlacement("feed"),
      advertiser: "SLNews Demo",
      headline: "DEMO CAMPAIGN",
      body: "Inserted from the admin console",
      ctaLabel: "View more",
      ctaUrl: "https://slnews.sl",
      brandHex: "#0B6FD1",
      brandAccentHex: "#2E9BF5",
      disclosure: "Demo campaign — not billable",
      endsAt: new Date(Date.now() + 2 * 3_600_000),
    },
  });
  await recordSponsorshipAudit({ action: "seed-demo", targetId: created.id });
  revalidateSponsorships();
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
  await recordSponsorshipAudit({
    action: "test-push",
    detail: `sent=${result.sent} failed=${result.failed}`,
  });
  redirect(
    `/admin/sponsorships?pushSent=${result.sent}&pushFailed=${result.failed}`
  );
}
