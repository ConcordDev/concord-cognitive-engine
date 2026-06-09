'use client';

import { useEffect, useState } from 'react';
import { File, FilePlus, Loader2, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface FileNode { path: string; language: string; size: number; modifiedAt: string }

export function FileExplorer({
  projectId, activePath, onOpen, onChanged,
}: {
  projectId: string | null;
  activePath: string | null;
  onOpen: (path: string) => void;
  onChanged?: () => void;
}) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftPath, setDraftPath] = useState('');

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
    if (!confirm(`Delete ${path}?`)) return;
    try {
      await lensRun({ domain: 'code', action: 'files-delete', input: { projectId, path } });
      await refresh();
      onChanged?.();
    } catch (e) { console.error('[FileTree] delete', e); }
  }

  if (!projectId) {
    return <div className="p-3 text-xs text-gray-400 italic">Open a project to see files.</div>;
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-2 py-1.5 border-b border-white/10 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Files</span>
        <span className="text-[10px] text-gray-400">{tree.length}</span>
        <button onClick={() => setCreating(v => !v)} className="ml-auto p-1 text-gray-400 hover:text-white" title="New file">
          <FilePlus className="w-3.5 h-3.5" />
        </button>
      </div>
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
            onClick={() => onOpen(f.path)}
            className={cn(
              'group px-3 py-1 cursor-pointer flex items-center gap-1.5 hover:bg-white/[0.04] text-xs',
              activePath === f.path && 'bg-blue-500/15 text-white',
            )}
          >
            <File className="w-3 h-3 text-gray-400 flex-shrink-0" />
            <span className="flex-1 truncate font-mono">{f.path}</span>
            <button aria-label="Delete" onClick={(e) => { e.stopPropagation(); remove(f.path); }} className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-rose-300">
              <Trash2 className="w-3 h-3" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default FileExplorer;
