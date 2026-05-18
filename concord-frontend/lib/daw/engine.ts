/**
 * DAW Audio Engine — Core synthesis, transport, and audio graph management
 * Built on Web Audio API concepts (Tone.js-compatible interface)
 * Runs entirely in-browser with no external audio dependencies
 */

import type {
  TransportConfig,
  TransportState,
  EffectInstance,
  SynthPreset,
} from './types';
import { resumeAudioContext as resumeCtx } from '../audio/unlock';

// ============================================================================
// Audio Context Singleton
// ============================================================================

let audioContext: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new AudioContext({ sampleRate: 44100 });
  }
  return audioContext;
}

export async function resumeAudioContext(): Promise<void> {
  await resumeCtx(getAudioContext());
}

// ============================================================================
// Transport Engine
// ============================================================================

export type ClipQuantization = 'none' | '1' | '1/2' | '1/4' | '1/8' | '1/16';

export interface LaunchedClip {
  trackId: string;
  clipId: string;
  launchBeat: number;     // wall-clock-beat the clip *will* start at
  scheduledAt: number;    // when the launch was queued
  quantization: ClipQuantization;
}

export class TransportEngine {
  private config: TransportConfig;
  private state: TransportState = 'stopped';
  private startTime: number = 0;
  private pauseTime: number = 0;
  private schedulerTimer: number | null = null;
  private lookAhead: number = 0.1; // seconds
  private scheduleInterval: number = 25; // ms
  private listeners: Map<string, Set<(data: Record<string, unknown>) => void>> = new Map();
  private _currentBeat: number = 0;
  private queuedClips: Map<string, LaunchedClip> = new Map(); // key = `${trackId}:${clipId}`
  private playingClips: Map<string, LaunchedClip> = new Map();

  constructor(config: Partial<TransportConfig> = {}) {
    this.config = {
      bpm: config.bpm ?? 120,
      timeSignature: config.timeSignature ?? [4, 4],
      swing: config.swing ?? 0,
      loopEnabled: config.loopEnabled ?? false,
      loopStart: config.loopStart ?? 0,
      loopEnd: config.loopEnd ?? 16,
      metronome: config.metronome ?? false,
      preRoll: config.preRoll ?? 0,
    };
  }

  get bpm(): number { return this.config.bpm; }
  set bpm(value: number) { this.config.bpm = Math.max(20, Math.min(400, value)); }

  get currentBeat(): number {
    if (this.state === 'stopped') return 0;
    if (this.state === 'paused') return this._currentBeat;
    const ctx = getAudioContext();
    const elapsed = ctx.currentTime - this.startTime;
    const beat = (elapsed * this.config.bpm) / 60;
    if (this.config.loopEnabled && beat >= this.config.loopEnd) {
      const loopLen = this.config.loopEnd - this.config.loopStart;
      return this.config.loopStart + ((beat - this.config.loopStart) % loopLen);
    }
    return beat;
  }

  get transportState(): TransportState { return this.state; }

  beatsToSeconds(beats: number): number {
    return (beats * 60) / this.config.bpm;
  }

  secondsToBeats(seconds: number): number {
    return (seconds * this.config.bpm) / 60;
  }

  play(): void {
    if (this.state === 'playing') return;
    resumeAudioContext();
    const ctx = getAudioContext();
    if (this.state === 'paused') {
      this.startTime = ctx.currentTime - this.beatsToSeconds(this._currentBeat);
    } else {
      this.startTime = ctx.currentTime;
    }
    this.state = 'playing';
    this.startScheduler();
    this.emit('stateChange', { state: 'playing' });
  }

  pause(): void {
    if (this.state !== 'playing' && this.state !== 'recording') return;
    this._currentBeat = this.currentBeat;
    this.state = 'paused';
    this.stopScheduler();
    this.emit('stateChange', { state: 'paused' });
  }

  stop(): void {
    this.state = 'stopped';
    this._currentBeat = 0;
    this.stopScheduler();
    this.emit('stateChange', { state: 'stopped' });
    this.emit('beatChange', { beat: 0 });
  }

  record(): void {
    if (this.state === 'recording') return;
    resumeAudioContext();
    const ctx = getAudioContext();
    this.startTime = ctx.currentTime - this.beatsToSeconds(this._currentBeat);
    this.state = 'recording';
    this.startScheduler();
    this.emit('stateChange', { state: 'recording' });
  }

  seekTo(beat: number): void {
    this._currentBeat = beat;
    if (this.state === 'playing' || this.state === 'recording') {
      const ctx = getAudioContext();
      this.startTime = ctx.currentTime - this.beatsToSeconds(beat);
    }
    this.emit('beatChange', { beat });
  }

  setLoop(start: number, end: number): void {
    this.config.loopStart = start;
    this.config.loopEnd = end;
    this.config.loopEnabled = true;
  }

  disableLoop(): void {
    this.config.loopEnabled = false;
  }

