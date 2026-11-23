'use client';

/**
 * FsEditPanel — edit sequences with a timecoded timeline and cut list.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Film, Scissors, ChevronUp, ChevronDown, ScissorsLineDashed } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/ui';

interface Sequence { id: string; name: string; fps: string; clipCount: number }
interface CutClip { id: string; name: string; transition: string; durationFrames: number; startTimecode: string; endTimecode: string; mediaId: string | null }
interface CutList { sequence: string; fps: string; tracks: Record<string, CutClip[]>; totalRuntime: string }
interface Media { id: string; name: string; kind: string }

const FPS = ['23.976', '24', '25', '29.97', '30', '48', '60'];
const TRACKS = ['V1', 'V2', 'V3', 'A1', 'A2', 'A3'];
const TRANSITIONS = ['cut', 'dissolve', 'fade_in', 'fade_out', 'wipe'];
const TRACK_COLOR: Record<string, string> = {
  V1: 'border-sky-600', V2: 'border-sky-500', V3: 'border-sky-400',
  A1: 'border-emerald-600', A2: 'border-emerald-500', A3: 'border-emerald-400',
};

export function FsEditPanel({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [activeSeq, setActiveSeq] = useState<string>('');
  const [cut, setCut] = useState<CutList | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [seqForm, setSeqForm] = useState({ name: '', fps: '24' });
  const [clipForm, setClipForm] = useState({ name: '', track: 'V1', durationSec: '', transition: 'cut' });
  const [markers, setMarkers] = useState<{ id: string; label: string; frame: number }[]>([]);
  const [markerForm, setMarkerForm] = useState({ label: '', frame: '' });
  const [editingClip, setEditingClip] = useState<string | null>(null);
  const [media, setMedia] = useState<Media[]>([]);

  const loadMedia = useCallback(async () => {
    const r = await lensRun('film-studios', 'media-list', { projectId });
    if (r.data?.ok === false) { setLoadError(r.data?.error || 'Could not load media.'); return; }
    setMedia(r.data?.result?.media || []);
  }, [projectId]);
  useEffect(() => { void loadMedia(); }, [loadMedia]);

  const loadSequences = useCallback(async () => {
    const r = await lensRun('film-studios', 'sequence-list', { projectId });
    if (r.data?.ok === false) {
      setLoadError(r.data?.error || 'Could not load sequences.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    const list: Sequence[] = r.data?.result?.sequences || [];
    setSequences(list);
    setActiveSeq((prev) => (list.some((q) => q.id === prev) ? prev : list[0]?.id || ''));
    setLoading(false);
    onChange();
  }, [projectId, onChange]);

  const loadCut = useCallback(async () => {
    if (!activeSeq) { setCut(null); setMarkers([]); return; }
    const [r, m] = await Promise.all([
      lensRun('film-studios', 'cut-list', { sequenceId: activeSeq }),
      lensRun('film-studios', 'marker-list', { sequenceId: activeSeq }),
    ]);
    if (r.data?.ok === false || m.data?.ok === false) {
      setLoadError(r.data?.error || m.data?.error || 'Could not load the timeline.');
      return;
    }
    setCut((r.data?.result as CutList | null) || null);
    setMarkers(m.data?.result?.markers || []);
  }, [activeSeq]);

  const addMarker = async () => {
    if (!activeSeq || !markerForm.label.trim()) return;
    await lensRun('film-studios', 'marker-add', {
      sequenceId: activeSeq, label: markerForm.label.trim(), frame: Number(markerForm.frame) || 0,
    });
    setMarkerForm({ label: '', frame: '' });
    await loadCut();
  };

  useEffect(() => { void loadSequences(); }, [loadSequences]);
  useEffect(() => { void loadCut(); }, [loadCut]);

  const addSeq = async () => {
    if (!seqForm.name.trim()) return;
    await lensRun('film-studios', 'sequence-create', { projectId, name: seqForm.name.trim(), fps: seqForm.fps });
    setSeqForm({ name: '', fps: '24' });
    await loadSequences();
  };

  const addClip = async () => {
    if (!activeSeq || !clipForm.name.trim() || !(Number(clipForm.durationSec) > 0)) return;
    await lensRun('film-studios', 'clip-add', {
      sequenceId: activeSeq, name: clipForm.name.trim(), track: clipForm.track,
      durationSec: Number(clipForm.durationSec), transition: clipForm.transition,
    });
    setClipForm({ name: '', track: 'V1', durationSec: '', transition: 'cut' });
    await Promise.all([loadCut(), loadSequences()]);
  };

  const delClip = async (id: string) => {
    await lensRun('film-studios', 'clip-delete', { id });
    await Promise.all([loadCut(), loadSequences()]);
  };

  // NLE: ripple-delete closes the gap on the track instead of leaving a hole.
  const rippleDelClip = async (id: string) => {
    await lensRun('film-studios', 'clip-ripple-delete', { id });
    await Promise.all([loadCut(), loadSequences()]);
  };

  // NLE: trim a clip via in/out frames, change its transition or track.
  const updateClip = async (id: string, patch: Record<string, unknown>) => {
    await lensRun('film-studios', 'clip-update', { id, ...patch });
    await Promise.all([loadCut(), loadSequences()]);
  };

  // NLE: move a clip up/down within its track (reorder = ripple-safe).
  const moveClip = async (track: string, clips: CutClip[], index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= clips.length) return;
    const ids = clips.map((c) => c.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await lensRun('film-studios', 'clip-reorder', { sequenceId: activeSeq, track, clipIds: ids });
    await Promise.all([loadCut(), loadSequences()]);
  };

  // Link (or unlink) a timeline clip to a registered source media item —
  // real macro (clip-set-media), no UI existed for it before this pass.
  const setClipMedia = async (clipId: string, mediaId: string) => {
    await lensRun('film-studios', 'clip-set-media', { clipId, mediaId: mediaId || undefined });
    await loadCut();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-[var(--fo-muted,#a1a1aa)]"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (loadError) {
    return (
      <div className="p-4">
        <ErrorState
          message={loadError}
          onRetry={() => { void loadMedia(); void loadSequences(); void loadCut(); }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* New sequence */}
      <section className="flex items-center gap-2 bg-[var(--fo-paper-2,rgba(24,24,27,0.7))] border border-[var(--fo-rule,#27272a)] rounded-xl p-3">
        <input placeholder="Sequence name" value={seqForm.name} onChange={(e) => setSeqForm({ ...seqForm, name: e.target.value })}
          className="flex-1 bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]" />
        <select value={seqForm.fps} onChange={(e) => setSeqForm({ ...seqForm, fps: e.target.value })}
          className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]">
          {FPS.map((f) => <option key={f} value={f}>{f} fps</option>)}
        </select>
        <button type="button" onClick={addSeq}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-[var(--fo-tape,#c026d3)] hover:bg-[#b72d23] text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Sequence
        </button>
      </section>

      {sequences.length === 0 ? (
        <p className="text-[11px] text-[var(--fo-muted,#a1a1aa)] italic py-6 text-center">Create a sequence to start cutting.</p>
      ) : (
        <>
          <select value={activeSeq} onChange={(e) => setActiveSeq(e.target.value)}
            className="w-full bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-2 text-xs text-[var(--fo-ink,#f4f4f5)]">
            {sequences.map((q) => <option key={q.id} value={q.id}>{q.name} · {q.fps} fps · {q.clipCount} clips</option>)}
          </select>

          {/* New clip */}
          <section className="grid grid-cols-2 sm:grid-cols-5 gap-2 bg-[var(--fo-paper-2,rgba(24,24,27,0.7))] border border-[var(--fo-rule,#27272a)] rounded-xl p-3">
            <input placeholder="Clip name" value={clipForm.name} onChange={(e) => setClipForm({ ...clipForm, name: e.target.value })}
              className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]" />
            <select value={clipForm.track} onChange={(e) => setClipForm({ ...clipForm, track: e.target.value })}
              className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]">
              {TRACKS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input placeholder="Duration (s)" inputMode="decimal" value={clipForm.durationSec}
              onChange={(e) => setClipForm({ ...clipForm, durationSec: e.target.value })}
              className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]" />
            <select value={clipForm.transition} onChange={(e) => setClipForm({ ...clipForm, transition: e.target.value })}
              className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]">
              {TRANSITIONS.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
            <button type="button" onClick={addClip}
              className="flex items-center justify-center gap-1 bg-[var(--fo-tape,#c026d3)] hover:bg-[#b72d23] text-white text-xs font-medium rounded-lg">
              <Plus className="w-3.5 h-3.5" /> Clip
            </button>
          </section>

          {/* Timeline / cut list */}
          {cut && (
            <section>
              <h3 className="flex items-center gap-1 text-xs font-semibold text-[var(--fo-ink-2,#d4d4d8)] mb-2">
                <Scissors className="w-3.5 h-3.5 text-[var(--fo-tape,#e879f9)]" /> Timeline
                <span className="text-[var(--fo-muted,#a1a1aa)] font-normal">· runtime {cut.totalRuntime}</span>
              </h3>
              {Object.keys(cut.tracks).length === 0 ? (
                <p className="text-[11px] text-[var(--fo-muted,#a1a1aa)] italic py-4 text-center">No clips on the timeline yet.</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(cut.tracks).map(([track, clips]) => (
                    <div key={track}>
                      <p className="text-[10px] font-mono text-[var(--fo-muted,#a1a1aa)] mb-1">{track}</p>
                      <ul className="space-y-1">
                        {clips.map((c, idx) => (
                          <li key={c.id}
                            className={cn('bg-[var(--fo-paper-2,rgba(24,24,27,0.7))] border-l-4 rounded px-2.5 py-1.5 space-y-1.5', TRACK_COLOR[track] || 'border-[var(--fo-rule-2,#52525b)]',
                              editingClip === c.id && 'ring-1 ring-[rgba(214,58,47,0.45)]')}>
                            <div className="flex items-center gap-2">
                              <Film className="w-3.5 h-3.5 text-[var(--fo-muted,#a1a1aa)] shrink-0" />
                              <button type="button" onClick={() => setEditingClip(editingClip === c.id ? null : c.id)}
                                className="text-xs text-[var(--fo-ink,#f4f4f5)] flex-1 truncate text-left hover:text-[var(--fo-tape,#e879f9)]">{c.name}</button>
                              <span className="text-[10px] text-[var(--fo-muted,#a1a1aa)]">{c.transition.replace(/_/g, ' ')}</span>
                              <span className="text-[10px] font-mono text-[var(--fo-tape,#e879f9)]">{c.startTimecode}–{c.endTimecode}</span>
                              <button type="button" onClick={() => moveClip(track, clips, idx, -1)} disabled={idx === 0}
                                className="text-[var(--fo-faint,#52525b)] hover:text-[var(--fo-ink,#e4e4e7)] disabled:opacity-20" title="Move up">
                                <ChevronUp className="w-3.5 h-3.5" />
                              </button>
                              <button type="button" onClick={() => moveClip(track, clips, idx, 1)} disabled={idx === clips.length - 1}
                                className="text-[var(--fo-faint,#52525b)] hover:text-[var(--fo-ink,#e4e4e7)] disabled:opacity-20" title="Move down">
                                <ChevronDown className="w-3.5 h-3.5" />
                              </button>
                              <button type="button" onClick={() => rippleDelClip(c.id)}
                                className="text-[var(--fo-faint,#52525b)] hover:text-amber-400" title="Ripple delete (close gap)">
                                <ScissorsLineDashed className="w-3.5 h-3.5" />
                              </button>
                              <button type="button" onClick={() => delClip(c.id)} className="text-[var(--fo-faint,#52525b)] hover:text-[var(--fo-bad,#fb7185)]" title="Delete">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            {editingClip === c.id && (
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-1 border-t border-[var(--fo-rule,#27272a)]">
                                <label className="flex flex-col gap-0.5">
                                  <span className="text-[9px] text-[var(--fo-muted,#a1a1aa)] uppercase">In frame</span>
                                  <input inputMode="numeric" defaultValue="0"
                                    onBlur={(e) => updateClip(c.id, { inFrame: Number(e.target.value) || 0, outFrame: Number(e.target.value) + c.durationFrames })}
                                    className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded px-1.5 py-1 text-[11px] text-[var(--fo-ink,#f4f4f5)]" />
                                </label>
                                <label className="flex flex-col gap-0.5">
                                  <span className="text-[9px] text-[var(--fo-muted,#a1a1aa)] uppercase">Out frame</span>
                                  <input inputMode="numeric" defaultValue={String(c.durationFrames)}
                                    onBlur={(e) => updateClip(c.id, { inFrame: 0, outFrame: Number(e.target.value) || c.durationFrames })}
                                    className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded px-1.5 py-1 text-[11px] text-[var(--fo-ink,#f4f4f5)]" />
                                </label>
                                <label className="flex flex-col gap-0.5">
                                  <span className="text-[9px] text-[var(--fo-muted,#a1a1aa)] uppercase">Transition</span>
                                  <select defaultValue={c.transition}
                                    onChange={(e) => updateClip(c.id, { transition: e.target.value })}
                                    className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded px-1.5 py-1 text-[11px] text-[var(--fo-ink,#f4f4f5)]">
                                    {TRANSITIONS.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                                  </select>
                                </label>
                                <label className="flex flex-col gap-0.5">
                                  <span className="text-[9px] text-[var(--fo-muted,#a1a1aa)] uppercase">Track</span>
                                  <select defaultValue={track}
                                    onChange={(e) => updateClip(c.id, { track: e.target.value })}
                                    className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded px-1.5 py-1 text-[11px] text-[var(--fo-ink,#f4f4f5)]">
                                    {TRACKS.map((t) => <option key={t} value={t}>{t}</option>)}
                                  </select>
                                </label>
                                <label className="flex flex-col gap-0.5 col-span-2">
                                  <span className="text-[9px] text-[var(--fo-muted,#a1a1aa)] uppercase">Source media</span>
                                  <select defaultValue={c.mediaId || ''}
                                    onChange={(e) => setClipMedia(c.id, e.target.value)}
                                    className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded px-1.5 py-1 text-[11px] text-[var(--fo-ink,#f4f4f5)]">
                                    <option value="">Unlinked (freeform name only)</option>
                                    {media.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.kind})</option>)}
                                  </select>
                                </label>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
              {/* Markers */}
              <div className="mt-3 pt-2 border-t border-[var(--fo-rule,#27272a)]">
                <p className="text-[11px] font-semibold text-[var(--fo-muted,#a1a1aa)] mb-1.5">Markers</p>
                <div className="flex items-center gap-2 mb-1.5">
                  <input placeholder="Marker label" value={markerForm.label}
                    onChange={(e) => setMarkerForm({ ...markerForm, label: e.target.value })}
                    className="flex-1 bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded px-2 py-1 text-[11px] text-[var(--fo-ink,#f4f4f5)]" />
                  <input placeholder="frame" inputMode="numeric" value={markerForm.frame}
                    onChange={(e) => setMarkerForm({ ...markerForm, frame: e.target.value })}
                    className="w-20 bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded px-2 py-1 text-[11px] text-[var(--fo-ink,#f4f4f5)]" />
                  <button type="button" onClick={addMarker}
                    className="px-2.5 py-1 text-[11px] bg-[var(--fo-paper-2,#27272a)] hover:bg-[var(--fo-rule,#3f3f46)] text-[var(--fo-ink,#e4e4e7)] rounded">Add</button>
                </div>
                {markers.length > 0 && (
                  <ul className="space-y-0.5">
                    {markers.map((mk) => (
                      <li key={mk.id} className="flex items-center gap-2 text-[11px] text-[var(--fo-ink-2,#d4d4d8)]">
                        <span className="w-2 h-2 rounded-full bg-amber-400" />
                        <span className="font-mono text-[var(--fo-muted,#a1a1aa)]">f{mk.frame}</span>
                        <span className="flex-1">{mk.label}</span>
                        <button aria-label="Delete" type="button"
                          onClick={() => lensRun('film-studios', 'marker-delete', { id: mk.id }).then(loadCut)}
                          className="text-[var(--fo-faint,#52525b)] hover:text-[var(--fo-bad,#fb7185)]"><Trash2 className="w-3 h-3" /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
