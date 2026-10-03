'use client';

/**
 * Fashion: north-star chrome over the Stylebook/Whering-parity digital closet
 * (real STATE-persisted `fashion.*` macros). The Met Museum costume archive and
 * the live fashion-community feed are both kept on screen below the closet.
 * See docs/lens-specs/fashion-capability-map.md.
 */

import { useCallback, useEffect, useState } from 'react';
import { Shirt } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FashionClosetSection, type FashionTabId } from '@/components/fashion/FashionClosetSection';
import { FashionFeed } from '@/components/fashion/FashionFeed';
import { DensityToggle } from '@/components/ui/DensityToggle';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { lensRun } from '@/lib/api/client';

export default function FashionLensPage() {
  useLensNav('fashion');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [tab, setTab] = useState<FashionTabId>('closet');
  const [exportSnapshot, setExportSnapshot] = useState<Record<string, unknown>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await lensRun('fashion', 'fashion-dashboard', {});
      if (!cancelled && r.data?.ok !== false) setExportSnapshot((r.data?.result as Record<string, unknown>) || {});
    })();
    return () => { cancelled = true; };
  }, []);

  const addPiece = useCallback(() => {
    setTab('closet');
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>('[data-lens-theme="fashion"] input:not([type="file"]), [data-lens-theme="fashion"] textarea');
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus();
    });
  }, []);

  useLensCommand(
    [
      { id: 'tab-closet', keys: 'c', description: 'Closet', category: 'navigation', action: () => setTab('closet') },
      { id: 'tab-outfits', keys: 'o', description: 'Outfits', category: 'navigation', action: () => setTab('outfits') },
      { id: 'tab-ai', keys: 'a', description: 'AI Stylist', category: 'navigation', action: () => setTab('ai') },
      { id: 'tab-calendar', keys: 'l', description: 'Calendar (wear log)', category: 'navigation', action: () => setTab('calendar') },
      { id: 'tab-plan', keys: 'p', description: 'Plan (packing & lookbooks)', category: 'navigation', action: () => setTab('plan') },
      { id: 'tab-social', keys: 'm', description: 'Community', category: 'navigation', action: () => setTab('social') },
      { id: 'add-piece', keys: 'n', description: 'Add a piece to the closet', category: 'actions', action: addPiece },
    ],
    { lensId: 'fashion' },
  );

  return (
    <LensShell lensId="fashion" asMain={false}>
      <FirstRunTour lensId="fashion" />
      <DepthBadge lensId="fashion" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="fashion"
        crumb="Fashion"
        title={`What you will wear next${who ? `, ${who}` : ''}`}
        subtitle="Digital closet, outfits, AI stylist, wear calendar, packing plans, community and resale."
        actions={
          <>
            <DensityToggle variant="dropdown" />
            <DTUExportButton domain="fashion" data={exportSnapshot} compact />
          </>
        }
        cta={{ label: 'Add a piece', icon: Shirt, onClick: addPiece, title: 'Add a piece (N)' }}
      >
        <FashionClosetSection activeTab={tab} onTabChange={setTab} />

        <section className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <LensFeedButton domain="fashion" label="Met Museum costume archive" />
          <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-100">Fashion community chatter (Reddit)</h2>
            <FashionFeed />
          </div>
        </section>
      </NorthStarFrame>
    </LensShell>
  );
}
