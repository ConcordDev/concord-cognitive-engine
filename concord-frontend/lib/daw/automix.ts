/**
 * One-click Auto Mix + Master, implemented in DSP (no AI required).
 *
 *  1. Measure each track solo (offline render, pre-fader) → trim to ~-18 dBFS RMS.
 *  2. Role-based cleanup: high-pass on everything except kick/bass, vocal EQ +
 *     compression, gentle drum/bass/keys compression.
 *  3. Kick/bass relationship: bass ducks under the kick (scheduled sidechain envelope).
 *  4. Pan suggestions for doubled/wide parts; lows stay centered.
 *  5. Bus glue compression on the master bus.
 *  6. Mastering chain: EQ, gentle multiband, width with mono lows, true-peak
 *     limiter, gain toward the chosen loudness target.
 * Everything lands in the project as normal, editable devices (ids prefixed
 * 'am-'), so it is undoable and tweakable afterwards.
 */

import type { DAWProject, DAWTrack, EffectInstance, TrackRole } from './types';
import { effect, defaultMasteringChain, trackKind } from './project';
import { rmsDbfs, measureLoudness, type LoudnessReport } from './dsp/loudness';
import { renderProject, type PcmAudio } from './render';
import { isDrumInstrument } from './presets';

export const TARGET_RMS_DBFS = -18;

const ROLE_FADER_DB: Record<TrackRole, number> = {
  vocal: 0, drums: -2, kick: -2, bass: -3, keys: -6, guitar: -5, synth: -5, pad: -9, fx: -10, other: -6,
};

const ROLE_HPF: Partial<Record<TrackRole, number>> = {
  vocal: 90, guitar: 90, keys: 100, synth: 120, pad: 150, fx: 150, other: 80, drums: 30,
};

export function inferRole(t: DAWTrack): TrackRole {
  if (t.role) return t.role;
  const n = t.name.toLowerCase();
  if (/kick|bd\b/.test(n)) return 'kick';
  if (isDrumInstrument(t.instrumentId) || /drum|beat|perc|hat|snare/.test(n)) return 'drums';
  if (/808|bass|sub/.test(n) || /bass/.test(t.instrumentId || '')) return 'bass';
  if (/vox|vocal|voice|adlib|ad-lib|double|harm/.test(n) || t.type === 'audio') return 'vocal';
  if (/pad|string/.test(n) || /pad|strings/.test(t.instrumentId || '')) return 'pad';
  if (/key|piano|ep|organ|rhodes/.test(n) || /keys|organ/.test(t.instrumentId || '')) return 'keys';
  if (/gtr|guitar/.test(n)) return 'guitar';
  if (/fx|riser|sweep/.test(n)) return 'fx';
  return trackKind(t) === 'instrument' ? 'synth' : 'other';
}

export interface TrackMeasurement {
  trackId: string;
  rmsDb: number; // pre-fader, gated
}

export interface AutoMixPlan {
  project: DAWProject;
  notes: string[];
}

const stripAuto = (chain: EffectInstance[]) => chain.filter((e) => !e.id.startsWith('am-'));

function cleanupChain(role: TrackRole): EffectInstance[] {
  const hp = ROLE_HPF[role] || 0;
  const out: EffectInstance[] = [];
  switch (role) {
    case 'vocal':
      out.push(effect('eq3', 'Auto EQ (vocal)', { highPass: hp, lowFreq: 300, lowGain: -2, midFreq: 3000, midQ: 0.8, midGain: 1.5, highFreq: 10000, highGain: 2 }, 1, 'am-eq'));
      out.push(effect('compressor', 'Auto Comp (vocal)', { threshold: -22, ratio: 3, attack: 0.006, release: 0.12, knee: 6, makeup: 2 }, 1, 'am-comp'));
      break;
    case 'drums':
    case 'kick':
      if (hp) out.push(effect('eq3', 'Auto EQ (drums)', { highPass: hp, lowGain: 0, midFreq: 400, midGain: -1.5, midQ: 1, highGain: 1 }, 1, 'am-eq'));
      out.push(effect('compressor', 'Auto Comp (drums)', { threshold: -20, ratio: 2.5, attack: 0.02, release: 0.15, knee: 4, makeup: 1 }, 1, 'am-comp'));
      break;
    case 'bass':
      out.push(effect('compressor', 'Auto Comp (bass)', { threshold: -22, ratio: 3, attack: 0.01, release: 0.2, knee: 6, makeup: 1 }, 1, 'am-comp'));
      break;
    case 'keys':
    case 'pad':
    case 'synth':
    case 'guitar':
      out.push(effect('eq3', `Auto EQ (${role})`, { highPass: hp, lowFreq: 250, lowGain: -1.5, midGain: 0, highGain: 0.5 }, 1, 'am-eq'));
      out.push(effect('compressor', `Auto Comp (${role})`, { threshold: -20, ratio: 1.8, attack: 0.02, release: 0.25, knee: 8, makeup: 0.5 }, 1, 'am-comp'));
      break;
    default:
      if (hp) out.push(effect('eq3', 'Auto EQ', { highPass: hp, lowGain: 0, midGain: 0, highGain: 0 }, 1, 'am-eq'));
  }
  return out;
}

