'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Mic, Piano, Drum, Volume2, Headphones } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DAWProject, DAWTrack, DAWClip } from '@/lib/daw/types';
import type { NewTrackKind } from '@/lib/daw/project';
import { trackKind } from '@/lib/daw/project';
import { bpmAt, clampTempo, projectTempoPoints, TEMPO_MAX, TEMPO_MIN, type TempoPoint } from '@/lib/daw/tempo-map';
import { getStudioEngine } from '@/lib/daw/playback-engine';
import { useBeatFrame } from './engine-hooks';
import { MidiThumb, WaveThumb } from './ClipShapes';

export const HEADER_W = 208;
export const RULER_H = 26;
export const TRACK_H = 64;
export const TEMPO_H = 52;

export interface ArrangeViewProps {
  project: DAWProject;
  beatWidth: number;
  selectedTrackId: string | null;
  selectedClipId: string | null;
  recordingTrackIds: string[];
  onSelectTrack: (id: string) => void;
  onSelectClip: (id: string | null) => void;
  onAddTrack: (kind: NewTrackKind) => void;
  onCreateClip: (trackId: string, startBeat: number) => void;
  onMoveClip: (clipId: string, trackId: string, startBeat: number) => void;
  onResizeClip: (clipId: string, lengthBeats: number) => void;
  onSeek: (beat: number) => void;
  onSetLoop: (start: number, end: number) => void;
  onTrackChange: (id: string, patch: Partial<DAWTrack>, coalesceKey?: string) => void;
  onDropFiles: (trackId: string | null, beat: number, files: File[]) => void;
  onDropItem: (trackId: string | null, beat: number, payload: string) => void;
  onZoom: (beatWidth: number) => void;
  onTempo: (points: TempoPoint[]) => void;
}

const snapTo = (b: number, grid: number) => Math.round(b / grid) * grid;

function TrackIcon({ t }: { t: DAWTrack }) {
  const k = trackKind(t);
  const I = k === 'audio' ? Mic : k === 'drums' ? Drum : Piano;
  return <I className="h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />;
}

