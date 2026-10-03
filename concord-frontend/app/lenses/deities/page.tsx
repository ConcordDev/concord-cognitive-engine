'use client';

/**
 * /lenses/deities — Deity Pantheon. In-game patron-deity system. Lists all
 * player-composed deities (ranked / searchable / tone-filterable via the
 * deity.search macro), composes new ones (deity.compose), opens a full
 * detail view (DeityDetailPanel — wires detail / commune / blessings /
 * revise), and tracks the player's own devotion (MyDevotionPanel).
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useCallback, useEffect, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { lensRun } from '@/lib/api/client';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { PantheonExplorer } from '@/components/deities/PantheonExplorer';
import { DeityDetailPanel } from '@/components/deities/DeityDetailPanel';
import { MyDevotionPanel } from '@/components/deities/MyDevotionPanel';
import { DeitySigil, type ToneVector } from '@/components/deities/DeitySigil';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { Compass, Flame, Sparkles } from 'lucide-react';

interface Deity {
  id: string;
  author_user_id: string;
  name: string;
  domainTitle?: string;
  created_at: number;
  pilgrim_count: number;
  originPeer?: string | null;
  toneVector?: ToneVector;
}

type ToneAxis = '' | 'warmth' | 'refusal' | 'mystery';
type SortKind = 'popularity' | 'newest' | 'tone';

type DeityView = 'pantheon' | 'devotion' | 'explore';

const VIEWS: { id: DeityView; label: string; keys: string; title: string; hint: string; icon: typeof Flame }[] = [
  { id: 'pantheon', label: 'Pantheon', keys: '1', title: 'The gods people made', hint: 'Search, filter, compose and make pilgrimage', icon: Flame },
  { id: 'devotion', label: 'My devotion', keys: '2', title: 'Where your faith stands', hint: 'Your alignment across every deity', icon: Sparkles },
  { id: 'explore', label: 'Explore', keys: '3', title: 'Chart the whole pantheon', hint: 'Pantheon explorer', icon: Compass },
];

export default function DeitiesPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<DeityView>('pantheon');
  const [deities, setDeities] = useState<Deity[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // compose form
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ name: '', domainTitle: '', creed: '', warmth: 0.5, refusal: 0.3, mystery: 0.5 });
  const [status, setStatus] = useState<string | null>(null);

  useLensCommand([
    ...VIEWS.map((v) => ({
      id: `deities-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => { setSelectedId(null); setView(v.id); },
    })),
    {
      id: 'deities-compose',
      keys: 'c',
      description: 'Compose a deity',
      category: 'actions' as const,
      action: () => { setSelectedId(null); setView('pantheon'); setComposing(true); },
    },
  ], { lensId: 'deities' });

  // search / filter
  const [query, setQuery] = useState('');
  const [toneAxis, setToneAxis] = useState<ToneAxis>('');
  const [minTone, setMinTone] = useState(0.5);
  const [minPilgrims, setMinPilgrims] = useState(0);
  const [sort, setSort] = useState<SortKind>('popularity');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const usingFilter = query.trim() || toneAxis || minPilgrims > 0 || sort !== 'popularity';
    const r = usingFilter
      ? await lensRun<{ deities: Deity[] }>('deity', 'search', {
          query: query.trim() || undefined,
          toneAxis: toneAxis || undefined,
          minTone: toneAxis ? minTone : undefined,
          minPilgrims: minPilgrims || undefined,
          sort,
        })
      : await lensRun<{ deities: Deity[] }>('deity', 'list', { limit: 50 });
    if (r.data.ok && r.data.result) {
      setDeities(r.data.result.deities || []);
    } else {
      setError(r.data.error || 'Could not load the pantheon.');
    }
    setLoading(false);
  }, [query, toneAxis, minTone, minPilgrims, sort]);

  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh, refreshKey]);

  const bumpRefresh = () => setRefreshKey((k) => k + 1);

  const compose = async () => {
    if (!form.name) return;
    setStatus('Composing…');
    const r = await lensRun('deity', 'compose', {
      name: form.name,
      domainTitle: form.domainTitle || undefined,
      creed: form.creed || undefined,
      toneVector: { warmth: form.warmth, refusal: form.refusal, mystery: form.mystery },
      dialogueTemplates: [
        { trigger: 'greet', text: `${form.name} regards you in silence.` },
        { trigger: 'commune_low_alignment', text: `${form.name} turns away.` },
        { trigger: 'commune_high_alignment', text: `${form.name} extends a hand.` },
      ],
      alignmentThresholds: { commune: 0.5, refuse: -0.3 },
    });
    if (r.data.ok) {
      setStatus(`Born: ${form.name}`);
      setForm({ name: '', domainTitle: '', creed: '', warmth: 0.5, refusal: 0.3, mystery: 0.5 });
      setComposing(false);
      bumpRefresh();
    } else {
      setStatus(`Failed: ${r.data.error || 'unknown'}`);
    }
    window.setTimeout(() => setStatus(null), 4000);
  };

  const pilgrimage = async (deityId: string) => {
    const r = await lensRun('deity', 'pilgrimage', { deityId });
    if (!r.data.ok) console.error('pilgrimage failed', r.data.error);
    bumpRefresh();
  };

  const current = VIEWS.find((v) => v.id === view)!;

  const frameTitle = selectedId
    ? 'A deity, up close'
    : `${current.title}${view === 'pantheon' && who ? `, ${who}` : ''}`;

  return (
    <LensShell lensId="deities" asMain={false}>
      <FirstRunTour lensId="deities" />
      <DepthBadge lensId="deities" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="deities"
        crumb="Deities"
        title={frameTitle}
        subtitle="Player-composed patron deities. Commune, devote, earn blessings."
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys, hint: v.hint }))}
        activeTab={view}
        onTab={(id) => { setSelectedId(null); setView(id as DeityView); }}
        tabsLabel="Deity views"
        cta={{
          label: 'Compose a deity',
          icon: Flame,
          onClick: () => { setSelectedId(null); setView('pantheon'); setComposing(true); },
          title: 'Birth a new deity (C)',
        }}
      >
        <div className="space-y-5">
          {selectedId ? (
            <DeityDetailPanel
              deityId={selectedId}
              onClose={() => { setSelectedId(null); bumpRefresh(); }}
              onChanged={bumpRefresh}
            />
          ) : (
            <>
              {view === 'pantheon' && (
                <>
            {composing && (
              <div className="space-y-3 rounded-2xl border border-white/10 bg-[#111] p-4">
                <h2 className="text-sm font-bold text-purple-300">Compose a Deity</h2>
                <input
                  type="text" placeholder="Name" value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                />
                <input
                  type="text" placeholder="Domain title (optional, e.g. Patron of the tide)" value={form.domainTitle}
                  onChange={(e) => setForm({ ...form, domainTitle: e.target.value })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                />
                <textarea
                  placeholder="Creed (optional)" value={form.creed} rows={2}
                  onChange={(e) => setForm({ ...form, creed: e.target.value })}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                />
                {(['warmth', 'refusal', 'mystery'] as const).map((k) => (
                  <div key={k}>
                    <label className="flex justify-between text-xs text-zinc-400">
                      <span>{k}</span><span className="font-mono">{form[k].toFixed(2)}</span>
                    </label>
                    <input
                      type="range" min={0} max={1} step={0.05} value={form[k]}
                      onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })}
                      className="w-full"
                    />
                  </div>
                ))}
                <button
                  type="button" onClick={compose} disabled={!form.name}
                  className="w-full rounded-lg bg-purple-700 hover:bg-purple-600 disabled:opacity-50 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  Birth Deity
                </button>
                <button
                  type="button" onClick={() => setComposing(false)}
                  className="w-full rounded-lg border border-white/10 py-2 text-sm text-zinc-300 hover:bg-white/5"
                >
                  Cancel
                </button>
                {status && <p className="text-xs italic text-purple-300">{status}</p>}
              </div>
            )}
            {!composing && status && <p className="text-xs italic text-purple-300">{status}</p>}

            {/* Search / filter */}
            <div className="space-y-3 rounded-2xl border border-white/10 bg-[#111] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text" placeholder="Search by name / domain / creed" value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="flex-1 min-w-[180px] rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100"
                />
                <select
                  value={sort} onChange={(e) => setSort(e.target.value as SortKind)}
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200"
                >
                  <option value="popularity">Most pilgrims</option>
                  <option value="newest">Newest</option>
                  <option value="tone">By tone axis</option>
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                <span>Tone axis:</span>
                {(['', 'warmth', 'refusal', 'mystery'] as ToneAxis[]).map((a) => (
                  <button
                    key={a || 'any'} type="button" onClick={() => setToneAxis(a)}
                    className={`rounded-full border px-2 py-0.5 capitalize transition-colors ${
                      toneAxis === a ? 'border-purple-500 bg-purple-500/20 text-purple-200' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'
                    }`}
                  >
                    {a || 'any'}
                  </button>
                ))}
                {toneAxis && (
                  <label className="flex items-center gap-1.5">
                    <span>min {toneAxis} {minTone.toFixed(2)}</span>
                    <input
                      type="range" min={0} max={1} step={0.05} value={minTone}
                      onChange={(e) => setMinTone(Number(e.target.value))}
                    />
                  </label>
                )}
                <label className="flex items-center gap-1.5">
                  <span>min pilgrims {minPilgrims}</span>
                  <input
                    type="range" min={0} max={50} step={1} value={minPilgrims}
                    onChange={(e) => setMinPilgrims(Number(e.target.value))}
                  />
                </label>
              </div>
            </div>

            {loading ? (
              <div role="status" aria-live="polite" aria-busy="true" className="py-8 text-center italic text-zinc-400">
                Gathering the pantheon…
              </div>
            ) : error ? (
              <div role="alert" className="space-y-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-center">
                <p className="text-sm text-rose-300">{error}</p>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="rounded-lg border border-rose-500/40 px-4 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-500/10 focus:outline-none focus:ring-2 focus:ring-rose-500"
                >
                  Retry
                </button>
              </div>
            ) : deities.length === 0 ? (
              <div className="py-8 text-center italic text-zinc-400">
                No deities match. {query || toneAxis || minPilgrims ? 'Loosen the filter or' : 'Be the first to'} compose one.
              </div>
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {deities.map((d) => (
                  <li key={d.id} className="rounded-2xl border border-white/10 bg-[#111] p-4 transition-colors hover:border-purple-700/50">
                    <button type="button" onClick={() => setSelectedId(d.id)} className="block w-full text-left">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="text-base font-bold text-zinc-100">{d.name}</h3>
                          {d.domainTitle && <p className="text-[11px] text-purple-300">{d.domainTitle}</p>}
                          <p className="mt-0.5 font-mono text-[10px] text-zinc-400">by {d.author_user_id.slice(0, 8)}</p>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-bold text-purple-300">{d.pilgrim_count}</div>
                          <div className="text-[10px] uppercase tracking-wider text-zinc-400">pilgrims</div>
                        </div>
                      </div>
                      <p className="mt-2 text-[10px] text-zinc-400">
                        born {new Date(d.created_at * 1000).toLocaleDateString()}
                        {d.originPeer ? ` · federated ⇄ ${d.originPeer}` : ''}
                      </p>
                      <div className="mt-2">
                        <DeitySigil toneVector={d.toneVector} />
                      </div>
                    </button>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button" onClick={() => pilgrimage(d.id)}
                        className="flex-1 rounded bg-purple-700 hover:bg-purple-600 py-1.5 text-xs font-medium text-white"
                      >
                        Pilgrimage
                      </button>
                      <button
                        type="button" onClick={() => setSelectedId(d.id)}
                        className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-purple-700/50"
                      >
                        Open
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

                </>
              )}

              {view === 'devotion' && (
                <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
                  <h2 className="mb-3 text-sm font-semibold text-white">My devotion</h2>
                  <MyDevotionPanel refreshKey={refreshKey} onPickDeity={(id) => setSelectedId(id)} />
                </section>
              )}

              {view === 'explore' && (
                <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
                  <PantheonExplorer />
                </section>
              )}
            </>
          )}
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
