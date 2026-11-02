'use client';

import { useEffect, useRef, useState } from 'react';
import { File, FilePlus, Loader2, Trash2, Pencil } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { QuietSuccessEdge } from './delight';

interface FileNode { path: string; language: string; size: number; modifiedAt: string }

export function FileExplorer({
  projectId, activePath, onOpen, onChanged, onRenamed,
}: {
  projectId: string | null;
  activePath: string | null;
  onOpen: (path: string) => void;
  onChanged?: () => void;
  /** Called with (oldPath, newPath) after a successful rename, so the caller can retarget an open editor tab. */
  onRenamed?: (from: string, to: string) => void;
}) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftPath, setDraftPath] = useState('');
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  // S3: delete confirmation lives in the UI, not in window.confirm —
  // native dialogs are a dead-control class in embedded surfaces (the
  // click lands, the dialog never resolves, nothing happens, silently).
  // First click arms the button ("Delete?"), second click deletes; a
  // failed delete renders its reason here instead of vanishing.
  const [confirmingPath, setConfirmingPath] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameFlash, setRenameFlash] = useState(0);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is a stable closure; only projectId should retrigger
  useEffect(() => { if (projectId) refresh(); else setTree([]); }, [projectId]);

  async function refresh() {
    if (!projectId) return;
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'code', action: 'files-tree', input: { projectId } });
      setTree((r.data?.result?.tree || []) as FileNode[]);
    } catch (e) { console.error('[FileTree] failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!projectId || !draftPath.trim()) return;
    try {
      const r = await lensRun({ domain: 'code', action: 'files-write', input: { projectId, path: draftPath.trim(), content: '' } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setDraftPath('');
      setCreating(false);
      await refresh();
      onOpen(draftPath.trim());
      onChanged?.();
    } catch (e) { console.error('[FileTree] create', e); }
  }

  async function remove(path: string) {
    if (!projectId) return;
    setDeleteError('');
    try {
      const r = await lensRun({ domain: 'code', action: 'files-delete', input: { projectId, path } });
      if (r.data?.ok === false) {
        setDeleteError(`Could not delete ${path}: ${r.data?.error || 'the server refused'}`);
        return;
      }
      setConfirmingPath(null);
      await refresh();
      onChanged?.();
    } catch (e) {
      console.error('[FileTree] delete', e);
      setDeleteError(`Could not delete ${path}: the request failed.`);
    }
  }

  function handleDeleteClick(path: string) {
    if (confirmingPath === path) { void remove(path); return; }
    setConfirmingPath(path);
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    armTimerRef.current = setTimeout(() => setConfirmingPath(cur => (cur === path ? null : cur)), 4000);
  }

  function startRename(path: string) {
    setRenamingPath(path);
    setRenameDraft(path);
    // Focus + select the basename (not the directory prefix) on next paint, VS-Code-style.
    requestAnimationFrame(() => {
      const el = renameInputRef.current;
      if (!el) return;
      el.focus();
      const base = path.lastIndexOf('/') + 1;
      el.setSelectionRange(base, path.length);
    });
  }

  async function commitRename() {
    if (!projectId || !renamingPath) return;
    const to = renameDraft.trim();
    const from = renamingPath;
    setRenamingPath(null);
    if (!to || to === from) return;
    try {
      const r = await lensRun({ domain: 'code', action: 'files-rename', input: { projectId, from, to } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setRenameFlash((n) => n + 1);
      await refresh();
      onChanged?.();
      if (activePath === from) onRenamed?.(from, to);
    } catch (e) { console.error('[FileTree] rename', e); }
  }

  if (!projectId) {
    return <div className="p-3 text-xs text-gray-400 italic">Open a project to see files.</div>;
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      <QuietSuccessEdge flashKey={renameFlash} />
      <div className="px-2 py-1.5 border-b border-white/10 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Files</span>
        <span className="text-[10px] text-gray-400">{tree.length}</span>
        <button onClick={() => setCreating(v => !v)} className="ml-auto p-1 text-gray-400 hover:text-white" title="New file">
          <FilePlus className="w-3.5 h-3.5" />
        </button>
      </div>
      {deleteError && (
        <div role="alert" className="px-2 py-1.5 border-b border-rose-500/30 bg-rose-500/10 text-[11px] text-rose-200">{deleteError}</div>
      )}
      {creating && (
        <div className="p-2 border-b border-white/10 flex items-center gap-1">
          <input
            value={draftPath}
            onChange={e => setDraftPath(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && create()}
            placeholder="src/new-file.ts"
            className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
          />
          <button onClick={create} className="px-2 py-1 text-xs rounded bg-blue-500 text-white font-bold hover:bg-blue-400">Add</button>
        </div>
      )}
      <ul className="flex-1 overflow-y-auto">
        {loading ? (
          <li className="px-3 py-2 text-xs text-gray-400 inline-flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" />Loading…</li>
        ) : tree.length === 0 ? (
          <li className="px-3 py-2 text-xs text-gray-400 italic">Empty.</li>
        ) : tree.map(f => (
          <li
            key={f.path}
            onClick={() => renamingPath !== f.path && onOpen(f.path)}
            className={cn(
              'group px-3 py-1 cursor-pointer flex items-center gap-1.5 hover:bg-white/[0.04] text-xs',
              activePath === f.path && 'bg-blue-500/15 text-white',
            )}
          >
            <File className="w-3 h-3 text-gray-400 flex-shrink-0" />
            {renamingPath === f.path ? (
              <input
                ref={renameInputRef}
                value={renameDraft}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  else if (e.key === 'Escape') setRenamingPath(null);
                }}
                className="flex-1 min-w-0 px-1 py-0 text-xs bg-lattice-deep border border-blue-500/40 rounded text-white font-mono"
              />
            ) : (
              <span className="flex-1 truncate font-mono">{f.path}</span>
            )}
            {renamingPath !== f.path && (
              <>
                <button aria-label="Rename" onClick={(e) => { e.stopPropagation(); startRename(f.path); }} className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-blue-300">
                  <Pencil className="w-3 h-3" />
                </button>
                {confirmingPath === f.path ? (
                  <button aria-label={`Confirm delete ${f.path}`} onClick={(e) => { e.stopPropagation(); handleDeleteClick(f.path); }} className="p-0.5 px-1 rounded bg-rose-500/20 text-rose-200 text-[10px] font-bold hover:bg-rose-500/30">
                    Delete?
                  </button>
                ) : (
                  <button aria-label="Delete" onClick={(e) => { e.stopPropagation(); handleDeleteClick(f.path); }} className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-rose-300">
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default FileExplorer;
