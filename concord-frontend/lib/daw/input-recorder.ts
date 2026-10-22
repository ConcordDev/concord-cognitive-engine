/**
 * InputRecorder: lossless multitrack-grade capture for Concord Studio.
 *
 * getUserMedia (music constraints) -> MediaStreamSource -> channel select
 * (input 1, input 2 or stereo) -> input gain -> { level meter, monitor,
 * PCM tap }. The PCM tap records raw Float32 frames (no lossy codec) and
 * stamps the AudioContext time of the first captured frame so the take can
 * be placed on the timeline exactly, with latency compensation.
 *
 * ScriptProcessorNode is used for the tap on purpose: AudioWorklet modules
 * are blocked by the site's strict-dynamic CSP and ScriptProcessor works on
 * every browser including iOS Safari.
 */

import {
  buildAudioConstraints,
  classifyMicError,
  computeRecordOffsetSec,
  type ChannelMode,
  type MicErrorInfo,
} from './input-devices';

export interface OpenOptions {
  deviceId?: string | null;
  voiceCleanup?: boolean;
  channelMode?: ChannelMode;
  gainDb?: number;
  monitor?: boolean;
}

export interface OpenResult {
  ok: boolean;
  error?: MicErrorInfo;
  /** Channels the device actually delivers (1 or 2). */
  deviceChannels?: number;
  settings?: MediaTrackSettings;
  label?: string;
}

export interface CapturedTake {
  channels: Float32Array[];
  sampleRate: number;
  /** AudioContext time of the first captured frame, already latency-compensated. */
  startTime: number;
  durationSec: number;
}

export interface InputLevel {
  peakDb: number;
  rmsDb: number;
  /** Latched for ~1.5 s after any sample reaches full scale. */
  clipped: boolean;
}

const TAP_SIZE = 4096;
const toDb = (x: number) => (x > 1e-6 ? 20 * Math.log10(x) : -120);

export class InputRecorder {
  private ctx: AudioContext;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private selector: GainNode | null = null;
  private inputGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private monitorGain: GainNode | null = null;
  private tap: ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;
  private meterBuf: Float32Array = new Float32Array(2048);
  private clipUntil = 0;
  private recording = false;
  private chunks: Float32Array[][] = [];
  private firstFrameTime: number | null = null;
  private captureChannels = 1;
  private deviceLostCb: (() => void) | null = null;
  private trackLatency = 0;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  get isOpen(): boolean {
    return !!this.stream && this.stream.getAudioTracks().some((t) => t.readyState === 'live');
  }

  get isRecording(): boolean {
    return this.recording;
  }

  onDeviceLost(cb: (() => void) | null): void {
    this.deviceLostCb = cb;
  }

