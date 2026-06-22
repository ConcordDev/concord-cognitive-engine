// server/emergent/literary-license-audit-cycle.js
//
// LRL Phase 3 — license compliance audit. The literary corpus is public-domain by
// construction, but user-uploaded or mirror-added works could slip a non-PD
// license in. This bounded, try/catch-isolated heartbeat scans literary_sources
// and flags anything that is neither public_domain/CC0 nor pd_verified by setting
// pd_verified = -1 ("needs review") so the lens / legal lens can surface it.
//
// Wire-up: registerHeartbeat("literary-license-audit-cycle", { frequency: 480,
//   scope: "global", handler: () => runLiteraryLicenseAuditCycle({ db }) }).
// Kill-switch CONCORD_LITERARY_LICENSE_AUDIT=0.

const PD_LICENSES = new Set(["public_domain", "cc0", "pd", "publicdomain"]);

export async function runLiteraryLicenseAuditCycle({ db } = {}) {
  if (process.env.CONCORD_LITERARY_LICENSE_AUDIT === "0") return { ok: true, skipped: "disabled" };
  if (!db) return { ok: true, skipped: "no_db" };

  let checked = 0;
  let flagged = 0;
  try {
    const rows = db.prepare("SELECT id, license, pd_verified FROM literary_sources").all();
    checked = rows.length;
    const flag = db.prepare("UPDATE literary_sources SET pd_verified = -1 WHERE id = ?");
    const tx = db.transaction(() => {
      for (const r of rows) {
        const lic = String(r.license || "").toLowerCase();
        const isPd = PD_LICENSES.has(lic);
        // Flag only genuinely-suspect rows: not a PD license AND not already
        // human-verified (1). Leave already-flagged (-1) and verified (1) alone.
        if (!isPd && r.pd_verified === 0) {
          flag.run(r.id);
          flagged += 1;
        }
      }
    });
    tx();
  } catch {
    return { ok: true, checked: 0, flagged: 0 };
  }

  return { ok: true, checked, flagged };
}

export default runLiteraryLicenseAuditCycle;
