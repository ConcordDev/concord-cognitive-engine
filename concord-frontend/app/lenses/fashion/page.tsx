'use client';

import { useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { FashionClosetSection, type FashionTabId } from '@/components/fashion/FashionClosetSection';
import { FashionFeed } from '@/components/fashion/FashionFeed';
import { DensityToggle } from '@/components/ui/DensityToggle';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { lensRun } from '@/lib/api/client';
import { Shirt, ChevronDown, ChevronRight } from 'lucide-react';

/**
 * Fashion lens — Stylebook/Whering-parity digital closet.
 *
 * The real product surface is `FashionClosetSection` (closet, outfits, AI
 * stylist, style quiz, calendar, plan, capsule, community, resale, trends —
 * all backed by real STATE-persisted `fashion.*` macros). This page is thin
 * chrome around it: lens registration, first-run tour, honest data-tier
 * badge, DTU export, keyboard tab-switching, and two distinct real external
 * feeds below the fold (Met Museum costume archive + live fashion-community
 * discussion). See docs/lens-specs/fashion-capability-map.md for the full
 * macro/parity audit behind this rebuild.
 */
export default function FashionLensPage() {
  useLensNav('fashion');
  const [tab, setTab] = useState<FashionTabId>('closet');
  const [exportSnapshot, setExportSnapshot] = useState<Record<string, unknown>>({});
  const [showFeed, setShowFeed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await lensRun('fashion', 'fashion-dashboard', {});
      if (!cancelled && r.data?.ok !== false) setExportSnapshot((r.data?.result as Record<string, unknown>) || {});
    })();
    return () => { cancelled = true; };
  }, []);

  useLensCommand(
    [
      { id: 'tab-closet', keys: 'c', description: 'Closet', category: 'navigation', action: () => setTab('closet') },
      { id: 'tab-outfits', keys: 'o', description: 'Outfits', category: 'navigation', action: () => setTab('outfits') },
      { id: 'tab-ai', keys: 'a', description: 'AI Stylist', category: 'navigation', action: () => setTab('ai') },
      { id: 'tab-calendar', keys: 'l', description: 'Calendar (wear log)', category: 'navigation', action: () => setTab('calendar') },
      { id: 'tab-plan', keys: 'p', description: 'Plan (packing & lookbooks)', category: 'navigation', action: () => setTab('plan') },
      { id: 'tab-social', keys: 'm', description: 'Community', category: 'navigation', action: () => setTab('social') },
    ],
    { lensId: 'fashion' }
  );

  return (
    <LensShell lensId="fashion" asMain={false}>
      <FirstRunTour lensId="fashion" />
      <div data-lens-theme="fashion" className="p-6 space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-500/30 to-pink-500/30 border border-fuchsia-500/20 flex items-center justify-center">
              <Shirt className="w-5 h-5 text-fuchsia-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-zinc-100">Fashion</h1>
              <p className="text-sm text-zinc-400">Digital closet, outfits, and style planning</p>
            </div>
            <DepthBadge lensId="fashion" size="sm" />
          </div>
          <div className="flex items-center gap-2">
            <DensityToggle variant="dropdown" />
            <DTUExportButton domain="fashion" data={exportSnapshot} compact />
          </div>
        </header>

        <FashionClosetSection activeTab={tab} onTabChange={setTab} />

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <LensFeedButton domain="fashion" label="Met Museum costume archive" />
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <button
              type="button"
              onClick={() => setShowFeed(v => !v)}
              className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
            >
              <span>Fashion community chatter (Reddit)</span>
              {showFeed ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            {showFeed && (
              <div className="mt-3">
                <FashionFeed />
              </div>
            )}
          </div>
        </section>
      </div>
    </LensShell>
  );
}
