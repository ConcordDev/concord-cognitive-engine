'use client';

/**
 * /mobile — web-side mobile companion shell.
 *
 * Distinct from the concord-mobile/ React Native app. This is the
 * responsive web companion for users without the native install:
 * truncated lens grid, simplified controls, optimised for phone-sized
 * viewports.
 *
 * Component renders self-contained — no props. Backend integration
 * happens via the standard apiHelpers from any nested fetches.
 */

import { motion } from 'framer-motion';
import { Smartphone } from 'lucide-react';
import dynamic from 'next/dynamic';

const MobileCompanion = dynamic(
  () => import('@/components/world-lens/MobileCompanion'),
  { ssr: false },
);

export default function MobilePage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-cyan-950/10 text-slate-100">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="border-b border-cyan-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6"
      >
        <div className="mx-auto flex max-w-screen-md items-center gap-3">
          <div className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 p-2">
            <Smartphone className="h-5 w-5 text-cyan-400" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold tracking-tight sm:text-lg">Mobile Companion</h1>
            <p className="mt-0.5 hidden truncate text-xs text-slate-400 sm:block">
              Web-side responsive shell · Distinct from the native concord-mobile app
            </p>
          </div>
        </div>
      </motion.header>

      <section className="mx-auto max-w-screen-md px-3 py-4 sm:px-6 sm:py-5">
        <MobileCompanion />
      </section>
    </main>
  );
}
