import type { Metadata } from "next";
import { Playfair_Display, Geist_Mono } from "next/font/google";
import "./globals.css";
import Nav from "./_components/Nav";

const serif = Playfair_Display({
  variable: "--font-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
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
      className={`${serif.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Nav />
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
