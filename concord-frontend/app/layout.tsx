import './globals.css';
import { Providers } from '@/components/Providers';
import type { Metadata, Viewport } from 'next';
import { DM_Sans, JetBrains_Mono, Source_Serif_4 } from 'next/font/google';
import { headers } from 'next/headers';

/**
 * Self-hosted fonts via next/font — no render-blocking @import in globals.css.
 * DM Sans is the body + display face; JetBrains Mono is the code face.
 * Exposed as CSS variables so globals.css `--font-*` tokens + tailwind
 * `font-sans`/`font-mono` resolve to the same locally-served files.
 */
const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

/**
 * Source Serif 4 — TheVault's serif (museum wall label / certificate stock).
 *
 * Chosen against the brief's "print it on paper in 2050 and it still feels
 * appropriate" test. It is a transitional serif in the Fournier/Baskerville
 * lineage — a historical model, so it can never read as trendy — but drawn
 * by Frank Grießhaber for Adobe with no era-specific mannerisms, and
 * engineered for BOTH screen text and print. Its large-ish x-height and open
 * counters hold up at the small caption sizes real museum labels use, where
 * a Garamond revival goes thin and antiquarian. The variable weight axis
 * (200–900) is what lets the Vault build hierarchy out of weight and space
 * instead of color, which is required when the palette is grayscale + one
 * accent.
 *
 * Exposed as `--font-vault-serif`; tailwind maps it to `font-vault` (a
 * distinct key — it deliberately does NOT touch `font-serif`, see
 * tailwind.config.js). Loading it here rather than in the lens keeps it on
 * the same self-hosted, preload-optimized next/font path as the other two.
 */
const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-vault-serif',
  display: 'swap',
  /**
   * `preload: false` is deliberate and load-bearing — it is the difference
   * between this being additive and being a regression. next/font preloads by
   * default, which would emit a `<link rel="preload">` for this face on EVERY
   * page: 264 lenses paying download + preload-priority cost for a face that
   * exactly one of them renders. Declaring it here (rather than inside the
   * lens) still buys the self-hosting, the CSS-variable plumbing, and the
   * automatic no-layout-shift fallback metrics; opting out of preload keeps
   * the cost on the lens that actually uses it. DM Sans and JetBrains Mono
   * keep their default preload — they ARE used platform-wide.
   */
  preload: false,
});

/**
 * Root layout — Server Component.
 * Client-side providers (QueryClient, AppShell) are in <Providers>.
 * Fixes FE-002: root layout no longer forces entire tree into client mode.
 */

export const metadata: Metadata = {
  title: {
    default: 'Concord OS — Sovereign Cognitive Engine',
    template: '%s | Concord OS',
  },
  description:
    'A sovereign knowledge operating system. No ads. No subscriptions. No data extraction. Free. 175+ domain lenses, local-first AI. Your thoughts never leave your control.',
  keywords: [
    'cognitive engine',
    'knowledge OS',
    'sovereign AI',
    'DTU',
    'lattice',
    'local-first',
    'concord',
    'cognitive operating system',
  ],
  authors: [{ name: 'Concord OS' }],
  creator: 'Concord OS',
  manifest: '/manifest.json',
  icons: { icon: '/favicon.ico' },
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://concord-os.org'),
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: 'Concord OS',
    title: 'Concord OS — Sovereign Cognitive Engine',
    description:
      "No ads. Ever. No subscriptions. No data extraction. Free. A sovereign cognitive engine with 175+ domain lenses and local-first AI. Not a promise — it's architecture.",
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Concord OS — Your Personal Cognitive Engine',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Concord OS — Sovereign Cognitive Engine',
    description:
      'No ads. No subscriptions. No data extraction. Free. A sovereign cognitive engine — your thoughts never leave your control.',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the per-request CSP nonce here (set by middleware.ts) is what
  // actually matters, independent of whether this file interpolates it
  // into markup: calling headers() forces this layout into dynamic
  // rendering, which a per-request nonce requires (a statically-generated
  // page can't carry one). Next.js's own inline bootstrap scripts pick the
  // nonce up automatically from the incoming CSP header at render time.
  await headers();

  return (
    <html
      lang="en"
      className={`dark ${dmSans.variable} ${jetbrainsMono.variable} ${sourceSerif.variable}`}
    >
      <head>
        {/* iOS Smart App Banner — surfaces the native app on /dtu/, /quest/,
            /event/, /listing/ pages and deep-links into the matching screen. */}
        <meta name="apple-itunes-app" content="app-id=concordapp, app-argument=https://concord-os.org" />
        {/* Android Chrome equivalent: rel=alternate hints to the OS that a
            native app exists. The actual deep link is owned by the asset
            statements file at /.well-known/assetlinks.json. */}
        <link rel="alternate" href="android-app://org.concord.app" />
      </head>
      <body className="min-h-screen bg-lattice-void">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
