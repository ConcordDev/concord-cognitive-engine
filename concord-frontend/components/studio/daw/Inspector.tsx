'use client';

import type { DAWClip, DAWProject, DAWTrack, EffectInstance, TrackRole, MasteringChain } from '@/lib/daw/types';
import { TRACK_COLORS, trackKind } from '@/lib/daw/project';
import { cn } from '@/lib/utils';
import { DeviceCard } from './DevicePanel';
import { RecordPanel } from './RecordPanel';
import type { InputRecorderApi } from './useInputRecorder';

const ROLES: TrackRole[] = ['vocal', 'drums', 'kick', 'bass', 'keys', 'guitar', 'synth', 'pad', 'fx', 'other'];

function Num({ label, value, min, max, step, onChange, unit }: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-2 text-[10px] text-zinc-400">
      <span className="w-16">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1 flex-1 accent-violet-400" />
      <span className="w-12 text-right tabular-nums">{value.toFixed(step < 1 ? 2 : 0)}{unit}</span>
    </label>
  );
}

export interface InspectorProps {
  project: DAWProject;
  track: DAWTrack | null;
  clip: DAWClip | null;
  recorder: InputRecorderApi;
  onTrack: (patch: Partial<DAWTrack>, key?: string) => void;
  onClip: (patch: Partial<DAWClip>, key?: string) => void;
  onDeleteTrack: () => void;
  onDuplicateTrack: () => void;
}

