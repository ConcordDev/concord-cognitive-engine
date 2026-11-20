// Types for develop.js — the Darkroom pipeline shared byte-for-byte with
// server/lib/darkroom/develop.js (see that file's header).

export type HslBand = 'red' | 'orange' | 'yellow' | 'green' | 'aqua' | 'blue' | 'purple' | 'magenta';
export type CurvePoint = [number, number];
export interface Basic {
  temperature: number; tint: number; exposure: number; contrast: number; highlights: number; shadows: number;
  whites: number; blacks: number; clarity: number; dehaze: number; vibrance: number; saturation: number;
}
export interface MaskAdj { exposure: number; contrast: number; highlights: number; shadows: number; temperature: number; tint: number; saturation: number; clarity: number }
export interface Stroke { pts: CurvePoint[]; size: number; feather: number; flow: number; erase: boolean }
export interface Mask {
  id: string; name: string; kind: 'linear' | 'radial' | 'brush'; invert: boolean; amount: number; adj: MaskAdj;
  linear?: { x1: number; y1: number; x2: number; y2: number };
  radial?: { cx: number; cy: number; rx: number; ry: number; angle: number; feather: number };
  brush?: { strokes: Stroke[] };
}
export interface Spot { x: number; y: number; r: number; sx: number; sy: number; mode: 'heal' | 'clone'; feather: number }
export interface Edit {
  v: number;
  basic: Basic;
  curve: { rgb: CurvePoint[]; r: CurvePoint[]; g: CurvePoint[]; b: CurvePoint[] };
  hsl: Record<HslBand, { h: number; s: number; l: number }>;
  detail: { sharpen: number; radius: number; noise: number };
  effects: { vignette: number };
  geometry: { orient: 0 | 90 | 180 | 270; flipH: boolean; angle: number; crop: { x: number; y: number; w: number; h: number } };
  masks: Mask[];
  spots: Spot[];
}
export interface Img { data: Uint8ClampedArray | Uint8Array; width: number; height: number }
export interface Hist { r: Uint32Array; g: Uint32Array; b: Uint32Array; l: Uint32Array; clippedShadows: number; clippedHighlights: number; samples: number }

export const EDIT_VERSION: number;
export const HSL_BANDS: HslBand[];
export const LIMITS: { masks: number; spots: number; strokes: number; strokePoints: number; curvePoints: number };
export function defaultEdit(): Edit;
export function normalizeEdit(raw: unknown): Edit;
export function isDefaultEdit(raw: unknown): boolean;
export function outputSize(srcW: number, srcH: number, edit: unknown): { width: number; height: number };
export function outputToSourceMatrix(srcW: number, srcH: number, edit: unknown): [number, number, number, number, number, number];
export function outputToSourceNorm(srcW: number, srcH: number, edit: unknown, u: number, v: number): [number, number];
export function sourceNormToOutput(srcW: number, srcH: number, edit: unknown, x: number, y: number): [number, number];
export function curveLUT(points: CurvePoint[], n?: number): Float32Array;
export function whiteBalanceGains(temperature: number, tint: number): [number, number, number];
export function findHealSource(img: Img, spot: { x: number; y: number; r: number }): { sx: number; sy: number };
export function maskWeigher(mask: Mask, srcW: number, srcH: number): (x: number, y: number) => number;
export function develop(src: Img, edit: unknown, opts?: { scale?: number }): { data: Uint8ClampedArray; width: number; height: number };
export function histogram(img: Img, step?: number): Hist;
