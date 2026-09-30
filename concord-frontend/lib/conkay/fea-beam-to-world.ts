// lib/conkay/fea-beam-to-world.ts
//
// Industrial slice v1 (honest): FEA_FRAME → engineering.runFEA → util band
// color → Unity WebGL spawn_primitive cube (beam proxy). NOT full CAD.
// Companion path: part-mesh-to-world.ts posts apply_mesh (real MeshFilter).
// This file stays the cube-proxy FEA util→color path (spawn_primitive).

import { lensRun } from '@/lib/api/client';
import { feaUtilToColor, type FeaBandColor, type FeaUtilBand } from './fea-util-color';
import {
  spawnPrimitive,
  unityIframePresent,
  type SpawnPrimitivePayload,
} from './unity-bridge';

/** Same fixture as server/lib/runtime/substrate-oracles.js FEA_FRAME. */
export const FEA_FRAME = {
  nodes: [
    { id: 'N1', x: 0, y: 0, z: 0 },
    { id: 'N2', x: 5, y: 0, z: 0 },
    { id: 'N3', x: 10, y: 0, z: 0 },
  ],
  members: [
    {
      id: 'M1',
      nodeI: 'N1',
      nodeJ: 'N2',
      area: 0.01,
      momentI: 1e-5,
      elasticModulus: 2e11,
      allowableStress: 2.5e8,
    },
    {
      id: 'M2',
      nodeI: 'N2',
      nodeJ: 'N3',
      area: 0.01,
      momentI: 1e-5,
      elasticModulus: 2e11,
      allowableStress: 2.5e8,
    },
  ],
  loads: [{ nodeId: 'N2', Fy: -5000 }],
  supports: [
    { nodeId: 'N1', type: 'fixed', fixedDOF: ['x', 'y', 'z', 'rx', 'ry', 'rz'] },
    { nodeId: 'N3', type: 'fixed', fixedDOF: ['x', 'y', 'z', 'rx', 'ry', 'rz'] },
  ],
} as const;

export interface FeaBeamWorldResult {
  ok: boolean;
  error?: string;
  maxUtilization?: number;
  band?: FeaUtilBand;
  color?: FeaBandColor;
  spawnPosted?: boolean;
  spawnId?: string;
  spawnPayload?: SpawnPrimitivePayload;
  /** Honesty: v1 uses colored cube proxy, not apply_mesh / partMesh. */
  meshMode: 'spawn_primitive_proxy';
  contourSample?: Array<{ id: string; utilization: number; band: string }>;
  jobId?: string | null;
}

/** Build the Unity spawn payload for a solved util (cube scaled as beam proxy). */
export function buildFeaBeamSpawnPayload(
  maxUtilization: number,
  opts?: { position?: { x: number; y: number; z: number }; scale?: number | { x: number; y: number; z: number } },
): { color: FeaBandColor; payload: SpawnPrimitivePayload } {
  const color = feaUtilToColor(maxUtilization);
  const payload: SpawnPrimitivePayload = {
    kind: 'cube',
    // Beam proxy: elongated box along X (frame span is 10m → visual ~2 units).
    position: opts?.position ?? { x: 0, y: 1.25, z: 0 },
    scale: opts?.scale ?? { x: 2.0, y: 0.25, z: 0.25 },
    color: color.hex,
  };
  return { color, payload };
}

/**
 * Run real engineering.runFEA on FEA_FRAME (auth session via lensRun), map
 * maxUtilization → band color, optionally post spawn_primitive to Unity.
 */
export async function runFeaBeamToWorld(opts?: {
  spawn?: boolean;
  model?: typeof FEA_FRAME | Record<string, unknown>;
}): Promise<FeaBeamWorldResult> {
  const spawn = opts?.spawn !== false;
  const model = opts?.model ?? FEA_FRAME;
  try {
    const env = await lensRun('engineering', 'runFEA', { model });
    const data = env?.data;
    if (!data?.ok || !data.result) {
      return {
        ok: false,
        error: data?.error ?? 'runFEA returned no result (auth session may be required)',
        meshMode: 'spawn_primitive_proxy',
      };
    }
    const summary = data.result.summary as { maxUtilization?: number } | undefined;
    const maxUtilization = Number(summary?.maxUtilization);
    if (!Number.isFinite(maxUtilization)) {
      return {
        ok: false,
        error: 'runFEA ok but maxUtilization missing/non-finite',
        meshMode: 'spawn_primitive_proxy',
      };
    }
    const { color, payload } = buildFeaBeamSpawnPayload(maxUtilization);
    const contour = Array.isArray(data.result.contour)
      ? (data.result.contour as Array<{ id?: string; utilization?: number; band?: string }>).map((c) => ({
          id: String(c.id ?? ''),
          utilization: Number(c.utilization) || 0,
          band: String(c.band ?? utilizationBandSafe(Number(c.utilization))),
        }))
      : undefined;

    let spawnPosted = false;
    let spawnId: string | undefined;
    if (spawn) {
      if (!unityIframePresent()) {
        return {
          ok: true,
          maxUtilization,
          band: color.band,
          color,
          spawnPosted: false,
          spawnPayload: payload,
          meshMode: 'spawn_primitive_proxy',
          contourSample: contour,
          jobId: (data.result.jobId as string) ?? null,
          error: 'FEA ok; Unity iframe not present — spawn skipped',
        };
      }
      spawnId = `fea-beam-${Date.now()}`;
      spawnPosted = spawnPrimitive(payload, spawnId);
    }

    return {
      ok: true,
      maxUtilization,
      band: color.band,
      color,
      spawnPosted,
      spawnId,
      spawnPayload: payload,
      meshMode: 'spawn_primitive_proxy',
      contourSample: contour,
      jobId: (data.result.jobId as string) ?? null,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      meshMode: 'spawn_primitive_proxy',
    };
  }
}

function utilizationBandSafe(u: number): string {
  if (u > 1) return 'overstressed';
  if (u > 0.75) return 'high';
  if (u > 0.4) return 'moderate';
  return 'low';
}
