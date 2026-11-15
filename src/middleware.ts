import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";
import { buildCspHeader, generateNonce } from "@/lib/csp";
import { logger } from "@/lib/logger";

const isProtectedRoute = createRouteMatcher(["/dashboard(.*)", "/profile(.*)"]);

const ADMIN_COOKIE = "slnews_admin";
const ADMIN_LOGIN_PATH = "/admin/sponsorships/login";

/** Constant-time-ish hex comparison for the derived admin token. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Edge-compatible admin gate for every /admin page except the login form.
 * The cookie stores sha256("slnews-admin:<key>"), never the key itself.
 */
async function hasAdminCookie(req: NextRequest): Promise<boolean> {
  const key = process.env.SPONSORSHIP_ADMIN_KEY?.trim();
  if (!key) return false;
  const token = req.cookies.get(ADMIN_COOKIE)?.value ?? "";
  if (!token) return false;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`slnews-admin:${key}`)
  );
  const expected = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return safeEqual(expected, token);
}

/** Attach the per-request policy to any middleware exit path. */
function withCsp(response: Response, csp: string): Response {
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

/**
 * Forward headers to the App Router. The `Content-Security-Policy` request
 * header is what Next reads to put the nonce on its hydration scripts; the
 * `x-nonce` header is what Clerk reads for its own script tags.
 */
function nextWithHeaders(csp: string, headers: Headers): NextResponse {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("Content-Security-Policy", csp);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

/** App Router pass-through from inside the Clerk middleware callback. */
function nextFromRequest(req: NextRequest): NextResponse {
  const requestHeaders = new Headers(req.headers);
  const csp = req.headers.get("Content-Security-Policy");
  if (csp) requestHeaders.set("Content-Security-Policy", csp);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

const hasClerkKeys = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY
);

const clerkHandler = hasClerkKeys
  ? clerkMiddleware(async (auth, req) => {
      if (isProtectedRoute(req)) {
        // Without an explicit URL, protect() has no sign-in page configured and
        // returns a bare 404 for signed-out users instead of sending them to log
        // in (see Clerk: "protect() in middleware redirects to signInUrl if signed
        // out" — it 404s when that URL is unset).
        await auth.protect({
          unauthenticatedUrl: new URL("/sign-in", req.url).toString(),
        });
      }

      return nextFromRequest(req);
    })
  : null;

export default async function middleware(
  req: NextRequest,
  evt: NextFetchEvent
) {
  const nonce = generateNonce();
  const csp = buildCspHeader(nonce);

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/admin") && pathname !== ADMIN_LOGIN_PATH) {
    if (!(await hasAdminCookie(req))) {
      return withCsp(
        NextResponse.redirect(new URL(ADMIN_LOGIN_PATH, req.url), 307),
        csp
      );
    }
  }

  if (clerkHandler) {
    try {
      // Clerk needs the request headers (cookies, x-nonce, CSP) while it
      // authenticates and builds the response; reconstructing the request keeps
      // those headers immutable-safe on the edge runtime.
      const clerkReq = new NextRequest(req.url, {
        method: req.method,
        headers: requestHeaders,
      });
      const response = await clerkHandler(clerkReq, evt);
      if (response) return withCsp(response, csp);
    } catch (err) {
      // Middleware runs on the edge runtime, and this catch is the last line of
      // defence before a request is served unauthenticated — so log it
      // structurally rather than pulling the Sentry SDK into the edge bundle.
      logger.error("Clerk middleware invocation failed", {
        error: err instanceof Error ? err.message : String(err),
        path: req.nextUrl.pathname,
      });
    }
  }

  return nextWithHeaders(csp, requestHeaders);
}

export const config = {
  matcher: [
    "/((?!_next|api/health|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)((?!health).*)",
  ],
};
