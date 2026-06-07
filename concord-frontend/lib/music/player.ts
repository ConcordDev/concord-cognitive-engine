// @resource-leak-ok: audio-element listeners are GC'd with the player instance (no live-reload teardown surface)
// ============================================================================
// Music Player Engine
// Background playback via HTML5 Audio + Media Session API.
// Persistent across lens navigation. Waveform via Web Audio API.
//
// Audio graph (dual-deck, so TRUE track-to-track crossfade is possible — two
// tracks play simultaneously while one fades out and the other fades in):
//
//   deckA.audio → srcA → gainA ↘
//                                masterMix → eqLow → eqMid → eqHigh → preamp
//   deckB.audio → srcB → gainB ↗                                        │
//                                                                       ▼
//        (karaoke OFF) preamp ─────────────────────────────────────► analyser → out
//        (karaoke ON)  preamp → splitter ─(L)──────────► mixGain ───► analyser → out
//                                       └─(R)→ invert(−1) ┘
//
// - Crossfade: gainA/gainB ramped on an EQUAL-POWER (cos/sin) curve via
//   setValueCurveAtTime, so the perceived loudness stays constant through the
//   transition (a linear fade dips at the midpoint).
// - Karaoke (vocal removal): OOPS / center-channel cancellation — output = L−R,
//   which cancels anything panned dead-center (lead vocals in most mixes). The
//   classic, reliable-enough browser karaoke filter; also removes other
//   center-panned content (bass/kick), which is the documented trade-off.
// ============================================================================

import type { MusicTrack, PlaybackState } from './types';

/**
 * Build an EQUAL-POWER fade curve (cos/sin law). `dir = "out"` fades 1→0,
 * `"in"` fades 0→1. The defining property is that a crossfade pairing the two
 * keeps constant power — out[i]² + in[i]² === 1 at every step — so the mix does
 * NOT dip in loudness at the midpoint the way a linear fade does. Exported pure
 * so the crossfade math is unit-testable without a live AudioContext.
 */
export function equalPowerFadeCurve(dir: 'in' | 'out', steps = 64): Float32Array {
  const c = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const x = i / (steps - 1);                   // 0 → 1
    c[i] = dir === 'out' ? Math.cos(x * 0.5 * Math.PI) : Math.sin(x * 0.5 * Math.PI);
  }
  return c;
}

type PlayerEventType = 'play' | 'pause' | 'stop' | 'timeupdate' | 'ended' |
  'trackchange' | 'volumechange' | 'error' | 'loading' | 'buffering' | 'canplay' |
  'crossfadestart' | 'crossfadeend' | 'karaokechange';

type PlayerEventHandler = (data?: Record<string, unknown>) => void;

interface Deck {
  audio: HTMLAudioElement;
  source: MediaElementAudioSourceNode | null;
  gain: GainNode | null;
}

class MusicPlayerEngine {
  // Two decks so a real crossfade can play both tracks at once. `audio` always
  // points at the ACTIVE deck's element so every existing control (play/pause/
  // seek/volume) keeps operating on the track the user is hearing.
  private deckA: Deck | null = null;
  private deckB: Deck | null = null;
  private activeId: 'A' | 'B' = 'A';
  private audio: HTMLAudioElement | null = null;

  private analyserNode: AnalyserNode | null = null;
  private audioContext: AudioContext | null = null;
  private masterMix: GainNode | null = null;
  // Real signal chain: source → gain → masterMix → [low/mid/high EQ] → preamp →
  // [karaoke] → analyser → out. (Was source → analyser → out — so the EQ /
  // normalize settings the backend stored were never applied to the audio.)
  private eqLow: BiquadFilterNode | null = null;
  private eqMid: BiquadFilterNode | null = null;
  private eqHigh: BiquadFilterNode | null = null;
  private preampGain: GainNode | null = null;
  // Karaoke (vocal-removal) OOPS stage.
  private ksplitter: ChannelSplitterNode | null = null;
  private kInvert: GainNode | null = null;
  private kMix: GainNode | null = null;
  private karaokeEnabled = false;
  private crossfading = false;
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
      const a = new Audio(); a.preload = 'auto';
      const b = new Audio(); b.preload = 'auto';
      this.deckA = { audio: a, source: null, gain: null };
      this.deckB = { audio: b, source: null, gain: null };
      this.audio = a;
      this.setupDeckEvents(a);
      this.setupDeckEvents(b);
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

