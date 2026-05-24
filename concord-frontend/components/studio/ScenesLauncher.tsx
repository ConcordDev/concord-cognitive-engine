'use client';

import { useCallback, useEffect, useState } from 'react';
import { Play, Plus, Loader2, Grid3x3 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Scene { id: string; projectId: string; name: string; order: number; tempoBpm: number | null; launchedAt: string | null }

export function ScenesLauncher({ projectId }: { projectId?: string }) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');

  const refresh = useCallback(async () => {
    if (!projectId) { setScenes([]); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'studio', action: 'scenes-list', input: { projectId } });
      setScenes((res.data?.result?.scenes || []) as Scene[]);
    } catch (e) { console.error('[Scenes] failed', e); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function create() {
    if (!projectId || !name.trim()) return;
    try {
      await lensRun({ domain: 'studio', action: 'scenes-create', input: { projectId, name } });
      setName('');
      await refresh();
    } catch (e) { console.error('[Scenes] create', e); }
  }

  async function launch(id: string) {
    try {
      await lensRun({ domain: 'studio', action: 'scenes-launch', input: { id } });
      await refresh();
    } catch (e) { console.error('[Scenes] launch', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-violet-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Grid3x3 className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Scenes · clip launcher</span>
        <span className="ml-auto text-[10px] text-gray-400">{scenes.length}</span>
      </header>
      {projectId && (
        <div className="p-3 border-b border-white/10 flex items-center gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Scene name (Intro / Verse / Chorus)" className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={create} className="px-3 py-1.5 text-xs rounded bg-violet-500 text-white font-bold hover:bg-violet-400 inline-flex items-center gap-1"><Plus className="w-3 h-3" />Add scene</button>
        </div>
      )}
      <div className="max-h-72 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : scenes.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Grid3x3 className="w-6 h-6 mx-auto mb-2 opacity-30" />No scenes. Build live arrangements with clip launching.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {scenes.map(sc => (
              <li key={sc.id} className="px-3 py-2 hover:bg-white/[0.03] flex items-center gap-3">
                <span className="w-7 h-7 rounded-full bg-violet-500/15 text-violet-300 flex items-center justify-center text-[11px] font-bold">{sc.order + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{sc.name}</div>
                  {sc.launchedAt && <div className="text-[10px] text-violet-300">Last launched {new Date(sc.launchedAt).toLocaleTimeString()}</div>}
                </div>
                <button onClick={() => launch(sc.id)} className={cn('px-2 py-1 text-[10px] rounded inline-flex items-center gap-1', sc.launchedAt ? 'bg-emerald-500/30 text-emerald-300 hover:bg-emerald-500/50' : 'bg-violet-500/30 text-violet-300 hover:bg-violet-500/50')}>
                  <Play className="w-2.5 h-2.5" /> Launch
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ScenesLauncher;
