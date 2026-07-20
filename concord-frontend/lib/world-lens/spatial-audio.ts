/**
 * spatial-audio.ts
 *
 * Spatial audio system for Concordia: reverb zones, wall occlusion,
 * and procedural combat music driven by combat intensity.
 *
 * Problem: Web Audio API's default PannerNode gives HRTF spatialization
 * but no room acoustics. A tavern and an open field sound identical
 * except for left/right panning. Real indoor spaces have reverb tails,
 * flutter echoes, and bass buildup. Sound through walls is muffled —
 * a fight happening just around the corner sounds dampened and distant.
 *
 * Solutions:
 *   1. Reverb zones: ConvolverNode with IR (impulse response) samples
 *      per zone type (outdoor, small_room, large_hall, cave, tunnel).
 *      Wet/dry mix transitions as the player enters/exits zones.
 *   2. Sound propagation: a simple line-of-sight raycast result (0–1)
 *      drives a LowpassFilter to muffle occluded sounds.
 *   3. Procedural combat music: a layered track system with stems
 *      (percussion, bass, melody, tension) whose gain is driven by a
 *      CombatIntensityScore that rises during fights and decays at peace.
 */

// ── Zone types ────────────────────────────────────────────────────────────────

export type ReverbZoneType =
  | 'outdoor'
  | 'small_room'
  | 'large_hall'
  | 'cave'
  | 'tunnel'
  | 'underwater';

export interface ReverbZone {
  type:       ReverbZoneType;
  center:     { x: number; y: number; z: number };
  radius:     number;
  /** 0–1 wet mix at full immersion in zone. */
  wetGain:    number;
}

// ── Impulse response descriptors ─────────────────────────────────────────────
// Each zone type has a synthetic IR generated procedurally.
// In production these would be loaded from IR asset files; here we generate
// them analytically so the system works with zero external assets.

interface IRDescriptor {
  decaySeconds: number;  // RT60 — time for reflections to fall 60 dB
  earlyReflections: number; // count of discrete early reflections
  roomSize: number;      // room size coefficient (affects comb filter spacing)
  damping:  number;      // high-frequency absorption (0=bright, 1=dark)
}

const IR_DESCRIPTORS: Record<ReverbZoneType, IRDescriptor> = {
  outdoor:     { decaySeconds: 0.3, earlyReflections: 2,  roomSize: 1.0, damping: 0.9 },
  small_room:  { decaySeconds: 0.6, earlyReflections: 6,  roomSize: 0.3, damping: 0.5 },
  large_hall:  { decaySeconds: 2.5, earlyReflections: 12, roomSize: 1.8, damping: 0.2 },
  cave:        { decaySeconds: 3.5, earlyReflections: 8,  roomSize: 1.2, damping: 0.1 },
  tunnel:      { decaySeconds: 1.8, earlyReflections: 20, roomSize: 0.5, damping: 0.15 },
  underwater:  { decaySeconds: 4.0, earlyReflections: 4,  roomSize: 2.0, damping: 0.95 },
};

/**
 * Generate a synthetic impulse response buffer for a room type.
 * Uses a Schroeder reverberator model: exponentially decaying white noise
 * with early reflection spikes.
 */
export function generateIR(ctx: AudioContext, desc: IRDescriptor): AudioBuffer {
  const sampleRate   = ctx.sampleRate;
  const lengthSamples = Math.ceil(desc.decaySeconds * sampleRate);
  const buffer        = ctx.createBuffer(2, lengthSamples, sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);

    // Exponential decay noise tail
    for (let i = 0; i < lengthSamples; i++) {
      const t         = i / sampleRate;
      const decay     = Math.exp(-6.908 * t / desc.decaySeconds); // -60dB at RT60
      const hfDecay   = Math.exp(-desc.damping * t * 8);          // hi-freq absorption
      data[i]         = (Math.random() * 2 - 1) * decay * hfDecay;
    }

    // Add discrete early reflections (comb filter spikes)
    for (let r = 0; r < desc.earlyReflections; r++) {
      const delayMs  = (r + 1) * desc.roomSize * 8; // 8–160 ms depending on room size
      const delaySmp = Math.floor((delayMs / 1000) * sampleRate);
      const gain     = 0.6 * Math.pow(0.7, r); // each reflection is quieter
      if (delaySmp < lengthSamples) {
        data[delaySmp] += (ch === 0 ? 1 : -1) * gain; // slight stereo spread
      }
    }
  }

  return buffer;
}

// ── Reverb zone manager ───────────────────────────────────────────────────────

