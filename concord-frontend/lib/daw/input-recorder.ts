/**
 * InputRecorder: lossless capture for Concord Studio.
 *
 * getUserMedia (music constraints) -> channel select -> input gain ->
 * { level meter, software-monitor branch, PCM tap }.
 *
 * The tap prefers an AudioWorklet (render-quantum blocks, transferred
 * copies). If addModule fails, it falls back to a ScriptProcessorNode of
 * 4096 frames and says so. The fallback must not host live worklet devices.
 *
 * The recorded take is the dry tap, before inserts. Software monitoring is
 * a separate branch: the record panel routes it either into the armed
 * track or straight to the destination.
 */

import {
  buildAudioConstraints,
  classifyMicError,
  computeRecordOffsetSec,
  type ChannelMode,
  type MicErrorInfo,
} from './input-devices';
import {
  CAPTURE_WORKLET_NAME,
  SCRIPT_TAP_FRAMES,
  armCapture,
  concatChannels,
  createCaptureAccumulator,
  disarmCapture,
  pushCaptureBlock,
  scriptProcessorBlockStart,
  type CaptureAccumulator,
} from './dsp/capture-blocks';
import { ensureCaptureWorklet } from './worklets/load-capture-worklet';
import type { CaptureKind, MonitorRoute } from './dsp/monitor-routing';

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
  private worklet: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private meterBuf: Float32Array = new Float32Array(2048);
  private clipUntil = 0;
  private acc: CaptureAccumulator = createCaptureAccumulator();
  private captureChannels = 1;
  private deviceLostCb: (() => void) | null = null;
  private trackLatency = 0;
  private measuredOffset: number | null = null;
  private mode: CaptureKind = 'closed';

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  get isOpen(): boolean {
    return !!this.stream && this.stream.getAudioTracks().some((t) => t.readyState === 'live');
  }

  get isRecording(): boolean {
    return this.acc.open;
  }

  get captureMode(): CaptureKind {
    return this.mode;
  }

  onDeviceLost(cb: (() => void) | null): void {
    this.deviceLostCb = cb;
  }

  /** The software-monitor gain. The record panel connects it; the tap does not. */
  monitorNode(): GainNode | null {
    return this.monitorGain;
  }

  /**
   * 'destination' is the dry speaker path. 'graph' leaves the node
   * unconnected here so the caller can connect it to a track. 'off' mutes.
   */
  setMonitorRoute(route: MonitorRoute): void {
    if (!this.monitorGain) return;
    try { this.monitorGain.disconnect(this.ctx.destination); } catch { /* not on the destination */ }
    if (route === 'destination') this.monitorGain.connect(this.ctx.destination);
    const on = route !== 'off';
    this.monitorGain.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.01);
  }

  latencyParts(): { baseLatency?: number; outputLatency?: number; trackLatency?: number } {
    const c = this.ctx as AudioContext & { outputLatency?: number };
    return { baseLatency: c.baseLatency, outputLatency: c.outputLatency, trackLatency: this.trackLatency };
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
      await this.buildGraph(opts.channelMode ?? 'mono1', deviceChannels);
    } catch (err) {
      // Firefox: "Connecting AudioNodes from AudioContexts with different sample-rate".
      this.close();
      return { ok: false, error: classifyMicError(err, env) };
    }
    this.setGain(opts.gainDb ?? 0);
    return { ok: true, deviceChannels, settings, label: track?.label };
  }

  private async buildGraph(mode: ChannelMode, deviceChannels: number): Promise<void> {
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

    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    const workletOk = await this.attachWorkletTap();
    if (!workletOk) this.attachScriptTap();
  }

  private async attachWorkletTap(): Promise<boolean> {
    if (!this.inputGain || !this.sink) return false;
    if (typeof AudioWorkletNode !== 'function') return false;
    const ok = await ensureCaptureWorklet(this.ctx);
    if (!ok) return false;
    try {
      this.worklet = new AudioWorkletNode(this.ctx, CAPTURE_WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [this.captureChannels],
        channelCount: this.captureChannels,
        channelCountMode: 'explicit',
      });
      this.worklet.port.onmessage = (e) => this.onWorkletMessage(e);
      this.inputGain.connect(this.worklet);
      this.worklet.connect(this.sink).connect(this.ctx.destination);
      this.mode = 'worklet';
      return true;
    } catch {
      try { this.worklet?.disconnect(); } catch { /* noop */ }
      this.worklet = null;
      return false;
    }
  }

  private onWorkletMessage(e: MessageEvent): void {
    const data = e.data as { type?: string; gen?: number; time?: number; channels?: Float32Array[] } | null;
    if (!data || data.type !== 'block' || typeof data.gen !== 'number' || typeof data.time !== 'number' || !data.channels) return;
    pushCaptureBlock(this.acc, { gen: data.gen, time: data.time, channels: data.channels });
  }

  private attachScriptTap(): void {
    if (!this.inputGain || !this.sink) return;
    this.tap = this.ctx.createScriptProcessor(SCRIPT_TAP_FRAMES, this.captureChannels, this.captureChannels);
    this.inputGain.connect(this.tap);
    this.tap.connect(this.sink).connect(this.ctx.destination);
    this.mode = 'script';
    this.tap.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!this.acc.open) return;
      const block: Float32Array[] = [];
      for (let c = 0; c < this.captureChannels; c++) {
        block.push(new Float32Array(e.inputBuffer.getChannelData(Math.min(c, e.inputBuffer.numberOfChannels - 1))));
      }
      const time = scriptProcessorBlockStart(e.playbackTime, SCRIPT_TAP_FRAMES, this.ctx.sampleRate, this.ctx.currentTime);
      pushCaptureBlock(this.acc, { gen: this.acc.gen, time, channels: block });
    };
  }

  setGain(db: number): void {
    if (this.inputGain) this.inputGain.gain.value = Math.pow(10, Math.max(-60, Math.min(24, db)) / 20);
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
  /** Per-device loopback offset. Null clears it and the reported input+output sum is used. */
  setMeasuredOffset(sec: number | null): void {
    this.measuredOffset = typeof sec === 'number' && Number.isFinite(sec) && sec >= 0 ? sec : null;
  }

  latencyOffsetSec(): number {
    const c = this.ctx as AudioContext & { outputLatency?: number };
    return computeRecordOffsetSec({
      baseLatency: c.baseLatency,
      outputLatency: c.outputLatency,
      trackLatency: this.trackLatency,
      measuredSec: this.measuredOffset ?? undefined,
    });
  }

  start(): boolean {
    if ((!this.worklet && !this.tap) || !this.isOpen) return false;
    const gen = armCapture(this.acc);
    this.worklet?.port.postMessage({ type: 'arm', on: true, gen });
    return true;
  }

  stop(opts?: { compensate?: boolean }): CapturedTake | null {
    if (!this.acc.open) return null;
    const gen = this.acc.gen;
    const first = this.acc.firstTime;
    const channels = concatChannels(this.acc.chunks);
    disarmCapture(this.acc);
    this.worklet?.port.postMessage({ type: 'arm', on: false, gen });
    if (!channels.length || channels[0].length === 0 || first === null) return null;
    const compensate = opts?.compensate !== false;
    return {
      channels,
      sampleRate: this.ctx.sampleRate,
      startTime: first - (compensate ? this.latencyOffsetSec() : 0),
      durationSec: channels[0].length / this.ctx.sampleRate,
    };
  }

  close(): void {
    disarmCapture(this.acc);
    try { this.worklet?.port.postMessage({ type: 'arm', on: false, gen: this.acc.gen }); } catch { /* noop */ }
    try { if (this.tap) this.tap.onaudioprocess = null; } catch { /* noop */ }
    for (const n of [this.source, this.splitter, this.selector, this.inputGain, this.analyser, this.monitorGain, this.tap, this.worklet, this.sink]) {
      try { n?.disconnect(); } catch { /* already disconnected */ }
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source = this.splitter = this.selector = this.inputGain = this.analyser = this.monitorGain = this.sink = null;
    this.tap = null;
    this.worklet = null;
    this.mode = 'closed';
  }
}
