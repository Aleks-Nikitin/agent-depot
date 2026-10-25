import { Inter, JetBrains_Mono } from "next/font/google";

export const inter = Inter({ subsets: ["latin"], variable: "--font-ad-sans" });
export const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-ad-mono" });
export const fontVariables = `${inter.variable} ${jetbrainsMono.variable}`;
