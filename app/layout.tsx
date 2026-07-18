import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const appUrl = process.env.APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "Needd Connect — One provider, one bill, local support",
    template: "%s | Needd Connect",
  },
  description:
    "Uncapped LTE, 5G, fibre and business VoIP across South Africa. One provider, one bill, real local support on WhatsApp.",
  applicationName: "Needd Connect",
  icons: {
    apple: "/brand/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#136fb0",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en-ZA"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
