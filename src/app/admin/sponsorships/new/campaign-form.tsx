"use client";

import { useMemo, useState } from "react";
import { createCampaign, updateCampaign } from "../actions";
import { parseCampaignForm } from "@/lib/admin/sponsorship-form";

type FormState = {
  placement: string;
  advertiser: string;
  headline: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  brandHex: string;
  brandAccentHex: string;
  assetLabel: string;
  disclosure: string;
  imageUrl: string;
  altText: string;
  priority: string;
  weight: string;
  maxImpressions: string;
  dailyImpressionCap: string;
  startsAt: string;
  endsAt: string;
};

const defaults: FormState = {
  placement: "feed",
  advertiser: "",
  headline: "",
  body: "",
  ctaLabel: "View more",
  ctaUrl: "",
  brandHex: "#0B6FD1",
  brandAccentHex: "#2E9BF5",
  assetLabel: "",
  disclosure: "",
  imageUrl: "",
  altText: "",
  priority: "0",
  weight: "1",
  maxImpressions: "",
  dailyImpressionCap: "",
  startsAt: "",
  endsAt: "",
};

const textFields = [
  ["advertiser", "Advertiser (max 80)", 80, true],
  ["headline", "Headline (max 40)", 40, true],
  ["body", "Body (max 80)", 80, true],
  ["ctaLabel", "CTA label (max 18)", 18, true],
  ["ctaUrl", "CTA URL (http/https, max 500)", 500, true],
  ["brandHex", "Brand colour (#RRGGBB)", 7, true],
  ["brandAccentHex", "Accent colour (#RRGGBB)", 7, true],
  ["assetLabel", "Offer label (optional, max 20)", 20, false],
  ["disclosure", "Disclosure (optional, max 120)", 120, false],
  ["altText", "Image alt text (optional, max 120)", 120, false],
] as const;

