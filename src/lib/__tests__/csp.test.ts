import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCspHeader, CSP_REPORT_URI, generateNonce } from "@/lib/csp";

function directive(header: string, name: string): string {
  return (
    header
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `)) ?? ""
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildCspHeader", () => {
  it("pins script execution to a per-request nonce", () => {
    const header = buildCspHeader("test-nonce-value");
    const scriptSrc = directive(header, "script-src");

    expect(scriptSrc).toContain("'nonce-test-nonce-value'");
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("keeps the other hardened directives and the report sink", () => {
    const header = buildCspHeader("n");

    expect(header).toContain("default-src 'self'");
    expect(header).toContain("object-src 'none'");
    expect(header).toContain("base-uri 'self'");
    expect(header).toContain("frame-ancestors 'self'");
    expect(header).toContain(`report-uri ${CSP_REPORT_URI}`);
    expect(directive(header, "style-src")).toContain("'unsafe-inline'");
  });

  it("allows unsafe-eval only in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(directive(buildCspHeader("n"), "script-src")).toContain(
      "'unsafe-eval'"
    );

    vi.stubEnv("NODE_ENV", "production");
    expect(directive(buildCspHeader("n"), "script-src")).not.toContain(
      "'unsafe-eval'"
    );
  });
});

describe("generateNonce", () => {
  it("returns a fresh base64 nonce on every call", () => {
    const first = generateNonce();
    const second = generateNonce();

    expect(first).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(first).not.toBe(second);
  });
});
