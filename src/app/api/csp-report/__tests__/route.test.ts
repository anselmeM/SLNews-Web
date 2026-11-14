import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../route";
import { logger } from "@/lib/logger";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function report(body: unknown, ip = "198.51.100.4"): Request {
  return new Request("http://localhost/api/csp-report", {
    method: "POST",
    headers: {
      "content-type": "application/csp-report",
      "x-forwarded-for": ip,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/csp-report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs the violated directive, blocked uri and document", async () => {
    const response = await POST(
      report({
        "csp-report": {
          "effective-directive": "script-src-elem",
          "blocked-uri": "https://evil.test/x.js",
          "document-uri": "https://slnews.sl/",
        },
      })
    );

    expect(response.status).toBe(204);
    expect(logger.warn).toHaveBeenCalledWith("csp violation", {
      directive: "script-src-elem",
      blocked: "https://evil.test/x.js",
      document: "https://slnews.sl/",
    });
  });

  it("falls back to the legacy violated-directive field", async () => {
    await POST(
      report({
        "csp-report": {
          "violated-directive": "img-src",
          "blocked-uri": "inline",
        },
      })
    );

    expect(logger.warn).toHaveBeenCalledWith(
      "csp violation",
      expect.objectContaining({ directive: "img-src" })
    );
  });

  it("accepts a batched report-to payload", async () => {
    await POST(
      report([
        {
          type: "csp-violation",
          body: {
            "effective-directive": "frame-src",
            "blocked-uri": "https://x.test",
          },
        },
      ])
    );

    expect(logger.warn).toHaveBeenCalledWith(
      "csp violation",
      expect.objectContaining({ directive: "frame-src" })
    );
  });

  it("truncates oversized field values before logging", async () => {
    await POST(
      report({
        "csp-report": {
          "effective-directive": "script-src",
          "blocked-uri": "a".repeat(5000),
        },
      })
    );

    const [, meta] = vi.mocked(logger.warn).mock.calls[0] as [
      string,
      { blocked: string },
    ];
    expect(meta.blocked).toHaveLength(200);
  });

  it("ignores an unparseable body instead of failing", async () => {
    const response = await POST(report("{not json"));

    expect(response.status).toBe(204);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("rejects an oversized report without buffering it unboundedly", async () => {
    const response = await POST(report("x".repeat(9_000)));

    expect(response.status).toBe(413);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("rate limits a caller that floods the endpoint", async () => {
    let lastStatus = 204;
    for (let i = 0; i < 61; i++) {
      const response = await POST(
        report({ "csp-report": { "blocked-uri": "inline" } }, "203.0.113.99")
      );
      lastStatus = response.status;
    }

    expect(lastStatus).toBe(429);
  });
});
