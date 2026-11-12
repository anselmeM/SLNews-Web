"use client";

import { useState } from "react";
import { createCampaign } from "../actions";

const defaults = {
  placement: "feed",
  advertiser: "Orange SL",
  headline: "SCAN AND SAVE",
  body: "Every top-up this month",
  ctaLabel: "View more",
  ctaUrl: "https://example.com/offer",
  brandHex: "#0B6FD1",
  brandAccentHex: "#2E9BF5",
  assetLabel: "$5",
  disclosure: "Terms apply",
  imageUrl: "",
};

/** Create form with a live preview of the native card the app will render. */
export function CampaignForm() {
  const [form, setForm] = useState(defaults);
  const set =
    (key: keyof typeof defaults) => (event: { target: { value: string } }) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <form
        action={createCampaign}
        className="space-y-3 rounded-2xl border border-outline-variant/30 p-4"
      >
        <label className="block text-xs font-semibold">Placement</label>
        <select
          name="placement"
          value={form.placement}
          onChange={set("placement")}
          className="w-full rounded-lg border px-3 py-2"
        >
          <option value="feed">feed</option>
          <option value="sports_stream">sports_stream</option>
          <option value="article_end">article_end</option>
        </select>

        {(
          [
            ["advertiser", "Advertiser", 40],
            ["headline", "Headline (max 40)", 40],
            ["body", "Body (max 80)", 80],
            ["ctaLabel", "CTA label (max 18)", 18],
            ["ctaUrl", "CTA URL", 200],
            ["brandHex", "Brand colour (#RRGGBB)", 7],
            ["brandAccentHex", "Accent colour (#RRGGBB)", 7],
            ["assetLabel", "Offer label (optional)", 20],
            ["disclosure", "Disclosure (optional)", 60],
            ["imageUrl", "Image URL (optional, https)", 500],
          ] as const
        ).map(([key, label, max]) => (
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
              required={!["assetLabel", "disclosure", "imageUrl"].includes(key)}
            />
          </div>
        ))}

        <div>
          <label className="block text-xs font-semibold" htmlFor="imageFile">
            Creative upload (optional, max 4 MB)
          </label>
          <input
            id="imageFile"
            name="imageFile"
            type="file"
            onChange={() =>
              setForm((current) => ({ ...current, imageUrl: "" }))
            }
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="w-full rounded-lg border px-3 py-2 text-xs"
          />
          <p className="mt-1 text-[11px] text-gray-500">
            Needs a connected Vercel Blob store. You can also paste an https
            image URL above.
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
              className="w-full rounded-lg border px-3 py-2"
            />
          </div>
        </div>

        <button
          type="submit"
          className="rounded-lg bg-black px-4 py-2 text-white"
        >
          Save campaign
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
            {form.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={form.imageUrl}
                alt=""
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
