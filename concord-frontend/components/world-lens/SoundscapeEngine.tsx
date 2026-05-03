'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { resumeAudioContext } from '../../lib/audio/unlock';

/* ── Types ─────────────────────────────────────────────────────── */

type DistrictName =
  | 'forge' | 'academy' | 'docks' | 'commons' | 'exchange'
  | 'observatory' | 'grid' | 'arena' | 'nexus' | 'frontier' | 'silent'
  | 'arts' | 'civic' | 'industrial' | 'tech' | 'market';

type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';
type WeatherType = 'clear' | 'rain' | 'storm' | 'wind' | 'snow';

interface SoundscapeState {
  currentDistrict: DistrictName;
  previousDistrict: DistrictName | null;
  timeOfDay: TimeOfDay;
  isInterior: boolean;
  weather: WeatherType;
  weatherIntensity: number;
  crossfading: boolean;
}

export interface ListenerPosition {
  x: number; y: number; z: number;
  forwardX: number; forwardZ: number;
}

interface SoundscapeAPI {
  setDistrict:     (district: string) => void;
  setTimeOfDay:    (time: TimeOfDay) => void;
  setInterior:     (interior: boolean) => void;
  setWeather:      (weather: WeatherType, intensity?: number) => void;
  triggerSFX:      (sfxId: string) => void;
  playSpatialSFX:  (sfxId: string, worldPos: { x: number; y: number; z: number }) => void;
  playMusicTrack:  (url: string) => void;
  stopMusicTrack:  () => void;
  /** Switch the procedural ambient music to a district-specific loop with crossfade. */
  setMusicDistrict: (district: string) => void;
  /** Duck the procedural music during combat. 0 = no duck, 1 = full duck (35% volume). */
  setMusicCombatIntensity: (intensity: number) => void;
}

/* ── District ambient config (base freq + texture) ────────────── */

interface DistrictAudio {
  freq:    number;    // base drone frequency (Hz), 0 = silence
  type:    OscillatorType;
  noise:   number;    // 0-1 noise texture mix
  volume:  number;    // master volume 0-1
}

const DISTRICT_AUDIO: Record<DistrictName, DistrictAudio> = {
  forge:       { freq: 55,   type: 'sawtooth', noise: 0.4,  volume: 0.07 },
  industrial:  { freq: 55,   type: 'sawtooth', noise: 0.4,  volume: 0.07 },
  academy:     { freq: 528,  type: 'sine',     noise: 0.05, volume: 0.04 },
  docks:       { freq: 80,   type: 'sine',     noise: 0.5,  volume: 0.05 },
  commons:     { freq: 220,  type: 'sine',     noise: 0.1,  volume: 0.04 },
  exchange:    { freq: 330,  type: 'triangle', noise: 0.2,  volume: 0.04 },
  market:      { freq: 330,  type: 'triangle', noise: 0.2,  volume: 0.04 },
  observatory: { freq: 440,  type: 'sine',     noise: 0.02, volume: 0.03 },
  tech:        { freq: 440,  type: 'sine',     noise: 0.02, volume: 0.03 },
  grid:        { freq: 120,  type: 'square',   noise: 0.3,  volume: 0.05 },
  arena:       { freq: 70,   type: 'triangle', noise: 0.6,  volume: 0.06 },
  nexus:       { freq: 256,  type: 'sine',     noise: 0.05, volume: 0.03 },
  civic:       { freq: 256,  type: 'sine',     noise: 0.05, volume: 0.03 },
  frontier:    { freq: 0,    type: 'sine',     noise: 0.7,  volume: 0.05 },
  arts:        { freq: 396,  type: 'sine',     noise: 0.1,  volume: 0.04 },
  silent:      { freq: 0,    type: 'sine',     noise: 0,    volume: 0   },
};

/* ── SFX synthesizer config ───────────────────────────────────── */

interface SFXDef { freq: number; type: OscillatorType; duration: number; attack: number; decay: number; semitones?: number[] }