/** Pure planning step (unit-tested): measurements in → edited project out. */
export function planAutoMix(project: DAWProject, measurements: TrackMeasurement[], target: { lufs: number; ceilingDb: number }): AutoMixPlan {
  const notes: string[] = [];
  const byId = new Map(measurements.map((m) => [m.trackId, m]));
  const roles = new Map(project.tracks.map((t) => [t.id, inferRole(t)]));

  let tracks = project.tracks.map((t) => {
    if (t.type === 'master' || t.type === 'bus') return t;
    const role = roles.get(t.id) as TrackRole;
    const m = byId.get(t.id);
    const next: DAWTrack = { ...t, role };
    if (m && Number.isFinite(m.rmsDb)) {
      const trim = Math.max(-24, Math.min(24, (t.trimDb || 0) + (TARGET_RMS_DBFS - m.rmsDb)));
      next.trimDb = Math.round(trim * 10) / 10;
      notes.push(`${t.name}: trim ${next.trimDb >= 0 ? '+' : ''}${next.trimDb} dB → ${TARGET_RMS_DBFS} dBFS RMS`);
    }
    next.volume = ROLE_FADER_DB[role];
    next.effectChain = [...cleanupChain(role), ...stripAuto(t.effectChain)];
    return next;
  });

  // Kick/bass relationship.
  const kickSrc = tracks.find((t) => roles.get(t.id) === 'kick') || tracks.find((t) => roles.get(t.id) === 'drums');
  if (kickSrc) {
    tracks = tracks.map((t) => {
      if (roles.get(t.id) !== 'bass') return t;
      notes.push(`${t.name}: ducks 4 dB under ${kickSrc.name}'s kick`);
      return { ...t, duck: { sourceTrackId: kickSrc.id, depthDb: 4, releaseMs: 120, pitches: roles.get(kickSrc.id) === 'kick' ? undefined : [36, 35] } };
    });
  }

  // Pan: centre low end + lead; spread duplicates of the same role.
  const groups = new Map<TrackRole, DAWTrack[]>();
  for (const t of tracks) {
    const r = roles.get(t.id) as TrackRole;
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(t);
  }
  const pans = new Map<string, number>();
  for (const [role, list] of groups) {
    if (role === 'bass' || role === 'kick' || role === 'drums') { list.forEach((t) => pans.set(t.id, 0)); continue; }
    if (list.length < 2) continue;
    // First (lead) stays centred; others alternate L/R widening.
    list.forEach((t, i) => {
      if (i === 0 && role === 'vocal') { pans.set(t.id, 0); return; }
      const k = role === 'vocal' ? i : i + 1;
      const side = k % 2 === 1 ? -1 : 1;
      const amt = Math.min(0.7, 0.3 + 0.15 * Math.floor((k - 1) / 2));
      pans.set(t.id, side * amt);
    });
  }
  tracks = tracks.map((t) => {
    const p = pans.get(t.id);
    if (p === undefined || p === t.pan) return t;
    notes.push(`${t.name}: pan ${p === 0 ? 'C' : p < 0 ? `L${Math.round(-p * 100)}` : `R${Math.round(p * 100)}`}`);
    return { ...t, pan: p };
  });

  const glue = effect('compressor', 'Bus Glue', { threshold: -16, ratio: 2, attack: 0.03, release: 0.2, knee: 6, makeup: 0 }, 1, 'am-glue');
  const masterBus = { ...project.masterBus, inserts: [glue, ...stripAuto(project.masterBus?.inserts || []).filter((e) => e.type !== 'limiter')] };
  const mc = defaultMasteringChain(true);
  mc.loudnessTarget = target.lufs;
  mc.limiter = { ...mc.limiter, params: { ...mc.limiter.params, ceiling: target.ceilingDb } };
  notes.push('Master: bus glue 2:1, EQ, gentle multiband, mono below 120 Hz, true-peak limiter');
  return { project: { ...project, tracks, masterBus, masteringChain: mc, updatedAt: Date.now() }, notes };
}

