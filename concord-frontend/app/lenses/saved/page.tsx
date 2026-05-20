'use client';

/**
 * /lenses/saved — Bookmarks lens.
 *
 * Renders every post the current user has saved via BookmarkButton.
 * Single surface, no fake data: empty state when nothing's saved,
 * "Post unavailable" placeholder for deleted posts with a one-click
 * Remove path.
 */

import { useQuery } from '@tanstack/react-query';
import { Bookmark } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { LensSubstratePanel } from '@/components/lens/LensSubstratePanel';
import { BookmarksList } from '@/components/social/BookmarksList';
import { api } from '@/lib/api/client';
import Link from 'next/link';

interface MeResponse { ok: boolean; user?: { id: string; username?: string }; }

export default function SavedLensPage() {
  const { data: me } = useQuery<MeResponse | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try { const r = await api.get<MeResponse>('/api/auth/me'); return r?.data; }
      catch { return null; }
    },
    staleTime: 60 * 1000,
  });

  return (
    <LensShell lensId="saved" asMain={false}>
      <FirstRunTour lensId="saved" />
      <ManifestActionBar />
      <DepthBadge lensId="saved" size="sm" className="ml-2" />

      <div className="min-h-screen bg-lattice-void text-zinc-100">
        <header className="border-b border-zinc-800 bg-zinc-950/70">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
            <Bookmark className="w-5 h-5 text-amber-300" />
            <h1 className="text-base font-semibold">Saved</h1>
            <span className="text-[10px] text-zinc-500 font-mono">your bookmarks</span>
            <Link
              href="/lenses/social"
              className="ml-auto text-xs text-indigo-400 hover:underline"
            >
              ← Back to Social
            </Link>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-4 py-4 space-y-4">
          <BookmarksList currentUserId={me?.user?.id} />
          <LensSubstratePanel domain="saved" noun="saved item" />
          <CrossLensRecentsPanel lensId="saved" sinceDays={30} limit={6} hideWhenEmpty />
        </main>
      </div>
    </LensShell>
  );
}