const SFX_MAP: Record<string, SFXDef> = {
  'ascending-chime':   { freq: 523,  type: 'sine',     duration: 0.5,  attack: 0.01, decay: 0.4,  semitones: [0, 4, 7] },
  'low-thud':          { freq: 80,   type: 'triangle', duration: 0.3,  attack: 0.01, decay: 0.25 },
  'snap-click':        { freq: 1200, type: 'sine',     duration: 0.08, attack: 0.001, decay: 0.07 },
  'coin-clink':        { freq: 1046, type: 'triangle', duration: 0.4,  attack: 0.001, decay: 0.35, semitones: [0, 7] },
  'notification-glow': { freq: 660,  type: 'sine',     duration: 0.6,  attack: 0.02, decay: 0.5 },
  'fanfare-short':     { freq: 523,  type: 'square',   duration: 0.8,  attack: 0.01, decay: 0.6,  semitones: [0, 4, 7, 12] },
  'rumble':            { freq: 40,   type: 'sawtooth', duration: 0.8,  attack: 0.1,  decay: 0.6 },
  'build-finish':      { freq: 440,  type: 'sine',     duration: 0.5,  attack: 0.01, decay: 0.4,  semitones: [0, 7, 12] },
  'victory-sting':     { freq: 659,  type: 'square',   duration: 1.0,  attack: 0.01, decay: 0.8,  semitones: [0, 4, 7, 12, 16] },
  // gathering / crafting SFX
  'gather-tick':       { freq: 880,  type: 'sine',     duration: 0.08, attack: 0.001, decay: 0.07 },
  'gather-success':    { freq: 698,  type: 'sine',     duration: 0.4,  attack: 0.01, decay: 0.35, semitones: [0, 5, 9] },
  'gather-miss':       { freq: 120,  type: 'triangle', duration: 0.2,  attack: 0.01, decay: 0.18 },
  'gather-full':       { freq: 523,  type: 'sine',     duration: 0.7,  attack: 0.01, decay: 0.6,  semitones: [0, 4, 7, 12] },
  'craft-hold':        { freq: 220,  type: 'sine',     duration: 0.3,  attack: 0.05, decay: 0.2 },
  'craft-release-good':{ freq: 784,  type: 'sine',     duration: 0.4,  attack: 0.01, decay: 0.35, semitones: [0, 4] },
  'craft-release-bad': { freq: 110,  type: 'sawtooth', duration: 0.25, attack: 0.01, decay: 0.22 },
  // level up / xp
  'xp-tick':           { freq: 1320, type: 'sine',     duration: 0.15, attack: 0.001, decay: 0.14 },
  'level-up':          { freq: 523,  type: 'triangle', duration: 1.2,  attack: 0.01, decay: 0.9,  semitones: [0, 4, 7, 12, 19] },
  // combat impacts — single tones (used as layers in LAYER_MAP)
  'hit-light':         { freq: 140,  type: 'triangle', duration: 0.18, attack: 0.001, decay: 0.16 },
  'hit-heavy':         { freq: 70,   type: 'sawtooth', duration: 0.28, attack: 0.001, decay: 0.26, semitones: [0, -5] },
  'hit-crit':          { freq: 260,  type: 'square',   duration: 0.32, attack: 0.001, decay: 0.28, semitones: [0, -7, 12] },
  'dodge-whoosh':      { freq: 700,  type: 'sine',     duration: 0.14, attack: 0.001, decay: 0.12 },
  'block-clang':       { freq: 110,  type: 'square',   duration: 0.22, attack: 0.001, decay: 0.20, semitones: [0, 7] },
  'kill-blow':         { freq: 55,   type: 'sawtooth', duration: 0.55, attack: 0.001, decay: 0.50, semitones: [0, -12] },
  // combat layer atoms — high transient tick + body thump + bone crack used by hit-confirm
  'hit-transient':     { freq: 1800, type: 'triangle', duration: 0.04, attack: 0.001, decay: 0.035 },
  'hit-thump-deep':    { freq: 38,   type: 'sawtooth', duration: 0.22, attack: 0.001, decay: 0.20 },
  'bone-crack':        { freq: 360,  type: 'sawtooth', duration: 0.06, attack: 0.001, decay: 0.055, semitones: [0, -3] },
  // Movement footsteps — quick low-decay percussives. Each surface gets a
  // different timbre + frequency so the ear distinguishes grass/stone/wood/water.
  'footstep-grass':    { freq: 180,  type: 'triangle', duration: 0.06, attack: 0.001, decay: 0.055 },
  'footstep-stone':    { freq: 320,  type: 'square',   duration: 0.05, attack: 0.001, decay: 0.045 },
  'footstep-wood':     { freq: 260,  type: 'triangle', duration: 0.07, attack: 0.001, decay: 0.065 },
  'footstep-water':    { freq: 420,  type: 'sine',     duration: 0.10, attack: 0.001, decay: 0.090 },
  // UI feedback — short, dry, distinct from snap-click so the ear separates
  // "I clicked a button" from "I placed a thing in the world".
  'ui-click':          { freq: 1500, type: 'square',   duration: 0.03, attack: 0.001, decay: 0.025 },
  'ui-hover':          { freq: 900,  type: 'sine',     duration: 0.02, attack: 0.001, decay: 0.018 },
  // Craft success ding — bright, ascending, shorter than fanfare-short so
  // it can play on every successful craft without becoming fatiguing.
  'craft-ding':        { freq: 880,  type: 'sine',     duration: 0.32, attack: 0.005, decay: 0.28, semitones: [0, 4, 7] },
  // Inventory rustle — papery shuffle for opening pouches/bags.
  'inventory-rustle':  { freq: 220,  type: 'sawtooth', duration: 0.18, attack: 0.005, decay: 0.16, semitones: [0, 3, -2] },
  // Sword/weapon swing through air — different from dodge-whoosh (dodge is
  // higher pitched and shorter; this is the heavy descending blade arc).
  'sword-swoosh':      { freq: 520,  type: 'triangle', duration: 0.16, attack: 0.001, decay: 0.14, semitones: [0, -7] },
  'sword-swoosh-heavy':{ freq: 360,  type: 'sawtooth', duration: 0.22, attack: 0.001, decay: 0.20, semitones: [0, -10] },
  // Low-HP heartbeat — deep, short pulse pair (lub-dub). Single tone is the
  // "lub"; the "dub" is scheduled by HeartbeatHooks at +120ms via a second
  // trigger so we can keep the SFX defs flat.
  'heartbeat-lub':     { freq: 65,   type: 'sine',     duration: 0.10, attack: 0.005, decay: 0.09 },
  'heartbeat-dub':     { freq: 50,   type: 'sine',     duration: 0.14, attack: 0.005, decay: 0.13 },
};

/**
 * Layered SFX — one logical id triggers multiple atoms with time offsets.
 * The layered approach is what gives hits weight: a high transient tick
 * (the metallic edge), a mid body (the strike), and a deep thump (the mass).
 */
interface LayerStep { sfx: string; delayMs: number }

const LAYER_MAP: Record<string, LayerStep[]> = {
  'hit-confirm-light': [
    { sfx: 'hit-transient', delayMs: 0 },
    { sfx: 'hit-light',     delayMs: 8 },
  ],
  'hit-confirm-heavy': [
    { sfx: 'hit-transient',  delayMs: 0 },
    { sfx: 'hit-heavy',      delayMs: 10 },
    { sfx: 'hit-thump-deep', delayMs: 18 },
  ],
  'hit-confirm-crit': [
    { sfx: 'hit-transient',  delayMs: 0 },
    { sfx: 'hit-crit',       delayMs: 6 },
    { sfx: 'bone-crack',     delayMs: 14 },
    { sfx: 'hit-thump-deep', delayMs: 22 },
  ],
  'hit-confirm-kill': [
    { sfx: 'hit-transient',  delayMs: 0 },
    { sfx: 'kill-blow',      delayMs: 8 },
    { sfx: 'hit-thump-deep', delayMs: 30 },
    { sfx: 'rumble',         delayMs: 90 },
  ],
};

const DISTRICT_ALIAS: Record<string, DistrictName> = {
  forge: 'forge', 'the-forge': 'forge', industrial: 'industrial',
  academy: 'academy', 'the-academy': 'academy',
  docks: 'docks', 'the-docks': 'docks',
  commons: 'commons', 'the-commons': 'commons',
  exchange: 'exchange', 'the-exchange': 'exchange',
  observatory: 'observatory', 'the-observatory': 'observatory',
  grid: 'grid', 'the-grid': 'grid',
  arena: 'arena', 'the-arena': 'arena',
  nexus: 'nexus', 'the-nexus': 'nexus',
  frontier: 'frontier', 'the-frontier': 'frontier',
  arts: 'arts', civic: 'civic', tech: 'tech', market: 'market',
};

