'use client';

// concord-frontend/components/conkay/panels/ArtifactViewerPanel.tsx
//
// Unit F9 (K5) — the ConKay cockpit's Artifact Viewer panel. A self-contained,
// prop-free surface (panel-registry eligibility bar) that renders the LAST real
// macro artifact ConKay operated on as interactive 3D:
//
//   - It reads `lastArtifact` from the real `conkayHudStore` (F9) via the zustand
//     hook (not `getState()`) so the panel re-renders live as new artifacts land
//     — same discipline as ProvenancePanel/ForwardSimPanel.
//   - `lastArtifact` is set ONLY from ConKayOverlay#executeMacro, via the pure
//     `detectArtifact` registry, from a REAL `lensRun` return — so anything shown
//     here is a genuine artifact of a real backend macro (ar.render / runFEA /
//     foundry.preview / forge.sandbox / a building-shaped result), never a mock.
//   - No artifact yet → an explicit, worded empty state (mirrors ForwardSimPanel's
//     `fs-no-result`), never a placeholder structure or fabricated numbers.
//   - The header states the artifact's kind + real part count + provenance
//     (domain.macro) — all facts off the artifact, not decoration.
//
// The actual kind→adapter dispatch (and the STOP-POINT for an unregistered kind)
// lives in ArtifactViewer; this panel only owns the store read + the empty state.

import { useConkayHudStore } from '../conkayHudStore';
import { artifactKindLabel } from '@/lib/conkay/artifact-kinds';
import { ArtifactViewer } from '../artifacts/ArtifactViewer';

export function ArtifactViewerPanel() {
  const lastArtifact = useConkayHudStore((s) => s.lastArtifact);

  return (
    <div
      data-testid="ck-artifact-viewer-panel"
      className="mx-auto mt-2 max-w-2xl rounded-xl border border-cyan-400/15 bg-black/30 p-3"
    >
      <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-cyan-300/50">artifact viewer</div>

      {lastArtifact ? (
        <div data-testid="ck-artifact-present">
          {/* Header — real facts off the artifact: kind, part count, provenance. */}
          <div
            data-testid="ck-artifact-header"
            data-kind={lastArtifact.kind}
            className="mb-2 flex flex-wrap items-center gap-2 px-1 text-[11px]"
          >
            <span className="rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-2 py-0.5 text-cyan-100">
              {artifactKindLabel(lastArtifact.kind)}
            </span>
            <span data-testid="ck-artifact-partcount" className="text-cyan-300/60">
              {lastArtifact.components.length} part{lastArtifact.components.length === 1 ? '' : 's'}
            </span>
            <span className="ml-auto text-cyan-300/40">
              {lastArtifact.sourceDomain}.{lastArtifact.sourceMacro}
            </span>
          </div>
          <ArtifactViewer artifact={lastArtifact} />
        </div>
      ) : (
        <div data-testid="ck-artifact-empty" className="px-1 py-2 text-[11px] text-white/40">
          No artifact to inspect yet. Operate a lens that produces one (an AR scene,
          a structural FEA solve, a Foundry world preview, or a Forge app) with the
          cockpit open and it will render here as interactive 3D.
        </div>
      )}
    </div>
  );
}

export default ArtifactViewerPanel;
