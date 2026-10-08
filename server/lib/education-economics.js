/**
 * Education Economics — Earning Through Teaching
 *
 * Students are NOT consumers. They're participants in a knowledge
 * economy. Learning is free. Teaching earns.
 *
 * Every reward flows through the wallet service when available. If
 * the wallet service cannot be loaded (e.g. during test harnesses),
 * entries are recorded in an in-memory ledger so the economy still
 * observes what happened and can be reconciled later.
 *
 * Every method is total — none throw. Failures return a structured
 * { ok: false, error } object and the in-memory ledger is still
 * updated so no event is silently lost.
 */

import crypto from "crypto";

// -----------------------------------------------------------------------
// Immutable rate table — the economic constitution of the engine.
// -----------------------------------------------------------------------
export const EDUCATION_RATES = Object.freeze({
  earning: Object.freeze({
    createDTU: 10,
    teachPeer: 5,
    citationReceived: 1,
    assessmentPassed: 3,
    gapFilled: 2,
    hybridConnection: 15,
    contradictionFound: 8,
  }),
  spending: Object.freeze({
    entityTutorSession: 0,   // FREE
    advancedSimulation: 5,
    credentialGeneration: 10,
    cohortFormation: 0,      // FREE
    premiumLens: 0,          // FREE
  }),
});

function nowMs() {
  return Date.now();
}

function newTxId(kind) {
  return `edu_${kind}_${crypto.randomBytes(8).toString("hex")}`;
}

export class EducationEconomics {
  constructor({ db, royaltyCascade, walletService } = {}) {
    this.db = db || null;
    this.royaltyCascade = royaltyCascade || null;
    this.walletService = walletService || null;
    // In-memory ledger — always populated, even when walletService is present.
    // Acts as a durable trail during tests and as a cache in production.
    this.ledger = [];
  }

  // ---------------------------------------------------------------------
  // Internal: credit a wallet + record a ledger entry
  // ---------------------------------------------------------------------
  async _credit(studentId, amount, kind, meta = {}) {
    const safeStudent = String(studentId || "").trim() || "unknown";
    const safeAmount = Number.isFinite(Number(amount)) ? Math.max(0, Number(amount)) : 0;
    const transactionId = newTxId(kind);

    const entry = {
      transactionId,
      studentId: safeStudent,
      kind,
      direction: "credit",
      amount: safeAmount,
      meta,
      at: nowMs(),
      applied: false,
    };

    // Persist to db if available
    if (this.db && typeof this.db.recordEducationTx === "function") {
      try { await this.db.recordEducationTx(entry); } catch (_err) { /* keep going */ }
    }

    // Try wallet service first
    let wallet = this.walletService;
    if (!wallet) {
      try {
        const mod = await import("../economy/coin-service.js");
        if (mod && typeof mod.mintCoins === "function") {
          wallet = { credit: async (uid, amt, m) => mod.mintCoins(uid, amt, m) };
        }
      } catch (_err) {
        wallet = null;
      }
    }

    if (wallet && typeof wallet.credit === "function" && safeAmount > 0) {
      try {
        const r = await wallet.credit(safeStudent, safeAmount, { kind, ...meta, transactionId });
        // A wallet that answers { ok:false } did not move funds.
        entry.applied = !(r && r.ok === false);
        if (!entry.applied) entry.walletError = r.error || r.reason || "wallet_refused";
      } catch (_err) {
        entry.applied = false;
      }
    }

    // Attempt royalty cascade for DTU-related events
    if (meta && meta.dtuId) {
      let cascade = this.royaltyCascade;
      if (!cascade) {
        try {
          const mod = await import("../economy/royalty-cascade.js");
          cascade = mod && (mod.royaltyCascade || mod.default || mod);
        } catch (_err) {
          cascade = null;
        }
      }
      if (cascade && typeof cascade.distribute === "function") {
        try {
          await cascade.distribute({
            dtuId: meta.dtuId,
            amount: safeAmount,
            beneficiary: safeStudent,
            reason: kind,
          });
        } catch (_err) {
          /* cascade is best-effort */
        }
      }
    }

    this.ledger.push(entry);
    return { ok: true, amount: safeAmount, transactionId, applied: entry.applied, ...(entry.walletError ? { walletError: entry.walletError } : {}) };
  }

  // ---------------------------------------------------------------------
  // Internal: charge a wallet + record a debit ledger entry
  // ---------------------------------------------------------------------
  async _charge(studentId, amount, kind, meta = {}) {
    const safeStudent = String(studentId || "").trim() || "unknown";
    const safeAmount = Number.isFinite(Number(amount)) ? Math.max(0, Number(amount)) : 0;
    const transactionId = newTxId(kind);

    const entry = {
      transactionId,
      studentId: safeStudent,
      kind,
      direction: "debit",
      amount: safeAmount,
      meta,
      at: nowMs(),
      applied: false,
    };

    if (this.db && typeof this.db.recordEducationTx === "function") {
      try { await this.db.recordEducationTx(entry); } catch (_err) { /* keep going */ }
    }

    let wallet = this.walletService;
    if (!wallet) {
      try {
        const mod = await import("../economy/coin-service.js");
        if (mod && typeof mod.burnCoins === "function") {
          wallet = { debit: async (uid, amt, m) => mod.burnCoins(uid, amt, m) };
        }
      } catch (_err) {
        wallet = null;
      }
    }

    if (wallet && typeof wallet.debit === "function" && safeAmount > 0) {
      try {
        const r = await wallet.debit(safeStudent, safeAmount, { kind, ...meta, transactionId });
        entry.applied = !(r && r.ok === false);
        if (!entry.applied) entry.walletError = r.error || r.reason || "wallet_refused";
      } catch (_err) {
        entry.applied = false;
      }
    } else if (safeAmount === 0) {
      entry.applied = true;
    }

    this.ledger.push(entry);
    return { ok: true, amount: safeAmount, transactionId, applied: entry.applied, ...(entry.walletError ? { walletError: entry.walletError } : {}) };
  }

