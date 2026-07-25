'use client';

// MixerPeekStrip — bottom footer of the Session workspace. Pro Tools
// "Mix window" energy without losing the grid. Collapsed: 32px-tall
// meter strip showing per-track output level. Expanded: ~280px with
// full channel strips (fader + mute/solo/arm + insert preview). Click
// the chevron or press M to toggle.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePerfBudget, type PerfTier } from '@/hooks/usePerfBudget';
import { getActiveMixer } from '@/lib/daw/engine';
import type { DAWTrack } from '@/lib/daw/types';

// Honest degradation for the VU-meter ticker, keyed off usePerfBudget's REAL
// measured tier for THIS strip's own rAF loop (never fabricated — see
// hooks/usePerfBudget.ts). The ticker re-renders every mounted channel strip's
// meters on every tick, so throttling the tick cadence is a real cost cut, not
// decoration. Returns the minimum real-ms gap between ticks: 0 = every frame
// (full, ~60fps), a finite gap = throttled (reduced, ~12fps), Infinity = the
// ticker freezes entirely (minimal) — meters hold their last real value
// instead of animating. Exported so the tier→cadence mapping is
// unit-testable without a live rAF loop.
export function meterTickIntervalMs(tier: PerfTier): number {
  if (tier === 'minimal') return Infinity;
  if (tier === 'reduced') return 80;
  return 0;
}

interface MixerPeekStripProps {
  tracks: DAWTrack[];
  selectedTrackId: string | null;
  spectrumData?: Float32Array | null;
  className?: string;
  onSelectTrack?: (id: string | null) => void;
  onUpdateTrack?: (id: string, patch: Partial<DAWTrack>) => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}

// A meter reading, sampled from the live MixerEngine's per-channel
// AnalyserNodes. `measuring` is false whenever no real level could be read —
// no engine constructed, engine disposed, or this track has no mixer channel
// yet — in which case the level is a genuine zero, never a stand-in.
interface MeterReading {
  /** Post-fader RMS 0..1 straight off the channel's AnalyserNode. */
  level: number;
  /** True only when a real analyser produced this number. */
  measuring: boolean;
}

const IDLE_READING: MeterReading = { level: 0, measuring: false };

interface MeterSample {
  levels: Record<string, number>;
  /** True when a live MixerEngine answered this sample at all. */
  engineLive: boolean;
}

const NO_ENGINE_SAMPLE: MeterSample = { levels: {}, engineLive: false };

/**
 * Read every channel's true RMS from the live MixerEngine in one shot
 * (`getAllTrackLevels()` → each channel's post-effects AnalyserNode).
 *
 * There is deliberately no fallback: when there is no engine, no audio
 * context, or the call throws, this reports "not measuring" and the meters
 * render a real zero. Silence must look like silence.
 */
function sampleMixerLevels(): MeterSample {
  let mixer: ReturnType<typeof getActiveMixer> = null;
  try {
    mixer = getActiveMixer();
  } catch {
    return NO_ENGINE_SAMPLE;
  }
  if (!mixer || typeof mixer.getAllTrackLevels !== 'function') return NO_ENGINE_SAMPLE;
  try {
    const levels = mixer.getAllTrackLevels();
    if (!levels || typeof levels !== 'object') return NO_ENGINE_SAMPLE;
    return { levels, engineLive: true };
  } catch {
    // A dead/closed audio graph is a not-measuring state, not a licence to
    // invent motion.
    return NO_ENGINE_SAMPLE;
  }
}

/**
 * Value-equality for two samples. Used to keep `sample` referentially stable
 * across frames whose measured levels are identical (a mixer sitting in real
 * silence reads the same true zeros frame after frame) so an unchanged
 * reading never queues React work. This is a cost cut only — it never
 * substitutes, holds, or smooths a value: any real change in any channel's
 * measured RMS propagates on the very next frame.
 */
function sampleEquals(a: MeterSample, b: MeterSample): boolean {
  if (a === b) return true;
  if (a.engineLive !== b.engineLive) return false;
  const aKeys = Object.keys(a.levels);
  if (aKeys.length !== Object.keys(b.levels).length) return false;
  for (const k of aKeys) {
    if (a.levels[k] !== b.levels[k]) return false;
  }
  return true;
}

function readingFor(sample: MeterSample, trackId: string): MeterReading {
  if (!sample.engineLive) return IDLE_READING;
  const raw = sample.levels[trackId];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return IDLE_READING;
  return { level: Math.max(0, Math.min(1, raw)), measuring: true };
}

function Meter({
  reading,
  color = 'bg-emerald-400',
  testId,
}: { reading: MeterReading; color?: string; testId?: string }) {
  // Vertical meter — 8 segments, top 2 in amber, top 1 in rose
  const segments = 8;
  const active = Math.round(reading.level * segments);
  return (
    <div
      className="flex flex-col-reverse gap-px h-full"
      data-testid={testId}
      data-level={reading.level.toFixed(4)}
      data-measuring={reading.measuring ? 'true' : 'false'}
      title={
        reading.measuring
          ? `Live post-fader RMS: ${Math.round(reading.level * 100)}%`
          : 'No live audio channel — meter reads zero'
      }
    >
      {Array.from({ length: segments }).map((_, i) => {
        const isActive = i < active;
        const segColor = i >= 7 ? 'bg-rose-400' : i >= 6 ? 'bg-amber-400' : color;
        return (
          <div
            key={i}
            className={cn('flex-1 rounded-sm', isActive ? segColor : 'bg-zinc-700/40')}
          />
        );
      })}
    </div>
  );
}

