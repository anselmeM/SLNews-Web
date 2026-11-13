import { NextResponse } from "next/server";

/**
 * Per-user API responses must never be cached by a shared proxy or the browser.
 * Centralised so every mobile endpoint applies the same cache policy.
 */
export function noStoreJson(
  body: unknown,
  status: number,
  headers: Record<string, string> = {}
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}