  updateConfig(partial: Partial<TransportConfig>): void {
    Object.assign(this.config, partial);
    this.emit('configChange', { config: { ...this.config } });
  }

  getConfig(): TransportConfig {
    return { ...this.config };
  }

  on(event: string, callback: (data: Record<string, unknown>) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }

  private emit(event: string, data: Record<string, unknown>): void {
    this.listeners.get(event)?.forEach(cb => cb(data));
  }

  private startScheduler(): void {
    this.stopScheduler();
    let lastBeat = -1;
    const tick = () => {
      const beat = this.currentBeat;
      const intBeat = Math.floor(beat * 4) / 4; // quantize to 16th notes
      if (intBeat !== lastBeat) {
        lastBeat = intBeat;
        this.emit('beatChange', { beat });
        if (this.config.metronome && beat % 1 < 0.01) {
          this.playMetronomeClick(beat % this.config.timeSignature[0] < 0.01);
        }
      }
      // Promote queued clips whose launchBeat has been reached.
      // We iterate explicitly so we can mutate the map.
      if (this.queuedClips.size > 0) {
        for (const [key, qc] of this.queuedClips) {
          if (beat >= qc.launchBeat) {
            this.queuedClips.delete(key);
            this.playingClips.set(key, { ...qc, launchBeat: beat });
            this.emit('clipLaunched', { trackId: qc.trackId, clipId: qc.clipId, beat });
          }
        }
      }
      this.schedulerTimer = window.setTimeout(tick, this.scheduleInterval);
    };
    tick();
  }

  /**
   * Ableton-style clip launch: queues the clip to start at the next
   * boundary defined by `quantization` ('1' = next bar, '1/4' = next
   * beat, 'none' = immediate). Transport is auto-started if stopped so
   * launching the first clip plays the project.
   */
  launchClip(trackId: string, clipId: string, quantization: ClipQuantization = '1'): LaunchedClip {
    if (this.state === 'stopped' || this.state === 'paused') {
      this.play();
    }
    const now = this.currentBeat;
    const launchBeat = this.computeLaunchBeat(now, quantization);
    const key = `${trackId}:${clipId}`;
    const launched: LaunchedClip = {
      trackId, clipId, launchBeat,
      scheduledAt: getAudioContext().currentTime,
      quantization,
    };
    if (launchBeat <= now + 1e-6) {
      // Immediate or already-past boundary: fire now.
      this.playingClips.set(key, launched);
      this.emit('clipLaunched', { trackId, clipId, beat: now });
    } else {
      this.queuedClips.set(key, launched);
      this.emit('clipQueued', { trackId, clipId, launchBeat });
    }
    return launched;
  }

  /** Cancel a pending or playing clip. Returns true if anything was cancelled. */
  stopClip(trackId: string, clipId: string): boolean {
    const key = `${trackId}:${clipId}`;
    const wasQueued = this.queuedClips.delete(key);
    const wasPlaying = this.playingClips.delete(key);
    if (wasQueued || wasPlaying) {
      this.emit('clipStopped', { trackId, clipId });
    }
    return wasQueued || wasPlaying;
  }

  /** Stop every queued + playing clip. Does not stop the transport. */
  stopAllClips(): void {
    if (this.queuedClips.size === 0 && this.playingClips.size === 0) return;
    this.queuedClips.clear();
    this.playingClips.clear();
    this.emit('allClipsStopped', {});
  }

  getQueuedClips(): LaunchedClip[] { return [...this.queuedClips.values()]; }
  getPlayingClips(): LaunchedClip[] { return [...this.playingClips.values()]; }

  /**
   * Round `now` up to the next boundary in the chosen subdivision.
   * `none` returns `now` (launch immediately).
   */
  private computeLaunchBeat(now: number, quantization: ClipQuantization): number {
    if (quantization === 'none') return now;
    const beatsPerBar = this.config.timeSignature[0];
    const step = quantization === '1' ? beatsPerBar
      : quantization === '1/2' ? beatsPerBar / 2
      : quantization === '1/4' ? 1
      : quantization === '1/8' ? 0.5
      : 0.25;
    if (step <= 0) return now;
    return Math.ceil((now + 1e-6) / step) * step;
  }

  private stopScheduler(): void {
    if (this.schedulerTimer !== null) {
      clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  private playMetronomeClick(accent: boolean): void {
    try {
      const ctx = getAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = accent ? 1000 : 800;
      gain.gain.value = accent ? 0.15 : 0.08;
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.05);
    } catch {
      // Audio context may not be ready
    }
  }

  dispose(): void {
    this.stopScheduler();
    this.listeners.clear();
  }
}

// ============================================================================
// Synthesizer Engine
// ============================================================================

export class SynthEngine {
  private ctx: AudioContext;
  private outputNode: GainNode;
  private activeVoices: Map<number, { oscillators: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode }> = new Map();
  private preset: SynthPreset;

