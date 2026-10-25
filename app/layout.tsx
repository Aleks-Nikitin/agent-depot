import type { Metadata } from "next";
import Script from "next/script";
import { EB_Garamond, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteNav } from "@/components/auth/site-nav";

const geistSans = EB_Garamond({
  variable: "--font-geist-sans",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agent Depot",
  description: "Create, configure, version, and publish enterprise AI agents.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-(--page-bg) text-(--page-fg)">
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          // Restore the theme before hydration; Next manages script execution.
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('theme');document.documentElement.setAttribute('data-theme',t==='dark'?'dark':'light');}catch(e){document.documentElement.setAttribute('data-theme','light');}",
          }}
        />
        <SiteNav />
        <main className="flex w-full flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
