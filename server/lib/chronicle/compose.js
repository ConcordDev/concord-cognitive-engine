// server/lib/chronicle/compose.js
//
// Living Society — Phase 7: deterministic Chronicle composers.
//
// One composer per beat kind. Each produces a grounded title+body from the
// event payload ONLY — it never invents events the payload doesn't contain, and
// it NEVER includes a secret body (presence flags only), mirroring the
// narrative-bridge invariant. A `CONCORD_CHRONICLE_LLM` overlay can prettify the
// prose but is constrained to the same payload and falls back deterministically.

const SECRET_KEYS = ["secret", "secret_body", "narrative_context", "hidden", "private_body"];

/** Defensive canary: strip any secret-bearing keys from a payload before prose. */
export function scrubSecrets(payload = {}) {
  const out = {};
  for (const [k, v] of Object.entries(payload || {})) {
    if (SECRET_KEYS.some((s) => k.toLowerCase().includes(s))) continue;
    out[k] = v;
  }
  return out;
}

const COMPOSERS = {
  uprising: (p) => ({
    title: `Uprising against ${p.target_id}`,
    body: `${p.members || "Several"} have taken up a shared grievance against ${p.target_id}. What was a complaint is now a movement.`,
    importance: 5,
  }),
  unpaid_flow: (p) => ({
    title: `Wages unpaid in ${p.world_id || "the realm"}`,
    body: `${p.worker_id || "A worker"} went unpaid by ${p.employer_id || "their employer"}. Resentment compounds where the coin does not flow.`,
    importance: 2,
  }),
  fields_untended: (p) => ({
    title: `Fields untended`,
    body: `${p.count || "Some"} plots stand unworked${p.settlement ? ` around ${p.settlement}` : ""}. Where the farmer is gone, the harvest thins.`,
    importance: 3,
  }),
  worker_flight: (p) => ({
    title: `Workers flee`,
    body: `${p.count || "Labourers"} have left their posts${p.settlement ? ` in ${p.settlement}` : ""}. A settlement that cannot pay cannot hold its people.`,
    importance: 3,
  }),
  recruitment: (p) => ({
    title: `A movement grows`,
    body: `The cause against ${p.target_id} found ${p.members || "another"} willing hand. Visibility: ${p.visibility ?? "?"}.`,
    importance: 2,
  }),
  building_progress: (p) => ({
    title: `${p.building_type || "A structure"} rises`,
    body: `Hands raised ${p.building_type || "a building"} to ${p.progress ?? "?"}%.${p.completed ? " It stands." : ""}`,
    importance: 1,
  }),
  vacancy: (p) => ({
    title: `A post falls empty`,
    body: `The ${p.role || "role"} of ${p.settlement || "the settlement"} is vacant. Until it is filled, the work it did goes undone.`,
    importance: 2,
  }),
  decree: (p) => ({
    title: `Decree: ${p.kind || "edict"}`,
    body: `${p.issued_by_id || "The ruler"} issued a ${p.kind || "decree"}. The people will feel it in the ledger.`,
    importance: 2,
  }),
};

/**
 * Compose a chronicle entry. Returns { ok, kind, title, body, importance,
 * dedupeKey } or { ok:false }. Deterministic; secret-scrubbed.
 */
export function composeEntry(kind, payload = {}) {
  const fn = COMPOSERS[kind];
  if (!fn) return { ok: false, reason: "unknown_kind" };
  const clean = scrubSecrets(payload);
  let composed;
  try { composed = fn(clean); } catch { return { ok: false, reason: "compose_failed" }; }
  const dedupeKey = payload.dedupeKey || `${kind}:${payload.id || payload.dedupe_id || JSON.stringify(clean).slice(0, 80)}`;
  // Final canary: refuse to emit a body that leaked a secret marker.
  const body = String(composed.body || "");
  if (SECRET_KEYS.some((s) => body.toLowerCase().includes(s + ":"))) {
    return { ok: false, reason: "secret_leak_blocked" };
  }
  return {
    ok: true, kind,
    title: String(composed.title || kind).slice(0, 200),
    body: body.slice(0, 1000),
    importance: composed.importance || 1,
    dedupeKey: String(dedupeKey).slice(0, 200),
  };
}

export const CHRONICLE_KINDS = Object.freeze(Object.keys(COMPOSERS));
