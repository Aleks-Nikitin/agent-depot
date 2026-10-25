import type { Metadata } from "next";
import { Playfair_Display, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteNav } from "@/components/auth/site-nav";

const geistSans = Playfair_Display({
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
      <head>
        <script
          // Apply the saved theme before paint so there's no flash or layout shift.
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('theme')||'light';document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}",
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-(--page-bg) text-(--page-fg)">
        <SiteNav />
        <main className="flex w-full flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
