'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * CompetitiveIntelligence — the Crayon / Klue parity surface for the
 * market lens. A tabbed competitive-intelligence workbench that wires
 * the seven backlog macro groups end-to-end:
 *   - competitor-news    → news monitoring with competitor tagging
 *   - battlecard-*       → win/loss positioning sheets for sales
 *   - winloss-*          → deal-outcome tracking + analytics
 *   - page-snapshot / page-watch-* / change-alerts → website-change tracking
 *   - market-sizing / sizing-scenarios → TAM/SAM/SOM calculator
 *   - landscape-quadrant → 2x2 competitive positioning map
 * Every value rendered comes from a real macro response.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Newspaper, Swords, Trophy, Globe, Calculator, Grid3x3,
  Loader2, RefreshCw, Plus, Trash2, ExternalLink, AlertTriangle,
  CheckCircle2, XCircle, Bell, Save,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';

type Tab = 'news' | 'battlecards' | 'winloss' | 'webwatch' | 'sizing' | 'quadrant';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'news', label: 'News', icon: <Newspaper className="w-3.5 h-3.5" /> },
  { id: 'battlecards', label: 'Battlecards', icon: <Swords className="w-3.5 h-3.5" /> },
  { id: 'winloss', label: 'Win/Loss', icon: <Trophy className="w-3.5 h-3.5" /> },
  { id: 'webwatch', label: 'Web Watch', icon: <Globe className="w-3.5 h-3.5" /> },
  { id: 'sizing', label: 'TAM/SAM/SOM', icon: <Calculator className="w-3.5 h-3.5" /> },
  { id: 'quadrant', label: 'Quadrant', icon: <Grid3x3 className="w-3.5 h-3.5" /> },
];

export function CompetitiveIntelligence() {
  const [tab, setTab] = useState<Tab>('news');
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Swords className="w-4 h-4 text-indigo-400" />
        <h3 className="text-sm font-bold text-zinc-100">Competitive Intelligence</h3>
        <span className="text-[10px] text-zinc-400">Crayon / Klue parity</span>
      </div>
      <div className="flex flex-wrap gap-1 mb-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg font-medium transition-colors ${
              tab === t.id
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-900/60 border border-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'news' && <NewsTab />}
      {tab === 'battlecards' && <BattlecardsTab />}
      {tab === 'winloss' && <WinLossTab />}
      {tab === 'webwatch' && <WebWatchTab />}
      {tab === 'sizing' && <SizingTab />}
      {tab === 'quadrant' && <QuadrantTab />}
    </div>
  );
}

// ── shared bits ───────────────────────────────────────────────────────
function Spinner() {
  return (
    <div className="flex items-center justify-center py-6 text-zinc-400">
      <Loader2 className="w-4 h-4 animate-spin" />
    </div>
  );
}
function ErrorRow({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-950/30 border border-rose-900/40 rounded-lg px-3 py-2">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      <span>{msg}</span>
    </div>
  );
}
const inputCls =
  'bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 outline-none';

