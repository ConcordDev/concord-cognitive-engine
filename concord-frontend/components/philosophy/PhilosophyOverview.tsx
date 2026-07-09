'use client';

/**
 * PhilosophyOverview — landing dashboard for the philosophy lens.
 *
 * Aggregates real state across the Are.na-shape curation substrate
 * (`philosophy-dashboard`, `debate-list`, `reference-list`,
 * `public-channels` — all STATE-backed macros in
 * `server/domains/philosophy.js`) into one at-a-glance view. No
 * fabricated numbers, no client-side artifact system: every tile
 * traces to a live macro call on the real per-user `channels` /
 * `blocks` / `debates` / `references` maps.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Library, MessagesSquare, BookMarked, Globe, Loader2, ArrowRight,
  ScrollText, Network,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';

type Destination = 'overview' | 'dilemma' | 'curation' | 'pulse';

interface DashboardResult {
  channels: number;
  blocks: number;
  connectedBlocks: number;
  byKind: { text: number; link: number; quote: number; image: number; embed: number };
}
interface DebateSummary {
  id: string; title: string; claim: string; branch: string; status: string; postCount: number;
}
interface Overview {
  dashboard: DashboardResult;
  debates: { total: number; open: number; resolved: number; recent: DebateSummary[] };
  references: { total: number };
  publicChannels: { total: number };
}

async function run<T>(action: string, input: Record<string, unknown> = {}): Promise<T | null> {
  const r = await lensRun<T>('philosophy', action, input);
  return r.data?.ok ? (r.data.result as T) : null;
}

const KIND_LABEL: Record<string, string> = { text: 'notes', link: 'links', quote: 'quotes', image: 'images', embed: 'embeds' };

export function PhilosophyOverview({ onJump }: { onJump: (destination: Destination) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, debateList, refList, pubChannels] = await Promise.all([
        run<DashboardResult>('philosophy-dashboard'),
        run<{ threads: DebateSummary[]; count: number }>('debate-list'),
        run<{ references: unknown[]; count: number }>('reference-list'),
        run<{ channels: unknown[]; count: number }>('public-channels'),
      ]);
      const threads = debateList?.threads || [];
      setData({
        dashboard: dash || { channels: 0, blocks: 0, connectedBlocks: 0, byKind: { text: 0, link: 0, quote: 0, image: 0, embed: 0 } },
        debates: {
          total: debateList?.count ?? threads.length,
          open: threads.filter((t) => t.status !== 'resolved').length,
          resolved: threads.filter((t) => t.status === 'resolved').length,
          recent: threads.slice(0, 4),
        },
        references: { total: refList?.count ?? 0 },
        publicChannels: { total: pubChannels?.count ?? 0 },
      });
      setErr(null);
    } catch (e) {
      setErr((e as Error).message || 'Failed to load philosophy workspace overview.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div role="status" aria-label="Loading philosophy workspace overview" className="flex items-center gap-2 py-16 justify-center text-xs text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading your curation state…
      </div>
    );
  }
  if (err || !data) {
    return (
      <div role="alert" className="rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">{err || 'No data.'}</div>
    );
  }

  const hasAnyData = data.dashboard.channels > 0 || data.debates.total > 0 || data.references.total > 0 || data.publicChannels.total > 0;
  const kindEntries = Object.entries(data.dashboard.byKind).filter(([, v]) => v > 0);

  return (
    <div className="space-y-5">
      {!hasAnyData && (
        <EmptyState
          icon={<Library className="w-8 h-8 text-indigo-400" />}
          title="Your philosophy workspace is empty."
          description="Create a channel and start collecting quotes, arguments and references in Curation Studio — every tile here reads live from that state, nothing is simulated."
          action={{ label: 'Open Curation Studio', onClick: () => onJump('curation') }}
        />
      )}

      <StatTileGrid columns={4}>
        <StatTile label="Idea channels" value={data.dashboard.channels} icon={<Library className="w-4 h-4" />}
          caption={data.dashboard.channels > 0 ? `${data.dashboard.blocks} blocks · ${data.dashboard.connectedBlocks} cross-linked` : 'none yet'}
          onClick={() => onJump('curation')} />
        <StatTile label="Debate threads" value={data.debates.total} icon={<MessagesSquare className="w-4 h-4" />}
          tone={data.debates.open > 0 ? 'neutral' : 'positive'}
          caption={data.debates.total > 0 ? `${data.debates.open} open · ${data.debates.resolved} resolved` : 'no debates yet'}
          onClick={() => onJump('curation')} />
        <StatTile label="Saved references" value={data.references.total} icon={<BookMarked className="w-4 h-4" />}
          caption="concepts & thinkers" onClick={() => onJump('curation')} />
        <StatTile label="Public channels" value={data.publicChannels.total} icon={<Globe className="w-4 h-4" />}
          caption="discoverable across Concord" onClick={() => onJump('curation')} />
      </StatTileGrid>

      {kindEntries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
          <span className="uppercase tracking-wider text-zinc-500">Block mix</span>
          {kindEntries.map(([k, v]) => (
            <span key={k} className="rounded bg-zinc-900 border border-zinc-800 px-2 py-0.5 text-zinc-300">
              {v} {KIND_LABEL[k] || k}
            </span>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <MessagesSquare className="w-4 h-4 text-amber-400" /> Recent debate threads
          </div>
          <button onClick={() => onJump('curation')} className="flex items-center gap-1 text-[11px] text-indigo-300 hover:text-indigo-200">
            Open in Curation Studio <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        {data.debates.recent.length === 0 ? (
          <p className="py-3 text-center text-[11px] text-zinc-400">No debate threads yet — start one in Curation Studio.</p>
        ) : (
          <div className="space-y-1.5">
            {data.debates.recent.map((t) => (
              <button
                key={t.id}
                onClick={() => onJump('curation')}
                className="w-full text-left rounded-md border border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 px-2.5 py-1.5"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-white truncate">{t.title}</span>
                  <span className="text-[9px] uppercase text-zinc-500">{t.branch}</span>
                  {t.status === 'resolved' && <span className="text-[9px] text-emerald-400">resolved</span>}
                  <span className="ml-auto text-[9px] text-zinc-500">{t.postCount} posts</span>
                </div>
                <p className="text-[10px] text-zinc-400 italic truncate">{t.claim}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <button onClick={() => onJump('dilemma')} className={cn('rounded-lg border border-purple-700/40 bg-purple-950/20 p-3 text-left hover:border-purple-500/60 transition-colors')}>
          <div className="flex items-center gap-2 text-sm font-semibold text-purple-200"><ScrollText className="w-4 h-4" /> Open Dilemma Workbench</div>
          <p className="mt-1 text-[11px] text-zinc-400">Argument mapping, thought experiments, Hegelian dialectic, six ethical frameworks — plus mint / DM / publish / agent synthesis.</p>
        </button>
        <button onClick={() => onJump('curation')} className={cn('rounded-lg border border-indigo-700/40 bg-indigo-950/20 p-3 text-left hover:border-indigo-500/60 transition-colors')}>
          <div className="flex items-center gap-2 text-sm font-semibold text-indigo-200"><Network className="w-4 h-4" /> Open Curation Studio</div>
          <p className="mt-1 text-[11px] text-zinc-400">Channels of blocks, image grid, public discovery, collaborators, Wikipedia embeds, reference pages, connections graph, debate threads.</p>
        </button>
      </div>
    </div>
  );
}