export default function MixerPeekStrip({
  tracks,
  selectedTrackId,
  className,
  onSelectTrack,
  onUpdateTrack,
  expanded = false,
  onToggleExpanded,
}: MixerPeekStripProps) {
  // 60fps-ish sampler. Every tick re-reads TRUE per-channel post-fader RMS off
  // the live MixerEngine's analysers and re-renders every mounted channel
  // strip — real, measurable cost once track counts grow, so it's the thing
  // usePerfBudget's real, measured tier throttles below.
  const [tick, setTick] = useState(0);
  const [sample, setSample] = useState<MeterSample>(NO_ENGINE_SAMPLE);
  // Real, measured (never fabricated) frame-cost budget for THIS ticker loop —
  // fed from the loop's own rAF timestamps (autoMeasure: false), per
  // CLAUDE.md's honest-by-construction rule.
  const { budget: perfBudget, reportFrame: reportTickFrame } = usePerfBudget({ autoMeasure: false });
  const lastTickAtRef = useRef(0);
  const takeSample = useCallback(() => {
    const next = sampleMixerLevels();
    // Pure updater: the analyser read happens above, outside React's
    // reconciliation. Bail out on an identical reading so a genuinely
    // unchanged meter costs no render.
    setSample(prev => (sampleEquals(prev, next) ? prev : next));
  }, []);

  // The rAF loop below OWNS a long-lived subscription, and its body performs a
  // state update (`takeSample`). Those two facts together make the effect's
  // dependency list safety-critical: if any dep changes identity per render,
  // the effect tears down and re-runs on every render, its state update
  // schedules the next render, and the component spins in a synchronous,
  // unbounded render loop that locks the tab (each pass also leaks another
  // orphaned rAF registration). `reportFrame` is a callback identity owned by
  // usePerfBudget — memo-stable today, but this loop must not be hostage to
  // that staying true, and rebuilding the loop because a callback's identity
  // moved would be wrong regardless. Hold it in a ref and depend only on what
  // actually changes the loop's BEHAVIOR (the measured tier).
  const reportTickFrameRef = useRef(reportTickFrame);
  reportTickFrameRef.current = reportTickFrame;

  useEffect(() => {
    let raf = 0;
    const interval = meterTickIntervalMs(perfBudget.tier);
    // One sample immediately on mount, independent of the tier gate, so even a
    // frozen ('minimal') ticker reports the engine's real presence/absence
    // instead of an unmeasured default.
    takeSample();
    const loop = (now: number) => {
      reportTickFrameRef.current(now);
      // interval===0 → tick every frame (full). Otherwise only tick once at
      // least `interval` real ms have passed since the last one; Infinity
      // (minimal) never re-triggers, so the meters genuinely freeze on their
      // last REAL sample instead of merely rendering less-often-but-still-
      // continuously.
      if (interval === 0 || now - lastTickAtRef.current >= interval) {
        lastTickAtRef.current = now;
        takeSample();
        setTick(t => t + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [perfBudget.tier, takeSample]);

  return (
    <footer className={cn('bg-zinc-950/80 backdrop-blur-sm border-t border-white/10 overflow-hidden', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-400">
          <Volume2 className="w-3 h-3" />
          Mixer
          <span className="text-zinc-600">· {tracks.length} tracks</span>
          {/* Honest source label: says what the meters are actually reading,
              including when they are reading nothing at all. */}
          <span
            data-testid="mixer-meter-source"
            data-engine-live={sample.engineLive ? 'true' : 'false'}
            className={cn('lowercase tracking-normal', sample.engineLive ? 'text-zinc-500' : 'text-zinc-600 italic')}
            title={
              sample.engineLive
                ? 'Live per-track post-fader RMS, sampled from the mixer channel analysers'
                : 'No live audio engine — meters read a real zero (never simulated)'
            }
          >
            · {sample.engineLive ? 'live levels' : 'meters idle — no audio engine'}
          </span>
          {/* Hidden test probe reflecting real internal tick count — not
              rendered data, purely instrumentation for asserting the ticker's
              real cadence responds to the measured tier. */}
          <span data-testid="mixer-tick" className="sr-only">{tick}</span>
          {/* Honest, visible degradation indicator — only appears when
              usePerfBudget's REAL measured tier for this ticker is actually
              degraded (overBudget), never as decoration. */}
          {perfBudget.overBudget && (
            <span
              data-testid="mixer-perf-badge"
              className="text-amber-400 lowercase tracking-normal not-italic"
              title={`Meter ticker throttled — measured ~${Math.round(perfBudget.fps)}fps, below budget`}
            >
              · {perfBudget.tier === 'minimal' ? 'meters frozen (low fps)' : 'reduced fx (low fps)'}
            </span>
          )}
        </div>
        {onToggleExpanded && (
          <button
            onClick={onToggleExpanded}
            className="text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-1 text-[10px]"
            aria-label={expanded ? 'Collapse mixer' : 'Expand mixer'}
          >
            {expanded ? <><ChevronDown className="w-3 h-3" /> Hide</> : <><ChevronUp className="w-3 h-3" /> Expand</>}
          </button>
        )}
      </div>

      {/* Collapsed: tight meter row */}
      {!expanded && (
        <div className="px-3 py-2 flex items-stretch gap-1.5 h-12 overflow-x-auto">
          {tracks.map(t => {
            // Real measured level only. Mute needs no UI override: the engine
            // mutes upstream of the meter tap, so a muted channel genuinely
            // reads ~0.
            const reading = readingFor(sample, t.id);
            return (
              <button
                key={t.id}
                onClick={() => onSelectTrack?.(t.id)}
                className={cn(
                  'flex items-center gap-1.5 px-1.5 rounded shrink-0 border transition-colors',
                  selectedTrackId === t.id ? 'border-white/30 bg-white/[0.04]' : 'border-transparent hover:bg-white/[0.02]'
                )}
                title={t.name}
              >
                <div className="h-8 w-1.5">
                  <Meter
                    reading={reading}
                    color={t.mute ? 'bg-zinc-500' : 'bg-emerald-400'}
                    testId={`mixer-meter-${t.id}`}
                  />
                </div>
                <span className="text-[10px] font-mono text-zinc-400 max-w-[64px] truncate">{t.name}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Expanded: channel-strip grid */}
      {expanded && (
        <div className="p-3 grid gap-2 max-h-72 overflow-x-auto" style={{ gridTemplateColumns: `repeat(${Math.max(1, tracks.length)}, 88px)` }}>
          {tracks.map(t => {
            const vol = Number(t.volume ?? 0.75);
            const pan = Number(t.pan ?? 0);
            // Real measured level only — see the collapsed strip above.
            const reading = readingFor(sample, t.id);
            const isSelected = selectedTrackId === t.id;
            return (
              <div
                key={t.id}
                onClick={() => onSelectTrack?.(t.id)}
                className={cn(
                  'rounded border p-2 flex flex-col items-center gap-2 cursor-pointer transition-colors',
                  isSelected ? 'border-white/30 bg-white/[0.04]' : 'border-white/10 hover:bg-white/[0.02]'
                )} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                <div className="text-[10px] font-mono text-zinc-300 truncate w-full text-center">{t.name}</div>
                <div className="flex gap-1 text-[8px]">
                  <button
                    className={cn('px-1 py-0.5 rounded border', t.mute ? 'border-amber-400 text-amber-400 bg-amber-400/10' : 'border-zinc-700 text-zinc-400')}
                    onClick={(e) => { e.stopPropagation(); onUpdateTrack?.(t.id, { mute: !t.mute }); }}
                  >M</button>
                  <button
                    className={cn('px-1 py-0.5 rounded border', t.solo ? 'border-yellow-400 text-yellow-400 bg-yellow-400/10' : 'border-zinc-700 text-zinc-400')}
                    onClick={(e) => { e.stopPropagation(); onUpdateTrack?.(t.id, { solo: !t.solo }); }}
                  >S</button>
                  <button
                    className={cn('px-1 py-0.5 rounded border', t.armed ? 'border-rose-400 text-rose-400 bg-rose-400/10' : 'border-zinc-700 text-zinc-400')}
                    onClick={(e) => { e.stopPropagation(); onUpdateTrack?.(t.id, { armed: !t.armed }); }}
                  >R</button>
                </div>
                <div className="flex items-stretch gap-1 h-32">
                  <input
                    type="range"
                    min={0} max={1} step={0.01} value={vol}
                    onChange={(e) => onUpdateTrack?.(t.id, { volume: Number(e.target.value) })}
                    style={{ writingMode: 'vertical-lr', width: 14 } as React.CSSProperties}
                    aria-label={`${t.name} fader`}
                  />
                  <div className="w-2 h-full">
                    <Meter
                      reading={reading}
                      color={t.mute ? 'bg-zinc-500' : 'bg-emerald-400'}
                      testId={`mixer-meter-${t.id}`}
                    />
                  </div>
                </div>
                <div className="text-[10px] font-mono text-zinc-400">{Math.round(vol * 100)}</div>
                <div className="w-full">
                  <input
                    type="range"
                    min={-1} max={1} step={0.01} value={pan}
                    onChange={(e) => onUpdateTrack?.(t.id, { pan: Number(e.target.value) })}
                    className="w-full accent-cyan-400 h-1"
                    aria-label={`${t.name} pan`}
                  />
                  <div className="text-[9px] text-zinc-400 text-center">
                    {pan === 0 ? 'C' : pan < 0 ? `L${Math.round(-pan * 100)}` : `R${Math.round(pan * 100)}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </footer>
  );
}
