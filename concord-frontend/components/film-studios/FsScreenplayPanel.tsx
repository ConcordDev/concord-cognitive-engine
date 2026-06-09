'use client';

/**
 * FsScreenplayPanel — per-scene screenplay editor (formatted elements)
 * plus the breakdown element-list report.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, FileText, ListTree } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Scene { id: string; number: string; slugline: string }
interface ScriptEl { type: string; text: string }
interface Location { id: string; name: string }
interface ElementReport { byCategory: Record<string, { name: string; scenes: string[] }[]>; totalElements: number }

const EL_TYPES = ['heading', 'action', 'character', 'dialogue', 'parenthetical', 'transition'];
const EL_STYLE: Record<string, string> = {
  heading: 'font-bold uppercase text-zinc-100',
  action: 'text-zinc-300',
  character: 'uppercase text-zinc-100 ml-[30%]',
  dialogue: 'text-zinc-200 ml-[15%] mr-[15%]',
  parenthetical: 'italic text-zinc-400 ml-[25%]',
  transition: 'uppercase text-zinc-400 text-right',
};

export function FsScreenplayPanel({ projectId }: { projectId: string }) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [activeScene, setActiveScene] = useState('');
  const [script, setScript] = useState<ScriptEl[]>([]);
  const [locationId, setLocationId] = useState('');
  const [report, setReport] = useState<ElementReport | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);

  const loadScenes = useCallback(async () => {
    const [sc, loc, sp, rep] = await Promise.all([
      lensRun('film-studios', 'scene-list', { projectId }),
      lensRun('film-studios', 'location-list', { projectId }),
      lensRun('film-studios', 'screenplay', { projectId }),
      lensRun('film-studios', 'element-list-report', { projectId }),
    ]);
    const list: Scene[] = sc.data?.result?.scenes || [];
    setScenes(list);
    setLocations(loc.data?.result?.locations || []);
    setPageCount(sp.data?.result?.pageCount || 0);
    setReport((rep.data?.result as ElementReport | null) || null);
    setActiveScene((prev) => (list.some((x) => x.id === prev) ? prev : list[0]?.id || ''));
    setLoading(false);
  }, [projectId]);

  const loadScript = useCallback(async () => {
    if (!activeScene) { setScript([]); return; }
    const r = await lensRun('film-studios', 'scene-script-get', { sceneId: activeScene });
    setScript(r.data?.result?.script || []);
    setLocationId(r.data?.result?.locationId || '');
    setDirty(false);
  }, [activeScene]);

  useEffect(() => { void loadScenes(); }, [loadScenes]);
  useEffect(() => { void loadScript(); }, [loadScript]);

  const save = async () => {
    await lensRun('film-studios', 'scene-script-set', { sceneId: activeScene, elements: script, locationId: locationId || '' });
    setDirty(false);
    await loadScenes();
  };
  const addLine = (type: string) => { setScript([...script, { type, text: '' }]); setDirty(true); };
  const setLine = (i: number, text: string) => { setScript(script.map((e, j) => (j === i ? { ...e, text } : e))); setDirty(true); };
  const delLine = (i: number) => { setScript(script.filter((_, j) => j !== i)); setDirty(true); };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={activeScene} onChange={(e) => setActiveScene(e.target.value)}
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-2 text-xs text-zinc-100">
          {scenes.length === 0 && <option value="">No scenes — add scenes in the Script tab</option>}
          {scenes.map((s) => <option key={s.id} value={s.id}>{s.number} · {s.slugline}</option>)}
        </select>
        <span className="text-[11px] text-zinc-400">Screenplay · {pageCount} pages</span>
      </div>

      {activeScene && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-zinc-400">Location</span>
            <select value={locationId} onChange={(e) => { setLocationId(e.target.value); setDirty(true); }}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100">
              <option value="">— none —</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <button type="button" onClick={save} disabled={!dirty}
              className="ml-auto px-3 py-1.5 text-xs font-medium bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 text-white rounded-lg">
              {dirty ? 'Save script' : 'Saved'}
            </button>
          </div>

          {/* Script editor */}
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-1.5">
            {script.length === 0 && <p className="text-[11px] text-zinc-400 italic">Empty scene. Add a line below.</p>}
            {script.map((el, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <select value={el.type} onChange={(e) => { setScript(script.map((x, j) => (j === i ? { ...x, type: e.target.value } : x))); setDirty(true); }}
                  className="w-24 bg-zinc-950 border border-zinc-700 rounded px-1 py-1 text-[10px] text-zinc-300">
                  {EL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <textarea value={el.text} onChange={(e) => setLine(i, e.target.value)} rows={1}
                  className={cn('flex-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs resize-y', EL_STYLE[el.type] || 'text-zinc-200')} />
                <button aria-label="Delete" type="button" onClick={() => delLine(i)} className="text-zinc-600 hover:text-rose-400 mt-1">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <div className="flex flex-wrap gap-1 pt-1">
              {EL_TYPES.map((t) => (
                <button key={t} type="button" onClick={() => addLine(t)}
                  className="flex items-center gap-0.5 text-[10px] px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded">
                  <Plus className="w-3 h-3" />{t}
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          {script.length > 0 && (
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 font-serif text-sm space-y-1.5">
              <p className="flex items-center gap-1 text-[10px] text-zinc-400 uppercase font-sans mb-1"><FileText className="w-3 h-3" /> Preview</p>
              {script.map((el, i) => <p key={i} className={EL_STYLE[el.type] || 'text-zinc-200'}>{el.text || ' '}</p>)}
            </div>
          )}
        </>
      )}

      {/* Element-list report */}
      {report && report.totalElements > 0 && (
        <section>
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <ListTree className="w-3.5 h-3.5 text-fuchsia-400" /> Element list ({report.totalElements})
          </h3>
          <div className="space-y-2">
            {Object.entries(report.byCategory).map(([cat, items]) => (
              <div key={cat} className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2.5">
                <p className="text-[10px] font-semibold text-fuchsia-400 uppercase mb-1">{cat.replace(/_/g, ' ')}</p>
                <ul className="space-y-0.5">
                  {items.map((it, i) => (
                    <li key={i} className="text-[11px] text-zinc-300">
                      {it.name} <span className="text-zinc-600">— sc. {it.scenes.join(', ')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