  constructor(preset: SynthPreset) {
    this.ctx = getAudioContext();
    this.outputNode = this.ctx.createGain();
    this.outputNode.gain.value = 0.5;
    this.outputNode.connect(this.ctx.destination);
    this.preset = preset;
  }

  connect(destination: AudioNode): void {
    this.outputNode.disconnect();
    this.outputNode.connect(destination);
  }

  noteOn(note: number, velocity: number = 100, time?: number): void {
    const t = time ?? this.ctx.currentTime;
    const freq = 440 * Math.pow(2, (note - 69) / 12);
    const vel = velocity / 127;

    const voiceGain = this.ctx.createGain();
    voiceGain.gain.value = 0;

    const filter = this.ctx.createBiquadFilter();
    filter.type = (this.preset.filter?.type as BiquadFilterType) || 'lowpass';
    filter.frequency.value = this.preset.filter?.frequency ?? 8000;
    filter.Q.value = this.preset.filter?.resonance ?? 1;

    const oscillators: OscillatorNode[] = [];

    for (const oscParams of this.preset.oscillators) {
      const osc = this.ctx.createOscillator();
      const shape = oscParams.shape === 'pulse' || oscParams.shape === 'pwm' || oscParams.shape === 'noise'
        ? 'square' : oscParams.shape;
      osc.type = shape;
      osc.frequency.value = freq * Math.pow(2, oscParams.octave || 0);
      osc.detune.value = oscParams.detune || 0;

      const oscGain = this.ctx.createGain();
      oscGain.gain.value = (oscParams.level ?? 1) * vel;

      osc.connect(oscGain).connect(filter);
      osc.start(t);
      oscillators.push(osc);
    }

    filter.connect(voiceGain).connect(this.outputNode);

    // Amp envelope
    const env = this.preset.ampEnvelope;
    voiceGain.gain.setValueAtTime(0, t);
    voiceGain.gain.linearRampToValueAtTime(vel, t + (env?.attack ?? 0.01));
    voiceGain.gain.linearRampToValueAtTime(
      vel * (env?.sustain ?? 0.7),
      t + (env?.attack ?? 0.01) + (env?.decay ?? 0.1)
    );

    // Filter envelope
    if (this.preset.filterEnvelope) {
      const fEnv = this.preset.filterEnvelope;
      const baseFreq = this.preset.filter?.frequency ?? 8000;
      const envAmount = this.preset.filter?.envelope ?? 0;
      filter.frequency.setValueAtTime(baseFreq, t);
      filter.frequency.linearRampToValueAtTime(
        baseFreq + envAmount * 4000,
        t + (fEnv.attack ?? 0.01)
      );
      filter.frequency.linearRampToValueAtTime(
        baseFreq + envAmount * 4000 * (fEnv.sustain ?? 0.5),
        t + (fEnv.attack ?? 0.01) + (fEnv.decay ?? 0.1)
      );
    }

    this.activeVoices.set(note, { oscillators, gain: voiceGain, filter });
  }

  noteOff(note: number, time?: number): void {
    const t = time ?? this.ctx.currentTime;
    const voice = this.activeVoices.get(note);
    if (!voice) return;

    const release = this.preset.ampEnvelope?.release ?? 0.3;
    voice.gain.gain.cancelScheduledValues(t);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, t);
    voice.gain.gain.linearRampToValueAtTime(0, t + release);

    voice.oscillators.forEach(osc => {
      try { osc.stop(t + release + 0.01); } catch { /* already stopped */ }
    });

    setTimeout(() => {
      this.activeVoices.delete(note);
    }, (release + 0.1) * 1000);
  }

  allNotesOff(): void {
    for (const [note] of this.activeVoices) {
      this.noteOff(note);
    }
  }

  updatePreset(preset: SynthPreset): void {
    this.preset = preset;
  }

  dispose(): void {
    this.allNotesOff();
    this.outputNode.disconnect();
  }
}

// ============================================================================
// Drum Machine Engine
// ============================================================================

export class DrumMachineEngine {
  private ctx: AudioContext;
  private outputNode: GainNode;
  private buffers: Map<string, AudioBuffer> = new Map();

  constructor() {
    this.ctx = getAudioContext();
    this.outputNode = this.ctx.createGain();
    this.outputNode.gain.value = 0.8;
    this.outputNode.connect(this.ctx.destination);
  }

  connect(destination: AudioNode): void {
    this.outputNode.disconnect();
    this.outputNode.connect(destination);
  }

