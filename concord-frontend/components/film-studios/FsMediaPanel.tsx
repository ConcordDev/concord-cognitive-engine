'use client';

/**
 * FsMediaPanel — multicam / proxy media manager. Registers source media
 * with optional proxy URLs, toggles edit quality (full / proxy / offline)
 * and groups synced cameras into multicam angle sets. Backed by the
 * media-* and multicam-* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Video, Film, Camera } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Media {
  id: string; name: string; kind: string; sourceUrl: string | null;
  proxyUrl: string | null; quality: string; camera: string | null;
  fps: number | null; mcamGroupId: string | null; mcamAngle: number | null;
}
interface McamAngle { id: string; name: string; camera: string | null; quality: string; mcamAngle: number | null }
interface McamGroup { id: string; name: string; angleCount: number; angles: McamAngle[] }

const KINDS = ['video', 'audio', 'image'];
const QUALITIES = ['full', 'proxy', 'offline'];
const QUALITY_COLOR: Record<string, string> = {
  full: 'bg-emerald-700 text-emerald-100',
  proxy: 'bg-amber-700 text-amber-100',
  offline: 'bg-zinc-700 text-zinc-300',
};

export function FsMediaPanel({ projectId }: { projectId: string }) {
  const [media, setMedia] = useState<Media[]>([]);
  const [groups, setGroups] = useState<McamGroup[]>([]);
  const [proxyCount, setProxyCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', kind: 'video', camera: '', sourceUrl: '', proxyUrl: '' });
  const [grpName, setGrpName] = useState('');
  const [grpPick, setGrpPick] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const [mr, gr] = await Promise.all([
      lensRun('film-studios', 'media-list', { projectId }),
      lensRun('film-studios', 'multicam-list', { projectId }),
    ]);
    setMedia(mr.data?.result?.media || []);
    setProxyCount(mr.data?.result?.proxyCount || 0);
    setGroups(gr.data?.result?.groups || []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addMedia = async () => {
    if (!form.name.trim()) { setError('Media name is required.'); return; }
    const r = await lensRun('film-studios', 'media-register', {
      projectId, name: form.name.trim(), kind: form.kind,
      camera: form.camera.trim() || undefined,
      sourceUrl: form.sourceUrl.trim() || undefined,
      proxyUrl: form.proxyUrl.trim() || undefined,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', kind: 'video', camera: '', sourceUrl: '', proxyUrl: '' });
    setError(null);
    await refresh();
  };

  const setQuality = async (id: string, quality: string) => {
    await lensRun('film-studios', 'media-set-quality', { id, quality });
    await refresh();
  };

  const delMedia = async (id: string) => {
    await lensRun('film-studios', 'media-delete', { id });
    setGrpPick((p) => p.filter((x) => x !== id));
    await refresh();
  };

  const toggleGrpPick = (id: string) => {
    setGrpPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  const createGroup = async () => {
    if (!grpName.trim() || grpPick.length < 2) { setError('A multicam group needs a name and at least 2 media items.'); return; }
    const r = await lensRun('film-studios', 'multicam-group', {
      projectId, name: grpName.trim(), mediaIds: grpPick,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setGrpName('');
    setGrpPick([]);
    setError(null);
    await refresh();
  };

  const delGroup = async (id: string) => {
    await lensRun('film-studios', 'multicam-delete', { id });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Register media */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <input placeholder="Media name / clip ID" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input placeholder="Camera (A, B…)" value={form.camera}
            onChange={(e) => setForm({ ...form, camera: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addMedia}
            className="flex items-center justify-center gap-1 bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Register
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input placeholder="Source URL (https://…)" value={form.sourceUrl}
            onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Proxy URL (https://…)" value={form.proxyUrl}
            onChange={(e) => setForm({ ...form, proxyUrl: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        </div>
      </section>

      {/* Media bin */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Video className="w-3.5 h-3.5 text-fuchsia-400" /> Media bin
          <span className="text-zinc-400 font-normal">· {media.length} items · {proxyCount} proxy</span>
        </h3>
        {media.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic py-6 text-center">No media registered. Add source files to build a multicam edit.</p>
        ) : (
          <ul className="space-y-1.5">
            {media.map((m) => (
              <li key={m.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <input type="checkbox" checked={grpPick.includes(m.id)} onChange={() => toggleGrpPick(m.id)}
                  className="accent-fuchsia-500" aria-label={`Select ${m.name} for multicam group`} />
                <Film className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-zinc-100 truncate">
                    {m.name}
                    {m.camera && <span className="text-fuchsia-300"> · CAM {m.camera}</span>}
                    {m.mcamAngle != null && <span className="text-zinc-400"> · angle {m.mcamAngle}</span>}
                  </p>
                  {(m.sourceUrl || m.proxyUrl) && (
                    <p className="text-[10px] text-zinc-400 truncate">
                      {m.proxyUrl ? 'proxy available' : m.sourceUrl ? 'source only' : ''}
                    </p>
                  )}
                </div>
                <select value={m.quality} onChange={(e) => setQuality(m.id, e.target.value)}
                  className={cn('text-[10px] rounded px-1.5 py-0.5 border-0 font-medium', QUALITY_COLOR[m.quality] || 'bg-zinc-700 text-zinc-300')}>
                  {QUALITIES.map((q) => <option key={q} value={q}>{q}</option>)}
                </select>
                <button aria-label="Delete" type="button" onClick={() => delMedia(m.id)} className="text-zinc-600 hover:text-rose-400 shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Multicam groups */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Camera className="w-3.5 h-3.5 text-fuchsia-400" /> Multicam angle sets
        </h3>
        <div className="flex items-center gap-2 mb-2">
          <input placeholder="Group name (e.g. Interview)" value={grpName}
            onChange={(e) => setGrpName(e.target.value)}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <span className="text-[10px] text-zinc-400">{grpPick.length} selected</span>
          <button type="button" onClick={createGroup} disabled={grpPick.length < 2}
            className="px-3 py-1.5 text-xs font-medium bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 text-white rounded-lg">
            Group cameras
          </button>
        </div>
        {groups.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic py-4 text-center">No multicam groups. Check 2+ media items above to sync angles.</p>
        ) : (
          <ul className="space-y-1.5">
            {groups.map((g) => (
              <li key={g.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-100">{g.name}</span>
                  <span className="text-[10px] text-zinc-400">{g.angleCount} angles</span>
                  <button aria-label="Delete" type="button" onClick={() => delGroup(g.id)} className="ml-auto text-zinc-600 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {g.angles.map((a) => (
                    <span key={a.id} className="text-[10px] bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded">
                      A{a.mcamAngle ?? '?'} · {a.name}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
