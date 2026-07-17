// server/lib/shadow-parliament.js
//
// Shadow Parliament — BOUNDED autonomous execution on top of the advisory
// Shadow Reasoning Council (lib/shadow-council.js). Reading docs/GOVERNANCE_
// DESIGN.md §6 first is load-bearing: that section is the owner-reviewed
// "advisory → auto-execute criteria" menu, and this module is the FIRST
// concrete instance of it, gated behind an explicit, default-OFF kill-switch.
// §6's four criteria map directly onto the checks below:
//   1. Unanimity / empty dissent           -> findDissentVeto() below (we use
//      a slightly softer bar than "any dissent at all" — see that function's
//      doc comment for why — but a HIGH-CONFIDENCE dissenting voice is always
//      a hard stop, never advisory-only).
//   2. Bounded, reversible action types    -> PARLIAMENT_ALLOWLIST (default
//      DENY everything not explicitly enumerated).
//   3. A hard spend cap / kill-switch      -> isAutoexecEnabled() +
//      (money is structurally unreachable at all — see below).
//   4. Confidence floor + audit DTU        -> mintAuditDtu(), called BEFORE
//      the action executes, on every autoexec path.
//
// STRUCTURAL, not conventional. `enact()` never lets the action-under-
// deliberation reach the real, unconfined `runMacro`. It always builds a
// FRESH confined ctx (lib/confined-ctx.js) whose capability manifest grants
// EXACTLY ONE macro — the single allow-listed action about to run — so even
// if the executing macro's own code tried to call something else through
// this ctx, there would be nothing else to reach. Money is additionally
// covered by confined-ctx.js's own hard NEVER_ALLOW denylist
// (economy.mint/withdraw/transfer — belt-and-suspenders on top of the
// allow-list, per confined-ctx.js's header comment); the allow-list itself is
// what keeps auth and destructive/irreversible actions out, since
// confined-ctx.js's domain whitelist alone does not know which macros within
// an allowed domain are destructive (e.g. `dtu` is a whitelisted domain and
// contains BOTH `dtu.create` [reversible, allow-listed here] and
// `dtu.delete` [irreversible, NEVER allow-listed] — the per-macro exact grant
// is what tells them apart, not the domain).
//
// Extending PARLIAMENT_ALLOWLIST is a deliberate, reviewed act: add an entry
// with a `key` ("domain.macro"), a `reversible` string EXPLAINING (not just
// asserting) why a human can always undo it, and a `validateInput` that
// keeps the action inside a narrow, safe input shape even within that one
// macro. Do not add domain-wide grants ("dtu.*") — always the exact macro.

import { createDTU } from "../economy/dtu-pipeline.js";
import { makeConfinedCtx } from "./confined-ctx.js";

// ── Kill-switch (§6.2 criterion 3) ──────────────────────────────────────────
// Default OFF. Nothing in this module executes anything unless an operator
// has explicitly opted in.
export function isAutoexecEnabled() {
  const v = process.env.CONCORD_SHADOW_PARLIAMENT_AUTOEXEC;
  return v === "true" || v === "1";
}

// ── Dissent-veto circuit breaker (§6.2 criterion 1) ─────────────────────────
//
// docs/GOVERNANCE_DESIGN.md §6.2's criterion 1 is literally "unanimous, empty
// dissent array." We implement a threshold-based version of the same idea:
// ordinary dissent (a voice landing in `needs_more_data`, or a mild `reject`)
// does not by itself prove the action is unsafe — the Opposer voice is
// DESIGNED to be adversarial (council-voices.js's `votingTendency:
// "adversarial"` multiplies its score by 0.75 unconditionally), so it leans
// "reject" on almost every proposal by construction; treating that alone as
// an absolute veto would make autoexec permanently inert. What DOES have to
// be an absolute veto is a voice rejecting at HIGH CONFIDENCE — a score at or
// below DISSENT_VETO_SCORE (well under the 0.4 "reject" cutoff itself, so
// this only fires for a voice that is nearly certain the action is wrong).
// That is a real brake: it is checked BEFORE the allow-list and BEFORE any
// confined ctx is built, so a high-confidence dissenter blocks execution
// unconditionally, with no path around it.
export const DISSENT_VETO_SCORE = Number(process.env.CONCORD_SHADOW_PARLIAMENT_VETO_SCORE) || 0.15;

/**
 * @param {object} deliberation  a shadow-council `deliberate()`-shaped result
 * @param {object} [opts]
 * @param {number} [opts.vetoScore]
 * @returns {{voice,label,vote,score}[]}  voices that veto autoexec (empty = no veto)
 */