// ── Competitor news monitoring ────────────────────────────────────────
interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  competitors: { id: string; name: string }[];
}
function NewsTab() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [meta, setMeta] = useState<{ totalCount: number; taggedCount: number; query: string } | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun('market', 'competitor-news', query.trim() ? { query: query.trim() } : {});
    if (r.data.ok && r.data.result) {
      setItems(r.data.result.items || []);
      setMeta({
        totalCount: r.data.result.totalCount || 0,
        taggedCount: r.data.result.taggedCount || 0,
        query: r.data.result.query || '',
      });
    } else {
      setError(r.data.error || 'News feed unavailable.');
      setItems([]);
    }
    setLoading(false);
  }, [query]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          placeholder="Override query (blank = all tracked competitors)"
          className={`flex-1 ${inputCls}`}
        />
        <button
          onClick={load}
          disabled={loading}
          className="px-2.5 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Pull
        </button>
      </div>
      {error && <ErrorRow msg={error} />}
      {meta && !error && (
        <p className="text-[10px] text-zinc-400">
          {meta.totalCount} stories · {meta.taggedCount} tagged to tracked competitors · query: {meta.query}
        </p>
      )}
      {loading && <Spinner />}
      <ul className="space-y-1.5 max-h-80 overflow-y-auto">
        {!loading && items.length === 0 && !error && (
          <li className="text-xs text-zinc-400 italic py-3 text-center">No competitor news found.</li>
        )}
        {items.map((it, i) => (
          <li key={i} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
            <a
              href={it.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-zinc-100 hover:text-indigo-300 inline-flex items-start gap-1"
            >
              {it.title}
              <ExternalLink className="w-3 h-3 shrink-0 mt-0.5 text-zinc-600" />
            </a>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <span className="text-[9px] text-zinc-400">{it.source || 'news'} · {it.pubDate}</span>
              {it.competitors.map((c) => (
                <span key={c.id} className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-900/50">
                  {c.name}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Battlecards ───────────────────────────────────────────────────────
interface Battlecard {
  id: string;
  competitorName: string;
  overview: string;
  whyWeWin: string[];
  whyWeLose: string[];
  landmines: string[];
  objections: string[];
  pricingNotes: string;
  updatedAt: string;
}
function BattlecardsTab() {
  const [cards, setCards] = useState<Battlecard[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Battlecard> | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun('market', 'battlecard-list', {});
    setCards((r.data.result?.battlecards as Battlecard[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function save() {
    if (!editing?.competitorName?.trim()) return;
    await lensRun('market', 'battlecard-save', {
      id: editing.id,
      competitorName: editing.competitorName.trim(),
      overview: editing.overview || '',
      whyWeWin: (editing.whyWeWin as string[]) || [],
      whyWeLose: (editing.whyWeLose as string[]) || [],
      landmines: (editing.landmines as string[]) || [],
      objections: (editing.objections as string[]) || [],
      pricingNotes: editing.pricingNotes || '',
    });
    setEditing(null);
    await refresh();
  }
  async function del(id: string) {
    await lensRun('market', 'battlecard-delete', { id });
    await refresh();
  }

  if (loading) return <Spinner />;
  if (editing) return <BattlecardEditor card={editing} onChange={setEditing} onSave={save} onCancel={() => setEditing(null)} />;

  return (
    <div className="space-y-2">
      <button
        onClick={() => setEditing({ competitorName: '', whyWeWin: [], whyWeLose: [], landmines: [], objections: [] })}
        className="px-2.5 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold inline-flex items-center gap-1"
      >
        <Plus className="w-3 h-3" /> New battlecard
      </button>
      {cards.length === 0 && <p className="text-xs text-zinc-400 italic py-3 text-center">No battlecards yet.</p>}
      {cards.map((c) => (
        <div key={c.id} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
          <div className="flex items-start justify-between gap-2 mb-1">
            <p className="text-xs font-bold text-zinc-100">vs {c.competitorName}</p>
            <div className="flex gap-1.5">
              <button onClick={() => setEditing(c)} className="text-[10px] text-indigo-400 hover:text-indigo-300">Edit</button>
              <button aria-label="Delete" onClick={() => del(c.id)} className="text-rose-400"><Trash2 className="w-3 h-3" /></button>
            </div>
          </div>
          {c.overview && <p className="text-[11px] text-zinc-400 mb-2">{c.overview}</p>}
          <div className="grid grid-cols-2 gap-2">
            <CardList title="Why we win" color="text-emerald-400" items={c.whyWeWin} />
            <CardList title="Why we lose" color="text-rose-400" items={c.whyWeLose} />
            <CardList title="Landmines to plant" color="text-amber-400" items={c.landmines} />
            <CardList title="Objection handling" color="text-sky-400" items={c.objections} />
          </div>
          {c.pricingNotes && <p className="text-[10px] text-zinc-400 mt-2">Pricing: {c.pricingNotes}</p>}
        </div>
      ))}
    </div>
  );
}
function CardList({ title, color, items }: { title: string; color: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <p className={`text-[9px] uppercase tracking-wide font-semibold ${color}`}>{title}</p>
      <ul className="mt-0.5 space-y-0.5">
        {items.map((x, i) => (
          <li key={i} className="text-[10px] text-zinc-300">• {x}</li>
        ))}
      </ul>
    </div>
  );
}
function BattlecardEditor({
  card, onChange, onSave, onCancel,
}: {
  card: Partial<Battlecard>;
  onChange: (c: Partial<Battlecard>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const lines = (v?: string[]) => (v || []).join('\n');
  const toLines = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean);
  return (
    <div className="space-y-2">
      <input
        value={card.competitorName || ''}
        onChange={(e) => onChange({ ...card, competitorName: e.target.value })}
        placeholder="Competitor name"
        className={`w-full ${inputCls}`}
      />
      <textarea
        value={card.overview || ''}
        onChange={(e) => onChange({ ...card, overview: e.target.value })}
        placeholder="One-line overview"
        rows={2}
        className={`w-full resize-none ${inputCls}`}
      />
      {([
        ['whyWeWin', 'Why we win (one per line)'],
        ['whyWeLose', 'Why we lose (one per line)'],
        ['landmines', 'Landmines to plant (one per line)'],
        ['objections', 'Objection handling (one per line)'],
      ] as const).map(([k, label]) => (
        <textarea
          key={k}
          value={lines(card[k] as string[])}
          onChange={(e) => onChange({ ...card, [k]: toLines(e.target.value) })}
          placeholder={label}
          rows={3}
          className={`w-full resize-none ${inputCls}`}
        />
      ))}
      <input
        value={card.pricingNotes || ''}
        onChange={(e) => onChange({ ...card, pricingNotes: e.target.value })}
        placeholder="Pricing notes"
        className={`w-full ${inputCls}`}
      />
      <div className="flex gap-1.5">
        <button
          onClick={onSave}
          disabled={!card.competitorName?.trim()}
          className="px-2.5 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1"
        >
          <Save className="w-3 h-3" /> Save
        </button>
        <button onClick={onCancel} className="px-2.5 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Win/loss analysis ─────────────────────────────────────────────────
interface Deal {
  id: string;
  dealName: string;
  outcome: 'won' | 'lost';
  competitor: string;
  reason: string;
  dealValue: number | null;
  closedAt: string;
}
interface WinLossResult {
  totalDeals: number;
  won: number;
  lost: number;
  winRate: number | null;
  wonValue: number;
  lostValue: number;
  lossReasons: { reason: string; count: number }[];
  competitorRecords: { competitor: string; won: number; lost: number; total: number; winRate: number; valueAtStake: number }[];
  deals: Deal[];
}
const WL_REASONS = ['price', 'features', 'relationship', 'timing', 'brand', 'support', 'integration', 'other'];
function WinLossTab() {
  const [data, setData] = useState<WinLossResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ dealName: '', outcome: 'won', competitor: '', reason: 'price', dealValue: '' });

  const refresh = useCallback(async () => {
    const r = await lensRun('market', 'winloss-analysis', {});
    setData((r.data.result as WinLossResult) || null);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function record() {
    if (!form.dealName.trim()) return;
    await lensRun('market', 'winloss-record', {
      dealName: form.dealName.trim(),
      outcome: form.outcome,
      competitor: form.competitor.trim(),
      reason: form.reason,
      dealValue: form.dealValue ? Number(form.dealValue) : null,
    });
    setForm({ dealName: '', outcome: 'won', competitor: '', reason: 'price', dealValue: '' });
    await refresh();
  }
  async function del(id: string) {
    await lensRun('market', 'winloss-delete', { id });
    await refresh();
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-3">
      {data && data.totalDeals > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {([
            ['Win rate', data.winRate != null ? `${data.winRate}%` : '—'],
            ['Won', `${data.won}`],
            ['Lost', `${data.lost}`],
            ['Won value', `$${data.wonValue.toLocaleString()}`],
          ] as const).map(([l, v]) => (
            <div key={l} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold text-zinc-100">{v}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{l}</p>
            </div>
          ))}
        </div>
      )}

      {data && data.lossReasons.length > 0 && (
        <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-2">
          <p className="text-[10px] text-zinc-400 uppercase tracking-wide mb-1">Loss reasons</p>
          <ChartKit
            kind="bar"
            data={data.lossReasons as unknown as Array<Record<string, unknown>>}
            xKey="reason"
            series={[{ key: 'count', label: 'Losses', color: '#ef4444' }]}
            height={150}
            showLegend={false}
          />
        </div>
      )}

      {data && data.competitorRecords.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-zinc-400 uppercase tracking-wide">Head-to-head record</p>
          {data.competitorRecords.map((c) => (
            <div key={c.competitor} className="flex items-center justify-between bg-zinc-900/60 border border-zinc-800 rounded px-2 py-1 text-[11px]">
              <span className="text-zinc-200 font-medium truncate">{c.competitor}</span>
              <span className="text-zinc-400">
                <span className="text-emerald-400">{c.won}W</span> / <span className="text-rose-400">{c.lost}L</span>
                {' · '}<span className="text-zinc-300">{c.winRate}%</span>
                {c.valueAtStake > 0 && <span className="text-zinc-400"> · ${c.valueAtStake.toLocaleString()}</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 flex flex-wrap gap-1.5">
        <input value={form.dealName} onChange={(e) => setForm({ ...form, dealName: e.target.value })} placeholder="Deal name" className={`flex-1 min-w-[120px] ${inputCls}`} />
        <input value={form.competitor} onChange={(e) => setForm({ ...form, competitor: e.target.value })} placeholder="competitor" className={`w-28 ${inputCls}`} />
        <select value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })} className={inputCls}>
          <option value="won">won</option>
          <option value="lost">lost</option>
        </select>
        <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={inputCls}>
          {WL_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <input value={form.dealValue} onChange={(e) => setForm({ ...form, dealValue: e.target.value })} placeholder="$ value" className={`w-20 ${inputCls}`} />
        <button onClick={record} disabled={!form.dealName.trim()} className="px-2.5 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-40">Record</button>
      </div>

      <ul className="space-y-1 max-h-56 overflow-y-auto">
        {data && data.deals.length === 0 && <li className="text-xs text-zinc-400 italic py-3 text-center">No deals recorded.</li>}
        {data?.deals.map((d) => (
          <li key={d.id} className="group flex items-center justify-between bg-zinc-900/60 border border-zinc-800 rounded px-2 py-1.5 text-[11px]">
            <span className="flex items-center gap-1.5 min-w-0">
              {d.outcome === 'won'
                ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                : <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />}
              <span className="text-zinc-200 truncate">{d.dealName}</span>
              <span className="text-zinc-400">· {d.competitor} · {d.reason}</span>
            </span>
            <button aria-label="Delete" onClick={() => del(d.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Website-change tracking + change alerts ───────────────────────────
interface PageSnap { hash: string; textLength: number; prices: string[]; title: string; capturedAt: string; }
interface PageWatch { id: string; url: string; label: string; current: PageSnap | null; previous: PageSnap | null; lastDiff: any; history: { at: string; sizeDelta: number }[]; }
interface ChangeAlert { id: string; kind: string; label: string; summary: string; read: boolean; createdAt: string; }
function WebWatchTab() {
  const [watches, setWatches] = useState<PageWatch[]>([]);
  const [alerts, setAlerts] = useState<ChangeAlert[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [w, a] = await Promise.all([
      lensRun('market', 'page-watch-list', {}),
      lensRun('market', 'change-alerts', {}),
    ]);
    setWatches((w.data.result?.watches as PageWatch[]) || []);
    setAlerts((a.data.result?.alerts as ChangeAlert[]) || []);
    setUnread(a.data.result?.unread || 0);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function snapshot() {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    const r = await lensRun('market', 'page-snapshot', { url: url.trim(), label: label.trim() || undefined });
    if (!r.data.ok) setError(r.data.error || 'Snapshot failed.');
    else { setUrl(''); setLabel(''); }
    setBusy(false);
    await refresh();
  }
  async function rescan(u: string) {
    setBusy(true);
    setError(null);
    const r = await lensRun('market', 'page-snapshot', { url: u });
    if (!r.data.ok) setError(r.data.error || 'Re-scan failed.');
    setBusy(false);
    await refresh();
  }
  async function delWatch(id: string) {
    await lensRun('market', 'page-watch-delete', { id });
    await refresh();
  }
  async function markAll() {
    await lensRun('market', 'alert-mark-read', { all: true });
    await refresh();
  }
  async function markOne(id: string) {
    await lensRun('market', 'alert-mark-read', { id });
    await refresh();
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-3">
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 flex flex-wrap gap-1.5">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="competitor page URL" className={`flex-1 min-w-[160px] ${inputCls}`} />
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="label (optional)" className={`w-32 ${inputCls}`} />
        <button onClick={snapshot} disabled={busy || !url.trim()} className="px-2.5 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Snapshot
        </button>
      </div>
      {error && <ErrorRow msg={error} />}

      {alerts.length > 0 && (
        <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-zinc-400 uppercase tracking-wide flex items-center gap-1">
              <Bell className="w-3 h-3" /> Change alerts {unread > 0 && <span className="text-amber-400">({unread} unread)</span>}
            </p>
            {unread > 0 && <button onClick={markAll} className="text-[10px] text-indigo-400 hover:text-indigo-300">Mark all read</button>}
          </div>
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {alerts.map((a) => (
              <li
                key={a.id}
                onClick={() => !a.read && markOne(a.id)}
                className={`text-[11px] rounded px-2 py-1 cursor-pointer ${
                  a.read ? 'text-zinc-400 bg-zinc-900/40' : 'text-zinc-200 bg-amber-950/30 border border-amber-900/40'
                }`}
              >
                <span className={`text-[8px] uppercase font-bold mr-1.5 ${a.kind === 'pricing' ? 'text-rose-400' : 'text-sky-400'}`}>{a.kind}</span>
                {a.summary}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="space-y-1.5">
        {watches.length === 0 && <li className="text-xs text-zinc-400 italic py-3 text-center">No pages watched yet.</li>}
        {watches.map((w) => (
          <li key={w.id} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
            <div className="group flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-zinc-100 truncate">{w.label}</p>
                <p className="text-[9px] text-zinc-400 truncate">{w.url}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => rescan(w.url)} disabled={busy} className="text-[10px] text-indigo-400 hover:text-indigo-300 disabled:opacity-40">Re-scan</button>
                <button aria-label="Delete" onClick={() => delWatch(w.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>
            {w.current && (
              <p className="text-[9px] text-zinc-400 mt-1">
                {w.current.textLength.toLocaleString()} chars · {w.current.prices.length} price tokens · captured {new Date(w.current.capturedAt).toLocaleString()}
              </p>
            )}
            {w.lastDiff && w.lastDiff.changed && (
              <div className="mt-1 text-[10px] text-amber-300">
                Last change: {w.lastDiff.sizeDelta >= 0 ? '+' : ''}{w.lastDiff.sizeDelta} chars
                {w.lastDiff.pricesAdded?.length > 0 && ` · +${w.lastDiff.pricesAdded.length} prices`}
                {w.lastDiff.pricesRemoved?.length > 0 && ` · -${w.lastDiff.pricesRemoved.length} prices`}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Market sizing — TAM / SAM / SOM ───────────────────────────────────
interface SizingResult {
  method: string;
  tam: number;
  sam: number;
  som: number;
  serviceablePct: number;
  obtainablePct: number;
  somAsPctOfTam: number;
  currency: string;
  notes: string | null;
}
interface SizingScenario extends SizingResult { id: string; label: string; savedAt: string; }
function SizingTab() {
  const [method, setMethod] = useState<'top-down' | 'bottom-up'>('top-down');
  const [tam, setTam] = useState('');
  const [customers, setCustomers] = useState('');
  const [arpc, setArpc] = useState('');
  const [serviceablePct, setServiceablePct] = useState('30');
  const [marketSharePct, setMarketSharePct] = useState('5');
  const [label, setLabel] = useState('');
  const [result, setResult] = useState<SizingResult | null>(null);
  const [scenarios, setScenarios] = useState<SizingScenario[]>([]);
  const [busy, setBusy] = useState(false);

  const loadScenarios = useCallback(async () => {
    const r = await lensRun('market', 'sizing-scenarios', {});
    setScenarios((r.data.result?.scenarios as SizingScenario[]) || []);
  }, []);
  useEffect(() => { void loadScenarios(); }, [loadScenarios]);

  async function compute(save: boolean) {
    setBusy(true);
    const params: Record<string, unknown> = {
      method,
      serviceablePct: Number(serviceablePct) || 0,
      marketSharePct: Number(marketSharePct) || 0,
    };
    if (method === 'top-down') params.tam = Number(tam) || 0;
    else { params.potentialCustomers = Number(customers) || 0; params.avgRevenuePerCustomer = Number(arpc) || 0; }
    if (save && label.trim()) { params.save = true; params.label = label.trim(); }
    const r = await lensRun('market', 'market-sizing', params);
    setResult((r.data.result as SizingResult) || null);
    if (save) { setLabel(''); await loadScenarios(); }
    setBusy(false);
  }

  const fmt = (n: number, cur: string) => `${cur === 'USD' ? '$' : ''}${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {(['top-down', 'bottom-up'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMethod(m)}
            className={`px-2.5 py-1 text-xs rounded font-medium ${method === m ? 'bg-indigo-600 text-white' : 'bg-zinc-900/60 border border-zinc-800 text-zinc-400'}`}
          >
            {m}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {method === 'top-down' ? (
          <label className="text-[10px] text-zinc-400">TAM ($)
            <input value={tam} onChange={(e) => setTam(e.target.value)} placeholder="total addressable" className={`w-full mt-0.5 ${inputCls}`} />
          </label>
        ) : (
          <>
            <label className="text-[10px] text-zinc-400">Potential customers
              <input value={customers} onChange={(e) => setCustomers(e.target.value)} className={`w-full mt-0.5 ${inputCls}`} />
            </label>
            <label className="text-[10px] text-zinc-400">Avg revenue / customer ($)
              <input value={arpc} onChange={(e) => setArpc(e.target.value)} className={`w-full mt-0.5 ${inputCls}`} />
            </label>
          </>
        )}
        <label className="text-[10px] text-zinc-400">Serviceable %
          <input value={serviceablePct} onChange={(e) => setServiceablePct(e.target.value)} className={`w-full mt-0.5 ${inputCls}`} />
        </label>
        <label className="text-[10px] text-zinc-400">Obtainable share %
          <input value={marketSharePct} onChange={(e) => setMarketSharePct(e.target.value)} className={`w-full mt-0.5 ${inputCls}`} />
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => compute(false)} disabled={busy} className="px-2.5 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-40">Calculate</button>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="scenario label" className={`w-32 ${inputCls}`} />
        <button onClick={() => compute(true)} disabled={busy || !label.trim()} className="px-2.5 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40 inline-flex items-center gap-1">
          <Save className="w-3 h-3" /> Save scenario
        </button>
      </div>

      {result && (
        <div className="space-y-2">
          {result.notes && <p className="text-[10px] text-amber-400">{result.notes}</p>}
          <div className="space-y-1">
            {([
              ['TAM', result.tam, 'bg-indigo-600', 100],
              ['SAM', result.sam, 'bg-sky-600', result.tam > 0 ? (result.sam / result.tam) * 100 : 0],
              ['SOM', result.som, 'bg-emerald-600', result.tam > 0 ? (result.som / result.tam) * 100 : 0],
            ] as const).map(([l, v, c, w]) => (
              <div key={l}>
                <div className="flex justify-between text-[11px] mb-0.5">
                  <span className="text-zinc-400 font-semibold">{l}</span>
                  <span className="text-zinc-100">{fmt(v, result.currency)}</span>
                </div>
                <div className="h-3 bg-zinc-900 rounded overflow-hidden">
                  <div className={`h-full ${c}`} style={{ width: `${Math.max(2, Math.min(100, w))}%` }} />
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-zinc-400">SOM is {result.somAsPctOfTam}% of TAM · serviceable {result.serviceablePct}% · obtainable {result.obtainablePct}%</p>
        </div>
      )}

      {scenarios.length > 0 && (
        <div>
          <p className="text-[10px] text-zinc-400 uppercase tracking-wide mb-1">Saved scenarios</p>
          <ul className="space-y-1">
            {scenarios.map((s) => (
              <li key={s.id} className="flex items-center justify-between bg-zinc-900/60 border border-zinc-800 rounded px-2 py-1 text-[11px]">
                <span className="text-zinc-200 truncate">{s.label}</span>
                <span className="text-zinc-400">
                  TAM {fmt(s.tam, s.currency)} · SAM {fmt(s.sam, s.currency)} · SOM {fmt(s.som, s.currency)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Competitive landscape quadrant ────────────────────────────────────
interface QuadrantPoint { id: string; name: string; segment: string; threatLevel: string; x: number; y: number; quadrant: string; }
interface QuadrantResult {
  points: QuadrantPoint[];
  quadrants: Record<string, string[]>;
  xMid: number;
  yMid: number;
  xAxis: { axis: string; low: string; high: string };
  yAxis: { axis: string; low: string; high: string };
  leader: { name: string; quadrant: string } | null;
  note?: string;
}
const AXIS_OPTS = ['share', 'strength', 'threat'];
function QuadrantTab() {
  const [data, setData] = useState<QuadrantResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [xAxis, setXAxis] = useState('share');
  const [yAxis, setYAxis] = useState('strength');

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('market', 'landscape-quadrant', { xAxis, yAxis });
    setData((r.data.result as QuadrantResult) || null);
    setLoading(false);
  }, [xAxis, yAxis]);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <Spinner />;

  const pts = data?.points || [];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const xLo = Math.min(...xs, 0); const xHi = Math.max(...xs, 1);
  const yLo = Math.min(...ys, 0); const yHi = Math.max(...ys, 1);
  const px = (v: number) => xHi === xLo ? 50 : ((v - xLo) / (xHi - xLo)) * 90 + 5;
  const py = (v: number) => yHi === yLo ? 50 : 95 - (((v - yLo) / (yHi - yLo)) * 90 + 5);
  const THREAT_DOT: Record<string, string> = { low: 'bg-emerald-400', medium: 'bg-amber-400', high: 'bg-rose-400' };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5 items-center text-[10px] text-zinc-400">
        <span>X:</span>
        <select value={xAxis} onChange={(e) => setXAxis(e.target.value)} className={inputCls}>
          {AXIS_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <span>Y:</span>
        <select value={yAxis} onChange={(e) => setYAxis(e.target.value)} className={inputCls}>
          {AXIS_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {data?.leader && <span className="text-indigo-400">Leader: {data.leader.name}</span>}
      </div>

      {data?.note && <p className="text-xs text-zinc-400 italic py-3 text-center">{data.note}</p>}

      {pts.length > 0 && (
        <>
          <div className="relative bg-zinc-900/40 border border-zinc-800 rounded-lg" style={{ height: 280 }}>
            {/* quadrant divider lines */}
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-zinc-700/60" />
            <div className="absolute top-1/2 left-0 right-0 h-px bg-zinc-700/60" />
            {/* axis labels */}
            <span className="absolute bottom-1 left-2 text-[8px] text-zinc-400">{data?.xAxis.low}</span>
            <span className="absolute bottom-1 right-2 text-[8px] text-zinc-400">{data?.xAxis.high}</span>
            <span className="absolute top-1 left-2 text-[8px] text-zinc-400 rotate-0">{data?.yAxis.high}</span>
            <span className="absolute bottom-5 left-2 text-[8px] text-zinc-400">{data?.yAxis.low}</span>
            {pts.map((p) => (
              <div
                key={p.id}
                className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
                style={{ left: `${px(p.x)}%`, top: `${py(p.y)}%` }}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${THREAT_DOT[p.threatLevel] || 'bg-zinc-400'} ring-2 ring-zinc-950`} />
                <span className="text-[9px] text-zinc-300 mt-0.5 whitespace-nowrap bg-zinc-950/80 px-1 rounded">{p.name}</span>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-zinc-400 text-center">
            {data?.xAxis.axis} (X) vs {data?.yAxis.axis} (Y) · dot color = threat level
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(data?.quadrants || {}).map(([q, names]) => (
              <div key={q} className="bg-zinc-900/60 border border-zinc-800 rounded px-2 py-1.5">
                <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{q.replace('-', ' / ')}</p>
                <p className="text-[10px] text-zinc-300">{names.length > 0 ? names.join(', ') : '—'}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
