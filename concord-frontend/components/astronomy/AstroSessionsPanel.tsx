'use client';

/**
 * AstroSessionsPanel — observing sessions with sky-condition logging.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Moon, ChevronRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Session {
  id: string; date: string; location: string | null; bortle: number;
  seeing: string; transparency: string; notes: string | null; observationCount: number;
}
interface Observation { id: string; targetName: string; date: string; rating: number }

const QUALITY = ['excellent', 'good', 'average', 'poor'];

export function AstroSessionsPanel({ onChange }: { onChange: () => void }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), location: '', bortle: '5', seeing: 'average', transparency: 'average' });
  const [open, setOpen] = useState<string | null>(null);
  const [openObs, setOpenObs] = useState<Observation[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('astronomy', 'session-list', {});
    setSessions(r.data?.result?.sessions || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = async () => {
    const r = await lensRun('astronomy', 'session-create', {
      date: form.date, location: form.location.trim(),
      bortle: Number(form.bortle) || 5, seeing: form.seeing, transparency: form.transparency,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ date: new Date().toISOString().slice(0, 10), location: '', bortle: '5', seeing: 'average', transparency: 'average' });
    setShowAdd(false); setError(null);
    await refresh();
  };
  const openSession = async (id: string) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    const r = await lensRun('astronomy', 'session-detail', { id });
    setOpenObs(r.data?.ok === false ? [] : (r.data?.result?.observations || []));
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> New session
        </button>
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {showAdd && (
        <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.bortle} onChange={(e) => setForm({ ...form, bortle: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((b) => <option key={b} value={b}>Bortle {b}</option>)}
          </select>
          <select value={form.seeing} onChange={(e) => setForm({ ...form, seeing: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {QUALITY.map((q) => <option key={q} value={q}>Seeing: {q}</option>)}
          </select>
          <select value={form.transparency} onChange={(e) => setForm({ ...form, transparency: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {QUALITY.map((q) => <option key={q} value={q}>Transparency: {q}</option>)}
          </select>
          <button type="button" onClick={add}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Log session</button>
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No observing sessions logged.
        </div>
      ) : (
        <ul className="space-y-2">
          {sessions.map((ses) => (
            <li key={ses.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl overflow-hidden">
              <button type="button" onClick={() => openSession(ses.id)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-zinc-900">
                <Moon className="w-4 h-4 text-indigo-400" />
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{ses.date}{ses.location ? ` · ${ses.location}` : ''}</p>
                  <p className="text-[11px] text-zinc-400">
                    Bortle {ses.bortle} · seeing {ses.seeing} · {ses.observationCount} observations
                  </p>
                </div>
                <ChevronRight className={cn('w-4 h-4 text-zinc-600 ml-auto transition-transform', open === ses.id && 'rotate-90')} />
              </button>
              {open === ses.id && (
                <div className="border-t border-zinc-800 px-3 py-2 bg-zinc-950/50">
                  {openObs.length === 0 ? (
                    <p className="text-[11px] text-zinc-400 italic">No observations linked to this session.</p>
                  ) : (
                    <ul className="space-y-1">
                      {openObs.map((o) => (
                        <li key={o.id} className="flex items-center justify-between text-[11px]">
                          <span className="text-zinc-300">{o.targetName}</span>
                          <span className="text-amber-400">{'★'.repeat(o.rating)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
