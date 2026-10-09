/**
 * Canonical entry point (`/`).
 *
 * Logged-out visitors get the minimal splash: orb logo, wordmark, quote of
 * the day, tagline and a single "Enter" link. It is server-rendered inside
 * #ssr-landing so it is the first paint (and what crawlers see).
 *
 * Signed-in visitors never see it: middleware.ts 307s `/` to `/hub` when a
 * session cookie is present, and HomeClient still runs its client-side
 * session probe (httpOnly session without the `concord_entered` flag ->
 * /hub) and its returning-user checks, exactly as before. In `landing="ssr"`
 * mode HomeClient leaves the splash in place for first-time visitors
 * instead of swapping in the old marketing LandingPage, which now lives at
 * /about.
 */

import type { Metadata } from 'next';
import { HomeClient } from '@/components/home/HomeClient';
import { SplashHome } from '@/components/splash/SplashHome';
import { quoteForDate } from '@/lib/splash/daily-quotes';

// The quote rotates daily (UTC); never serve a build-time snapshot of it.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Concord — A system for the people',
  description:
    'Concord is a system for the people: one shared engine for knowledge, building and community, free for all services, with no ads and no data extraction.',
  alternates: {
    canonical: '/',
  },
};

export default function HomePage() {
  const quote = quoteForDate(new Date());

  return (
    <>
      <div id="ssr-landing">
        <SplashHome quote={quote} />
      </div>

      {/* Auth redirects + returning-user dashboard; keeps the splash for new visitors. */}
      <HomeClient landing="ssr" />
    </>
  );
}