  async loadSample(padId: string, url: string): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      this.buffers.set(padId, audioBuffer);
    } catch (e) {
      console.warn(`Failed to load drum sample ${padId}:`, e);
    }
  }

  triggerPad(padId: string, velocity: number = 100, time?: number): void {
    const t = time ?? this.ctx.currentTime;
    const buffer = this.buffers.get(padId);
    if (buffer) {
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      const gain = this.ctx.createGain();
      gain.gain.value = velocity / 127;
      source.connect(gain).connect(this.outputNode);
      source.start(t);
    } else {
      // Synthesize basic drum sound
      this.synthesizeDrum(padId, velocity, t);
    }
  }

  private synthesizeDrum(padId: string, velocity: number, time: number): void {
    const vel = velocity / 127;
    const padIndex = parseInt(padId.replace(/\D/g, ''), 10) || 0;

    if (padIndex % 4 === 0) {
      // Kick
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.frequency.setValueAtTime(150, time);
      osc.frequency.exponentialRampToValueAtTime(30, time + 0.15);
      gain.gain.setValueAtTime(vel * 0.8, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
      osc.connect(gain).connect(this.outputNode);
      osc.start(time);
      osc.stop(time + 0.3);
    } else if (padIndex % 4 === 1) {
      // Snare
      const noise = this.createNoiseSource(time, 0.15);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const noiseGain = this.ctx.createGain();
      osc.frequency.value = 200;
      gain.gain.setValueAtTime(vel * 0.4, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
      noiseGain.gain.setValueAtTime(vel * 0.5, time);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
      osc.connect(gain).connect(this.outputNode);
      noise.connect(noiseGain).connect(this.outputNode);
      osc.start(time);
      osc.stop(time + 0.1);
    } else if (padIndex % 4 === 2) {
      // Hi-hat
      const noise = this.createNoiseSource(time, 0.08);
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 8000;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(vel * 0.3, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
      noise.connect(filter).connect(gain).connect(this.outputNode);
    } else {
      // Clap / other
      const noise = this.createNoiseSource(time, 0.12);
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 2000;
      filter.Q.value = 2;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(vel * 0.4, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
      noise.connect(filter).connect(gain).connect(this.outputNode);
    }
  }

  private createNoiseSource(time: number, duration: number): AudioBufferSourceNode {
    const bufferSize = Math.ceil(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.start(time);
    source.stop(time + duration);
    return source;
  }

  dispose(): void {
    this.outputNode.disconnect();
    this.buffers.clear();
  }
}

// ============================================================================
// Effects Engine
// ============================================================================

export class EffectsChainEngine {
  private ctx: AudioContext;
  private inputNode: GainNode;
  private outputNode: GainNode;
  private effectNodes: AudioNode[] = [];

  constructor() {
    this.ctx = getAudioContext();
    this.inputNode = this.ctx.createGain();
    this.outputNode = this.ctx.createGain();
    this.inputNode.connect(this.outputNode);
  }

  get input(): GainNode { return this.inputNode; }
  get output(): GainNode { return this.outputNode; }

  applyEffects(effects: EffectInstance[]): void {
    // Disconnect existing chain
    this.inputNode.disconnect();
    this.effectNodes.forEach(node => {
      try { node.disconnect(); } catch { /* already disconnected */ }
    });
    this.effectNodes = [];

    if (effects.length === 0 || effects.every(e => !e.enabled)) {
      this.inputNode.connect(this.outputNode);
      return;
    }

    let lastNode: AudioNode = this.inputNode;
    for (const effect of effects) {
      if (!effect.enabled) continue;
      const node = this.createEffectNode(effect);
      if (node) {
        lastNode.connect(node);
        lastNode = node;
        this.effectNodes.push(node);
      }
    }
    lastNode.connect(this.outputNode);
  }

  private createEffectNode(effect: EffectInstance): AudioNode | null {
    switch (effect.type) {
      case 'eq3':
      case 'eq8':
      case 'parametricEQ':
        return this.createEQ(effect);
      case 'compressor':
        return this.createCompressor(effect);
      case 'limiter':
        return this.createLimiter(effect);
      case 'reverb':
        return this.createReverb(effect);
      case 'delay':
      case 'pingPongDelay':
        return this.createDelay(effect);
      case 'distortion':
      case 'overdrive':
        return this.createDistortion(effect);
      case 'chorus':
      case 'flanger':
        return this.createChorus(effect);
      case 'filter':
      case 'autoFilter':
        return this.createFilter(effect);
      case 'gate':
        return this.createGate(effect);
      case 'stereoWidener':
        return this.createStereoWidener(effect);
      default:
        return null;
    }
  }

  private createEQ(effect: EffectInstance): AudioNode {
    const low = this.ctx.createBiquadFilter();
    low.type = 'lowshelf';
    low.frequency.value = Number(effect.params.lowFreq) || 320;
    low.gain.value = Number(effect.params.lowGain) || 0;

    const mid = this.ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = Number(effect.params.midFreq) || 1000;
    mid.Q.value = Number(effect.params.midQ) || 1;
    mid.gain.value = Number(effect.params.midGain) || 0;

    const high = this.ctx.createBiquadFilter();
    high.type = 'highshelf';
    high.frequency.value = Number(effect.params.highFreq) || 3200;
    high.gain.value = Number(effect.params.highGain) || 0;

    low.connect(mid).connect(high);
    return low;
  }

  private createCompressor(effect: EffectInstance): DynamicsCompressorNode {
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = Number(effect.params.threshold) || -24;
    comp.ratio.value = Number(effect.params.ratio) || 4;
    comp.attack.value = Number(effect.params.attack) || 0.003;
    comp.release.value = Number(effect.params.release) || 0.25;
    comp.knee.value = Number(effect.params.knee) || 30;
    return comp;
  }

  private createLimiter(effect: EffectInstance): DynamicsCompressorNode {
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = Number(effect.params.ceiling) || -1;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = Number(effect.params.release) || 0.1;
    limiter.knee.value = 0;
    return limiter;
  }

  private createReverb(effect: EffectInstance): ConvolverNode {
    const convolver = this.ctx.createConvolver();
    const decay = Number(effect.params.decay) || 2;
    const sampleRate = this.ctx.sampleRate;
    const length = sampleRate * decay;
    const impulse = this.ctx.createBuffer(2, length, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
      }
    }
    convolver.buffer = impulse;
    return convolver;
  }

  private createDelay(effect: EffectInstance): DelayNode {
    const delay = this.ctx.createDelay(5);
    delay.delayTime.value = Number(effect.params.time) || 0.3;
    const feedback = this.ctx.createGain();
    feedback.gain.value = Number(effect.params.feedback) || 0.3;
    delay.connect(feedback).connect(delay);
    return delay;
  }

  private createDistortion(effect: EffectInstance): WaveShaperNode {
    const shaper = this.ctx.createWaveShaper();
    const amount = Number(effect.params.amount) || 50;
    const samples = 44100;
    const curve = new Float32Array(samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
    }
    shaper.curve = curve;
    shaper.oversample = '4x';
    return shaper;
  }

  private createChorus(_effect: EffectInstance): AudioNode {
    const delay = this.ctx.createDelay(0.05);
    delay.delayTime.value = 0.01;
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 1.5;
    lfoGain.gain.value = 0.003;
    lfo.connect(lfoGain).connect(delay.delayTime);
    lfo.start();
    return delay;
  }

  private createFilter(effect: EffectInstance): BiquadFilterNode {
    const filter = this.ctx.createBiquadFilter();
    filter.type = (String(effect.params.type) as BiquadFilterType) || 'lowpass';
    filter.frequency.value = Number(effect.params.frequency) || 1000;
    filter.Q.value = Number(effect.params.resonance) || 1;
    return filter;
  }

  private createGate(_effect: EffectInstance): GainNode {
    // Simplified gate - just a gain node
    const gate = this.ctx.createGain();
    gate.gain.value = 1;
    return gate;
  }

  private createStereoWidener(_effect: EffectInstance): GainNode {
    // Simplified stereo widener
    const gain = this.ctx.createGain();
    gain.gain.value = 1;
    return gain;
  }

  dispose(): void {
    this.inputNode.disconnect();
    this.effectNodes.forEach(node => {
      try { node.disconnect(); } catch { /* ok */ }
    });
    this.outputNode.disconnect();
  }
}

// ============================================================================
// Mixer Engine
// ============================================================================

/**
 * Per-channel meter node. A small AnalyserNode tapped off the post-
 * effects output so MixerPeekStrip can read real-time RMS without
 * fighting for the master analyser. fftSize 256 → 128 freq bins;
 * cheap to read every animation frame even with 32+ tracks.
 */
class ChannelMeter {
  private analyser: AnalyserNode;
  private bufferLength: number;
  constructor(ctx: AudioContext, source: AudioNode) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.bufferLength = this.analyser.frequencyBinCount;
    source.connect(this.analyser);
    // NOTE: analyser is a passive tap — don't connect downstream.
  }
  /** RMS amplitude 0..1 from the current time-domain buffer. */
  getLevel(): number {
    const data = new Uint8Array(this.bufferLength);
    this.analyser.getByteTimeDomainData(data);
    let sumSq = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128; // -1..1
      sumSq += v * v;
    }
    return Math.sqrt(sumSq / data.length);
  }
  dispose(): void {
    try { this.analyser.disconnect(); } catch { /* already gone */ }
  }
}

export class MixerEngine {
  private ctx: AudioContext;
  private channelNodes: Map<string, { gain: GainNode; panner: StereoPannerNode; effectsChain: EffectsChainEngine; meter: ChannelMeter }> = new Map();
  private masterGain: GainNode;
  private masterEffects: EffectsChainEngine;
  private analyser: AnalyserNode;

  constructor() {
    this.ctx = getAudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterEffects = new EffectsChainEngine();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.masterGain.connect(this.masterEffects.input);
    this.masterEffects.output.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }

  addChannel(trackId: string): { input: AudioNode } {
    const gain = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();
    const effectsChain = new EffectsChainEngine();

    gain.connect(panner).connect(effectsChain.input);
    effectsChain.output.connect(this.masterGain);
    // Passive per-track meter tap (post-effects, pre-master).
    const meter = new ChannelMeter(this.ctx, effectsChain.output);

    this.channelNodes.set(trackId, { gain, panner, effectsChain, meter });
    return { input: gain };
  }

  /** RMS level 0..1 for a track's output. Returns 0 when the channel
   *  isn't initialized. Cheap (single fft snapshot). */
  getTrackLevel(trackId: string): number {
    const ch = this.channelNodes.get(trackId);
    if (!ch) return 0;
    return ch.meter.getLevel();
  }

  /** All track levels in one shot. Used by MixerPeekStrip's RAF loop. */
  getAllTrackLevels(): Record<string, number> {
    const out: Record<string, number> = {};
    this.channelNodes.forEach((ch, id) => { out[id] = ch.meter.getLevel(); });
    return out;
  }

  removeChannel(trackId: string): void {
    const channel = this.channelNodes.get(trackId);
    if (channel) {
      channel.gain.disconnect();
      channel.effectsChain.dispose();
      channel.meter.dispose();
      this.channelNodes.delete(trackId);
    }
  }

  setVolume(trackId: string, db: number): void {
    const channel = this.channelNodes.get(trackId);
    if (channel) {
      channel.gain.gain.value = Math.pow(10, db / 20);
    }
  }

  setPan(trackId: string, value: number): void {
    const channel = this.channelNodes.get(trackId);
    if (channel) {
      channel.panner.pan.value = Math.max(-1, Math.min(1, value));
    }
  }

  setMute(trackId: string, muted: boolean): void {
    const channel = this.channelNodes.get(trackId);
    if (channel) {
      channel.gain.gain.value = muted ? 0 : 1;
    }
  }

  setMasterVolume(db: number): void {
    this.masterGain.gain.value = Math.pow(10, db / 20);
  }

  setChannelEffects(trackId: string, effects: EffectInstance[]): void {
    const channel = this.channelNodes.get(trackId);
    if (channel) {
      channel.effectsChain.applyEffects(effects);
    }
  }

  setMasterEffects(effects: EffectInstance[]): void {
    this.masterEffects.applyEffects(effects);
  }

  getMasterAnalyserData(): Uint8Array {
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    return data;
  }

  getMasterWaveformData(): Uint8Array {
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    return data;
  }

  getChannelInput(trackId: string): AudioNode | null {
    return this.channelNodes.get(trackId)?.gain ?? null;
  }

  dispose(): void {
    this.channelNodes.forEach(ch => {
      ch.gain.disconnect();
      ch.effectsChain.dispose();
      ch.meter.dispose();
    });
    this.channelNodes.clear();
    this.masterGain.disconnect();
    this.masterEffects.dispose();
    this.analyser.disconnect();
  }
}

// ============================================================================
// Audio Recorder
// ============================================================================

/**
 * Pick the first MediaRecorder MIME type actually supported by this browser.
 * Chrome/Firefox prefer webm+opus, Safari lands on mp4. If none match, we
 * return null and the caller falls back to the browser default.
 */
function pickRecorderMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/mpeg',
  ];
  for (const type of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      /* some browsers throw for unknown types */
    }
  }
  return null;
}

