// server/lib/detectors/dtu-lineage-detector.js
//
// Runtime detector: scans the live DTU graph for:
//   - DTUs with parent_dtu_id pointing to a non-existent parent (orphan)
//   - citation loops (A→B→A)
//   - cascade depth > MAX_CASCADE_DEPTH (50)
//   - dangling royalty entries in economy_ledger with no source DTU
//
// Read-only — never mutates rows. Each finding includes the affected DTU id
// in `subject` so repair-cortex can decide what to fix.

import { makeReport, makeError } from "./_framework.js";

const MAX_DEPTH = 50;
const ROW_CAP = 5000; // bound work for very large corpora

export async function runDtuLineageDetector({ db, opts = {} } = {}) {
  const t0 = Date.now();
  if (!db) return makeError("dtu-lineage", "no_db", null, t0);

  const cap = Number.isFinite(opts.cap) ? opts.cap : ROW_CAP;
  const findings = [];

  try {
    // Detect tables we need
    const tables = new Set(
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name),
    );

    if (!tables.has("dtus")) {
      return makeReport("dtu-lineage", [{
        id: "dtu_table_missing",
        severity: "info",
        kind: "semantic",
          category: "dtu-lineage",
        message: "dtus table not present (fresh install or test DB)",
      }], t0);
    }

    // Probe schema once
    const dtuColumns = new Set(
      db.prepare(`PRAGMA table_info(dtus)`).all().map(r => r.name),
    );
    const parentCol = dtuColumns.has("parent_dtu_id") ? "parent_dtu_id"
                    : dtuColumns.has("parentId") ? "parentId"
                    : dtuColumns.has("parent_id") ? "parent_id"
                    : null;

    // ── 1. Orphan DTUs (parent points to nothing) ─────────────────────
    if (parentCol) {
      const orphans = db.prepare(`
        SELECT id, ${parentCol} AS parent
        FROM dtus
        WHERE ${parentCol} IS NOT NULL
          AND ${parentCol} NOT IN (SELECT id FROM dtus)
        LIMIT ?
      `).all(cap);
      for (const r of orphans) {
        findings.push({
          id: "dtu_orphan",
          severity: "medium",
          kind: "semantic",
          category: "dtu-lineage",
          subject: { kind: "dtu", id: r.id },
          message: `DTU ${r.id} references missing parent ${r.parent}`,
          fixHint: "null_parent_or_attach_replacement",
          evidence: { parent: r.parent },
        });
      }
    }

    // ── 2. Citation loops ─────────────────────────────────────────────
    if (tables.has("royalty_lineage")) {
      const cols = new Set(db.prepare(`PRAGMA table_info(royalty_lineage)`).all().map(r => r.name));
      if (cols.has("child_id") && cols.has("parent_id")) {
        // A citation row means child_id cites parent_id; a loop is the mutual pair.
        const loops = db.prepare(`
          SELECT a.child_id AS x, a.parent_id AS y
          FROM royalty_lineage a
          JOIN royalty_lineage b
            ON b.child_id = a.parent_id
           AND b.parent_id = a.child_id
          LIMIT ?
        `).all(cap);
        const seen = new Set();
        for (const r of loops) {
          const key = [r.x, r.y].sort().join(":");
          if (seen.has(key)) continue;
          seen.add(key);
          findings.push({
            id: "dtu_citation_loop",
            severity: "high",
            kind: "semantic",
          category: "dtu-lineage",
            subject: { kind: "dtu_pair", a: r.x, b: r.y },
            message: `Bidirectional citation loop ${r.x} ↔ ${r.y}`,
            fixHint: "break_one_edge",
          });
        }
      }
    }

    // ── 3. Cascade depth overflow ─────────────────────────────────────
    if (parentCol) {
      // Walk up to MAX_DEPTH+1 from a sample of leaf DTUs.
      const sample = db.prepare(`
        SELECT id, ${parentCol} AS parent FROM dtus
        WHERE ${parentCol} IS NOT NULL LIMIT ?
      `).all(Math.min(cap, 500));

      const parentLookup = db.prepare(`SELECT ${parentCol} AS parent FROM dtus WHERE id = ?`);
      let overflowing = 0;
      for (const row of sample) {
        let depth = 1;
        let cur = row.parent;
        const visited = new Set([row.id]);
        while (cur && depth <= MAX_DEPTH + 1) {
          if (visited.has(cur)) break;       // self-loop, handled above
          visited.add(cur);
          const next = parentLookup.get(cur);
          if (!next || next.parent == null) break;
          cur = next.parent;
          depth++;
        }
        if (depth > MAX_DEPTH) {
          overflowing++;
          findings.push({
            id: "dtu_cascade_overflow",
            severity: "high",
            kind: "semantic",
          category: "dtu-lineage",
            subject: { kind: "dtu", id: row.id },
            message: `DTU ${row.id} cascade depth ≥ ${depth} exceeds MAX_CASCADE_DEPTH=${MAX_DEPTH}`,
            evidence: { depth },
          });
          if (overflowing > 50) break;
        }
      }
    }

    // ── 4. Royalty ledger orphans ────────────────────────────────────
    if (tables.has("economy_ledger")) {
      const cols = new Set(db.prepare(`PRAGMA table_info(economy_ledger)`).all().map(r => r.name));
      const refCol = cols.has("source_dtu_id") ? "source_dtu_id"
                   : cols.has("ref_dtu_id") ? "ref_dtu_id"
                   : null;
      if (refCol) {
        const orphans = db.prepare(`
          SELECT id, ${refCol} AS ref FROM economy_ledger
          WHERE ${refCol} IS NOT NULL
            AND ${refCol} NOT IN (SELECT id FROM dtus)
          LIMIT ?
        `).all(cap);
        for (const r of orphans) {
          findings.push({
            id: "royalty_ledger_orphan",
            severity: "medium",
            kind: "semantic",
          category: "dtu-lineage",
            subject: { kind: "ledger_entry", id: r.id },
            message: `Ledger entry ${r.id} references missing DTU ${r.ref}`,
            evidence: { ref: r.ref },
          });
        }
      }
    }

    // Headline summary
    findings.unshift({
      id: "dtu_lineage_summary",
      severity: "info",
      kind: "semantic",
          category: "dtu-lineage",
      message: `Found ${findings.length} lineage issues`,
      evidence: { byKind: countByRule(findings) },
    });

    return makeReport("dtu-lineage", findings, t0);
  } catch (err) {
    return makeError("dtu-lineage", "exception", err, t0);
  }
}

function countByRule(findings) {
  const out = {};
  for (const f of findings) out[f.id] = (out[f.id] || 0) + 1;
  return out;
}
