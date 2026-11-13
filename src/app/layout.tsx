import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import Script from "next/script";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import MarketingHeader from "@/components/marketing/MarketingHeader";
import ThemeSync from "@/components/ThemeSync";
import { ToastProvider } from "@/components/Toast";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#131212" },
  ],
};

// Give serverless functions headroom to wake the (serverless) Neon database
// from cold start — the default limit can time out the first query after
// the compute has been idle, surfacing as a random "Something went wrong".
export const maxDuration = 60;

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
  ),
  title: "SLNews | Sierra Leone News",
  description:
    "Community journalism and global news aggregation for Sierra Leone.",
  manifest: "/manifest.json",
  openGraph: {
    title: "SLNews | Sierra Leone News",
    description:
      "Community journalism and global news aggregation for Sierra Leone.",
    type: "website",
    siteName: "SLNews",
    images: ["/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "SLNews | Sierra Leone News",
    description:
      "Community journalism and global news aggregation for Sierra Leone.",
    images: ["/og-image.png"],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" className="antialiased" suppressHydrationWarning>
        <head>
          <Script
            id="theme-init"
            strategy="beforeInteractive"
            dangerouslySetInnerHTML={{
              __html: `
                (function() {
                  try {
                    var stored = localStorage.getItem('slnews-app-storage');
                    var theme = 'system';
                    if (stored) {
                      var parsed = JSON.parse(stored);
                      theme = (parsed && parsed.state && parsed.state.theme) ? parsed.state.theme : 'system';
                    }
                    var isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
                    if (isDark) {
                      document.documentElement.classList.add('dark');
                    } else {
                      document.documentElement.classList.remove('dark');
                    }
                  } catch (e) {}
                })();
              `,
            }}
          />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link
            rel="preconnect"
            href="https://fonts.gstatic.com"
            crossOrigin="anonymous"
          />
          {/* Material Symbols is an icon font; a single root load is intended. */}
          {/* eslint-disable-next-line @next/next/no-page-custom-font */}
          <link
            href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
            rel="stylesheet"
          />
          <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta
            name="apple-mobile-web-app-status-bar-style"
            content="black-translucent"
          />
          <meta name="apple-mobile-web-app-title" content="SLNews" />
        </head>
        <body
          className="bg-surface text-on-surface font-body-md min-h-screen"
          id="top"
        >
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-white focus:rounded-full focus:outline-none"
          >
            Skip to content
          </a>
          <ToastProvider>
            <ThemeSync />
            <MarketingHeader />
            <main id="main-content">{children}</main>
            <MarketingFooter />
          </ToastProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
