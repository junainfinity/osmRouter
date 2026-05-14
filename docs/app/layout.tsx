import "./global.css";
import { RootProvider } from "fumadocs-ui/provider/next";
import Script from "next/script";
import type { ReactNode } from "react";

// Google Analytics 4 measurement ID — same as osmrouter.com.
const GA_MEASUREMENT_ID = "G-48XEZXX0W5";

export const metadata = {
  title: {
    template: "%s — osmRouter docs",
    default: "osmRouter docs",
  },
  description:
    "Documentation for osmRouter — sovereign, BYO-domain reverse tunnels for self-hosted services and AI inference.",
  icons: {
    icon: "/favicon.ico",
    apple: "/icon.png",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        {/* Google tag (gtag.js) — afterInteractive so it never blocks paint. */}
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
        <Script id="gtag-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}');
          `}
        </Script>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
