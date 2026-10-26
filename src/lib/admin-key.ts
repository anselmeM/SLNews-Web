import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time comparison for the x-admin-key header. */
export function adminKeyMatches(
  submitted: string | null,
  expected: string | undefined
): boolean {
  const wanted = expected?.trim();
  if (!wanted) return false;
  const a = createHash("sha256")
    .update((submitted ?? "").trim())
    .digest();
  const b = createHash("sha256").update(wanted).digest();
  return timingSafeEqual(a, b);
}