/**
 * Manages zone-based reverb using ConvolverNode.
 *
 * Audio routing per sound source:
 *   source → [dry path: GainNode] → destination
 *          → [wet path: GainNode → ConvolverNode → GainNode] → destination
 *
 * When the player enters a zone, wet gain fades in and dry gain fades down.
 */
export class ReverbZoneManager {
  private ctx:        AudioContext;
  private zones:      ReverbZone[] = [];
  private convolvers: Map<ReverbZoneType, ConvolverNode> = new Map();
  private wetGainNode:  GainNode;
  private dryGainNode:  GainNode;
  private sendNode:     GainNode;      // sources connect to this
  private currentZone:  ReverbZoneType | null = null;
  private targetWet     = 0;
  private currentWet    = 0;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;

    this.dryGainNode = ctx.createGain();
    this.wetGainNode = ctx.createGain();
    this.sendNode    = ctx.createGain();

    this.dryGainNode.gain.value = 1.0;
    this.wetGainNode.gain.value = 0.0;

    this.dryGainNode.connect(ctx.destination);
    this.wetGainNode.connect(ctx.destination);

    // Pre-generate IRs for all zone types
    for (const [type, desc] of Object.entries(IR_DESCRIPTORS)) {
      const convolver    = ctx.createConvolver();
      convolver.buffer   = generateIR(ctx, desc);
      convolver.normalize = true;

      const convOut = ctx.createGain();
      convOut.gain.value = 0.4; // convolver output level

      convolver.connect(convOut);
      convOut.connect(this.wetGainNode);

      this.convolvers.set(type as ReverbZoneType, convolver);
    }
  }

  /** Register a reverb zone in the world. */
  addZone(zone: ReverbZone): void {
    this.zones.push(zone);
  }

  /**
   * Remove every registered zone. For callers that don't have real
   * per-room geometry to register as a fixed zones list (e.g. a component
   * that only knows a boolean "is the player indoors" signal) and instead
   * maintain a single dynamic zone that gets cleared and re-added as that
   * signal changes.
   */
  clearZones(): void {
    this.zones.length = 0;
  }

  /**
   * Connect an audio source so it participates in zone reverb.
   * Call once when creating a new sound emitter.
   */
  connectSource(source: AudioNode): void {
    source.connect(this.dryGainNode);
    source.connect(this.sendNode);
  }

  /**
   * Update the active zone based on the player's world position.
   * Call every frame.
   *
   * @param playerX  Player world X.
   * @param playerZ  Player world Z.
   * @param delta    Frame delta time (seconds).
   */
  update(playerX: number, playerZ: number, delta: number): void {
    // Find the innermost zone containing the player
    let bestZone: ReverbZone | null = null;
    let bestDist = Infinity;

    for (const zone of this.zones) {
      const dx   = playerX - zone.center.x;
      const dz   = playerZ - zone.center.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < zone.radius && dist < bestDist) {
        bestDist = dist;
        bestZone = zone;
      }
    }

    const newType = bestZone?.type ?? null;
    const blend   = bestZone ? Math.max(0, 1 - bestDist / bestZone.radius) : 0;

    if (newType !== this.currentZone) {
      // Reconnect send to new convolver
      this.sendNode.disconnect();
      if (newType) {
        const conv = this.convolvers.get(newType);
        if (conv) this.sendNode.connect(conv);
      }
      this.currentZone = newType;
    }

    this.targetWet = bestZone ? bestZone.wetGain * blend : 0;

    // Smooth transition (0.1 s time constant)
    const speed = delta / 0.1;
    this.currentWet += (this.targetWet - this.currentWet) * Math.min(speed, 1);
    this.wetGainNode.gain.setTargetAtTime(this.currentWet, this.ctx.currentTime, 0.05);
    this.dryGainNode.gain.setTargetAtTime(1.0 - this.currentWet * 0.4, this.ctx.currentTime, 0.05);
  }

  dispose(): void {
    this.dryGainNode.disconnect();
    this.wetGainNode.disconnect();
    this.sendNode.disconnect();
    this.convolvers.forEach((c) => c.disconnect());
  }
}

// ── Sound propagation (wall occlusion) ───────────────────────────────────────

/**
 * Occlusion processor: muffles sounds blocked by geometry.
 * The caller must supply an occlusion value in [0,1] derived from physics
 * raycasts (0 = fully occluded, 1 = clear line of sight).
 *
 * Audio routing:
 *   source → BiquadFilter(lowpass) → PannerNode → destination
 *
 * Clear LoS:  filter frequency = 20 000 Hz (passthrough)
 * Occluded:   filter frequency = 400 Hz (muffled through wall)
 */
