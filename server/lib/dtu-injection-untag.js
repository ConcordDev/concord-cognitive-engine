// Plan + apply removal of quarantine:injection-review tags that the
// "none" vs "NONE" scanner bug stamped on DTUs with no real findings.
// Idempotent: a second pass finds nothing to remove.

import { detectContentInjection } from "./dtu-content-injection.js";

export const QUARANTINE_TAG = "quarantine:injection-review";

export function dtuScanText(dtu) {
  const parts = [
    dtu?.title,
    dtu?.content,
    typeof dtu?.creti === "string" ? dtu.creti : "",
    dtu?.cretiHuman,
    dtu?.human?.summary,
    dtu?.summary,
    typeof dtu?.machine?.notes === "string" ? dtu.machine.notes : "",
  ];
  return parts.filter((p) => typeof p === "string" && p).join("\n");
}

export function storedScanHasFindings(dtu) {
  const scan = dtu?.meta?.injectionScan;
  if (!scan || typeof scan !== "object") return false;
  const findings = Array.isArray(scan.findings) ? scan.findings : (Array.isArray(scan.patterns) ? scan.patterns : []);
  const level = String(scan.threatLevel || "").toUpperCase();
  return findings.length > 0 && level !== "" && level !== "NONE";
}

export function planInjectionUntag(dtus, scan = detectContentInjection) {
  const remove = [];
  const keep = [];
  for (const dtu of dtus || []) {
    const tags = Array.isArray(dtu?.tags) ? dtu.tags : [];
    if (!tags.includes(QUARANTINE_TAG)) continue;
    if (storedScanHasFindings(dtu)) {
      keep.push({ id: dtu.id, reason: "stored_findings" });
      continue;
    }
    const result = scan(dtuScanText(dtu));
    if (!result?.injected) {
      remove.push({ id: dtu.id, tags: tags.filter((t) => t !== QUARANTINE_TAG) });
    } else {
      keep.push({ id: dtu.id, reason: "rescan", patterns: result.patterns || [] });
    }
  }
  return { remove, keep };
}

/**
 * Read dtu_store, plan, and (when apply) write tags back.
 * Dry-run returns the plan and writes nothing.
 */
export function applyInjectionUntag(db, { apply = false, scan = detectContentInjection } = {}) {
  const rows = db.prepare("SELECT id, data FROM dtu_store").all();
  const dtus = [];
  for (const row of rows) {
    try {
      const dtu = JSON.parse(row.data);
      if (dtu && dtu.id) dtus.push(dtu);
    } catch {
      /* corrupt row stays untouched */
    }
  }
  const plan = planInjectionUntag(dtus, scan);
  if (!apply) return { ...plan, applied: 0, dryRun: true };

  const update = db.prepare("UPDATE dtu_store SET data = ?, tags = ?, updated_at = ? WHERE id = ?");
  const read = db.prepare("SELECT data FROM dtu_store WHERE id = ?");
  const tx = db.transaction((items) => {
    let n = 0;
    for (const item of items) {
      const row = read.get(item.id);
      if (!row) continue;
      let dtu;
      try { dtu = JSON.parse(row.data); } catch { continue; }
      if (!Array.isArray(dtu.tags) || !dtu.tags.includes(QUARANTINE_TAG)) continue;
      dtu.tags = dtu.tags.filter((t) => t !== QUARANTINE_TAG);
      update.run(JSON.stringify(dtu), JSON.stringify(dtu.tags), new Date().toISOString(), item.id);
      n++;
    }
    return n;
  });
  const applied = tx(plan.remove);
  return { ...plan, applied, dryRun: false };
}
