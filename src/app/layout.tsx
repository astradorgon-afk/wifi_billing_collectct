import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DataProvider } from "@/providers/DataProvider";
import { AppShell } from "@/components/AppShell";
import { PwaRegister } from "@/components/PwaRegister";

export const metadata: Metadata = {
  title: "WiFi Billing & Collections",
  description:
    "Offline-first billing and collection system for WiFi installation businesses.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "WiFi Billing",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#1d4ed8",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function () {
              try {
                var stored = window.localStorage.getItem("wifi-billing:theme");
                var dark = stored
                  ? stored === "dark"
                  : window.matchMedia("(prefers-color-scheme: dark)").matches;
                document.documentElement.classList.toggle("dark", dark);
              } catch (e) {}
            })();`,
          }}
        />
      </head>
      <body className="min-h-full">
        <DataProvider>
          <AppShell>{children}</AppShell>
          <PwaRegister />
        </DataProvider>
      </body>
    </html>
  );
}
