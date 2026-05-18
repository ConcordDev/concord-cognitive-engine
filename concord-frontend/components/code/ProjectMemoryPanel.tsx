'use client';

/**
 * ProjectMemoryPanel — Code Sprint B #8.
 *
 * Cursor `.cursor/rules/` + Windsurf Memories + GitHub Spec Kit
 * AGENTS.md in one Concord-native surface. Real DB backend
 * (migration 206), real disk round-trip (import/export AGENTS.md),
 * real secret-scan rejection on publish.
 */

import { useEffect, useState, useCallback } from 'react';
import { Brain, Pin, PinOff, Trash2, Plus, Upload, Download, Globe2, Loader2, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MemoryRow {
  id: string;
  user_id: string;
  project_path: string;
  kind: 'agents_md' | 'rule' | 'preference' | 'naming_convention' | 'pattern';
  content: string;
  pinned: 0 | 1;
  source?: string;
  published_dtu_id?: string | null;
  created_at: number;
}

interface ProjectMemoryPanelProps {
  projectPath: string;
}

const KIND_OPTIONS: MemoryRow['kind'][] = ['rule', 'preference', 'naming_convention', 'pattern', 'agents_md'];

async function callMacro<T>(name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain: 'code', name, input });
    return (r.data?.result ?? r.data) as T;
  } catch {
    return null;
  }
}

