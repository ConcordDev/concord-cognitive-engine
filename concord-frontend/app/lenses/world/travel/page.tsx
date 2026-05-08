'use client';

/**
 * /lenses/world/travel — canonical world-travel terminal.
 *
 * Mounts the absorbed WorldTravel component with real data fetched
 * from /api/worlds. Click-to-travel calls /api/worlds/travel and
 * routes the user back to the world lens with the selected world
 * active.
 *
 * Distinct from AvatarSwitcher — that's avatar swap within the
 * current world. This is full world warp + invite/bookmark
 * management.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Train } from 'lucide-react';
import WorldTravel from '@/components/world-lens/WorldTravel';
import { api } from '@/lib/api/client';

type WorldEntry = NonNullable<Parameters<typeof WorldTravel>[0]['worlds']>[number];
type WorldInvite = NonNullable<Parameters<typeof WorldTravel>[0]['invites']>[number];

const BOOKMARKS_KEY = 'concord:world-bookmarks';

function loadBookmarkIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveBookmarkIds(ids: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage quota exceeded — silently degrade.
  }
}

export default function WorldTravelPage() {
  const router = useRouter();
  const [worlds, setWorlds] = useState<WorldEntry[]>([]);
  const [bookmarkIds, setBookmarkIds] = useState<Set<string>>(new Set());
  const [invites, setInvites] = useState<WorldInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBookmarkIds(loadBookmarkIds());

    let cancelled = false;
    Promise.all([
      api.get('/api/worlds').then((r) => r.data).catch(() => ({ worlds: [] })),
      api.get('/api/worlds/invites').then((r) => r.data).catch(() => ({ invites: [] })),
    ])
      .then(([worldsRes, invitesRes]: [unknown, unknown]) => {
        if (cancelled) return;
        const w = (worldsRes as { worlds?: WorldEntry[] }).worlds ?? [];
        const inv = (invitesRes as { invites?: WorldInvite[] }).invites ?? [];
        setWorlds(w);
        setInvites(inv);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'failed to load');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleTravel = useCallback(
    async (worldId: string) => {
      try {
        await api.post('/api/worlds/travel', { worldId });
        // Hint the world lens to pick up the new active world via
        // localStorage so the redirect lands on the right scene.
        if (typeof window !== 'undefined') {
          localStorage.setItem('concordia:activeWorldId', worldId);
        }
        router.push('/lenses/world');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'travel failed');
      }
    },
    [router],
  );

  const handleBookmark = useCallback((worldId: string) => {
    setBookmarkIds((prev) => {
      const next = new Set(prev);
      if (next.has(worldId)) next.delete(worldId);
      else next.add(worldId);
      saveBookmarkIds(next);
      return next;
    });
  }, []);

  const handleAcceptInvite = useCallback(
    async (inviteId: string) => {
      const inv = invites.find((i) => i.id === inviteId);
      if (!inv) return;
      try {
        await api.post(`/api/worlds/invites/${inviteId}/accept`);
        setInvites((prev) => prev.filter((i) => i.id !== inviteId));
        await handleTravel(inv.worldId);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'accept failed');
      }
    },
    [invites, handleTravel],
  );

  const handleDeclineInvite = useCallback(async (inviteId: string) => {
    try {
      await api.post(`/api/worlds/invites/${inviteId}/decline`);
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
    } catch {
      // Optimistic remove on failure too — user-initiated decline.
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
    }
  }, []);

  const bookmarkedWorlds = worlds.filter((w) => bookmarkIds.has(w.id));

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-cyan-950/10 text-slate-100">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="border-b border-cyan-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6"
      >
        <div className="mx-auto flex max-w-screen-md items-center gap-3">
          <div className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 p-2">
            <Train className="h-5 w-5 text-cyan-400" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold tracking-tight sm:text-lg">World Terminal</h1>
            <p className="mt-0.5 hidden truncate text-xs text-slate-400 sm:block">
              Travel between worlds · Bookmarks · Invites
            </p>
          </div>
        </div>
      </motion.header>

      <section className="mx-auto max-w-screen-md px-3 py-4 sm:px-6 sm:py-5">
        {loading ? (
          <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/40 p-6 text-center text-sm text-slate-400">
            Loading worlds…
          </div>
        ) : error ? (
          <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-4 text-sm text-rose-200">
            {error}
          </div>
        ) : (
          <WorldTravel
            worlds={worlds}
            bookmarks={bookmarkedWorlds}
            recentWorlds={[]}
            invites={invites}
            onTravel={handleTravel}
            onBookmark={handleBookmark}
            onAcceptInvite={handleAcceptInvite}
            onDeclineInvite={handleDeclineInvite}
          />
        )}
      </section>
    </main>
  );
}
