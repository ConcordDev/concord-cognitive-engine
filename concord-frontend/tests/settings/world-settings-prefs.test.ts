import { describe, expect, it } from 'vitest';
import {
  finiteNumber,
  preferenceUpdates,
  settingsFromPrefs,
  type WorldPreferenceSlice,
} from '@/lib/settings/world-settings-prefs';

const BASE: WorldPreferenceSlice = {
  graphicsQuality: 'medium',
  audioMasterVolume: 0.7,
  audioMusicVolume: 0.6,
  audioSfxVolume: 0.8,
  controlsMouseSensitivity: 1,
};

describe('world settings prefs', () => {
  it('uses schema defaults when a key is missing, and keeps an explicit zero', () => {
    expect(settingsFromPrefs(undefined)).toEqual(BASE);
    expect(settingsFromPrefs({})).toEqual(BASE);
    expect(settingsFromPrefs({ audio_master_volume: 0 }).audioMasterVolume).toBe(0);
    expect(finiteNumber('0.4', 0.7)).toBe(0.4);
    expect(finiteNumber('', 0.7)).toBe(0.7);
    expect(finiteNumber('nope', 0.7)).toBe(0.7);
    expect(finiteNumber(null, 0.7)).toBe(0.7);
  });

  it('maps quality presets both ways without writing untouched keys', () => {
    expect(settingsFromPrefs({ quality_preset: 'potato' }).graphicsQuality).toBe('low');
    expect(settingsFromPrefs({ quality_preset: 'ultra' }).graphicsQuality).toBe('ultra');
    expect(settingsFromPrefs({ quality_preset: 'mystery' }).graphicsQuality).toBe('medium');
    expect(preferenceUpdates(BASE, BASE)).toEqual({});
    expect(preferenceUpdates({ ...BASE, graphicsQuality: 'low', audioSfxVolume: 0.2 }, BASE)).toEqual({
      quality_preset: 'potato',
      audio_sfx_volume: 0.2,
    });
    expect(preferenceUpdates({ ...BASE, graphicsQuality: 'high', audioMusicVolume: 0.1, controlsMouseSensitivity: 2 }, BASE)).toEqual({
      quality_preset: 'high',
      audio_music_volume: 0.1,
      mouse_sensitivity: 2,
    });
  });
});
