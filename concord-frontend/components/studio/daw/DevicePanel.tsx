'use client';

import { useRef, useState } from 'react';
import { Plus, Power, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DAWProject, DAWTrack, EffectInstance, EffectType, SynthPreset } from '@/lib/daw/types';
import { effect } from '@/lib/daw/project';
import { eq8HasBands, eq8Params } from '@/lib/daw/dsp/eq-bands';
import { instrumentOptions, isDrumInstrument, resolveTrackPreset } from '@/lib/daw/presets';
import { buildSlices, type SampleSlice } from '@/lib/daw/sampler';
import { getStudioEngine } from '@/lib/daw/playback-engine';
import { newPitchCorrect, PitchCorrectCard } from './PitchCorrectCard';
import { Eq8Card } from './Eq8Card';
import { useBeatFrame } from './engine-hooks';

interface ParamSpec { key: string; label: string; min: number; max: number; step: number; def: number; unit?: string }

export const DEVICE_SPECS: Array<{ type: EffectType; name: string; wet?: number; params: ParamSpec[] }> = [
  { type: 'eq3', name: 'EQ', params: [
    { key: 'highPass', label: 'Low cut', min: 0, max: 400, step: 5, def: 0, unit: 'Hz' },
    { key: 'lowGain', label: 'Low', min: -12, max: 12, step: 0.5, def: 0, unit: 'dB' },
    { key: 'lowFreq', label: 'Low freq', min: 40, max: 600, step: 5, def: 200, unit: 'Hz' },
    { key: 'midGain', label: 'Mid', min: -12, max: 12, step: 0.5, def: 0, unit: 'dB' },
    { key: 'midFreq', label: 'Mid freq', min: 200, max: 6000, step: 10, def: 1000, unit: 'Hz' },
    { key: 'highGain', label: 'High', min: -12, max: 12, step: 0.5, def: 0, unit: 'dB' },
    { key: 'highFreq', label: 'High freq', min: 2000, max: 16000, step: 100, def: 6000, unit: 'Hz' },
  ] },
  { type: 'compressor', name: 'Compressor', params: [
    { key: 'threshold', label: 'Threshold', min: -60, max: 0, step: 0.5, def: -18, unit: 'dB' },
    { key: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.1, def: 3, unit: ':1' },
    { key: 'attack', label: 'Attack', min: 0.001, max: 0.2, step: 0.001, def: 0.01, unit: 's' },
    { key: 'release', label: 'Release', min: 0.02, max: 1, step: 0.01, def: 0.2, unit: 's' },
    { key: 'knee', label: 'Knee', min: 0, max: 30, step: 0.5, def: 30, unit: 'dB' },
    { key: 'makeup', label: 'Makeup', min: 0, max: 18, step: 0.5, def: 0, unit: 'dB' },
    { key: 'autoMakeup', label: 'Auto gain', min: 0, max: 1, step: 1, def: 0 },
  ] },
  { type: 'deesser', name: 'De-esser', params: [
    { key: 'freq', label: 'Split', min: 2000, max: 12000, step: 50, def: 6000, unit: 'Hz' },
    { key: 'threshold', label: 'Threshold', min: -48, max: 0, step: 0.5, def: -24, unit: 'dB' },
    { key: 'ratio', label: 'Ratio', min: 1, max: 12, step: 0.1, def: 4, unit: ':1' },
    { key: 'listen', label: 'Listen', min: 0, max: 1, step: 1, def: 0 },
  ] },
  { type: 'utility', name: 'Utility', params: [
    { key: 'gain', label: 'Gain', min: -24, max: 24, step: 0.1, def: 0, unit: 'dB' },
    { key: 'invertL', label: 'Invert L', min: 0, max: 1, step: 1, def: 0 },
    { key: 'invertR', label: 'Invert R', min: 0, max: 1, step: 1, def: 0 },
    { key: 'mono', label: 'Mono', min: 0, max: 1, step: 1, def: 0 },
    { key: 'swap', label: 'Swap L/R', min: 0, max: 1, step: 1, def: 0 },
  ] },
  { type: 'gate', name: 'Gate', params: [
    { key: 'threshold', label: 'Threshold', min: -80, max: 0, step: 0.5, def: -45, unit: 'dB' },
    { key: 'range', label: 'Range', min: -80, max: 0, step: 1, def: -60, unit: 'dB' },
    { key: 'release', label: 'Release', min: 0.01, max: 1, step: 0.01, def: 0.12, unit: 's' },
  ] },
  { type: 'reverb', name: 'Reverb', wet: 0.25, params: [
    { key: 'decay', label: 'Decay', min: 0.2, max: 8, step: 0.1, def: 2, unit: 's' },
    { key: 'preDelay', label: 'Pre-delay', min: 0, max: 0.2, step: 0.005, def: 0.01, unit: 's' },
  ] },
  { type: 'delay', name: 'Delay', wet: 0.25, params: [
    { key: 'time', label: 'Time', min: 0.02, max: 2, step: 0.005, def: 0.375, unit: 's' },
    { key: 'feedback', label: 'Feedback', min: 0, max: 0.9, step: 0.01, def: 0.3 },
    { key: 'tone', label: 'Tone', min: 500, max: 16000, step: 100, def: 6000, unit: 'Hz' },
  ] },
  { type: 'filter', name: 'Filter', params: [
    { key: 'frequency', label: 'Cutoff', min: 40, max: 18000, step: 10, def: 2000, unit: 'Hz' },
    { key: 'resonance', label: 'Resonance', min: 0.1, max: 18, step: 0.1, def: 0.7 },
  ] },
  { type: 'distortion', name: 'Saturation', wet: 1, params: [{ key: 'amount', label: 'Drive', min: 0, max: 100, step: 1, def: 20 }] },
  { type: 'chorus', name: 'Chorus', wet: 0.3, params: [
    { key: 'rate', label: 'Rate', min: 0.05, max: 6, step: 0.05, def: 0.8, unit: 'Hz' },
    { key: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, def: 0.5 },
  ] },
  { type: 'stereoWidener', name: 'Width', params: [
    { key: 'width', label: 'Width', min: 0, max: 2, step: 0.01, def: 1 },
    { key: 'monoBelow', label: 'Mono below', min: 0, max: 300, step: 5, def: 0, unit: 'Hz' },
  ] },
  { type: 'multibandCompressor', name: 'Multiband', params: [
    { key: 'threshold', label: 'Threshold', min: -40, max: 0, step: 0.5, def: -16, unit: 'dB' },
    { key: 'ratio', label: 'Ratio', min: 1, max: 6, step: 0.1, def: 1.6, unit: ':1' },
    { key: 'makeup', label: 'Makeup', min: 0, max: 12, step: 0.5, def: 0, unit: 'dB' },
  ] },
  { type: 'limiter', name: 'Limiter', params: [
    { key: 'gain', label: 'Gain', min: 0, max: 18, step: 0.1, def: 0, unit: 'dB' },
    { key: 'ceiling', label: 'Ceiling', min: -6, max: 0, step: 0.1, def: -1, unit: 'dB' },
  ] },
];

