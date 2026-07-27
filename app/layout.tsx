import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { GeistMono } from "geist/font/mono";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const appUrl = process.env.APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "Needd Connect, One provider, one bill, local support",
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
  // Required for env(safe-area-inset-*) to resolve, which the portal tab bar
  // and the admin mobile bar both rely on to clear the home indicator.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en-ZA"
      className={`${jakarta.variable} ${GeistMono.variable} h-full`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
