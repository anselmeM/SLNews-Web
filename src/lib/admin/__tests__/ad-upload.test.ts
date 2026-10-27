import { describe, expect, it } from "vitest";
import {
  AdUploadError,
  uploadCreative,
  validateCreativeFile,
} from "../ad-upload";

function file(type: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], `creative.${type.split("/")[1]}`, {
    type,
  });
}

describe("ad creative upload", () => {
  it("accepts supported images under 4 MB", () => {
    expect(validateCreativeFile(file("image/jpeg", 1024))).toBeNull();
    expect(validateCreativeFile(file("image/webp", 1024))).toBeNull();
  });

  it("rejects unsupported types and oversize files", () => {
    expect(validateCreativeFile(file("application/pdf", 10))).toContain("JPEG");
    expect(validateCreativeFile(file("image/png", 5 * 1024 * 1024))).toContain(
      "4 MB"
    );
  });

  it("explains when Blob storage is not configured", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    await expect(uploadCreative(file("image/png", 10))).rejects.toBeInstanceOf(
      AdUploadError
    );
  });

  it("fails validation before attempting an upload", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "test-token";
    await expect(uploadCreative(file("text/plain", 10))).rejects.toBeInstanceOf(
      AdUploadError
    );
  });
});
