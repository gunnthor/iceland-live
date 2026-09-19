import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

/**
 * A monospace face for readouts — coordinates, event ids, depths. It keeps
 * numbers in fixed columns, which is what makes a dense table scannable.
 */
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-data",
  weight: ["400", "500"],
  display: "swap",
});

const DESCRIPTION =
  "A live map of earthquakes and volcanic systems in Iceland, built on official data from the Icelandic Meteorological Office.";

export const metadata: Metadata = {
  title: {
    default: "Iceland Live — real-time earthquakes and volcanic systems",
    template: "%s · Iceland Live",
  },
  description: DESCRIPTION,
  applicationName: "Iceland Live",
  openGraph: {
    title: "Iceland Live",
    description: DESCRIPTION,
    type: "website",
    locale: "en_GB",
  },
  twitter: { card: "summary_large_image", title: "Iceland Live", description: DESCRIPTION },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#05070a",
  width: "device-width",
  initialScale: 1,
  // The map handles its own zoom gestures; letting the page zoom too fights it.
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <head>
        {/* The basemap tiles come from a different origin; warm it up early. */}
        <link rel="preconnect" href="https://basemaps.cartocdn.com" crossOrigin="" />
        <link rel="preconnect" href="https://tiles.basemaps.cartocdn.com" crossOrigin="" />
      </head>
      <body>{children}</body>
    </html>
  );
}