const CROSSFADE_MS = 400;

/* ── Spatial SFX helper ─────────────────────────────────────────── */

function playToneSpatial(
  ctx: AudioContext,
  def: SFXDef,
  masterGain: GainNode,
  worldPos: { x: number; y: number; z: number },
): void {
  const panner = ctx.createPanner();
  panner.panningModel  = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.rolloffFactor = 1.0;
  panner.maxDistance   = 50;
  panner.refDistance   = 1;
  panner.positionX.value = worldPos.x;
  panner.positionY.value = worldPos.y;
  panner.positionZ.value = worldPos.z;
  panner.connect(masterGain);

  const freqs = def.semitones
    ? def.semitones.map(s => def.freq * Math.pow(2, s / 12))
    : [def.freq];

  const now = ctx.currentTime;
  const stepDuration = def.duration / freqs.length;
  const totalDuration = def.duration + 0.1;

  freqs.forEach((freq, i) => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = def.type;
    osc.frequency.setValueAtTime(freq, now + i * stepDuration);
    gain.gain.setValueAtTime(0, now + i * stepDuration);
    gain.gain.linearRampToValueAtTime(0.25, now + i * stepDuration + def.attack);
    gain.gain.linearRampToValueAtTime(0, now + i * stepDuration + def.decay);
    osc.connect(gain);
    gain.connect(panner);
    osc.start(now + i * stepDuration);
    osc.stop(now + i * stepDuration + def.decay + 0.05);
  });

  // Disconnect panner after all tones finish
  setTimeout(() => { try { panner.disconnect(); } catch { /* ok */ } }, totalDuration * 1000 + 200);
}

/* ── Context ────────────────────────────────────────────────────── */

const SoundscapeContext = createContext<SoundscapeAPI>({
  setDistrict:    () => {},
  setTimeOfDay:   () => {},
  setInterior:    () => {},
  setWeather:     () => {},
  triggerSFX:     () => {},
  playSpatialSFX: () => {},
  playMusicTrack: () => {},
  stopMusicTrack: () => {},
  setMusicDistrict: () => {},
  setMusicCombatIntensity: () => {},
});

/* ── Procedural ambient music — per-district loops ─────────────── */
//
// Each district maps to a procedural music profile: a key root (Hz), a
// chord progression (semitone offsets relative to root), an arpeggio
// pattern, a bass pulse, and a tempo. The "loop" runs by scheduling
// the next chord every chordMs; a single cycle is ~6–8s and the
// experience is a 2-min ambient bed before any noticeable repetition.

interface MusicProfile {
  rootHz:      number;          // base pitch of the key
  chordsRel:   number[][];      // each entry = semitone offsets for one chord (relative to root)
  arpRel:      number[];        // semitone offsets for the arpeggio pattern within the current chord
  bassRel:     number;          // semitone offset of the bass pulse from root
  chordMs:     number;          // duration each chord plays before next
  arpMs:       number;          // step duration for the arpeggio
  voiceType:   OscillatorType;  // chord pad timbre
  arpType:     OscillatorType;
  bassType:    OscillatorType;
  vol:         number;          // base volume 0–1
  filterHz:    number;          // chord pad lowpass cutoff for warmth
}

