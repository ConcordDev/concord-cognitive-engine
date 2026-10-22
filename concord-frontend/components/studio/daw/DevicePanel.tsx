'use client';

import { useState } from 'react';
import { Plus, Power, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DAWProject, DAWTrack, EffectInstance, EffectType, SynthPreset } from '@/lib/daw/types';
import { effect } from '@/lib/daw/project';
import { instrumentOptions, isDrumInstrument, resolveTrackPreset } from '@/lib/daw/presets';

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
    { key: 'makeup', label: 'Makeup', min: 0, max: 18, step: 0.5, def: 0, unit: 'dB' },
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

export function DeviceCard({ fx, onChange, onRemove, onMove }: { fx: EffectInstance; onChange: (fx: EffectInstance, key?: string) => void; onRemove?: () => void; onMove?: (d: -1 | 1) => void }) {
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
              <span className="w-14 truncate">{ps.label}</span>
              <input type="range" min={ps.min} max={ps.max} step={ps.step} value={v} onChange={(e) => onChange({ ...fx, params: { ...fx.params, [ps.key]: Number(e.target.value) } }, `fx-${fx.id}-${ps.key}`)} className="h-1 flex-1 accent-violet-400" />
              <span className="w-11 text-right tabular-nums text-zinc-300">{fmt(v, ps.unit)}</span>
            </label>
          );
        })}
        {hasWet && (
          <label className="flex items-center gap-1 text-[10px] text-zinc-400">
            <span className="w-14">Mix</span>
            <input type="range" min={0} max={1} step={0.01} value={fx.wet} onChange={(e) => onChange({ ...fx, wet: Number(e.target.value) }, `fx-${fx.id}-wet`)} className="h-1 flex-1 accent-violet-400" />
            <span className="w-11 text-right tabular-nums text-zinc-300">{Math.round(fx.wet * 100)}%</span>
          </label>
        )}
      </div>
    </div>
  );
}

function InstrumentCard({ project, track, onTrack, onPreset }: { project: DAWProject; track: DAWTrack; onTrack: (patch: Partial<DAWTrack>) => void; onPreset: (p: SynthPreset, key?: string) => void }) {
  const opts = instrumentOptions(project.synthPresets);
  const drums = isDrumInstrument(track.instrumentId);
  const preset = drums ? null : resolveTrackPreset(track.instrumentId, project.synthPresets);
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
              <span className="w-14">{label}</span>
              <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => onPreset(apply(Number(e.target.value)), `preset-${preset.id}-${label}`)} className="h-1 flex-1 accent-violet-400" />
            </label>
          ))}
          <div className="text-[9px] text-zinc-600">Edits apply to every track using “{preset.name}” in this song.</div>
        </div>
      )}
      {drums && <div className="text-[10px] text-zinc-500">Kick, snare, clap, hats, toms, crash — open the clip to program steps.</div>}
    </div>
  );
}

export interface DevicePanelProps {
  project: DAWProject;
  track: DAWTrack | null;
  onTrack: (patch: Partial<DAWTrack>, key?: string) => void;
  onEffects: (fx: EffectInstance[], key?: string) => void;
  onPreset: (p: SynthPreset, key?: string) => void;
}

export function DevicePanel({ project, track, onTrack, onEffects, onPreset }: DevicePanelProps) {
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
      {track.type !== 'audio' && <InstrumentCard project={project} track={track} onTrack={onTrack} onPreset={onPreset} />}
      {fxs.map((fx, i) => (
        <DeviceCard key={fx.id} fx={fx} onChange={(nfx, key) => onEffects(fxs.map((x) => (x.id === fx.id ? nfx : x)), key)} onRemove={() => onEffects(fxs.filter((x) => x.id !== fx.id))} onMove={(d) => move(i, d)} />
      ))}
      <div className="relative w-32 flex-shrink-0">
        <button onClick={() => setMenu((m) => !m)} className="flex h-full max-h-40 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/15 text-xs text-zinc-400 hover:text-white" data-testid="studio-add-device">
          <Plus className="h-4 w-4" /> Add device
        </button>
        {menu && (
          <div className="absolute left-0 top-0 z-20 w-40 rounded-lg border border-white/10 bg-[#1b1b24] p-1 shadow-xl">
            {DEVICE_SPECS.map((s) => (
              <button key={s.type} onClick={() => { onEffects([...fxs, newDevice(s.type)]); setMenu(false); }} className="block w-full rounded px-2 py-1 text-left text-xs text-zinc-200 hover:bg-white/10">{s.name}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
