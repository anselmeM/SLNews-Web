import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fingerprintsFromEnvironment,
  GET,
  normalizeFingerprint,
} from "../route";

const UPLOAD = "70:8D:7C:54:9C:10:F2:6A:39:E5:E7:59:DE:62:F6:C5:28:DF:92:B2:5F:AB:7B:2D:13:2A:B1:61:B0:44:A3:F2";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /.well-known/assetlinks.json", () => {
  it("claims the app package for the upload key", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const body = (await response.json()) as Array<{
      relation: string[];
      target: {
        namespace: string;
        package_name: string;
        sha256_cert_fingerprints: string[];
      };
    }>;

    expect(body).toHaveLength(1);
    expect(body[0].relation).toEqual([
      "delegate_permission/common.handle_all_urls",
    ]);
    expect(body[0].target.namespace).toBe("android_app");
    expect(body[0].target.package_name).toBe("com.slnews.mobile");
    expect(body[0].target.sha256_cert_fingerprints).toEqual([UPLOAD]);
  });

  it("accepts the Play signing key alongside the upload key", async () => {
    vi.stubEnv(
      "ANDROID_APP_LINK_FINGERPRINTS",
      `${UPLOAD},aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99`,
    );

    const body = (await GET().json()) as Array<{
      target: { sha256_cert_fingerprints: string[] };
    }>;

    expect(body[0].target.sha256_cert_fingerprints).toEqual([
      UPLOAD,
      "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
    ]);
  });

  it("deduplicates and drops malformed fingerprints", () => {
    expect(
      fingerprintsFromEnvironment(`${UPLOAD}, ${UPLOAD.toLowerCase()}, deadbeef`),
    ).toEqual([UPLOAD]);
  });

  it("normalises lowercase and colon-less input", () => {
    expect(
      normalizeFingerprint(UPLOAD.replaceAll(":", "").toLowerCase()),
    ).toBe(UPLOAD);
  });
});
