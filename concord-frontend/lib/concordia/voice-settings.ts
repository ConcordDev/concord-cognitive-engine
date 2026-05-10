/**
 * Voice synthesis settings — Sprint D / CC4
 *
 * Player preference for VO playback. Persisted in localStorage.
 *   - 'all'        : every NPC line gets TTS (high API cost)
 *   - 'hero_only'  : only NPCs with voice_profile (named characters) — DEFAULT
 *   - 'off'        : never play TTS
 *
 * Frontend dialogue panel reads this; SettingsPanel UI exposes it.
 */

export type VoiceMode = 'all' | 'hero_only' | 'off';

const KEY = 'concordia:voice_mode';

export function getVoiceMode(): VoiceMode {
  if (typeof window === 'undefined') return 'hero_only';
  const v = window.localStorage.getItem(KEY);
  if (v === 'all' || v === 'hero_only' || v === 'off') return v;
  return 'hero_only';
}

export function setVoiceMode(mode: VoiceMode): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, mode);
  window.dispatchEvent(new CustomEvent('concordia:voice-mode-changed', { detail: { mode } }));
}

/** Should the dialogue panel synthesize TTS for this NPC? */
export function shouldPlayVoice(isHero: boolean): boolean {
  const mode = getVoiceMode();
  if (mode === 'off') return false;
  if (mode === 'all') return true;
  return isHero;  // hero_only
}

export const VOICE_SETTINGS_CONSTANTS = Object.freeze({
  DEFAULT_MODE: 'hero_only' as VoiceMode,
});