const MUSIC_PROFILES: Record<DistrictName, MusicProfile> = {
  // Heavy industrial — minor key, low brass-like pad, slow tempo
  forge:       { rootHz: 110, chordsRel: [[0,3,7], [0,3,7], [-2,1,5], [-4,-1,3]], arpRel: [0,3,7,12], bassRel: -12, chordMs: 2400, arpMs: 600, voiceType: 'sawtooth', arpType: 'triangle', bassType: 'sine', vol: 0.05, filterHz: 800 },
  industrial:  { rootHz: 110, chordsRel: [[0,3,7], [0,3,7], [-2,1,5], [-4,-1,3]], arpRel: [0,3,7,12], bassRel: -12, chordMs: 2400, arpMs: 600, voiceType: 'sawtooth', arpType: 'triangle', bassType: 'sine', vol: 0.05, filterHz: 800 },
  // Academic — bright sine pads, major key, light arpeggio
  academy:     { rootHz: 261, chordsRel: [[0,4,7], [-3,0,4], [2,5,9], [-3,0,4]], arpRel: [0,4,7,12,7,4], bassRel: -12, chordMs: 2000, arpMs: 250, voiceType: 'sine', arpType: 'sine', bassType: 'sine', vol: 0.04, filterHz: 3000 },
  // Docks — open fifths, slow swells, hint of melancholy
  docks:       { rootHz: 146, chordsRel: [[0,7], [0,7,12], [-5,2], [-2,5]], arpRel: [0,7,12,7], bassRel: -12, chordMs: 2800, arpMs: 700, voiceType: 'sine', arpType: 'triangle', bassType: 'sine', vol: 0.045, filterHz: 1500 },
  // Commons — warm major triads, gentle pulse
  commons:     { rootHz: 220, chordsRel: [[0,4,7], [-5,0,4], [2,7,11], [-3,0,4]], arpRel: [0,4,7,11], bassRel: -12, chordMs: 2200, arpMs: 350, voiceType: 'triangle', arpType: 'sine', bassType: 'sine', vol: 0.04, filterHz: 2200 },
  // Exchange — busy arpeggio, walking bass, suspended chords
  exchange:    { rootHz: 196, chordsRel: [[0,5,7], [0,4,7], [2,5,9], [-3,2,5]], arpRel: [0,5,7,12,5,0], bassRel: -12, chordMs: 1800, arpMs: 220, voiceType: 'triangle', arpType: 'square', bassType: 'triangle', vol: 0.04, filterHz: 2500 },
  market:      { rootHz: 196, chordsRel: [[0,5,7], [0,4,7], [2,5,9], [-3,2,5]], arpRel: [0,5,7,12,5,0], bassRel: -12, chordMs: 1800, arpMs: 220, voiceType: 'triangle', arpType: 'square', bassType: 'triangle', vol: 0.04, filterHz: 2500 },
  // Observatory / tech — long ethereal pads, sparse high arpeggio
  observatory: { rootHz: 174, chordsRel: [[0,4,7,11], [-5,0,4,9], [2,7,11], [-3,0,4]], arpRel: [12,16,19,24], bassRel: -12, chordMs: 3200, arpMs: 800, voiceType: 'sine', arpType: 'sine', bassType: 'sine', vol: 0.035, filterHz: 4000 },
  tech:        { rootHz: 174, chordsRel: [[0,4,7,11], [-5,0,4,9], [2,7,11], [-3,0,4]], arpRel: [12,16,19,24], bassRel: -12, chordMs: 3200, arpMs: 800, voiceType: 'sine', arpType: 'sine', bassType: 'sine', vol: 0.035, filterHz: 4000 },
  // Grid — square-wave harmonic minor, glitchy fast arp
  grid:        { rootHz: 130, chordsRel: [[0,3,7], [-1,2,6], [3,7,10], [-2,1,5]], arpRel: [0,3,7,10,7,3], bassRel: -12, chordMs: 1600, arpMs: 180, voiceType: 'square', arpType: 'square', bassType: 'sawtooth', vol: 0.045, filterHz: 1800 },
  // Arena — dark, tense, low brass + ostinato
  arena:       { rootHz: 98,  chordsRel: [[0,3,7], [0,3,7], [-2,1,5], [-3,0,4]], arpRel: [0,3,7,3], bassRel: -12, chordMs: 1800, arpMs: 220, voiceType: 'sawtooth', arpType: 'triangle', bassType: 'sine', vol: 0.06, filterHz: 1000 },
  // Nexus / civic — warm, slow, hopeful
  nexus:       { rootHz: 196, chordsRel: [[0,4,7], [-2,2,5], [-5,0,4], [-3,0,4]], arpRel: [0,4,7,12], bassRel: -12, chordMs: 2600, arpMs: 400, voiceType: 'triangle', arpType: 'sine', bassType: 'sine', vol: 0.045, filterHz: 2400 },
  civic:       { rootHz: 196, chordsRel: [[0,4,7], [-2,2,5], [-5,0,4], [-3,0,4]], arpRel: [0,4,7,12], bassRel: -12, chordMs: 2600, arpMs: 400, voiceType: 'triangle', arpType: 'sine', bassType: 'sine', vol: 0.045, filterHz: 2400 },
  // Frontier — sparse, wide, lonely
  frontier:    { rootHz: 146, chordsRel: [[0,7], [-5,2], [0,7,12]], arpRel: [0,12,7], bassRel: -12, chordMs: 3600, arpMs: 1200, voiceType: 'sine', arpType: 'sine', bassType: 'sine', vol: 0.035, filterHz: 1500 },
  // Arts — modal with shifting colour
  arts:        { rootHz: 220, chordsRel: [[0,4,7,9], [-2,2,5,9], [-5,0,4,7], [-3,0,4,7]], arpRel: [0,4,7,9,4,0], bassRel: -12, chordMs: 2200, arpMs: 280, voiceType: 'triangle', arpType: 'sine', bassType: 'sine', vol: 0.04, filterHz: 2800 },
  // Silent / hub — no music, just ambience
  silent:      { rootHz: 0,   chordsRel: [[0]], arpRel: [0], bassRel: 0, chordMs: 9999, arpMs: 9999, voiceType: 'sine', arpType: 'sine', bassType: 'sine', vol: 0, filterHz: 1000 },
};

interface MusicLayer {
  oscs:       OscillatorNode[];
  chordGain:  GainNode;
  arpGain:    GainNode;
  bassGain:   GainNode;
  filter:     BiquadFilterNode;
  busGain:    GainNode;
  chordTimer: ReturnType<typeof setInterval> | null;
  arpTimer:   ReturnType<typeof setInterval> | null;
  bassTimer:  ReturnType<typeof setInterval> | null;
  chordIdx:   number;
  arpIdx:     number;
  profile:    MusicProfile;
  district:   DistrictName;
}

export function useSoundscape(): SoundscapeAPI {
  return useContext(SoundscapeContext);
}

/* ── Web Audio helpers ──────────────────────────────────────────── */

function getOrCreateAudioContext(
  ref: React.MutableRefObject<AudioContext | null>,
  onCreate?: (ctx: AudioContext) => void,
): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const wasNew = !ref.current || ref.current.state === 'closed';
  if (wasNew) {
    try { ref.current = new AudioContext(); } catch { return null; }
    if (ref.current && onCreate) onCreate(ref.current);
  }
  if (ref.current && ref.current.state === 'suspended') {
    void resumeAudioContext(ref.current);
  }
  return ref.current;
}

function playToneSequence(ctx: AudioContext, def: SFXDef, masterGain: GainNode): void {
  const freqs = def.semitones
    ? def.semitones.map(s => def.freq * Math.pow(2, s / 12))
    : [def.freq];

  const now = ctx.currentTime;
  const stepDuration = def.duration / freqs.length;

  freqs.forEach((freq, i) => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type      = def.type;
    osc.frequency.setValueAtTime(freq, now + i * stepDuration);
    gain.gain.setValueAtTime(0, now + i * stepDuration);
    gain.gain.linearRampToValueAtTime(0.25, now + i * stepDuration + def.attack);
    gain.gain.linearRampToValueAtTime(0, now + i * stepDuration + def.decay);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now + i * stepDuration);
    osc.stop(now + i * stepDuration + def.decay + 0.05);
  });
}

/* ── Component ──────────────────────────────────────────────────── */

interface SoundscapeEngineProps {
  children?: React.ReactNode;
  initialDistrict?: string;
  initialTime?: TimeOfDay;
  playerPosition?: ListenerPosition;
  weatherOverride?: { type: string; intensity: number };
}

const WEATHER_TYPE_MAP: Record<string, WeatherType> = {
  clear: 'clear', overcast: 'clear', rain: 'rain', heavy_rain: 'rain',
  storm: 'storm', snow: 'snow', blizzard: 'snow', fog: 'clear', sandstorm: 'wind',
};

