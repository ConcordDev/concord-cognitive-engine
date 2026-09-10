'use client';

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { PlumbingFeed } from '@/components/plumbing/PlumbingFeed';
import { PlumbCalc } from '@/components/plumbing/PlumbCalc';
import { FieldServiceConsole } from '@/components/plumbing/FieldServiceConsole';
import { useLensCommand } from '@/hooks/useLensCommand';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { Droplets, Calendar, Calculator, Newspaper } from 'lucide-react';
import { LensPageShell } from '@/components/lens/LensPageShell';

type PageTab = 'operations' | 'calculators' | 'feed';

const PAGE_TABS: { id: PageTab; label: string; icon: typeof Calendar }[] = [
  { id: 'operations', label: 'Field Service', icon: Calendar },
  { id: 'calculators', label: 'Trade Calculators', icon: Calculator },
  { id: 'feed', label: 'Industry Feed', icon: Newspaper },
];

/**
 * Plumbing lens page.
 *
 * The whole surface is built on the 29 real `server/domains/plumbing.js`
 * macros — there is no parallel generic-artifact CRUD layer here. Three
 * real, bespoke sections:
 *   - Field Service (FieldServiceConsole): dispatch board, price book,
 *     quote→invoice, tech mobile workflow, maintenance plans, customer
 *     notifications, parts inventory — every value is a live macro call.
 *   - Trade Calculators (PlumbCalc): pipe sizing, water heater sizing,
 *     drain slope, fixture-unit supply sizing — IPC/UPC-grounded engine
 *     calls, not client-side arithmetic.
 *   - Industry Feed (PlumbingFeed): live r/Plumbing-family Reddit chatter.
 *
 * A prior revision of this page carried a second, fabricated multi-tab
 * CRUD dashboard (Jobs / Estimates / Codes / Materials / CRM / Invoices /
 * Inspections / Certs / Map) built on the generic `useLensData` artifact
 * store. It duplicated the real Dispatch and Quote→Invoice sections above
 * with an unsynced parallel copy, and the remaining tabs (code reference
 * library, formal CRM, inspections, certifications, geocoded job map) had
 * no backing macro at all — see `docs/lens-specs/plumbing-capability-map.md`
 * for the audit and the honest disposition of each removed tab.
 */
export default function PlumbingLensPage() {
  const [tab, setTab] = useState<PageTab>('operations');

  useLensCommand(
    [
      {
        id: 'tab-operations',
        keys: '1',
        description: 'Go to Field Service',
        category: 'navigation',
        action: () => setTab('operations'),
      },
      {
        id: 'tab-calculators',
        keys: '2',
        description: 'Go to Trade Calculators',
        category: 'navigation',
        action: () => setTab('calculators'),
      },
      {
        id: 'tab-feed',
        keys: '3',
        description: 'Go to Industry Feed',
        category: 'navigation',
        action: () => setTab('feed'),
      },
    ],
    { lensId: 'plumbing' }
  );

  return (
    <LensShell lensId="plumbing" asMain={false}>
      <FirstRunTour lensId="plumbing" />      <DepthBadge lensId="plumbing" size="sm" className="ml-2" />
      <LensPageShell
        domain="plumbing"
        title="Plumbing"
        description="Dispatch, estimating, quote-to-invoice, tech workflow, maintenance plans, and IPC/UPC trade calculators"
        headerIcon={<Droplets className="w-6 h-6" />}
      >
        <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">
          {PAGE_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap',
                tab === t.id
                  ? 'bg-neon-blue/20 text-neon-blue'
                  : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
              )}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'operations' && (
          <div className={cn(ds.panel, 'p-4')}>
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-neon-cyan" /> Field Service Operations
            </h3>
            <FieldServiceConsole />
          </div>
        )}

        {tab === 'calculators' && (
          <div>
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Calculator className="w-4 h-4 text-neon-cyan" /> Trade Calculators
            </h3>
            <PlumbCalc />
          </div>
        )}

        {tab === 'feed' && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <PlumbingFeed />
          </div>
        )}
      </LensPageShell>

      <a href="#plumbing-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to plumbing content</a>      <CrossLensRecentsPanel lensId="plumbing" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
