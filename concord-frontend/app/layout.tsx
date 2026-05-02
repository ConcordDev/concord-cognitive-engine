import './globals.css';
import { Providers } from '@/components/Providers';
import type { Metadata, Viewport } from 'next';

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-lattice-void">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
