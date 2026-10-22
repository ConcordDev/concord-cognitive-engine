'use client';

/**
 * Pitch Correct insert. Knobs are hidden until the worklet loads. The meter
 * is painted from a message-port snapshot on requestAnimationFrame, not from
 * React state, so the audio clock does not re-render the editor.
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Power, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DAWProject, EffectInstance } from '@/lib/daw/types';
import { effect } from '@/lib/daw/project';
import {
  PITCH_PRESETS,
  PITCH_RANGES,
  PITCH_ROOTS,
  PITCH_SCALES,
  pitchLatencySec,
  scaleMaskFor,
} from '@/lib/daw/dsp/pitch/core';
import { readPitchMeter } from '@/lib/daw/dsp/pitch/runtime';
import { getStudioEngine } from '@/lib/daw/playback-engine';
import { ensurePitchWorklet, pitchWorkletFailed, pitchWorkletReady } from '@/lib/daw/worklets/load-pitch-worklet';

type Gate = 'loading' | 'ready' | 'failed';

function num(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export function newPitchCorrect(): EffectInstance {
  return effect('pitchCorrect', 'Pitch Correct', {
    retuneMs: 0,
    humanize: 0,
    flexCents: 200,
    preserveVibrato: 0,
    transpose: 0,
    quality: 0,
    range: 1,
    useProject: 1,
    keyName: 'C',
    scaleName: 'chromatic',
  }, 1);
}

function Slider({
  label, min, max, step, value, unit, onChange,
}: {
  label: string; min: number; max: number; step: number; value: number; unit: string; onChange: (v: number) => void;
}) {
  const shown = unit === 'ms' || unit === 'cents' || unit === 'st' ? `${Math.round(value)} ${unit}` : unit === '%' ? `${Math.round(value)}%` : `${value}`;
  return (
    <label className="flex items-center gap-1 text-[10px] text-zinc-400">
      <span className="w-16 shrink-0 leading-tight">{label}</span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 min-w-0 flex-1 accent-violet-400"
      />
      <span className="w-14 shrink-0 text-right tabular-nums text-zinc-300">{shown}</span>
    </label>
  );
}

export function PitchCorrectCard({
  fx, project, onChange, onRemove, onMove,
}: {
  fx: EffectInstance;
  project: DAWProject;
  onChange: (fx: EffectInstance, key?: string) => void;
  onRemove?: () => void;
  onMove?: (d: -1 | 1) => void;
}) {
  const [gate, setGate] = useState<Gate>(() => (pitchWorkletReady() ? 'ready' : pitchWorkletFailed() ? 'failed' : 'loading'));
  const detectedRef = useRef<HTMLSpanElement>(null);
  const targetRef = useRef<HTMLSpanElement>(null);
  const centsRef = useRef<HTMLSpanElement>(null);
  const delayRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (pitchWorkletReady()) return;
    let cancel = false;
    void ensurePitchWorklet(getStudioEngine().ctx).then((ok) => {
      if (!cancel) setGate(ok ? 'ready' : 'failed');
    });
    return () => { cancel = true; };
  }, []);

  useEffect(() => {
    if (gate !== 'ready') return;
    let frame = 0;
    const tick = () => {
      const m = readPitchMeter();
      const mine = m.id === fx.id;
      if (detectedRef.current) detectedRef.current.textContent = mine ? m.detected : '—';
      if (targetRef.current) targetRef.current.textContent = mine ? m.target : '—';
      if (centsRef.current) centsRef.current.textContent = mine && m.voiced ? `${m.cents >= 0 ? '+' : ''}${m.cents.toFixed(0)} c` : '—';
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [gate, fx.id]);

  const patch = (params: EffectInstance['params'], key: string) => {
    onChange({ ...fx, params: { ...fx.params, ...params } }, key);
  };
  const rangeIndex = Math.max(0, Math.min(PITCH_RANGES.length - 1, Math.round(num(fx.params.range, 1))));
  const quality = num(fx.params.quality, 0) !== 0;
  const useProject = num(fx.params.useProject, 1) !== 0;
  const keyName = String(fx.params.keyName ?? 'C');
  const scaleName = String(fx.params.scaleName ?? 'chromatic');
  const scale = useProject ? scaleMaskFor(project.key, project.scale) : scaleMaskFor(keyName, scaleName);

  useEffect(() => {
    if (gate !== 'ready' || !delayRef.current) return;
    const sr = getStudioEngine().ctx.sampleRate || 48000;
    const ms = pitchLatencySec(sr, PITCH_RANGES[rangeIndex].minHz, quality ? 'quality' : 'low') * 1000;
    delayRef.current.textContent = `Processor delay ${ms.toFixed(1)} ms at ${sr} Hz. That is the analysis window, one 512-sample hop, and one period of the lowest note in this range. Tests check it against an impulse. It is not a microphone round trip.`;
  }, [gate, rangeIndex, quality]);

  return (
    <div className={cn('flex w-72 flex-shrink-0 flex-col rounded-lg border bg-[#17171f] p-2', fx.enabled ? 'border-white/10' : 'border-white/5 opacity-60')} data-testid="studio-pitch-correct">
      <div className="mb-1 flex items-center gap-1">
        <button type="button" onClick={() => onChange({ ...fx, enabled: !fx.enabled })} className={cn('rounded p-0.5', fx.enabled ? 'text-emerald-400' : 'text-zinc-600')} title="Bypass" aria-label="Bypass Pitch Correct">
          <Power className="h-3 w-3" />
        </button>
        <span className="flex-1 truncate text-[11px] font-medium text-zinc-200">Pitch Correct</span>
        {onMove && <button type="button" onClick={() => onMove(-1)} className="text-zinc-500 hover:text-white" aria-label="Move Pitch Correct earlier"><ChevronLeft className="h-3 w-3" /></button>}
        {onMove && <button type="button" onClick={() => onMove(1)} className="text-zinc-500 hover:text-white" aria-label="Move Pitch Correct later"><ChevronRight className="h-3 w-3" /></button>}
        {onRemove && <button type="button" onClick={onRemove} className="text-zinc-500 hover:text-red-400" aria-label="Remove Pitch Correct"><X className="h-3 w-3" /></button>}
      </div>

      {gate !== 'ready' && (
        <p className="text-[10px] leading-relaxed text-amber-200/90" data-testid="studio-pitch-correct-unavailable">
          {gate === 'loading'
            ? 'Loading the pitch processor…'
            : 'The pitch processor did not load. ScriptProcessor capture cannot host Pitch Correct, so this insert is skipped and its controls stay hidden.'}
        </p>
      )}

      {gate === 'ready' && (
        <div className="space-y-1">
          <div className="flex gap-1">
            {PITCH_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex-1 rounded bg-white/5 px-1 py-1 text-left text-[10px] leading-tight text-zinc-200 hover:bg-white/10"
                onClick={() => patch({
                  retuneMs: p.retuneMs,
                  humanize: p.humanize,
                  flexCents: p.flexCents,
                  preserveVibrato: p.preserveVibrato ? 1 : 0,
                  quality: p.mode === 'quality' ? 1 : 0,
                }, `fx-${fx.id}-preset`)}
              >
                {p.name}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-[10px] text-zinc-400">
            <span className="w-16 shrink-0">Range</span>
            <select aria-label="Input range" value={rangeIndex} onChange={(e) => patch({ range: Number(e.target.value) }, `fx-${fx.id}-range`)} className="min-w-0 flex-1 rounded bg-black/40 px-1 py-0.5 text-zinc-100">
              {PITCH_RANGES.map((r, i) => <option key={r.id} value={i}>{r.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1 text-[10px] text-zinc-400">
            <span className="w-16 shrink-0">Mode</span>
            <select aria-label="Pitch Correct mode" value={quality ? 'quality' : 'low'} onChange={(e) => patch({ quality: e.target.value === 'quality' ? 1 : 0 }, `fx-${fx.id}-mode`)} className="min-w-0 flex-1 rounded bg-black/40 px-1 py-0.5 text-zinc-100">
              <option value="low">Low latency (tracking)</option>
              <option value="quality">Quality (mix)</option>
            </select>
          </label>
          <Slider label="Retune" min={0} max={400} step={1} value={num(fx.params.retuneMs, 0)} unit="ms" onChange={(v) => patch({ retuneMs: v }, `fx-${fx.id}-retune`)} />
          <Slider label="Humanize" min={0} max={100} step={1} value={num(fx.params.humanize, 0)} unit="%" onChange={(v) => patch({ humanize: v }, `fx-${fx.id}-humanize`)} />
          <Slider label="Within" min={0} max={200} step={1} value={num(fx.params.flexCents, 200)} unit="cents" onChange={(v) => patch({ flexCents: v }, `fx-${fx.id}-flex`)} />
          <Slider label="Transpose" min={-12} max={12} step={1} value={num(fx.params.transpose, 0)} unit="st" onChange={(v) => patch({ transpose: v }, `fx-${fx.id}-transpose`)} />
          <Slider label="Mix" min={0} max={100} step={1} value={Math.round(num(fx.wet, 1) * 100)} unit="%" onChange={(v) => onChange({ ...fx, wet: v / 100 }, `fx-${fx.id}-wet`)} />
          <label className="flex items-center gap-2 text-[10px] text-zinc-300">
            <input type="checkbox" checked={num(fx.params.preserveVibrato, 0) !== 0} onChange={(e) => patch({ preserveVibrato: e.target.checked ? 1 : 0 }, `fx-${fx.id}-vibrato`)} />
            Keep vibrato (motion above about 5 Hz)
          </label>
          <label className="flex items-center gap-2 text-[10px] text-zinc-300">
            <input type="checkbox" checked={useProject} onChange={(e) => patch({ useProject: e.target.checked ? 1 : 0 }, `fx-${fx.id}-use-project`)} />
            Use the song key
          </label>
          {!useProject && (
            <div className="flex gap-1">
              <select aria-label="Device key" value={PITCH_ROOTS.includes(keyName as typeof PITCH_ROOTS[number]) ? keyName : 'C'} onChange={(e) => patch({ keyName: e.target.value }, `fx-${fx.id}-key`)} className="rounded bg-black/40 px-1 py-0.5 text-[10px] text-zinc-100">
                {PITCH_ROOTS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <select aria-label="Device scale" value={PITCH_SCALES.includes(scaleName) ? scaleName : 'chromatic'} onChange={(e) => patch({ scaleName: e.target.value }, `fx-${fx.id}-scale`)} className="min-w-0 flex-1 rounded bg-black/40 px-1 py-0.5 text-[10px] text-zinc-100">
                {PITCH_SCALES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
          <div className="flex items-baseline justify-between rounded bg-black/30 px-1 py-1 text-[10px] text-zinc-300" aria-hidden="true">
            <span ref={detectedRef}>—</span>
            <span>to <span ref={targetRef}>—</span></span>
            <span ref={centsRef}>—</span>
          </div>
          <p className="sr-only">Detected note, target note, and cents update while audio plays.</p>
          {!scale.known && (
            <p className="text-[10px] leading-relaxed text-amber-200/80">This scale is not one Pitch Correct knows, so it corrects to the nearest semitone.</p>
          )}
          <p className="text-[10px] leading-relaxed text-zinc-500">
            <span ref={delayRef}>Processor delay is the analysis window, one 512-sample hop, and one period of the lowest note in this range.</span>
            {' '}Quality mode is a longer window of the same shifter. Stereo input is summed to mono. Formant shift is not on this device.
            {' '}Notes farther than Within stay unchanged. Humanize slows the retune after a note has held for 200 ms.
            {' '}Export corrects each audio clip on this track at the clip sample rate, then runs the other inserts. Live playback corrects here and starts the clip early by this delay. A clip at the start of the song cannot begin before zero, so that opening is trimmed. Instrument notes are corrected live only.
          </p>
        </div>
      )}
    </div>
  );
}
