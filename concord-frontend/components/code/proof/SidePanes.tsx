'use client';

/**
 * The workbench's left panes: Files (tree, outline, bookmarks), Search
 * (project search, replace with a preview, TODO scan) and Changes (the
 * project's own version history: stage, commit, branches, stash, merge).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, FilePlus, Pencil, Trash2, Bookmark, X, GitCommit, GitMerge, Archive, RotateCcw, Plus, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ago, code, type Commit, type GitStatus, type TreeEntry, type DiffHunk } from './proofApi';
import type { ProjectState } from './useProject';

function PaneHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-9 flex-shrink-0 items-center justify-between border-b pf-rule px-3">
      <span className="pf-label">{title}</span>
      <span className="flex items-center gap-0.5">{children}</span>
    </div>
  );
}

function IconBtn({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return <button type="button" className="rounded p-1 pf-faint hover:bg-[var(--pf-ink-3)] hover:text-[color:var(--pf-text)] disabled:opacity-40" onClick={onClick} aria-label={label} title={label} disabled={disabled}>{children}</button>;
}

// ── Files ──────────────────────────────────────────────────────────────

interface Node { name: string; path: string; dir: boolean; children: Node[] }
function buildTree(entries: TreeEntry[]): Node[] {
  const root: Node = { name: '', path: '', dir: true, children: [] };
  for (const e of entries) {
    const parts = e.path.split('/');
    let cur = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join('/');
      const leaf = i === parts.length - 1;
      let next = cur.children.find((c) => c.name === part && c.dir === !leaf);
      if (!next) { next = { name: part, path, dir: !leaf, children: [] }; cur.children.push(next); }
      cur = next;
    });
  }
  const sort = (n: Node) => { n.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1)); n.children.forEach(sort); };
  sort(root);
  return root.children;
}

interface Symbol { name: string; kind: string; line: number }
interface BookmarkRow { id: string; path: string; line: number; label: string }

export function FilesPane({ ps, projectId, onReveal, changed }: { ps: ProjectState; projectId: string; onReveal: (path: string, line: number | null) => void; changed: Map<string, string> }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState('');
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [outline, setOutline] = useState<{ symbols: Symbol[]; source: string } | null>(null);
  const [bookmarks, setBookmarks] = useState<BookmarkRow[]>([]);
  const nodes = useMemo(() => buildTree(ps.tree || []), [ps.tree]);

  const loadBookmarks = useCallback(async () => {
    const r = await code<{ bookmarks: BookmarkRow[] }>('bookmark-list', { projectId });
    if (r.ok) setBookmarks(r.result.bookmarks);
  }, [projectId]);
  useEffect(() => { void loadBookmarks(); }, [loadBookmarks]);

  useEffect(() => {
    if (!ps.active) { setOutline(null); return; }
    let live = true;
    void (async () => {
      const r = await code<{ symbols: Symbol[]; source: string }>('symbols-outline', { projectId, path: ps.active });
      if (live) setOutline(r.ok ? { symbols: r.result.symbols || [], source: r.result.source } : null);
    })();
    return () => { live = false; };
  }, [projectId, ps.active, ps.ledger?.codeFingerprint]);

  const create = async () => {
    const path = newPath.trim().replace(/^\/+/, '');
    if (!path) return;
    const r = await code('files-write', { projectId, path, content: '' });
    if (!r.ok) { ps.setError(r.message); return; }
    setCreating(false); setNewPath('');
    await ps.reload([]);
    void ps.openFile(path);
  };
  const rename = async (from: string) => {
    const to = renameTo.trim();
    setRenaming(null);
    // code-003: a blank name is a cancellation said in words, never a silent no-op.
    if (!to) { ps.setError('The rename was cancelled — a file name cannot be empty.'); return; }
    if (to === from) return;
    const r = await code('files-rename', { projectId, from, to });
    if (!r.ok) { ps.setError(r.message); return; }
    ps.close(from);
    await ps.reload([]);
    void ps.openFile(to);
  };
  const remove = async (path: string) => {
    setConfirmDel(null);
    const r = await code('files-delete', { projectId, path });
    if (!r.ok) { ps.setError(r.message); return; }
    ps.close(path);
    await ps.reload([]);
  };
  const removeBookmark = async (id: string) => {
    await code('bookmark-delete', { projectId, id });
    void loadBookmarks();
  };

  const render = (list: Node[], depth: number): React.ReactNode => list.map((n) => {
    if (n.dir) {
      const isCol = collapsed.has(n.path);
      return (
        <li key={n.path}>
          <button type="button" className="pf-row py-[3px] text-[12.5px]" style={{ paddingLeft: 8 + depth * 12 }} onClick={() => setCollapsed((s) => { const x = new Set(s); if (x.has(n.path)) x.delete(n.path); else x.add(n.path); return x; })} aria-expanded={!isCol}>
            <ChevronRight className={cn('h-3 w-3 flex-shrink-0 pf-faint transition-transform', !isCol && 'rotate-90')} aria-hidden />
            <span className="truncate">{n.name}</span>
          </button>
          {!isCol && <ul>{render(n.children, depth + 1)}</ul>}
        </li>
      );
    }
    const mark = changed.get(n.path);
    return (
      <li key={n.path} className="group relative">
        {renaming === n.path ? (
          <form onSubmit={(e) => { e.preventDefault(); void rename(n.path); }} className="px-2 py-0.5" style={{ paddingLeft: 8 + depth * 12 }}>
            <input autoFocus className="pf-input pf-mono h-6" value={renameTo} onChange={(e) => setRenameTo(e.target.value)} onBlur={() => setRenaming(null)} onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)} aria-label={`Rename ${n.path}`} />
          </form>
        ) : (
          <button type="button" className="pf-row py-[3px] pr-14 text-[12.5px]" style={{ paddingLeft: 23 + depth * 12 }} data-active={ps.active === n.path ? 'true' : 'false'} onClick={() => void ps.openFile(n.path)} title={n.path} data-testid="pf-file">
            <span className="truncate">{n.name}</span>
            {mark && <span className={cn('pf-mono ml-auto text-[10px]', mark === 'A' ? 'pf-add' : 'pf-text-2')} aria-label={mark === 'A' ? 'Added' : 'Modified'}>{mark}</span>}
          </button>
        )}
        {renaming !== n.path && (
          <span className="absolute right-1 top-0.5 hidden items-center group-focus-within:flex group-hover:flex">
            {confirmDel === n.path ? (
              <>
                <button type="button" className="rounded px-1.5 text-[11px] pf-fail hover:bg-[var(--pf-ink-4)]" onClick={() => void remove(n.path)}>Delete</button>
                <IconBtn label="Keep" onClick={() => setConfirmDel(null)}><X className="h-3 w-3" /></IconBtn>
              </>
            ) : (
              <>
                <IconBtn label={`Rename ${n.name}`} onClick={() => { setRenaming(n.path); setRenameTo(n.path); }}><Pencil className="h-3 w-3" /></IconBtn>
                <IconBtn label={`Delete ${n.name}`} onClick={() => setConfirmDel(n.path)}><Trash2 className="h-3 w-3" /></IconBtn>
              </>
            )}
          </span>
        )}
      </li>
    );
  });

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="pf-pane-files">
      <PaneHead title={ps.project?.name || 'Files'}>
        <IconBtn label="New file" onClick={() => setCreating(true)}><FilePlus className="h-3.5 w-3.5" /></IconBtn>
      </PaneHead>
      <div className="pf-scroll min-h-0 flex-1 overflow-y-auto py-1">
        {creating && (
          <form className="px-2 pb-1" onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <input autoFocus className="pf-input pf-mono h-6" placeholder="src/new-file.ts" value={newPath} onChange={(e) => setNewPath(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setCreating(false)} aria-label="New file path" data-testid="pf-new-file" />
          </form>
        )}
        {ps.tree === null && <div className="space-y-1 px-3 py-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-4 animate-pulse rounded pf-raised" />)}</div>}
        {ps.tree?.length === 0 && !creating && <p className="px-3 py-4 text-[12px] pf-faint">No files yet. Press <button type="button" className="underline" onClick={() => setCreating(true)}>new file</button>.</p>}
        <ul>{render(nodes, 0)}</ul>

        {outline && outline.symbols.length > 0 && (
          <section className="mt-3 border-t pf-rule pt-2" aria-label="Outline">
            <p className="pf-label px-3 pb-1">Outline <span className="normal-case tracking-normal pf-faint">· {outline.source}</span></p>
            <ul>
              {outline.symbols.slice(0, 60).map((s, i) => (
                <li key={`${s.name}-${i}`}>
                  <button type="button" className="pf-row py-[2px] text-[12px]" onClick={() => ps.active && onReveal(ps.active, s.line)}>
                    <span className="pf-mono w-6 text-[10px] pf-faint">{(s.kind || '').slice(0, 3)}</span>
                    <span className="pf-mono truncate">{s.name}</span>
                    <span className="pf-num ml-auto text-[10px] pf-faint">{s.line}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {bookmarks.length > 0 && (
          <section className="mt-3 border-t pf-rule pt-2" aria-label="Bookmarks">
            <p className="pf-label px-3 pb-1">Bookmarks</p>
            <ul>
              {bookmarks.map((b) => (
                <li key={b.id} className="group flex items-center">
                  <button type="button" className="pf-row min-w-0 flex-1 py-[2px] text-[12px]" onClick={() => onReveal(b.path, b.line)}>
                    <Bookmark className="h-3 w-3 flex-shrink-0 pf-faint" aria-hidden />
                    <span className="truncate">{b.label || b.path.split('/').pop()}</span>
                    <span className="pf-num ml-auto text-[10px] pf-faint">{b.line}</span>
                  </button>
                  <span className="hidden pr-1 group-hover:block"><IconBtn label="Remove bookmark" onClick={() => void removeBookmark(b.id)}><X className="h-3 w-3" /></IconBtn></span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

// ── Search ─────────────────────────────────────────────────────────────

interface Hit { file: string; line: number; column: number; preview: string; matchText: string }
interface Todo { path: string; line: number; tag: string; text: string }

export function SearchPane({ ps, projectId, onReveal }: { ps: ProjectState; projectId: string; onReveal: (path: string, line: number | null) => void }) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState({ caseSensitive: false, regex: false, wholeWord: false });
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [replace, setReplace] = useState('');
  const [preview, setPreview] = useState<{ filesChanged: number; totalReplacements: number } | null>(null);
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPreview(null);
    if (!q.trim()) { setHits(null); return; }
    const t = setTimeout(async () => {
      const r = await code<{ hits: Hit[] }>('search-project', { projectId, query: q, ...opts });
      setHits(r.ok ? r.result.hits : []);
    }, 220);
    return () => clearTimeout(t);
  }, [q, opts, projectId, ps.ledger?.codeFingerprint]);

  const runReplace = async (dryRun: boolean) => {
    if (!q.trim()) return;
    setBusy(true);
    await ps.saveAll();
    const r = await code<{ filesChanged: number; totalReplacements: number; changed: { path: string }[] }>('replace-project', { projectId, query: q, replacement: replace, dryRun, ...opts });
    setBusy(false);
    if (!r.ok) { ps.setError(r.message); return; }
    if (dryRun) setPreview(r.result);
    else { setPreview(null); await ps.reload((r.result.changed || []).map((c) => c.path)); setQ((x) => x); }
  };
  const scanTodos = async () => {
    const r = await code<{ todos: Todo[] }>('todo-scan', { projectId });
    setTodos(r.ok ? r.result.todos : []);
  };

  const byFile = useMemo(() => {
    const m = new Map<string, Hit[]>();
    for (const h of hits || []) m.set(h.file, [...(m.get(h.file) || []), h]);
    return [...m.entries()];
  }, [hits]);

  const toggle = (k: keyof typeof opts, label: string, title: string) => (
    <button type="button" className={cn('pf-mono h-5 rounded px-1 text-[11px]', opts[k] ? 'bg-[var(--pf-ink-4)] text-[color:var(--pf-text)]' : 'pf-faint')} aria-pressed={opts[k]} title={title} onClick={() => setOpts((o) => ({ ...o, [k]: !o[k] }))}>{label}</button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="pf-pane-search">
      <PaneHead title="Search" />
      <div className="space-y-1.5 border-b pf-rule p-2">
        <div className="relative">
          <input autoFocus className="pf-input pr-20" placeholder="Search the project" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the project" data-testid="pf-search" />
          <span className="absolute right-1 top-1 flex gap-0.5">{toggle('caseSensitive', 'Aa', 'Match case')}{toggle('wholeWord', 'ab', 'Whole word')}{toggle('regex', '.*', 'Regular expression')}</span>
        </div>
        <div className="flex gap-1">
          <input className="pf-input" placeholder="Replace with" value={replace} onChange={(e) => { setReplace(e.target.value); setPreview(null); }} aria-label="Replace with" />
          <button type="button" className="pf-btn h-7 flex-shrink-0 px-2" disabled={!q.trim() || busy} onClick={() => void runReplace(!preview)}>{preview ? 'Apply' : 'Preview'}</button>
        </div>
        {preview && <p className="text-[11.5px] pf-muted">Replaces <span className="pf-num pf-text-2">{preview.totalReplacements}</span> in <span className="pf-num pf-text-2">{preview.filesChanged}</span> file{preview.filesChanged === 1 ? '' : 's'}. Apply to write them; the proof re-checks after.</p>}
      </div>
      <div className="pf-scroll min-h-0 flex-1 overflow-y-auto py-1">
        {hits && <p className="px-3 pb-1 text-[11px] pf-faint">{hits.length} result{hits.length === 1 ? '' : 's'}{hits.length >= 500 ? ' (first 500)' : ''}</p>}
        {byFile.map(([file, list]) => (
          <div key={file} className="mb-1">
            <p className="pf-mono truncate px-3 py-0.5 text-[11.5px] pf-text-2">{file}</p>
            {list.map((h, i) => (
              <button key={i} type="button" className="pf-row py-[2px] pl-5 text-[12px]" onClick={() => onReveal(file, h.line)}>
                <span className="pf-num w-6 flex-shrink-0 text-right text-[10px] pf-faint">{h.line}</span>
                <span className="pf-mono truncate">{h.preview.trim()}</span>
              </button>
            ))}
          </div>
        ))}
        <div className="mt-2 border-t pf-rule px-3 pt-2">
          <button type="button" className="pf-btn pf-btn-ghost h-6 px-2" onClick={() => void scanTodos()}>Scan for TODO / FIXME</button>
          {todos && (
            <ul className="mt-1">
              {todos.length === 0 && <li className="text-[11.5px] pf-faint">None found.</li>}
              {todos.map((t, i) => (
                <li key={i}><button type="button" className="pf-row px-0 py-[2px] text-[12px]" onClick={() => onReveal(t.path, t.line)}><span className="pf-mono text-[10px] pf-stale">{t.tag}</span><span className="truncate">{t.text || t.path}</span><span className="pf-num ml-auto text-[10px] pf-faint">{t.path.split('/').pop()}:{t.line}</span></button></li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Changes (the project's own version history) ────────────────────────

interface Stash { id: string; message: string; createdAt: string; paths?: string[] }

export function ChangesPane({ ps, projectId, onOpenDiff }: { ps: ProjectState; projectId: string; onOpenDiff: (path: string, hunks: DiffHunk[]) => void }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [log, setLog] = useState<Commit[]>([]);
  const [stashes, setStashes] = useState<Stash[]>([]);
  const [message, setMessage] = useState('');
  const [branch, setBranch] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, l, st] = await Promise.all([
      code<GitStatus>('git-status', { projectId }),
      code<{ log: Commit[] }>('git-log', { projectId, limit: 30 }),
      code<{ stashes: Stash[] }>('git-stash-list', { projectId }),
    ]);
    if (s.ok) setStatus(s.result);
    if (l.ok) setLog(l.result.log);
    if (st.ok) setStashes(st.result.stashes || []);
  }, [projectId]);
  useEffect(() => { void load(); }, [load, ps.ledger?.codeFingerprint, ps.ledger?.changes.length]);

  const act = async (action: string, input: Record<string, unknown>, done?: string) => {
    await ps.saveAll();
    const r = await code<Record<string, unknown>>(action, { projectId, ...input });
    if (!r.ok) { setNote(r.message); return null; }
    setNote(done || null);
    await load();
    await ps.reload();
    return r.result;
  };

  const diff = async (path: string) => {
    const r = await code<{ hunks: DiffHunk[] }>('git-diff', { projectId, path });
    if (r.ok) onOpenDiff(path, r.result.hunks);
  };

  const commit = async () => {
    if (!message.trim()) return;
    if (status && status.staged.length === 0) await act('git-stage', {});
    const r = await act('git-commit', { message: message.trim() }, 'Committed.');
    if (r) setMessage('');
  };

  const fileRow = (path: string, staged: boolean) => (
    <li key={path} className="group flex items-center">
      <button type="button" className="pf-row min-w-0 flex-1 py-[3px] text-[12px]" onClick={() => void diff(path)} title="Show diff against the last commit">
        <span className="pf-mono truncate">{path}</span>
      </button>
      <span className="hidden items-center pr-1 group-focus-within:flex group-hover:flex">
        {!staged && (confirmDiscard === path
          ? <button type="button" className="rounded px-1.5 text-[11px] pf-fail" onClick={() => { setConfirmDiscard(null); void act('git-discard', { path }, `Restored ${path}.`); }}>Discard</button>
          : <IconBtn label={`Discard changes to ${path}`} onClick={() => setConfirmDiscard(path)}><RotateCcw className="h-3 w-3" /></IconBtn>)}
        <IconBtn label={staged ? `Unstage ${path}` : `Stage ${path}`} onClick={() => void act(staged ? 'git-unstage' : 'git-stage', { paths: [path] })}>{staged ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}</IconBtn>
      </span>
    </li>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="pf-pane-changes">
      <PaneHead title="History">
        <span className="pf-mono text-[11px] pf-text-2" data-testid="pf-branch">{status?.branch || '—'}</span>
      </PaneHead>
      <div className="pf-scroll min-h-0 flex-1 overflow-y-auto">
        <form className="space-y-1.5 border-b pf-rule p-2" onSubmit={(e) => { e.preventDefault(); void commit(); }}>
          <textarea className="pf-input" rows={2} placeholder="Commit message" value={message} onChange={(e) => setMessage(e.target.value)} aria-label="Commit message" />
          <button type="submit" className="pf-btn w-full justify-center" disabled={!message.trim() || !status || (status.staged.length + status.modified.length === 0)}><GitCommit className="h-3.5 w-3.5" />Commit {status ? (status.staged.length || status.modified.length) : ''} locally</button>
          <p className="text-[10.5px] pf-faint">Local history only. GitHub gets changes through the proof.</p>
        </form>
        {note && <p className="px-3 pt-2 text-[11.5px] pf-muted" role="status">{note}</p>}
        {status && status.staged.length > 0 && (<><p className="pf-label px-3 pb-0.5 pt-2">Staged</p><ul>{status.staged.map((p) => fileRow(p, true))}</ul></>)}
        {status && status.modified.length > 0 && (<><p className="pf-label px-3 pb-0.5 pt-2">Changed since last commit</p><ul>{status.modified.map((p) => fileRow(p, false))}</ul></>)}
        {status?.clean && <p className="px-3 py-2 text-[11.5px] pf-faint">Nothing uncommitted.</p>}

        <div className="mt-2 border-t pf-rule p-2">
          <p className="pf-label pb-1">Branches</p>
          <div className="flex flex-wrap gap-1">
            {status?.branches.map((b) => (
              <span key={b} className="inline-flex items-center gap-0.5">
                <button type="button" className={cn('pf-btn h-6 px-2 pf-mono text-[11px]', b === status.branch && 'border-[var(--pf-text-2)]')} onClick={() => b !== status.branch && void act('git-checkout', { branch: b }, `On ${b}.`)} aria-current={b === status.branch}>{b}</button>
                {b !== status.branch && <IconBtn label={`Merge ${b} into ${status.branch}`} onClick={() => void act('git-merge', { from: b }, `Merged ${b}.`)}><GitMerge className="h-3 w-3" /></IconBtn>}
              </span>
            ))}
          </div>
          <form className="mt-1.5 flex gap-1" onSubmit={(e) => { e.preventDefault(); if (branch.trim()) void act('git-branch-create', { name: branch.trim(), checkout: true }, `Created ${branch.trim()}.`).then(() => setBranch('')); }}>
            <input className="pf-input pf-mono h-6" placeholder="new-branch" value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="New branch name" />
            <button type="submit" className="pf-btn h-6 px-2" disabled={!branch.trim()}>Branch</button>
          </form>
        </div>

        <div className="border-t pf-rule p-2">
          <div className="flex items-center justify-between pb-1">
            <p className="pf-label">Stash</p>
            <button type="button" className="pf-btn pf-btn-ghost h-6 px-2" onClick={() => void act('git-stash', { message: `Stash ${new Date().toLocaleTimeString()}` }, 'Stashed.')} disabled={!status || status.clean}><Archive className="h-3 w-3" />Stash</button>
          </div>
          {stashes.map((s) => (
            <div key={s.id} className="flex items-center gap-1 text-[12px]">
              <span className="min-w-0 flex-1 truncate pf-text-2">{s.message}</span>
              <button type="button" className="pf-btn pf-btn-ghost h-6 px-2" onClick={() => void act('git-stash-pop', { id: s.id }, 'Restored the stash.')}>Pop</button>
            </div>
          ))}
          {stashes.length === 0 && <p className="text-[11px] pf-faint">Nothing stashed.</p>}
        </div>

        <div className="border-t pf-rule p-2">
          <p className="pf-label pb-1">Log</p>
          <ol>
            {log.map((c) => (
              <li key={c.id} className="py-1 text-[12px]">
                <p className="truncate pf-text-2">{c.message}</p>
                <p className="pf-num text-[10.5px] pf-faint">{c.number} · {c.branch} · {c.paths.length} file{c.paths.length === 1 ? '' : 's'} · {ago(c.committedAt)}</p>
              </li>
            ))}
            {log.length === 0 && <li className="text-[11px] pf-faint">No commits yet.</li>}
          </ol>
        </div>
      </div>
    </div>
  );
}
