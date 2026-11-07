'use client';

/**
 * AstroSessionsPanel — observing sessions with sky-condition logging.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Moon, ChevronRight, Radio } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { calendarDateKey } from '@/lib/calendar-date';
import { cn } from '@/lib/utils';
import { AstroCoObservePanel } from './AstroCoObservePanel';

interface Session {
  id: string; title: string | null; date: string; location: string | null; bortle: number;
  seeing: string; transparency: string; notes: string | null; observationCount: number;
  // Multi-observer co-observing (server/domains/astronomy.js `session-share`)
  // — absent/false until the owner explicitly shares this session.
  roomId?: string | null; shared?: boolean;
}
interface Observation { id: string; targetName: string; date: string; rating: number }

const QUALITY = ['excellent', 'good', 'average', 'poor'];

export function AstroSessionsPanel({ onChange }: { onChange: () => void }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: '', date: calendarDateKey(), location: '', bortle: '5', seeing: 'average', transparency: 'average', notes: '' });
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: '', location: '', bortle: '5', seeing: 'average', transparency: 'average', notes: '' });
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [openObs, setOpenObs] = useState<Observation[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('astronomy', 'session-list', {});
    if (r.data?.ok === false) {
      setError(r.data?.error || 'Could not load sessions.');
      setLoading(false);
      return;
    }
    setError(null);
    setSessions(r.data?.result?.sessions || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = async () => {
    const r = await lensRun('astronomy', 'session-create', {
      title: form.title.trim(), date: form.date, location: form.location.trim(),
      bortle: Number(form.bortle) || 5, seeing: form.seeing, transparency: form.transparency,
      notes: form.notes.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    // F7/S5: a create acknowledges itself, naming what landed.
    setNotice(`Session logged — ${form.title.trim() || form.date}`);
    setForm({ title: '', date: calendarDateKey(), location: '', bortle: '5', seeing: 'average', transparency: 'average', notes: '' });
    setShowAdd(false); setError(null);
    await refresh();
  };
  const startEdit = (ses: Session) => {
    setEditing(ses.id);
    setEditForm({
      title: ses.title || '', location: ses.location || '', bortle: String(ses.bortle),
      seeing: ses.seeing, transparency: ses.transparency, notes: ses.notes || '',
    });
  };
  const saveEdit = async (id: string) => {
    const r = await lensRun('astronomy', 'session-update', {
      id, title: editForm.title.trim(), location: editForm.location.trim(),
      bortle: Number(editForm.bortle) || 5, seeing: editForm.seeing,
      transparency: editForm.transparency, notes: editForm.notes.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setEditing(null); setError(null); setNotice('Session updated.');
    await refresh();
  };
  const del = async (id: string) => {
    const r = await lensRun('astronomy', 'session-delete', { id });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setConfirmDel(null); setOpen(null); setError(null); setNotice('Session deleted.');
    await refresh();
  };
  const openSession = async (id: string) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    const r = await lensRun('astronomy', 'session-detail', { id });
    setOpenObs(r.data?.ok === false ? [] : (r.data?.result?.observations || []));
  };

  const [sharing, setSharing] = useState<string | null>(null);
  const shareSession = async (id: string) => {
    setSharing(id);
    const r = await lensRun('astronomy', 'session-share', { id });
    if (r.data?.ok === false) setError(r.data?.error || 'Failed to share session');
    else setError(null);
    setSharing(null);
    await refresh(); // session-list echoes back the new roomId/shared flag
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
      {notice && <div className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-900/50 rounded-lg px-3 py-2">{notice}</div>}

      {showAdd && (
        <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <input placeholder="Session name (e.g. Backyard meteor watch)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
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
                  <p className="text-sm font-semibold text-zinc-100">{ses.title ? `${ses.title} — ` : ''}{ses.date}{ses.location ? ` · ${ses.location}` : ''}</p>
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

                  {editing === ses.id ? (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <input placeholder="Session name" value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                        className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
                      <input placeholder="Location" value={editForm.location} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                        className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
                      <select value={editForm.bortle} onChange={(e) => setEditForm({ ...editForm, bortle: e.target.value })}
                        className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((b) => <option key={b} value={b}>Bortle {b}</option>)}
                      </select>
                      <select value={editForm.seeing} onChange={(e) => setEditForm({ ...editForm, seeing: e.target.value })}
                        className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
                        {QUALITY.map((q) => <option key={q} value={q}>Seeing: {q}</option>)}
                      </select>
                      <select value={editForm.transparency} onChange={(e) => setEditForm({ ...editForm, transparency: e.target.value })}
                        className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
                        {QUALITY.map((q) => <option key={q} value={q}>Transparency: {q}</option>)}
                      </select>
                      <input placeholder="Notes" value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                        className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
                      <div className="col-span-2 flex gap-2">
                        <button type="button" onClick={() => saveEdit(ses.id)}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium rounded-lg px-2.5 py-1.5">Save changes</button>
                        <button type="button" onClick={() => setEditing(null)}
                          className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium rounded-lg px-2.5 py-1.5">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={() => startEdit(ses)}
                        className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-2.5 py-1.5 text-[11px] font-medium text-zinc-200">
                        Edit session
                      </button>
                      {confirmDel === ses.id ? (
                        <button type="button" onClick={() => del(ses.id)}
                          className="rounded-lg bg-rose-700 hover:bg-rose-600 px-2.5 py-1.5 text-[11px] font-medium text-white">
                          Confirm delete?
                        </button>
                      ) : (
                        <button type="button" onClick={() => setConfirmDel(ses.id)}
                          className="rounded-lg bg-zinc-800 hover:bg-rose-900/60 px-2.5 py-1.5 text-[11px] font-medium text-rose-300">
                          Delete
                        </button>
                      )}
                    </div>
                  )}

                  {ses.shared && ses.roomId ? (
                    <AstroCoObservePanel roomId={ses.roomId} />
                  ) : (
                    <button
                      type="button" onClick={() => shareSession(ses.id)} disabled={sharing === ses.id}
                      className="mt-2 flex items-center gap-1.5 rounded-lg bg-indigo-950/50 border border-indigo-900/50 px-2.5 py-1.5 text-[11px] font-medium text-indigo-300 hover:bg-indigo-900/40 disabled:opacity-50"
                    >
                      {sharing === ses.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radio className="w-3.5 h-3.5" />}
                      Share for co-observing (live, multi-observer)
                    </button>
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
