import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthGate } from "@/components/AuthGate";
import { AuthProvider } from "@/context/AuthContext";
import { NovelProvider } from "@/context/NovelContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "小白作家 - AI 长篇小说创作助手",
  description: "帮助作者规划、检查并完成前后连贯的长篇小说。",
  icons: {
    icon: "/logo-mark.svg",
    shortcut: "/logo-mark.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>
          <AuthGate>
            <NovelProvider>
              {children}
            </NovelProvider>
          </AuthGate>
        </AuthProvider>
      </body>
    </html>
  );
}
