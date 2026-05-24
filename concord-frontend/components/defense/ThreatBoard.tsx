'use client';

/**
 * ThreatBoard — watchlist board with severity escalation ladder.
 * Backed by defense.threat-add / threat-escalate / threat-delete /
 * threat-board macros.
 */

import { useState, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Plus, Trash2, Loader2, AlertTriangle, ChevronUp, ChevronDown, ShieldAlert } from 'lucide-react';

interface Threat {
  id: string;
  name: string;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'watching' | 'engaged' | 'neutralized';
  region: string;
  note: string;
  history: { at: string; event: string; severity: string }[];
}

interface ThreatBoardResult {
  threats: Threat[];
  total: number;
  bySeverity: Record<string, number>;
  byStatus: Record<string, number>;
  highestSeverity: string;
  activeWatch: number;
}

const SEV_COLOR: Record<string, string> = {
  low: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5',
  medium: 'text-amber-400 border-amber-500/30 bg-amber-500/5',
  high: 'text-orange-400 border-orange-500/30 bg-orange-500/5',
  critical: 'text-red-400 border-red-500/40 bg-red-500/10',
};

const STATUS_COLOR: Record<string, string> = {
  watching: 'text-zinc-400',
  engaged: 'text-cyan-400',
  neutralized: 'text-green-400',
};

const STATUSES = ['watching', 'engaged', 'neutralized'] as const;

export function ThreatBoard() {
  const [board, setBoard] = useState<ThreatBoardResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [severity, setSeverity] = useState<Threat['severity']>('low');
  const [region, setRegion] = useState('');
  const [note, setNote] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<ThreatBoardResult>('defense', 'threat-board', {});
    if (r.data?.ok && r.data.result) setBoard(r.data.result);
    else setError(r.data?.error || 'Failed to load threat board');
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = useCallback(async () => {
    if (!name.trim()) {
      setError('Threat name is required');
      return;
    }
    setBusy(true);
    setError(null);
    const r = await lensRun('defense', 'threat-add', {
      name: name.trim(),
      category: category.trim() || 'general',
      severity,
      region: region.trim(),
      note: note.trim(),
    });
    if (r.data?.ok) {
      setName('');
      setCategory('');
      setRegion('');
      setNote('');
      setSeverity('low');
      await refresh();
    } else {
      setError(r.data?.error || 'Failed to add threat');
    }
    setBusy(false);
  }, [name, category, severity, region, note, refresh]);

  const escalate = useCallback(async (id: string, direction: 'up' | 'down') => {
    setBusy(true);
    const r = await lensRun('defense', 'threat-escalate', {
      id,
      direction: direction === 'up' ? 'up' : 'down',
    });
    if (r.data?.ok) await refresh();
    else setError(r.data?.error || 'Failed to escalate threat');
    setBusy(false);
  }, [refresh]);

  const setStatus = useCallback(async (threat: Threat) => {
    const idx = STATUSES.indexOf(threat.status);
    const next = STATUSES[(idx + 1) % STATUSES.length];
    setBusy(true);
    const r = await lensRun('defense', 'threat-update', {
      id: threat.id,
      status: next,
    });
    if (r.data?.ok) await refresh();
    else setError(r.data?.error || 'Failed to update status');
    setBusy(false);
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    setBusy(true);
    const r = await lensRun('defense', 'threat-delete', { id });
    if (r.data?.ok) await refresh();
    else setError(r.data?.error || 'Failed to delete threat');
    setBusy(false);
  }, [refresh]);

  const threats = board?.threats || [];

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-red-400" />
          <h3 className="text-sm font-semibold text-white">Threat Tracking Board</h3>
        </div>
        {board && (
          <div className="flex gap-3 text-[11px]">
            <span className="text-red-400">{board.bySeverity.critical || 0} critical</span>
            <span className="text-orange-400">{board.bySeverity.high || 0} high</span>
            <span className="text-zinc-400">{board.activeWatch} active</span>
          </div>
        )}
      </header>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-zinc-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {threats.map((t) => (
            <div
              key={t.id}
              className={`rounded border px-2.5 py-2 ${SEV_COLOR[t.severity]}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-[10px] font-bold uppercase shrink-0 ${SEV_COLOR[t.severity].split(' ')[0]}`}>
                    {t.severity}
                  </span>
                  <span className="text-xs text-white truncate">{t.name}</span>
                  <span className="text-[10px] text-zinc-400 shrink-0">{t.category}</span>
                  {t.region && <span className="text-[10px] text-zinc-400 shrink-0">{t.region}</span>}
                  <button
                    onClick={() => setStatus(t)}
                    disabled={busy}
                    className={`text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 shrink-0 ${STATUS_COLOR[t.status]} disabled:opacity-50`}
                    title="Cycle status"
                  >
                    {t.status}
                  </button>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => escalate(t.id, 'up')}
                    disabled={busy || t.severity === 'critical'}
                    aria-label="Escalate"
                    className="p-1 text-zinc-400 hover:text-red-400 disabled:opacity-30"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => escalate(t.id, 'down')}
                    disabled={busy || t.severity === 'low'}
                    aria-label="De-escalate"
                    className="p-1 text-zinc-400 hover:text-green-400 disabled:opacity-30"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => remove(t.id)}
                    disabled={busy}
                    aria-label="Delete threat"
                    className="p-1 text-zinc-400 hover:text-red-400 disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {t.note && <p className="text-[10px] text-zinc-400 mt-1">{t.note}</p>}
              {t.history.length > 1 && (
                <p className="text-[10px] text-zinc-400 mt-1">
                  {t.history.length} escalation events · latest:{' '}
                  {t.history[t.history.length - 1].event}
                </p>
              )}
            </div>
          ))}
          {threats.length === 0 && (
            <div className="text-center py-6 text-xs text-zinc-400">
              <AlertTriangle className="w-6 h-6 mx-auto mb-2 opacity-30" />
              No threats on the board. Add one below.
            </div>
          )}
        </div>
      )}

      {/* New threat */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 border-t border-zinc-800 pt-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Threat name"
          className="col-span-2 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
        />
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Category"
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
        />
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as Threat['severity'])}
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
        >
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
          <option value="critical">critical</option>
        </select>
        <input
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          placeholder="Region"
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
        />
      </div>
      <div className="flex gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
        />
        <button
          onClick={add}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-red-600 hover:bg-red-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Add Threat
        </button>
      </div>
    </section>
  );
}
