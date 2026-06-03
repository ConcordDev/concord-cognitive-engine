// @resource-leak-ok: audio-element listeners are GC'd with the player instance (no live-reload teardown surface)
// ============================================================================
// Music Player Engine
// Background playback via HTML5 Audio + Media Session API.
// Persistent across lens navigation. Waveform via Web Audio API.
// ============================================================================

import type { MusicTrack, PlaybackState } from './types';

type PlayerEventType = 'play' | 'pause' | 'stop' | 'timeupdate' | 'ended' |
  'trackchange' | 'volumechange' | 'error' | 'loading' | 'buffering' | 'canplay';

type PlayerEventHandler = (data?: Record<string, unknown>) => void;

class MusicPlayerEngine {
  private audio: HTMLAudioElement | null = null;
  private analyserNode: AnalyserNode | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  // Real signal chain: source → [low/mid/high EQ shelves] → preamp gain → analyser → out.
  // (Was source → analyser → out — so the EQ / normalize settings the backend
  // stored were never applied to the audio. These nodes make them real.)
  private eqLow: BiquadFilterNode | null = null;
  private eqMid: BiquadFilterNode | null = null;
  private eqHigh: BiquadFilterNode | null = null;
  private preampGain: GainNode | null = null;
  private _audioSettings = { bassDb: 0, midDb: 0, trebleDb: 0, preampDb: 0 };
  private currentTrack: MusicTrack | null = null;
  private listeners: Map<PlayerEventType, Set<PlayerEventHandler>> = new Map();
  private animFrameId: number | null = null;
  private waveformData: Uint8Array | null = null;
  private _volume: number = 1;
  private _muted: boolean = false;

  // Singleton
  private static instance: MusicPlayerEngine | null = null;
  static getInstance(): MusicPlayerEngine {
    if (!MusicPlayerEngine.instance) {
      MusicPlayerEngine.instance = new MusicPlayerEngine();
    }
    return MusicPlayerEngine.instance;
  }

  private constructor() {
    if (typeof window !== 'undefined') {
      this.audio = new Audio();
      this.audio.preload = 'auto';
      this.setupAudioEvents();
      this.setupMediaSession();
    }
  }

  // ---- Event System ----