export interface AutoMixResult extends AutoMixPlan {
  before: LoudnessReport;
  after: LoudnessReport;
  /** dB to add to "before" so the A/B comparison is level-matched. */
  matchDb: number;
}

/** Full one-click pass: measure → plan → render → set master gain toward target. */
export async function autoMixAndMaster(
  project: DAWProject,
  audio: Map<string, PcmAudio>,
  target: { lufs: number; ceilingDb: number },
  onProgress?: (label: string, f: number) => void,
): Promise<AutoMixResult> {
  const sampleRate = 44100;
  const endBeat = Math.min(128, Math.max(16, project.tracks.reduce((m, t) => Math.max(m, ...t.clips.map((c) => c.startBeat + c.lengthBeats)), 0)));
  onProgress?.('Measuring the current mix', 0.05);
  const beforeMix = await renderProject(project, audio, { sampleRate, endBeat, tailSec: 1 });
  const before = measureLoudness(beforeMix.channels, sampleRate);

  const playable = project.tracks.filter((t) => t.clips.length && t.type !== 'master');
  const measurements: TrackMeasurement[] = [];
  for (let i = 0; i < playable.length; i++) {
    const t = playable[i];
    onProgress?.(`Measuring ${t.name}`, 0.1 + (0.5 * i) / Math.max(1, playable.length));
    // Pre-fader, no inserts: what the track feeds its chain.
    const solo: DAWProject = {
      ...project,
      tracks: project.tracks.map((x) => (x.id === t.id ? { ...x, volume: 0, pan: 0, mute: false, solo: false, effectChain: [], duck: undefined } : { ...x, solo: false })),
      masterBus: { ...project.masterBus, inserts: [], volume: 0 },
    };
    const r = await renderProject(solo, audio, { sampleRate, endBeat, tailSec: 0.5, onlyTrackIds: [t.id], bypassMastering: true });
    measurements.push({ trackId: t.id, rmsDb: rmsDbfs(r.channels, -60) });
  }
  const plan = planAutoMix(project, measurements, target);

  onProgress?.('Mastering', 0.7);
  const probe = await renderProject(plan.project, audio, { sampleRate, endBeat, tailSec: 1 });
  const probeReport = measureLoudness(probe.channels, sampleRate);
  // Push the live limiter's input gain toward the target (exports hit it exactly via masterToTarget).
  const gain = Number.isFinite(probeReport.integratedLufs) ? Math.max(-12, Math.min(18, target.lufs - probeReport.integratedLufs)) : 0;
  const lim = plan.project.masteringChain.limiter;
  const project2: DAWProject = {
    ...plan.project,
    masteringChain: { ...plan.project.masteringChain, limiter: { ...lim, params: { ...lim.params, gain: Math.round(gain * 10) / 10 } } },
  };
  onProgress?.('Checking result', 0.85);
  const afterMix = await renderProject(project2, audio, { sampleRate, endBeat, tailSec: 1 });
  const after = measureLoudness(afterMix.channels, sampleRate);
  const matchDb = Number.isFinite(after.integratedLufs) && Number.isFinite(before.integratedLufs) ? after.integratedLufs - before.integratedLufs : 0;
  plan.notes.push(`Loudness: ${fmt(before.integratedLufs)} → ${fmt(after.integratedLufs)} LUFS (target ${target.lufs}), true peak ${fmt(after.truePeakDbtp)} dBTP`);
  onProgress?.('Done', 1);
  return { project: project2, notes: plan.notes, before, after, matchDb };
}

const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-∞');
