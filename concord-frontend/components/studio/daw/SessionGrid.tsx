'use client';

import { Play, Square, Plus, Mic, Piano, Drum } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { DAWProject } from '@/lib/daw/types';
import type { NewTrackKind } from '@/lib/daw/project';
import { trackKind } from '@/lib/daw/project';
import { MidiThumb } from './ClipShapes';

export const SCENES = 8;

export interface SessionGridProps {
  project: DAWProject;
  launched: Record<string, { clipId: string; launchBeat: number } | undefined>;
  selectedClipId: string | null;
  selectedTrackId: string | null;
  onSelectTrack: (id: string) => void;
  onSelectClip: (id: string) => void;
  onCreateClip: (trackId: string, slot: number) => void;
  onLaunchClip: (trackId: string, clipId: string) => void;
  onStopTrack: (trackId: string) => void;
  onLaunchScene: (slot: number) => void;
  onAddTrack: (kind: NewTrackKind) => void;
  onDropFiles: (trackId: string, slot: number, files: File[]) => void;
}

export function SessionGrid(p: SessionGridProps) {
  const tracks = p.project.tracks.filter((t) => t.type !== 'master');
  const [addOpen, setAddOpen] = useState(false);
  return (
    <div className="h-full overflow-auto bg-[#0e0e13] p-2" data-testid="studio-session">
      <div className="flex gap-1">
        {tracks.map((t) => {
          const playing = p.launched[t.id]?.clipId;
          return (
            <div key={t.id} className="w-36 flex-shrink-0">
              <button
                onClick={() => p.onSelectTrack(t.id)}
                className={cn('mb-1 flex w-full items-center gap-1 truncate rounded px-2 py-1.5 text-left text-xs', p.selectedTrackId === t.id ? 'bg-white/10 text-white' : 'bg-[#16161d] text-zinc-300')}
                style={{ borderTop: `2px solid ${t.color}` }}
              >
                {trackKind(t) === 'audio' ? <Mic className="h-3 w-3" /> : trackKind(t) === 'drums' ? <Drum className="h-3 w-3" /> : <Piano className="h-3 w-3" />}
                <span className="truncate">{t.name}</span>
              </button>
              {Array.from({ length: SCENES }, (_, slot) => {
                const clip = t.clips.find((c) => c.slot === slot);
                if (!clip) {
                  return (
                    <div
                      key={slot}
                      onClick={() => t.type !== 'audio' && p.onCreateClip(t.id, slot)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); const f = Array.from(e.dataTransfer.files || []); if (f.length) p.onDropFiles(t.id, slot, f); }}
                      className={cn('mb-1 flex h-9 items-center justify-center rounded border border-dashed border-white/5 text-[10px] text-zinc-700', t.type !== 'audio' && 'cursor-pointer hover:border-white/20 hover:text-zinc-400')}
                      title={t.type === 'audio' ? 'Drop audio here' : 'Click to create a MIDI clip'}
                      data-testid="studio-session-empty"
                    >
                      {t.type !== 'audio' ? <Plus className="h-3 w-3" /> : null}
                    </div>
                  );
                }
                const isPlaying = playing === clip.id;
                return (
                  <div
                    key={slot}
                    onClick={() => p.onSelectClip(clip.id)}
                    className={cn('relative mb-1 flex h-9 items-center overflow-hidden rounded text-[10px] text-white', p.selectedClipId === clip.id && 'ring-1 ring-white')}
                    style={{ background: `${clip.color || t.color}${isPlaying ? 'ff' : '99'}` }}
                  >
                    {clip.type !== 'audio' && <MidiThumb clip={clip} width={144} height={36} />}
                    <button
                      onClick={(e) => { e.stopPropagation(); if (isPlaying) p.onStopTrack(t.id); else p.onLaunchClip(t.id, clip.id); }}
                      className="relative z-10 ml-1 flex h-6 w-6 items-center justify-center rounded bg-black/30 hover:bg-black/50"
                      title={isPlaying ? 'Stop' : 'Launch (quantized to the next bar)'}
                    >
                      {isPlaying ? <Square className="h-3 w-3 fill-current" /> : <Play className="h-3 w-3 fill-current" />}
                    </button>
                    <span className="relative z-10 ml-1 truncate drop-shadow">{clip.name}</span>
                  </div>
                );
              })}
              <button onClick={() => p.onStopTrack(t.id)} className="flex h-7 w-full items-center justify-center rounded bg-white/5 text-zinc-500 hover:text-white" title="Stop track"><Square className="h-3 w-3" /></button>
            </div>
          );
        })}
        <div className="w-28 flex-shrink-0">
          {addOpen ? (
            <div className="flex flex-col gap-1">
              {([['audio', 'Audio'], ['instrument', 'Instrument'], ['drums', 'Drums']] as const).map(([k, label]) => (
                <button key={k} onClick={() => { p.onAddTrack(k); setAddOpen(false); }} className="rounded bg-white/5 px-2 py-1.5 text-xs text-zinc-300 hover:bg-white/10">{label}</button>
              ))}
            </div>
          ) : (
            <button onClick={() => setAddOpen(true)} className="flex h-8 w-full items-center justify-center gap-1 rounded border border-dashed border-white/15 text-xs text-zinc-400 hover:text-white" data-testid="studio-session-add-track"><Plus className="h-3 w-3" /> Track</button>
          )}
        </div>
        <div className="ml-auto w-16 flex-shrink-0">
          <div className="mb-1 py-1.5 text-center text-[10px] text-zinc-500">Scenes</div>
          {Array.from({ length: SCENES }, (_, slot) => (
            <button key={slot} onClick={() => p.onLaunchScene(slot)} className="mb-1 flex h-9 w-full items-center justify-center gap-1 rounded bg-white/5 text-[10px] text-zinc-300 hover:bg-white/10" title="Launch scene">
              <Play className="h-3 w-3 fill-current" /> {slot + 1}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