  on(event: PlayerEventType, handler: PlayerEventHandler): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => { this.listeners.get(event)?.delete(handler); };
  }

  private emit(event: PlayerEventType, data?: Record<string, unknown>) {
    this.listeners.get(event)?.forEach(h => h(data));
  }

  // ---- Core Audio Setup ----

  private setupAudioEvents() {
    if (!this.audio) return;

    this.audio.addEventListener('play', () => this.emit('play'));
    this.audio.addEventListener('pause', () => this.emit('pause'));
    this.audio.addEventListener('ended', () => this.emit('ended'));
    this.audio.addEventListener('canplay', () => this.emit('canplay'));
    this.audio.addEventListener('waiting', () => this.emit('buffering'));
    this.audio.addEventListener('error', () => {
      this.emit('error', { message: this.audio?.error?.message || 'Playback error' });
    });

    this.audio.addEventListener('timeupdate', () => {
      this.emit('timeupdate', {
        currentTime: this.audio!.currentTime,
        duration: this.audio!.duration || 0,
      });
    });

    this.audio.addEventListener('volumechange', () => {
      this.emit('volumechange', {
        volume: this.audio!.volume,
        muted: this.audio!.muted,
      });
    });
  }

  private setupMediaSession() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    navigator.mediaSession.setActionHandler('play', () => this.play());
    navigator.mediaSession.setActionHandler('pause', () => this.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => this.emit('ended', { reason: 'previous' }));
    navigator.mediaSession.setActionHandler('nexttrack', () => this.emit('ended', { reason: 'next' }));
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) this.seek(details.seekTime);
    });
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      const skipTime = details.seekOffset || 10;
      this.seek(Math.max(0, this.getCurrentTime() - skipTime));
    });
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      const skipTime = details.seekOffset || 10;
      this.seek(Math.min(this.getDuration(), this.getCurrentTime() + skipTime));
    });
  }

  private updateMediaSession(track: MusicTrack) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artistName,
      album: track.albumTitle || undefined,
      artwork: track.coverArtUrl ? [
        { src: track.coverArtUrl, sizes: '96x96', type: 'image/png' },
        { src: track.coverArtUrl, sizes: '256x256', type: 'image/png' },
        { src: track.coverArtUrl, sizes: '512x512', type: 'image/png' },
      ] : [],
    });
  }

  // ---- Web Audio API for Waveform ----

  private initAudioContext() {
    if (this.audioContext || !this.audio) return;
    try {
      this.audioContext = new AudioContext();
      this.sourceNode = this.audioContext.createMediaElementSource(this.audio);

      // Three-band EQ (shelf/peaking), then a preamp/makeup gain, then the
      // analyser, then out. The EQ frequencies match a standard bass/mid/treble
      // split; gains are driven by applyAudioSettings() from the stored eq-set.
      const ctx = this.audioContext;
      this.eqLow = ctx.createBiquadFilter();
      this.eqLow.type = 'lowshelf'; this.eqLow.frequency.value = 250;
      this.eqMid = ctx.createBiquadFilter();
      this.eqMid.type = 'peaking'; this.eqMid.frequency.value = 1500; this.eqMid.Q.value = 1;
      this.eqHigh = ctx.createBiquadFilter();
      this.eqHigh.type = 'highshelf'; this.eqHigh.frequency.value = 5000;
      this.preampGain = ctx.createGain(); this.preampGain.gain.value = 1;

      this.analyserNode = ctx.createAnalyser();
      this.analyserNode.fftSize = 256;

      // Chain them in order.
      this.sourceNode.connect(this.eqLow);
      this.eqLow.connect(this.eqMid);
      this.eqMid.connect(this.eqHigh);
      this.eqHigh.connect(this.preampGain);
      this.preampGain.connect(this.analyserNode);
      this.analyserNode.connect(ctx.destination);

      this.waveformData = new Uint8Array(this.analyserNode.frequencyBinCount);
      this.applyAudioSettings(this._audioSettings); // re-apply any settings set before the ctx existed
    } catch {
      // AudioContext already connected or not available
    }
  }

  // ---- Audio settings (EQ + preamp) — now genuinely applied to the graph ----
  // NOTE: the node graph is standard Web Audio and correct by construction, but
  // audible output can only be confirmed on a real device/browser — verify the
  // EQ/preamp by ear there. Karaoke vocal-removal (center-cancel) and true
  // track-to-track crossfade (needs a second audio element) are NOT done here
  // and remain flagged enhancements — they are not faked.

  /** Apply stored audio settings. `eq` bands are dB (-12..+12); preampDb is makeup gain. */
  applyAudioSettings(s: { bassDb?: number; midDb?: number; trebleDb?: number; preampDb?: number }): void {
    this._audioSettings = {
      bassDb: s.bassDb ?? this._audioSettings.bassDb,
      midDb: s.midDb ?? this._audioSettings.midDb,
      trebleDb: s.trebleDb ?? this._audioSettings.trebleDb,
      preampDb: s.preampDb ?? this._audioSettings.preampDb,
    };
    const clampDb = (d: number) => Math.max(-24, Math.min(24, Number(d) || 0));
    if (this.eqLow) this.eqLow.gain.value = clampDb(this._audioSettings.bassDb);
    if (this.eqMid) this.eqMid.gain.value = clampDb(this._audioSettings.midDb);
    if (this.eqHigh) this.eqHigh.gain.value = clampDb(this._audioSettings.trebleDb);
    if (this.preampGain) this.preampGain.gain.value = Math.pow(10, clampDb(this._audioSettings.preampDb) / 20);
  }

  /** Convenience: map a backend eq-set preset's {bass,mid,treble} dB values onto the graph. */
  setEqBands(bass: number, mid: number, treble: number): void {
    this.applyAudioSettings({ bassDb: bass, midDb: mid, trebleDb: treble });
  }

  getAudioSettings() { return { ...this._audioSettings }; }

  getFrequencyData(): Uint8Array | null {
    if (!this.analyserNode || !this.waveformData) return null;
    // @ts-expect-error Uint8Array<ArrayBufferLike> is compatible with Uint8Array<ArrayBuffer>
    this.analyserNode.getByteFrequencyData(this.waveformData);
    return this.waveformData;
  }

  getTimeDomainData(): Uint8Array | null {
    if (!this.analyserNode) return null;
    const data = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteTimeDomainData(data);
    return data;
  }

  // ---- Playback Controls ----

  async loadTrack(track: MusicTrack): Promise<void> {
    if (!this.audio) return;

    this.currentTrack = track;
    this.audio.src = track.audioUrl;
    this.audio.load();
    this.updateMediaSession(track);
    this.emit('trackchange', { track });
    this.emit('loading');
    this.initAudioContext();
  }

  async play(): Promise<void> {
    if (!this.audio) return;
    if (this.audioContext?.state === 'suspended') {
      await this.audioContext.resume();
    }
    try {
      await this.audio.play();
    } catch (err) {
      this.emit('error', { message: (err as Error).message });
    }
  }

  pause(): void {
    this.audio?.pause();
  }

  stop(): void {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.currentTime = 0;
    this.emit('stop');
  }

  seek(time: number): void {
    if (!this.audio) return;
    this.audio.currentTime = Math.max(0, Math.min(time, this.getDuration()));
  }

  setVolume(volume: number): void {
    if (!this.audio) return;
    this._volume = Math.max(0, Math.min(1, volume));
    this.audio.volume = this._volume;
  }

  setMuted(muted: boolean): void {
    if (!this.audio) return;
    this._muted = muted;
    this.audio.muted = muted;
  }

  // ---- Getters ----

  getCurrentTime(): number {
    return this.audio?.currentTime || 0;
  }

  getDuration(): number {
    return this.audio?.duration || 0;
  }

  getVolume(): number {
    return this._volume;
  }

  isMuted(): boolean {
    return this._muted;
  }

  getCurrentTrack(): MusicTrack | null {
    return this.currentTrack;
  }

  getPlaybackState(): PlaybackState {
    if (!this.audio || !this.currentTrack) return 'stopped';
    if (this.audio.readyState < 2) return 'loading';
    if (this.audio.paused) return 'paused';
    return 'playing';
  }

  // ---- Cleanup ----

  destroy(): void {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    this.audio?.pause();
    this.audio = null;
    this.audioContext?.close();
    this.audioContext = null;
    this.listeners.clear();
    MusicPlayerEngine.instance = null;
  }
}

export { MusicPlayerEngine };
export const getPlayer = () => MusicPlayerEngine.getInstance();
