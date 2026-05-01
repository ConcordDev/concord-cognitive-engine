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
  // combat impacts — layered tones for percussive weight
  'hit-light':         { freq: 140,  type: 'triangle', duration: 0.18, attack: 0.001, decay: 0.16 },
  'hit-heavy':         { freq: 70,   type: 'sawtooth', duration: 0.28, attack: 0.001, decay: 0.26, semitones: [0, -5] },
  'hit-crit':          { freq: 260,  type: 'square',   duration: 0.32, attack: 0.001, decay: 0.28, semitones: [0, -7, 12] },
  'dodge-whoosh':      { freq: 700,  type: 'sine',     duration: 0.14, attack: 0.001, decay: 0.12 },
  'block-clang':       { freq: 110,  type: 'square',   duration: 0.22, attack: 0.001, decay: 0.20, semitones: [0, 7] },
  'kill-blow':         { freq: 55,   type: 'sawtooth', duration: 0.55, attack: 0.001, decay: 0.50, semitones: [0, -12] },
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
});

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
  }, [weatherOverride?.type, weatherOverride?.intensity]);

  const crossfadeTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioCtxRef     = useRef<AudioContext | null>(null);
  const masterGainRef   = useRef<GainNode | null>(null);
  const droneOscRef     = useRef<OscillatorNode | null>(null);
  const droneGainRef    = useRef<GainNode | null>(null);
  const noiseGainRef    = useRef<GainNode | null>(null);
  const musicElRef      = useRef<HTMLAudioElement | null>(null);

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try { droneOscRef.current?.stop(); } catch { /* ok */ }
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

  const api: SoundscapeAPI = {
    setDistrict, setTimeOfDay, setInterior, setWeather,
    triggerSFX, playSpatialSFX, playMusicTrack, stopMusicTrack,
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

    return () => {
      window.removeEventListener('concordia:soundscape-command', handler);
      window.removeEventListener('concordia:hit-reaction', combatHandler);
      window.removeEventListener('concordia:death-collapse', combatHandler);
      if (duckExpireTimer) clearTimeout(duckExpireTimer);
    };
  }, [setDistrict, setTimeOfDay, setInterior, setWeather, triggerSFX, playSpatialSFX]);

  return (
    <SoundscapeContext.Provider value={api}>
      {children}
    </SoundscapeContext.Provider>
  );
}
