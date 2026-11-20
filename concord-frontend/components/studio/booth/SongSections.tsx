'use client';

/**
 * Song sections: Intro / Verse / Chorus… on the timeline, stored with the
 * project by studio.markers-*. Tap a section to jump the playhead there, tap
 * its loop key to loop it for another take. Adds and renames show at once and
 * roll back with the server's reason if it refuses.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Repeat, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { showToast } from '@/components/common/Toasts';
import { getStudioEngine } from '@/lib/daw/playback-engine';
import { logStudioCollabEdit } from '@/lib/daw/collab-log';
import { isSavedProject, studio, type Section } from './boothApi';
import { DEFAULT_SECTION_COLOUR, SECTION_COLOURS, SECTION_NAMES } from './sectionColours';

const NAMES = SECTION_NAMES;

export function SongSections({ projectId, beatsPerBar, onLoop }: {
  projectId: string;
  beatsPerBar: number;
  onLoop: (start: number, end: number) => void;
}) {
  const [sections, setSections] = useState<Section[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [landed, setLanded] = useState<string | null>(null);
  const saved = isSavedProject(projectId);
  const latest = useRef<Section[]>([]);

  const load = useCallback(async () => {
    if (!saved) { setSections([]); return; }
    const r = await studio<{ markers: Section[] }>('markers-list', { projectId });
    if (!r.ok) { setError(r.error || 'Could not load the song sections.'); setSections([]); return; }
    setError(null);
    const list = (r.result?.markers || []).filter((m) => m.kind === 'section');
    latest.current = list;
    setSections(list);
  }, [projectId, saved]);
  useEffect(() => { void load(); }, [load]);

  const sorted = (list: Section[]) => [...list].sort((a, b) => a.timeBeats - b.timeBeats);

  const add = async (name: string) => {
    if (!saved) return;
    const at = Math.max(0, Math.floor(Math.max(0, getStudioEngine().getBeat()) / beatsPerBar) * beatsPerBar);
    const count = (latest.current || []).filter((s) => s.name.startsWith(name)).length;
    const label = count ? `${name} ${count + 1}` : name;
    const temp: Section = { id: `pending_${Date.now()}`, projectId, name: label, timeBeats: at, colour: SECTION_COLOURS[name] || DEFAULT_SECTION_COLOUR, kind: 'section' };
    const before = latest.current;
    latest.current = sorted([...before, temp]);
    setSections(latest.current);
    const r = await studio<{ marker: Section }>('markers-add', { projectId, name: label, timeBeats: at, colour: temp.colour, kind: 'section' });
    if (!r.ok || !r.result?.marker) {
      latest.current = before;
      setSections(before);
      showToast('error', r.error || 'The section was not saved.');
      return;
    }
    latest.current = sorted(latest.current.map((s) => (s.id === temp.id ? r.result!.marker : s)));
    setSections(latest.current);
    setLanded(r.result.marker.id);
    logStudioCollabEdit(projectId, 'markers-add', r.result.marker.id, { name: label, kind: 'section' });
  };

  const rename = async (s: Section) => {
    const name = draft.trim();
    setRenaming(null);
    if (!name || name === s.name) return;
    const before = latest.current;
    latest.current = before.map((x) => (x.id === s.id ? { ...x, name } : x));
    setSections(latest.current);
    const r = await studio<{ marker: Section }>('markers-update', { id: s.id, name });
    if (!r.ok || !r.result?.marker) {
      latest.current = before;
      setSections(before);
      showToast('error', r.error || 'The rename was not saved.');
      return;
    }
    latest.current = latest.current.map((x) => (x.id === s.id ? r.result!.marker : x));
    setSections(latest.current);
    logStudioCollabEdit(projectId, 'markers-update', s.id, { name });
  };

  const remove = async (s: Section) => {
    const before = latest.current;
    latest.current = before.filter((x) => x.id !== s.id);
    setSections(latest.current);
    const r = await studio('markers-delete', { id: s.id });
    if (!r.ok) {
      latest.current = before;
      setSections(before);
      showToast('error', r.error || 'The section was not removed.');
      return;
    }
    logStudioCollabEdit(projectId, 'markers-delete', s.id);
  };

  const endOf = (i: number, list: Section[]) => {
    const s = list[i];
    if (s.lengthBeats && s.lengthBeats > 0) return s.timeBeats + s.lengthBeats;
    return list[i + 1]?.timeBeats ?? s.timeBeats + beatsPerBar * 8;
  };

  return (
    <div className="flex min-h-9 flex-shrink-0 items-center gap-1.5 overflow-x-auto border-b border-white/5 bg-[var(--bo-console)] px-2 py-1" data-testid="booth-sections">
      <span className="bo-engrave flex-shrink-0 text-xs">Song</span>
      {!saved && <span className="text-[11px] text-zinc-500">Sections save with the song. Saving the new song first…</span>}
      {saved && sections === null && <span className="text-[11px] text-zinc-500">Loading sections…</span>}
      {error && <span className="text-[11px] text-red-300">{error} <button type="button" onClick={() => void load()} className="underline">Retry</button></span>}
      {saved && sections?.length === 0 && !error && <span className="text-[11px] text-zinc-500">Mark where the verse and chorus start, then jump between them while you record.</span>}
      {(sections || []).map((s, i, list) => (
        <span key={s.id} className={cn('group flex flex-shrink-0 items-center overflow-hidden rounded border border-white/10 bg-[var(--bo-panel)]', s.id.startsWith('pending_') && 'opacity-60', landed === s.id && 'bo-land')} data-testid="booth-section">
          <span className="h-6 w-1" style={{ background: s.colour }} />
          {renaming === s.id ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void rename(s)}
              onKeyDown={(e) => { if (e.key === 'Enter') void rename(s); if (e.key === 'Escape') setRenaming(null); }}
              maxLength={60}
              aria-label={`Rename ${s.name}`}
              className="h-6 w-24 bg-transparent px-1.5 text-xs text-zinc-100 outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => getStudioEngine().seek(s.timeBeats)}
              onDoubleClick={() => { setRenaming(s.id); setDraft(s.name); }}
              className="h-6 px-1.5 text-xs text-zinc-100 hover:bg-white/5"
              title={`Jump to ${s.name} (bar ${Math.floor(s.timeBeats / beatsPerBar) + 1}). Double-click to rename.`}
              aria-label={`Jump to ${s.name}, bar ${Math.floor(s.timeBeats / beatsPerBar) + 1}`}
            >
              {s.name}
              <span className="ml-1 text-[10px] text-zinc-500">{Math.floor(s.timeBeats / beatsPerBar) + 1}</span>
            </button>
          )}
          <button type="button" onClick={() => onLoop(s.timeBeats, endOf(i, list))} className="h-6 px-1 text-zinc-500 hover:text-zinc-100" aria-label={`Loop ${s.name}`} title={`Loop ${s.name} for another take`}>
            <Repeat className="h-3 w-3" />
          </button>
          <button type="button" onClick={() => void remove(s)} className="h-6 px-1 text-zinc-600 hover:text-red-400" aria-label={`Remove ${s.name}`}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {saved && sections !== null && (
        <span className="ml-1 flex flex-shrink-0 items-center gap-0.5">
          <Plus className="h-3 w-3 text-zinc-500" aria-hidden />
          {NAMES.map((n) => (
            <button key={n} type="button" onClick={() => void add(n)} className="rounded px-1.5 py-0.5 text-[11px] text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100" title={`Mark ${n} at the playhead's bar`} data-testid={`booth-add-section-${n.toLowerCase()}`}>
              {n}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}
