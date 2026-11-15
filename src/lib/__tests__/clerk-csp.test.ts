import { afterEach, describe, expect, it, vi } from "vitest";
import { clerkFrontendApiOrigin } from "@/lib/clerk-csp";

// Publishable keys are `pk_<env>_<base64(frontendApiHost + "$")>`. Fixtures are
// synthesised from the host instead of committing a real key: the key is public
// by design, but a committed `pk_...` token trips secret scanners and normalises
// leaking credentials into the repository.
const publishableKeyFor = (env: "test" | "live", host: string) =>
  `pk_${env}_${Buffer.from(`${host}$`).toString("base64")}`;

// The Frontend API host encoded by the CI/dev publishable key.
const DEV_HOST = "optimal-shepherd-5919.clerk.accounts.dev";
const DEV_KEY = publishableKeyFor("test", DEV_HOST);

const liveKeyFor = (host: string) => publishableKeyFor("live", host);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("clerkFrontendApiOrigin", () => {
  it("derives the frontend API origin from a development key", () => {
    expect(clerkFrontendApiOrigin(DEV_KEY)).toBe(
      "https://optimal-shepherd-5919.clerk.accounts.dev"
    );
  });

  it("derives our own domain from a production key", () => {
    // This is the case that matters: after the cutover the Frontend API moves to
    // a domain that is not in the static CSP allow-list.
    expect(clerkFrontendApiOrigin(liveKeyFor("clerk.slnews.sl"))).toBe(
      "https://clerk.slnews.sl"
    );
  });

  // Note: `clerkFrontendApiOrigin(undefined)` is *not* a way to simulate a missing
  // key — an explicit `undefined` triggers the default parameter, which reads the
  // environment. These cases stub the variable instead, so they hold whether or
  // not the runner has NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY set (CI does).
  describe("sourcing the key", () => {
    it("uses the configured publishable key by default", () => {
      vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", DEV_KEY);

      expect(clerkFrontendApiOrigin()).toBe(
        "https://optimal-shepherd-5919.clerk.accounts.dev"
      );
    });

    it("returns null when the configured key is empty", () => {
      vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");

      expect(clerkFrontendApiOrigin()).toBeNull();
    });

    it("returns null for an empty key passed directly", () => {
      expect(clerkFrontendApiOrigin("")).toBeNull();
    });
  });

  it("returns null when there is no third segment", () => {
    expect(clerkFrontendApiOrigin("not-a-key")).toBeNull();
    expect(clerkFrontendApiOrigin("pk_test_")).toBeNull();
  });

  it("returns null for undecodable base64", () => {
    expect(clerkFrontendApiOrigin("pk_test_!!!not-base64!!!")).toBeNull();
  });

  it("rejects a decoded value that is not a hostname", () => {
    // Guards the policy: a malformed key must not be able to inject an entry
    // containing wildcards, spaces or paths.
    for (const injected of [
      "example.com; script-src *",
      "*",
      "https://evil.com",
      "a b.com",
    ]) {
      expect(clerkFrontendApiOrigin(liveKeyFor(injected))).toBeNull();
    }
  });

  it("tolerates a decoded host without the trailing terminator", () => {
    const withoutTerminator = `pk_live_${Buffer.from("clerk.example.com").toString("base64")}`;
    expect(clerkFrontendApiOrigin(withoutTerminator)).toBe(
      "https://clerk.example.com"
    );
  });
});
