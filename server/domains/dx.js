// server/domains/dx.js
//
// DX Platform domain — exposes onboarding progress + a small status query
// surface for the dx-platform lens (concord-frontend/app/lenses/dx-platform).
//
// onboarding_progress reads a few authoritative signals:
//   - api_keys table for the user → has at least one key issued (signed in)
//   - api_usage_log for the user → has at least one logged call (first detector)
//   - economy_ledger for the user → has at least one debit > 0 (first wallet debit)
//
// "installed" is inferred from User-Agent on the request — if the same user
// has hit /api/dx/exchange recently from a vscode/jetbrains client, mark
// the corresponding box. We don't store an "installed" boolean because
// the source of truth is whether the IDE has paired (which it has if it
// signed in at all).

export default function registerDxMacros(register) {
  register("dx", "onboarding_progress", async (ctx) => {
    const userId = ctx?.actor?.userId;
    if (!userId) {
      // Anonymous browser — return all zero so the steps render.
      return { ok: true, progress: { signedIn: false, firstDetector: false, firstDebit: false } };
    }
    const db = ctx?.db;
    if (!db) {
      return { ok: true, progress: { signedIn: false, firstDetector: false, firstDebit: false } };
    }

    let signedIn = false;
    let firstDetector = false;
    let firstDebit = false;
    let installed = { vscode: false, jetbrains: false };

    // (1) Signed in: any non-revoked api_keys row for this user.
    try {
      const row = db.prepare(
        `SELECT COUNT(*) AS c FROM api_keys WHERE user_id = ? AND status = 'active'`
      ).get(userId);
      signedIn = (row?.c ?? 0) > 0;
    } catch {
      // Table may not exist yet on a fresh DB; treat as not-signed-in.
    }

    // (2) First detector: any api_usage_log row for this user.
    try {
      const row = db.prepare(
        `SELECT COUNT(*) AS c FROM api_usage_log WHERE user_id = ?`
      ).get(userId);
      firstDetector = (row?.c ?? 0) > 0;
    } catch { /* best-effort */ }

    // (3) First debit: at least one DEBIT economy_ledger row tied to api_*.
    try {
      const row = db.prepare(`
        SELECT COUNT(*) AS c FROM economy_ledger
         WHERE user_id = ? AND type = 'debit' AND amount > 0
      `).get(userId);
      firstDebit = (row?.c ?? 0) > 0;
    } catch { /* economy_ledger may use a different schema in some envs */ }

    // (4) Installed-extension hint: look at the most recent api_usage_log
    //     metadata_json for the client identifier embedded by the IDE.
    try {
      const recent = db.prepare(`
        SELECT metadata_json FROM api_usage_log
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 25
      `).all(userId);
      for (const r of recent) {
        try {
          const meta = JSON.parse(r.metadata_json || "{}");
          if (meta.client === "vscode") installed.vscode = true;
          else if (meta.client === "jetbrains") installed.jetbrains = true;
        } catch { /* skip rows with malformed metadata */ }
        if (installed.vscode && installed.jetbrains) break;
      }
    } catch { /* best-effort */ }

    return {
      ok: true,
      progress: { signedIn, firstDetector, firstDebit, installed },
    };
  });

  // Sibling: dx.welcome — single-shot greeting the IDE plugin can hit
  // immediately after sign-in to confirm the token works without
  // committing to a full detector run. Returns user identity + free
  // quota remaining for the current month.
  register("dx", "welcome", async (ctx) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, error: "auth_required" };
    const db = ctx?.db;
    if (!db) return { ok: true, userId, freeQuota: null };

    let monthly = null;
    try {
      const yearMonth = new Date().toISOString().slice(0, 7); // "2026-05"
      monthly = db.prepare(`
        SELECT * FROM api_monthly_usage
         WHERE user_id = ? AND month = ?
      `).get(userId, yearMonth);
    } catch { /* table may not exist */ }

    return {
      ok: true,
      userId,
      monthlyUsage: monthly,
      message: "Signed in. Your DX session is active.",
    };
  });
}
