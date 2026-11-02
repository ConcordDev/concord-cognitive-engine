'use client';

/**
 * MemoryPanel — Settings > Memory. The user's view of what Concord remembers about them.
 *
 * Everything here is real server state from /api/user-memory (nothing is invented client-side):
 *   - opt-in switch (off by default; disabled with an explanation while the operator flag is off)
 *   - every remembered fact with its project, search, inline edit, delete, "why did you remember this?"
 *     (the user's own words, when, which chat) and the supersede history
 *   - pending contradictions waiting for the user's call (a fact they edited is never overwritten silently)
 *   - per-project forget / pause, delete everything, export
 * Deletes are optimistic and roll back visibly if the server refuses.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api/client';

export interface MemoryFact {
  id: string;
  project_id: string | null;
  kind: string;
  subject: string;
  value: string;
  status: 'active' | 'pending' | 'superseded';
  updated_at: number;
  use_count: number;
  user_edited: number;
}
interface WhyInfo { said: string | null; saidAt: number; sessionId: string | null; links: { target_kind: string; target_id: string }[]; userEdited: boolean }
interface HistoryItem { id: string; value: string; status: string; valid_from: number; valid_to: number | null }

const when = (ms: number) => new Date(ms).toLocaleString();

export default function MemoryPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [available, setAvailable] = useState(true);
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [search, setSearch] = useState('');
  const [project, setProject] = useState('');
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [open, setOpen] = useState<{ id: string; why?: WhyInfo; history?: HistoryItem[] } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, f] = await Promise.all([api.get('/api/user-memory/settings'), api.get('/api/user-memory/facts')]);
      setEnabled(!!s.data?.enabled);
      setAvailable(s.data?.available !== false);
      setFacts(f.data?.facts ?? []);
      setError(null);
    } catch {
      setError('Could not load your memory. Nothing was changed.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const fail = (msg: string) => { setNotice(null); setError(msg); };

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    try {
      await api.put('/api/user-memory/settings', { enabled: next });
      setError(null);
    } catch {
      setEnabled(!next);
      fail(next ? 'Memory is not available right now.' : 'Could not turn memory off. Try again.');
    }
  };

  const remove = async (id: string) => {
    const before = facts;
    setFacts((f) => f.filter((x) => x.id !== id));
    try {
      await api.delete(`/api/user-memory/facts/${id}`);
      setNotice('Forgotten, including its history.');
    } catch {
      setFacts(before);
      fail('Could not delete that memory. It is still saved.');
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await api.patch(`/api/user-memory/facts/${editing.id}`, { value: editing.value });
      setEditing(null);
      await load();
    } catch {
      fail('That edit was refused (empty, or it looks like a secret). Nothing changed.');
    }
  };

  const resolve = async (id: string) => {
    try { await api.post(`/api/user-memory/facts/${id}/resolve`, {}); await load(); }
    catch { fail('Could not apply the newer value.'); }
  };

  const toggleDetails = async (id: string) => {
    if (open?.id === id) { setOpen(null); return; }
    try {
      const [w, h] = await Promise.all([api.get(`/api/user-memory/facts/${id}/why`), api.get(`/api/user-memory/facts/${id}/history`)]);
      setOpen({ id, why: w.data?.why, history: h.data?.history });
    } catch { fail('Could not load the details for that memory.'); }
  };

  const forgetProject = async (p: string) => {
    try { await api.delete(`/api/user-memory/projects/${encodeURIComponent(p)}`); setNotice(`Forgot everything under "${p}".`); await load(); }
    catch { fail('Could not forget that project.'); }
  };

  const pauseProject = async (p: string) => {
    try { await api.put(`/api/user-memory/projects/${encodeURIComponent(p)}/off`, { off: true }); setNotice(`Memory paused for "${p}".`); }
    catch { fail('Could not pause that project.'); }
  };

  const deleteAll = async () => {
    try { await api.delete('/api/user-memory/all'); setFacts([]); setConfirmAll(false); setNotice('Everything was deleted.'); }
    catch { fail('Could not delete your memory. It is still saved.'); }
  };

  const exportAll = async () => {
    try {
      const r = await api.get('/api/user-memory/export');
      const blob = new Blob([JSON.stringify(r.data?.memory ?? {}, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'concord-memory.json'; a.click();
      URL.revokeObjectURL(url);
    } catch { fail('Export failed. Nothing was downloaded.'); }
  };

  const projects = useMemo(() => Array.from(new Set(facts.map((f) => f.project_id).filter((p): p is string => !!p))), [facts]);
  const shown = useMemo(() => facts.filter((f) =>
    (!project || f.project_id === project) &&
    (!search || `${f.subject} ${f.value}`.toLowerCase().includes(search.toLowerCase()))), [facts, project, search]);
  const pending = shown.filter((f) => f.status === 'pending');
  const active = shown.filter((f) => f.status !== 'pending');

  if (loading) return <p role="status" className="text-sm text-slate-400">Loading your memory…</p>;

  return (
    <section aria-label="Memory" className="space-y-5 text-slate-100">
      <div className="rounded-lg border border-lattice-border bg-lattice-elevated/40 p-4">
        <label className="flex items-start gap-3">
          <input type="checkbox" role="switch" aria-label="Remember things I ask it to" checked={enabled}
            disabled={!available && !enabled} onChange={() => void toggle()} className="mt-1 h-4 w-4" />
          <span>
            <span className="block text-sm font-medium">Remember things I ask it to</span>
            <span className="block text-xs text-slate-400">
              Off by default. When on, Concord keeps only what you explicitly tell it to remember (&ldquo;remember that…&rdquo;, &ldquo;I prefer…&rdquo;).
              It never keeps passwords or keys. Private to you; you can see, edit, export and delete all of it here.
            </span>
          </span>
        </label>
        {!available && !enabled && (
          <p className="mt-2 text-xs text-amber-300">Memory is not turned on for this server yet, so it can&rsquo;t be enabled.</p>
        )}
      </div>

      {error && <p role="alert" className="rounded border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-200">{error}</p>}
      {notice && <p role="status" className="rounded border border-emerald-500/30 bg-emerald-500/10 p-2 text-sm text-emerald-200">{notice}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Search memories" placeholder="Search memories" value={search} onChange={(e) => setSearch(e.target.value)}
          className="rounded border border-lattice-border bg-lattice-void px-2 py-1 text-sm" />
        <select aria-label="Filter by project" value={project} onChange={(e) => setProject(e.target.value)}
          className="rounded border border-lattice-border bg-lattice-void px-2 py-1 text-sm">
          <option value="">All projects</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button type="button" onClick={() => void exportAll()} className="rounded border border-lattice-border px-2 py-1 text-xs hover:bg-neon-cyan/10">Export</button>
        {project && (
          <>
            <button type="button" onClick={() => void pauseProject(project)} className="rounded border border-lattice-border px-2 py-1 text-xs hover:bg-neon-cyan/10">Pause for this project</button>
            <button type="button" onClick={() => void forgetProject(project)} className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-200 hover:bg-red-500/10">Forget this project</button>
          </>
        )}
      </div>

      {pending.length > 0 && (
        <div className="space-y-2" aria-label="Needs your decision">
          <h3 className="text-sm font-medium text-amber-200">Needs your decision</h3>
          {pending.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-3 rounded border border-amber-400/30 bg-amber-400/5 p-2 text-sm">
              <span>You said something newer that conflicts with a memory you edited: &ldquo;{f.value}&rdquo;</span>
              <span className="flex gap-2">
                <button type="button" onClick={() => void resolve(f.id)} className="rounded border border-lattice-border px-2 py-1 text-xs">Use the newer one</button>
                <button type="button" onClick={() => void remove(f.id)} className="rounded border border-lattice-border px-2 py-1 text-xs">Ignore it</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {active.length === 0 ? (
        <p className="text-sm text-slate-400">
          {facts.length === 0 ? (enabled ? 'Nothing remembered yet. Tell it “remember that…” in chat.' : 'Nothing is remembered. Turn memory on, then tell it “remember that…” in chat.') : 'No memories match.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {active.map((f) => (
            <li key={f.id} className="rounded border border-lattice-border bg-lattice-elevated/30 p-3 text-sm">
              {editing?.id === f.id ? (
                <div className="flex gap-2">
                  <input aria-label="Edit memory" value={editing.value} maxLength={300} onChange={(e) => setEditing({ id: f.id, value: e.target.value })}
                    className="flex-1 rounded border border-lattice-border bg-lattice-void px-2 py-1" />
                  <button type="button" onClick={() => void saveEdit()} className="rounded border border-lattice-border px-2 py-1 text-xs">Save</button>
                  <button type="button" onClick={() => setEditing(null)} className="rounded border border-lattice-border px-2 py-1 text-xs">Cancel</button>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p>&ldquo;{f.value}&rdquo;</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {f.project_id ? `Project ${f.project_id} · ` : ''}{f.user_edited ? 'edited by you · ' : ''}updated {when(f.updated_at)} · used {f.use_count}×
                    </p>
                  </div>
                  <span className="flex shrink-0 gap-2">
                    <button type="button" onClick={() => void toggleDetails(f.id)} className="rounded border border-lattice-border px-2 py-1 text-xs">Why?</button>
                    <button type="button" onClick={() => setEditing({ id: f.id, value: f.value })} className="rounded border border-lattice-border px-2 py-1 text-xs">Edit</button>
                    <button type="button" onClick={() => void remove(f.id)} className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-200">Forget</button>
                  </span>
                </div>
              )}
              {open?.id === f.id && (
                <div className="mt-2 space-y-1 border-t border-lattice-border pt-2 text-xs text-slate-300">
                  <p>You said: &ldquo;{open.why?.said ?? f.value}&rdquo; on {open.why ? when(open.why.saidAt) : '—'}{open.why?.sessionId ? ` (chat ${open.why.sessionId})` : ''}.</p>
                  {!!open.why?.links.length && <p>Linked to: {open.why.links.map((l) => `${l.target_kind} ${l.target_id}`).join(', ')}</p>}
                  {(open.history?.length ?? 0) > 1 && (
                    <ul className="list-disc pl-4">
                      {open.history!.map((h) => <li key={h.id}>{h.status === 'active' ? 'Now' : 'Before'}: &ldquo;{h.value}&rdquo;{h.valid_to ? ` (until ${when(h.valid_to)})` : ''}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-lattice-border pt-3">
        {confirmAll ? (
          <span className="flex items-center gap-2 text-sm">
            Delete every memory, permanently?
            <button type="button" onClick={() => void deleteAll()} className="rounded border border-red-500/60 bg-red-500/10 px-2 py-1 text-xs text-red-100">Yes, delete everything</button>
            <button type="button" onClick={() => setConfirmAll(false)} className="rounded border border-lattice-border px-2 py-1 text-xs">Cancel</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmAll(true)} disabled={facts.length === 0}
            className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-200 disabled:opacity-40">Delete all memory</button>
        )}
      </div>
    </section>
  );
}
