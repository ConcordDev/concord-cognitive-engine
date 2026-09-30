// server/lib/pce/provenance.js
//
// PCE-3 — provenance firewall: every learned artifact knows its source.

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='pce_provenance'`).get();
  } catch {
    return false;
  }
}

const LICENSE_COMPAT = Object.freeze({
  permissive: new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Concord-internal", "Unlicense"]),
  copyleft: new Set(["GPL-2.0", "GPL-3.0", "AGPL-3.0"]),
});

export function registerProvenanceSource(db, source) {
  if (!db || !source?.source_id) return { ok: false, reason: "missing_inputs" };
  if (!tablesReady(db)) return { ok: false, reason: "migration_required" };
  db.prepare(`
    INSERT INTO pce_provenance
      (source_id, repository, commit_hash, path, license, license_confidence, allowed_usage, retrieval_ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      repository = excluded.repository,
      commit_hash = excluded.commit_hash,
      path = excluded.path,
      license = excluded.license,
      license_confidence = excluded.license_confidence,
      allowed_usage = excluded.allowed_usage,
      retrieval_ts = excluded.retrieval_ts
  `).run(
    source.source_id,
    source.repository || null,
    source.commit_hash || null,
    source.path || null,
    source.license || "unknown",
    source.license_confidence ?? 0.5,
    source.allowed_usage || "pattern_extraction_only",
    Math.floor(Date.now() / 1000),
  );
  return { ok: true, sourceId: source.source_id };
}

export function isLicenseCompatible(license, { targetPolicy = "permissive" } = {}) {
  const lic = String(license || "unknown").trim();
  if (targetPolicy === "permissive") {
    return LICENSE_COMPAT.permissive.has(lic);
  }
  return true;
}

export function provenanceGate(db, { pattern, targetPolicy = "permissive" } = {}) {
  const prov = pattern?.provenance || {};
  const license = pattern?.license || prov.license || "unknown";
  if (!isLicenseCompatible(license, { targetPolicy })) {
    return { ok: false, reason: "license_incompatible", license, targetPolicy };
  }
  if (prov.source_id && db && tablesReady(db)) {
    const row = db.prepare(`SELECT allowed_usage FROM pce_provenance WHERE source_id = ?`).get(prov.source_id);
    if (row && row.allowed_usage === "forbidden") {
      return { ok: false, reason: "source_forbidden", sourceId: prov.source_id };
    }
  }
  return { ok: true, license, provenance: prov };
}

export function stripSourceFromGenerationContext(pattern) {
  return {
    pattern_id: pattern.pattern_id || pattern.patternId,
    intent: pattern.intent,
    structural_shape: pattern.structural_shape,
    behavioral_contract: pattern.behavioral_contract,
    invariants: pattern.invariants,
    verification: pattern.verification,
    license: pattern.license,
    provenance: { source_id: pattern.provenance?.source_id, license: pattern.license },
  };
}
