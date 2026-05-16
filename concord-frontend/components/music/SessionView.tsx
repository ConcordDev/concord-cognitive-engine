'use client';

/**
 * SessionView — Ableton-shape clip-launching grid.
 *
 * Tracks run as columns. Scenes (playlists) run as rows. Each cell is
 * a clip the user can launch — clicking starts playback at the next
 * beat, queueing visually before the launch lands. The transport bar
 * down top mirrors Ableton: play / stop / record / loop / metronome
 * + tempo + position.
 *
 * This is the distinctive silhouette of a DAW. It coexists with the
 * existing music-lens views (home / browse / artist / album / etc.);
 * users open it via the new "Session" tab or the lens-scoped 's' key.
 */

import { useMemo, useState } from 'react';
import { Play, Square, Circle, Repeat, Music2, Disc, Mic, Volume2, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SessionTrack {
  id: string;
  name: string;
  color?: string;
  muted?: boolean;
  soloed?: boolean;
  armed?: boolean;
}

export interface SessionScene {
  id: string;
  name: string;
}

export interface SessionClip {
  trackId: string;
  sceneId: string;
  /** Audio asset / DTU id or live-loop seed name. */
  assetId?: string;
  label?: string;
  hasContent: boolean;
  durationBeats?: number;
  color?: string;
}

export interface SessionViewProps {
  tracks: SessionTrack[];
  scenes: SessionScene[];
  /** Lookup keyed by `${trackId}:${sceneId}`; missing means empty cell. */
  clips: Record<string, SessionClip>;
  tempo?: number;
  onLaunchClip?: (clip: SessionClip) => void;
  onLaunchScene?: (scene: SessionScene) => void;
  onStopAll?: () => void;
  onTempoChange?: (bpm: number) => void;
  /** Double-click a populated clip → open the detail editor drawer
   *  (drum cell → DrumMachine, melodic → PianoRoll, audio → AudioEditor). */
  onDoubleClickClip?: (clip: SessionClip) => void;
  /** Drag from the Browser rail and drop onto a cell. payload is the
   *  parsed `application/x-concord-asset` JSON: { assetId, kind, title }. */
  onDropAsset?: (trackId: string, sceneId: string, payload: { assetId: string; kind?: string; title?: string }) => void;
  /** Click an empty cell (no content yet). Used by some UX paths to
   *  open the asset picker. Distinct from drop. */
  onClickEmptyCell?: (trackId: string, sceneId: string) => void;
  /** Cursor presence — other users' grid hover positions for live collab. */
  ghostCursors?: Array<{ userId: string; userName?: string; trackId: string; sceneId: string; color?: string }>;
  /** Local mouse move on the grid, throttled — for outgoing presence emit. */
  onCellHover?: (trackId: string | null, sceneId: string | null) => void;
  /** Optional id of the clip currently sounding, for the active glow. */
  playingClipKey?: string;
  /** Clips queued at the next bar — visualised differently from playing. */
  queuedClipKeys?: Set<string>;
}

const TRACK_COLOR_FALLBACK = [
  'bg-cyan-500/30 border-cyan-500/40',
  'bg-amber-500/30 border-amber-500/40',
  'bg-rose-500/30 border-rose-500/40',
  'bg-emerald-500/30 border-emerald-500/40',
  'bg-violet-500/30 border-violet-500/40',
  'bg-pink-500/30 border-pink-500/40',
  'bg-lime-500/30 border-lime-500/40',
  'bg-orange-500/30 border-orange-500/40',
];

function trackColor(track: SessionTrack, idx: number): string {
  return track.color ?? TRACK_COLOR_FALLBACK[idx % TRACK_COLOR_FALLBACK.length];
}

export function SessionView({
  tracks,
  scenes,
  clips,
  tempo = 120,
  onLaunchClip,
  onLaunchScene,
  onStopAll,
  onTempoChange,
  onDoubleClickClip,
  onDropAsset,
  onClickEmptyCell,
  ghostCursors,
  onCellHover,
  playingClipKey,
  queuedClipKeys,
}: SessionViewProps) {
  const [transport, setTransport] = useState<'stopped' | 'playing' | 'recording'>('stopped');
  const [loop, setLoop] = useState(false);
  const [metronome, setMetronome] = useState(false);
  const [tempoLocal, setTempoLocal] = useState(tempo);

  const trackColors = useMemo(
    () => tracks.map((t, i) => trackColor(t, i)),
    [tracks]
  );

  function handlePlay() {
    setTransport(transport === 'playing' ? 'stopped' : 'playing');
  }
  function handleRecord() {
    setTransport((t) => (t === 'recording' ? 'stopped' : 'recording'));
  }
  function handleStop() {
    setTransport('stopped');
    onStopAll?.();
  }

  return (
    <div className="flex flex-col h-full bg-[#0d0d0f] text-gray-200 font-mono text-sm">
      {/* Transport bar — the Ableton tell. */}
      <header className="flex items-center gap-3 border-b border-white/10 bg-black/60 px-4 py-2">
        <button
          onClick={handlePlay}
          aria-pressed={transport === 'playing'}
          className={cn(
            'inline-flex items-center justify-center h-7 w-7 rounded-full border',
            transport === 'playing'
              ? 'border-emerald-400 bg-emerald-500/30 text-emerald-200'
              : 'border-white/20 text-white/70 hover:border-white/40'
          )}
          title="Play / pause"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
        </button>
        <button
          onClick={handleStop}
          className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-white/20 text-white/70 hover:border-white/40"
          title="Stop all clips"
        >
          <Square className="w-3.5 h-3.5 fill-current" />
        </button>
        <button
          onClick={handleRecord}
          aria-pressed={transport === 'recording'}
          className={cn(
            'inline-flex items-center justify-center h-7 w-7 rounded-full border',
            transport === 'recording'
              ? 'border-rose-400 bg-rose-500/40 text-rose-200 animate-pulse'
              : 'border-white/20 text-white/70 hover:border-rose-400 hover:text-rose-300'
          )}
          title="Arm record"
        >
          <Circle className="w-3.5 h-3.5 fill-current" />
        </button>
        <button
          onClick={() => setLoop((v) => !v)}
          aria-pressed={loop}
          className={cn(
            'inline-flex items-center justify-center h-7 w-7 rounded-full border',
            loop
              ? 'border-amber-400 bg-amber-500/30 text-amber-200'
              : 'border-white/20 text-white/70 hover:border-white/40'
          )}
          title="Loop"
        >
          <Repeat className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setMetronome((v) => !v)}
          aria-pressed={metronome}
          className={cn(
            'inline-flex items-center justify-center h-7 w-7 rounded-full border',
            metronome
              ? 'border-cyan-400 bg-cyan-500/30 text-cyan-200'
              : 'border-white/20 text-white/70 hover:border-white/40'
          )}
          title="Metronome"
        >
          <Music2 className="w-3.5 h-3.5" />
        </button>
        <div className="ml-3 flex items-center gap-1.5">
          <span className="text-[11px] text-white/50 uppercase tracking-wider">bpm</span>
          <input
            type="number"
            min={20}
            max={400}
            value={tempoLocal}
            onChange={(e) => {
              const v = Number(e.target.value) || tempoLocal;
              setTempoLocal(v);
              onTempoChange?.(v);
            }}
            className="w-16 bg-black/40 border border-white/10 rounded px-1.5 py-0.5 text-center text-amber-200 font-mono"
          />
        </div>
        <div className="ml-auto inline-flex items-center gap-2 text-[11px] text-white/50">
          <Disc className="w-3 h-3" /> session view
        </div>
      </header>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        <div className="min-w-max">
          {/* Track header row */}
          <div className="sticky top-0 z-10 flex bg-[#0d0d0f]/95 backdrop-blur border-b border-white/10">
            <div className="w-32 shrink-0 px-3 py-2 text-[11px] uppercase tracking-wider text-white/50 border-r border-white/10">
              scene
            </div>
            {tracks.map((track, ti) => (
              <div
                key={track.id}
                className={cn(
                  'w-40 shrink-0 px-3 py-2 border-r border-white/10',
                  'flex flex-col gap-1'
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-white truncate">{track.name}</span>
                  <div className="flex items-center gap-1">
                    {track.armed && <Mic className="w-3 h-3 text-rose-300" aria-label="Armed" />}
                    {track.muted && <Volume2 className="w-3 h-3 text-white/30" aria-label="Muted" />}
                  </div>
                </div>
                <div className={cn('h-1 rounded-full', trackColors[ti])} />
              </div>
            ))}
          </div>

          {/* Scene rows */}
          {scenes.map((scene) => (
            <div key={scene.id} className="flex border-b border-white/5 hover:bg-white/[0.02]">
              <button
                onClick={() => onLaunchScene?.(scene)}
                className="w-32 shrink-0 px-3 py-3 text-left text-xs text-amber-200 border-r border-white/10 hover:bg-amber-500/10 inline-flex items-center gap-1.5 group"
                title="Launch entire scene"
              >
                <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100" />
                <span className="truncate">{scene.name}</span>
              </button>
              {tracks.map((track, ti) => {
                const key = `${track.id}:${scene.id}`;
                const clip = clips[key];
                const isPlaying = playingClipKey === key;
                const isQueued = queuedClipKeys?.has(key);
                // Other-user cursors hovering this cell
                const cursorsHere = (ghostCursors || []).filter(g => g.trackId === track.id && g.sceneId === scene.id);
                // Common drag/drop handlers — accept the Concord asset
                // payload from the Browser rail; show a highlight ring
                // when an asset is dragged over.
                const handleDragOver = (e: React.DragEvent) => {
                  if (e.dataTransfer.types.includes('application/x-concord-asset')) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                  }
                };
                const handleDrop = (e: React.DragEvent) => {
                  const raw = e.dataTransfer.getData('application/x-concord-asset');
                  if (!raw) return;
                  e.preventDefault();
                  try {
                    const payload = JSON.parse(raw);
                    onDropAsset?.(track.id, scene.id, payload);
                  } catch { /* malformed payload — silently ignore */ }
                };
                return (
                  <div
                    key={track.id}
                    className="w-40 shrink-0 p-1.5 border-r border-white/5 relative"
                    onMouseEnter={() => onCellHover?.(track.id, scene.id)}
                    onMouseLeave={() => onCellHover?.(null, null)}
                  >
                    {clip?.hasContent ? (
                      <button
                        onClick={() => onLaunchClip?.(clip)}
                        onDoubleClick={() => onDoubleClickClip?.(clip)}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop}
                        className={cn(
                          'w-full h-12 rounded-md border text-left px-2 flex items-center gap-2 transition',
                          isPlaying
                            ? 'ring-2 ring-emerald-400 ring-offset-1 ring-offset-[#0d0d0f] border-emerald-400 bg-emerald-500/30 text-emerald-100 animate-pulse'
                            : isQueued
                              ? 'border-amber-400 bg-amber-500/20 text-amber-100'
                              : `${trackColors[ti]} text-white hover:brightness-125`
                        )}
                        title={`Launch · double-click to edit · drop asset to bind`}
                      >
                        <Play className="w-3 h-3 flex-shrink-0 fill-current" />
                        <span className="text-[11px] truncate">{clip.label ?? clip.assetId ?? 'clip'}</span>
                        {clip.durationBeats && (
                          <span className="ml-auto text-[10px] opacity-70">{clip.durationBeats}b</span>
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onClickEmptyCell?.(track.id, scene.id)}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop}
                        aria-label={`Empty slot ${track.name} scene ${scene.name}`}
                        className="w-full h-12 rounded-md border border-dashed border-white/10 hover:border-white/30 hover:bg-white/[0.02] transition-colors"
                      />
                    )}
                    {/* Ghost cursors — other users hovering this cell */}
                    {cursorsHere.length > 0 && (
                      <div className="absolute -top-1 -right-1 flex -space-x-1 pointer-events-none">
                        {cursorsHere.slice(0, 3).map(g => (
                          <span
                            key={g.userId}
                            className="block w-2 h-2 rounded-full ring-1 ring-black"
                            style={{ background: g.color || '#22d3ee' }}
                            title={g.userName || g.userId}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Footer hint */}
      <footer className="border-t border-white/10 bg-black/40 px-4 py-1.5 text-[10px] text-white/40 flex items-center gap-4">
        <span>click clip → launch at next bar</span>
        <span>shift-click track → solo</span>
        <span>scene name → fire row</span>
        <span className="ml-auto">{tracks.length} tracks · {scenes.length} scenes</span>
      </footer>
    </div>
  );
}

export default SessionView;
