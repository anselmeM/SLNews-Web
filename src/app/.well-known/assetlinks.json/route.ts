import { NextResponse } from "next/server";

/**
 * Android App Links verification for `https://slnews.sl/article/<id>`.
 *
 * Android fetches this URL at install time; the `sha256_cert_fingerprints` must
 * include the certificate that signed the installed APK. Testers install builds
 * signed with the upload key; Play production re-signs with the Play app-signing
 * key, so both fingerprints are listed. Override with
 * `ANDROID_APP_LINK_FINGERPRINTS` (comma-separated) when either key rotates.
 *
 * The app-side checklist lives in `docs/APP-LINKS.md`.
 */

const PACKAGE_NAME = "com.slnews.mobile";

/** SHA-256 of the upload key used by CI and local release builds. */
const UPLOAD_KEY_FINGERPRINT =
  "70:8D:7C:54:9C:10:F2:6A:39:E5:E7:59:DE:62:F6:C5:28:DF:92:B2:5F:AB:7B:2D:13:2A:B1:61:B0:44:A3:F2";

/** Canonical `AA:BB:...` form, accepting lowercase or colon-less input. */
export function normalizeFingerprint(value: string): string {
  const hex = value.replace(/[^0-9a-f]/gi, "").toUpperCase();
  return hex.match(/.{2}/g)?.join(":") ?? "";
}

export function fingerprintsFromEnvironment(
  raw: string | undefined = process.env.ANDROID_APP_LINK_FINGERPRINTS,
): string[] {
  const source = raw?.trim() ? raw : UPLOAD_KEY_FINGERPRINT;
  const normalized = source
    .split(",")
    .map(normalizeFingerprint)
    .filter((fingerprint) => fingerprint.length === 95);
  return Array.from(new Set(normalized));
}

export function GET(): NextResponse {
  const body = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: PACKAGE_NAME,
        sha256_cert_fingerprints: fingerprintsFromEnvironment(),
      },
    },
  ];

  return NextResponse.json(body, {
    headers: {
      // Short cache: a rotated key must not stay pinned in a phone's verifier.
      "cache-control": "public, max-age=300",
    },
  });
}
