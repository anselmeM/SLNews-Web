import { NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limiter";

export async function GET(request: Request) {
  const limit = checkRateLimit(`share-card:${getClientIp(request)}`, {
    maxRequests: 30,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate limited" },
      { status: 429, headers: { "retry-after": String(limit.retryAfter) } }
    );
  }

  const { searchParams } = new URL(request.url);
  const title =
    searchParams.get("title") || "SLNews - Sierra Leone News & Live Updates";
  const category = (
    searchParams.get("category") || "Sierra Leone"
  ).toUpperCase();
  const source = searchParams.get("source") || "SLNews Desk";

  const lines = splitTitle(title, 34);
  const startY = lines.length === 1 ? 290 : lines.length === 2 ? 260 : 220;

  const titleSvg = lines
    .map(
      (line, i) =>
        `<text x="80" y="${startY + i * 56}" fill="#F0F6FC" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" font-size="46" font-weight="800" letter-spacing="-0.02em">${esc(line)}</text>`
    )
    .join("\n  ");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0a1017"/>
      <stop offset="60%" stop-color="#121d28"/>
      <stop offset="100%" stop-color="#09141f"/>
    </linearGradient>
    <linearGradient id="flagGreen" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#1EB53A"/>
      <stop offset="100%" stop-color="#008751"/>
    </linearGradient>
    <linearGradient id="flagBlue" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#0072C6"/>
      <stop offset="100%" stop-color="#0055A5"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bgGrad)"/>

  <!-- Top Sierra Leone Flag Stripe Header -->
  <rect x="0" y="0" width="400" height="6" fill="url(#flagGreen)"/>
  <rect x="400" y="0" width="400" height="6" fill="#FFFFFF"/>
  <rect x="800" y="0" width="400" height="6" fill="url(#flagBlue)"/>

  <!-- Header Branding -->
  <g transform="translate(80, 70)">
    <!-- Logo Badge -->
    <rect x="0" y="0" width="52" height="52" rx="14" fill="#008751"/>
    <text x="26" y="34" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-size="22" font-weight="900" text-anchor="middle" letter-spacing="-0.03em">SL</text>
    
    <!-- Publication Name & Tagline -->
    <text x="68" y="24" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-size="24" font-weight="900" letter-spacing="-0.02em">SLNews</text>
    <text x="68" y="44" fill="#8B949E" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-size="14" font-weight="600">Sierra Leone News &amp; Updates</text>

    <!-- Category Pill -->
    <rect x="880" y="8" width="${Math.max(120, category.length * 11 + 32)}" height="36" rx="18" fill="#1EB53A" fill-opacity="0.15" stroke="#1EB53A" stroke-opacity="0.4" stroke-width="1.5"/>
    <text x="${880 + Math.max(120, category.length * 11 + 32) / 2}" y="32" fill="#3FB950" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-size="13" font-weight="800" text-anchor="middle" letter-spacing="0.06em">${esc(category)}</text>
  </g>

  <!-- Divider Line -->
  <line x1="80" y1="145" x2="1120" y2="145" stroke="#30363D" stroke-width="1" stroke-opacity="0.6"/>

  <!-- Article Headline -->
  ${titleSvg}

  <!-- Footer Metadata Bar -->
  <g transform="translate(80, 520)">
    <line x1="0" y1="0" x2="1040" y2="0" stroke="#30363D" stroke-width="1" stroke-opacity="0.6"/>
    
    <!-- Source Attribution -->
    <circle cx="12" cy="38" r="5" fill="#3FB950"/>
    <text x="28" y="43" fill="#C9D1D9" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-size="18" font-weight="600">${esc(source)}</text>
    
    <!-- Domain Tag -->
    <text x="1040" y="43" fill="#8B949E" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-size="16" font-weight="700" text-anchor="end">slnews.vercel.app</text>
  </g>
</svg>`;

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function splitTitle(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const w of words) {
    if ((current + " " + w).trim().length > maxCharsPerLine && current) {
      lines.push(current.trim());
      current = w;
    } else {
      current = (current + " " + w).trim();
    }
  }
  if (current.trim()) {
    lines.push(current.trim());
  }

  // Cap at 3 lines
  if (lines.length > 3 && lines[2]) {
    lines[2] = lines[2].slice(0, maxCharsPerLine - 3) + "...";
    return lines.slice(0, 3);
  }

  return lines;
}