export class AudioRecorder {
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private onComplete: ((blob: Blob) => void) | null = null;
  private onError: ((err: Error) => void) | null = null;
  private mimeType: string | null = null;
  private lastError: Error | null = null;

  /** True once the user has granted mic permission and we have a live stream. */
  get hasAccess(): boolean {
    return !!this.mediaStream && this.mediaStream.getAudioTracks().some(t => t.readyState === 'live');
  }

  /** Latest error, if any — surfaces stream/recorder failures to the UI. */
  getLastError(): Error | null {
    return this.lastError;
  }

  async requestAccess(): Promise<boolean> {
    // Reuse an existing live stream instead of re-prompting every record.
    if (this.hasAccess) return true;
    // Tear down any dead stream before requesting a fresh one.
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    this.lastError = null;
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('getUserMedia unavailable in this context');
      }
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      return true;
    } catch (err) {
      this.lastError = err instanceof Error ? err : new Error(String(err));
      return false;
    }
  }

  startRecording(
    onComplete: (blob: Blob) => void,
    onError?: (err: Error) => void,
  ): boolean {
    if (!this.hasAccess || !this.mediaStream) {
      this.lastError = new Error('startRecording called without mic access');
      return false;
    }
    this.onComplete = onComplete;
    this.onError = onError || null;
    this.chunks = [];
    this.lastError = null;

    // Explicitly select a supported codec. Without this, some browsers
    // (notably Safari) silently produce zero-byte chunks.
    this.mimeType = pickRecorderMimeType();
    try {
      this.mediaRecorder = this.mimeType
        ? new MediaRecorder(this.mediaStream, { mimeType: this.mimeType })
        : new MediaRecorder(this.mediaStream);
    } catch (err) {
      this.lastError = err instanceof Error ? err : new Error(String(err));
      this.onError?.(this.lastError);
      return false;
    }

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.onerror = (ev: Event) => {
      // MediaRecorder's ErrorEvent.error is non-standard but widely shipped.
      const err =
        (ev as unknown as { error?: Error }).error ||
        new Error('MediaRecorder error');
      this.lastError = err;
      this.onError?.(err);
    };
    this.mediaRecorder.onstop = () => {
      // Use the negotiated mime type so the Blob matches what the encoder
      // actually produced. Falling back to the first chunk's type if the
      // recorder's mimeType is blank (Safari occasionally returns '').
      const blobType =
        this.mediaRecorder?.mimeType ||
        this.mimeType ||
        (this.chunks[0] && this.chunks[0].type) ||
        'audio/webm';
      const blob = new Blob(this.chunks, { type: blobType });
      if (blob.size === 0) {
        const err = new Error('Recording produced no audio data');
        this.lastError = err;
        this.onError?.(err);
      }
      this.onComplete?.(blob);
    };

    try {
      // Request a slice every 250ms so we get incremental data even if the
      // user never stops the recorder normally.
      this.mediaRecorder.start(250);
    } catch (err) {
      this.lastError = err instanceof Error ? err : new Error(String(err));
      this.onError?.(this.lastError);
      return false;
    }
    return true;
  }

  stopRecording(): void {
    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
    } catch (err) {
      this.lastError = err instanceof Error ? err : new Error(String(err));
      this.onError?.(this.lastError);
    }
  }

  dispose(): void {
    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
    } catch {
      /* ignore */
    }
    this.mediaStream?.getTracks().forEach(t => t.stop());
    this.mediaStream = null;
    this.mediaRecorder = null;
    this.chunks = [];
  }
}

