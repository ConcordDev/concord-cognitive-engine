'use client';

/**
 * FsScreenplayPanel — per-scene screenplay editor (formatted elements)
 * plus the breakdown element-list report.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, FileText, ListTree } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/ui';

interface Scene { id: string; number: string; slugline: string }
interface ScriptEl { type: string; text: string }
interface Location { id: string; name: string }
interface ElementReport { byCategory: Record<string, { name: string; scenes: string[] }[]>; totalElements: number }

const EL_TYPES = ['heading', 'action', 'character', 'dialogue', 'parenthetical', 'transition'];
const EL_STYLE: Record<string, string> = {
  heading: 'font-bold uppercase text-[var(--fo-ink,#f4f4f5)]',
  action: 'text-[var(--fo-ink-2,#d4d4d8)]',
  character: 'uppercase text-[var(--fo-ink,#f4f4f5)] ml-[30%]',
  dialogue: 'text-[var(--fo-ink,#e4e4e7)] ml-[15%] mr-[15%]',
  parenthetical: 'italic text-[var(--fo-muted,#a1a1aa)] ml-[25%]',
  transition: 'uppercase text-[var(--fo-muted,#a1a1aa)] text-right',
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const loadScenes = useCallback(async () => {
    const [sc, loc, sp, rep] = await Promise.all([
      lensRun('film-studios', 'scene-list', { projectId }),
      lensRun('film-studios', 'location-list', { projectId }),
      lensRun('film-studios', 'screenplay', { projectId }),
      lensRun('film-studios', 'element-list-report', { projectId }),
    ]);
    if ([sc, loc, sp, rep].some((r) => r.data?.ok === false)) {
      setLoadError(sc.data?.error || loc.data?.error || sp.data?.error || rep.data?.error || 'Could not load screenplay data.');
      setLoading(false);
      return;
    }
    setLoadError(null);
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
    if (r.data?.ok === false) {
      setLoadError(r.data?.error || 'Could not load scene script.');
      return;
    }
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
    return <div className="flex items-center justify-center py-10 text-[var(--fo-muted,#a1a1aa)]"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (loadError) {
    return <div className="p-4"><ErrorState message={loadError} onRetry={() => { void loadScenes(); void loadScript(); }} /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={activeScene} onChange={(e) => setActiveScene(e.target.value)}
          className="flex-1 bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-2 text-xs text-[var(--fo-ink,#f4f4f5)]">
          {scenes.length === 0 && <option value="">No scenes — add scenes in the Script tab</option>}
          {scenes.map((s) => <option key={s.id} value={s.id}>{s.number} · {s.slugline}</option>)}
        </select>
        <span className="text-[11px] text-[var(--fo-muted,#a1a1aa)]">Screenplay · {pageCount} pages</span>
      </div>

      {activeScene && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--fo-muted,#a1a1aa)]">Location</span>
            <select value={locationId} onChange={(e) => { setLocationId(e.target.value); setDirty(true); }}
              className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1 text-[11px] text-[var(--fo-ink,#f4f4f5)]">
              <option value="">— none —</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <button type="button" onClick={save} disabled={!dirty}
              className="ml-auto px-3 py-1.5 text-xs font-medium bg-[var(--fo-tape,#c026d3)] hover:bg-[#b72d23] disabled:opacity-40 text-white rounded-lg">
              {dirty ? 'Save script' : 'Saved'}
            </button>
          </div>

          {/* Script editor */}
          <div className="bg-[var(--fo-paper-2,rgba(24,24,27,0.7))] border border-[var(--fo-rule,#27272a)] rounded-xl p-3 space-y-1.5">
            {script.length === 0 && <p className="text-[11px] text-[var(--fo-muted,#a1a1aa)] italic">Empty scene. Add a line below.</p>}
            {script.map((el, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <select value={el.type} onChange={(e) => { setScript(script.map((x, j) => (j === i ? { ...x, type: e.target.value } : x))); setDirty(true); }}
                  className="w-24 bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded px-1 py-1 text-[10px] text-[var(--fo-ink-2,#d4d4d8)]">
                  {EL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <textarea value={el.text} onChange={(e) => setLine(i, e.target.value)} rows={1}
                  className={cn('flex-1 bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded px-2 py-1 text-xs resize-y', EL_STYLE[el.type] || 'text-[var(--fo-ink,#e4e4e7)]')} />
                <button aria-label="Delete" type="button" onClick={() => delLine(i)} className="text-[var(--fo-faint,#52525b)] hover:text-[var(--fo-bad,#fb7185)] mt-1">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <div className="flex flex-wrap gap-1 pt-1">
              {EL_TYPES.map((t) => (
                <button key={t} type="button" onClick={() => addLine(t)}
                  className="flex items-center gap-0.5 text-[10px] px-2 py-0.5 bg-[var(--fo-paper-2,#27272a)] hover:bg-[var(--fo-rule,#3f3f46)] text-[var(--fo-ink-2,#d4d4d8)] rounded">
                  <Plus className="w-3 h-3" />{t}
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          {script.length > 0 && (
            <div className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule,#27272a)] rounded-xl p-4 font-serif text-sm space-y-1.5">
              <p className="flex items-center gap-1 text-[10px] text-[var(--fo-muted,#a1a1aa)] uppercase font-sans mb-1"><FileText className="w-3 h-3" /> Preview</p>
              {script.map((el, i) => <p key={i} className={EL_STYLE[el.type] || 'text-[var(--fo-ink,#e4e4e7)]'}>{el.text || ' '}</p>)}
            </div>
          )}
        </>
      )}

      {/* Element-list report */}
      {report && report.totalElements > 0 && (
        <section>
          <h3 className="flex items-center gap-1 text-xs font-semibold text-[var(--fo-ink-2,#d4d4d8)] mb-2">
            <ListTree className="w-3.5 h-3.5 text-[var(--fo-tape,#e879f9)]" /> Element list ({report.totalElements})
          </h3>
          <div className="space-y-2">
            {Object.entries(report.byCategory).map(([cat, items]) => (
              <div key={cat} className="bg-[var(--fo-paper-2,rgba(24,24,27,0.7))] border border-[var(--fo-rule,#27272a)] rounded-lg p-2.5">
                <p className="text-[10px] font-semibold text-[var(--fo-tape,#e879f9)] uppercase mb-1">{cat.replace(/_/g, ' ')}</p>
                <ul className="space-y-0.5">
                  {items.map((it, i) => (
                    <li key={i} className="text-[11px] text-[var(--fo-ink-2,#d4d4d8)]">
                      {it.name} <span className="text-[var(--fo-faint,#52525b)]">— sc. {it.scenes.join(', ')}</span>
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