export function findDissentVeto(deliberation, { vetoScore = DISSENT_VETO_SCORE } = {}) {
  const voices = deliberation?.voices || {};
  const verdict = deliberation?.verdict;
  const vetoedBy = [];
  for (const [id, v] of Object.entries(voices)) {
    if (!v || v.vote === verdict) continue; // agrees with the verdict — not dissent
    if (v.vote === "reject" && Number(v.score) <= vetoScore) {
      vetoedBy.push({ voice: id, label: v.label, vote: v.vote, score: v.score });
    }
  }
  return vetoedBy;
}

// ── Bounded, reversible action allow-list (§6.2 criterion 2) ───────────────
//
// Default-DENY: `enact()` will not execute anything whose `domain.name` is
// not an exact key in this list, full stop. This is an ALLOW-list, not a
// deny-list of "everything except money" — the initial set below is
// deliberately small. Each entry documents WHY it's reversible; extend this
// list only after the same scrutiny.
export const PARLIAMENT_ALLOWLIST = Object.freeze([
  {
    key: "dtu.create",
    domain: "dtu",
    name: "create",
    reversible:
      "Mints one DTU into the substrate. Undoable by a human via the existing " +
      "dtu.delete macro or the forgetting-engine's tombstone/retention sweep " +
      "(CLAUDE.md 'Key Invariants': originals are tombstoned, preserving " +
      "lineage; the user-initiated dtu:deleted path hard-deletes). It moves no " +
      "money, grants no permission, and mutates no OTHER entity's state — the " +
      "blast radius is exactly one new row a human can later remove. The " +
      "validateInput below further restricts it to DTUs explicitly tagged as " +
      "parliament output, so this grant can never be used to mint an " +
      "arbitrary, unmarked DTU.",
    validateInput(input) {
      const i = input && typeof input === "object" ? input : {};
      const tags = Array.isArray(i.tags) ? i.tags : [];
      if (!tags.includes("shadow_parliament_action")) {
        return { ok: false, reason: "action_dtu_must_be_tagged_shadow_parliament_action" };
      }
      if (!i.title || typeof i.title !== "string") {
        return { ok: false, reason: "action_dtu_missing_title" };
      }
      if (!i.content && !i.creti) {
        return { ok: false, reason: "action_dtu_missing_content" };
      }
      return { ok: true };
    },
  },
  // Extend here only with the same rigor: exact "domain.macro" key, a real
  // (not asserted) reversibility argument, and a validateInput that narrows
  // the input shape as tightly as the action allows. NEVER a "domain.*"
  // grant — see the module header comment for why (dtu.create vs dtu.delete
  // living in the same domain is exactly the case this guards against).
]);

function matchAllowlistEntry(action) {
  if (!action || typeof action !== "object") return null;
  const domain = String(action.domain || "").toLowerCase();
  const name = String(action.name || "");
  const key = `${domain}.${name}`;
  return PARLIAMENT_ALLOWLIST.find((e) => e.key === key) || null;
}

// ── Audit-by-construction (§6.2 criterion 4) ────────────────────────────────
//
// Minted BEFORE the action executes (enact() calls this only after every gate
// above has already passed, immediately before the confined runMacro call),
// so a citable record of "why the parliament acted" always exists even if the
// execution itself then fails. Uses the SQL-backed `dtus` table (via the same
// createDTU() shadow-council.js already uses for persisted deliberations) —
// deliberately NOT the confined ctx's macro surface, because this is
// first-party, trusted logging code writing its own audit trail, not the
// confined action itself.
function mintAuditDtu(db, { deliberation, action, requesterId }) {
  if (!db || !requesterId) return null;
  try {
    const dissent = Array.isArray(deliberation?.dissent) ? deliberation.dissent : [];
    const body = [
      "Shadow Parliament — autonomous action record",
      "",
      `Question: ${deliberation?.question || "(none)"}`,
      `Verdict: ${deliberation?.verdict} (confidence ${deliberation?.confidence}, unanimous=${!!deliberation?.unanimous})`,
      "",
      `Action executed: ${action?.domain}.${action?.name}`,
      `Action input: ${JSON.stringify(action?.input || {})}`,
      "",
      dissent.length
        ? `Minority report:\n${dissent.map((d) => `  • ${d.label} (${d.vote}, score ${d.score}): ${d.concern}`).join("\n")}`
        : "The council was unanimous.",
    ].join("\n");
    const r = createDTU(db, {
      creatorId: requesterId,
      title: `Shadow parliament action: ${String(deliberation?.question || action?.name || "").slice(0, 70)}`,
      content: body,
      contentType: "text",
      lensId: "reason",
      citationMode: "original",
      tags: ["shadow_reasoning", "shadow_parliament", "autoexec", String(deliberation?.verdict || "")],
      metadata: {
        kind: "shadow_reasoning",
        subkind: "autoexec_audit",
        verdict: deliberation?.verdict,
        confidence: deliberation?.confidence,
        unanimous: !!deliberation?.unanimous,
        dissent: dissent.map((d) => d.voice),
        action: { domain: action?.domain, name: action?.name },
      },
    });
    return r?.ok && r.dtu?.id ? { dtuId: r.dtu.id } : null;
  } catch {
    return null; // audit is best-effort to mint but its ABSENCE never authorizes execution — see enact()
  }
}