/** Device types this Studio both processes and exposes controls for (aliases share a spec). */
const ALIASES: Partial<Record<EffectType, EffectType>> = {
  eq8: 'eq3', parametricEQ: 'eq3', autoFilter: 'filter', pingPongDelay: 'delay', overdrive: 'distortion', flanger: 'chorus',
};
const specOf = (t: EffectType) => DEVICE_SPECS.find((s) => s.type === t || s.type === ALIASES[t]);

/** False for device types from older projects that the audio engine skips (no fake card). */
export const isSupportedDevice = (t: EffectType): boolean => !!specOf(t);

export function newDevice(type: EffectType): EffectInstance {
  const s = specOf(type)!;
  return effect(type, s.name, Object.fromEntries(s.params.map((p) => [p.key, p.def])) as EffectInstance['params'], s.wet ?? 1);
}

function fmt(v: number, unit?: string) {
  if (unit === 'Hz') return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`;
  if (unit === 's') return v < 0.1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
  return `${Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v)}${unit === 'dB' ? 'dB' : unit === ':1' ? ':1' : ''}`;
}

/** Flex items shrink by default; `truncate` + a shrinking `w-14` clip labels
 *  (Gate's "Threshold"/"Range" collapsed to a cut-off letter). Keep the same
 *  column width so other cards don't reflow, but never shrink or ellipsis. */
function ParamLabel({ children }: { children: string }) {
  return (
    <span className="w-14 shrink-0 leading-tight" title={children}>
      {children}
    </span>
  );
}

export function DeviceCard({ fx, onChange, onRemove, onMove, tracks, trackId }: { fx: EffectInstance; onChange: (fx: EffectInstance, key?: string) => void; onRemove?: () => void; onMove?: (d: -1 | 1) => void; tracks?: DAWTrack[]; trackId?: string }) {
  const s = specOf(fx.type);
  if (!s) {
    // Saved by an older Studio version; the engine does not process this type.
    return (
      <div className="flex w-48 flex-shrink-0 flex-col rounded-lg border border-amber-500/20 bg-[#17171f] p-2 opacity-70" data-testid="studio-device-unsupported">
        <div className="mb-1 flex items-center gap-1">
          <span className="flex-1 truncate text-[11px] font-medium text-zinc-300">{fx.name}</span>
          {onRemove && <button onClick={onRemove} className="text-zinc-500 hover:text-red-400" title="Remove"><X className="h-3 w-3" /></button>}
        </div>
        <p className="text-[10px] leading-relaxed text-amber-200/80">Not available in this Studio. It is skipped (no effect on the sound). Remove it or replace it with a device from Add device.</p>
      </div>
    );
  }
  const hasWet = ['reverb', 'delay', 'pingPongDelay', 'chorus', 'flanger', 'distortion', 'overdrive'].includes(fx.type);
  return (
    <div className={cn('flex w-48 flex-shrink-0 flex-col rounded-lg border bg-[#17171f] p-2', fx.enabled ? 'border-white/10' : 'border-white/5 opacity-50')} data-testid="studio-device">
      <div className="mb-1 flex items-center gap-1">
        <button onClick={() => onChange({ ...fx, enabled: !fx.enabled })} className={cn('rounded p-0.5', fx.enabled ? 'text-emerald-400' : 'text-zinc-600')} title="Bypass"><Power className="h-3 w-3" /></button>
        <span className="flex-1 truncate text-[11px] font-medium text-zinc-200">{fx.name}</span>
        {onMove && <button onClick={() => onMove(-1)} className="text-zinc-500 hover:text-white" title="Move earlier in the chain"><ChevronLeft className="h-3 w-3" /></button>}
        {onMove && <button onClick={() => onMove(1)} className="text-zinc-500 hover:text-white" title="Move later in the chain"><ChevronRight className="h-3 w-3" /></button>}
        {onRemove && <button onClick={onRemove} className="text-zinc-500 hover:text-red-400" title="Remove"><X className="h-3 w-3" /></button>}
      </div>
      <div className="space-y-1 overflow-y-auto">
        {s.params.map((ps) => {
          const v = Number(fx.params[ps.key] ?? ps.def);
          return (
            <label key={ps.key} className="flex items-center gap-1 text-[10px] text-zinc-400">
              <ParamLabel>{ps.label}</ParamLabel>
              <input type="range" min={ps.min} max={ps.max} step={ps.step} value={v} onChange={(e) => onChange({ ...fx, params: { ...fx.params, [ps.key]: Number(e.target.value) } }, `fx-${fx.id}-${ps.key}`)} className="h-1 min-w-0 flex-1 accent-violet-400" />
              <span className="w-11 shrink-0 text-right tabular-nums text-zinc-300">{fmt(v, ps.unit)}</span>
            </label>
          );
        })}
        {(fx.type === 'compressor' || fx.type === 'gate') && tracks && (
          <SidechainFields fx={fx} tracks={tracks} trackId={trackId} onChange={onChange} />
        )}
        {(fx.type === 'compressor' || fx.type === 'deesser') && trackId && <ReductionReadout trackId={trackId} effectId={fx.id} />}
        {hasWet && (
          <label className="flex items-center gap-1 text-[10px] text-zinc-400">
            <ParamLabel>Mix</ParamLabel>
            <input type="range" min={0} max={1} step={0.01} value={fx.wet} onChange={(e) => onChange({ ...fx, wet: Number(e.target.value) }, `fx-${fx.id}-wet`)} className="h-1 min-w-0 flex-1 accent-violet-400" />
            <span className="w-11 shrink-0 text-right tabular-nums text-zinc-300">{Math.round(fx.wet * 100)}%</span>
          </label>
        )}
      </div>
    </div>
  );
}

function SidechainFields({ fx, tracks, trackId, onChange }: { fx: EffectInstance; tracks: DAWTrack[]; trackId?: string; onChange: (fx: EffectInstance, key?: string) => void }) {
  const current = typeof fx.params.sidechain === 'string' ? fx.params.sidechain : '';
  const hpf = Number(fx.params.scHpf ?? 0);
  const choices = tracks.filter((t) => t.id !== trackId && !t.vca && t.type !== 'master');
  return (
    <>
      <label className="flex items-center gap-1 text-[10px] text-zinc-400">
        <ParamLabel>Key</ParamLabel>
        <select aria-label="Sidechain source" value={choices.some((t) => t.id === current) ? current : ''} onChange={(e) => {
          const params = { ...fx.params };
          if (e.target.value) params.sidechain = e.target.value;
          else delete params.sidechain;
          onChange({ ...fx, params }, `fx-${fx.id}-sidechain`);
        }} className="min-w-0 flex-1 rounded bg-black/40 px-1 py-0.5 text-[10px] text-zinc-100">
          <option value="">Self</option>
          {choices.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1 text-[10px] text-zinc-400">
        <ParamLabel>Key HPF</ParamLabel>
        <input aria-label="Sidechain high-pass" type="range" min={0} max={5000} step={10} value={Number.isFinite(hpf) ? hpf : 0} onChange={(e) => onChange({ ...fx, params: { ...fx.params, scHpf: Number(e.target.value) } }, `fx-${fx.id}-scHpf`)} className="h-1 min-w-0 flex-1 accent-violet-400" />
        <span className="w-11 shrink-0 text-right tabular-nums text-zinc-300">{Math.round(hpf)}Hz</span>
      </label>
    </>
  );
}

function ReductionReadout({ trackId, effectId }: { trackId: string; effectId: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useBeatFrame(() => {
    if (!ref.current) return;
    const db = getStudioEngine().deviceReductionDb(trackId, effectId);
    ref.current.textContent = db < -0.05 ? `GR ${db.toFixed(1)}` : '';
  });
  return <span ref={ref} className="text-[10px] tabular-nums text-amber-300/90" data-testid="studio-gr" />;
}

function InstrumentCard({ project, track, sample, onTrack, onPreset }: {
  project: DAWProject;
  track: DAWTrack;
  sample: { channel: Float32Array; sampleRate: number } | null;
  onTrack: (patch: Partial<DAWTrack>) => void;
  onPreset: (p: SynthPreset, key?: string) => void;
}) {
  const opts = instrumentOptions(project.synthPresets);
  const drums = isDrumInstrument(track.instrumentId);
  const preset = drums ? null : resolveTrackPreset(track.instrumentId, project.synthPresets);
  const [sliceIndex, setSliceIndex] = useState(0);
  const slices = track.slices || [];
  const slice = slices[Math.min(sliceIndex, Math.max(0, slices.length - 1))];
  const writeSlice = (patch: Partial<SampleSlice>) => {
    if (!slice) return;
    const i = Math.min(sliceIndex, slices.length - 1);
    onTrack({ slices: slices.map((s, n) => n === i ? { ...s, ...patch } : s) });
  };
  return (
    <div className="flex w-56 flex-shrink-0 flex-col rounded-lg border border-violet-400/20 bg-[#1a1724] p-2">
      <div className="mb-1 text-[11px] font-medium text-violet-200">Instrument</div>
      <select value={track.instrumentId || ''} onChange={(e) => onTrack({ instrumentId: e.target.value })} className="mb-2 rounded bg-black/40 px-1 py-1 text-xs text-zinc-100" data-testid="studio-instrument-select">
        {['bass', 'keys', 'lead', 'pad', 'pluck', 'strings', 'drums'].map((cat) => {
          const list = opts.filter((o) => o.category === cat);
          return list.length ? <optgroup key={cat} label={cat[0].toUpperCase() + cat.slice(1)}>{list.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</optgroup> : null;
        })}
        {opts.filter((o) => !['bass', 'keys', 'lead', 'pad', 'pluck', 'strings', 'drums'].includes(o.category)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      {preset && (
        <div className="space-y-1">
          {([
            ['Cutoff', preset.filter.frequency, 80, 16000, 10, (v: number) => ({ ...preset, filter: { ...preset.filter, frequency: v } })],
            ['Resonance', preset.filter.resonance, 0.1, 15, 0.1, (v: number) => ({ ...preset, filter: { ...preset.filter, resonance: v } })],
            ['Attack', preset.ampEnvelope.attack, 0.001, 2, 0.001, (v: number) => ({ ...preset, ampEnvelope: { ...preset.ampEnvelope, attack: v } })],
            ['Decay', preset.ampEnvelope.decay, 0.01, 3, 0.01, (v: number) => ({ ...preset, ampEnvelope: { ...preset.ampEnvelope, decay: v } })],
            ['Sustain', preset.ampEnvelope.sustain, 0, 1, 0.01, (v: number) => ({ ...preset, ampEnvelope: { ...preset.ampEnvelope, sustain: v } })],
            ['Release', preset.ampEnvelope.release, 0.01, 4, 0.01, (v: number) => ({ ...preset, ampEnvelope: { ...preset.ampEnvelope, release: v } })],
          ] as const).map(([label, v, min, max, step, apply]) => (
            <label key={label} className="flex items-center gap-1 text-[10px] text-zinc-400">
              <ParamLabel>{label}</ParamLabel>
              <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => onPreset(apply(Number(e.target.value)), `preset-${preset.id}-${label}`)} className="h-1 min-w-0 flex-1 accent-violet-400" />
            </label>
          ))}
          <label className="flex items-center gap-1 text-[10px] text-zinc-400">
            <ParamLabel>Glide</ParamLabel>
            <input aria-label="Glide" type="range" min={0} max={400} step={5} value={Math.round((preset.portamento || 0) * 1000)} onChange={(e) => onPreset({ ...preset, portamento: Number(e.target.value) / 1000 }, `preset-${preset.id}-glide`)} className="h-1 min-w-0 flex-1 accent-violet-400" />
          </label>
          <div className="text-[9px] text-zinc-600">Glide bends a new note from the previous pitch while that note is still sounding. The envelope still restarts. Edits apply to every track using “{preset.name}”.</div>
        </div>
      )}
      {track.instrumentId === 'drums:sampler' && sample && (
        <div className="space-y-1 text-[10px] text-zinc-400">
          <button type="button" className="w-full rounded bg-white/10 py-1 text-zinc-100" onClick={() => onTrack({ slices: buildSlices(sample.channel, sample.sampleRate, 'transient') })}>Slice at transients</button>
          <button type="button" className="w-full rounded bg-white/10 py-1 text-zinc-100" onClick={() => onTrack({ slices: buildSlices(sample.channel, sample.sampleRate, 'grid') })}>Slice on 1/4 notes</button>
          {slice && (
            <>
              <label className="flex items-center gap-1">Slice
                <select aria-label="Slice" value={Math.min(sliceIndex, slices.length - 1)} onChange={(e) => setSliceIndex(Number(e.target.value))} className="flex-1 rounded bg-black/40 px-1 text-zinc-100">
                  {slices.map((_, i) => <option key={i} value={i}>{i + 1}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1">Pitch
                <input aria-label="Slice pitch" type="number" min={-24} max={24} value={slice.pitch || 0} onChange={(e) => writeSlice({ pitch: Number(e.target.value) || 0 })} className="w-14 rounded bg-black/40 px-1 text-zinc-100" />
                st
              </label>
              <label className="flex items-center gap-1"><input aria-label="Slice reverse" type="checkbox" checked={!!slice.reverse} onChange={(e) => writeSlice({ reverse: e.target.checked })} />Reverse</label>
              <label className="flex items-center gap-1">Attack<input aria-label="Slice attack" type="range" min={0.001} max={1} step={0.001} value={slice.attack ?? 0.005} onChange={(e) => writeSlice({ attack: Number(e.target.value) })} className="h-1 flex-1" /></label>
              <label className="flex items-center gap-1">Decay<input aria-label="Slice decay" type="range" min={0.01} max={2} step={0.01} value={slice.decay ?? 0.1} onChange={(e) => writeSlice({ decay: Number(e.target.value) })} className="h-1 flex-1" /></label>
              <label className="flex items-center gap-1">Sustain<input aria-label="Slice sustain" type="range" min={0} max={1} step={0.01} value={slice.sustain ?? 0.8} onChange={(e) => writeSlice({ sustain: Number(e.target.value) })} className="h-1 flex-1" /></label>
              <label className="flex items-center gap-1">Release<input aria-label="Slice release" type="range" min={0.01} max={2} step={0.01} value={slice.release ?? 0.05} onChange={(e) => writeSlice({ release: Number(e.target.value) })} className="h-1 flex-1" /></label>
            </>
          )}
        </div>
      )}
      {track.instrumentId === 'drums:sampler' && !sample && <p className="text-[10px] text-zinc-500">Add an audio clip on this track to slice it into pads.</p>}
      {drums && track.instrumentId !== 'drums:sampler' && <div className="text-[10px] text-zinc-500">Kick, snare, clap, hats, toms, crash — open the clip to program steps.</div>}
    </div>
  );
}

export interface DevicePanelProps {
  project: DAWProject;
  track: DAWTrack | null;
  sample?: { channel: Float32Array; sampleRate: number } | null;
  onTrack: (patch: Partial<DAWTrack>, key?: string) => void;
  onEffects: (fx: EffectInstance[], key?: string) => void;
  onPreset: (p: SynthPreset, key?: string) => void;
}

export function DevicePanel({ project, track, sample, onTrack, onEffects, onPreset }: DevicePanelProps) {
  const [menu, setMenu] = useState(false);
  if (!track) return <div className="flex h-full items-center justify-center text-xs text-zinc-600">Select a track to see its devices.</div>;
  const fxs = track.effectChain;
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= fxs.length) return;
    const n = [...fxs];
    [n[i], n[j]] = [n[j], n[i]];
    onEffects(n);
  };
  return (
    <div className="flex h-full gap-2 overflow-x-auto p-2" data-testid="studio-devices">
      {track.type !== 'audio' && <InstrumentCard project={project} track={track} sample={sample || null} onTrack={onTrack} onPreset={onPreset} />}
      {fxs.map((fx, i) => {
        const change = (nfx: EffectInstance, key?: string) => onEffects(fxs.map((x) => (x.id === fx.id ? nfx : x)), key);
        const remove = () => onEffects(fxs.filter((x) => x.id !== fx.id));
        const onMove = (d: -1 | 1) => move(i, d);
        if (fx.type === 'pitchCorrect') return <PitchCorrectCard key={fx.id} fx={fx} project={project} onChange={change} onRemove={remove} onMove={onMove} />;
        if ((fx.type === 'eq8' || fx.type === 'parametricEQ') && eq8HasBands(fx.params)) return <Eq8Card key={fx.id} fx={fx} onChange={change} onRemove={remove} onMove={onMove} />;
        return <DeviceCard key={fx.id} fx={fx} tracks={project.tracks} trackId={track.id} onChange={change} onRemove={remove} onMove={onMove} />;
      })}
      <div className="relative w-32 flex-shrink-0">
        <button onClick={() => setMenu((m) => !m)} className="flex h-full max-h-40 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/15 text-xs text-zinc-400 hover:text-white" data-testid="studio-add-device">
          <Plus className="h-4 w-4" /> Add device
        </button>
        {menu && (
          <div className="absolute left-0 top-0 z-20 w-40 rounded-lg border border-white/10 bg-[#1b1b24] p-1 shadow-xl">
            {DEVICE_SPECS.map((s) => (
              <button key={s.type} onClick={() => { onEffects([...fxs, newDevice(s.type)]); setMenu(false); }} className="block w-full rounded px-2 py-1 text-left text-xs text-zinc-200 hover:bg-white/10">{s.name}</button>
            ))}
            <button type="button" onClick={() => { onEffects([...fxs, effect('eq8', '8-band EQ', eq8Params(), 1)]); setMenu(false); }} className="block w-full rounded px-2 py-1 text-left text-xs text-zinc-200 hover:bg-white/10">8-band EQ</button>
            <button type="button" onClick={() => { onEffects([...fxs, newPitchCorrect()]); setMenu(false); }} className="block w-full rounded px-2 py-1 text-left text-xs text-zinc-200 hover:bg-white/10">Pitch Correct</button>
          </div>
        )}
      </div>
    </div>
  );
}
