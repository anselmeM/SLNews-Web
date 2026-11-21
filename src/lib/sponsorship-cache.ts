import { revalidateTag } from "next/cache";

/** Cache tag shared by the public sponsorship read and the admin mutations. */
export const SPONSORSHIPS_TAG = "sponsorships";

export function revalidateSponsorships(): void {
  try {
    revalidateTag(SPONSORSHIPS_TAG, "max");
  } catch {
    // Unit tests and non-request contexts do not have a cache store; the next
    // request will read through the short-lived cache regardless.
  }
}
