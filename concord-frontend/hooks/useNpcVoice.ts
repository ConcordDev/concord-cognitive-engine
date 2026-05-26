'use client';

/**
 * useNpcVoice — Wave 3 / T3.3. Per-NPC text-to-speech via the browser's
 * built-in Web Speech API. Zero backend, zero install.
 *
 * - Each npcId hashes to a deterministic voice from
 *   `speechSynthesis.getVoices()` so the same NPC sounds the same across
 *   sessions. Pitch + rate are also seeded from the id so similar voices
 *   diverge in feel.
 * - Cancels prior utterance before starting a new one so back-to-back
 *   lines don't pile up.
 * - Respects a global mute persisted in localStorage under
 *   `concordia:tts-muted`. Toggle via setMuted().
 * - No-op on SSR or when speechSynthesis is unavailable (returns a
 *   stable but inert API).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

const MUTE_KEY = 'concordia:tts-muted:v1';

interface PlayOptions {
  npcId: string;
  text: string;
  /** Override the deterministic rate/pitch. Useful for "panicked"/"calm". */
  rateBias?: number;
  pitchBias?: number;
}

interface UseNpcVoiceReturn {
  supported: boolean;
  muted: boolean;
  setMuted: (m: boolean) => void;
  play: (opts: PlayOptions) => void;
  stop: () => void;
}

function hash32(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function getMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(MUTE_KEY) === '1'; }
  catch { return false; }
}

/**
 * Returns the available voices, refreshing whenever the browser fires
 * `voiceschanged`. Some browsers populate voices async.
 */
function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return [];
    return window.speechSynthesis.getVoices();
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const refresh = () => setVoices(window.speechSynthesis.getVoices());
    refresh();
    window.speechSynthesis.addEventListener('voiceschanged', refresh);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', refresh);
  }, []);
  return voices;
}

/**
 * Pick a voice for an NPC deterministically. Prefers en-* voices; falls
 * back to the first available.
 */
export function pickVoiceForNpc(npcId: string, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const enVoices = voices.filter((v) => v.lang.startsWith('en'));
  const pool = enVoices.length > 0 ? enVoices : voices;
  const h = hash32(npcId);
  return pool[h % pool.length];
}

export function useNpcVoice(): UseNpcVoiceReturn {
  const supported = typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
  const voices = useVoices();
  const [muted, setMutedState] = useState<boolean>(() => getMuted());

  const setMuted = useCallback((m: boolean) => {
    setMutedState(m);
    try {
      if (m) window.localStorage.setItem(MUTE_KEY, '1');
      else window.localStorage.removeItem(MUTE_KEY);
    } catch { /* localStorage denied */ }
    if (m && typeof window !== 'undefined' && window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch { /* ok */ }
    }
  }, []);

  const stop = useCallback(() => {
    if (!supported) return;
    try { window.speechSynthesis.cancel(); } catch { /* ok */ }
  }, [supported]);

  const play = useCallback((opts: PlayOptions) => {
    if (!supported || muted) return;
    const text = (opts.text || '').slice(0, 400);
    if (!text.trim()) return;
    try {
      // Cancel any in-flight utterance so back-to-back lines don't pile up.
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoiceForNpc(opts.npcId, voices);
      if (v) u.voice = v;
      const h = hash32(opts.npcId);
      // Rate in [0.85, 1.15], pitch in [0.8, 1.25].
      u.rate = 0.85 + (h % 31) / 100 + (opts.rateBias ?? 0);
      u.pitch = 0.8 + (h % 46) / 100 + (opts.pitchBias ?? 0);
      u.volume = 1.0;
      window.speechSynthesis.speak(u);
    } catch { /* swallow */ }
  }, [supported, muted, voices]);

  return useMemo(() => ({ supported, muted, setMuted, play, stop }), [supported, muted, setMuted, play, stop]);
}
