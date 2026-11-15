import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Campaign creatives are uploaded through a server action; keep the limit
    // under Vercel's 4.5 MB function-request ceiling.
    serverActions: { bodySizeLimit: "4mb" },
  },
  async redirects() {
    return [
      { source: "/local", destination: "/local-news", permanent: true },
      { source: "/local/:path*", destination: "/local-news", permanent: true },
      { source: "/national", destination: "/local-news", permanent: true },
      {
        source: "/national/:path*",
        destination: "/local-news",
        permanent: true,
      },
      { source: "/about", destination: "/features", permanent: true },
      { source: "/home", destination: "/", permanent: true },
      { source: "/local-news", destination: "/", permanent: true },
      { source: "/world", destination: "/", permanent: true },
      { source: "/saved", destination: "/", permanent: true },
      { source: "/reels", destination: "/", permanent: true },
      { source: "/search", destination: "/", permanent: true },
      { source: "/market", destination: "/", permanent: true },
      { source: "/announcements", destination: "/", permanent: true },
      { source: "/listen", destination: "/", permanent: true },
      { source: "/digest", destination: "/", permanent: true },
      { source: "/notifications", destination: "/", permanent: true },
      { source: "/profile", destination: "/", permanent: true },
      { source: "/dashboard", destination: "/", permanent: true },
      { source: "/offline", destination: "/", permanent: true },
      { source: "/login", destination: "/", permanent: true },
      { source: "/register", destination: "/", permanent: true },
      { source: "/sign-in", destination: "/", permanent: true },
      { source: "/sign-up", destination: "/", permanent: true },
      { source: "/forgot-password", destination: "/", permanent: true },
      { source: "/reset-password", destination: "/", permanent: true },
      { source: "/article/:path*", destination: "/", permanent: true },
      { source: "/author/:path*", destination: "/", permanent: true },
      { source: "/announcements/:path*", destination: "/", permanent: true },
      { source: "/dashboard/:path*", destination: "/", permanent: true },
    ];
  },
  images: {
    // No remote next/image sources are used. A wildcard allowlist would let
    // /_next/image fetch arbitrary hosts (SSRF/abuse), so it stays empty until
    // a specific CDN needs adding.
    remotePatterns: [],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
  output: "standalone",
  turbopack: {
    root: __dirname,
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  widenClientFileUpload: true,
});
