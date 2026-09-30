// lib/conkay/part-mesh-to-world.ts
//
// Industrial mesh slice: engineering.partMesh → Unity apply_mesh (MeshFilter).
// Optional FEA util color for the mesh. Honest: triangle push from partMesh /
// feaScene-style arrays — NOT free-text CAD / GLB / full blueprint pipeline.

import { lensRun } from '@/lib/api/client';
import { feaUtilToColor, type FeaBandColor, type FeaUtilBand } from './fea-util-color';
import {
  applyMesh,
  unityIframePresent,
  type ApplyMeshPayload,
} from './unity-bridge';
import { FEA_FRAME } from './fea-beam-to-world';

export type PartMeshKind = 'box' | 'cylinder' | 'tube' | 'sphere' | 'i-beam';

export interface PartMeshToWorldResult {
  ok: boolean;
  error?: string;
  kind?: string;
  vertexCount?: number;
  triangleCount?: number;
  color?: FeaBandColor;
  band?: FeaUtilBand;
  maxUtilization?: number;
  applyPosted?: boolean;
  applyId?: string;
  applyPayload?: ApplyMeshPayload;
  /** Honesty: real MeshFilter path via apply_mesh — not spawn_primitive cube proxy. */
  meshMode: 'apply_mesh';
  jobId?: string | null;
}

const DEFAULT_I_BEAM_PARAMS = {
  flangeWidth: 0.1,
  height: 0.2,
  flangeThickness: 0.012,
  webThickness: 0.008,
  length: 1.0,
} as const;

/**
 * lensRun engineering.partMesh → post apply_mesh to Unity.
 * When colorFromFea is true, also runFEA(FEA_FRAME) and tint mesh by util band.
 */
export async function runPartMeshToWorld(opts?: {
  kind?: PartMeshKind;
  params?: Record<string, number>;
  spawn?: boolean;
  color?: string;
  colorFromFea?: boolean;
  position?: { x: number; y: number; z: number };
  scale?: number | { x: number; y: number; z: number };
}): Promise<PartMeshToWorldResult> {
  const spawn = opts?.spawn !== false;
  const kind = opts?.kind ?? 'i-beam';
  const params =
    opts?.params ??
    (kind === 'i-beam'
      ? { ...DEFAULT_I_BEAM_PARAMS }
      : kind === 'tube' || kind === 'cylinder'
        ? { radius: 0.08, length: 1.0 }
        : { width: 0.2, height: 0.2, length: 1.0 });

  try {
    let colorHex = opts?.color;
    let band: FeaUtilBand | undefined;
    let color: FeaBandColor | undefined;
    let maxUtilization: number | undefined;

    if (opts?.colorFromFea !== false && !colorHex) {
      try {
        const feaEnv = await lensRun('engineering', 'runFEA', { model: FEA_FRAME });
        const feaData = feaEnv?.data;
        if (feaData?.ok && feaData.result?.summary) {
          maxUtilization = Number(
            (feaData.result.summary as { maxUtilization?: number }).maxUtilization,
          );
          if (Number.isFinite(maxUtilization)) {
            color = feaUtilToColor(maxUtilization);
            band = color.band;
            colorHex = color.hex;
          }
        }
      } catch {
        // FEA tint is optional — fall through to default color
      }
    }
    if (!colorHex) {
      color = feaUtilToColor(0.125);
      band = color.band;
      colorHex = color.hex;
    } else if (!color) {
      color = { band: band ?? 'low', hex: colorHex, rgba: { r: 0.133, g: 0.773, b: 0.369, a: 1 } };
    }

    const env = await lensRun('engineering', 'partMesh', { kind, params });
    const data = env?.data;
    if (!data?.ok || !data.result) {
      return {
        ok: false,
        error: data?.error ?? 'partMesh returned no result (auth session may be required)',
        meshMode: 'apply_mesh',
      };
    }
    const result = data.result as {
      kind?: string;
      positions?: number[];
      indices?: number[];
      vertexCount?: number;
      triangleCount?: number;
    };
    const positions = Array.isArray(result.positions) ? result.positions : [];
    const indices = Array.isArray(result.indices) ? result.indices : [];
    if (positions.length < 9 || indices.length < 3) {
      return {
        ok: false,
        error: `partMesh ok but mesh too small (verts=${positions.length / 3}, tris=${indices.length / 3})`,
        meshMode: 'apply_mesh',
      };
    }

    const applyId = `part-mesh-${kind}-${Date.now()}`;
    const payload: ApplyMeshPayload = {
      positions,
      indices,
      color: colorHex,
      id: applyId,
      position: opts?.position ?? { x: 0, y: 1.2, z: 0 },
      scale: opts?.scale ?? 1,
    };

    let applyPosted = false;
    if (spawn) {
      if (!unityIframePresent()) {
        return {
          ok: true,
          kind: result.kind ?? kind,
          vertexCount: result.vertexCount ?? positions.length / 3,
          triangleCount: result.triangleCount ?? indices.length / 3,
          color,
          band,
          maxUtilization,
          applyPosted: false,
          applyId,
          applyPayload: payload,
          meshMode: 'apply_mesh',
          error: 'partMesh ok; Unity iframe not present — apply_mesh skipped',
        };
      }
      applyPosted = applyMesh(payload, applyId);
    }

    return {
      ok: true,
      kind: result.kind ?? kind,
      vertexCount: result.vertexCount ?? positions.length / 3,
      triangleCount: result.triangleCount ?? indices.length / 3,
      color,
      band,
      maxUtilization,
      applyPosted,
      applyId,
      applyPayload: payload,
      meshMode: 'apply_mesh',
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      meshMode: 'apply_mesh',
    };
  }
}
