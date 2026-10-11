/**
 * Map between the world settings panel and `settings.get` / `settings.setMany`.
 *
 * The panel used to render whatever object a parent handed it. `/settings`
 * handed it a different shape, so every volume read as 0 and every toggle
 * read as Off, and Apply wrote that blank form back. These helpers only
 * speak the keys the settings domain actually stores. A missing key falls
 * back to the schema default (the same number `settings.get` would resolve),
 * never to 0. Apply diffs against the loaded baseline, so an untouched
 * form does not write defaults over a saved value.
 */

export const SERVER_PREF_DEFAULTS = {
  audio_master_volume: 0.7,
  audio_music_volume: 0.6,
  audio_sfx_volume: 0.8,
  mouse_sensitivity: 1,
  quality_preset: 'balanced',
} as const;

export type GraphicsQuality = 'low' | 'medium' | 'high' | 'ultra';

const PRESET_TO_QUALITY: Record<string, GraphicsQuality> = {
  potato: 'low',
  low: 'low',
  balanced: 'medium',
  medium: 'medium',
  high: 'high',
  ultra: 'ultra',
};

const QUALITY_TO_PRESET: Record<GraphicsQuality, string> = {
  low: 'potato',
  medium: 'balanced',
  high: 'high',
  ultra: 'ultra',
};

export interface WorldPreferenceSlice {
  graphicsQuality: GraphicsQuality;
  audioMasterVolume: number;
  audioMusicVolume: number;
  audioSfxVolume: number;
  controlsMouseSensitivity: number;
}

export function finiteNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function settingsFromPrefs(prefs: Record<string, unknown> | null | undefined): WorldPreferenceSlice {
  const p = prefs && typeof prefs === 'object' ? prefs : {};
  const preset = typeof p.quality_preset === 'string' && p.quality_preset
    ? p.quality_preset
    : SERVER_PREF_DEFAULTS.quality_preset;
  return {
    graphicsQuality: PRESET_TO_QUALITY[preset] || 'medium',
    audioMasterVolume: finiteNumber(p.audio_master_volume, SERVER_PREF_DEFAULTS.audio_master_volume),
    audioMusicVolume: finiteNumber(p.audio_music_volume, SERVER_PREF_DEFAULTS.audio_music_volume),
    audioSfxVolume: finiteNumber(p.audio_sfx_volume, SERVER_PREF_DEFAULTS.audio_sfx_volume),
    controlsMouseSensitivity: finiteNumber(p.mouse_sensitivity, SERVER_PREF_DEFAULTS.mouse_sensitivity),
  };
}

/** Only keys the user actually changed. Empty means "do not write". */
export function preferenceUpdates(
  draft: WorldPreferenceSlice,
  baseline: WorldPreferenceSlice,
): Record<string, number | string> {
  const updates: Record<string, number | string> = {};
  if (draft.audioMasterVolume !== baseline.audioMasterVolume) updates.audio_master_volume = draft.audioMasterVolume;
  if (draft.audioMusicVolume !== baseline.audioMusicVolume) updates.audio_music_volume = draft.audioMusicVolume;
  if (draft.audioSfxVolume !== baseline.audioSfxVolume) updates.audio_sfx_volume = draft.audioSfxVolume;
  if (draft.controlsMouseSensitivity !== baseline.controlsMouseSensitivity) updates.mouse_sensitivity = draft.controlsMouseSensitivity;
  if (draft.graphicsQuality !== baseline.graphicsQuality) updates.quality_preset = QUALITY_TO_PRESET[draft.graphicsQuality];
  return updates;
}
