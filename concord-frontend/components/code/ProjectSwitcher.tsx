'use client';

import { useEffect, useState } from 'react';
import { Folder, Plus, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Project { id: string; number: string; name: string; description: string; language: string; createdAt: string }

export function ProjectSwitcher({ value, onChange, onCreated }: { value: string | null; onChange: (id: string) => void; onCreated?: (p: Project) => void }) {
  const [list, setList] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', description: '', scaffold: 'node-ts' as 'node-ts' | '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'code', action: 'projects-list', input: {} });
      setList((r.data?.result?.projects || []) as Project[]);
    } catch (e) { console.error('[Projects] list', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!draft.name.trim()) return;
    try {
      const r = await lensRun({ domain: 'code', action: 'projects-create', input: draft });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setDraft({ name: '', description: '', scaffold: 'node-ts' });
      setCreating(false);
      await refresh();
      const p = r.data?.result?.project as Project | undefined;
      if (p) { onChange(p.id); onCreated?.(p); }
    } catch (e) { console.error('[Projects] create', e); }
  }

  return (
    <div className="p-2 border-b border-white/10">
      <div className="flex items-center gap-2 mb-2">
        <Folder className="w-3.5 h-3.5 text-blue-400" />
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Projects</span>
        <button onClick={() => setCreating(v => !v)} className="ml-auto px-1.5 py-0.5 text-[10px] rounded bg-blue-500 text-white font-semibold hover:bg-blue-400 inline-flex items-center gap-0.5">
          <Plus className="w-3 h-3" />New
        </button>
      </div>
      {creating && (
        <div className="space-y-1.5 p-2 bg-black/30 rounded border border-white/10 mb-2">
          <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Project name *" className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="Description" className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={draft.scaffold} onChange={e => setDraft({ ...draft, scaffold: e.target.value as 'node-ts' | '' })} className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="node-ts">Scaffold: Node + TypeScript</option>
            <option value="">Empty workspace</option>
          </select>
          <button onClick={create} className="w-full px-2 py-1 text-xs rounded bg-blue-500 text-white font-bold hover:bg-blue-400">Create</button>
        </div>
      )}
      {loading ? (
        <div className="text-xs text-gray-400 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>
      ) : list.length === 0 ? (
        <div className="text-xs text-gray-400 italic">No projects.</div>
      ) : (
        <select value={value || ''} onChange={e => onChange(e.target.value)} className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="">— Select project —</option>
          {list.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
    </div>
  );
}

export default ProjectSwitcher;
