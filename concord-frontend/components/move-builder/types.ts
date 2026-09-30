import type { CSSProperties } from 'react';

/** Shared types for move-builder panels — shapes from move-builder.* macros. */
export const ASPECTS = ['power', 'speed', 'area', 'efficiency', 'control'] as const;
export type Aspect = (typeof ASPECTS)[number];
export type Alloc = Record<Aspect, number>;

export interface Catalog { skillKinds: string[]; elements: string[]; aspects: string[]; }
export interface MotionBlock {
  motionFamily: string; motionArchetype: string; effectArchetype: string;
  element: string; resourceGauge: string; leadingLimb: string; targetShape: string;
}
export interface Composed {
  ok: boolean; skillKind: string; element: string; tier: number;
  motion: MotionBlock;
  budget: { ok: boolean; spent: number; budget: number; overspent: boolean; balanced: boolean; dominantAspect: string | null; effective: Record<string, number>; };
}
export interface MintedMove { id: string; name: string; element: string | null; skillKind: string | null; tier: number | null; }
export interface MoveDetail {
  ok: boolean; reason?: string;
  move?: {
    id: string; name: string; element: string | null; skillKind: string | null; tier: number | null;
    allocation: Record<string, number> | null; effective: Record<string, number> | null;
    balanced: boolean | null; motion: MotionBlock | null;
  };
}

export const EMPTY_ALLOC: Alloc = { power: 2, speed: 1, area: 1, efficiency: 1, control: 0 };

export const card: CSSProperties = {
  background: '#1a1a22', border: '1px solid #2a2a35', borderRadius: 10, padding: 16, marginBottom: 16,
};
export const lbl: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, flex: 1, marginBottom: 8 };
export const inp: CSSProperties = { padding: '8px 10px', borderRadius: 8, background: '#13131a', border: '1px solid #333', color: '#e8e4dc' };
export const stepBtn: CSSProperties = { background: '#2a2a35', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' };
export const primaryBtn: CSSProperties = { background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600 };