/** Create/edit form with a live preview of the native card the app renders. */
export function CampaignForm({
  mode = "create",
  campaignId,
  initial,
}: {
  mode?: "create" | "edit";
  campaignId?: string;
  initial?: Partial<FormState>;
}) {
  const starting = useMemo(() => ({ ...defaults, ...initial }), [initial]);
  const [form, setForm] = useState<FormState>(starting);
  const [filePreview, setFilePreview] = useState<string>("");
  const [errors, setErrors] = useState<string[]>([]);
  const set =
    (key: keyof FormState) => (event: { target: { value: string } }) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <form
        action={mode === "edit" ? updateCampaign : createCampaign}
        className="space-y-3 rounded-2xl border border-outline-variant/30 p-4"
        onSubmit={(event) => {
          const parsed = parseCampaignForm(new FormData(event.currentTarget));
          if (!parsed.ok) {
            event.preventDefault();
            setErrors(parsed.errors);
          } else {
            setErrors([]);
          }
        }}
      >
        {campaignId ? (
          <input type="hidden" name="id" value={campaignId} />
        ) : null}

        <label className="block text-xs font-semibold" htmlFor="placement">
          Placement
        </label>
        <select
          id="placement"
          name="placement"
          value={form.placement}
          onChange={set("placement")}
          className="w-full rounded-lg border px-3 py-2"
        >
          <option value="feed">feed</option>
          <option value="sports_stream">sports_stream</option>
          <option value="article_end">article_end</option>
        </select>

        {textFields.map(([key, label, max, required]) => (
          <div key={key}>
            <label className="block text-xs font-semibold" htmlFor={key}>
              {label}
            </label>
            <input
              id={key}
              name={key}
              value={form[key]}
              maxLength={max}
              onChange={set(key)}
              className="w-full rounded-lg border px-3 py-2"
              required={required}
            />
          </div>
        ))}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold" htmlFor="priority">
              Priority (0–1000)
            </label>
            <input
              id="priority"
              name="priority"
              type="number"
              min={0}
              max={1000}
              value={form.priority}
              onChange={set("priority")}
              className="w-full rounded-lg border px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold" htmlFor="weight">
              Weight (1–100)
            </label>
            <input
              id="weight"
              name="weight"
              type="number"
              min={1}
              max={100}
              value={form.weight}
              onChange={set("weight")}
              className="w-full rounded-lg border px-3 py-2"
            />
          </div>
          <div>
            <label
              className="block text-xs font-semibold"
              htmlFor="maxImpressions"
            >
              Total impression cap (optional)
            </label>
            <input
              id="maxImpressions"
              name="maxImpressions"
              type="number"
              min={0}
              value={form.maxImpressions}
              onChange={set("maxImpressions")}
              className="w-full rounded-lg border px-3 py-2"
            />
          </div>
          <div>
            <label
              className="block text-xs font-semibold"
              htmlFor="dailyImpressionCap"
            >
              Daily impression cap (optional)
            </label>
            <input
              id="dailyImpressionCap"
              name="dailyImpressionCap"
              type="number"
              min={0}
              value={form.dailyImpressionCap}
              onChange={set("dailyImpressionCap")}
              className="w-full rounded-lg border px-3 py-2"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold" htmlFor="imageFile">
            Creative upload (optional, max 4 MB)
          </label>
          <input
            id="imageFile"
            name="imageFile"
            type="file"
            onChange={(event) => {
              setFilePreview(
                event.target.files?.[0]
                  ? URL.createObjectURL(event.target.files[0])
                  : ""
              );
              setForm((current) => ({ ...current, imageUrl: "" }));
            }}
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="w-full rounded-lg border px-3 py-2 text-xs"
          />
          <p className="mt-1 text-[11px] text-gray-500">
            Needs a connected Vercel Blob store. Uploading wins over the image
            URL above.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold" htmlFor="startsAt">
              Starts
            </label>
            <input
              id="startsAt"
              name="startsAt"
              type="datetime-local"
              value={form.startsAt}
              onChange={set("startsAt")}
              className="w-full rounded-lg border px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold" htmlFor="endsAt">
              Ends
            </label>
            <input
              id="endsAt"
              name="endsAt"
              type="datetime-local"
              value={form.endsAt}
              onChange={set("endsAt")}
              className="w-full rounded-lg border px-3 py-2"
            />
          </div>
        </div>

        {errors.length > 0 ? (
          <ul className="space-y-1 rounded-lg bg-red-50 p-3 text-xs text-red-800">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}

        <button
          type="submit"
          className="rounded-lg bg-black px-4 py-2 text-white"
        >
          {mode === "edit" ? "Save changes" : "Save campaign"}
        </button>
      </form>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
          Preview
        </p>
        <div className="overflow-hidden rounded-2xl bg-white shadow">
          <div
            className="p-5 text-white"
            style={{
              background: `linear-gradient(135deg, ${form.brandAccentHex}, ${form.brandHex})`,
            }}
          >
            {filePreview || form.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={filePreview || form.imageUrl}
                alt={form.altText || ""}
                className="mb-3 h-24 w-full rounded-lg object-cover"
              />
            ) : null}
            <p className="text-2xl font-black">{form.headline || "Headline"}</p>
            {form.assetLabel ? (
              <div className="mt-3 inline-block rounded-lg bg-white px-3 py-2 text-xs font-bold text-black">
                {form.assetLabel}
              </div>
            ) : null}
            <div className="mt-4 flex items-center justify-between text-[10px] uppercase tracking-wider">
              <span>Ad · {form.advertiser || "Advertiser"}</span>
              <span className="rounded-full bg-white/20 px-3 py-1 normal-case tracking-normal">
                {form.ctaLabel || "View more"}
              </span>
            </div>
          </div>
          <p className="p-3 text-xs text-gray-600">{form.body || "Body"}</p>
          {form.disclosure ? (
            <p className="px-3 pb-3 text-[10px] text-gray-400">
              {form.disclosure}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
