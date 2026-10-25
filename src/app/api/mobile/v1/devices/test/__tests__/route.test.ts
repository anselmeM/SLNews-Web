import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";
import { sendNativePush } from "@/lib/push/fcm";

vi.mock("@/lib/push/fcm", () => ({ sendNativePush: vi.fn() }));
vi.mock("@/lib/error-reporting", () => ({ reportError: vi.fn() }));

function request(body?: unknown, key?: string): Request {
  return new Request("http://localhost/api/mobile/v1/devices/test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { "x-admin-key": key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("test push endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SPONSORSHIP_ADMIN_KEY;
  });

  it("503 when the admin key is not configured", async () => {
    expect((await POST(request({}))).status).toBe(503);
  });

  it("401 with a wrong key", async () => {
    process.env.SPONSORSHIP_ADMIN_KEY = "secret";
    expect((await POST(request({}, "wrong"))).status).toBe(401);
  });

  it("sends to every device and reports counts", async () => {
    process.env.SPONSORSHIP_ADMIN_KEY = "secret";
    vi.mocked(sendNativePush).mockResolvedValue({
      sent: 2,
      failed: 1,
      invalid: 1,
    });
    const response = await POST(
      request({ title: "Hi", body: "There" }, "secret")
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      sent: 2,
      failed: 1,
      invalid: 1,
      skipped: null,
    });
    expect(sendNativePush).toHaveBeenCalledWith({
      title: "Hi",
      body: "There",
      url: "/",
      category: "test",
    });
  });

  it("is not ok when nothing was delivered", async () => {
    process.env.SPONSORSHIP_ADMIN_KEY = "secret";
    vi.mocked(sendNativePush).mockResolvedValue({
      sent: 0,
      failed: 0,
      invalid: 0,
    });
    const response = await POST(request({}, "secret"));
    expect((await response.json()).ok).toBe(false);
  });
});
