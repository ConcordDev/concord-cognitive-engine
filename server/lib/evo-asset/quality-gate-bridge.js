// server/lib/evo-asset/quality-gate-bridge.js
// Bridges EvoAsset refinement candidates to the existing Atlas 5-stage
// quality pipeline.
//
// The Atlas pipeline (DRAFT → PROPOSED → VERIFIED → DISPUTED → QUARANTINED)
// is DTU-specific. This bridge wraps an asset variant as a pseudo-DTU so
// the existing `runAutoPromoteGate` checks (structural credibility,
// contradictions, dedup, anti-gaming, lineage cycles) catch visual slop
// the same way they catch knowledge slop.
//
// Asset DTUs use:
//   - domainType:    'visual_artifact'
//   - epistemicClass: 'aesthetic'  (new class, gate has lower factual
//                     thresholds since aesthetics aren't fact-checkable)
//   - lineage:       parent = the asset's previous canonical version
//
// On VERIFIED: caller promotes the version row in evo_asset_versions and
// bumps the asset's quality_level. On DISPUTED/QUARANTINED: candidate
// stays as a non-promoted version row, asset's quality_level unchanged.

/**
 * Wrap a refinement candidate as a pseudo-DTU and submit it to the gate.
 *
 * @param {object} STATE             server STATE map
 * @param {object} candidate         { assetId, passKind, localPath, diffSummary, parentDtuId? }
 * @param {object} deps              { createAtlasDtu, runAutoPromoteGate, promoteAtlasDtu }
 * @returns {Promise<{verdict: 'verified'|'disputed'|'quarantined'|'pending', dtuId?: string}>}
 */
export async function submitAssetCandidateToGate(STATE, candidate, deps) {
  const { createAtlasDtu, runAutoPromoteGate, promoteAtlasDtu } = deps;
  if (!createAtlasDtu || !runAutoPromoteGate || !promoteAtlasDtu) {
    return { verdict: "pending" };
  }

  // Build the pseudo-DTU input. Fields chosen to mirror what the gate
  // already inspects for normal DTUs.
  const dtuInput = {
    title: `${candidate.passKind} refinement of ${candidate.assetId}`,
    summary: candidate.diffSummary || `EvoAsset ${candidate.passKind} candidate`,
    domainType: "visual_artifact",
    epistemicClass: "aesthetic",
    lineage: candidate.parentDtuId
      ? { parents: [candidate.parentDtuId], generation: 1 }
      : { parents: [], generation: 0 },
    machine: {
      kind: "evo_asset_candidate",
      assetId: candidate.assetId,
      passKind: candidate.passKind,
      localPath: candidate.localPath,
    },
    // Tags help the dedup check distinguish refinement candidates from
    // each other.
    tags: ["evo-asset", candidate.passKind, candidate.assetId],
  };

  let dtu;
  try {
    dtu = createAtlasDtu(STATE, dtuInput);
  } catch {
    return { verdict: "pending" };
  }
  if (!dtu?.id) return { verdict: "pending" };

  // Run the gate. The gate either auto-promotes to VERIFIED, leaves at
  // PROPOSED for council review, or quarantines.
  let verdict = "pending";
  try {
    const gateResult = await runAutoPromoteGate(STATE, dtu, "evo_asset");
    if (gateResult?.allowed === true) {
      promoteAtlasDtu(STATE, dtu.id, "VERIFIED", "evo-asset-gate", "PROPOSED");
      verdict = "verified";
    } else if (gateResult?.quarantine) {
      promoteAtlasDtu(STATE, dtu.id, "QUARANTINED", "evo-asset-gate", "PROPOSED");
      verdict = "quarantined";
    } else {
      verdict = "disputed";
    }
  } catch {
    verdict = "pending";
  }

  return { verdict, dtuId: dtu.id };
}
