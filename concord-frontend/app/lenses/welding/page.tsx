'use client';

/**
 * Welding lens: the north-star look over three views, each a real workbench.
 *   - Shop: WeldingOperations (Jobber/ServiceTitan-parity console: schedule,
 *     quotes, invoices, WPS, certs, photos, codes) on the `welding.*` macros.
 *   - Calculators: WelderProcedures (joint strength, rod selection, heat
 *     input, inspection checklist) on `welding.jointStrength` / `rodSelection`
 *     / `heatInput` / `inspectionChecklist`.
 *   - Community: WeldingFeed (live Reddit welding chatter).
 */

import { useState } from 'react';
import { Calculator, MessageSquare, Wrench } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { WeldingFeed } from '@/components/welding/WeldingFeed';
import { WelderProcedures } from '@/components/welding/WelderProcedures';
import { WeldingOperations } from '@/components/welding/WeldingOperations';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type WeldingView = 'shop' | 'calculators' | 'community';

const VIEWS: { id: WeldingView; label: string; keys: string; title: string; hint: string; icon: typeof Wrench }[] = [
  { id: 'shop', label: 'Shop', keys: '1', title: 'Run the shop', hint: 'Schedule, quotes, invoices, WPS, certs, photos and codes', icon: Wrench },
  { id: 'calculators', label: 'Calculators', keys: '2', title: 'Get the procedure right', hint: 'Joint strength, rod selection, heat input and inspection', icon: Calculator },
  { id: 'community', label: 'Community', keys: '3', title: 'What welders are talking about', hint: 'Live welding community chatter', icon: MessageSquare },
];

export default function WeldingLensPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<WeldingView>('shop');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `welding-${v.id}`,
      keys: v.keys,
      description: `${v.label}: ${v.hint}`,
      category: 'navigation' as const,
      action: () => setView(v.id),
    })),
    { lensId: 'welding' },
  );

  const current = VIEWS.find((v) => v.id === view)!;

  return (
    <LensShell lensId="welding" asMain={false}>
      <FirstRunTour lensId="welding" />
      <DepthBadge lensId="welding" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="welding"
        crumb="Welding"
        title={`${current.title}${view === 'shop' && who ? `, ${who}` : ''}`}
        subtitle="Field-service operations, welding-engineering calculators, WPS and certification tracking, and real-world welding chatter."
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys, hint: v.hint }))}
        activeTab={view}
        onTab={(id) => setView(id as WeldingView)}
        tabsLabel="Welding views"
        cta={{ label: 'Open calculators', icon: Calculator, onClick: () => setView('calculators'), title: 'Joint strength, rod selection, heat input, inspection' }}
      >
        <div id="welding-skip">
          {view === 'shop' && (
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <WeldingOperations />
            </section>
          )}
          {view === 'calculators' && <WelderProcedures />}
          {view === 'community' && (
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <WeldingFeed />
            </section>
          )}
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