// ============================================================================
// Waveform Generator (for display)
// ============================================================================

export function generateWaveformPeaks(audioBuffer: AudioBuffer, numSamples: number = 200): number[] {
  const channelData = audioBuffer.getChannelData(0);
  const blockSize = Math.floor(channelData.length / numSamples);
  const peaks: number[] = [];
  for (let i = 0; i < numSamples; i++) {
    let max = 0;
    for (let j = 0; j < blockSize; j++) {
      const abs = Math.abs(channelData[i * blockSize + j] || 0);
      if (abs > max) max = abs;
    }
    peaks.push(max);
  }
  return peaks;
}

// ============================================================================
// Note Helpers
// ============================================================================

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const note = NOTE_NAMES[midi % 12];
  return `${note}${octave}`;
}

export function noteNameToMidi(name: string): number {
  const match = name.match(/^([A-G]#?)(-?\d+)$/);
  if (!match) return 60;
  const noteIndex = NOTE_NAMES.indexOf(match[1]);
  const octave = parseInt(match[2], 10);
  return (octave + 1) * 12 + noteIndex;
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ============================================================================
// Default Presets
// ============================================================================

export const DEFAULT_SYNTH_PRESETS: SynthPreset[] = [
  {
    id: 'sub-bass',
    name: 'Sub Bass',
    type: 'subtractive',
    category: 'bass',
    tags: ['bass', 'sub', 'low'],
    oscillators: [{ shape: 'sine', detune: 0, octave: -1, level: 1, phase: 0 }],
    filter: { type: 'lowpass', frequency: 400, resonance: 2, envelope: 0, keyTrack: 0 },
    ampEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.8, release: 0.2 },
    filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.2 },
    lfo: [],
    effects: [],
    polyphony: 4,
    portamento: 0,
    unison: 1,
    unisonDetune: 0,
  },
  {
    id: 'saw-lead',
    name: 'Saw Lead',
    type: 'subtractive',
    category: 'lead',
    tags: ['lead', 'bright', 'sharp'],
    oscillators: [
      { shape: 'sawtooth', detune: 0, octave: 0, level: 0.7, phase: 0 },
      { shape: 'sawtooth', detune: 7, octave: 0, level: 0.5, phase: 0 },
    ],
    filter: { type: 'lowpass', frequency: 3000, resonance: 3, envelope: 0.6, keyTrack: 0.5 },
    ampEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.3 },
    filterEnvelope: { attack: 0.05, decay: 0.3, sustain: 0.4, release: 0.3 },
    lfo: [{ shape: 'sine', rate: 5, depth: 0.1, target: 'filter.frequency', sync: false }],
    effects: [],
    polyphony: 8,
    portamento: 0,
    unison: 2,
    unisonDetune: 10,
  },
  {
    id: 'pad-warm',
    name: 'Warm Pad',
    type: 'subtractive',
    category: 'pad',
    tags: ['pad', 'warm', 'ambient'],
    oscillators: [
      { shape: 'sawtooth', detune: -5, octave: 0, level: 0.4, phase: 0 },
      { shape: 'square', detune: 5, octave: 0, level: 0.3, phase: 0 },
      { shape: 'triangle', detune: 0, octave: 1, level: 0.2, phase: 0 },
    ],
    filter: { type: 'lowpass', frequency: 2000, resonance: 1, envelope: 0.3, keyTrack: 0.3 },
    ampEnvelope: { attack: 0.5, decay: 0.5, sustain: 0.8, release: 1.5 },
    filterEnvelope: { attack: 0.8, decay: 0.5, sustain: 0.5, release: 1.0 },
    lfo: [{ shape: 'sine', rate: 0.3, depth: 0.05, target: 'filter.frequency', sync: false }],
    effects: [],
    polyphony: 12,
    portamento: 0,
    unison: 3,
    unisonDetune: 15,
  },
  {
    id: 'fm-bell',
    name: 'FM Bell',
    type: 'fm',
    category: 'keys',
    tags: ['bell', 'bright', 'metallic'],
    oscillators: [
      { shape: 'sine', detune: 0, octave: 0, level: 1, phase: 0 },
      { shape: 'sine', detune: 0, octave: 2, level: 0.5, phase: 0 },
    ],
    filter: { type: 'lowpass', frequency: 8000, resonance: 0.5, envelope: 0, keyTrack: 0 },
    ampEnvelope: { attack: 0.001, decay: 1.5, sustain: 0, release: 1.0 },
    filterEnvelope: { attack: 0.001, decay: 0.5, sustain: 0.3, release: 0.5 },
    lfo: [],
    effects: [],
    polyphony: 16,
    portamento: 0,
    unison: 1,
    unisonDetune: 0,
  },
  {
    id: 'pluck',
    name: 'Pluck',
    type: 'subtractive',
    category: 'pluck',
    tags: ['pluck', 'short', 'staccato'],
    oscillators: [
      { shape: 'sawtooth', detune: 0, octave: 0, level: 0.8, phase: 0 },
    ],
    filter: { type: 'lowpass', frequency: 5000, resonance: 2, envelope: 0.8, keyTrack: 0.5 },
    ampEnvelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 },
    filterEnvelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.1 },
    lfo: [],
    effects: [],
    polyphony: 16,
    portamento: 0,
    unison: 1,
    unisonDetune: 0,
  },
  {
    id: 'strings',
    name: 'Strings Ensemble',
    type: 'subtractive',
    category: 'strings',
    tags: ['strings', 'ensemble', 'lush'],
    oscillators: [
      { shape: 'sawtooth', detune: -3, octave: 0, level: 0.4, phase: 0 },
      { shape: 'sawtooth', detune: 3, octave: 0, level: 0.4, phase: 90 },
      { shape: 'sawtooth', detune: -1, octave: -1, level: 0.2, phase: 45 },
    ],
    filter: { type: 'lowpass', frequency: 4000, resonance: 0.5, envelope: 0.2, keyTrack: 0.3 },
    ampEnvelope: { attack: 0.3, decay: 0.3, sustain: 0.9, release: 0.8 },
    filterEnvelope: { attack: 0.5, decay: 0.3, sustain: 0.6, release: 0.5 },
    lfo: [{ shape: 'sine', rate: 5, depth: 0.02, target: 'pitch', sync: false }],
    effects: [],
    polyphony: 8,
    portamento: 0.05,
    unison: 2,
    unisonDetune: 8,
  },
];

