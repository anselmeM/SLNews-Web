import { describe, expect, it } from "vitest";
import {
  assertPublicImageUrl,
  isPrivateAddress,
  UnsafeImageUrlError,
} from "@/lib/safe-image-fetch";

describe("safe image fetch", () => {
  it("rejects private and reserved addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "::1",
      "fd00::1",
      "fe80::1",
    ]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });

  it("rejects localhost and private literals", async () => {
    await expect(
      assertPublicImageUrl("https://127.0.0.1/a.jpg")
    ).rejects.toBeInstanceOf(UnsafeImageUrlError);
    await expect(
      assertPublicImageUrl("https://localhost/a.jpg")
    ).rejects.toBeInstanceOf(UnsafeImageUrlError);
    await expect(
      assertPublicImageUrl("https://[::1]/a.jpg")
    ).rejects.toBeInstanceOf(UnsafeImageUrlError);
  });

  it("rejects non-http schemes", async () => {
    await expect(
      assertPublicImageUrl("file:///etc/passwd")
    ).rejects.toBeInstanceOf(UnsafeImageUrlError);
  });
});