/**
 * Map an occlusion value (0 = fully blocked, 1 = open line of sight) to the
 * lowpass-filter cutoff + gain that expresses it. Pulled out of
 * OccludedSoundEmitter.setOcclusion so callers that can't use the full class
 * (e.g. an engine that routes every source through its own shared master
 * gain rather than straight to ctx.destination) can still apply the exact
 * same muffling curve instead of inventing a second one.
 */
export function occlusionToFilterParams(value: number): { freq: number; gain: number } {
  const clamp = Math.max(0, Math.min(1, value));
  // Cutoff: 400 Hz at 0, 20 kHz at 1 (log scale)
  const freq = 400 * Math.pow(50, clamp); // 400→20000 Hz
  const gain = 0.2 + clamp * 0.8;         // 0.2 at fully occluded
  return { freq, gain };
}

export class OccludedSoundEmitter {
  readonly panner:  PannerNode;
  readonly filter:  BiquadFilterNode;
  readonly gainNode: GainNode;

  constructor(ctx: AudioContext, source: AudioBufferSourceNode | OscillatorNode | MediaElementAudioSourceNode) {
    this.filter          = ctx.createBiquadFilter();
    this.filter.type     = 'lowpass';
    this.filter.frequency.value = 20000;
    this.filter.Q.value  = 0.5;

    this.gainNode        = ctx.createGain();
    this.panner          = ctx.createPanner();
    this.panner.panningModel     = 'HRTF';
    this.panner.distanceModel    = 'inverse';
    this.panner.refDistance      = 5;
    this.panner.maxDistance      = 200;
    this.panner.rolloffFactor    = 1.5;

    source.connect(this.filter);
    this.filter.connect(this.gainNode);
    this.gainNode.connect(this.panner);
    this.panner.connect(ctx.destination);
  }

  /**
   * Set occlusion (0 = fully blocked, 1 = open line of sight).
   * Smoothly adjusts lowpass cutoff and gain.
   */
  setOcclusion(value: number, ctx: AudioContext): void {
    const { freq, gain } = occlusionToFilterParams(value);
    this.filter.frequency.setTargetAtTime(freq, ctx.currentTime, 0.05);
    this.gainNode.gain.setTargetAtTime(gain, ctx.currentTime, 0.05);
  }

  /** Update 3D position of the sound source each frame. */
  setPosition(x: number, y: number, z: number): void {
    this.panner.positionX.value = x;
    this.panner.positionY.value = y;
    this.panner.positionZ.value = z;
  }
}

/**
 * Update the Web Audio listener position and orientation from the camera.
 */
export function updateAudioListener(
  ctx:     AudioContext,
  posX:    number, posY: number, posZ: number,
  forwardX: number, forwardY: number, forwardZ: number,
  upX = 0, upY = 1, upZ = 0,
): void {
  const l = ctx.listener;
  if (l.positionX) {
    l.positionX.value = posX;
    l.positionY.value = posY;
    l.positionZ.value = posZ;
    l.forwardX.value  = forwardX;
    l.forwardY.value  = forwardY;
    l.forwardZ.value  = forwardZ;
    l.upX.value = upX; l.upY.value = upY; l.upZ.value = upZ;
  } else {
    l.setPosition(posX, posY, posZ);
    l.setOrientation(forwardX, forwardY, forwardZ, upX, upY, upZ);
  }
}

// ── Procedural combat music ───────────────────────────────────────────────────

export type MusicStem = 'percussion' | 'bass' | 'melody' | 'tension' | 'ambient';

export interface MusicStemTrack {
  stem:    MusicStem;
  /** AudioBuffer containing the looping stem. */
  buffer:  AudioBuffer;
  gainNode: GainNode;
  source:  AudioBufferSourceNode | null;
}

/**
 * Combat intensity score: rises sharply on combat events, decays at peace.
 *
 * intensity in [0, 1]:
 *   0    = full peace     → only ambient stem audible
 *   0.3  = patrol tension → ambient + tension
 *   0.6  = active combat  → + percussion + bass
 *   1.0  = peak battle    → all stems at full volume
 */
export class CombatMusicSystem {
  private ctx:       AudioContext;
  private stems:     Map<MusicStem, MusicStemTrack> = new Map();
  private intensity  = 0;
  private decayRate  = 0.05; // per-second decay when not in combat
  private riseRate   = 2.0;  // per-second rise on combat event

