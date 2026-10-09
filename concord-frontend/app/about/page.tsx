/**
 * The previous marketing homepage ("AI that shows its receipts", domain
 * lenses, receipts, cognitive architecture), kept reachable here after `/`
 * became the minimal splash. Public (see middleware PUBLIC_PATHS) and
 * rendered without app chrome (AppShell STANDALONE_PREFIXES).
 */

import type { Metadata } from 'next';
import { LandingPage } from '@/components/landing/LandingPage';

export const metadata: Metadata = {
  title: 'About — AI that shows its receipts',
  description:
    'Concord gives engineers AI answers they can check: a real solver, the textbook hand check beside it, and a reproducible record of the inputs and assumptions.',
  alternates: {
    canonical: '/about',
  },
};

export default function AboutPage() {
  return <LandingPage />;
}