  async open(opts: OpenOptions = {}): Promise<OpenResult> {
    const env = {
      isSecureContext: typeof window !== 'undefined' ? window.isSecureContext : true,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    };
    if (env.isSecureContext === false) return { ok: false, error: classifyMicError(null, env) };
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return { ok: false, error: classifyMicError(new Error('getUserMedia unavailable'), env) };
    }
    this.close();
    // Safari/iOS: the context must be resumed inside the user gesture that called open().
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* reported below if still suspended */ }
    }
    const base = {
      deviceId: opts.deviceId ?? null,
      voiceCleanup: !!opts.voiceCleanup,
      sampleRate: this.ctx.sampleRate,
      channelCount: 2 as 1 | 2,
    };
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: buildAudioConstraints(base), video: false });
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: buildAudioConstraints({ ...base, relaxed: true }), video: false });
        } catch (err2) {
          return { ok: false, error: classifyMicError(err2, env) };
        }
      } else {
        return { ok: false, error: classifyMicError(err, env) };
      }
    }
    this.stream = stream;
    const track = stream.getAudioTracks()[0];
    const settings = track?.getSettings?.() ?? {};
    const deviceChannels = Math.max(1, Math.min(2, Number(settings.channelCount) || 1));
    this.trackLatency = typeof (settings as { latency?: number }).latency === 'number' ? Number((settings as { latency?: number }).latency) : 0;
    track?.addEventListener('ended', () => {
      if (this.deviceLostCb) this.deviceLostCb();
    });

    try {
      this.buildGraph(opts.channelMode ?? 'mono1', deviceChannels);
    } catch (err) {
      // Firefox: "Connecting AudioNodes from AudioContexts with different sample-rate".
      this.close();
      return { ok: false, error: classifyMicError(err, env) };
    }
    this.setGain(opts.gainDb ?? 0);
    this.setMonitor(!!opts.monitor);
    return { ok: true, deviceChannels, settings, label: track?.label };
  }

  private buildGraph(mode: ChannelMode, deviceChannels: number): void {
    if (!this.stream) return;
    const ctx = this.ctx;
    this.source = ctx.createMediaStreamSource(this.stream);
    this.inputGain = ctx.createGain();
    const wantStereo = mode === 'stereo' && deviceChannels >= 2;
    this.captureChannels = wantStereo ? 2 : 1;
    if (wantStereo) {
      this.inputGain.channelCount = 2;
      this.inputGain.channelCountMode = 'explicit';
      this.source.connect(this.inputGain);
    } else {
      this.splitter = ctx.createChannelSplitter(2);
      this.selector = ctx.createGain();
      this.selector.channelCount = 1;
      this.selector.channelCountMode = 'explicit';
      this.source.connect(this.splitter);
      const ch = mode === 'mono2' && deviceChannels >= 2 ? 1 : 0;
      this.splitter.connect(this.selector, ch);
      this.selector.connect(this.inputGain);
      this.inputGain.channelCount = 1;
      this.inputGain.channelCountMode = 'explicit';
    }
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.meterBuf = new Float32Array(this.analyser.fftSize);
    this.inputGain.connect(this.analyser);

    this.monitorGain = ctx.createGain();
    this.monitorGain.gain.value = 0;
    this.inputGain.connect(this.monitorGain).connect(ctx.destination);

    this.tap = ctx.createScriptProcessor(TAP_SIZE, this.captureChannels, this.captureChannels);
    this.sink = ctx.createGain();
    this.sink.gain.value = 0; // keeps the tap pulled without making sound
    this.inputGain.connect(this.tap);
    this.tap.connect(this.sink).connect(ctx.destination);
    this.tap.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!this.recording) return;
      const block: Float32Array[] = [];
      for (let c = 0; c < this.captureChannels; c++) {
        block.push(new Float32Array(e.inputBuffer.getChannelData(Math.min(c, e.inputBuffer.numberOfChannels - 1))));
      }
      if (this.firstFrameTime === null) {
        // playbackTime is when this block's *output* plays; its input frames
        // were captured one block earlier.
        const pt = Number.isFinite(e.playbackTime) && e.playbackTime > 0 ? e.playbackTime : this.ctx.currentTime;
        this.firstFrameTime = pt - TAP_SIZE / this.ctx.sampleRate;
      }
      this.chunks.push(block);
    };
  }

  setGain(db: number): void {
    if (this.inputGain) this.inputGain.gain.value = Math.pow(10, Math.max(-60, Math.min(24, db)) / 20);
  }

  setMonitor(on: boolean): void {
    if (this.monitorGain) this.monitorGain.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.01);
  }

  getLevel(): InputLevel {
    if (!this.analyser) return { peakDb: -120, rmsDb: -120, clipped: false };
    this.analyser.getFloatTimeDomainData(this.meterBuf as Float32Array<ArrayBuffer>);
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < this.meterBuf.length; i++) {
      const a = Math.abs(this.meterBuf[i]);
      if (a > peak) peak = a;
      sum += a * a;
    }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (peak >= 0.999) this.clipUntil = now + 1500;
    return { peakDb: toDb(peak), rmsDb: toDb(Math.sqrt(sum / this.meterBuf.length)), clipped: now < this.clipUntil };
  }

  resetClip(): void {
    this.clipUntil = 0;
  }

  /** Latency compensation (seconds) applied to each take's start time. */
  latencyOffsetSec(): number {
    const c = this.ctx as AudioContext & { outputLatency?: number };
    return computeRecordOffsetSec({ baseLatency: c.baseLatency, outputLatency: c.outputLatency, trackLatency: this.trackLatency });
  }

  start(): boolean {
    if (!this.tap || !this.isOpen) return false;
    this.chunks = [];
    this.firstFrameTime = null;
    this.recording = true;
    return true;
  }

  stop(): CapturedTake | null {
    if (!this.recording) return null;
    this.recording = false;
    const frames = this.chunks.reduce((n, b) => n + b[0].length, 0);
    if (frames === 0 || this.firstFrameTime === null) return null;
    const channels: Float32Array[] = [];
    for (let c = 0; c < this.captureChannels; c++) {
      const out = new Float32Array(frames);
      let o = 0;
      for (const block of this.chunks) {
        out.set(block[c], o);
        o += block[c].length;
      }
      channels.push(out);
    }
    this.chunks = [];
    return {
      channels,
      sampleRate: this.ctx.sampleRate,
      startTime: this.firstFrameTime - this.latencyOffsetSec(),
      durationSec: frames / this.ctx.sampleRate,
    };
  }

  close(): void {
    this.recording = false;
    try { if (this.tap) this.tap.onaudioprocess = null; } catch { /* noop */ }
    for (const n of [this.source, this.splitter, this.selector, this.inputGain, this.analyser, this.monitorGain, this.tap, this.sink]) {
      try { n?.disconnect(); } catch { /* already disconnected */ }
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source = this.splitter = this.selector = this.inputGain = this.analyser = this.monitorGain = this.sink = null;
    this.tap = null;
  }
}
