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
import { DepthBadge } from '@/components/lens/DepthBadge';
import { WeldingFeed } from '@/components/welding/WeldingFeed';
import { omitCommunityRedditViews } from '@/lib/community/reddit-flag';
import { CommunityRedditSlot } from '@/lib/community/CommunityRedditSlot';
import { WelderProcedures } from '@/components/welding/WelderProcedures';
import { WeldingOperations } from '@/components/welding/WeldingOperations';
import { useLensCommand } from '@/hooks/useLensCommand';

type WeldingView = 'shop' | 'calculators' | 'community';

const VIEWS: { id: WeldingView; label: string; keys: string; hint: string; icon: typeof Wrench }[] = [
  { id: 'shop', label: 'Shop', keys: '1', hint: 'Schedule, quotes, invoices, WPS, certs, photos and codes', icon: Wrench },
  { id: 'calculators', label: 'Calculators', keys: '2', hint: 'Joint strength, rod selection, heat input and inspection', icon: Calculator },
  { id: 'community', label: 'Community', keys: '3', hint: 'Live welding community chatter', icon: MessageSquare },
];

export default function WeldingLensPage() {
  const [view, setView] = useState<WeldingView>('shop');

  const navViews = omitCommunityRedditViews(VIEWS, ['community']);
  useLensCommand(
    navViews.map((v) => ({
      id: `welding-${v.id}`,
      keys: v.keys,
      description: `${v.label}: ${v.hint}`,
      category: 'navigation' as const,
      action: () => setView(v.id),
    })),
    { lensId: 'welding' },
  );


  return (
    <LensShell lensId="welding" asMain={false}>

      <DepthBadge lensId="welding" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="welding"
        crumb="Welding"
        subtitle="Field-service operations, welding-engineering calculators, WPS and certification tracking, and real-world welding chatter."
        tabs={navViews.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys, hint: v.hint }))}
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
            <CommunityRedditSlot>
              <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
                <WeldingFeed />
              </section>
            </CommunityRedditSlot>
          )}
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
