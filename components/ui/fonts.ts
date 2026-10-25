import { Playfair_Display, JetBrains_Mono } from "next/font/google";

// Editorial look: high-contrast serif for text/headings, monospace for chrome.
export const serif = Playfair_Display({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-ad-sans",
});
export const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-ad-mono" });
export const fontVariables = `${serif.variable} ${jetbrainsMono.variable}`;
