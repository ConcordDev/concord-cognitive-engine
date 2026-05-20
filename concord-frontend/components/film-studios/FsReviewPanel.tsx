'use client';

/**
 * FsReviewPanel — cut versions with Frame.io-style timecoded review notes.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, MessageSquare, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Version { id: string; label: string; stage: string; runtimeSec: number; noteCount: number; openNotes: number }
interface Note { id: string; timecodeSec: number; body: string; author: string; resolved: boolean }

const STAGES = ['assembly', 'rough_cut', 'fine_cut', 'picture_lock', 'final'];

function tc(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`;
}
function parseTc(v: string) {
  const parts = v.split(':').map((x) => Number(x) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(v) || 0;
}

export function FsReviewPanel({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [activeVersion, setActiveVersion] = useState<string>('');
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [vForm, setVForm] = useState({ label: '', stage: 'rough_cut', runtimeMin: '' });
  const [nForm, setNForm] = useState({ timecode: '', body: '', author: '' });

  const loadVersions = useCallback(async () => {
    const r = await lensRun('film-studios', 'version-list', { projectId });
    const list: Version[] = r.data?.result?.versions || [];
    setVersions(list);
    setActiveVersion((prev) => (list.some((v) => v.id === prev) ? prev : list[0]?.id || ''));
    setLoading(false);
    onChange();
  }, [projectId, onChange]);

  const loadNotes = useCallback(async () => {
    if (!activeVersion) { setNotes([]); return; }
    const r = await lensRun('film-studios', 'note-list', { versionId: activeVersion });
    setNotes(r.data?.result?.notes || []);
  }, [activeVersion]);

  useEffect(() => { void loadVersions(); }, [loadVersions]);
  useEffect(() => { void loadNotes(); }, [loadNotes]);

  const addVersion = async () => {
    if (!vForm.label.trim()) return;
    await lensRun('film-studios', 'version-create', {
      projectId, label: vForm.label.trim(), stage: vForm.stage,
      runtimeSec: (Number(vForm.runtimeMin) || 0) * 60,
    });
    setVForm({ label: '', stage: 'rough_cut', runtimeMin: '' });
    await loadVersions();
  };

  const addNote = async () => {
    if (!activeVersion || !nForm.body.trim()) return;
    await lensRun('film-studios', 'note-add', {
      versionId: activeVersion, timecodeSec: parseTc(nForm.timecode),
      body: nForm.body.trim(), author: nForm.author.trim(),
    });
    setNForm({ timecode: '', body: '', author: '' });
    await Promise.all([loadNotes(), loadVersions()]);
  };

  const toggleResolve = async (n: Note) => {
    await lensRun('film-studios', 'note-resolve', { id: n.id, resolved: !n.resolved });
    await Promise.all([loadNotes(), loadVersions()]);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* New version */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input placeholder="Version label" value={vForm.label} onChange={(e) => setVForm({ ...vForm, label: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <select value={vForm.stage} onChange={(e) => setVForm({ ...vForm, stage: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          {STAGES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <input placeholder="Runtime (min)" inputMode="numeric" value={vForm.runtimeMin}
          onChange={(e) => setVForm({ ...vForm, runtimeMin: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={addVersion}
          className="flex items-center justify-center gap-1 bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Version
        </button>
      </section>

      {versions.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic py-6 text-center">Create a cut version to start collecting review notes.</p>
      ) : (
        <>
          <select value={activeVersion} onChange={(e) => setActiveVersion(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-2 text-xs text-zinc-100">
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} · {v.stage.replace(/_/g, ' ')} · {v.openNotes} open notes
              </option>
            ))}
          </select>

          {/* New note */}
          <section className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
            <input placeholder="00:01:30" value={nForm.timecode} onChange={(e) => setNForm({ ...nForm, timecode: e.target.value })}
              className="w-24 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 font-mono" />
            <input placeholder="Note" value={nForm.body} onChange={(e) => setNForm({ ...nForm, body: e.target.value })}
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Author" value={nForm.author} onChange={(e) => setNForm({ ...nForm, author: e.target.value })}
              className="w-24 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={addNote}
              className="px-3 py-1.5 text-xs font-medium bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-lg">Add</button>
          </section>

          {/* Notes */}
          <section>
            <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
              <MessageSquare className="w-3.5 h-3.5 text-fuchsia-400" /> Review notes
            </h3>
            {notes.length === 0 ? (
              <p className="text-[11px] text-zinc-500 italic py-4 text-center">No notes on this version yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {notes.map((n) => (
                  <li key={n.id} className={cn('flex items-start gap-2 bg-zinc-900/70 border rounded-lg px-3 py-2',
                    n.resolved ? 'border-emerald-900/50' : 'border-zinc-800')}>
                    <span className="text-[10px] font-mono text-fuchsia-300 mt-0.5 shrink-0">{tc(n.timecodeSec)}</span>
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-xs', n.resolved ? 'text-zinc-500 line-through' : 'text-zinc-200')}>{n.body}</p>
                      <p className="text-[10px] text-zinc-500">{n.author}</p>
                    </div>
                    <button type="button" onClick={() => toggleResolve(n)}
                      className={cn('w-4 h-4 rounded flex items-center justify-center shrink-0',
                        n.resolved ? 'bg-emerald-600' : 'border border-zinc-600 hover:border-zinc-400')}>
                      {n.resolved && <Check className="w-3 h-3 text-white" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
