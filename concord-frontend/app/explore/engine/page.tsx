'use client';

/**
 * /explore/engine — the knowledge-engine half of the split /explore fork.
 *
 * Deliberately carries ZERO combat/violence/18+ framing — that content
 * warning belongs to `/explore/world`, not here. See `/explore/page.tsx`'s
 * header comment for why this split exists.
 */

import Link from 'next/link';
import { Sparkles, ArrowRight, Brain, Coins, Shield, Cpu, FileText } from 'lucide-react';

const PILLARS = [
  { icon: Brain, title: 'DTUs — knowledge you actually own', body: 'Every thought, note, and insight is a structured, citable unit — not a chat log you can\'t search or reuse.' },
  { icon: Coins, title: 'Cite it, get paid, forever', body: 'When someone builds on your work, a perpetual royalty cascade pays you — depth-halving, capped, real money.' },
  { icon: Cpu, title: 'Real compute, not guessed answers', body: 'A symbolic CAS, structural FEA, orbital mechanics, double-entry accounting — the engine computes the answer instead of hallucinating it.' },
  { icon: Shield, title: 'No ads. No data extraction.', body: 'Free and local-first by default. Your knowledge substrate isn\'t the product being sold — you are never the product here.' },
];

export default function ExploreEnginePage() {
  return (
    <div className="min-h-screen bg-lattice-void text-white">
      <header className="flex items-center justify-between px-6 py-5 border-b border-lattice-border">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-neon-cyan to-neon-blue flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold">Concordos</span>
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/explore" className="text-gray-400 hover:text-white transition-colors">← Back</Link>
          <Link href="/login" className="text-gray-300 hover:text-white transition-colors">Sign in</Link>
          <Link href="/register" className="px-4 py-2 rounded-lg bg-gradient-to-r from-neon-cyan to-neon-blue text-white font-semibold hover:shadow-lg hover:shadow-neon-cyan/25 transition-all">
            Create free account
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="text-center mb-12">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-neon-cyan/10 border border-neon-cyan/20 text-neon-cyan text-xs font-semibold mb-5">
            <FileText className="w-3.5 h-3.5" /> A sovereign second brain
          </span>
          <h1 className="text-4xl md:text-6xl font-bold mb-5 leading-tight">
            <span className="text-white">Knowledge that</span>{' '}
            <span className="bg-gradient-to-r from-neon-cyan via-neon-blue to-neon-purple bg-clip-text text-transparent">compounds</span>
          </h1>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            Wolfram-grade compute, a citation economy that pays, and a knowledge substrate
            that&apos;s actually yours — no ads, no extraction, no subscription.
          </p>
        </div>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-16">
          {PILLARS.map((p) => (
            <div key={p.title} className="bg-lattice-surface border border-lattice-border rounded-xl p-5">
              <p.icon className="w-6 h-6 text-neon-cyan mb-3" />
              <h3 className="text-white font-semibold mb-1.5">{p.title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{p.body}</p>
            </div>
          ))}
        </section>

        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm font-semibold mb-16">
          <span className="px-4 py-2 rounded-lg bg-neon-cyan/10 border border-neon-cyan/20 text-neon-cyan text-center">No ads. Ever.</span>
          <span className="px-4 py-2 rounded-lg bg-neon-blue/10 border border-neon-blue/20 text-neon-blue text-center">No subscriptions.</span>
          <span className="px-4 py-2 rounded-lg bg-neon-purple/10 border border-neon-purple/20 text-neon-purple text-center">No data extraction.</span>
          <span className="px-4 py-2 rounded-lg bg-neon-green/10 border border-neon-green/20 text-neon-green text-center">You own every byte.</span>
        </section>

        <section className="text-center bg-gradient-to-b from-lattice-surface to-lattice-void border border-lattice-border rounded-2xl p-10">
          <Brain className="w-8 h-8 text-neon-cyan mx-auto mb-4" />
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">Ready to start?</h2>
          <p className="text-gray-400 mb-6 max-w-md mx-auto">
            Creating an account is free and takes a minute.
          </p>
          <Link href="/register" className="inline-flex items-center gap-2 px-7 py-3 rounded-lg bg-gradient-to-r from-neon-cyan to-neon-blue text-white font-semibold hover:shadow-lg hover:shadow-neon-cyan/25 transition-all">
            Create your free account <ArrowRight className="w-4 h-4" />
          </Link>
          <p className="mt-4 text-xs text-gray-500">
            Already have one? <Link href="/login" className="text-neon-cyan hover:underline">Sign in</Link>
            {' · '}
            <Link href="/explore/world" className="text-neon-cyan hover:underline">Curious about the world too?</Link>
          </p>
        </section>
      </main>
    </div>
  );
}
