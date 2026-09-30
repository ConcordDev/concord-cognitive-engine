// lib/conkay/nlp-design-to-world.ts
//
// Free-text → parseDesignIntent → engineering.partMesh (+ optional runFEA tint)
// → Unity apply_mesh. Prefer this over inventing FEA numbers in the browser.
// GLB path intentionally not included in v1.

import {
  parseDesignIntent,
  intentToPartMeshParams,
  intentToFeaModel,
  type DesignIntent,
} from './nlp-design-intent';
import { runPartMeshToWorld, type PartMeshToWorldResult } from './part-mesh-to-world';
import { lensRun } from '@/lib/api/client';
import { feaUtilToColor, type FeaBandColor } from './fea-util-color';
import { applyMesh, unityIframePresent, type ApplyMeshPayload } from './unity-bridge';

export interface NlpDesignToWorldResult {
  ok: boolean;
  error?: string;
  intent?: DesignIntent;
  meshMode: 'apply_mesh';
  partMesh?: PartMeshToWorldResult;
  fea?: {
    maxUtilization?: number;
    color?: FeaBandColor;
    jobId?: string | null;
  };
  applyPosted?: boolean;
  applyId?: string;
  applyPayload?: ApplyMeshPayload;
  source: 'nlp-design-to-world';
}

/**
 * Parse free text → partMesh (+ optional FEA util color from intent-shaped frame)
 * → apply_mesh when Unity iframe present.
 */
export async function runNlpDesignToWorld(opts: {
  text: string;
  spawn?: boolean;
  colorFromFea?: boolean;
}): Promise<NlpDesignToWorldResult> {
  const parsed = parseDesignIntent(opts.text);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, meshMode: 'apply_mesh', source: 'nlp-design-to-world' };
  }
  const intent = parsed.intent;
  const { kind, params } = intentToPartMeshParams(intent);
  const spawn = opts.spawn !== false;
  const colorFromFea = opts.colorFromFea !== false;

  let feaColor: FeaBandColor | undefined;
  let maxUtilization: number | undefined;
  let jobId: string | null | undefined;

  if (colorFromFea) {
    try {
      const model = intentToFeaModel(intent);
      const feaEnv = await lensRun('engineering', 'runFEA', { model });
      const feaData = feaEnv?.data;
      if (feaData?.ok && feaData.result?.summary) {
        maxUtilization = Number(
          (feaData.result.summary as { maxUtilization?: number }).maxUtilization,
        );
        if (Number.isFinite(maxUtilization)) {
          feaColor = feaUtilToColor(maxUtilization!);
        }
        jobId = (feaData.result.jobId as string) ?? null;
      }
    } catch {
      // FEA tint optional
    }
  }

  const partMesh = await runPartMeshToWorld({
    kind,
    params,
    spawn,
    color: feaColor?.hex,
    colorFromFea: false, // already tinted above from intent FEA model
  });

  return {
    ok: partMesh.ok,
    error: partMesh.error,
    intent,
    meshMode: 'apply_mesh',
    partMesh,
    fea: feaColor || maxUtilization != null ? { maxUtilization, color: feaColor, jobId } : undefined,
    applyPosted: partMesh.applyPosted,
    applyId: partMesh.applyId,
    applyPayload: partMesh.applyPayload,
    source: 'nlp-design-to-world',
  };
}

/** Call server POST /api/conkay/design when available; fall back to client path. */
export async function designViaApiOrClient(opts: {
  text: string;
  spawn?: boolean;
}): Promise<NlpDesignToWorldResult> {
  try {
    const { api } = await import('@/lib/api/client');
    const res = await api.post('/api/conkay/design', { text: opts.text });
    const data = res?.data;
    if (data?.ok && data.mesh?.positions && data.mesh?.indices) {
      const intent = data.intent as DesignIntent;
      const color = data.utilColor?.hex || data.utilColor || '#22c55e';
      const applyId = `nlp-api-${Date.now()}`;
      const payload: ApplyMeshPayload = {
        positions: data.mesh.positions,
        indices: data.mesh.indices,
        color: typeof color === 'string' ? color : '#22c55e',
        id: applyId,
        position: { x: 0, y: 1.2, z: 0 },
        scale: 1,
      };
      let applyPosted = false;
      if (opts.spawn !== false && unityIframePresent()) {
        applyPosted = applyMesh(payload, applyId);
      }
      return {
        ok: true,
        intent,
        meshMode: 'apply_mesh',
        fea: data.fea
          ? {
              maxUtilization: data.fea.maxUtilization,
              color: data.utilColor,
              jobId: data.fea.jobId,
            }
          : undefined,
        applyPosted,
        applyId,
        applyPayload: payload,
        source: 'nlp-design-to-world',
      };
    }
  } catch {
    // fall through to client path
  }
  return runNlpDesignToWorld(opts);
}
