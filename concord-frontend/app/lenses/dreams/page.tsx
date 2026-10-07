'use client';

/**
 * /lenses/dreams — north-star look (serif title, pill tabs, teal CTA that opens the latest dream). Browse, read, interpret, tag, search + publish your dreams.
 *
 * Each dream is a deterministic prose record of one night's substrate state.
 * The list comes from `dreams.recent`; the reader/interpret/tag/publish flow
 * runs through `dreams.detail` / `dreams.interpret` / `dreams.tag` /
 * `dreams.publish` / `dreams.reprice` / `dreams.unpublish`; search + timeline
 * use `dreams.search` / `dreams.tags` / `dreams.timeline`; the forward-looking
 * counterpart uses `dreams.predictions` (Layer 10 forward-sim). Currency: CC.
 *
 * Scope boundary: this lens is the player's own Layer 9 embodied-dream
 * substrate (`dreams` table, one composed record per offline pass). It does
 * NOT surface the unrelated system-level 6-phase dream-cycle (home-dashboard
 * `SubstrateDreams` widget) or the owner-only insight-capture/convergence
 * tool (`command-center`'s dream panel) — those are different substrates
 * with their own dedicated surfaces; mixing them in here would show a
 * regular player counts from a system they can't act on.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useCallback, useEffect, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { DreamPredictions } from '@/components/dreams/DreamPredictions';
import { DreamReader } from '@/components/dreams/DreamReader';
import { DreamLibrary } from '@/components/dreams/DreamLibrary';
import { lensRun } from '@/lib/api/client';
import { Library, Moon, BookOpen } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';

interface DreamDtu { id: string; title?: string; data?: unknown }
interface Dream {
  id: string;
  user_id?: string;
  world_id?: string;
  dream_dtu_id?: string;
  fragment_count?: number;
  composer?: string;
  composed_at: number;
  tags?: string[];
  dtu?: DreamDtu | null;
}

type Tab = 'recent' | 'library';

const CTA = 'fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-50';

const TABS: { id: Tab; label: string; keys: string; hint: string; icon: typeof Moon }[] = [
  { id: 'recent', label: 'Recent', keys: '1', hint: 'Your latest dreams', icon: Moon },
  { id: 'library', label: 'Search & Timeline', keys: '2', hint: 'Search, tags and timeline', icon: Library },
];

export default function DreamsPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [tab, setTab] = useState<Tab>('recent');
  const [dreams, setDreams] = useState<Dream[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDreamId, setOpenDreamId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void lensRun<{ ok: boolean; dreams?: Dream[] }>('dreams', 'recent', { limit: 30 }).then((r) => {
      if (cancelled) return;
      if (r.data.ok) setDreams(r.data.result?.dreams || []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const onChanged = () => setReloadKey((k) => k + 1);

  const latestId = dreams[0]?.id ?? null;
  const readLatest = useCallback(() => {
    if (latestId) setOpenDreamId(latestId);
    else setTab('library');
  }, [latestId]);

  useLensCommand([
    ...TABS.map((t) => ({
      id: `tab-${t.id}`,
      keys: t.keys,
      description: `${t.label} — ${t.hint}`,
      category: 'navigation' as const,
      action: () => setTab(t.id),
    })),
    { id: 'read-latest', keys: 'n', description: 'Read the latest dream', category: 'actions' as const, action: readLatest },
  ], { lensId: 'dreams' });

  return (
    <LensShell lensId="dreams" asMain={false}>
      <FirstRunTour lensId="dreams" />
      <DepthBadge lensId="dreams" size="sm" className="ml-2" />
      <div data-lens-theme="dreams" className="relative min-h-full px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Dreams</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          {tab === 'recent' ? `Last night's note${who ? `, ${who}` : ''}` : 'The dream library'}
        </h1>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Dream views">
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={on ? 'page' : undefined}
                title={`${t.hint} (${t.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{t.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <p className="mb-5 max-w-3xl text-[13px] leading-relaxed text-zinc-500">
          Each is a deterministic prose record of one night&apos;s substrate state. Read it, interpret it, tag it, and publish to sell on the marketplace — royalty cascade pays you on every purchase. <strong className="font-medium text-zinc-400">Currency: CC.</strong>
        </p>

        {loading && <div role="status" className="rounded-2xl border border-white/10 bg-[#111] p-8 text-zinc-400">Loading your dreams…</div>}

        {!loading && tab === 'recent' && (
          dreams.length === 0 ? (
            <div className="flex min-h-[14rem] items-center justify-center rounded-2xl border border-white/10 bg-[#111] p-8 italic text-zinc-400">
              Sleep generates dreams. Come back tomorrow.
            </div>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {dreams.map((d) => {
                const title = d.dtu?.title || `Dream from ${new Date(d.composed_at * 1000).toLocaleDateString()}`;
                return (
                  <li key={d.id} className="flex flex-col justify-between rounded-2xl border border-white/10 bg-[#111] p-4">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-bold text-zinc-100">{title}</h3>
                      <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
                        {d.fragment_count ?? 0} fragments · {d.composer} · {new Date(d.composed_at * 1000).toLocaleString()}
                      </p>
                      {d.tags && d.tags.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {d.tags.map((t) => (
                            <span key={t} className="rounded bg-white/5 px-1 font-mono text-[9px] text-zinc-400">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setOpenDreamId(d.id)}
                      className="mt-3 inline-flex items-center gap-1.5 self-start rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/10"
                    >
                      <BookOpen className="h-3 w-3" /> Read
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        )}

        {!loading && tab === 'library' && (
          <DreamLibrary onOpen={setOpenDreamId} reloadKey={reloadKey} />
        )}

        <section className="mt-6 rounded-2xl border border-white/10 bg-[#111] p-4">
          <DreamPredictions />
        </section>

        <CrossLensRecentsPanel lensId="dreams" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button type="button" onClick={readLatest} title="Read the latest dream (N)" className={CTA}>
          <Moon className="h-4 w-4" />
          {latestId ? 'Read the latest dream' : 'Search the library'}
        </button>
      </div>

      {openDreamId && (
        <DreamReader
          dreamId={openDreamId}
          onClose={() => setOpenDreamId(null)}
          onChanged={onChanged}
        />
      )}
    </LensShell>
  );
}
