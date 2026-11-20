/** The develop recipe's types and the controls laid out in the right panel. */
export type { Edit, Basic, Mask, MaskAdj, Spot, Stroke, CurvePoint, HslBand, Hist } from '@/lib/photos/develop';
import type { Basic, MaskAdj } from '@/lib/photos/develop';

export interface SliderDef<K extends string> { key: K; label: string; min: number; max: number; step: number; fmt?: (v: number) => string; gradient?: string }

const signed = (v: number) => (v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`);
const ev = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`;

export const WB: SliderDef<keyof Basic>[] = [
  { key: 'temperature', label: 'Temp', min: -100, max: 100, step: 1, fmt: signed, gradient: 'linear-gradient(90deg,#4f8fd8,#d8d8d8,#e7b04a)' },
  { key: 'tint', label: 'Tint', min: -100, max: 100, step: 1, fmt: signed, gradient: 'linear-gradient(90deg,#55b15a,#d8d8d8,#c35fc4)' },
];
export const TONE: SliderDef<keyof Basic>[] = [
  { key: 'exposure', label: 'Exposure', min: -5, max: 5, step: 0.01, fmt: ev },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1, fmt: signed },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1, fmt: signed },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1, fmt: signed },
  { key: 'whites', label: 'Whites', min: -100, max: 100, step: 1, fmt: signed },
  { key: 'blacks', label: 'Blacks', min: -100, max: 100, step: 1, fmt: signed },
];
export const PRESENCE: SliderDef<keyof Basic>[] = [
  { key: 'clarity', label: 'Clarity', min: -100, max: 100, step: 1, fmt: signed },
  { key: 'dehaze', label: 'Dehaze', min: -100, max: 100, step: 1, fmt: signed },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, step: 1, fmt: signed },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1, fmt: signed, gradient: 'linear-gradient(90deg,#888,#d86a3a)' },
];
export const MASK_ADJ: SliderDef<keyof MaskAdj>[] = [
  { key: 'exposure', label: 'Exposure', min: -4, max: 4, step: 0.01, fmt: ev },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1, fmt: signed },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1, fmt: signed },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1, fmt: signed },
  { key: 'temperature', label: 'Temp', min: -100, max: 100, step: 1, fmt: signed, gradient: 'linear-gradient(90deg,#4f8fd8,#d8d8d8,#e7b04a)' },
  { key: 'tint', label: 'Tint', min: -100, max: 100, step: 1, fmt: signed, gradient: 'linear-gradient(90deg,#55b15a,#d8d8d8,#c35fc4)' },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1, fmt: signed },
  { key: 'clarity', label: 'Clarity', min: -100, max: 100, step: 1, fmt: signed },
];
export const BAND_COLOURS: Record<string, string> = {
  red: '#e0453a', orange: '#ee8a32', yellow: '#e6cf3a', green: '#4fb04f', aqua: '#3fc1c3', blue: '#3f6fe0', purple: '#8e52d8', magenta: '#d64fb3',
};
export const ASPECTS: { id: string; label: string; ratio: number | null }[] = [
  { id: 'free', label: 'Free', ratio: null }, { id: 'orig', label: 'Original', ratio: -1 },
  { id: '1:1', label: '1 : 1', ratio: 1 }, { id: '4:5', label: '4 : 5', ratio: 4 / 5 }, { id: '3:2', label: '3 : 2', ratio: 3 / 2 },
  { id: '16:9', label: '16 : 9', ratio: 16 / 9 }, { id: '2:3', label: '2 : 3', ratio: 2 / 3 },
];
