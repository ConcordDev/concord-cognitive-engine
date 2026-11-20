'use client';

/**
 * The Library pane: snippets you keep, snapshots of a project, run targets
 * (which file ⌘↵ runs), editor extensions, and a shared session (live share).
 * A partner's edits in a shared session arrive as a proposal, like any other
 * change that did not come from your own keyboard.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Trash2, Users, Camera, Puzzle, Play, Scissors } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ago, code, languageOf, readFiles } from './proofApi';
import type { ProjectState } from './useProject';
import type { AgentApi } from './AgentPane';

interface Snippet { id: string; title: string; language: string; code: string; createdAt: string }
interface Snapshot { id: string; name?: string; message?: string; fileCount?: number; totalLines?: number; createdAt: string }
interface RunConfig { id: string; name: string; command: string; kind: string }
interface Ext { id: string; name: string; kind: string; description: string; effect?: string; enabled?: boolean }
interface Session { code: string; name: string; status: string; participantCount: number; participants: { userId: string; role: string }[] }
interface Op { seq: number; path?: string; content?: string; userId?: string }

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="border-b pf-rule p-2">
      <div className="flex items-center justify-between pb-1"><p className="pf-label">{title}</p>{action}</div>
      {children}
    </section>
  );
}

export function LibraryPane({ ps, projectId, agent, selection, onInsert, runTarget, setRunTarget }: {
  ps: ProjectState; projectId: string; agent: AgentApi; selection: string;
  onInsert: (text: string) => void; runTarget: string | null; setRunTarget: (path: string | null) => void;
}) {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [configs, setConfigs] = useState<RunConfig[]>([]);
  const [catalog, setCatalog] = useState<Ext[]>([]);
  const [installed, setInstalled] = useState<Ext[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [snipName, setSnipName] = useState('');

  const load = useCallback(async () => {
    const [s, sn, rc, cat, ext] = await Promise.all([
      code<{ snippets: Snippet[] }>('snippets-list', { limit: 30 }),
      code<{ snapshots: Snapshot[] }>('snapshots-list', { limit: 10 }),
      code<{ configs: RunConfig[] }>('run-config-list', { projectId }),
      code<{ catalog: Ext[] }>('extensions-catalog', {}),
      code<{ extensions: Ext[] }>('extensions-list', {}),
    ]);
    if (s.ok) setSnippets(s.result.snippets);
    if (sn.ok) setSnapshots(sn.result.snapshots);
    if (rc.ok) setConfigs(rc.result.configs);
    if (cat.ok) setCatalog(cat.result.catalog);
    if (ext.ok) setInstalled(ext.result.extensions);
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  const saveSnippet = async () => {
    const text = selection || ps.buffers.find((b) => b.path === ps.active)?.content || '';
    if (!text.trim()) { setNote('Select some code, or open a file, to save a snippet.'); return; }
    const r = await code('snippets-save', { title: snipName.trim() || (ps.active ? `From ${ps.active}` : 'Snippet'), code: text, language: ps.active ? languageOf(ps.active) : 'plaintext' });
    setNote(r.ok ? 'Snippet saved.' : r.message); setSnipName('');
    void load();
  };
  const snapshot = async () => {
    const paths = (ps.tree || []).map((t) => t.path);
    await ps.saveAll();
    const contents = await readFiles(projectId, paths);
    const files = paths.map((p) => ({ name: p, language: languageOf(p), content: contents.get(p) ?? '' }));
    const r = await code<{ id: string }>('commit-snapshot', { name: ps.project?.name || 'Project', message: `Snapshot of ${ps.project?.name || 'project'}`, files });
    setNote(r.ok ? `Snapshot saved with ${files.length} files.` : r.message);
    void load();
  };
  const addRunTarget = async () => {
    if (!ps.active) return;
    const r = await code('run-config-save', { projectId, name: ps.active.split('/').pop(), command: ps.active, kind: 'browser-run' });
    if (r.ok) { setRunTarget(ps.active); void load(); } else setNote(r.message);
  };
  const toggleExt = async (e: Ext) => {
    const mine = installed.find((x) => x.id === e.id);
    const r = mine ? await code('extensions-toggle', { extensionId: e.id, enabled: !mine.enabled }) : await code('extensions-install', { extensionId: e.id });
    if (!r.ok) setNote(r.message);
    void load();
  };
  const uninstall = async (id: string) => { await code('extensions-uninstall', { extensionId: id }); void load(); };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="pf-pane-library">
      <div className="flex h-9 flex-shrink-0 items-center border-b pf-rule px-3"><span className="pf-label">Library</span></div>
      <div className="pf-scroll min-h-0 flex-1 overflow-y-auto">
        {note && <p className="px-3 pt-2 text-[11.5px] pf-muted" role="status">{note}</p>}

        <Section title="Snippets">
          <form className="mb-1.5 flex gap-1" onSubmit={(e) => { e.preventDefault(); void saveSnippet(); }}>
            <input className="pf-input h-6" placeholder={selection ? 'Name this selection' : 'Name (saves the open file)'} value={snipName} onChange={(e) => setSnipName(e.target.value)} aria-label="Snippet name" />
            <button type="submit" className="pf-btn h-6 flex-shrink-0 px-2"><Scissors className="h-3 w-3" />Keep</button>
          </form>
          {snippets.map((s) => (
            <div key={s.id} className="group flex items-center gap-1 py-0.5 text-[12px]">
              <button type="button" className="min-w-0 flex-1 truncate text-left pf-text-2 hover:text-[color:var(--pf-text)]" onClick={() => onInsert(s.code)} title="Insert at the cursor">{s.title}</button>
              <span className="pf-mono text-[10px] pf-faint">{s.language}</span>
              <button type="button" className="hidden rounded p-0.5 pf-faint hover:text-[color:var(--pf-text)] group-hover:block" aria-label={`Copy ${s.title}`} onClick={() => void navigator.clipboard?.writeText(s.code)}><Copy className="h-3 w-3" /></button>
              <button type="button" className="hidden rounded p-0.5 pf-faint hover:text-[color:var(--pf-fail)] group-hover:block" aria-label={`Delete ${s.title}`} onClick={async () => { await code('snippets-delete', { id: s.id }); void load(); }}><Trash2 className="h-3 w-3" /></button>
            </div>
          ))}
          {snippets.length === 0 && <p className="text-[11px] pf-faint">No snippets yet.</p>}
        </Section>

        <Section title="Run target" action={<button type="button" className="pf-btn pf-btn-ghost h-6 px-2" onClick={() => void addRunTarget()} disabled={!ps.active}><Play className="h-3 w-3" />Use open file</button>}>
          <p className="mb-1 text-[11px] pf-faint">⌘↵ runs {runTarget ? <span className="pf-mono pf-text-2">{runTarget}</span> : 'the open file'} in your browser.</p>
          {configs.map((c) => (
            <div key={c.id} className="group flex items-center gap-1 py-0.5 text-[12px]">
              <button type="button" className={cn('min-w-0 flex-1 truncate text-left pf-mono', runTarget === c.command ? 'text-[color:var(--pf-text)]' : 'pf-text-2')} onClick={() => setRunTarget(c.command)} aria-pressed={runTarget === c.command}>{c.command}</button>
              <button type="button" className="hidden rounded p-0.5 pf-faint hover:text-[color:var(--pf-fail)] group-hover:block" aria-label={`Remove ${c.name}`} onClick={async () => { await code('run-config-delete', { projectId, id: c.id }); if (runTarget === c.command) setRunTarget(null); void load(); }}><Trash2 className="h-3 w-3" /></button>
            </div>
          ))}
        </Section>

        <Section title="Snapshots" action={<button type="button" className="pf-btn pf-btn-ghost h-6 px-2" onClick={() => void snapshot()}><Camera className="h-3 w-3" />Snapshot</button>}>
          {snapshots.map((s) => (
            <p key={s.id} className="flex items-center gap-2 py-0.5 text-[11.5px]"><span className="min-w-0 flex-1 truncate pf-text-2">{s.name || s.message || s.id}</span><span className="pf-num text-[10px] pf-faint">{s.fileCount ?? ''}{s.fileCount != null ? ' files · ' : ''}{ago(s.createdAt)}</span></p>
          ))}
          {snapshots.length === 0 && <p className="text-[11px] pf-faint">A snapshot keeps a copy of every file as a private DTU.</p>}
        </Section>

        <LiveShare ps={ps} projectId={projectId} agent={agent} />

        <Section title="Editor extensions">
          {catalog.map((e) => {
            const mine = installed.find((x) => x.id === e.id);
            return (
              <div key={e.id} className="py-1">
                <div className="flex items-center gap-1.5 text-[12px]">
                  <Puzzle className="h-3 w-3 pf-faint" aria-hidden />
                  <span className="min-w-0 flex-1 truncate pf-text-2">{e.name}</span>
                  <button type="button" className={cn('pf-btn h-5 px-1.5 text-[10.5px]', mine?.enabled && 'border-[var(--pf-text-2)]')} onClick={() => void toggleExt(e)} aria-pressed={!!mine?.enabled}>{mine ? (mine.enabled ? 'On' : 'Off') : 'Add'}</button>
                  {mine && <button type="button" className="rounded p-0.5 pf-faint hover:text-[color:var(--pf-fail)]" aria-label={`Remove ${e.name}`} onClick={() => void uninstall(e.id)}><Trash2 className="h-3 w-3" /></button>}
                </div>
                {e.effect && <p className="pl-4 text-[10.5px] leading-snug pf-faint">{e.effect}</p>}
              </div>
            );
          })}
        </Section>
      </div>
    </div>
  );
}

function LiveShare({ ps, projectId, agent }: { ps: ProjectState; projectId: string; agent: AgentApi }) {
  const [session, setSession] = useState<Session | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [hosting, setHosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const since = useRef(0);
  const lastSent = useRef<string>('');

  // Host: send the open file when it is saved.
  const active = ps.buffers.find((b) => b.path === ps.active);
  useEffect(() => {
    if (!session || !hosting || !active || active.saved === lastSent.current) return;
    lastSent.current = active.saved;
    void code('liveshare-edit', { code: session.code, path: active.path, content: active.saved });
  }, [session, hosting, active]);

  // Everyone: read the session when the panel is open, on an explicit refresh.
  const poll = useCallback(async () => {
    if (!session) return;
    const r = await code<{ session: Session; ops: Op[]; nextSince: number }>('liveshare-poll', { code: session.code, since: since.current });
    if (!r.ok) { setError(r.message); return; }
    setSession(r.result.session);
    since.current = r.result.nextSince;
    if (hosting) return;
    const latest = new Map<string, string>();
    for (const op of r.result.ops) if (op.path && typeof op.content === 'string') latest.set(op.path, op.content);
    if (latest.size) {
      const current = await readFiles(projectId, [...latest.keys()]);
      const edits = [...latest.entries()].filter(([p, c]) => current.get(p) !== c).map(([path, after]) => ({ path, before: current.get(path) ?? null, after }));
      if (edits.length) agent.add({ title: `Shared edits from ${r.result.session.name}`, origin: 'change', evidence: 'From a shared session. Read before accepting.', edits });
    }
  }, [session, hosting, projectId, agent]);

  const start = async () => {
    setError(null);
    const r = await code<{ session: Session }>('liveshare-start', { projectId, name: ps.project?.name || 'Session' });
    if (r.ok) { setSession(r.result.session); setHosting(true); lastSent.current = ''; } else setError(r.message);
  };
  const join = async () => {
    setError(null);
    const r = await code<{ session: Session }>('liveshare-join', { code: joinCode.trim() });
    if (r.ok) { setSession(r.result.session); setHosting(false); since.current = 0; } else setError(r.message);
  };
  const end = async () => {
    if (session && hosting) await code('liveshare-end', { code: session.code });
    setSession(null); setHosting(false);
  };

  return (
    <Section title="Shared session">
      {!session ? (
        <div className="space-y-1.5">
          <button type="button" className="pf-btn w-full justify-center" onClick={() => void start()}><Users className="h-3.5 w-3.5" />Share this project</button>
          <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (joinCode.trim()) void join(); }}>
            <input className="pf-input pf-mono h-6 uppercase" placeholder="Join code" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} aria-label="Session code" />
            <button type="submit" className="pf-btn h-6 px-2" disabled={!joinCode.trim()}>Join</button>
          </form>
        </div>
      ) : (
        <div className="space-y-1 text-[12px]">
          <p className="flex items-center justify-between"><span className="pf-text-2">{hosting ? 'Sharing' : 'Joined'} <span className="pf-mono text-[color:var(--pf-text)]" data-testid="pf-share-code">{session.code}</span></span><span className="pf-num text-[10.5px] pf-faint">{session.participantCount} here</span></p>
          <p className="text-[11px] pf-faint">{hosting ? 'Your saved edits to the open file are shared.' : 'Their edits arrive as a proposal when you refresh.'}</p>
          <div className="flex gap-1">
            <button type="button" className="pf-btn h-6 px-2" onClick={() => void poll()}>Refresh</button>
            <button type="button" className="pf-btn pf-btn-ghost h-6 px-2" onClick={() => void end()}>{hosting ? 'End' : 'Leave'}</button>
          </div>
        </div>
      )}
      {error && <p className="pt-1 text-[11px] pf-fail" role="alert">{error}</p>}
    </Section>
  );
}
