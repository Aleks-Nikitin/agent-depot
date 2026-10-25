import { EB_Garamond, JetBrains_Mono } from "next/font/google";

// Editorial look: warm old-style serif for text/headings, monospace for chrome.
export const serif = EB_Garamond({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-ad-sans",
});
export const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-ad-mono" });
export const fontVariables = `${serif.variable} ${jetbrainsMono.variable}`;
