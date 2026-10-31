import type { Metadata, Viewport } from "next";
import { Abril_Fatface, Anton, Bungee, Courier_Prime, IBM_Plex_Mono, Space_Mono, Special_Elite } from "next/font/google";
import { Providers } from "@/components/providers";
import { THEME_INIT_SCRIPT } from "@/lib/theme-script";
import "./globals.css";

// Type, "night shift" edition: a tall condensed grotesque for headlines
// (Anton), a typewriter face for text (Courier Prime, like a typed case
// report), and a clean mono for hashes and data labels (IBM Plex Mono).
// next/font self-hosts all three (no request to Google at runtime).
const display = Anton({
  variable: "--font-anton",
  weight: "400", // Anton has a single, very heavy weight
  subsets: ["latin"],
});
const sans = Courier_Prime({
  variable: "--font-courier",
  weight: ["400", "700"],
  subsets: ["latin"],
});
const mono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

// The landing hero's "ransom note": letters cut from different "magazines"
// (Anton above, plus a fat serif, a chunky sign face and a worn typewriter),
// and Space Mono for the masthead links. All single-weight except Space Mono.
const abril = Abril_Fatface({ variable: "--nf-abril", weight: "400", subsets: ["latin"] });
const bungee = Bungee({ variable: "--nf-bungee", weight: "400", subsets: ["latin"] });
const elite = Special_Elite({ variable: "--nf-elite", weight: "400", subsets: ["latin"] });
const spaceMono = Space_Mono({ variable: "--nf-space-mono", weight: ["400", "700"], subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TruthLens: Photo Provenance",
  description:
    "Capture photos that are hashed, signed and anchored on a blockchain, then verify any image's origin.",
  applicationName: "TruthLens",
  appleWebApp: { capable: true, title: "TruthLens", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ece2cb" },
    { media: "(prefers-color-scheme: dark)", color: "#13110e" },
  ],
  // Let the camera page draw under the phone's notch; the HUD pads itself
  // with env(safe-area-inset-*).
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: THEME_INIT_SCRIPT sets data-theme on <html>
    // before React loads, so this one attribute legitimately differs from the
    // server's HTML.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${display.variable} ${sans.variable} ${mono.variable} ${abril.variable} ${bungee.variable} ${elite.variable} ${spaceMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
