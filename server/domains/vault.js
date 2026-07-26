// server/domains/vault.js — TheVault.
//
// A curated archive. People submit creative work, HUMAN curators admit or
// decline it, and admitted works become permanent records.
//
//   submitted -> under_review -> admitted | declined
//   submitted | under_review -> withdrawn        (submitter-initiated)
//
// Durable state machine over migration 396's `vault_submissions` +
// `vault_curators`. The shape is modeled on
// `server/lib/conkay-tool-authoring.js` (proposed -> approved|rejected ->
// revoked), for the reason migration 385's header states: a human's
// one-and-only authored decision cannot live in an in-memory Map the way
// `repair-remediation.js`'s candidates can, because those re-derive from a
// live detector sweep and a curator's sentence re-derives from nothing.
//
// ── The four hard invariants ─────────────────────────────────────────────
//
// 1. NO ADMISSION WITHOUT A NON-EMPTY, HUMAN-AUTHORED CURATOR STATEMENT.
//    `admit()` refuses a missing / empty / whitespace-only statement with an
//    honest `{ ok:false, reason:'curator_statement_required' }`, and
//    migration 396's `chk_vault_admission_requires_human` CHECK makes an
//    admitted row without one structurally impossible even via raw SQL.
//    Belt and braces, because this statement is the whole product.
//
//    This is a NEW column shape for the codebase — every existing governance
//    table carries only a *reject* reason. TheVault inverts it: the YES has
//    to be argued for.
//
// 2. EVERY ADMISSION CARRIES A NAMED HUMAN CURATOR.
//    "AI helps organize evidence. Humans preserve culture." Machine-
//    assembled evidence is welcome and is stored — in its OWN column,
//    `machine_evidence_json`, explicitly labeled, and structurally unable to
//    satisfy the human decision field:
//      (a) `admit()` reads the statement ONLY from its own `curatorStatement`
//          argument; nothing in `machineEvidence` is ever promoted into it.
//      (b) A statement that merely reproduces text already present in the
//          supplied machine evidence is refused
//          (`curator_statement_is_machine_evidence`) — you cannot launder a
//          generated finding into a human verdict by copying it across.
//      (c) The acting curator must be a registered, ACTIVE row in
//          `vault_curators`, whose `role` CHECK admits only the two human
//          roles. There is no machine role. An unregistered actor — which is
//          what any agent/system caller is — gets `not_a_curator`.
//      (d) `curator_statement_by` must equal `admitted_by`: the person who
//          wrote the sentence is the person who made the call.
//    What this deliberately does NOT claim: we cannot inspect arbitrary
//    prose and prove a human typed it. The guarantee offered is structural
//    (separate fields, no promotion path, no machine role, no copy-across),
//    and it is stated as exactly that rather than dressed up as authorship
//    detection.
//
// 3. DECLINES ARE PRIVATE. No public rejection list, ever.
//    `browse()` and `publicRecord()` hard-code `status = 'admitted'` and
//    accept NO status parameter, so there is no argument a caller can pass
//    to widen them. `curatorQueue()` — gated on an active curator — is the
//    only path that returns declined rows, and `mySubmissions()` lets a
//    submitter see the outcome of their own submission (a decline addressed
//    to you is not a public list).
//
// 4. GUEST-CURATOR ATTRIBUTION.
//    Founding curator + invited guest curators. An admission stamps the
//    ACTING curator into `admitted_by` / `admitted_by_role`, and the minted
//    record DTU attributes the statement to them. The founder appears only
//    as `invited_by` on the guest's curator row — never as the inductor of
//    a work they did not induct.
//
// ── DTU convention (verified against this tree, not assumed) ─────────────
//
// The record DTU is written with `type` / `creator_id` / `data` / `world_id`.
// The `dtus` table carries two incompatible historical conventions
// (migration 001's `owner_user_id`/`body_json`/`tags_json`, and migration
// 087's `type`/`creator_id`/`data`) and only the latter is visible to the
// readers that matter here:
//   - `lib/cross-lens-discovery.js#searchDtus` selects `type AS kind` and
//     filters `d.title LIKE ? OR d.data LIKE ?` (its own inline comment
//     records that referencing the alias instead of the real `data` column
//     had silently killed every search). A record written to `body_json`
//     is invisible to discovery.
//   - `lib/dtu-props.js#propPlacementsForWorld` reads
//     `SELECT ... FROM dtus WHERE world_id = ?`. `dtus.world_id` (migration
//     225) is NULLable and most writers leave it null, which would make a
//     Vault record un-walkable in the world lens — so `world_id` is set
//     EXPLICITLY to 'concordia-hub' rather than left to default.
// Honest note on placement: `slotForDtuType` matches on substrings
// (recipe/photo/music/knowledge…) and 'vault_record' hits none of them, so a
// record lands in the default 'plaza' slot — the generic public-prop bucket.
// That is the correct honest default for a public archive record; no
// keyword was invented to game a nicer slot.
//
// ── Lineage, never `parents` ─────────────────────────────────────────────
//
// Declared derivation is taken as `lineage` (an array of parent DTU ids) and
// NEVER as `parents`. Verified in `server/server.js`: `dtu.create` reads
// `const lineage = Array.isArray(input.lineage) ? input.lineage : []` and
// runs the usage-rights consent gate + royalty auto-citation over THAT
// array, whereas `input.parents` only decorates `dtu.lineage.parents` for
// display — server.js's own `dtu.lineage` macro header calls the two fields
// "non-overlapping by historical accident," so `parents` alone registers
// zero royalties and creates no `royalty_lineage` edge. `submit()` therefore
// refuses a `parents` key outright rather than silently accepting a field
// that would strand every ancestor out of the cascade.
//
// Citations are registered through `economy/royalty-cascade.js#registerCitation`
// — the same call `domains/creatures.js` and `domains/gamedesign.js` make —
// one per non-self-owned parent, each result reported truthfully.
//
// TheVault opens EMPTY by design. Nothing here seeds a sample curator,
// submission, or record.