const TrackMeter = memo(function TrackMeter({ trackId }: { trackId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useBeatFrame(() => {
    const db = getStudioEngine().trackPeakDb(trackId);
    const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
    if (ref.current) {
      ref.current.style.height = `${pct}%`;
      ref.current.style.background = db > -0.5 ? '#ef4444' : db > -6 ? '#f59e0b' : '#22c55e';
    }
  });
  return <div className="relative h-10 w-1.5 overflow-hidden rounded-sm bg-black/50"><div ref={ref} className="absolute bottom-0 w-full" /></div>;
});

function TrackHeader({ t, selected, recording, onSelect, onChange }: { t: DAWTrack; selected: boolean; recording: boolean; onSelect: () => void; onChange: (patch: Partial<DAWTrack>, key?: string) => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <div
      onClick={onSelect}
      className={cn('flex items-stretch border-b border-white/5', selected ? 'bg-white/[0.07]' : 'bg-[#14141b] hover:bg-white/[0.04]')}
      style={{ height: TRACK_H }}
      data-testid="studio-track-header"
    >
      <div className="w-1" style={{ background: t.color }} />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-2">
        <div className="flex items-center gap-1.5">
          <TrackIcon t={t} />
          {editing ? (
            <input
              autoFocus
              defaultValue={t.name}
              onBlur={(e) => { onChange({ name: e.target.value.trim() || t.name }); setEditing(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(false); e.stopPropagation(); }}
              className="min-w-0 flex-1 rounded bg-black/40 px-1 text-xs text-white outline-none"
            />
          ) : (
            <span onDoubleClick={() => setEditing(true)} className="truncate text-xs font-medium text-zinc-200">{t.name}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={(e) => { e.stopPropagation(); onChange({ mute: !t.mute }); }} className={cn('h-5 w-5 rounded text-[10px] font-bold', t.mute ? 'bg-amber-500 text-black' : 'bg-white/5 text-zinc-400')} title="Mute">M</button>
          <button onClick={(e) => { e.stopPropagation(); onChange({ solo: !t.solo }); }} className={cn('h-5 w-5 rounded text-[10px] font-bold', t.solo ? 'bg-sky-400 text-black' : 'bg-white/5 text-zinc-400')} title="Solo">S</button>
          {t.type === 'audio' && (
            <button onClick={(e) => { e.stopPropagation(); onChange({ armed: !t.armed }); }} className={cn('flex h-5 w-5 items-center justify-center rounded', t.armed ? 'bg-red-500 text-white' : 'bg-white/5 text-red-400', recording && 'animate-pulse')} title="Arm for recording" data-testid="studio-arm">
              <span className="h-2 w-2 rounded-full bg-current" />
            </button>
          )}
          <input
            type="range" min={-60} max={6} step={0.5}
            value={Number.isFinite(t.volume) ? Math.max(-60, t.volume) : -60}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => { const v = Number(e.target.value); onChange({ volume: v <= -60 ? -Infinity : v }, `vol-${t.id}`); }}
            className="ml-1 h-1 w-16 accent-zinc-300"
            title={`Volume ${Number.isFinite(t.volume) ? t.volume.toFixed(1) : '-∞'} dB`}
          />
        </div>
      </div>
      <div className="flex items-center pr-2"><TrackMeter trackId={t.id} /></div>
    </div>
  );
}

interface DragState {
  clipId: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  origStart: number;
  origLen: number;
  origTrackIndex: number;
  beat: number;
  len: number;
  trackIndex: number;
}

export function ArrangeView(p: ArrangeViewProps) {
  const { project, beatWidth: bw } = p;
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const bpb = project.timeSignature?.[0] || 4;
  const tracks = project.tracks.filter((t) => t.type !== 'master');
  const endBeat = Math.max(project.arrangement.lengthBars * bpb, ...tracks.flatMap((t) => t.clips.filter((c) => c.slot === undefined).map((c) => c.startBeat + c.lengthBeats + bpb * 4)));
  const width = endBeat * bw;

  useBeatFrame((beat) => {
    const el = playheadRef.current;
    if (!el) return;
    const x = Math.max(0, beat) * bw;
    el.style.transform = `translateX(${x}px)`;
    const sc = scrollRef.current;
    if (sc && getStudioEngine().isPlaying) {
      const view = sc.clientWidth - HEADER_W;
      if (x - sc.scrollLeft > view - 40 || x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - 80);
    }
  });

  const beatFromClientX = useCallback((clientX: number) => {
    const sc = scrollRef.current;
    if (!sc) return 0;
    const rect = sc.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left - HEADER_W + sc.scrollLeft) / bw);
  }, [bw]);

  // Drag (move / resize) — preview locally, commit once on release (one undo step).
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const dxBeats = (e.clientX - drag.startX) / bw;
      const grid = e.altKey ? 1 / 64 : 0.25;
      if (drag.mode === 'move') {
        const beat = Math.max(0, snapTo(drag.origStart + dxBeats, grid));
        const ti = Math.max(0, Math.min(tracks.length - 1, drag.origTrackIndex + Math.round((e.clientY - drag.startY) / TRACK_H)));
        setDrag((d) => (d ? { ...d, beat, trackIndex: ti } : d));
      } else {
        const len = Math.max(0.25, snapTo(drag.origLen + dxBeats, grid));
        setDrag((d) => (d ? { ...d, len } : d));
      }
    };
    const onUp = () => {
      const d = drag;
      setDrag(null);
      if (d.mode === 'move' && (d.beat !== d.origStart || d.trackIndex !== d.origTrackIndex)) p.onMoveClip(d.clipId, tracks[d.trackIndex].id, d.beat);
      if (d.mode === 'resize' && d.len !== d.origLen) p.onResizeClip(d.clipId, d.len);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [drag, bw, tracks, p]);

  const startDrag = (e: React.PointerEvent, clip: DAWClip, trackIndex: number, mode: 'move' | 'resize') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    p.onSelectClip(clip.id);
    p.onSelectTrack(clip.trackId);
    setDrag({ clipId: clip.id, mode, startX: e.clientX, startY: e.clientY, origStart: clip.startBeat, origLen: clip.lengthBeats, origTrackIndex: trackIndex, beat: clip.startBeat, len: clip.lengthBeats, trackIndex });
  };

  // Ruler: click to seek, shift-drag to set the loop.
  const [loopDrag, setLoopDrag] = useState<{ from: number; to: number } | null>(null);
  const onRulerDown = (e: React.PointerEvent) => {
    const b = snapTo(beatFromClientX(e.clientX), 1);
    if (e.shiftKey) {
      setLoopDrag({ from: b, to: b });
      const move = (ev: PointerEvent) => setLoopDrag({ from: b, to: snapTo(beatFromClientX(ev.clientX), 1) });
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        const to = snapTo(beatFromClientX(ev.clientX), 1);
        setLoopDrag(null);
        if (Math.abs(to - b) >= 1) p.onSetLoop(Math.min(b, to), Math.max(b, to));
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up, { once: true });
      return;
    }
    p.onSeek(snapTo(beatFromClientX(e.clientX), 0.25));
  };

  const onLaneDrop = (e: React.DragEvent, trackId: string | null) => {
    e.preventDefault();
    const beat = snapTo(beatFromClientX(e.clientX), 1);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) { p.onDropFiles(trackId, beat, files); return; }
    const payload = e.dataTransfer.getData('application/x-concord-music');
    if (payload) p.onDropItem(trackId, beat, payload);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    p.onZoom(Math.max(6, Math.min(120, bw * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
  };

  const loop = project.transport;
  const bars = Math.ceil(endBeat / bpb);

  return (
    <div ref={scrollRef} className="relative h-full overflow-auto bg-[#0e0e13]" onWheel={onWheel} data-testid="studio-arrange">
      <div style={{ width: width + HEADER_W, minHeight: '100%' }} className="relative">
        {/* Ruler */}
        <div className="sticky top-0 z-20 flex" style={{ height: RULER_H }}>
          <div className="sticky left-0 z-30 flex items-center gap-1 border-b border-r border-white/5 bg-[#101016] px-2 text-[10px] text-zinc-500" style={{ width: HEADER_W }}>
            Shift-drag ruler to loop
          </div>
          <div className="relative cursor-pointer border-b border-white/5 bg-[#101016]" style={{ width }} onPointerDown={onRulerDown}>
            {Array.from({ length: bars }, (_, i) => (
              <div key={i} className="absolute top-0 h-full border-l border-white/10 pl-1 text-[10px] leading-[26px] text-zinc-500" style={{ left: i * bpb * bw }}>{i + 1}</div>
            ))}
            {loop.loopEnabled && loop.loopEnd > loop.loopStart && (
              <div className="absolute top-0 h-1.5 rounded-b bg-sky-400/70" style={{ left: loop.loopStart * bw, width: (loop.loopEnd - loop.loopStart) * bw }} />
            )}
            {loopDrag && <div className="absolute top-0 h-full bg-sky-400/20" style={{ left: Math.min(loopDrag.from, loopDrag.to) * bw, width: Math.abs(loopDrag.to - loopDrag.from) * bw }} />}
          </div>
        </div>

        <TempoLane project={project} beatWidth={bw} beatsPerBar={bpb} endBeat={endBeat} beatFromClientX={beatFromClientX} onTempo={p.onTempo} />

        {/* Tracks */}
        {tracks.map((t, ti) => (
          <div key={t.id} className="flex">
            <div className="sticky left-0 z-10 border-r border-white/5" style={{ width: HEADER_W }}>
              <TrackHeader
                t={t}
                selected={p.selectedTrackId === t.id}
                recording={p.recordingTrackIds.includes(t.id)}
                onSelect={() => p.onSelectTrack(t.id)}
                onChange={(patch, key) => p.onTrackChange(t.id, patch, key)}
              />
            </div>
            <div
              className={cn('relative border-b border-white/5', p.selectedTrackId === t.id ? 'bg-white/[0.02]' : '')}
              style={{ width, height: TRACK_H, backgroundImage: `repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, transparent 1px ${bw * bpb}px)` }}
              onDoubleClick={(e) => {
                if (t.type === 'audio') return;
                p.onCreateClip(t.id, Math.floor(beatFromClientX(e.clientX) / bpb) * bpb);
              }}
              onClick={() => { p.onSelectTrack(t.id); p.onSelectClip(null); }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onLaneDrop(e, t.id)}
              title={t.type === 'audio' ? 'Arm and record, or drop audio files here' : 'Double-click to create a MIDI clip'}
            >
              {t.clips.filter((c) => c.slot === undefined).map((c) => {
                const isDrag = drag?.clipId === c.id;
                const start = isDrag && drag.mode === 'move' ? drag.beat : c.startBeat;
                const len = isDrag && drag.mode === 'resize' ? drag.len : c.lengthBeats;
                const dy = isDrag && drag.mode === 'move' ? (drag.trackIndex - ti) * TRACK_H : 0;
                const w = Math.max(6, len * bw);
                const sel = p.selectedClipId === c.id;
                return (
                  <div
                    key={c.id}
                    onPointerDown={(e) => startDrag(e, c, ti, 'move')}
                    onDoubleClick={(e) => { e.stopPropagation(); p.onSelectClip(c.id); }}
                    onClick={(e) => e.stopPropagation()}
                    className={cn('absolute top-1 cursor-grab overflow-hidden rounded-md border text-[10px] active:cursor-grabbing', sel ? 'border-white ring-1 ring-white/60' : 'border-black/30', isDrag && 'z-10 opacity-80')}
                    style={{ left: start * bw, width: w, height: TRACK_H - 8, transform: `translateY(${dy}px)`, background: `${c.color || t.color}cc` }}
                    data-testid="studio-clip"
                  >
                    {c.type === 'audio'
                      ? <WaveThumb asset={project.audioAssets?.[c.audioBufferId || '']} clip={{ ...c, lengthBeats: len }} width={w} height={TRACK_H - 8} bpm={bpmAt(projectTempoPoints(project), start)} />
                      : <MidiThumb clip={{ ...c, lengthBeats: len }} width={w} height={TRACK_H - 8} />}
                    <div className="relative truncate px-1.5 pt-0.5 font-medium text-white drop-shadow">{c.name}</div>
                    <div onPointerDown={(e) => startDrag(e, c, ti, 'resize')} className="absolute right-0 top-0 h-full w-2 cursor-ew-resize hover:bg-white/30" />
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Add track — always visible under the last track */}
        <div className="flex">
          <div className="sticky left-0 z-10 border-r border-white/5 bg-[#101016] p-2" style={{ width: HEADER_W }}>
            {addOpen ? (
              <div className="grid grid-cols-3 gap-1">
                {([['audio', 'Audio', Mic], ['instrument', 'Instrument', Piano], ['drums', 'Drums', Drum]] as const).map(([k, label, Icon]) => (
                  <button key={k} onClick={() => { p.onAddTrack(k); setAddOpen(false); }} className="flex flex-col items-center gap-0.5 rounded bg-white/5 py-1.5 text-[10px] text-zinc-300 hover:bg-white/10" data-testid={`studio-add-${k}`}>
                    <Icon className="h-3.5 w-3.5" />{label}
                  </button>
                ))}
              </div>
            ) : (
              <button onClick={() => setAddOpen(true)} className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-white/15 py-2 text-xs text-zinc-400 hover:border-white/30 hover:text-white" data-testid="studio-add-track">
                <Plus className="h-3.5 w-3.5" /> Add track
              </button>
            )}
          </div>
          <div
            className="flex flex-1 items-center px-4 text-[11px] text-zinc-600"
            style={{ width, height: 64 }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onLaneDrop(e, null)}
          >
            {tracks.length === 0 ? 'Add a track, or drop audio / MIDI files here to start.' : 'Drop audio or MIDI here to add a new track'}
          </div>
        </div>

        {/* Playhead */}
        <div ref={playheadRef} className="pointer-events-none absolute top-0 z-20 h-full w-px bg-emerald-300" style={{ left: HEADER_W }} />
      </div>
      {tracks.some((t) => t.armed) && (
        <div className="pointer-events-none sticky bottom-2 left-2 z-30 inline-flex items-center gap-1 rounded bg-black/70 px-2 py-1 text-[10px] text-zinc-400">
          <Headphones className="h-3 w-3" /> Armed — press record (R). <Volume2 className="h-3 w-3" /> Use headphones if monitoring.
        </div>
      )}
    </div>
  );
}

function TempoLane({
  project, beatWidth, beatsPerBar, endBeat, beatFromClientX, onTempo,
}: {
  project: DAWProject;
  beatWidth: number;
  beatsPerBar: number;
  endBeat: number;
  beatFromClientX: (clientX: number) => number;
  onTempo: (points: TempoPoint[]) => void;
}) {
  const stored = projectTempoPoints(project);
  const [selBeat, setSelBeat] = useState(0);
  const [drag, setDrag] = useState<{ fromBeat: number; beat: number; bpm: number } | null>(null);
  const points = stored.map((pt) => (drag && Math.abs(pt.beat - drag.fromBeat) < 1e-6 ? { ...pt, beat: drag.beat, bpm: drag.bpm } : pt));
  const sel = points.reduce((best, pt) => (Math.abs(pt.beat - selBeat) < Math.abs(best.beat - selBeat) ? pt : best), points[0]);
  const width = Math.max(endBeat, ...points.map((pt) => pt.beat + beatsPerBar)) * beatWidth;
  const yFor = (bpm: number) => {
    const t = (clampTempo(bpm) - TEMPO_MIN) / (TEMPO_MAX - TEMPO_MIN);
    return (1 - t) * (TEMPO_H - 10) + 5;
  };
  const bpmFromY = (y: number) => clampTempo(Math.round(TEMPO_MIN + (1 - (y - 5) / (TEMPO_H - 10)) * (TEMPO_MAX - TEMPO_MIN)));
  const snap = (beat: number, fine: boolean) => {
    const grid = fine ? 0.25 : 1;
    return Math.max(0, Math.round(beat / grid) * grid);
  };
  const commit = (next: TempoPoint[]) => {
    const sorted = [...next].sort((a, b) => a.beat - b.beat);
    onTempo(sorted);
  };
  const poly = tempoPolyline(points, beatWidth, yFor);
  return (
    <div className="flex border-b border-white/5" style={{ height: TEMPO_H }} data-testid="studio-tempo-lane">
      <div className="sticky left-0 z-30 flex flex-col justify-center gap-1 border-r border-white/5 bg-[#101016] px-2" style={{ width: HEADER_W }}>
        <div className="flex items-center justify-between text-[10px] text-zinc-500">
          <span>Tempo</span>
          <span className="font-mono text-zinc-300">{Math.round(bpmAt(points, sel.beat))} BPM</span>
        </div>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={TEMPO_MIN}
            max={TEMPO_MAX}
            value={Math.round(sel.bpm)}
            aria-label="Tempo point BPM"
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= TEMPO_MIN && v <= TEMPO_MAX) commit(stored.map((pt) => (Math.abs(pt.beat - sel.beat) < 1e-6 ? { ...pt, bpm: clampTempo(v) } : pt)));
            }}
            className="w-14 rounded bg-black/40 px-1 py-0.5 text-right text-[11px] text-zinc-100 outline-none"
          />
          <button
            type="button"
            className={cn('rounded px-1.5 py-0.5 text-[10px]', sel.curve === 'step' ? 'bg-amber-500/25 text-amber-200' : 'bg-white/5 text-zinc-400')}
            title="Hold this tempo until the next point"
            onClick={() => commit(stored.map((pt) => (Math.abs(pt.beat - sel.beat) < 1e-6 ? { ...pt, curve: 'step' } : pt)))}
          >Step</button>
          <button
            type="button"
            className={cn('rounded px-1.5 py-0.5 text-[10px]', sel.curve === 'linear' ? 'bg-sky-500/25 text-sky-200' : 'bg-white/5 text-zinc-400')}
            title="Ramp linearly to the next point"
            onClick={() => commit(stored.map((pt) => (Math.abs(pt.beat - sel.beat) < 1e-6 ? { ...pt, curve: 'linear' } : pt)))}
          >Ramp</button>
          <button
            type="button"
            disabled={stored.length < 2 || sel.beat <= 1e-6}
            className="rounded px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-white/10 disabled:opacity-30"
            title="Remove this breakpoint. The point at beat 0 stays."
            onClick={() => commit(stored.filter((pt) => Math.abs(pt.beat - sel.beat) > 1e-6))}
          >Delete</button>
        </div>
      </div>
      <div
        className="relative cursor-crosshair bg-[#0c0c12]"
        style={{ width }}
        title="Double-click to add a tempo point (20–999 BPM). Drag a point to move it. Alt snaps to quarter beats."
        onDoubleClick={(e) => {
          const beat = snap(beatFromClientX(e.clientX), e.altKey);
          const bpm = bpmFromY(e.nativeEvent.offsetY);
          const without = stored.filter((pt) => Math.abs(pt.beat - beat) > 0.05);
          const next = [...without, { beat, bpm, curve: 'step' as const }].sort((a, b) => a.beat - b.beat);
          onTempo(next);
          setSelBeat(beat);
        }}
      >
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          <polyline fill="none" stroke="#f59e0b" strokeWidth="1.5" points={poly} />
        </svg>
        {points.map((pt) => (
          <button
            key={`${drag ? 'd' : 's'}-${pt.beat}`}
            type="button"
            data-testid="studio-tempo-point"
            title={`${pt.curve === 'linear' ? 'Ramp' : 'Step'} · ${Math.round(pt.bpm)} BPM at beat ${pt.beat}`}
            className={cn('absolute z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-200', Math.abs(pt.beat - sel.beat) < 1e-6 ? 'bg-amber-300' : 'bg-amber-600')}
            style={{ left: pt.beat * beatWidth, top: yFor(pt.bpm) }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              e.preventDefault();
              const fromBeat = stored.find((s) => Math.abs(s.beat - pt.beat) < 1e-6)?.beat ?? pt.beat;
              setSelBeat(fromBeat);
              const origin = { x: e.clientX, y: e.clientY, beat: fromBeat, bpm: pt.bpm };
              let latest = { fromBeat, beat: fromBeat, bpm: pt.bpm };
              const move = (ev: PointerEvent) => {
                const beat = fromBeat <= 1e-6 ? 0 : Math.max(0, snap(origin.beat + (ev.clientX - origin.x) / beatWidth, ev.altKey));
                const bpm = clampTempo(Math.round(origin.bpm - ((ev.clientY - origin.y) / (TEMPO_H - 10)) * (TEMPO_MAX - TEMPO_MIN)));
                latest = { fromBeat, beat, bpm };
                setDrag(latest);
              };
              const up = () => {
                window.removeEventListener('pointermove', move);
                setDrag(null);
                const next = stored.map((p) => (Math.abs(p.beat - fromBeat) < 1e-6 ? { ...p, beat: latest.beat, bpm: latest.bpm } : p));
                const keys = next.map((p) => p.beat.toFixed(4));
                if (new Set(keys).size !== keys.length) return;
                onTempo([...next].sort((a, b) => a.beat - b.beat));
                setSelBeat(latest.beat);
              };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up, { once: true });
            }}
            onClick={(e) => { e.stopPropagation(); setSelBeat(pt.beat); }}
          />
        ))}
      </div>
    </div>
  );
}

/** Step holds, then jumps. Linear is a straight line in BPM between points. */
function tempoPolyline(points: TempoPoint[], beatWidth: number, yFor: (bpm: number) => number): string {
  const cmds: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    cmds.push(`${a.beat * beatWidth},${yFor(a.bpm)}`);
    if (!b) break;
    if (a.curve === 'step') cmds.push(`${b.beat * beatWidth},${yFor(a.bpm)}`);
    cmds.push(`${b.beat * beatWidth},${yFor(b.bpm)}`);
  }
  return cmds.join(' ');
}
