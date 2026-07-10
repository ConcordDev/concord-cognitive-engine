'use client';

/**
 * News / Intelligence lens — flagship rebuild (research-tool identity).
 *
 * The page is intentionally thin: it registers the lens (nav + keyboard
 * commands, deep-link category) and mounts the bespoke <IntelDesk />, which
 * is the real app. The old generic-scaffold stack (ManifestActionBar +
 * AutoActionStrip + RecentMineCard + eight stacked parity components) is
 * retired — the desk surfaces the same backend surface as a designed
 * console instead of a wall of buttons.
 *
 * Capability map: docs/lens-specs/news-capability-map.md
 * All data is real — GDELT live feed, deterministic analysis engines, and
 * the DTU substrate. No fabricated headlines or sources anywhere.
 */

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { LensShell } from '@/components/lens/LensShell';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { IntelDesk } from '@/components/news/intel/IntelDesk';
import { NEWS_CATEGORIES, type NewsCategory } from '@/components/news/intel/intel-api';

function NewsLensInner() {
  useLensNav('news');
  const params = useSearchParams();

  // Deep-link support: /lenses/news?category=tech opens that live query.
  const initialCategory = useMemo<NewsCategory>(() => {
    const c = params.get('category');
    return (NEWS_CATEGORIES as readonly string[]).includes(c || '')
      ? (c as NewsCategory)
      : 'top';
  }, [params]);

  useLensCommand(
    [
      {
        id: 'news-scroll-top',
        keys: 'g',
        description: 'Scroll to top of feed',
        category: 'view',
        action: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
      },
    ],
    { lensId: 'news' },
  );

  return (
    <LensShell lensId="news" asMain={false}>
      <IntelDesk initialCategory={initialCategory} />
    </LensShell>
  );
}

export default function NewsLensPage() {
  return (
    <Suspense fallback={null}>
      <NewsLensInner />
    </Suspense>
  );
}