  // Stem volume curves: [intensityThreshold, maxGain]
  private static STEM_CURVES: Record<MusicStem, [number, number]> = {
    ambient:    [0.0,  1.0],  // always on, fades slightly at peak
    tension:    [0.2,  0.9],
    bass:       [0.5,  0.85],
    percussion: [0.6,  1.0],
    melody:     [0.75, 0.8],
  };

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  /**
   * Add a music stem. The AudioBuffer should be a seamless loop.
   * All stems must be the same length / tempo so they stay in sync.
   */
  addStem(stem: MusicStem, buffer: AudioBuffer): void {
    const gainNode = this.ctx.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(this.ctx.destination);

    const track: MusicStemTrack = { stem, buffer, gainNode, source: null };
    this.stems.set(stem, track);
  }

  /** Start all stems looping. Call once when entering the game world. */
  start(): void {
    for (const track of this.stems.values()) {
      const source = this.ctx.createBufferSource();
      source.buffer = track.buffer;
      source.loop   = true;
      source.connect(track.gainNode);
      source.start();
      track.source = source;
    }
  }

  /** Stop all stems. */
  stop(): void {
    for (const track of this.stems.values()) {
      track.source?.stop();
      track.source = null;
    }
  }

  /**
   * Signal a combat event to spike the intensity.
   * @param weight  0–1 weight (1 = full combat, 0.3 = nearby threat).
   */
  onCombatEvent(weight = 1.0): void {
    this.intensity = Math.min(1.0, this.intensity + weight * this.riseRate * 0.016);
  }

  /**
   * Update each frame. Decays intensity and adjusts stem gains.
   * @param delta    Frame time in seconds.
   * @param inCombat True if the player is actively in melee/ranged combat this frame.
   */
  update(delta: number, inCombat: boolean): void {
    if (inCombat) {
      this.intensity = Math.min(1.0, this.intensity + this.riseRate * delta);
    } else {
      this.intensity = Math.max(0.0, this.intensity - this.decayRate * delta);
    }

    for (const [stem, track] of this.stems) {
      const [threshold, maxGain] = CombatMusicSystem.STEM_CURVES[stem];
      let gain = 0;
      if (this.intensity > threshold) {
        gain = ((this.intensity - threshold) / (1.0 - threshold)) * maxGain;
      }
      // Ambient fades out at peak combat
      if (stem === 'ambient') {
        gain = maxGain * (1 - this.intensity * 0.5);
      }
      track.gainNode.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.3);
    }
  }

  /** Current combat intensity [0,1]. */
  getIntensity(): number { return this.intensity; }

  dispose(): void {
    this.stop();
    this.stems.forEach((t) => t.gainNode.disconnect());
    this.stems.clear();
  }
}

// ── District ambient soundscape ───────────────────────────────────────────────

export type DistrictAmbientType =
  | 'market'     // crowd chatter, merchants calling, animals
  | 'residential'// quiet footsteps, distant children, wind
  | 'industrial' // hammer on anvil, bellows, cart wheels
  | 'docks'      // water lapping, gulls, rope creaking
  | 'wilderness' // wind, insects, distant birds
  | 'dungeon';   // dripping water, distant rumble, rat skitter

export interface DistrictAmbient {
  type:    DistrictAmbientType;
  gainNode: GainNode;
  source:  AudioBufferSourceNode | null;
}

/**
 * Cross-fade district ambient sounds as the player moves between districts.
 */
export class DistrictAmbientSystem {
  private ctx:      AudioContext;
  private ambients: Map<DistrictAmbientType, DistrictAmbient> = new Map();
  private current:  DistrictAmbientType | null = null;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  addAmbient(type: DistrictAmbientType, buffer: AudioBuffer): void {
    const gainNode = this.ctx.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(this.ctx.destination);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop   = true;
    source.connect(gainNode);
    source.start();

    this.ambients.set(type, { type, gainNode, source });
  }

  /**
   * Transition to a new district ambient.
   * Cross-fades over crossfadeSec seconds.
   */
  transitionTo(type: DistrictAmbientType, crossfadeSec = 3.0): void {
    if (type === this.current) return;

    const now = this.ctx.currentTime;

    // Fade out current
    if (this.current) {
      const prev = this.ambients.get(this.current);
      prev?.gainNode.gain.linearRampToValueAtTime(0, now + crossfadeSec);
    }

    // Fade in new
    const next = this.ambients.get(type);
    if (next) {
      next.gainNode.gain.linearRampToValueAtTime(0.6, now + crossfadeSec);
    }

    this.current = type;
  }

  dispose(): void {
    this.ambients.forEach((a) => {
      a.source?.stop();
      a.gainNode.disconnect();
    });
    this.ambients.clear();
  }
}
