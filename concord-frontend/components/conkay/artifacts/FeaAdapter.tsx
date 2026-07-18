'use client';

// concord-frontend/components/conkay/artifacts/FeaAdapter.tsx
//
// Unit F9 (K5) — the `fea-frame` adapter. Wraps the real `FEAResultViewer` with
// the exact solver output the `detectArtifact` registry produced via the store's
// `feaResultFromRun` — the SAME pure reshape ForwardSimPanel embeds, so the two
// surfaces render byte-identical FEA. Every number here is the solver's own
// computed output (displacements / utilization / stress), never fabricated.
//
// S2-b — "step in": the same reusable orbit↔walk free-cam the creature adapter
// uses, threaded through FEAResultViewer's optional `cameraControls` seam (which
// defaults to plain OrbitControls everywhere else, so ForwardSimPanel is
// unchanged). The walk start pose is derived from the frame's REAL node bounding
// box — you walk through the actual solved geometry at its real metre scale.

import { useEffect, useMemo, useState } from 'react';
import { FEAResultViewer } from '@/components/engineering/FEAResultViewer';
import { detectArtifact, type ConkayFeaArtifact } from '@/lib/conkay/artifact-kinds';
import { lensRun } from '@/lib/api/client';
import type { FeaModel } from '@/lib/conkay/fea-iterate';
import { StepInControls } from './StepInControls';
import { StepInToggle } from './StepInToggle';
import { FeaIterateBar } from './FeaIterateBar';
import { ArtifactProvenance } from './ArtifactProvenance';

/** Max utilization out of the solver summary, or null. Red > 1, green < 1. */
function maxUtil(fea: ConkayFeaArtifact['fea']): number | null {
  const s = fea.summary as { maxUtilization?: unknown } | null;
  const v = s ? Number(s.maxUtilization) : NaN;
  return Number.isFinite(v) ? v : null;
}

/** Frame the walk cam from the real node bounding box: aim at the centroid,
 *  start a step back at mid-height. Pure geometry — no invented dimensions. */
function walkPoseFromNodes(
  nodes: { x: number; y: number; z: number }[],
): { target: [number, number, number]; walkStart: [number, number, number] } {
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const zs = nodes.map((n) => n.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const diag = Math.hypot(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
    Math.max(...zs) - Math.min(...zs),
  );
  const dist = Math.max(diag * 0.6, 2);
  return { target: [cx, cy, cz], walkStart: [cx + dist * 0.5, cy, cz + dist * 0.7] };
}

export function FeaAdapter({ artifact }: { artifact: ConkayFeaArtifact }) {
  const [mode, setMode] = useState<'orbit' | 'walk'>('orbit');
  // S3-c — the working analysis the Iterate loop swaps. Starts as the real
  // solve; a re-solve replaces it. `resolvedFrom` remembers the pre-re-solve
  // max utilization so the frame recolor is backed by an honest before→after
  // number, not just a visual. A fresh artifact prop resets everything.
  const [working, setWorking] = useState<ConkayFeaArtifact>(artifact);
  const [edited, setEdited] = useState(false);
  const [beforeUtil, setBeforeUtil] = useState<number | null>(null);
  useEffect(() => {
    setWorking(artifact);
    setEdited(false);
    setBeforeUtil(null);
  }, [artifact]);

  const fea = working.fea;
  const hasGeometry = fea.nodes.length > 0;
  const pose = useMemo(
    () => (hasGeometry ? walkPoseFromNodes(fea.nodes) : null),
    [hasGeometry, fea.nodes],
  );
  const afterUtil = maxUtil(fea);

  // Re-run the REAL solver with the transformed model, swap in its result.
  const onResolve = async (newInput: { model: FeaModel }): Promise<{ ok: boolean; error?: string }> => {
    try {
      const env = await lensRun('engineering', 'runFEA', newInput);
      if (!env?.data?.ok || !env.data.result) {
        return { ok: false, error: env?.data?.error ?? 'the solve returned no result' };
      }
      const next = detectArtifact('engineering', 'runFEA', newInput, env.data.result);
      if (!next || next.kind !== 'fea-frame') {
        return { ok: false, error: 'the solver returned no renderable frame' };
      }
      setBeforeUtil(maxUtil(working.fea));
      setWorking(next);
      setEdited(true);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'request failed' };
    }
  };
  const revert = () => {
    setWorking(artifact);
    setEdited(false);
    setBeforeUtil(null);
  };

  return (
    <div data-testid="ck-adapter-fea-frame" className="w-full">
      <div className="relative">
        <FEAResultViewer
          nodes={fea.nodes}
          members={fea.members}
          displacements={fea.displacements}
          showStress
          height="340px"
          cameraControls={
            pose ? (
              <StepInControls mode={mode} target={pose.target} walkStart={pose.walkStart} />
            ) : undefined
          }
        />
        {/* Step-in toggle only when there's real geometry to walk through. */}
        {hasGeometry && (
          <StepInToggle
            mode={mode}
            onToggle={() => setMode((m) => (m === 'orbit' ? 'walk' : 'orbit'))}
          />
        )}
      </div>

      {/* Before→after max utilization — the honest number behind the recolor. */}
      {edited && beforeUtil != null && afterUtil != null && (
        <div data-testid="ck-fea-util-delta" className="mt-2 px-1 font-mono text-[11px] text-cyan-100/80">
          max utilization{' '}
          <span className={beforeUtil > 1 ? 'text-rose-300' : 'text-emerald-300'}>{beforeUtil.toFixed(2)}</span>
          {' → '}
          <span className={afterUtil > 1 ? 'text-rose-300' : 'text-emerald-300'}>{afterUtil.toFixed(2)}</span>
          {beforeUtil > 1 && afterUtil <= 1 && <span className="ml-1 text-emerald-300">now passing</span>}
        </div>
      )}

      {hasGeometry && (
        <FeaIterateBar
          sourceInput={working.sourceInput}
          dirty={edited}
          onResolve={onResolve}
          onRevert={revert}
        />
      )}
      <ArtifactProvenance artifact={working} />
      {/* Honest caveat about the NATURE of the numbers — a deterministic model,
          not a certification of real-world behaviour (mirrors ForwardSimPanel). */}
      <div data-testid="ck-adapter-fea-caveat" className="mt-2 px-1 text-[10px] text-amber-300/60">
        Deterministic FEA model — the solver&apos;s exact computed output, not a
        certification of real-world structural behaviour.
      </div>
    </div>
  );
}

export default FeaAdapter;
