'use client';

/**
 * PgCarePanel — the care-log macros that had no UI before this rebuild:
 * feed history + today's feed stats, diaper history, activity logging +
 * history, medicine history, and pumping (a real macro pair, but tracked
 * per-caregiver rather than per-child — see the "shared, not per-child"
 * note in the Pumping sub-view below, honestly reflecting the backend's
 * actual data model rather than pretending it's scoped to `childId`).
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Loader2, Milk, Baby, Activity, Pill, Droplets, ClipboardList,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type SubTab = 'feeding' | 'diapers' | 'activities' | 'medicine' | 'pumping';
const SUBS: { id: SubTab; label: string; icon: typeof Milk }[] = [
  { id: 'feeding', label: 'Feeding', icon: Milk },
  { id: 'diapers', label: 'Diapers', icon: Baby },
  { id: 'activities', label: 'Activities', icon: Activity },
  { id: 'medicine', label: 'Medicine', icon: Pill },
  { id: 'pumping', label: 'Pumping', icon: Droplets },
];

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function dateTimeOf(iso: string) {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Feeding ────────────────────────────────────────────────────────────
interface FeedEntry { id: string; kind: string; amountMl: number | null; durationMin: number | null; side: string | null; food: string | null; at: string }
interface FeedStats { feedsToday: number; byKind: Record<string, number>; bottleMlToday: number; nursingMinToday: number; lastFeedAt: string | null; lastBottleMl: number | null }

function FeedingView({ childId }: { childId: string }) {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [stats, setStats] = useState<FeedStats | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [h, s] = await Promise.all([
      lensRun('parenting', 'feed-history', { childId, days: 7 }),
      lensRun('parenting', 'feed-stats', { childId }),
    ]);
    setEntries(h.data?.result?.entries || []);
    setStats((s.data?.result as FeedStats | null) || null);
    setLoading(false);
  }, [childId]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) return <PanelLoading />;

  return (
    <div className="space-y-3">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Feeds today" value={stats.feedsToday} />
          <Stat label="Bottle ml today" value={stats.bottleMlToday} />
          <Stat label="Nursing min today" value={stats.nursingMinToday} />
          <Stat label="Last feed" value={stats.lastFeedAt ? timeOf(stats.lastFeedAt) : '—'} />
        </div>
      )}
      <HistoryList
        entries={entries}
        empty="No feeds logged in the last 7 days."
        render={(e: FeedEntry) => (
          <span className="text-xs text-zinc-200 capitalize">
            {e.kind}
            {e.amountMl ? ` · ${e.amountMl}ml` : ''}
            {e.durationMin ? ` · ${e.durationMin}m` : ''}
            {e.side ? ` · ${e.side}` : ''}
            {e.food ? ` · ${e.food}` : ''}
          </span>
        )}
      />
    </div>
  );
}

// ── Diapers ────────────────────────────────────────────────────────────
interface DiaperEntry { id: string; kind: string; at: string }
interface DiaperHistory { entries: DiaperEntry[]; count: number; todayCount: number; byKindToday: Record<string, number> }

function DiapersView({ childId }: { childId: string }) {
  const [data, setData] = useState<DiaperHistory | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('parenting', 'diaper-history', { childId, days: 7 });
    setData((r.data?.result as DiaperHistory | null) || null);
    setLoading(false);
  }, [childId]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) return <PanelLoading />;

  return (
    <div className="space-y-3">
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Today" value={data.todayCount} />
          <Stat label="Wet today" value={data.byKindToday.wet ?? 0} />
          <Stat label="Dirty today" value={data.byKindToday.dirty ?? 0} />
          <Stat label="Mixed today" value={data.byKindToday.mixed ?? 0} />
        </div>
      )}
      <HistoryList
        entries={data?.entries || []}
        empty="No diapers logged in the last 7 days."
        render={(e: DiaperEntry) => <span className="text-xs text-zinc-200 capitalize">{e.kind}</span>}
      />
    </div>
  );
}

// ── Activities ─────────────────────────────────────────────────────────
const ACTIVITY_KINDS = ['tummy_time', 'bath', 'play', 'potty', 'outdoors', 'reading', 'other'] as const;
interface ActivityEntry { id: string; kind: string; durationMin: number; note: string | null; at: string }

function ActivitiesView({ childId }: { childId: string }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ kind: 'play' as string, durationMin: '', note: '' });
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('parenting', 'activity-history', { childId, days: 7 });
    setEntries(r.data?.result?.entries || []);
    setLoading(false);
  }, [childId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const log = async () => {
    const r = await lensRun('parenting', 'activity-log', {
      childId, kind: form.kind, durationMin: Number(form.durationMin) || 0, note: form.note.trim() || undefined,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to log activity'); return; }
    setError(null);
    setForm({ kind: 'play', durationMin: '', note: '' });
    await refresh();
  };

  if (loading) return <PanelLoading />;

  return (
    <div className="space-y-3">
      {error && <ErrorBanner text={error} />}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
          <ClipboardList className="w-3.5 h-3.5 text-rose-400" /> Log activity
        </h3>
        <div className="grid grid-cols-3 gap-2">
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
            {ACTIVITY_KINDS.map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}
          </select>
          <input placeholder="Duration (min)" inputMode="numeric" value={form.durationMin}
            onChange={(e) => setForm({ ...form, durationMin: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={log}
            className="flex items-center justify-center gap-1 bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium rounded-lg">
            Log
          </button>
        </div>
        <input placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
      </section>
      <HistoryList
        entries={entries}
        empty="No activities logged in the last 7 days."
        render={(e: ActivityEntry) => (
          <span className="text-xs text-zinc-200 capitalize">
            {e.kind.replace('_', ' ')}{e.durationMin ? ` · ${e.durationMin}m` : ''}{e.note ? ` · ${e.note}` : ''}
          </span>
        )}
      />
    </div>
  );
}

// ── Medicine ───────────────────────────────────────────────────────────
interface MedEntry { id: string; name: string; dose: string | null; at: string }

function MedicineView({ childId }: { childId: string }) {
  const [entries, setEntries] = useState<MedEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('parenting', 'medicine-history', { childId, days: 14 });
    setEntries(r.data?.result?.entries || []);
    setLoading(false);
  }, [childId]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) return <PanelLoading />;

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-zinc-400">Last 14 days. Log a new dose from the Today tab&apos;s quick-log.</p>
      <HistoryList
        entries={entries}
        empty="No medicine logged in the last 14 days."
        render={(e: MedEntry) => <span className="text-xs text-zinc-200">{e.name}{e.dose ? ` · ${e.dose}` : ''}</span>}
      />
    </div>
  );
}

// ── Pumping (per-caregiver, not per-child — honest about the real data model) ──
interface PumpEntry { id: string; amountMl: number; side: string; durationMin: number; at: string }
interface PumpHistory { entries: PumpEntry[]; count: number; mlToday: number }

function PumpingView() {
  const [data, setData] = useState<PumpHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ amountMl: '', side: 'both' as string, durationMin: '' });
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('parenting', 'pump-history', { days: 7 });
    setData((r.data?.result as PumpHistory | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const log = async () => {
    if (!(Number(form.amountMl) > 0)) { setError('Enter an amount in ml.'); return; }
    const r = await lensRun('parenting', 'pump-log', {
      amountMl: Number(form.amountMl), side: form.side, durationMin: Number(form.durationMin) || 0,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to log pumping session'); return; }
    setError(null);
    setForm({ amountMl: '', side: 'both', durationMin: '' });
    await refresh();
  };

  if (loading) return <PanelLoading />;

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-zinc-400">
        Pumping is tracked per caregiver, not per child — the backend has no child-specific pumping record.
      </p>
      {error && <ErrorBanner text={error} />}
      {data && (
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Sessions (7d)" value={data.count} />
          <Stat label="ml today" value={data.mlToday} />
        </div>
      )}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <h3 className="text-xs font-semibold text-zinc-300">Log pumping session</h3>
        <div className="grid grid-cols-3 gap-2">
          <input placeholder="Amount ml" inputMode="numeric" value={form.amountMl}
            onChange={(e) => setForm({ ...form, amountMl: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
            {['left', 'right', 'both'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input placeholder="Duration min" inputMode="numeric" value={form.durationMin}
            onChange={(e) => setForm({ ...form, durationMin: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        </div>
        <button type="button" onClick={log}
          className="w-full flex items-center justify-center gap-1 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium rounded-lg py-1.5">
          Log session
        </button>
      </section>
      <HistoryList
        entries={data?.entries || []}
        empty="No pumping sessions logged in the last 7 days."
        render={(e: PumpEntry) => <span className="text-xs text-zinc-200">{e.amountMl}ml · {e.side}{e.durationMin ? ` · ${e.durationMin}m` : ''}</span>}
      />
    </div>
  );
}

// ── Shared bits ────────────────────────────────────────────────────────
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2.5 text-center">
      <p className="text-base font-bold text-zinc-100">{value}</p>
      <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}
function PanelLoading() {
  return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
}
function ErrorBanner({ text }: { text: string }) {
  return <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{text}</div>;
}
function HistoryList<T extends { id: string; at: string }>({ entries, empty, render }: { entries: T[]; empty: string; render: (e: T) => ReactNode }) {
  if (entries.length === 0) {
    return <p className="text-[11px] text-zinc-400 italic py-6 text-center">{empty}</p>;
  }
  return (
    <ul className="space-y-1">
      {entries.map((e) => (
        <li key={e.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
          {render(e)}
          <span className="text-[10px] text-zinc-400 font-mono">{dateTimeOf(e.at)}</span>
        </li>
      ))}
    </ul>
  );
}

export function PgCarePanel({ childId }: { childId: string }) {
  const [sub, setSub] = useState<SubTab>('feeding');

  return (
    <div className="space-y-3">
      <nav className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Care log category">
        {SUBS.map((s) => {
          const Icon = s.icon;
          const active = sub === s.id;
          return (
            <button key={s.id} type="button" role="tab" aria-selected={active} onClick={() => setSub(s.id)}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-rose-500',
                active ? 'bg-rose-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800')}>
              <Icon className="w-3.5 h-3.5" /> {s.label}
            </button>
          );
        })}
      </nav>
      {sub === 'feeding' && <FeedingView childId={childId} />}
      {sub === 'diapers' && <DiapersView childId={childId} />}
      {sub === 'activities' && <ActivitiesView childId={childId} />}
      {sub === 'medicine' && <MedicineView childId={childId} />}
      {sub === 'pumping' && <PumpingView />}
    </div>
  );
}