export function ProjectMemoryPanel({ projectPath }: ProjectMemoryPanelProps) {
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [newKind, setNewKind] = useState<MemoryRow['kind']>('rule');
  const [newContent, setNewContent] = useState('');
  const [newPinned, setNewPinned] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy('list');
    const r = await callMacro<{ ok: boolean; memories?: MemoryRow[]; reason?: string }>('memory_list', { projectPath });
    if (r?.ok && r.memories) setMemories(r.memories);
    else if (r?.reason) setErr(r.reason);
    setBusy(null);
  }, [projectPath]);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleAdd() {
    if (!newContent.trim()) return;
    setBusy('add'); setErr(null); setOk(null);
    const r = await callMacro<{ ok: boolean; memory?: MemoryRow; reason?: string }>('memory_add', {
      projectPath, kind: newKind, content: newContent.trim(), pinned: newPinned,
    });
    if (r?.ok) { setNewContent(''); setOk('Added.'); await refresh(); }
    else setErr(r?.reason || 'add failed');
    setBusy(null);
  }

  async function handleRemove(id: string) {
    setBusy(`del-${id}`); setErr(null);
    const r = await callMacro<{ ok: boolean; reason?: string }>('memory_remove', { id });
    if (r?.ok) { setOk('Removed.'); await refresh(); }
    else setErr(r?.reason || 'remove failed');
    setBusy(null);
  }

  async function handlePublish(id: string) {
    setBusy(`pub-${id}`); setErr(null); setOk(null);
    const r = await callMacro<{ ok: boolean; dtuId?: string; reason?: string; matches?: Array<{ name: string; sample: string }> }>('memory_publish', { id });
    if (r?.ok) { setOk(`Published as ${r.dtuId?.slice(0, 24)}…`); await refresh(); }
    else if (r?.reason === 'secret_in_memory') {
      setErr(`Publish blocked — secrets detected: ${r.matches?.map((m) => m.name).join(', ')}`);
    } else setErr(r?.reason || 'publish failed');
    setBusy(null);
  }

  async function handleImport() {
    setBusy('import'); setErr(null);
    const r = await callMacro<{ ok: boolean; reason?: string; bytes?: number }>('memory_import_agents_md', { projectPath });
    if (r?.ok) { setOk(`Imported AGENTS.md (${r.bytes} bytes)`); await refresh(); }
    else setErr(r?.reason || 'import failed');
    setBusy(null);
  }

  async function handleExport() {
    setBusy('export'); setErr(null);
    const r = await callMacro<{ ok: boolean; reason?: string; bytes?: number; filePath?: string; sectionsWritten?: string[] }>('memory_export_agents_md', { projectPath });
    if (r?.ok) { setOk(`Wrote ${r.bytes} bytes to ${r.filePath?.split('/').pop()} (${r.sectionsWritten?.join(', ')})`); }
    else setErr(r?.reason || 'export failed');
    setBusy(null);
  }

  return (
    <div className="flex flex-col h-full bg-[#0d1117]">
      <header className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <Brain className="w-4 h-4 text-amber-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Project memory</span>
        <span className="ml-auto text-[10px] text-gray-500">{memories.length}</span>
      </header>

      {err && (
        <div className="m-2 px-2 py-1 text-[10px] text-red-300 bg-red-500/10 rounded flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {err}
          <button onClick={() => setErr(null)} className="ml-auto">×</button>
        </div>
      )}
      {ok && (
        <div className="m-2 px-2 py-1 text-[10px] text-emerald-300 bg-emerald-500/10 rounded">{ok}</div>
      )}

      <div className="px-3 py-2 border-b border-white/10 space-y-1.5">
        <div className="flex items-center gap-2">
          <select
            value={newKind} onChange={(e) => setNewKind(e.target.value as MemoryRow['kind'])}
            className="text-[10px] bg-lattice-deep border border-lattice-border rounded px-1.5 py-1 text-white"
          >
            {KIND_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <label className="flex items-center gap-1 text-[10px] text-gray-400">
            <input type="checkbox" checked={newPinned} onChange={(e) => setNewPinned(e.target.checked)} className="accent-amber-400" />
            pin
          </label>
        </div>
        <textarea
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          placeholder='e.g. "always use Tailwind, never styled-components"'
          rows={2}
          className="w-full px-2 py-1 text-[10px] bg-lattice-deep border border-lattice-border rounded text-white resize-none"
        />
        <button
          onClick={handleAdd}
          disabled={busy !== null || !newContent.trim()}
          className="text-[10px] px-2 py-1 rounded bg-amber-500 text-black font-bold hover:bg-amber-400 disabled:opacity-50 inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>

      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <button
          onClick={handleImport} disabled={busy !== null}
          className="text-[10px] px-2 py-0.5 rounded bg-white/5 border border-white/10 hover:bg-white/10 inline-flex items-center gap-1"
        >
          <Upload className="w-3 h-3" /> Import AGENTS.md
        </button>
        <button
          onClick={handleExport} disabled={busy !== null}
          className="text-[10px] px-2 py-0.5 rounded bg-white/5 border border-white/10 hover:bg-white/10 inline-flex items-center gap-1"
        >
          <Download className="w-3 h-3" /> Export AGENTS.md
        </button>
        {busy && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
      </div>

      <ul className="flex-1 min-h-0 overflow-y-auto">
        {memories.length === 0 ? (
          <li className="px-3 py-3 text-[10px] text-gray-500">
            No memories yet. Add one above or import an existing AGENTS.md.
          </li>
        ) : (
          memories.map((m) => (
            <li key={m.id} className="px-3 py-2 border-b border-white/5 text-xs">
              <div className="flex items-center gap-2">
                {m.pinned ? <Pin className="w-3 h-3 text-amber-400" /> : <PinOff className="w-3 h-3 text-gray-500" />}
                <span className="text-[10px] uppercase tracking-wider text-amber-300">{m.kind}</span>
                {m.published_dtu_id && (
                  <span className="text-[9px] text-emerald-300 font-mono" title={m.published_dtu_id}>
                    <Globe2 className="w-3 h-3 inline" /> published
                  </span>
                )}
                <button
                  onClick={() => handlePublish(m.id)}
                  disabled={busy !== null || !!m.published_dtu_id}
                  className="ml-auto text-[10px] text-emerald-400 hover:text-emerald-300 disabled:opacity-30"
                  title="Publish as AGENTS.md DTU"
                >
                  {busy === `pub-${m.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Globe2 className="w-3 h-3" />}
                </button>
                <button
                  onClick={() => handleRemove(m.id)}
                  disabled={busy !== null}
                  className="text-[10px] text-red-400 hover:text-red-300 disabled:opacity-30"
                  title="Remove"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <pre className="mt-1 text-[10px] text-gray-300 whitespace-pre-wrap font-sans">{m.content}</pre>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

export default ProjectMemoryPanel;
