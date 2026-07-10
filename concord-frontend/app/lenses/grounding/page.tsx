'use client';

/**
 * Grounding lens — rebuild (Frontend Rebuild Program, Wave 2,
 * Reflection/knowledge-curation archetype). See
 * docs/lens-specs/grounding-capability-map.md for the full researched
 * checklist, disposition of every backend macro, and the two-systems
 * finding this rebuild resolved.
 *
 * TWO DISTINCT REAL BACKEND SYSTEMS share the `grounding` domain name —
 * this page keeps them as two clearly separated destinations instead of
 * conflating them under one misleading "Fact Verification" umbrella (the
 * bug the previous version of this page had):
 *
 *  1. "Fact-Check Workbench" — the Ground News-parity substrate
 *     (server/domains/grounding.js): stateless claim/source/decomposition
 *     analysis + a STATE-backed multi-source evidence aggregator, bias
 *     labeling, calibrated confidence rating, audit trail, trending-claims
 *     discovery, shareable cards, and rebuttal linking.
 *  2. "Reality Anchor" — an unrelated, separately-registered embodied
 *     "reality anchoring" system (server/server.js ~line 13449,
 *     `ensureGroundingEngine`): a manual sensor journal, DTU-to-real-world
 *     grounding, calendar linking, and a consent-gated action-proposal /
 *     approval workflow. Reached over flat `/api/grounding/*` REST routes,
 *     not the generic `/api/lens/run` macro dispatcher the fact-check
 *     system uses.
 *
 * The previous page rendered six "Source Verification Status Cards" with
 * hardcoded confidence numbers (97/94/88/91/93/…) and hardcoded
 * "Last check: 30s ago"-style freshness claims — literal values in the JSX,
 * not derived from any query or timestamp. That was a textbook fabricated
 * success-state violation (CLAUDE.md "honest by construction"). It has been
 * removed entirely; every number on this page now traces to a live macro
 * response. See the capability-map doc for the full writeup.
 */

import { useState } from 'react';
import { ShieldCheck, Antenna, Radio } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';
import { ClaimVerificationPanel } from '@/components/grounding/ClaimVerificationPanel';
import { FactGroundingWorkbench } from '@/components/grounding/FactGroundingWorkbench';
import { SensorGroundingPanel } from '@/components/grounding/SensorGroundingPanel';
import { MindfulnessFeed } from '@/components/grounding/MindfulnessFeed';

type Destination = 'factcheck' | 'sensors' | 'pulse';

const DESTINATIONS: { id: Destination; label: string; icon: typeof ShieldCheck; desc: string }[] = [
  { id: 'factcheck', label: 'Fact-Check Workbench', icon: ShieldCheck, desc: 'Evidence aggregation · bias · confidence · audit trail · trending · cards' },
  { id: 'sensors', label: 'Reality Anchor', icon: Antenna, desc: 'Sensors · readings · DTU grounding · calendar · consent-gated actions' },
  { id: 'pulse', label: 'Real-World Pulse', icon: Radio, desc: 'Live r/Mindfulness / r/Stoicism / r/somatics chatter' },
];

export default function GroundingLensPage() {
  useLensNav('grounding');
  const [dest, setDest] = useState<Destination>('factcheck');

  useLensCommand(
    [
      { id: 'goto-factcheck', keys: 'g f', description: 'Go to Fact-Check Workbench', category: 'navigation', action: () => setDest('factcheck') },
      { id: 'goto-sensors', keys: 'g s', description: 'Go to Reality Anchor', category: 'navigation', action: () => setDest('sensors') },
      { id: 'goto-pulse', keys: 'g p', description: 'Go to Real-World Pulse', category: 'navigation', action: () => setDest('pulse') },
    ],
    { lensId: 'grounding' }
  );

  return (
    <LensShell lensId="grounding" asMain={false}>
      <FirstRunTour lensId="grounding" />
      <div data-lens-theme="grounding" className="p-6 space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden="true">🌍</span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-white">Grounding</h1>
                <DepthBadge lensId="grounding" size="sm" />
              </div>
              <p className="text-sm text-gray-400">
                Two real substrates: claim/fact verification, and embodied real-world sensor anchoring.
              </p>
            </div>
          </div>
        </header>

        <nav className="flex flex-wrap items-center gap-2 border-b border-lattice-border pb-3" aria-label="Grounding destinations">
          {DESTINATIONS.map((d) => {
            const Icon = d.icon;
            const active = dest === d.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setDest(d.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors border ${
                  active
                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                    : 'bg-zinc-900/40 text-zinc-400 border-zinc-800 hover:text-zinc-200 hover:border-zinc-700'
                }`}
                title={d.desc}
              >
                <Icon className="w-4 h-4" />
                {d.label}
              </button>
            );
          })}
        </nav>

        {dest === 'factcheck' && (
          <div className="space-y-6">
            <ClaimVerificationPanel />
            <FactGroundingWorkbench />
          </div>
        )}

        {dest === 'sensors' && <SensorGroundingPanel />}

        {dest === 'pulse' && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <MindfulnessFeed />
          </div>
        )}

        <ConnectiveTissueBar lensId="grounding" />
      </div>
    </LensShell>
  );
}
