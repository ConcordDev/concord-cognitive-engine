'use client';

/**
 * The Codex — authored cosmology reader.
 * Thin shell + one `active` union; panels own lore.* macros + bookmarks.
 */

import { LensShell } from '@/components/lens/LensShell';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { lensRun } from '@/lib/api/client';
import { useLensCommand } from '@/hooks/useLensCommand';
import { DeepLinkModal } from '@/components/codex/DeepLinkModal';
import { SpinePanel } from '@/components/codex/SpinePanel';
import { BrowsePanel } from '@/components/codex/BrowsePanel';
import { COLORS, type Facets, type LoreEvent } from '@/components/codex/types';
import { cn } from '@/lib/utils';

type CodexView = 'spine' | 'browse';

const TABS: { id: CodexView; label: string }[] = [
  { id: 'spine', label: 'The Pillars' },
  { id: 'browse', label: 'Browse canon' },
];

function CodexLensInner() {
  const searchParams = useSearchParams();
  const deepLinkId = searchParams.get('id');
  const [active, setActive] = useState<CodexView>('browse');
  const [facets, setFacets] = useState<Facets | null>(null);
  const [spine, setSpine] = useState<LoreEvent[]>([]);

  useLensCommand(
    [
      { id: 'codex-spine', keys: 'p', description: 'The Three Pillars', category: 'navigation', action: () => setActive('spine') },
      { id: 'codex-browse', keys: 'b', description: 'Browse canon', category: 'navigation', action: () => setActive('browse') },
    ],
    { lensId: 'codex' },
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const f = await lensRun('lore', 'facets', {});
      if (cancelled) return;
      if (f.data?.ok && f.data.result) setFacets((f.data.result as { facets: Facets }).facets);
      const s = await lensRun('lore', 'spine', {});
      if (cancelled) return;
      if (s.data?.ok && s.data.result) setSpine((s.data.result as { events: LoreEvent[] }).events || []);
    })();
    return () => { cancelled = true; };
  }, []);

  const onFacets = useCallback((f: Facets) => setFacets(f), []);

  return (
    <LensShell lensId="codex">
      <div className="w-full max-w-[980px] mx-auto px-4 sm:px-6 py-6" style={{ color: COLORS.fg }}>
        {deepLinkId && <DeepLinkModal deepLinkId={deepLinkId} />}

        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>The Codex</h1>
        <p style={{ opacity: 0.7, marginBottom: 16 }}>
          The canon of Concordia — {facets?.count ?? '…'} recorded truths across {facets?.worlds.length ?? '…'} worlds.
        </p>

        <nav aria-label="Codex views" className="flex gap-1 mb-4 border-b border-[#2a2a35] pb-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-mono transition-colors',
                active === t.id
                  ? 'bg-violet-500/15 text-violet-300 border border-violet-500/20'
                  : 'text-gray-400 hover:text-white border border-transparent',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {active === 'spine' && <SpinePanel spine={spine} />}
        {active === 'browse' && <BrowsePanel facets={facets} onFacets={onFacets} />}
      </div>
    </LensShell>
  );
}

export default function CodexLensPage() {
  return (
    <Suspense fallback={null}>
      <CodexLensInner />
    </Suspense>
  );
}
