/**
 * FE-019 + SEO Fix: Canonical entry point.
 *
 * Server Component that renders crawlable landing content.
 * The HomeClient component hydrates on top for interactivity.
 *
 * Crawlers see: full landing page HTML with all text content.
 * Users see: interactive LandingPage or Dashboard based on localStorage.
 */

import type { Metadata } from 'next';
import { HomeClient } from '@/components/home/HomeClient';

export const metadata: Metadata = {
  title: 'Concordos — Sovereign Cognitive Engine',
  description:
    'A sovereign knowledge operating system that grows with you. 259 domain lenses, DTU-based memory, lattice governance, local-first AI. No ads, no extraction, no surveillance.',
  alternates: {
    canonical: '/',
  },
};

/**
 * Server-rendered landing content for SEO.
 * This HTML is visible to crawlers even before JS loads.
 * The HomeClient component renders on top once hydrated.
 */
export default function HomePage() {
  return (
    <>
      {/* SSR landing content — visible to crawlers, replaced by client on hydrate */}
      <div id="ssr-landing" className="min-h-screen bg-lattice-void">
        <header className="flex items-center justify-between px-8 py-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-neon-cyan to-neon-blue flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <span className="text-2xl font-bold text-white">Concordos</span>
          </div>
        </header>

        <main className="px-8 pt-20 pb-32 max-w-6xl mx-auto">
          <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight text-center">
            <span className="text-white">Your Personal</span>
            <br />
            <span className="bg-gradient-to-r from-neon-cyan via-neon-blue to-neon-purple bg-clip-text text-transparent">
              Cognitive Engine
            </span>
          </h1>

          <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-8 text-center">
            A sovereign knowledge operating system that grows with you.
            Your thoughts never leave your control.
          </p>

          {/* Primary CTAs — let visitors experience it before committing. */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-12">
            <a href="/register" className="px-6 py-3 rounded-lg bg-gradient-to-r from-neon-cyan to-neon-blue text-white font-semibold text-center">
              Create your free account
            </a>
            <a href="/explore" className="px-6 py-3 rounded-lg border border-lattice-border text-gray-200 font-semibold hover:border-neon-cyan/50 transition-colors text-center">
              Look around first — no account needed
            </a>
          </div>

          {/* Trust Signal */}
          <div className="flex flex-col items-center gap-1.5 mb-12">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm font-semibold">
              <span className="px-4 py-2 rounded-lg bg-neon-cyan/10 border border-neon-cyan/20 text-neon-cyan text-center">No ads. Ever.</span>
              <span className="px-4 py-2 rounded-lg bg-neon-blue/10 border border-neon-blue/20 text-neon-blue text-center">No subscriptions.</span>
              <span className="px-4 py-2 rounded-lg bg-neon-purple/10 border border-neon-purple/20 text-neon-purple text-center">No data extraction.</span>
              <span className="px-4 py-2 rounded-lg bg-neon-green/10 border border-neon-green/20 text-neon-green text-center">Free for all services.</span>
            </div>
            <p className="text-xs text-gray-400 mt-2">Not a promise — it&apos;s architecture. The sovereignty lock makes it mathematically enforced.</p>
          </div>

          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-20">
            <div className="bg-lattice-surface border border-lattice-border rounded-xl p-6">
              <h3 className="text-lg font-semibold text-white mb-2">259 Domain Lenses</h3>
              <p className="text-gray-400 text-sm">
                Healthcare, education, legal, trades, manufacturing, creative arts, science, AI, and 250+ more specialized lenses.
              </p>
            </div>
            <div className="bg-lattice-surface border border-lattice-border rounded-xl p-6">
              <h3 className="text-lg font-semibold text-white mb-2">DTU-Based Memory</h3>
              <p className="text-gray-400 text-sm">
                Discrete Thought Units with epistemic scoring, lattice governance, and provenance tracking.
              </p>
            </div>
            <div className="bg-lattice-surface border border-lattice-border rounded-xl p-6">
              <h3 className="text-lg font-semibold text-white mb-2">Local-First AI</h3>
              <p className="text-gray-400 text-sm">
                Hybrid local/cloud AI pipeline. Works offline with Ollama, optionally enhances with cloud LLMs.
              </p>
            </div>
            <div className="bg-lattice-surface border border-lattice-border rounded-xl p-6">
              <h3 className="text-lg font-semibold text-white mb-2">Sovereign by Design</h3>
              <p className="text-gray-400 text-sm">
                70% sovereignty lock. No telemetry, no ads, no secret monitoring. You own every byte.
              </p>
            </div>
          </section>

          <section className="mt-20 max-w-3xl mx-auto">
            <h2 className="text-3xl font-bold text-white text-center mb-8">Architecture</h2>
            <dl className="space-y-4">
              <div className="bg-lattice-surface border border-lattice-border rounded-xl p-4">
                <dt className="font-semibold text-neon-cyan">Lattice Governance</dt>
                <dd className="text-gray-400 text-sm mt-1">
                  Chicken2 reality gates, council-based promotion, credibility-weighted voting, and anti-gaming protection.
                </dd>
              </div>
              <div className="bg-lattice-surface border border-lattice-border rounded-xl p-4">
                <dt className="font-semibold text-neon-blue">Macro-Max Engine</dt>
                <dd className="text-gray-400 text-sm mt-1">
                  All logic expressed as deterministic macros. Event-sourced, replayable, auditable.
                </dd>
              </div>
              <div className="bg-lattice-surface border border-lattice-border rounded-xl p-4">
                <dt className="font-semibold text-neon-purple">Epistemic Framework</dt>
                <dd className="text-gray-400 text-sm mt-1">
                  Domain-typed knowledge with formal, empirical, historical, interpretive, and model-based epistemic classes.
                </dd>
              </div>
              <div className="bg-lattice-surface border border-lattice-border rounded-xl p-4">
                <dt className="font-semibold text-neon-green">Grounded Recursive Closure</dt>
                <dd className="text-gray-400 text-sm mt-1">
                  GRC v1 output spec ensures all AI responses are lattice-anchored, reality-gated, and recursively deepening.
                </dd>
              </div>
            </dl>
          </section>
        </main>
      </div>

      {/* Client component takes over on hydration */}
      <HomeClient />
    </>
  );
}
