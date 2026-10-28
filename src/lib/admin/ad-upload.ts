import { get, put } from "@vercel/blob";

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

function safeExtension(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase() ?? "jpg";
  return /^(jpe?g|png|webp|avif)$/.test(extension) ? extension : "jpg";
}

function appOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://sl-news.vercel.app"
  ).replace(/\/+$/, "");
}

/**
 * Uploads a validated creative and returns a URL the app can fetch.
 *
 * Public stores return Blob's CDN URL. Private stores (the safer default) can
 * only be read with the store token, so the app receives our own proxy URL
 * instead; `/api/mobile/v1/creative` streams the blob with a long immutable
 * cache. The pathname is a random UUID, so the proxy URL is unguessable.
 */
export async function uploadCreative(file: File): Promise<string> {
  if (!isUploadConfigured()) {
    throw new AdUploadError(
      "Creative uploads are not configured. Connect a Vercel Blob store (BLOB_READ_WRITE_TOKEN) or paste an https image URL instead."
    );
  }
  const invalid = validateCreativeFile(file);
  if (invalid) throw new AdUploadError(invalid);

  const pathname = `sponsorships/${crypto.randomUUID()}.${safeExtension(file.name)}`;
  const common = {
    addRandomSuffix: false,
    contentType: file.type,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  };

  try {
    const blob = await put(pathname, file, { ...common, access: "public" });
    return blob.url;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/private store/i.test(message)) throw error;
    // Private store: store the blob and hand out the authenticated proxy URL.
    const blob = await put(pathname, file, { ...common, access: "private" });
    return `${appOrigin()}/api/mobile/v1/creative?path=${encodeURIComponent(blob.pathname)}`;
  }
}

/** Streams a private-store creative. Only paths created by uploadCreative pass. */
export async function readCreative(pathname: string): Promise<{
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  size: number;
} | null> {
  if (!pathname.startsWith("sponsorships/") || pathname.includes(".."))
    return null;
  const result = await get(pathname, {
    access: "private",
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  if (!result || result.statusCode !== 200) return null;
  return {
    stream: result.stream,
    contentType: result.blob.contentType ?? "application/octet-stream",
    size: result.blob.size,
  };
}