import crypto from "node:crypto";
import { registerCitation } from "../economy/royalty-cascade.js";

// The world every Vault record is placed in. Set explicitly on the DTU —
// see the DTU-convention note above for why leaving it NULL is not an option.
export const VAULT_WORLD_ID = "concordia-hub";
export const VAULT_DTU_TYPE = "vault_record";

// A floor against a one-character placeholder standing in for the archive's
// sacred artifact. Deliberately low: it must not second-guess a curator who
// writes tersely, only reject a non-statement.
export const MIN_CURATOR_STATEMENT_CHARS = 20;

const MAX_STATEMENT_CHARS = 8000;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
const WORK_KINDS = ["writing", "music", "visual", "moving_image", "code", "performance", "other"];

const nowS = () => Math.floor(Date.now() / 1000);
const newId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
const clampLimit = (n) => Math.min(MAX_LIST_LIMIT, Math.max(1, Number(n) || DEFAULT_LIST_LIMIT));
const trimmed = (v) => (typeof v === "string" ? v.trim() : "");

function safeParse(json, fallback) {
  if (typeof json !== "string" || !json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

// ── Admission protection hook (seam for the separately-owned permanence unit) ──
//
// Admission is where a work stops being a submission and becomes permanent,
// so it is where pinning / protection flags belong. That unit is owned by
// another agent, so this module does NOT invent a flag format: it exposes a
// clearly-named registration seam, calls whatever is registered inside the
// admission flow, and reports honestly when nothing is registered
// (`protection: { applied:false, reason:'no_handler_registered' }`) rather
// than stamping a flag that nothing honours.
//
// Contract for the permanence unit: the handler receives
// `{ db, submissionId, recordDtuId, submitterId, curatorId, worldId }` and
// returns a JSON-serializable flags object (or null). Its return value is
// persisted verbatim to `vault_submissions.protection_flags_json`. A throwing
// handler never rolls back the human's admission — the decision stands and
// the failure is reported.
let _admissionProtectionHandler = null;

/** Register the permanence/pinning handler invoked on every admission. Pass null to clear. */
export function setAdmissionProtectionHandler(fn) {
  _admissionProtectionHandler = typeof fn === "function" ? fn : null;
  return { ok: true, registered: !!_admissionProtectionHandler };
}

/** Read the currently-registered admission protection handler (null when none). */
export function getAdmissionProtectionHandler() {
  return _admissionProtectionHandler;
}

// ── Curators ──────────────────────────────────────────────────────────────

/** Read a curator row, or null. Never throws on a minimal/legacy DB. */
export function getCurator(db, curatorId) {
  if (!db || !curatorId) return null;
  try {
    return db.prepare(`SELECT * FROM vault_curators WHERE curator_id = ?`).get(String(curatorId)) || null;
  } catch { return null; }
}

/** Resolve the acting curator, or the honest reason they may not act. */
function requireActiveCurator(db, curatorId) {
  if (!curatorId) return { ok: false, reason: "curator_required" };
  const curator = getCurator(db, curatorId);
  if (!curator) return { ok: false, reason: "not_a_curator" };
  if (!curator.active) return { ok: false, reason: "curator_retired" };
  return { ok: true, curator };
}

/**
 * Install the founding curator. Exactly one may exist — a second attempt is
 * refused rather than silently overwriting the first, because "who founded
 * this archive" is not a revisable field.
 */
export function installFoundingCurator(db, { curatorId, displayName } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const id = trimmed(curatorId);
  const name = trimmed(displayName);
  if (!id) return { ok: false, reason: "missing_curator_id" };
  if (!name) return { ok: false, reason: "missing_display_name" };
  try {
    const existing = db.prepare(`SELECT curator_id FROM vault_curators WHERE role = 'founding_curator'`).get();
    if (existing) return { ok: false, reason: "founding_curator_already_installed", curatorId: existing.curator_id };
    db.prepare(`
      INSERT INTO vault_curators (curator_id, display_name, role, invited_by)
      VALUES (?, ?, 'founding_curator', NULL)
    `).run(id, name.slice(0, 200));
    return { ok: true, curatorId: id, role: "founding_curator" };
  } catch (e) {
    return { ok: false, reason: "install_failed", detail: String(e?.message || e) };
  }
}

/**
 * Invite a guest curator. Invariant 4's setup half: the guest's row records
 * who invited them, and from here on the guest acts in their OWN name — an
 * admission they make is attributed to them, not to the inviter.
 */
export function inviteGuestCurator(db, inviterId, { curatorId, displayName } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const gate = requireActiveCurator(db, inviterId);
  if (!gate.ok) return gate;
  if (gate.curator.role !== "founding_curator") return { ok: false, reason: "only_founding_curator_may_invite" };

  const id = trimmed(curatorId);
  const name = trimmed(displayName);
  if (!id) return { ok: false, reason: "missing_curator_id" };
  if (!name) return { ok: false, reason: "missing_display_name" };
  if (getCurator(db, id)) return { ok: false, reason: "already_a_curator" };

  try {
    db.prepare(`
      INSERT INTO vault_curators (curator_id, display_name, role, invited_by)
      VALUES (?, ?, 'guest_curator', ?)
    `).run(id, name.slice(0, 200), String(inviterId));
    return { ok: true, curatorId: id, role: "guest_curator", invitedBy: String(inviterId) };
  } catch (e) {
    return { ok: false, reason: "invite_failed", detail: String(e?.message || e) };
  }
}

/** Retire a curator. Their past admissions keep their attribution — permanently. */
export function retireCurator(db, actorId, { curatorId, reason } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const gate = requireActiveCurator(db, actorId);
  if (!gate.ok) return gate;
  if (gate.curator.role !== "founding_curator") return { ok: false, reason: "only_founding_curator_may_retire" };
  const target = getCurator(db, curatorId);
  if (!target) return { ok: false, reason: "not_a_curator" };
  if (target.role === "founding_curator") return { ok: false, reason: "founding_curator_cannot_be_retired" };
  if (!target.active) return { ok: false, reason: "already_retired" };
  try {
    db.prepare(`
      UPDATE vault_curators SET active = 0, retired_at = unixepoch(), retire_reason = ? WHERE curator_id = ?
    `).run(trimmed(reason).slice(0, 500) || null, String(curatorId));
    return { ok: true, curatorId: String(curatorId), status: "retired" };
  } catch (e) {
    return { ok: false, reason: "retire_failed", detail: String(e?.message || e) };
  }
}

/** Public roster of who vouches for this archive. Retired curators included, honestly flagged. */
export function listCurators(db) {
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT curator_id, display_name, role, invited_by, invited_at, active, retired_at
      FROM vault_curators ORDER BY role = 'founding_curator' DESC, invited_at ASC
    `).all();
  } catch { return []; }
}

// ── Submission ────────────────────────────────────────────────────────────

/** Raw row read, curator/owner-scoped callers only. */
function getSubmissionRow(db, submissionId) {
  if (!db || !submissionId) return null;
  try {
    return db.prepare(`SELECT * FROM vault_submissions WHERE id = ?`).get(String(submissionId)) || null;
  } catch { return null; }
}

/**
 * Submit a work for consideration. Nothing is admitted here — submission is
 * not admission, and the record only exists once a human says so.
 */
export function submit(db, submitterId, input = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const submitter = trimmed(submitterId);
  if (!submitter) return { ok: false, reason: "missing_submitter" };

  // See the header: `parents` alone registers zero royalties and creates no
  // royalty_lineage edge. Refuse it loudly instead of accepting a field whose
  // silent failure mode is "the ancestors never get paid".
  if (input && Object.prototype.hasOwnProperty.call(input, "parents")) {
    return { ok: false, reason: "use_lineage_not_parents" };
  }

  const title = trimmed(input.title);
  if (!title) return { ok: false, reason: "missing_title" };

  const workKind = trimmed(input.workKind) || "other";
  if (!WORK_KINDS.includes(workKind)) return { ok: false, reason: "invalid_work_kind", allowed: WORK_KINDS };

  const lineage = Array.isArray(input.lineage)
    ? input.lineage.map((p) => (typeof p === "string" ? p : p?.id)).filter(Boolean).map(String)
    : [];

  const id = newId("vsub");
  try {
    db.prepare(`
      INSERT INTO vault_submissions
        (id, submitter_id, title, work_kind, description, body, source_dtu_id, lineage_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted')
    `).run(
      id, submitter, title.slice(0, 300), workKind,
      trimmed(input.description).slice(0, 4000),
      typeof input.body === "string" ? input.body.slice(0, 200000) : "",
      trimmed(input.sourceDtuId) || null,
      JSON.stringify(lineage),
    );
  } catch (e) {
    return { ok: false, reason: "submit_failed", detail: String(e?.message || e) };
  }
  return { ok: true, id, status: "submitted", lineage };
}

/** A curator picks up a submission. submitted -> under_review. */
export function openReview(db, submissionId, curatorId) {
  if (!db) return { ok: false, reason: "no_db" };
  const gate = requireActiveCurator(db, curatorId);
  if (!gate.ok) return gate;
  const row = getSubmissionRow(db, submissionId);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "submitted") return { ok: false, reason: "wrong_state", status: row.status };
  db.prepare(`
    UPDATE vault_submissions
    SET status = 'under_review', review_opened_at = unixepoch(), review_opened_by = ?
    WHERE id = ?
  `).run(String(curatorId), row.id);
  return { ok: true, id: row.id, status: "under_review", reviewOpenedBy: String(curatorId) };
}

/**
 * Submitter-initiated removal. Available while the work is still under
 * consideration only — once admitted, the record is permanent, which is the
 * whole promise of the archive, so a withdrawal request after admission is
 * refused honestly rather than quietly ignored.
 */
export function withdraw(db, submissionId, submitterId, reason = null) {
  if (!db) return { ok: false, reason: "no_db" };
  const row = getSubmissionRow(db, submissionId);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.submitter_id !== String(submitterId || "")) return { ok: false, reason: "not_submitter" };
  if (row.status === "admitted") return { ok: false, reason: "admitted_records_are_permanent" };
  if (row.status !== "submitted" && row.status !== "under_review") {
    return { ok: false, reason: "wrong_state", status: row.status };
  }
  db.prepare(`
    UPDATE vault_submissions
    SET status = 'withdrawn', withdrawn_at = unixepoch(), withdraw_reason = ?
    WHERE id = ?
  `).run(trimmed(reason).slice(0, 500) || null, row.id);
  return { ok: true, id: row.id, status: "withdrawn" };
}

// ── Invariant 2 helper: machine evidence can never BE the statement ───────

/** Collect every string in an arbitrary JSON-ish value (bounded depth). */
function collectStrings(value, out = [], depth = 0) {
  if (depth > 8 || out.length > 2000) return out;
  if (typeof value === "string") { out.push(value); return out; }
  if (Array.isArray(value)) { for (const v of value) collectStrings(v, out, depth + 1); return out; }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, out, depth + 1);
  }
  return out;
}

const normalizeForCompare = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();

/**
 * True when the curator's statement merely reproduces text the machine
 * already assembled. Whitespace/case-insensitive, substring in EITHER
 * direction, so neither copy-paste nor light padding launders a generated
 * finding into a human verdict.
 */
export function statementIsMachineEvidence(machineEvidence, statement) {
  const s = normalizeForCompare(statement);
  if (!s) return false;
  for (const raw of collectStrings(machineEvidence)) {
    const e = normalizeForCompare(raw);
    if (e.length < 12) continue; // a short shared token is coincidence, not laundering
    if (e.includes(s) || s.includes(e)) return true;
  }
  return false;
}

// ── Admission — the load-bearing transition ───────────────────────────────

/**
 * Admit a submission into TheVault.
 *
 * Enforces invariants 1, 2 and 4 (3 is a read-path property; see browse()).
 * On success the work becomes a permanent `vault_record` DTU, declared
 * lineage is cited through the real royalty cascade, and the registered
 * permanence handler (if any) is offered the record.
 *
 * The status flip and the record mint happen in ONE transaction: an
 * admission whose record could not be written is not an admission, so it
 * rolls back wholly and returns `record_mint_failed` rather than leaving an
 * "admitted" row pointing at nothing.
 */
export function admit(db, submissionId, opts = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const { curatorId, curatorStatement, machineEvidence = null } = opts || {};
  if (!submissionId) return { ok: false, reason: "missing_submission_id" };

  // Invariant 2 — a named, registered, ACTIVE human curator. An agent or
  // system actor is not in vault_curators, so it lands on `not_a_curator`.
  const gate = requireActiveCurator(db, curatorId);
  if (!gate.ok) return gate;
  const curator = gate.curator;

  // Invariant 1 — the sacred artifact. Missing / empty / whitespace-only all
  // land here, before anything is written.
  const statement = trimmed(curatorStatement);
  if (!statement) return { ok: false, reason: "curator_statement_required" };
  if (statement.length < MIN_CURATOR_STATEMENT_CHARS) {
    return { ok: false, reason: "curator_statement_too_short", minChars: MIN_CURATOR_STATEMENT_CHARS };
  }

  // Invariant 2 — machine-assembled evidence may inform the curator; it may
  // never stand in as the curator's words.
  if (machineEvidence != null && statementIsMachineEvidence(machineEvidence, statement)) {
    return { ok: false, reason: "curator_statement_is_machine_evidence" };
  }

  const row = getSubmissionRow(db, submissionId);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "submitted" && row.status !== "under_review") {
    return { ok: false, reason: "wrong_state", status: row.status };
  }

  const lineage = safeParse(row.lineage_json, []) || [];
  const recordDtuId = newId("dtu_vault");
  const admittedAt = nowS();

  // The record DTU. `type` / `creator_id` / `data` / `world_id` — the only
  // convention `cross-lens-discovery.js#searchDtus` and
  // `dtu-props.js#propPlacementsForWorld` can see (see the header).
  // creator_id is the SUBMITTER — they made the work. The curator's role is
  // the admission, recorded inside `data.core.admission`.
  const data = {
    human: {
      summary: `${row.title} — admitted to TheVault by ${curator.display_name}. ${statement}`,
    },
    core: {
      kind: VAULT_DTU_TYPE,
      vaultSubmissionId: row.id,
      title: row.title,
      workKind: row.work_kind,
      description: row.description || "",
      submitterId: row.submitter_id,
      admission: {
        curatorId: curator.curator_id,
        curatorDisplayName: curator.display_name,
        curatorRole: curator.role,
        invitedBy: curator.invited_by || null,
        admittedAt,
        curatorStatement: statement,
        statementAuthorship: "human",
      },
      // Kept beside the decision, never inside it. Explicitly labeled so no
      // later reader can mistake assembled evidence for the human verdict.
      machineEvidence: machineEvidence ?? null,
      machineEvidenceRole: "organizing_evidence_only__never_a_decision",
      lineage,
    },
    machine: {
      tags: ["vault", VAULT_DTU_TYPE, row.work_kind],
      verifier: "human_curator",
    },
    scope: "public",
  };

  try {
    db.transaction(() => {
      db.prepare(`
        INSERT INTO dtus (id, type, title, creator_id, data, world_id, visibility, tier)
        VALUES (?, ?, ?, ?, ?, ?, 'public', 'regular')
      `).run(
        recordDtuId, VAULT_DTU_TYPE, row.title, row.submitter_id,
        JSON.stringify(data), VAULT_WORLD_ID,
      );
      db.prepare(`
        UPDATE vault_submissions SET
          status = 'admitted',
          admitted_at = ?,
          admitted_by = ?,
          admitted_by_role = ?,
          curator_statement = ?,
          curator_statement_by = ?,
          machine_evidence_json = ?,
          record_dtu_id = ?
        WHERE id = ?
      `).run(
        admittedAt, curator.curator_id, curator.role,
        statement.slice(0, MAX_STATEMENT_CHARS), curator.curator_id,
        machineEvidence == null ? null : JSON.stringify(machineEvidence),
        recordDtuId, row.id,
      );
    })();
  } catch (e) {
    return { ok: false, reason: "record_mint_failed", detail: String(e?.message || e) };
  }

  // Lineage citations — the real royalty cascade, one attempt per
  // non-self-owned parent, each outcome reported truthfully. Never blocks or
  // reverses an admission the human already made.
  const citations = citeLineage(db, { childId: recordDtuId, lineage, creatorId: row.submitter_id });

  // Permanence/pinning seam (owned elsewhere) — honest when unregistered.
  const protection = applyAdmissionProtection(db, {
    submissionId: row.id,
    recordDtuId,
    submitterId: row.submitter_id,
    curatorId: curator.curator_id,
    worldId: VAULT_WORLD_ID,
  });

  return {
    ok: true,
    id: row.id,
    status: "admitted",
    recordDtuId,
    admittedBy: curator.curator_id,
    admittedByRole: curator.role,
    curatorDisplayName: curator.display_name,
    curatorStatement: statement,
    machineEvidenceStored: machineEvidence != null,
    citations,
    protection,
  };
}

/**
 * Invoke the registered permanence handler for a freshly-admitted record and
 * persist whatever flags it returns. Reports `applied:false` with a real
 * reason when nothing is registered or the handler failed — never a
 * fabricated "protected".
 */
export function applyAdmissionProtection(db, ctxIn = {}) {
  if (!_admissionProtectionHandler) return { applied: false, reason: "no_handler_registered" };
  let flags;
  try {
    flags = _admissionProtectionHandler({ db, ...ctxIn });
  } catch (e) {
    return { applied: false, reason: "handler_threw", detail: String(e?.message || e) };
  }
  if (flags == null) return { applied: false, reason: "handler_returned_no_flags" };
  try {
    db.prepare(`UPDATE vault_submissions SET protection_flags_json = ? WHERE id = ?`)
      .run(JSON.stringify(flags), ctxIn.submissionId);
  } catch (e) {
    return { applied: false, reason: "persist_failed", detail: String(e?.message || e) };
  }
  return { applied: true, flags };
}

/** One registerCitation() per non-self-owned declared parent. Mirrors domains/creatures.js#csCiteParents. */
function citeLineage(db, { childId, lineage, creatorId }) {
  const out = [];
  for (const parentId of Array.isArray(lineage) ? lineage : []) {
    let parentDtu = null;
    try {
      parentDtu = db.prepare(
        `SELECT id, owner_user_id, creator_id, visibility, data, world_id FROM dtus WHERE id = ?`,
      ).get(String(parentId)) || null;
    } catch { parentDtu = null; }
    if (!parentDtu) { out.push({ ok: false, parentId, error: "parent_not_found" }); continue; }
    const parentCreatorId = parentDtu.creator_id || parentDtu.owner_user_id || null;
    if (!parentCreatorId) { out.push({ ok: false, parentId, error: "parent_creator_unknown" }); continue; }
    // Self-owned parent: skipped honestly — no royalty with yourself.
    if (parentCreatorId === creatorId) { out.push({ ok: false, parentId, error: "self_owned_skipped" }); continue; }
    try {
      const r = registerCitation(db, {
        childId, parentId: String(parentId), creatorId,
        parentCreatorId, parentDtu, generation: 1,
      });
      out.push(r?.ok ? { ok: true, parentId: String(parentId), lineageId: r.lineageId }
                     : { ok: false, parentId: String(parentId), error: r?.error || "citation_failed" });
    } catch (e) {
      out.push({ ok: false, parentId: String(parentId), error: "citation_error", message: String(e?.message || e) });
    }
  }
  return out;
}

/**
 * Decline a submission. The reason is recorded for the curator record and
 * for the submitter — and goes nowhere else. Invariant 3 lives in the read
 * paths below, which have no argument that can widen them to declines.
 */
export function decline(db, submissionId, opts = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const { curatorId, reason } = opts || {};
  const gate = requireActiveCurator(db, curatorId);
  if (!gate.ok) return gate;
  const declineReason = trimmed(reason);
  if (!declineReason) return { ok: false, reason: "decline_reason_required" };

  const row = getSubmissionRow(db, submissionId);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "submitted" && row.status !== "under_review") {
    return { ok: false, reason: "wrong_state", status: row.status };
  }
  db.prepare(`
    UPDATE vault_submissions
    SET status = 'declined', declined_at = unixepoch(), declined_by = ?, decline_reason = ?
    WHERE id = ?
  `).run(String(curatorId), declineReason.slice(0, 2000), row.id);
  return { ok: true, id: row.id, status: "declined" };
}

// ── Read paths ────────────────────────────────────────────────────────────

/** Shape an admitted row for public consumption. Carries no decline field at all. */
function publicShape(row) {
  return {
    id: row.id,
    title: row.title,
    workKind: row.work_kind,
    description: row.description || "",
    submitterId: row.submitter_id,
    admittedAt: row.admitted_at,
    curatorId: row.admitted_by,
    curatorRole: row.admitted_by_role,
    curatorStatement: row.curator_statement,
    recordDtuId: row.record_dtu_id,
    lineage: safeParse(row.lineage_json, []) || [],
    status: "admitted",
  };
}

/**
 * INVARIANT 3 — the public archive. `status = 'admitted'` is hard-coded and
 * there is deliberately NO status/includeDeclined option, so no caller can
 * widen this into a rejection list. Optional filters (workKind, curatorId,
 * limit) narrow within the admitted set only.
 */
export function browse(db, opts = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const where = [`status = 'admitted'`];
  const params = [];
  const workKind = trimmed(opts.workKind);
  if (workKind && WORK_KINDS.includes(workKind)) { where.push(`work_kind = ?`); params.push(workKind); }
  const curatorId = trimmed(opts.curatorId);
  if (curatorId) { where.push(`admitted_by = ?`); params.push(curatorId); }
  try {
    const rows = db.prepare(`
      SELECT * FROM vault_submissions WHERE ${where.join(" AND ")}
      ORDER BY admitted_at DESC LIMIT ?
    `).all(...params, clampLimit(opts.limit));
    return { ok: true, records: rows.map(publicShape), count: rows.length };
  } catch (e) {
    return { ok: false, reason: "browse_failed", detail: String(e?.message || e) };
  }
}

/** INVARIANT 3 — public single-record read. Anything not admitted is `not_found`, full stop. */
export function publicRecord(db, submissionId) {
  if (!db) return { ok: false, reason: "no_db" };
  let row;
  try {
    row = db.prepare(`SELECT * FROM vault_submissions WHERE id = ? AND status = 'admitted'`).get(String(submissionId || ""));
  } catch (e) { return { ok: false, reason: "read_failed", detail: String(e?.message || e) }; }
  if (!row) return { ok: false, reason: "not_found" };
  return { ok: true, record: publicShape(row) };
}

/**
 * INVARIANT 3 — the curator-scoped path, the ONLY one that returns declines.
 * Gated on an active curator; a non-curator gets `not_a_curator` and no rows.
 */
export function curatorQueue(db, curatorId, opts = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const gate = requireActiveCurator(db, curatorId);
  if (!gate.ok) return gate;

  const allowed = ["submitted", "under_review", "admitted", "declined", "withdrawn"];
  const requested = Array.isArray(opts.status) ? opts.status : (opts.status ? [opts.status] : null);
  const statuses = requested ? requested.map(String).filter((s) => allowed.includes(s)) : ["submitted", "under_review"];
  if (statuses.length === 0) return { ok: false, reason: "invalid_status_filter", allowed };

  try {
    const rows = db.prepare(`
      SELECT * FROM vault_submissions
      WHERE status IN (${statuses.map(() => "?").join(",")})
      ORDER BY submitted_at DESC LIMIT ?
    `).all(...statuses, clampLimit(opts.limit));
    return {
      ok: true,
      count: rows.length,
      submissions: rows.map((r) => ({
        id: r.id, title: r.title, workKind: r.work_kind, description: r.description || "",
        submitterId: r.submitter_id, status: r.status, submittedAt: r.submitted_at,
        reviewOpenedBy: r.review_opened_by, lineage: safeParse(r.lineage_json, []) || [],
        curatorStatement: r.curator_statement, admittedBy: r.admitted_by, admittedByRole: r.admitted_by_role,
        machineEvidence: safeParse(r.machine_evidence_json, null),
        // Curator-scoped only — never reachable from browse()/publicRecord().
        declinedBy: r.declined_by, declineReason: r.decline_reason, declinedAt: r.declined_at,
        recordDtuId: r.record_dtu_id, protectionFlags: safeParse(r.protection_flags_json, null),
      })),
    };
  } catch (e) {
    return { ok: false, reason: "queue_failed", detail: String(e?.message || e) };
  }
}

/** A submitter's own submissions, whatever their outcome. Not a public list. */
export function mySubmissions(db, submitterId, opts = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const id = trimmed(submitterId);
  if (!id) return { ok: false, reason: "missing_submitter" };
  try {
    const rows = db.prepare(`
      SELECT * FROM vault_submissions WHERE submitter_id = ?
      ORDER BY submitted_at DESC LIMIT ?
    `).all(id, clampLimit(opts.limit));
    return {
      ok: true,
      count: rows.length,
      submissions: rows.map((r) => ({
        id: r.id, title: r.title, workKind: r.work_kind, status: r.status,
        submittedAt: r.submitted_at, admittedAt: r.admitted_at,
        curatorStatement: r.curator_statement, admittedBy: r.admitted_by, admittedByRole: r.admitted_by_role,
        recordDtuId: r.record_dtu_id,
        // The subject of a decline may read the reason addressed to them.
        declineReason: r.decline_reason, declinedAt: r.declined_at,
      })),
    };
  } catch (e) {
    return { ok: false, reason: "list_failed", detail: String(e?.message || e) };
  }
}

// ── Macro registration ────────────────────────────────────────────────────
//
// Registered through domains/index.js (never server.js — `app` and
// LENS_ACTIONS are declared thousands of lines into that file and top-level
// references to either TDZ at boot; see CLAUDE.md's boot-order hazard note).

export default function registerVaultActions(registerLensAction) {
  // The /api/lens/run path mirrors `input` onto BOTH artifact.data and
  // params; the harness passes params. Read both, params winning.
  const payload = (artifact, params) => ({
    ...(artifact?.data && typeof artifact.data === "object" ? artifact.data : {}),
    ...(params && typeof params === "object" ? params : {}),
  });
  const actor = (ctx) => ctx?.actor?.userId || ctx?.userId || null;
  const dbOf = (ctx) => ctx?.db || globalThis._concordSTATE?.db || null;

  // Shared db-resolution / payload / try-catch envelope. Deliberately a
  // handler DECORATOR, not a registration wrapper: every registerLensAction
  // call below passes its domain AND macro name as adjacent string LITERALS,
  // because `scripts/verify-lens-backends.mjs` discovers macro domains with
  // a regex requiring exactly that. A tidier `action(name, fn)` helper that
  // forwarded the name as a variable registered and dispatched perfectly at
  // runtime while leaving the whole `vault` domain invisible to the static
  // verifier — the same abstraction-defeats-the-scan trap CLAUDE.md records
  // for `_tickRssDomain`. Measured, not assumed: with the helper the
  // verifier reported 546 macro domains, unchanged; with the literals below
  // it reports 547.
  const guarded = (fn) => (ctx, artifact, params) => {
    try {
      const db = dbOf(ctx);
      if (!db) return { ok: false, reason: "no_db" };
      return fn({ db, ctx, p: payload(artifact, params), userId: actor(ctx) });
    } catch (e) {
      return { ok: false, reason: "handler_error", detail: String(e?.message || e) };
    }
  };
  const needsActor = (fn) => guarded((a) => (a.userId ? fn(a) : { ok: false, reason: "no_actor" }));

  registerLensAction("vault", "submit", needsActor(({ db, p, userId }) => submit(db, userId, p)));
  registerLensAction("vault", "withdraw", needsActor(({ db, p, userId }) => withdraw(db, p.submissionId, userId, p.reason)));
  registerLensAction("vault", "my_submissions", needsActor(({ db, p, userId }) => mySubmissions(db, userId, p)));

  // Public reads — admitted records only, by construction (invariant 3).
  registerLensAction("vault", "browse", guarded(({ db, p }) => browse(db, p)));
  registerLensAction("vault", "record", guarded(({ db, p }) => publicRecord(db, p.submissionId || p.id)));
  registerLensAction("vault", "curators", guarded(({ db }) => ({ ok: true, curators: listCurators(db) })));

  // Curator-scoped. Every one of these resolves the acting curator from the
  // AUTHENTICATED actor and never from the payload — a caller cannot name
  // someone else as the curator of their admission, which is what invariants
  // 2 and 4 come down to in practice.
  registerLensAction("vault", "queue", needsActor(({ db, p, userId }) => curatorQueue(db, userId, p)));
  registerLensAction("vault", "open_review", needsActor(({ db, p, userId }) => openReview(db, p.submissionId, userId)));

  registerLensAction("vault", "admit", needsActor(({ db, p, userId }) => admit(db, p.submissionId, {
    curatorId: userId,
    curatorStatement: p.curatorStatement,
    machineEvidence: p.machineEvidence ?? null,
  })));

  registerLensAction("vault", "decline", needsActor(({ db, p, userId }) =>
    decline(db, p.submissionId, { curatorId: userId, reason: p.reason })));

  registerLensAction("vault", "install_founding_curator", needsActor(({ db, p, userId }) =>
    installFoundingCurator(db, { curatorId: userId, displayName: p.displayName })));

  registerLensAction("vault", "invite_curator", needsActor(({ db, p, userId }) =>
    inviteGuestCurator(db, userId, { curatorId: p.curatorId, displayName: p.displayName })));

  registerLensAction("vault", "retire_curator", needsActor(({ db, p, userId }) =>
    retireCurator(db, userId, { curatorId: p.curatorId, reason: p.reason })));
}
