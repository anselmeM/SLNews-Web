import { put } from "@vercel/blob";

/** Vercel's function request body limit is 4.5 MB; keep margin for multipart. */
export const MAX_CREATIVE_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

export class AdUploadError extends Error {}

export function isUploadConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

/** Validates type/size before any network call. */
export function validateCreativeFile(file: File): string | null {
  if (!ALLOWED_TYPES.has(file.type)) {
    return "Creative must be a JPEG, PNG, WebP or AVIF image.";
  }
  if (file.size <= 0) return "Creative file is empty.";
  if (file.size > MAX_CREATIVE_BYTES) {
    return "Creative is larger than 4 MB.";
  }
  return null;
}

/** Uploads a validated creative and returns its public URL. */
export async function uploadCreative(file: File): Promise<string> {
  if (!isUploadConfigured()) {
    throw new AdUploadError(
      "Creative uploads are not configured. Connect a Vercel Blob store (BLOB_READ_WRITE_TOKEN) or paste an https image URL instead."
    );
  }
  const invalid = validateCreativeFile(file);
  if (invalid) throw new AdUploadError(invalid);
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const safeExtension = /^(jpe?g|png|webp|avif)$/.test(extension)
    ? extension
    : "jpg";
  const blob = await put(
    `sponsorships/${crypto.randomUUID()}.${safeExtension}`,
    file,
    { access: "public", addRandomSuffix: false, contentType: file.type }
  );
  return blob.url;
}
