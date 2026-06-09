'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { NotebookPen, Plus, Loader2, Star } from 'lucide-react';

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
              <button aria-label="Favorite" key={n} onClick={() => setEffectiveness(n)}>
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
            <p className="text-[10px] text-gray-400 mt-1">
              {new Date(e.createdAt).toLocaleDateString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
