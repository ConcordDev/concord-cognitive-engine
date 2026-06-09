'use client';

/**
 * FsScriptPanel — screenplay scenes with script-breakdown tagging in
 * industry element categories.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Tag, Lock, Unlock, History } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface BreakdownEl { id: string; category: string; name: string }
interface Scene {
  id: string; number: string; slugline: string; intExt: string; location: string;
  timeOfDay: string; description: string | null; pageEighths: number;
  breakdownElements: BreakdownEl[]; shootDayNumber: number | null;
  revisionId?: string | null; revisionColor?: string | null;
}
interface Revision {
  id: string; label: string; color: string; ordinal: number;
  author: string; lockedPages: string[];
}

const INT_EXT = ['INT', 'EXT', 'INT/EXT'];
const TIME_OF_DAY = ['DAY', 'NIGHT', 'DUSK', 'DAWN', 'MORNING', 'EVENING', 'CONTINUOUS'];
const CATEGORIES = [
  'cast', 'extras', 'stunts', 'vehicles', 'animals', 'props', 'wardrobe',
  'makeup_hair', 'sfx', 'vfx', 'set_dressing', 'special_equipment', 'sound', 'music', 'art_department', 'notes',
];
const CAT_COLOR: Record<string, string> = {
  cast: 'bg-red-600', extras: 'bg-amber-500', stunts: 'bg-orange-600', vehicles: 'bg-green-600',
  animals: 'bg-emerald-600', props: 'bg-purple-600', wardrobe: 'bg-pink-600', makeup_hair: 'bg-rose-500',
  sfx: 'bg-sky-600', vfx: 'bg-cyan-600', set_dressing: 'bg-lime-600', special_equipment: 'bg-indigo-600',
  sound: 'bg-teal-600', music: 'bg-violet-600', art_department: 'bg-yellow-600', notes: 'bg-zinc-600',
};
// Industry-standard production-draft revision colors, in WGA order.
const REVISION_COLORS = ['white', 'blue', 'pink', 'yellow', 'green', 'goldenrod', 'buff', 'salmon', 'cherry'];
const REV_SWATCH: Record<string, string> = {
  white: 'bg-zinc-100', blue: 'bg-blue-400', pink: 'bg-pink-400', yellow: 'bg-yellow-300',
  green: 'bg-green-400', goldenrod: 'bg-amber-500', buff: 'bg-orange-200', salmon: 'bg-rose-300',
  cherry: 'bg-red-500',
};

export function FsScriptPanel({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState({ intExt: 'INT', location: '', timeOfDay: 'DAY', pageEighths: '', description: '' });
  const [tag, setTag] = useState({ category: 'props', name: '' });
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [revForm, setRevForm] = useState({ label: '', color: 'white', author: '' });
  const [lockPage, setLockPage] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    const [r, rv] = await Promise.all([
      lensRun('film-studios', 'scene-list', { projectId }),
      lensRun('film-studios', 'revision-list', { projectId }),
    ]);
    setScenes(r.data?.result?.scenes || []);
    setTotalPages(r.data?.result?.totalPages || 0);
    setRevisions(rv.data?.result?.revisions || []);
    setLoading(false);
    onChange();
  }, [projectId, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addScene = async () => {
    if (!form.location.trim()) { setError('Scene location is required.'); return; }
    const r = await lensRun('film-studios', 'scene-add', {
      projectId, intExt: form.intExt, location: form.location.trim(),
      timeOfDay: form.timeOfDay, pageEighths: Number(form.pageEighths) || 0,
      description: form.description.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ intExt: 'INT', location: '', timeOfDay: 'DAY', pageEighths: '', description: '' });
    setError(null);
    await refresh();
  };

  const delScene = async (id: string) => {
    await lensRun('film-studios', 'scene-delete', { id });
    await refresh();
  };

  const addTag = async (sceneId: string) => {
    if (!tag.name.trim()) return;
    await lensRun('film-studios', 'breakdown-tag', { sceneId, category: tag.category, name: tag.name.trim() });
    setTag({ ...tag, name: '' });
    await refresh();
  };

  const untag = async (id: string) => {
    await lensRun('film-studios', 'breakdown-untag', { id });
    await refresh();
  };

  const addRevision = async () => {
    if (!revForm.label.trim()) { setError('Revision label is required.'); return; }
    const r = await lensRun('film-studios', 'revision-create', {
      projectId, label: revForm.label.trim(), color: revForm.color,
      author: revForm.author.trim() || undefined,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setRevForm({ label: '', color: 'white', author: '' });
    setError(null);
    await refresh();
  };

  const delRevision = async (id: string) => {
    await lensRun('film-studios', 'revision-delete', { id });
    await refresh();
  };

  const toggleLock = async (revisionId: string, page: string) => {
    if (!page.trim()) return;
    await lensRun('film-studios', 'page-lock-toggle', { revisionId, page: page.trim() });
    setLockPage((p) => ({ ...p, [revisionId]: '' }));
    await refresh();
  };

  const tagSceneRevision = async (sceneId: string, revisionId: string) => {
    await lensRun('film-studios', 'scene-revision-tag', { sceneId, revisionId: revisionId || undefined });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* New scene */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <select value={form.intExt} onChange={(e) => setForm({ ...form, intExt: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {INT_EXT.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <input placeholder="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.timeOfDay} onChange={(e) => setForm({ ...form, timeOfDay: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {TIME_OF_DAY.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <input placeholder="Page 1/8ths" inputMode="numeric" value={form.pageEighths}
            onChange={(e) => setForm({ ...form, pageEighths: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        </div>
        <div className="flex items-center gap-2">
          <input placeholder="Scene description (optional)" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addScene}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add scene
          </button>
        </div>
      </section>

      {/* Script revisions — collaborative draft tracking */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
          <History className="w-3.5 h-3.5 text-fuchsia-400" /> Script revisions
          <span className="text-zinc-400 font-normal">· {revisions.length} drafts</span>
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <input placeholder="Revision label" value={revForm.label}
            onChange={(e) => setRevForm({ ...revForm, label: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={revForm.color} onChange={(e) => setRevForm({ ...revForm, color: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
            {REVISION_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input placeholder="Author" value={revForm.author}
            onChange={(e) => setRevForm({ ...revForm, author: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addRevision}
            className="flex items-center justify-center gap-1 bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Revision
          </button>
        </div>
        {revisions.length > 0 && (
          <ul className="space-y-1.5">
            {revisions.map((rev) => (
              <li key={rev.id} className="bg-zinc-950/60 border border-zinc-800 rounded-lg px-2.5 py-1.5">
                <div className="flex items-center gap-2">
                  <span className={cn('w-3 h-3 rounded-full border border-zinc-600', REV_SWATCH[rev.color] || 'bg-zinc-500')} />
                  <span className="text-xs font-semibold text-zinc-100">{rev.label}</span>
                  <span className="text-[10px] text-zinc-400 capitalize">{rev.color} pages · {rev.author}</span>
                  <span className="text-[10px] text-zinc-400 ml-auto">{rev.lockedPages.length} locked</span>
                  <button aria-label="Delete" type="button" onClick={() => delRevision(rev.id)} className="text-zinc-600 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1 mt-1">
                  {rev.lockedPages.map((pg) => (
                    <button key={pg} type="button" onClick={() => toggleLock(rev.id, pg)}
                      className="flex items-center gap-0.5 text-[10px] bg-amber-800/60 text-amber-100 px-1.5 py-0.5 rounded">
                      <Lock className="w-2.5 h-2.5" /> p{pg}
                    </button>
                  ))}
                  <div className="flex items-center gap-1">
                    <input placeholder="page #" value={lockPage[rev.id] || ''}
                      onChange={(e) => setLockPage((p) => ({ ...p, [rev.id]: e.target.value }))}
                      className="w-16 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-zinc-100" />
                    <button type="button" onClick={() => toggleLock(rev.id, lockPage[rev.id] || '')}
                      className="flex items-center gap-0.5 text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-1.5 py-0.5 rounded">
                      <Unlock className="w-2.5 h-2.5" /> lock/unlock
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Scenes */}
      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">
          Scenes <span className="text-zinc-400 font-normal">· {scenes.length} · {totalPages} pages</span>
        </h3>
        {scenes.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic py-6 text-center">No scenes yet. Add your first slugline above.</p>
        ) : (
          <ul className="space-y-2">
            {scenes.map((sc) => (
              <li key={sc.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl">
                <div className="flex items-start gap-2 p-3">
                  <span className="text-[10px] font-mono text-fuchsia-400 mt-0.5">{sc.number}</span>
                  {sc.revisionColor && (
                    <span className={cn('w-2.5 h-2.5 rounded-full border border-zinc-600 mt-1 shrink-0', REV_SWATCH[sc.revisionColor] || 'bg-zinc-500')}
                      title={`${sc.revisionColor} revision`} />
                  )}
                  <button type="button" onClick={() => setExpanded(expanded === sc.id ? null : sc.id)}
                    className="flex-1 text-left min-w-0">
                    <p className="text-sm font-semibold text-zinc-100">{sc.slugline}</p>
                    {sc.description && <p className="text-[11px] text-zinc-400 line-clamp-1">{sc.description}</p>}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {sc.breakdownElements.map((e) => (
                        <span key={e.id} className={cn('text-[9px] text-white px-1.5 py-0.5 rounded', CAT_COLOR[e.category] || 'bg-zinc-600')}>
                          {e.name}
                        </span>
                      ))}
                    </div>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-zinc-400">{sc.pageEighths}/8 pg</span>
                    {sc.shootDayNumber != null && (
                      <span className="text-[10px] text-emerald-400">Day {sc.shootDayNumber}</span>
                    )}
                    <button aria-label="Delete" type="button" onClick={() => delScene(sc.id)} className="text-zinc-600 hover:text-rose-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {expanded === sc.id && (
                  <div className="px-3 pb-3 border-t border-zinc-800 pt-2.5">
                    {revisions.length > 0 && (
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[11px] font-semibold text-zinc-400">Revision:</span>
                        <select value={sc.revisionId || ''}
                          onChange={(e) => tagSceneRevision(sc.id, e.target.value)}
                          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100">
                          <option value="">Unrevised</option>
                          {revisions.map((rev) => <option key={rev.id} value={rev.id}>{rev.label} ({rev.color})</option>)}
                        </select>
                      </div>
                    )}
                    <p className="flex items-center gap-1 text-[11px] font-semibold text-zinc-400 mb-1.5">
                      <Tag className="w-3 h-3" /> Script breakdown
                    </p>
                    <div className="flex items-center gap-2 mb-2">
                      <select value={tag.category} onChange={(e) => setTag({ ...tag, category: e.target.value })}
                        className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100 capitalize">
                        {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                      </select>
                      <input placeholder="Element name" value={tag.name} onChange={(e) => setTag({ ...tag, name: e.target.value })}
                        className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
                      <button type="button" onClick={() => addTag(sc.id)}
                        className="px-2.5 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">Tag</button>
                    </div>
                    {sc.breakdownElements.length > 0 && (
                      <ul className="flex flex-wrap gap-1">
                        {sc.breakdownElements.map((e) => (
                          <li key={e.id} className={cn('flex items-center gap-1 text-[10px] text-white pl-1.5 pr-1 py-0.5 rounded', CAT_COLOR[e.category] || 'bg-zinc-600')}>
                            {e.name}
                            <button type="button" onClick={() => untag(e.id)} className="opacity-70 hover:opacity-100">×</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