export function Inspector({ project, track, clip, recorder, onTrack, onClip, onDeleteTrack, onDuplicateTrack }: InspectorProps) {
  const sec = 'space-y-2 border-b border-white/5 p-3';
  return (
    <div className="h-full w-64 flex-shrink-0 overflow-y-auto border-l border-white/5 bg-[#111117]" data-testid="studio-inspector">
      {track && trackKind(track) === 'audio' && <div className={sec}><RecordPanel api={recorder} /></div>}
      {track ? (
        <div className={sec}>
          <div className="text-[11px] font-medium text-zinc-200">Track</div>
          <input value={track.name} onChange={(e) => onTrack({ name: e.target.value }, `name-${track.id}`)} className="w-full rounded bg-black/40 px-2 py-1 text-xs" />
          <div className="flex flex-wrap gap-1">
            {TRACK_COLORS.map((c) => <button key={c} onClick={() => onTrack({ color: c })} className={cn('h-4 w-4 rounded', track.color === c && 'ring-2 ring-white')} style={{ background: c }} aria-label={`Color ${c}`} />)}
          </div>
          <label className="flex items-center gap-2 text-[10px] text-zinc-400">
            <span className="w-16">Role</span>
            <select value={track.role || ''} onChange={(e) => onTrack({ role: (e.target.value || undefined) as TrackRole | undefined })} className="flex-1 rounded bg-black/40 px-1 py-0.5 text-xs text-zinc-200">
              <option value="">Auto</option>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <Num label="Input trim" value={track.trimDb ?? 0} min={-24} max={24} step={0.5} unit=" dB" onChange={(v) => onTrack({ trimDb: v }, `trim-${track.id}`)} />
          <label className="flex items-center gap-2 text-[10px] text-zinc-400">
            <span className="w-16">Duck from</span>
            <select
              value={track.duck?.sourceTrackId || ''}
              onChange={(e) => onTrack({ duck: e.target.value ? { sourceTrackId: e.target.value, depthDb: track.duck?.depthDb ?? 6, releaseMs: track.duck?.releaseMs ?? 120 } : undefined })}
              className="flex-1 rounded bg-black/40 px-1 py-0.5 text-xs text-zinc-200"
            >
              <option value="">Off</option>
              {project.tracks.filter((t) => t.id !== track.id && t.type !== 'master' && t.type !== 'audio').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          {track.duck && <Num label="Duck depth" value={track.duck.depthDb} min={1} max={18} step={0.5} unit=" dB" onChange={(v) => onTrack({ duck: { ...track.duck!, depthDb: v } }, `duck-${track.id}`)} />}
          <div className="flex gap-1 pt-1">
            <button onClick={onDuplicateTrack} className="flex-1 rounded bg-white/5 py-1 text-[11px] hover:bg-white/10">Duplicate</button>
            <button onClick={onDeleteTrack} className="flex-1 rounded bg-red-500/10 py-1 text-[11px] text-red-300 hover:bg-red-500/20">Delete track</button>
          </div>
        </div>
      ) : (
        <div className="p-3 text-xs text-zinc-600">Select a track or clip.</div>
      )}
      {clip && (
        <div className={sec}>
          <div className="text-[11px] font-medium text-zinc-200">Clip</div>
          <input value={clip.name} onChange={(e) => onClip({ name: e.target.value }, `cname-${clip.id}`)} className="w-full rounded bg-black/40 px-2 py-1 text-xs" />
          <Num label="Gain" value={clip.gain || 0} min={-24} max={12} step={0.5} unit=" dB" onChange={(v) => onClip({ gain: v }, `cgain-${clip.id}`)} />
          <Num label="Start" value={clip.startBeat} min={0} max={Math.max(64, clip.startBeat + 16)} step={0.25} unit=" b" onChange={(v) => onClip({ startBeat: v }, `cstart-${clip.id}`)} />
          <Num label="Length" value={clip.lengthBeats} min={0.25} max={Math.max(64, clip.lengthBeats * 2)} step={0.25} unit=" b" onChange={(v) => onClip({ lengthBeats: v }, `clen-${clip.id}`)} />
          {clip.type === 'audio' && (
            <>
              <Num label="Fade in" value={clip.fadeIn || 0} min={0} max={8} step={0.05} unit=" b" onChange={(v) => onClip({ fadeIn: v }, `cfi-${clip.id}`)} />
              <Num label="Fade out" value={clip.fadeOut || 0} min={0} max={8} step={0.05} unit=" b" onChange={(v) => onClip({ fadeOut: v }, `cfo-${clip.id}`)} />
              <Num label="Offset" value={clip.offset || 0} min={0} max={Math.max(1, project.audioAssets?.[clip.audioBufferId || '']?.duration || 10)} step={0.01} unit=" s" onChange={(v) => onClip({ offset: v }, `coff-${clip.id}`)} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function MasterPanel({ project, onMastering, onInserts }: {
  project: DAWProject;
  onMastering: (m: MasteringChain, key?: string) => void;
  onInserts: (fx: EffectInstance[], key?: string) => void;
}) {
  const m = project.masteringChain;
  const slots: Array<keyof Pick<MasteringChain, 'eq' | 'multibandCompressor' | 'stereoWidener' | 'limiter'>> = ['eq', 'multibandCompressor', 'stereoWidener', 'limiter'];
  return (
    <div className="flex h-full gap-2 overflow-x-auto p-2" data-testid="studio-master-devices">
      <div className="flex w-36 flex-shrink-0 flex-col gap-2 rounded-lg border border-white/10 bg-[#15151c] p-2 text-xs">
        <div className="font-medium">Master</div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={m.enabled} onChange={(e) => onMastering({ ...m, enabled: e.target.checked })} /> Mastering chain</label>
        <p className="text-[10px] leading-relaxed text-zinc-500">Export applies an exact true-peak limiter and loudness target on top. Live playback uses a close approximation.</p>
      </div>
      {project.masterBus.inserts.map((fx, i) => (
        <DeviceCard key={fx.id} fx={fx} onChange={(n, key) => onInserts(project.masterBus.inserts.map((x, j) => (j === i ? n : x)), key)} onRemove={() => onInserts(project.masterBus.inserts.filter((_, j) => j !== i))} />
      ))}
      {m.enabled && slots.map((k) => m[k] && (
        <DeviceCard key={k} fx={m[k]} onChange={(n, key) => onMastering({ ...m, [k]: n }, key)} />
      ))}
    </div>
  );
}