export default function SoundscapeEngine({
  children,
  initialDistrict = 'silent',
  initialTime = 'day',
  playerPosition,
  weatherOverride,
}: SoundscapeEngineProps) {
  const [state, setState] = useState<SoundscapeState>({
    currentDistrict: DISTRICT_ALIAS[initialDistrict.toLowerCase()] ?? 'silent',
    previousDistrict: null,
    timeOfDay: initialTime,
    isInterior: false,
    weather: 'clear',
    weatherIntensity: 0,
    crossfading: false,
  });

  useEffect(() => {
    if (!weatherOverride) return;
    const mapped = WEATHER_TYPE_MAP[weatherOverride.type] ?? 'clear';
    setState(prev => ({ ...prev, weather: mapped, weatherIntensity: weatherOverride.intensity }));
  }, [weatherOverride, weatherOverride?.type, weatherOverride?.intensity]);

  const crossfadeTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioCtxRef     = useRef<AudioContext | null>(null);
  const masterGainRef   = useRef<GainNode | null>(null);
  const droneOscRef     = useRef<OscillatorNode | null>(null);
  const droneGainRef    = useRef<GainNode | null>(null);
  const noiseGainRef    = useRef<GainNode | null>(null);
  const musicElRef      = useRef<HTMLAudioElement | null>(null);
  const weatherSrcRef   = useRef<AudioBufferSourceNode | null>(null);
  const weatherGainRef  = useRef<GainNode | null>(null);
  const weatherFilterRef = useRef<BiquadFilterNode | null>(null);
  const weatherRumbleRef = useRef<OscillatorNode | null>(null);
  const weatherRumbleGainRef = useRef<GainNode | null>(null);

  // SFX queued before AudioContext is unlocked. Flushed on statechange.
  // 2s TTL, 32-entry cap to prevent unbounded growth.
  const pendingSfxRef = useRef<Array<{
    sfxId: string;
    queuedAt: number;
    spatial?: { x: number; y: number; z: number };
  }>>([]);

  const flushPendingSfx = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state !== 'running' || !masterGainRef.current) return;
    const now = Date.now();
    const queue = pendingSfxRef.current;
    pendingSfxRef.current = [];
    for (const entry of queue) {
      if (now - entry.queuedAt > 2000) continue;
      const def = SFX_MAP[entry.sfxId];
      if (!def) continue;
      if (entry.spatial) playToneSpatial(ctx, def, masterGainRef.current, entry.spatial);
      else playToneSequence(ctx, def, masterGainRef.current);
    }
  }, []);

  // Lazy-init audio on first user gesture
  const initAudio = useCallback(() => {
    const ctx = getOrCreateAudioContext(audioCtxRef, (newCtx) => {
      newCtx.addEventListener('statechange', () => {
        if (newCtx.state === 'running') flushPendingSfx();
      });
    });
    if (!ctx) return null;
    if (!masterGainRef.current) {
      masterGainRef.current = ctx.createGain();
      masterGainRef.current.gain.setValueAtTime(0.6, ctx.currentTime);
      masterGainRef.current.connect(ctx.destination);
    }
    return ctx;
  }, [flushPendingSfx]);

  // Build district ambient drone whenever district changes
  useEffect(() => {
    const districtCfg = DISTRICT_AUDIO[state.currentDistrict] ?? DISTRICT_AUDIO.silent;
    if (districtCfg.volume === 0) {
      // Stop any existing drone
      try { droneOscRef.current?.stop(); } catch { /* already stopped */ }
      droneOscRef.current = null;
      if (droneGainRef.current) {
        droneGainRef.current.gain.setValueAtTime(0, audioCtxRef.current?.currentTime ?? 0);
      }
      return;
    }

    const ctx = initAudio();
    if (!ctx || !masterGainRef.current) return;

    // Stop previous drone
    const prevOsc = droneOscRef.current;
    const prevGain = droneGainRef.current;
    if (prevGain) {
      prevGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
    }
    setTimeout(() => { try { prevOsc?.stop(); } catch { /* ok */ } }, 600);

    // Time-of-day volume scale
    const timeScale: Record<TimeOfDay, number> = { dawn: 0.5, day: 1.0, dusk: 0.7, night: 0.3 };
    const interiorScale = state.isInterior ? 0.5 : 1.0;
    const targetVol = districtCfg.volume * (timeScale[state.timeOfDay] ?? 1) * interiorScale;

    // Start new drone oscillator
    if (districtCfg.freq > 0) {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = districtCfg.type;
      osc.frequency.setValueAtTime(districtCfg.freq, ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(targetVol * (1 - districtCfg.noise), ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(masterGainRef.current);
      osc.start();
      droneOscRef.current = osc;
      droneGainRef.current = gain;
    }

    // Noise layer
    if (districtCfg.noise > 0) {
      const bufferSize = ctx.sampleRate * 2;
      const buffer     = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data       = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = buffer;
      noiseSource.loop   = true;
      const filter = ctx.createBiquadFilter();
      filter.type            = 'bandpass';
      filter.frequency.value = districtCfg.freq || 400;
      filter.Q.value         = 0.5;
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0, ctx.currentTime);
      noiseGain.gain.linearRampToValueAtTime(targetVol * districtCfg.noise, ctx.currentTime + 0.5);
      noiseSource.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(masterGainRef.current);
      noiseSource.start();
      noiseGainRef.current = noiseGain;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentDistrict, state.timeOfDay, state.isInterior]);

  // Update Web Audio listener position when player moves (spatial audio)
  useEffect(() => {
    if (!playerPosition) return;
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state === 'closed') return;
    const { x, y, z, forwardX, forwardZ } = playerPosition;
    try {
      ctx.listener.positionX.setValueAtTime(x, ctx.currentTime);
      ctx.listener.positionY.setValueAtTime(y, ctx.currentTime);
      ctx.listener.positionZ.setValueAtTime(z, ctx.currentTime);
      ctx.listener.forwardX.setValueAtTime(forwardX, ctx.currentTime);
      ctx.listener.forwardY.setValueAtTime(0, ctx.currentTime);
      ctx.listener.forwardZ.setValueAtTime(forwardZ, ctx.currentTime);
      ctx.listener.upX.setValueAtTime(0, ctx.currentTime);
      ctx.listener.upY.setValueAtTime(1, ctx.currentTime);
      ctx.listener.upZ.setValueAtTime(0, ctx.currentTime);
    } catch { /* older Safari may not support AudioParam on listener */ }
  }, [playerPosition]);

  // Weather audio bridge: rain hiss + storm rumble + ducks district drone & music.
  // Storm/rain partially drown the district ambience; clear/wind reset to baseline.
  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state === 'closed' || !masterGainRef.current) return;

    const now = ctx.currentTime;
    const intensity = Math.max(0, Math.min(1, state.weatherIntensity || 0));
    const w = state.weather;

    // Master ducking: storm hard-ducks (~50%), rain mid-ducks, snow soft-ducks.
    const duckMap: Record<WeatherType, number> = {
      clear: 1.0, wind: 0.92, snow: 0.85, rain: 0.7, storm: 0.5,
    };
    const targetMaster = 0.6 * (1 - (1 - duckMap[w]) * intensity);
    try { masterGainRef.current.gain.linearRampToValueAtTime(targetMaster, now + 0.8); } catch { /* ok */ }

    // Music element ducking (HTMLAudioElement bypasses Web Audio gain unless routed).
    if (musicElRef.current) {
      const target = (w === 'storm' ? 0.35 : w === 'rain' ? 0.6 : 1.0);
      musicElRef.current.volume = Math.max(0, Math.min(1, 0.7 * (1 - (1 - target) * intensity)));
    }

    // Rain / snow noise layer.
    const wantsHiss = (w === 'rain' || w === 'storm' || w === 'snow' || w === 'wind') && intensity > 0.05;
    if (wantsHiss && !weatherSrcRef.current) {
      const bufSize = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      src.connect(filter); filter.connect(gain); gain.connect(masterGainRef.current);
      try { src.start(); } catch { /* ok */ }
      weatherSrcRef.current = src;
      weatherFilterRef.current = filter;
      weatherGainRef.current = gain;
    }
    if (weatherFilterRef.current && weatherGainRef.current) {
      const cutoff = w === 'snow' ? 6000 : w === 'wind' ? 800 : w === 'storm' ? 1200 : 2200;
      const vol = (w === 'storm' ? 0.18 : w === 'rain' ? 0.12 : w === 'snow' ? 0.05 : w === 'wind' ? 0.09 : 0) * intensity;
      try {
        weatherFilterRef.current.frequency.linearRampToValueAtTime(cutoff, now + 0.8);
        weatherGainRef.current.gain.linearRampToValueAtTime(vol, now + 0.8);
      } catch { /* ok */ }
    }

    // Storm rumble: low sub bass that pulses.
    const wantsRumble = w === 'storm' && intensity > 0.1;
    if (wantsRumble && !weatherRumbleRef.current) {
      const osc = ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.setValueAtTime(40, now);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      osc.connect(g); g.connect(masterGainRef.current);
      try { osc.start(); } catch { /* ok */ }
      weatherRumbleRef.current = osc;
      weatherRumbleGainRef.current = g;
    }
    if (weatherRumbleGainRef.current) {
      const vol = wantsRumble ? 0.08 * intensity : 0;
      try { weatherRumbleGainRef.current.gain.linearRampToValueAtTime(vol, now + 0.8); } catch { /* ok */ }
    }
  }, [state.weather, state.weatherIntensity]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try { droneOscRef.current?.stop(); } catch { /* ok */ }
      try { weatherSrcRef.current?.stop(); } catch { /* ok */ }
      try { weatherRumbleRef.current?.stop(); } catch { /* ok */ }
      musicElRef.current?.pause();
    };
  }, []);

  /* ── API ─────────────────────────────────────────────────────── */

  const setDistrict = useCallback((district: string) => {
    const target = DISTRICT_ALIAS[district.toLowerCase()] ?? 'silent';
    setState(prev => {
      if (target === prev.currentDistrict) return prev;
      if (crossfadeTimer.current) clearTimeout(crossfadeTimer.current);
      crossfadeTimer.current = setTimeout(() => {
        setState(p => ({ ...p, currentDistrict: target, previousDistrict: null, crossfading: false }));
      }, CROSSFADE_MS);
      return { ...prev, previousDistrict: prev.currentDistrict, crossfading: true };
    });
  }, []);

  const setTimeOfDay = useCallback((time: TimeOfDay) => {
    setState(prev => ({ ...prev, timeOfDay: time }));
  }, []);

  const setInterior = useCallback((interior: boolean) => {
    setState(prev => ({ ...prev, isInterior: interior }));
  }, []);

  const setWeather = useCallback((weather: WeatherType, intensity?: number) => {
    setState(prev => ({ ...prev, weather, weatherIntensity: intensity ?? 0.5 }));
  }, []);

  const enqueueSfx = useCallback((sfxId: string, spatial?: { x: number; y: number; z: number }) => {
    pendingSfxRef.current.push({ sfxId, queuedAt: Date.now(), spatial });
    if (pendingSfxRef.current.length > 32) pendingSfxRef.current.shift();
  }, []);

  const triggerSFX = useCallback((sfxId: string) => {
    // Layered SFX → schedule each atom with its delay
    const layers = LAYER_MAP[sfxId];
    if (layers) {
      const ctx = initAudio();
      if (!ctx || !masterGainRef.current || ctx.state !== 'running') {
        for (const step of layers) enqueueSfx(step.sfx);
        return;
      }
      for (const step of layers) {
        const def = SFX_MAP[step.sfx];
        if (!def) continue;
        if (step.delayMs <= 0) playToneSequence(ctx, def, masterGainRef.current);
        else setTimeout(() => {
          if (masterGainRef.current) playToneSequence(ctx, def, masterGainRef.current);
        }, step.delayMs);
      }
      return;
    }
    const def = SFX_MAP[sfxId];
    if (!def) return;
    const ctx = initAudio();
    if (!ctx || !masterGainRef.current || ctx.state !== 'running') {
      enqueueSfx(sfxId);
      return;
    }
    playToneSequence(ctx, def, masterGainRef.current);
  }, [initAudio, enqueueSfx]);

  const playSpatialSFX = useCallback((sfxId: string, worldPos: { x: number; y: number; z: number }) => {
    const layers = LAYER_MAP[sfxId];
    if (layers) {
      const ctx = initAudio();
      if (!ctx || !masterGainRef.current || ctx.state !== 'running') {
        for (const step of layers) enqueueSfx(step.sfx, worldPos);
        return;
      }
      for (const step of layers) {
        const def = SFX_MAP[step.sfx];
        if (!def) continue;
        if (step.delayMs <= 0) playToneSpatial(ctx, def, masterGainRef.current, worldPos);
        else setTimeout(() => {
          if (masterGainRef.current) playToneSpatial(ctx, def, masterGainRef.current, worldPos);
        }, step.delayMs);
      }
      return;
    }
    const def = SFX_MAP[sfxId];
    if (!def) return;
    const ctx = initAudio();
    if (!ctx || !masterGainRef.current || ctx.state !== 'running') {
      enqueueSfx(sfxId, worldPos);
      return;
    }
    playToneSpatial(ctx, def, masterGainRef.current, worldPos);
  }, [initAudio, enqueueSfx]);

  const playMusicTrack = useCallback((url: string) => {
    musicElRef.current?.pause();
    const el = new Audio(url);
    el.loop   = false;
    el.volume = 0.5;
    el.play().catch(() => {});
    musicElRef.current = el;
  }, []);

  const stopMusicTrack = useCallback(() => {
    musicElRef.current?.pause();
    musicElRef.current = null;
  }, []);

  // ── Procedural ambient music ────────────────────────────────────────────────
  const musicLayerRef    = useRef<MusicLayer | null>(null);
  const musicCombatRef   = useRef<number>(0);  // 0..1 duck intensity
  const musicCurrentDistrictRef = useRef<DistrictName | null>(null);

  function buildMusicLayer(ctx: AudioContext, master: GainNode, district: DistrictName): MusicLayer | null {
    const profile = MUSIC_PROFILES[district] ?? MUSIC_PROFILES.silent;
    if (profile.vol <= 0 || profile.rootHz <= 0) return null;
    const now = ctx.currentTime;

    // Bus chain: chord/arp/bass → busGain → lowpass filter → master
    const busGain = ctx.createGain();
    busGain.gain.setValueAtTime(0, now);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(profile.filterHz, now);
    busGain.connect(filter);
    filter.connect(master);

    const chordGain = ctx.createGain();
    chordGain.gain.setValueAtTime(profile.vol * 0.6, now);
    chordGain.connect(busGain);
    const arpGain = ctx.createGain();
    arpGain.gain.setValueAtTime(profile.vol * 0.35, now);
    arpGain.connect(busGain);
    const bassGain = ctx.createGain();
    bassGain.gain.setValueAtTime(profile.vol * 0.5, now);
    bassGain.connect(busGain);

    const layer: MusicLayer = {
      oscs: [], chordGain, arpGain, bassGain, filter, busGain,
      chordTimer: null, arpTimer: null, bassTimer: null,
      chordIdx: 0, arpIdx: 0, profile, district,
    };

    // Schedule one chord swell — fades in over 1s, holds, fades out before next
    const playChord = () => {
      const t = ctx.currentTime;
      const chord = profile.chordsRel[layer.chordIdx % profile.chordsRel.length];
      for (const semi of chord) {
        const osc = ctx.createOscillator();
        osc.type = profile.voiceType;
        const f = profile.rootHz * Math.pow(2, semi / 12);
        osc.frequency.setValueAtTime(f, t);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.4, t + 0.6);
        env.gain.linearRampToValueAtTime(0, t + (profile.chordMs / 1000));
        osc.connect(env);
        env.connect(chordGain);
        try { osc.start(t); osc.stop(t + (profile.chordMs / 1000) + 0.1); } catch { /* ok */ }
      }
      layer.chordIdx++;
    };
    const playArp = () => {
      const t = ctx.currentTime;
      const chord = profile.chordsRel[(layer.chordIdx - 1 + profile.chordsRel.length) % profile.chordsRel.length] || [0];
      const noteSemi = profile.arpRel[layer.arpIdx % profile.arpRel.length];
      // Add the current chord's root semitone offset so the arp tracks the chord change
      const harmonyRoot = chord[0] ?? 0;
      const f = profile.rootHz * Math.pow(2, (noteSemi + harmonyRoot) / 12);
      const osc = ctx.createOscillator();
      osc.type = profile.arpType;
      osc.frequency.setValueAtTime(f, t);
      const env = ctx.createGain();
      const dur = (profile.arpMs / 1000) * 0.9;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.5, t + 0.02);
      env.gain.linearRampToValueAtTime(0, t + dur);
      osc.connect(env);
      env.connect(arpGain);
      try { osc.start(t); osc.stop(t + dur + 0.05); } catch { /* ok */ }
      layer.arpIdx++;
    };
    const playBass = () => {
      const t = ctx.currentTime;
      const f = profile.rootHz * Math.pow(2, profile.bassRel / 12);
      const osc = ctx.createOscillator();
      osc.type = profile.bassType;
      osc.frequency.setValueAtTime(f, t);
      const env = ctx.createGain();
      const dur = (profile.chordMs / 1000) * 0.5;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.7, t + 0.05);
      env.gain.linearRampToValueAtTime(0, t + dur);
      osc.connect(env);
      env.connect(bassGain);
      try { osc.start(t); osc.stop(t + dur + 0.05); } catch { /* ok */ }
    };

    playChord();
    playArp();
    playBass();
    layer.chordTimer = setInterval(playChord, profile.chordMs);
    layer.arpTimer = setInterval(playArp, profile.arpMs);
    layer.bassTimer = setInterval(playBass, profile.chordMs);

    // Fade bus in
    busGain.gain.linearRampToValueAtTime(1.0, now + 1.5);

    return layer;
  }

  function disposeMusicLayer(ctx: AudioContext | null, layer: MusicLayer, fadeMs = 1500): void {
    if (!ctx || ctx.state === 'closed') return;
    const now = ctx.currentTime;
    try { layer.busGain.gain.linearRampToValueAtTime(0, now + fadeMs / 1000); } catch { /* ok */ }
    if (layer.chordTimer) clearInterval(layer.chordTimer);
    if (layer.arpTimer)   clearInterval(layer.arpTimer);
    if (layer.bassTimer)  clearInterval(layer.bassTimer);
    layer.chordTimer = layer.arpTimer = layer.bassTimer = null;
    setTimeout(() => {
      try { layer.busGain.disconnect(); } catch { /* ok */ }
      try { layer.filter.disconnect(); } catch { /* ok */ }
    }, fadeMs + 100);
  }

  const setMusicDistrict = useCallback((district: string) => {
    const ctx = initAudio();
    if (!ctx || !masterGainRef.current) return;
    const target = DISTRICT_ALIAS[district.toLowerCase()] ?? 'silent';
    if (musicCurrentDistrictRef.current === target) return;
    musicCurrentDistrictRef.current = target;

    const prev = musicLayerRef.current;
    if (prev) disposeMusicLayer(ctx, prev, 1500);

    const next = buildMusicLayer(ctx, masterGainRef.current, target);
    musicLayerRef.current = next;
    // Restore current combat duck so a district switch doesn't undo the duck
    if (next && musicCombatRef.current > 0) {
      const target = 1 - 0.65 * musicCombatRef.current;
      try { next.busGain.gain.linearRampToValueAtTime(target, ctx.currentTime + 0.4); } catch { /* ok */ }
    }
  }, [initAudio]);

  const setMusicCombatIntensity = useCallback((intensity: number) => {
    const clamped = Math.max(0, Math.min(1, intensity));
    musicCombatRef.current = clamped;
    const ctx = audioCtxRef.current;
    const layer = musicLayerRef.current;
    if (!ctx || !layer || ctx.state === 'closed') return;
    // 0 → 1.0 (full), 1 → 0.35 (heavy duck)
    const target = 1 - 0.65 * clamped;
    try {
      layer.busGain.gain.linearRampToValueAtTime(target, ctx.currentTime + (clamped > 0 ? 0.25 : 1.5));
    } catch { /* ok */ }
  }, []);

  const api: SoundscapeAPI = {
    setDistrict, setTimeOfDay, setInterior, setWeather,
    triggerSFX, playSpatialSFX, playMusicTrack, stopMusicTrack,
    setMusicDistrict, setMusicCombatIntensity,
  };

  // Allow any sibling or parent component to call SoundscapeEngine APIs via
  // window events — avoids requiring everything to live inside this provider.
  useEffect(() => {
    const handler = (e: Event) => {
      const { action, district, time, interior, weather, intensity, sfxId, position } =
        (e as CustomEvent).detail ?? {};
      if (action === 'setDistrict' && district) setDistrict(district);
      else if (action === 'setTimeOfDay' && time) setTimeOfDay(time);
      else if (action === 'setInterior' && typeof interior === 'boolean') setInterior(interior);
      else if (action === 'setWeather' && weather) setWeather(weather, intensity);
      else if (action === 'triggerSFX' && sfxId) triggerSFX(sfxId);
      // Phase 14: spatial SFX dispatch from anywhere in the app via the same
      // window event channel. Position is { x, y, z } in world space.
      else if (action === 'playSpatialSFX' && sfxId && position) playSpatialSFX(sfxId, position);
      // Polish: per-district procedural music with crossfade + combat duck
      else if (action === 'setMusicDistrict' && district) setMusicDistrict(district);
      else if (action === 'setMusicCombatIntensity' && typeof intensity === 'number') setMusicCombatIntensity(intensity);
    };
    window.addEventListener('concordia:soundscape-command', handler);

    // Phase 15: dynamic ambient ducking on combat events. The ambient
    // drone fades to ~30% during sustained combat and back up after a
    // 3s quiet period. Re-firing extends the duck window — no thrash.
    let duckExpireTimer: ReturnType<typeof setTimeout> | null = null;
    const baseGain = 1.0;
    const duckGain = 0.30;
    const ramp = 0.25; // seconds

    const fadeDroneTo = (target: number, rampSec: number) => {
      const ctx = audioCtxRef.current;
      const drone = droneGainRef.current;
      if (!ctx || !drone) return;
      const now = ctx.currentTime;
      drone.gain.cancelScheduledValues(now);
      drone.gain.setTargetAtTime(target, now, rampSec / 3); // setTargetAtTime time-constant ≈ 63% in tau
    };

    const combatHandler = () => {
      fadeDroneTo(duckGain, ramp);
      if (duckExpireTimer) clearTimeout(duckExpireTimer);
      duckExpireTimer = setTimeout(() => {
        fadeDroneTo(baseGain, ramp * 2);
        duckExpireTimer = null;
      }, 3000);
    };
    window.addEventListener('concordia:hit-reaction', combatHandler);
    window.addEventListener('concordia:death-collapse', combatHandler);

    // Phase 16 → Phase 15 follow-up: duck the master mix during NPC dialogue
    // so SFX don't drown out the speech. Drops master to ~50% on
    // dialogue-active, restores on dialogue-ended.
    const dialogueDuckGain = 0.50;
    const dialogueOnHandler = () => {
      const ctx = audioCtxRef.current;
      const master = masterGainRef.current;
      if (!ctx || !master) return;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(dialogueDuckGain, ctx.currentTime, 0.08);
    };
    const dialogueOffHandler = () => {
      const ctx = audioCtxRef.current;
      const master = masterGainRef.current;
      if (!ctx || !master) return;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0.6, ctx.currentTime, 0.20); // 0.6 = the master init value at line 275
    };
    window.addEventListener('concordia:dialogue-active', dialogueOnHandler);
    window.addEventListener('concordia:dialogue-ended', dialogueOffHandler);

    return () => {
      window.removeEventListener('concordia:soundscape-command', handler);
      window.removeEventListener('concordia:hit-reaction', combatHandler);
      window.removeEventListener('concordia:death-collapse', combatHandler);
      window.removeEventListener('concordia:dialogue-active', dialogueOnHandler);
      window.removeEventListener('concordia:dialogue-ended', dialogueOffHandler);
      if (duckExpireTimer) clearTimeout(duckExpireTimer);
    };
  }, [setDistrict, setTimeOfDay, setInterior, setWeather, triggerSFX, playSpatialSFX, setMusicDistrict, setMusicCombatIntensity]);

  return (
    <SoundscapeContext.Provider value={api}>
      {children}
    </SoundscapeContext.Provider>
  );
}
