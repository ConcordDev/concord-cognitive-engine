/**
 * Voice Activity Detection — Wave 1 deferral 6.
 *
 * Listens to the player's mic during NPC dialogue and dispatches
 * `concordia:dialogue-barge-in` (Phase 16's existing hook) when sustained
 * speech is detected.
 *
 * Reuses the same analyser + frequency-data RMS pattern as VoiceRecorder
 * (components/voice/VoiceRecorder.tsx:38-85) so behavior is consistent
 * across the codebase.
 *
 * Usage:
 *   const vad = createVAD({ onSpeechDetected: () => dispatchBargeIn() });
 *   await vad.start();
 *   // ...later
 *   vad.stop();
 *
 * Privacy:
 *   - Requires explicit `getUserMedia` permission flow (browser-prompted)
 *   - Mic stream stops the moment `stop()` is called
 *   - No audio is recorded, transcribed, or transmitted — energy threshold only
 */

export interface VADOptions {
  /** Called the first frame energy crosses threshold for `sustainedMs` */
  onSpeechDetected: () => void;
  /** RMS energy threshold (0..1). Default 0.04 — quiet room baseline + ~12dB */
  threshold?: number;
  /** Energy must stay above threshold this long before firing. Default 200ms */
  sustainedMs?: number;
  /** Cooldown after firing before we can fire again. Default 1500ms */
  cooldownMs?: number;
}

export interface VADHandle {
  start: () => Promise<boolean>;
  stop: () => void;
  isActive: () => boolean;
  /** Current real-time RMS energy (0..1) — for diagnostic UI */
  getEnergy: () => number;
}

const DEFAULT_THRESHOLD   = 0.04;
const DEFAULT_SUSTAINED   = 200;
const DEFAULT_COOLDOWN    = 1500;

export function createVAD(opts: VADOptions): VADHandle {
  const threshold   = opts.threshold   ?? DEFAULT_THRESHOLD;
  const sustainedMs = opts.sustainedMs ?? DEFAULT_SUSTAINED;
  const cooldownMs  = opts.cooldownMs  ?? DEFAULT_COOLDOWN;

  let stream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let dataArray: Uint8Array | null = null;
  let rafId: number | null = null;
  let active = false;
  let lastEnergy = 0;
  let aboveThresholdSince = 0;
  let lastFiredAt = 0;

  const tick = () => {
    if (!active || !analyser || !dataArray) return;
    // Cast: TS strict-mode narrows Uint8Array's backing buffer type;
    // getByteFrequencyData accepts the runtime Uint8Array regardless.
    (analyser as { getByteFrequencyData: (a: Uint8Array) => void }).getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    const energy = sum / dataArray.length / 255;
    lastEnergy = energy;

    const now = performance.now();
    if (energy > threshold) {
      if (aboveThresholdSince === 0) aboveThresholdSince = now;
      const sustainedFor = now - aboveThresholdSince;
      const cooledDown   = now - lastFiredAt > cooldownMs;
      if (sustainedFor >= sustainedMs && cooledDown) {
        lastFiredAt = now;
        try { opts.onSpeechDetected(); } catch { /* listener errors must not crash VAD */ }
      }
    } else {
      aboveThresholdSince = 0;
    }

    rafId = requestAnimationFrame(tick);
  };

  const start = async (): Promise<boolean> => {
    if (active) return true;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      active = true;
      aboveThresholdSince = 0;
      lastFiredAt = 0;
      tick();
      return true;
    } catch {
      stop();
      return false;
    }
  };

  const stop = (): void => {
    active = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (stream) {
      try { stream.getTracks().forEach((t) => t.stop()); } catch { /* tracks may already be stopped */ }
      stream = null;
    }
    if (audioContext) {
      try { void audioContext.close(); } catch { /* context may already be closed */ }
      audioContext = null;
    }
    analyser = null;
    dataArray = null;
    lastEnergy = 0;
  };

  return {
    start,
    stop,
    isActive: () => active,
    getEnergy: () => lastEnergy,
  };
}

/**
 * Convenience: create a VAD pre-wired to dispatch the
 * `concordia:dialogue-barge-in` window event when speech is detected.
 * NPCDialogue (Phase 16) listens for this event and cancels the active
 * utterance.
 */
export function createDialogueBargeInVAD(options: Partial<VADOptions> = {}): VADHandle {
  return createVAD({
    threshold:   options.threshold   ?? DEFAULT_THRESHOLD,
    sustainedMs: options.sustainedMs ?? DEFAULT_SUSTAINED,
    cooldownMs:  options.cooldownMs  ?? DEFAULT_COOLDOWN,
    onSpeechDetected: () => {
      try {
        window.dispatchEvent(new CustomEvent('concordia:dialogue-barge-in'));
      } catch { /* dispatch is best-effort */ }
    },
  });
}