  // Listeners are attached to BOTH deck elements but only the ACTIVE deck drives
  // the UI — so the outgoing track during a crossfade doesn't fire timeupdate/
  // ended into the app.
  private setupDeckEvents(el: HTMLAudioElement) {
    const active = () => el === this.audio;
    el.addEventListener('play', () => { if (active()) this.emit('play'); });
    el.addEventListener('pause', () => { if (active()) this.emit('pause'); });
    el.addEventListener('ended', () => { if (active()) this.emit('ended'); });
    el.addEventListener('canplay', () => { if (active()) this.emit('canplay'); });
    el.addEventListener('waiting', () => { if (active()) this.emit('buffering'); });
    el.addEventListener('error', () => {
      if (active()) this.emit('error', { message: el.error?.message || 'Playback error' });
    });
    el.addEventListener('timeupdate', () => {
      if (active()) this.emit('timeupdate', { currentTime: el.currentTime, duration: el.duration || 0 });
    });
    el.addEventListener('volumechange', () => {
      if (active()) this.emit('volumechange', { volume: el.volume, muted: el.muted });
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

  // ---- Web Audio API graph ----

  private initAudioContext() {
    if (this.audioContext || !this.deckA || !this.deckB) return;
    try {
      this.audioContext = new AudioContext();
      const ctx = this.audioContext;

      // Per-deck source → gain, both summed into masterMix.
      this.masterMix = ctx.createGain();
      for (const deck of [this.deckA, this.deckB]) {
        deck.source = ctx.createMediaElementSource(deck.audio);
        deck.gain = ctx.createGain();
        deck.gain.gain.value = deck === this.activeDeck() ? 1 : 0; // active audible, idle silent
        deck.source.connect(deck.gain);
        deck.gain.connect(this.masterMix);
      }

      // Three-band EQ (shelf/peaking), then a preamp/makeup gain. Gains are
      // driven by applyAudioSettings() from the stored eq-set.
      this.eqLow = ctx.createBiquadFilter();
      this.eqLow.type = 'lowshelf'; this.eqLow.frequency.value = 250;
      this.eqMid = ctx.createBiquadFilter();
      this.eqMid.type = 'peaking'; this.eqMid.frequency.value = 1500; this.eqMid.Q.value = 1;
      this.eqHigh = ctx.createBiquadFilter();
      this.eqHigh.type = 'highshelf'; this.eqHigh.frequency.value = 5000;
      this.preampGain = ctx.createGain(); this.preampGain.gain.value = 1;

      this.analyserNode = ctx.createAnalyser();
      this.analyserNode.fftSize = 256;

      // Karaoke OOPS stage (pre-wired, fed only when enabled). splitter L→mix,
      // splitter R→invert(−1)→mix; mix outputs L−R (center cancelled).
      this.ksplitter = ctx.createChannelSplitter(2);
      this.kInvert = ctx.createGain(); this.kInvert.gain.value = -1;
      this.kMix = ctx.createGain(); this.kMix.gain.value = 1;
      this.ksplitter.connect(this.kMix, 0);          // left channel
      this.ksplitter.connect(this.kInvert, 1);       // right channel
      this.kInvert.connect(this.kMix);
      this.kMix.connect(this.analyserNode);

      // Chain: masterMix → EQ → preamp → (karaoke routing) → analyser → out.
      this.masterMix.connect(this.eqLow);
      this.eqLow.connect(this.eqMid);
      this.eqMid.connect(this.eqHigh);
      this.eqHigh.connect(this.preampGain);
      this.routePreamp();                            // preamp → analyser OR → splitter
      this.analyserNode.connect(ctx.destination);

      this.waveformData = new Uint8Array(this.analyserNode.frequencyBinCount);
      this.applyAudioSettings(this._audioSettings); // re-apply settings set before the ctx existed
    } catch {
      // AudioContext already connected or not available
    }
  }

  private activeDeck(): Deck | null { return this.activeId === 'A' ? this.deckA : this.deckB; }
  private idleDeck(): Deck | null { return this.activeId === 'A' ? this.deckB : this.deckA; }

  // Route preamp output to the analyser directly (karaoke off) or through the
  // OOPS center-cancel stage (karaoke on). Disconnect-then-reconnect is the
  // standard Web Audio way to re-route at runtime.
  private routePreamp() {
    if (!this.preampGain || !this.analyserNode || !this.ksplitter) return;
    try { this.preampGain.disconnect(); } catch { /* no-op */ }
    if (this.karaokeEnabled) this.preampGain.connect(this.ksplitter);
    else this.preampGain.connect(this.analyserNode);
  }

  // ---- Audio settings (EQ + preamp) — genuinely applied to the graph ----
  // The node graph is standard Web Audio and correct by construction; audible
  // output can be confirmed on a real device/browser (EQ/preamp by ear).

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

  // ---- Karaoke (vocal removal) ----

  /** Toggle center-channel vocal cancellation (OOPS: output becomes L−R). */
  setKaraoke(enabled: boolean): void {
    this.karaokeEnabled = !!enabled;
    this.routePreamp();
    this.emit('karaokechange', { enabled: this.karaokeEnabled });
  }
  toggleKaraoke(): boolean { this.setKaraoke(!this.karaokeEnabled); return this.karaokeEnabled; }
  isKaraokeEnabled(): boolean { return this.karaokeEnabled; }

  // ---- Equal-power crossfade ----

  private _crossfadeSec = 0;
  /** Stored crossfade duration (seconds, 0 = off). Set from the engine config. */
  setCrossfadeSeconds(s: number): void { this._crossfadeSec = Math.max(0, Math.min(12, Number(s) || 0)); }
  getCrossfadeSeconds(): number { return this._crossfadeSec; }
  /** True when a track is loaded and not stopped — i.e. there's something to fade FROM. */
  hasActiveTrack(): boolean { return !!this.currentTrack && this.getPlaybackState() !== 'stopped'; }

  /**
   * True crossfade to `track` over `seconds`: the incoming track starts on the
   * idle deck and both play at once while gains cross on an equal-power curve.
   * Falls back to a hard `loadTrack` when Web Audio isn't available.
   */
  async crossfadeTo(track: MusicTrack, seconds = 4): Promise<void> {
    this.initAudioContext();
    const ctx = this.audioContext;
    const from = this.activeDeck();
    const to = this.idleDeck();
    if (!ctx || !from?.gain || !to?.gain || seconds <= 0) {
      await this.loadTrack(track);
      await this.play();
      return;
    }
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* no-op */ } }
    this.crossfading = true;
    this.emit('crossfadestart', { track, seconds });

    // Prime the incoming deck.
    to.audio.src = track.audioUrl;
    to.audio.volume = this._muted ? 0 : this._volume;
    to.audio.muted = this._muted;
    to.audio.currentTime = 0;
    to.audio.load();
    try { await to.audio.play(); } catch { /* autoplay may defer */ }

    // Equal-power ramp: from 1→0, to 0→1.
    const t0 = ctx.currentTime;
    const outC = equalPowerFadeCurve('out');
    const inC = equalPowerFadeCurve('in');
    try {
      from.gain.gain.cancelScheduledValues(t0);
      to.gain.gain.cancelScheduledValues(t0);
      from.gain.gain.setValueCurveAtTime(outC, t0, seconds);
      to.gain.gain.setValueCurveAtTime(inC, t0, seconds);
    } catch {
      // setValueCurveAtTime can throw if a curve overlaps a prior one — fall
      // back to linear ramps, still a real crossfade.
      from.gain.gain.linearRampToValueAtTime(0, t0 + seconds);
      to.gain.gain.linearRampToValueAtTime(1, t0 + seconds);
    }

    // Flip active deck + metadata immediately so the UI follows the incoming
    // track; tidy the outgoing deck after the fade completes.
    this.activeId = this.activeId === 'A' ? 'B' : 'A';
    this.audio = to.audio;
    this.currentTrack = track;
    this.updateMediaSession(track);
    this.emit('trackchange', { track });

    window.setTimeout(() => {
      try {
        from.audio.pause();
        from.audio.currentTime = 0;
        if (from.gain) from.gain.gain.value = 0;   // idle deck silent, ready for reuse
        if (to.gain) to.gain.gain.value = 1;
      } catch { /* no-op */ }
      this.crossfading = false;
      this.emit('crossfadeend', { track });
    }, Math.max(0, seconds * 1000));
  }

  isCrossfading(): boolean { return this.crossfading; }

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

  // ---- Playback Controls (operate on the active deck via `this.audio`) ----

  async loadTrack(track: MusicTrack): Promise<void> {
    if (!this.audio) return;

    this.currentTrack = track;
    this.audio.src = track.audioUrl;
    this.audio.load();
    // Ensure the active deck is audible (a prior crossfade may have left a gain low).
    const ag = this.activeDeck()?.gain;
    if (ag) ag.gain.value = 1;
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
    this._volume = Math.max(0, Math.min(1, volume));
    // Keep both decks in sync so a crossfade respects user volume.
    if (this.deckA) this.deckA.audio.volume = this._volume;
    if (this.deckB) this.deckB.audio.volume = this._volume;
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    if (this.deckA) this.deckA.audio.muted = muted;
    if (this.deckB) this.deckB.audio.muted = muted;
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
    this.deckA?.audio.pause();
    this.deckB?.audio.pause();
    this.deckA = null;
    this.deckB = null;
    this.audio = null;
    this.audioContext?.close();
    this.audioContext = null;
    this.listeners.clear();
    MusicPlayerEngine.instance = null;
  }
}

export { MusicPlayerEngine };
export const getPlayer = () => MusicPlayerEngine.getInstance();