  // ---------------------------------------------------------------------
  // Public: earning actions
  // ---------------------------------------------------------------------
  async creditTeaching(teacherId, learnerId, dtuId) {
    try {
      return await this._credit(
        teacherId,
        EDUCATION_RATES.earning.teachPeer,
        "teachPeer",
        { learnerId, dtuId },
      );
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  async creditCreation(studentId, dtuId) {
    try {
      return await this._credit(
        studentId,
        EDUCATION_RATES.earning.createDTU,
        "createDTU",
        { dtuId },
      );
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  async creditCitation(studentId, dtuId, citerId) {
    try {
      return await this._credit(
        studentId,
        EDUCATION_RATES.earning.citationReceived,
        "citationReceived",
        { dtuId, citerId },
      );
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  async creditAssessment(studentId, assessmentId, score) {
    try {
      const passed = Number(score) >= 0.7;
      if (!passed) {
        return { ok: true, amount: 0, transactionId: null, applied: false, skipped: "below_threshold" };
      }
      return await this._credit(
        studentId,
        EDUCATION_RATES.earning.assessmentPassed,
        "assessmentPassed",
        { assessmentId, score: Number(score) },
      );
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  async creditGapFill(studentId, dtuId) {
    try {
      return await this._credit(
        studentId,
        EDUCATION_RATES.earning.gapFilled,
        "gapFilled",
        { dtuId },
      );
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  async creditHybridConnection(studentId, domain1, domain2) {
    try {
      if (!domain1 || !domain2 || domain1 === domain2) {
        return { ok: false, error: "invalid_domains" };
      }
      return await this._credit(
        studentId,
        EDUCATION_RATES.earning.hybridConnection,
        "hybridConnection",
        { domain1, domain2 },
      );
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  async creditContradictionFound(studentId, contradictedDtuId, correctionDtuId) {
    try {
      return await this._credit(
        studentId,
        EDUCATION_RATES.earning.contradictionFound,
        "contradictionFound",
        { contradictedDtuId, correctionDtuId, dtuId: correctionDtuId },
      );
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  // ---------------------------------------------------------------------
  // Public: spending actions
  // ---------------------------------------------------------------------
  async chargeCredentialGeneration(studentId) {
    try {
      return await this._charge(
        studentId,
        EDUCATION_RATES.spending.credentialGeneration,
        "credentialGeneration",
        {},
      );
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  async chargeSimulation(studentId) {
    try {
      return await this._charge(
        studentId,
        EDUCATION_RATES.spending.advancedSimulation,
        "advancedSimulation",
        {},
      );
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  // ---------------------------------------------------------------------
  // Public: introspection & leaderboards
  // ---------------------------------------------------------------------
  async getStudentEarnings(studentId, { since } = {}) {
    try {
      const sinceMs = Number.isFinite(Number(since)) ? Number(since) : 0;
      const entries = this.ledger.filter(
        (e) => e.studentId === studentId && e.direction === "credit" && e.at >= sinceMs,
      );
      const totalsByKind = {};
      let total = 0;
      for (const e of entries) {
        total += e.amount;
        totalsByKind[e.kind] = (totalsByKind[e.kind] || 0) + e.amount;
      }
      return {
        ok: true,
        studentId,
        since: sinceMs,
        total,
        count: entries.length,
        byKind: totalsByKind,
        entries,
      };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  async getLeaderboard({ domain, timeframe = "month" } = {}) {
    try {
      const windowMs = timeframeToMs(timeframe);
      const since = windowMs === 0 ? 0 : nowMs() - windowMs;

      const totals = new Map();
      for (const e of this.ledger) {
        if (e.direction !== "credit") continue;
        if (e.at < since) continue;
        if (domain && e.meta) {
          const domainMatches =
            e.meta.domain === domain ||
            e.meta.domain1 === domain ||
            e.meta.domain2 === domain;
          if (!domainMatches && e.meta.domain !== undefined) continue;
        }
        totals.set(e.studentId, (totals.get(e.studentId) || 0) + e.amount);
      }

      const rows = Array.from(totals.entries())
        .map(([studentId, amount]) => ({ studentId, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 100);

      return { ok: true, timeframe, domain: domain || null, since, rows };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  getRates() {
    return EDUCATION_RATES;
  }
}

function timeframeToMs(timeframe) {
  switch (String(timeframe || "").toLowerCase()) {
    case "day": return 24 * 60 * 60 * 1000;
    case "week": return 7 * 24 * 60 * 60 * 1000;
    case "month": return 30 * 24 * 60 * 60 * 1000;
    case "year": return 365 * 24 * 60 * 60 * 1000;
    case "all":
    case "alltime":
    case "": return 0;
    default: return 30 * 24 * 60 * 60 * 1000;
  }
}

export function createEducationEconomics(deps) {
  return new EducationEconomics(deps || {});
}

export default EducationEconomics;