export const DEFAULT_EFFECT_PRESETS: EffectInstance[] = [
  { id: 'eq-default', type: 'eq3', name: 'EQ', enabled: true, wet: 1, params: { lowGain: 0, midGain: 0, highGain: 0, lowFreq: 320, midFreq: 1000, highFreq: 3200 } },
  { id: 'comp-default', type: 'compressor', name: 'Compressor', enabled: true, wet: 1, params: { threshold: -24, ratio: 4, attack: 0.003, release: 0.25, knee: 30 } },
  { id: 'reverb-default', type: 'reverb', name: 'Reverb', enabled: true, wet: 0.3, params: { decay: 2, preDelay: 0.01 } },
  { id: 'delay-default', type: 'delay', name: 'Delay', enabled: true, wet: 0.25, params: { time: 0.375, feedback: 0.3 } },
  { id: 'dist-default', type: 'distortion', name: 'Distortion', enabled: false, wet: 0.5, params: { amount: 50 } },
  { id: 'chorus-default', type: 'chorus', name: 'Chorus', enabled: false, wet: 0.3, params: { rate: 1.5, depth: 0.7, delay: 0.01 } },
  { id: 'limiter-default', type: 'limiter', name: 'Limiter', enabled: true, wet: 1, params: { ceiling: -1, release: 0.1 } },
];
