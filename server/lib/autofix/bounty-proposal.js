// server/lib/autofix/bounty-proposal.js
//
// The generation hop's shaping core (Group B B9 — the Bounties pair;
// founder-ruled 2026-11-05: BUILD the generation hop, generation proposes
// ONLY). Pure: given a registered fix (from ./index.js) and a detector
// finding, decide whether a bounty proposal may be STAGED from them and
// shape the payload the legacy `bounty` domain stores in
// autofix_proposals (status 'pending_review').
//
// It NEVER calls fix.apply — application of any fix stays behind the
// repair doctrine's approval gates (staged proposals, founder approval
// before execution). This module only matches, checks applicability, and
// describes. The finding's file CONTENT is used for the applicability
// check and is never carried into the payload: a staged proposal names
// the file, it does not warehouse its contents.

/** The finding's target file, from whichever field the detector used. */
export function findingFilePath(finding) {
  if (!finding || typeof finding !== "object") return null;
  const raw = finding.filePath || finding.file || finding.path;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/** One staged proposal per (fix, file): the dedupe identity. */
export function proposalDedupeKey(fixId, filePath) {
  return `${fixId}::${filePath}`;
}

/**
 * Shape a staged bounty proposal from a registered fix + a finding.
 * Returns { ok: true, proposalKind, filePath, dedupeKey, payload } or
 * { ok: false, reason } — refusals in words:
 *   fix_not_found · missing_finding · finding_missing_file ·
 *   finding_not_matched · applicability_unverifiable · fix_not_applicable
 */
export function shapeBountyProposal(fix, finding) {
  if (!fix || typeof fix !== "object" || !fix.id) {
    return { ok: false, reason: "fix_not_found" };
  }
  if (!finding || typeof finding !== "object") {
    return { ok: false, reason: "missing_finding" };
  }
  const filePath = findingFilePath(finding);
  if (!filePath) return { ok: false, reason: "finding_missing_file" };

  // Match: the fix must claim this finding — the repair cortex's own
  // routing rule (detector-bridge matches on fixHint + matchFinding).
  if (typeof fix.matchFinding === "function") {
    let matched = false;
    try { matched = !!fix.matchFinding(finding); } catch { matched = false; }
    if (!matched) return { ok: false, reason: "finding_not_matched" };
  } else if (finding.fixHint !== fix.id && finding.id !== fix.id) {
    return { ok: false, reason: "finding_not_matched" };
  }

  // Applicability: checked, never applied. The check needs the file's
  // content; without it the hop refuses rather than guessing.
  if (typeof fix.isApplicable === "function") {
    if (typeof finding.content !== "string") {
      return { ok: false, reason: "applicability_unverifiable" };
    }
    let applicable = false;
    try { applicable = !!fix.isApplicable(filePath, finding.content, finding); }
    catch { applicable = false; }
    if (!applicable) return { ok: false, reason: "fix_not_applicable" };
  }

  let description = null;
  if (typeof fix.describe === "function") {
    try { description = fix.describe(finding); } catch { description = null; }
  }

  const dedupeKey = proposalDedupeKey(fix.id, filePath);
  return {
    ok: true,
    proposalKind: fix.id,
    filePath,
    dedupeKey,
    payload: {
      source: "fix_registry",
      fixId: fix.id,
      fixLabel: fix.label || fix.id,
      riskTier: fix.riskTier || "low",
      description: description || fix.label || fix.id,
      filePath,
      dedupeKey,
      finding: {
        id: finding.id || null,
        detector: finding.detector || null,
        severity: finding.severity || null,
        fixHint: finding.fixHint || null,
      },
    },
  };
}
