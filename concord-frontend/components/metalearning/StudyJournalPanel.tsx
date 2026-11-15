'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { NotebookPen, Plus, Loader2, Star, Trash2, Pencil } from 'lucide-react';

interface JournalEntry {
  id: string;
  topic: string;
  technique: string;
  minutesStudied: number;
  effectiveness: number;
  reflection: string;
  createdAt: string;
}
interface TechniqueEff {
  technique: string;
  sessions: number;
  avgEffectiveness: number;
  totalMinutes: number;
}

export function StudyJournalPanel() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [techStats, setTechStats] = useState<TechniqueEff[]>([]);
  const [totalMinutes, setTotalMinutes] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [topic, setTopic] = useState('');
  const [technique, setTechnique] = useState('');
  const [minutes, setMinutes] = useState('30');
  const [effectiveness, setEffectiveness] = useState(3);
  const [reflection, setReflection] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // FIX-metalearning-003: journal entries gain an edit path (journalUpdate).
  const [editEntryId, setEditEntryId] = useState<string | null>(null);
  const [entryEdit, setEntryEdit] = useState({ reflection: '', topic: '', minutesStudied: '30' });
  const saveEntry = async (entryId: string) => {
    if (!entryEdit.reflection.trim()) return;
    setBusyId(entryId);
    try {
      const { data: r } = await lensRun<any>('metalearning', 'journalUpdate', {
        id: entryId, reflection: entryEdit.reflection.trim(), topic: entryEdit.topic,
        minutesStudied: Number(entryEdit.minutesStudied),
      });
      if (r?.ok === false) { setErr(r.error || 'Update failed'); return; }
      setEditEntryId(null);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Update failed');
    } finally { setBusyId(null); }
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { data: r } = await lensRun<any>('metalearning', 'journalList', {});
      if (r?.ok === false) { setErr(r.error || 'Failed to load journal'); return; }
      const res = r?.result || r;
      setEntries(res.entries || []);
      setTechStats(res.techniqueEffectiveness || []);
      setTotalMinutes(res.totalMinutes || 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load journal');
    } finally { setLoading(false); }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  const add = async () => {
    if (!reflection.trim()) return;
    setBusy(true);
    try {
      const { data: r } = await lensRun<any>('metalearning', 'journalAdd', {
        topic, technique, minutesStudied: Number(minutes) || 0, effectiveness, reflection,
      });
      if (r?.ok === false) { setErr(r.error || 'Failed to add entry'); return; }
      setTopic(''); setTechnique(''); setMinutes('30'); setEffectiveness(3);
      setReflection(''); setShowForm(false);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to add entry');
    } finally { setBusy(false); }
  };

  const remove = async (entryId: string) => {
    setBusyId(entryId);
    try {
      const { data: r } = await lensRun<any>('metalearning', 'journalDelete', { entryId });
      if (r?.ok === false) { setErr(r.error || 'Delete failed'); return; }
      setConfirmDeleteId(null);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed');
    } finally { setBusyId(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2 text-sm">
          <NotebookPen className="w-4 h-4 text-neon-cyan" /> Study Journal
          <span className="text-xs text-gray-400 font-normal">
            {entries.length} entries · {totalMinutes}min
          </span>
        </h3>
        <button onClick={() => setShowForm((s) => !s)}
          className="text-xs text-neon-cyan hover:underline flex items-center gap-1">
          <Plus className="w-3 h-3" /> {showForm ? 'Cancel' : 'Log session'}
        </button>
      </div>

      {err && <p className="text-xs text-red-400">{err}</p>}
      {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}

      {showForm && (
        <div className="bg-lattice-deep rounded-lg p-3 space-y-2 border border-white/5">
          <div className="flex gap-2">
            <input value={topic} onChange={(e) => setTopic(e.target.value)}
              placeholder="Topic" className="input-lattice flex-1 text-sm" />
            <input value={technique} onChange={(e) => setTechnique(e.target.value)}
              placeholder="Technique used" className="input-lattice flex-1 text-sm" />
          </div>
          <div className="flex gap-2 items-center">
            <input value={minutes} onChange={(e) => setMinutes(e.target.value)}
              type="number" placeholder="Minutes" className="input-lattice w-24 text-sm" />
            <span className="text-xs text-gray-400">Effectiveness:</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button aria-label={`Effectiveness ${n} of 5`} key={n} onClick={() => setEffectiveness(n)}>
                <Star className={`w-4 h-4 ${n <= effectiveness ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}`} />
              </button>
            ))}
          </div>
          <textarea value={reflection} onChange={(e) => setReflection(e.target.value)}
            rows={3} placeholder="What worked? What didn't? Reflection…"
            className="input-lattice w-full text-sm" />
          <button onClick={add} disabled={!reflection.trim() || busy}
            className="btn-neon text-sm w-full disabled:opacity-50">
            {busy ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : 'Save Entry'}
          </button>
        </div>
      )}

      {techStats.length > 0 && (
        <div className="bg-lattice-deep rounded-lg p-3 border border-white/5">
          <p className="text-xs text-gray-400 mb-1.5">Technique effectiveness (from your log)</p>
          <div className="space-y-1">
            {techStats.map((t) => (
              <div key={t.technique} className="flex items-center justify-between text-xs">
                <span className="text-gray-300">{t.technique}</span>
                <span className="flex items-center gap-1 text-gray-400">
                  {t.sessions} session{t.sessions !== 1 ? 's' : ''}
                  <span className="text-yellow-400 ml-1">{t.avgEffectiveness}★</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {entries.length === 0 && !loading && (
        <p className="text-center py-6 text-gray-400 text-sm">No journal entries yet.</p>
      )}

      <div className="space-y-2 max-h-80 overflow-y-auto">
        {entries.map((e) => (
          <div key={e.id} className="bg-lattice-surface rounded-lg p-3 border border-white/5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-200">
                {e.topic}{e.technique && ` · ${e.technique}`}
              </span>
              <span className="text-[10px] text-gray-400 flex items-center gap-1">
                {e.minutesStudied}min
                <span className="text-yellow-400">{'★'.repeat(e.effectiveness)}</span>
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1">{e.reflection}</p>
            {editEntryId === e.id && (
              <div className="mt-2 space-y-2 border-t border-white/5 pt-2">
                <textarea value={entryEdit.reflection} onChange={(ev) => setEntryEdit((f) => ({ ...f, reflection: ev.target.value }))}
                  aria-label="Edit entry reflection" placeholder="Reflection" rows={2} className="input-lattice w-full text-sm" />
                <div className="flex gap-2">
                  <input value={entryEdit.topic} onChange={(ev) => setEntryEdit((f) => ({ ...f, topic: ev.target.value }))}
                    aria-label="Edit entry topic" placeholder="Topic" className="input-lattice flex-1 text-sm" />
                  <input type="number" value={entryEdit.minutesStudied} onChange={(ev) => setEntryEdit((f) => ({ ...f, minutesStudied: ev.target.value }))}
                    aria-label="Edit entry minutes" placeholder="Minutes" className="input-lattice w-24 text-sm" />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => saveEntry(e.id)} disabled={!entryEdit.reflection.trim() || busyId === e.id}
                    className="btn-neon text-sm px-3 disabled:opacity-50">Save</button>
                  <button onClick={() => setEditEntryId(null)} className="text-xs text-gray-400 px-2">Cancel</button>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between mt-1">
              <p className="text-[10px] text-gray-400">
                {new Date(e.createdAt).toLocaleDateString()}
              </p>
              <span className="flex items-center gap-1.5">
              <button onClick={() => {
                  setEditEntryId(editEntryId === e.id ? null : e.id);
                  setEntryEdit({ reflection: e.reflection, topic: e.topic || '', minutesStudied: String(e.minutesStudied) });
                }}
                className="text-gray-600 hover:text-gray-200" title="Edit entry" aria-label={`Edit journal entry ${e.topic}`}>
                <Pencil className="w-3.5 h-3.5" />
              </button>
              {confirmDeleteId === e.id ? (
                <button onClick={() => remove(e.id)} disabled={busyId === e.id}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/25 hover:bg-red-500/35 text-red-300 disabled:opacity-50"
                  title="Confirm delete — removes this journal entry">
                  Delete?
                </button>
              ) : (
                <button onClick={() => setConfirmDeleteId(e.id)}
                  className="text-gray-600 hover:text-red-400" title="Delete entry" aria-label={`Delete journal entry ${e.topic}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
