/**
 * Quality preset persistence — Wave 1 deferral 5.
 *
 * Quality presets (`'low' | 'medium' | 'high' | 'ultra'`) drive shadow map
 * size, bloom intensity, SSGI on/off, and post-processing toggles. They
 * already exist as a prop on ConcordiaScene, AvatarSystem3D, etc — but
 * there was no UI for the player to set them. This module is the minimal
 * shared persistence layer.
 */

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

const STORAGE_KEY = 'concord-quality-preset';
const DEFAULT_PRESET: QualityPreset = 'medium';

const VALID_PRESETS: QualityPreset[] = ['low', 'medium', 'high', 'ultra'];

function isValidPreset(v: unknown): v is QualityPreset {
  return typeof v === 'string' && (VALID_PRESETS as string[]).includes(v);
}

export function getStoredQualityPreset(): QualityPreset {
  if (typeof window === 'undefined') return DEFAULT_PRESET;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isValidPreset(stored)) return stored;
  } catch { /* localStorage may be unavailable */ }
  return DEFAULT_PRESET;
}

export function setStoredQualityPreset(preset: QualityPreset): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, preset);
  } catch { /* persist is best-effort */ }
}

export const QUALITY_PRESET_DESCRIPTIONS: Record<QualityPreset, string> = {
  low:    'Lowest detail. Best for older hardware or battery saving.',
  medium: 'Balanced detail and performance. Default.',
  high:   'Higher shadow + bloom intensity. Modern desktop GPUs.',
  ultra:  'Maximum detail with PCSS shadows + SSGI. Demanding.',
};
