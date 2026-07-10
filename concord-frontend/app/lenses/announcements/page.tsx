'use client';

/**
 * /lenses/announcements — operator announcements + roadmap.
 *
 * CAPABILITY MAP (server/domains/announcements.js, 3 macros total — the
 * domain's entire surface, mirrored 1:1 by REST):
 *   - announcements.list  == GET  /api/announcements        — DESIGNED (this feed).
 *   - announcements.get   == (macro only, no REST GET/:id)  — DESIGNED (deep-link
 *     fallback below: an `?id=` link to an announcement older than the fetched
 *     window resolves via this macro instead of failing silently).
 *   - announcements.post  == POST /api/announcements        — was UNSURFACED
 *     anywhere in the app before this rebuild; now the Compose panel below.
 *     Admin-gated server-side (`ctx.actor.role !== 'admin'` -> `admin_only`).
 *     Deliberately NOT pre-gated client-side with a separate `/api/auth/me`
 *     probe (the "attempt, then degrade honestly" convention this codebase
 *     already uses for admin actions — see `AdminRequiredState` usages —
 *     rather than a redundant network round-trip before every page paint):
 *     Compose is always offered; a non-admin's publish attempt gets the
 *     real backend rejection reason surfaced in the form, never a fabricated
 *     success and never a silently-hidden feature.
 * Not world-owned: `components/concordia/world/LegendaryAnnouncement.tsx` is an
 * unrelated in-world toast for legendary skill achievements (different event,
 * different substrate) — confirmed by reading it, not assumed from the name.
 *
 * Realtime: the `announcement-broadcaster` heartbeat emits `concord:announcement`
 * on every new publish; this page listens and refetches. Four honest UX states:
 * loading / error (retry) / empty / populated, plus an honest not-found state
 * for a stale/expired deep link.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Megaphone, PenSquare, RefreshCcw, Info } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { EmptyState, ErrorState, Skeleton, StatusDot, type StatusDotState } from '@/components/ui';
import { subscribe } from '@/lib/realtime/socket';
import { lensRun } from '@/lib/api/client';
import { AnnouncementCard } from '@/components/announcements/AnnouncementCard';
import { RoadmapRail } from '@/components/announcements/RoadmapRail';
import { ComposePanel } from '@/components/announcements/ComposePanel';
import { KIND_META } from '@/components/announcements/kind-meta';
import { VALID_KINDS, type Announcement, type AnnouncementKind } from '@/components/announcements/types';

type LoadState = 'loading' | 'error' | 'ready';
type FilterKind = 'all' | AnnouncementKind;

const LOAD_STATE_TO_DOT: Record<LoadState, StatusDotState> = {
  loading: 'connecting',
  error: 'error',
  ready: 'live',
};

function readDeepLinkId(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('id');
}

export default function AnnouncementsLensPage() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [filter, setFilter] = useState<FilterKind>('all');
  const [state, setState] = useState<LoadState>('loading');
  const [composeOpen, setComposeOpen] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Deep-link (`?id=`) resolution: found-in-window, resolved-via-macro-fallback,
  // or honestly not found. Never fabricated.
  const [deepLinkId] = useState<string | null>(readDeepLinkId);
  const [deepLinkItem, setDeepLinkItem] = useState<Announcement | null>(null);
  const [deepLinkNotFound, setDeepLinkNotFound] = useState(false);
  const deepLinkResolved = useRef(false);

  const refresh = useCallback(() => {
    setState((s) => (s === 'ready' ? 'ready' : 'loading'));
    fetch('/api/announcements?limit=200')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!d?.ok) throw new Error(d?.error || d?.reason || 'bad_response');
        setItems(Array.isArray(d.announcements) ? d.announcements : []);
        setState('ready');
      })
      .catch(() => { setState('error'); });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const off = subscribe('concord:announcement', () => { refresh(); });
    return () => off?.();
  }, [refresh]);

  // Resolve a deep link once the first fetch has landed: prefer the row already
  // in the fetched window; fall back to the real `announcements.get` macro for
  // an older/expired-adjacent id that fell outside the 200-row window.
  useEffect(() => {
    if (!deepLinkId || state !== 'ready' || deepLinkResolved.current) return;
    const inWindow = items.find((a) => a.id === deepLinkId);
    if (inWindow) {
      deepLinkResolved.current = true;
      setHighlightId(deepLinkId);
      requestAnimationFrame(() => {
        document.getElementById(`announcement-${deepLinkId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return;
    }
    deepLinkResolved.current = true;
    lensRun<{ ok: boolean; announcement?: Announcement }>('announcements', 'get', { id: deepLinkId })
      .then((r) => {
        if (r.data.ok && r.data.result?.announcement) {
          setDeepLinkItem(r.data.result.announcement);
        } else {
          setDeepLinkNotFound(true);
        }
      })
      .catch(() => setDeepLinkNotFound(true));
  }, [deepLinkId, state, items]);

  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlightId(null), 4000);
    return () => clearTimeout(t);
  }, [highlightId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const handleCopyLink = useCallback(async (id: string) => {
    const url = `${window.location.origin}${window.location.pathname}?id=${encodeURIComponent(id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1600);
    } catch {
      setToast({ kind: 'error', text: "Couldn't copy — copy the link from the address bar instead." });
    }
  }, []);

  const handlePublished = useCallback((id: string) => {
    setComposeOpen(false);
    setToast({ kind: 'success', text: 'Announcement published.' });
    setHighlightId(id);
    refresh();
  }, [refresh]);

  const filteredItems = useMemo(
    () => (filter === 'all' ? items : items.filter((a) => a.kind === filter)),
    [items, filter],
  );
  const roadmapItems = useMemo(() => items.filter((a) => a.kind === 'roadmap').slice(0, 5), [items]);
  const kindCounts = useMemo(() => {
    const counts: Partial<Record<AnnouncementKind, number>> = {};
    for (const a of items) counts[a.kind] = (counts[a.kind] || 0) + 1;
    return counts;
  }, [items]);

  return (
    <LensShell lensId="announcements" asMain={false}>
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-violet-950/10 text-slate-100">
        <header className="border-b border-violet-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <div className="rounded-lg border border-violet-500/40 bg-violet-500/10 p-2">
              <Megaphone className="h-5 w-5 text-violet-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Announcements</h1>
              <p className="mt-0.5 truncate text-xs text-slate-400">What&apos;s shipped, what&apos;s coming.</p>
            </div>
            {/* Only rendered once past the initial load: avoids a second, redundant
                role="status" region competing with the loading placeholder's own
                (single) live region below. */}
            {state !== 'loading' && <StatusDot state={LOAD_STATE_TO_DOT[state]} size="sm" />}
            <button
              onClick={() => setComposeOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-2.5 py-1.5 text-xs text-violet-200 hover:bg-violet-500/20"
            >
              <PenSquare className="h-3.5 w-3.5" aria-hidden="true" />
              Compose
            </button>
            <button onClick={refresh} aria-label="Refresh announcements"
              className="rounded-full border border-violet-500/30 bg-violet-500/10 p-1.5 text-violet-300 hover:bg-violet-500/20">
              <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </header>

        {toast && (
          <div
            role="status"
            aria-live="polite"
            className={`mx-auto mt-3 max-w-screen-2xl px-4 sm:px-6 text-[12px] ${toast.kind === 'success' ? 'text-emerald-300' : 'text-red-300'}`}
          >
            {toast.text}
          </div>
        )}

        <section className="mx-auto max-w-screen-2xl px-4 py-5 sm:px-6">
          <div className="mb-3 flex flex-wrap gap-1 text-xs" role="tablist" aria-label="Filter by kind">
            <button role="tab" aria-selected={filter === 'all'} onClick={() => setFilter('all')}
              className={`rounded px-2 py-1 ${filter === 'all' ? 'bg-violet-500/30 text-violet-100' : 'text-slate-400 hover:text-slate-200'}`}>
              all{items.length > 0 ? ` (${items.length})` : ''}
            </button>
            {VALID_KINDS.map((k) => {
              const meta = KIND_META[k];
              const count = kindCounts[k] || 0;
              return (
                <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
                  className={`rounded px-2 py-1 ${filter === k ? 'bg-violet-500/30 text-violet-100' : 'text-slate-400 hover:text-slate-200'}`}>
                  {meta.label}{count > 0 ? ` (${count})` : ''}
                </button>
              );
            })}
          </div>

          {(deepLinkItem || deepLinkNotFound) && (
            <div className="mb-4 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] text-violet-300">
                <Info size={12} aria-hidden="true" />
                {deepLinkItem ? 'Linked announcement (outside the current window)' : "Linked announcement wasn't found — it may have expired."}
              </p>
              {deepLinkItem && (
                <ol>
                  <AnnouncementCard announcement={deepLinkItem} highlighted onCopyLink={handleCopyLink} copied={copiedId === deepLinkItem.id} />
                </ol>
              )}
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="min-w-0">
              {state === 'loading' ? (
                <div role="status" aria-live="polite" aria-busy="true" className="py-2">
                  <span className="sr-only">Loading announcements…</span>
                  <div aria-hidden="true" className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} variant="block" height="4.5rem" className="rounded-xl" />
                    ))}
                  </div>
                </div>
              ) : state === 'error' ? (
                <ErrorState message="Couldn't load announcements." onRetry={refresh} />
              ) : filteredItems.length === 0 ? (
                <EmptyState
                  icon={<Megaphone className="h-5 w-5" aria-hidden="true" />}
                  title={filter === 'all' ? 'No announcements yet.' : `No ${KIND_META[filter].label.toLowerCase()} announcements yet.`}
                  description="Feature drops, balance changes, events, news, and roadmap items show up here as they're published."
                />
              ) : (
                <ol className="space-y-3">
                  {filteredItems.map((a) => (
                    <AnnouncementCard
                      key={a.id}
                      announcement={a}
                      highlighted={highlightId === a.id}
                      copied={copiedId === a.id}
                      onCopyLink={handleCopyLink}
                    />
                  ))}
                </ol>
              )}
            </div>

            {filter !== 'roadmap' && <RoadmapRail items={roadmapItems} />}
          </div>
        </section>
      </main>

      {composeOpen && (
        <ComposePanel onClose={() => setComposeOpen(false)} onPublished={handlePublished} />
      )}
    </LensShell>
  );
}