/**
 * Execute a shadow-council verdict's proposed action, but ONLY when every
 * fence below is satisfied. Never throws; every path returns a structured
 * `{ ok, reason, ... }` — an honest failure, never a fabricated success.
 *
 * @param {object} db
 * @param {object} opts
 * @param {object} opts.deliberation  a shadow-council `deliberate()`-shaped
 *   result: `{ ok, verdict, confidence, unanimous, voices, dissent, action }`.
 *   `action` is `{ domain, name, input }` — the macro call under judgment.
 * @param {object} [opts.ctx]  the CALLER's context (e.g. a macro ctx or a
 *   heartbeat-supplied identity) — used ONLY to read `userId`/`actor.userId`
 *   and, if present, `runMacro`/`llm` for dependency injection. This raw ctx
 *   is NEVER handed to the action; `enact()` always builds a brand-new
 *   confined ctx from these pieces before executing anything.
 * @returns {{ok:boolean, reason?:string, executed?:boolean, result?:object,
 *   auditDtuId?:string|null, action?:object, vetoedBy?:object[]}}
 */
export async function enact(db, { deliberation, ctx = {} } = {}) {
  if (!isAutoexecEnabled()) {
    return { ok: false, reason: "autoexec_disabled" };
  }
  if (!deliberation || deliberation.ok !== true) {
    return { ok: false, reason: "invalid_deliberation" };
  }
  if (deliberation.verdict !== "accept") {
    return { ok: false, reason: "verdict_not_accept", verdict: deliberation.verdict || null };
  }

  const vetoedBy = findDissentVeto(deliberation);
  if (vetoedBy.length > 0) {
    return { ok: false, reason: "dissent_veto", vetoedBy };
  }

  const action = deliberation.action;
  const entry = matchAllowlistEntry(action);
  if (!entry) {
    return { ok: false, reason: "action_not_in_parliament_allowset", action: action || null };
  }

  const shapeCheck = entry.validateInput(action.input || {});
  if (!shapeCheck.ok) {
    return { ok: false, reason: "action_input_rejected", detail: shapeCheck.reason, action };
  }

  const requesterId = ctx?.actor?.userId || ctx?.userId || deliberation.requesterId || null;
  if (!requesterId) {
    return { ok: false, reason: "no_requester_id" };
  }

  // Audit DTU minted BEFORE execution — a citable record exists even if the
  // action itself then fails to run.
  const audit = mintAuditDtu(db, { deliberation, action, requesterId });

  const realRunMacro = ctx?.runMacro || globalThis.__concordRunMacro;
  if (typeof realRunMacro !== "function") {
    return { ok: false, reason: "runMacro_unavailable", auditDtuId: audit?.dtuId || null };
  }

  // The structural fence: a FRESH confined ctx, manifest-scoped to EXACTLY
  // the one matched allow-list entry. No db handle is passed in (this ctx
  // never gets a scoped KV either — it needs none), so `assertConfined()`
  // holds for it by construction, not merely by the checks above.
  const confined = makeConfinedCtx({
    userId: requesterId,
    runMacro: realRunMacro,
    llm: ctx?.llm,
    // Diagnostic-only DI (see confined-ctx.js's comment at the same site) —
    // never a capability; confined-ctx.js supplies a safe no-op when this is
    // absent, so passing it through when the caller's own ctx has one is a
    // pure quality-of-life improvement, not a security decision.
    log: typeof ctx?.log === "function" ? ctx.log : null,
    manifest: { macros: [entry.key] },
  });

  let execResult;
  try {
    execResult = await confined.runMacro(action.domain, action.name, action.input || {});
  } catch (e) {
    return { ok: false, reason: "execution_threw", error: String(e?.message || e), auditDtuId: audit?.dtuId || null };
  }

  return {
    ok: true,
    executed: true,
    action,
    result: execResult,
    auditDtuId: audit?.dtuId || null,
    verdict: deliberation.verdict,
    confidence: deliberation.confidence,
    unanimous: deliberation.unanimous,
  };
}

export default { enact, isAutoexecEnabled, findDissentVeto, DISSENT_VETO_SCORE, PARLIAMENT_ALLOWLIST };
