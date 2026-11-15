import { test, expect } from "@playwright/test";
import { clerkFrontendApiOrigin } from "../src/lib/clerk-csp";

test.describe("Marketing site", () => {
  test("landing page sells the app and carries no reader chrome", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("main h1")).toContainText(
      /Sierra Leone news, in your pocket/i
    );
    await expect(
      page.getByRole("link", { name: "Features", exact: true })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Get the app" })).toBeVisible();
    await expect(page.locator('button[aria-label="Open menu"]')).toHaveCount(0);
  });

  test("feature and FAQ pages load", async ({ page }) => {
    await page.goto("/features");
    await expect(page.locator("main h1")).toContainText(
      /What.s inside the app/i
    );
    await page.goto("/faq");
    await expect(page.locator("main h1")).toContainText(
      /Questions and answers/i
    );
  });

  test("legal and download pages stay reachable", async ({ page }) => {
    for (const path of ["/privacy", "/terms", "/delete-account", "/download"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBeLessThan(400);
    }
  });

  test("retired reader routes redirect to the marketing site", async ({
    page,
  }) => {
    await page.goto("/home");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("main h1")).toContainText(/Sierra Leone news/i);
    await page.goto("/saved");
    await expect(page).toHaveURL(/\/$/);
  });

  test("serves a nonce-based production CSP without unsafe-inline scripts", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    const response = await page.goto("/");
    await page.waitForTimeout(1500);

    const csp = response?.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("report-uri /api/csp-report");

    const scriptSrc =
      csp
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("script-src ")) ?? "";
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");

    const nonce = scriptSrc.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce, scriptSrc).toBeTruthy();

    // Everything in the server-rendered HTML is authorised by the response
    // nonce. Chunks that the nonce-bearing bootstrap injects later are allowed
    // by `'strict-dynamic'` and do not need their own nonce attribute.
    const html = await response?.text();
    const ssrScripts = html?.match(/<script\b[^>]*>/g) ?? [];
    expect(ssrScripts.length).toBeGreaterThan(0);
    for (const tag of ssrScripts) {
      expect(tag).toContain(`nonce="${nonce}"`);
    }

    const scripts = await page.locator("script").evaluateAll((nodes) =>
      nodes.map((node) => {
        const script = node as HTMLScriptElement;
        return {
          // Chrome hides the content attribute after execution; the IDL
          // property keeps the nonce the parser applied.
          nonce: script.nonce,
          src: script.src,
          inline: !script.getAttribute("src"),
        };
      })
    );
    expect(scripts.some((script) => script.nonce === nonce)).toBe(true);
    for (const script of scripts.filter((script) => script.inline)) {
      // Inline scripts cannot be authorised by `'strict-dynamic'` via a
      // trusted loader; they must carry the nonce themselves.
      expect(script.nonce, JSON.stringify(script)).toBe(nonce);
    }

    expect(
      consoleErrors.filter((message) =>
        /content security policy/i.test(message)
      )
    ).toEqual([]);

    const expectedOrigin = clerkFrontendApiOrigin();
    if (expectedOrigin) expect(csp).toContain(expectedOrigin);
  });

  test("skip link and image alternatives are present", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('a[href="#main-content"]')).toHaveCount(1);
    const images = page.locator("img");
    const count = await images.count();
    for (let i = 0; i < count; i++) {
      expect(await images.nth(i).getAttribute("alt")).toBeTruthy();
    }
  });
});

test.describe("Dark mode", () => {
  test.use({ colorScheme: "dark" });

  test("respects the visitor's dark preference on the landing page", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/dark/);
    const background = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor
    );
    // Dark surface token, not white.
    expect(background).not.toBe("rgb(255, 255, 255)");
  });

  test("the header toggle switches themes", async ({ page }) => {
    await page.goto("/");
    await page
      .getByRole("button", { name: /Switch to (light|dark) theme/ })
      .click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  });
});
