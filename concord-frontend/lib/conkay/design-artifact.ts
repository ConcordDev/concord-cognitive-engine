// lib/conkay/design-artifact.ts
//
// The designs pages' pure adapter to the ConKay artifact pipeline: map what a
// design surface actually carries into a canonical `ConkayArtifact` (or null)
// by REUSING the registry in lib/conkay/artifact-kinds.ts — `detectArtifact`
// and its normalizers are the one reshape; nothing here re-derives a viewer
// shape or invents a field.
//
// Sources, honestly audited (nothing is fabricated, nothing is guessed):
//   - a showcase DesignSnapshot (server/lib/conkay/showcase/snapshots/*.json,
//     served by server/routes/conkay-demo.js): receipts only — margins with
//     utilization per check, solver titles, files. No node coordinates, no
//     member connectivity, no displacements. There is no honest 3D artifact
//     in a snapshot, so the adapter returns null (the section simply does not
//     render), never a stand-in.
//   - a workbench view's `feaFrame` (server chat/workbench.js feaFrameOf):
//     one load case of the conversation's own structure.frame run as the
//     engineering.runFEA path consumes it. That maps to the `fea-frame` kind
//     through the existing `normalizeFea` (which reuses `feaResultFromRun`),
//     so the DesignBuilder's FEA section is byte-identical to the ForwardSim /
//     artifact-panel render, and FeaAdapter's Iterate bar can re-run the REAL
//     solver (`lensRun('engineering','runFEA', …)`) on the model it carries.

import { detectArtifact, type ConkayArtifact } from '@/lib/conkay/artifact-kinds';
import type { DesignSnapshot } from '@/lib/conkay/designs-api';
import type { WorkbenchFeaFrame, WorkbenchView } from '@/lib/conkay/workbench-api';

/**
 * A workbench view -> the `fea-frame` artifact its feaFrame field honestly
 * carries, or null when the view has none. The shape passes through the
 * registry's own fea normalizer (detectArtifact on the engineering.runFEA
 * contract); the reused normalizer's provenance is then corrected to the TRUE
 * origin — the workbench's structure.frame run — so the artifact never claims
 * a macro call that did not happen.
 */
export function designArtifactFromWorkbenchView(view: WorkbenchView | null | undefined): ConkayArtifact | null {
  const frame: WorkbenchFeaFrame | null | undefined = view?.feaFrame;
  if (!frame) return null;
  const artifact = detectArtifact('engineering', 'runFEA', frame.model, frame.result);
  if (!artifact) return null; // partial/failed solve ⟹ no half-real preview
  return {
    ...artifact,
    sourceDomain: 'conkay',
    sourceMacro: `workbench ${frame.runId} · case ${frame.case}`,
  };
}

/**
 * A showcase snapshot -> an artifact, or null. Snapshots carry receipts
 * (margins, per-check utilization, solver metadata) but no geometry: no node
 * positions, no member connectivity, no displacements — nothing any
 * registered kind's normalizer can honestly render. Null is the contract, not
 * a fallback: the builder renders no FEA section for a plain snapshot.
 */
export function designArtifactFromSnapshot(_snapshot: DesignSnapshot | null | undefined): ConkayArtifact | null {
  return null;
}

/** Either design surface -> the one artifact it honestly carries (usually none). */
export function designArtifactFrom(
  source: { snapshot?: DesignSnapshot | null; view?: WorkbenchView | null } | null | undefined,
): ConkayArtifact | null {
  if (!source) return null;
  return designArtifactFromWorkbenchView(source.view) ?? designArtifactFromSnapshot(source.snapshot);
}