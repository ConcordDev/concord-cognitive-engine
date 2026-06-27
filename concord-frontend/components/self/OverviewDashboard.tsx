'use client';

/**
 * OverviewDashboard — the customizable self overview. Calls self.overview
 * for layout-aware tiles (7-day aggregate per metric) and self.layout /
 * self.saveLayout to let the user pick which tiles appear. No seed data:
 * tiles show "—" until real readings exist.
 */

import { useEffect, useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Loader2, LayoutGrid, Check, SlidersHorizontal } from 'lucide-react';

interface Card { metric: string; label: string; unit: string; value: number | null; readings: number }
interface OverviewResult { tiles: string[]; cards: Card[]; totalReadings: number; hasData: boolean }
interface AvailableTile { key: string; label: string; unit: string }
interface LayoutResult { tiles: string[]; isDefault: boolean; available: AvailableTile[] }

export function OverviewDashboard({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [overview, setOverview] = useState<OverviewResult | null>(null);
  const [layout, setLayout] = useState<LayoutResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setLoadErr(null);
    try {
      const [ov, ly] = await Promise.all([
        lensRun<OverviewResult>('self', 'overview', {}),
        lensRun<LayoutResult>('self', 'layout', {}),
      ]);
      // A backend-reported failure (e.g. STATE unavailable) is a real error,
      // not an empty ledger — never swallow it into a silent "No data yet".
      if (ov.data && ov.data.ok === false) {
        throw new Error(ov.data.error || 'Could not load your overview.');
      }
      if (ov.data?.ok && ov.data.result) setOverview(ov.data.result);
      if (ly.data?.ok && ly.data.result) {
        setLayout(ly.data.result);
        setDraft(ly.data.result.tiles);
      }
    } catch (e) {
      setLoadErr(e instanceof Error && e.message ? e.message : 'Could not load your overview.');
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const toggleTile = (key: string) => {
    setDraft((d) => {
      if (d.includes(key)) return d.filter((k) => k !== key);
      if (d.length >= 8) return d;
      return [...d, key];
    });
  };

  const saveLayout = async () => {
    setSaveErr(null);
    if (draft.length === 0) { setSaveErr('Pick at least one tile.'); return; }
    try {
      const r = await lensRun('self', 'saveLayout', { tiles: draft });
      if (r.data?.ok) { setEditing(false); void load(); onChanged(); }
      else setSaveErr(r.data?.error ?? 'Save failed.');
    } catch { setSaveErr('Network error.'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-rose-200">
          <LayoutGrid className="h-4 w-4 text-rose-500" aria-hidden /> This week
        </h3>
        <button
          onClick={() => { setEditing((v) => !v); setDraft(layout?.tiles ?? []); }}
          className="flex items-center gap-1 rounded border border-rose-900/40 px-2 py-1 text-xs text-rose-300 hover:text-rose-100"
        >
          <SlidersHorizontal className="h-3 w-3" /> {editing ? 'Done' : 'Customize'}
        </button>
      </div>

      {editing && layout && (
        <div className="rounded-lg border border-rose-900/40 bg-rose-950/10 p-3">
          <p className="mb-2 text-xs text-rose-700">Pick up to 8 tiles for your overview.</p>
          <div className="flex flex-wrap gap-1.5">
            {layout.available.map((t) => {
              const on = draft.includes(t.key);
              return (
                <button
                  key={t.key}
                  onClick={() => toggleTile(t.key)}
                  className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                    on ? 'bg-rose-600 text-white' : 'border border-rose-900/40 text-rose-400 hover:text-rose-200'
                  }`}
                  aria-pressed={on}
                >
                  {on && <Check className="h-3 w-3" aria-hidden />}
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => void saveLayout()}
              className="rounded bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500"
            >
              Save layout
            </button>
            <span className="text-[10px] text-rose-700">{draft.length}/8 selected</span>
          </div>
          {saveErr && <p className="mt-2 text-xs text-red-400">{saveErr}</p>}
        </div>
      )}

      {busy ? (
        <div role="status" className="flex items-center gap-2 text-xs text-rose-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span>Loading your overview…</span>
        </div>
      ) : loadErr ? (
        <div role="alert" className="rounded border border-red-900/40 bg-red-950/20 px-4 py-6 text-center text-xs text-red-300">
          <p className="mb-3">{loadErr}</p>
          <button
            onClick={() => void load()}
            className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
          >
            Retry
          </button>
        </div>
      ) : overview && overview.hasData && overview.cards.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {overview.cards.map((c) => (
              <div key={c.metric} className="rounded-lg border border-rose-900/40 bg-rose-950/10 p-3">
                <div className="text-[10px] uppercase tracking-wider text-rose-700">{c.label}</div>
                <div className="mt-1 font-mono text-xl font-semibold text-rose-200">
                  {c.value == null ? '—' : `${c.value}${c.unit}`}
                </div>
                <div className="mt-0.5 text-[10px] text-rose-800">
                  {c.readings} reading{c.readings === 1 ? '' : 's'} this week
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-rose-800">
            {overview.totalReadings} total reading{overview.totalReadings === 1 ? '' : 's'} in your ledger
            {layout?.isDefault ? ' · default layout' : ' · custom layout'}.
          </p>
        </>
      ) : (
        <p className="rounded border border-rose-900/30 bg-rose-950/10 px-4 py-8 text-center text-xs text-rose-600">
          No data yet. Log a reading or import a health export to fill your dashboard.
        </p>
      )}
    </div>
  );
}
