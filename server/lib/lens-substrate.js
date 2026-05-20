// server/lib/lens-substrate.js
//
// Shared per-user "records" substrate for lenses that were calculator-
// or aggregation-only (the audit's THIN tier). Registers a uniform
// four-macro management surface — add / list / delete / dashboard —
// backed by globalThis._concordSTATE so records persist with the rest
// of STATE. One call deepens a thin lens into a real tracked-records
// workspace without bespoke per-domain plumbing.
//
//   registerLensSubstrate(registerLensAction, "ops", {
//     noun: "incident",
//     kinds: ["sev1", "sev2", "sev3", "sev4"],
//     statuses: ["open", "mitigating", "resolved"],
//   });
//
// Macros registered (domain = the lens domain string):
//   <domain>.record-add      { title, kind?, status?, notes?, fields? }
//   <domain>.record-list     { status?, kind? }
//   <domain>.record-update   { id, status?, notes? }
//   <domain>.record-delete   { id }
//   <domain>.record-dashboard

function actorOf(ctx) {
  return ctx?.actor?.userId || ctx?.actor?.id || ctx?.userId || "anon";
}
function clean(v, max = 400) {
  return String(v == null ? "" : v).trim().slice(0, max);
}
function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function saveState() {
  if (typeof globalThis._concordSaveStateDebounced === "function") {
    try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
  }
}

/**
 * registerLensSubstrate — attach a uniform records substrate to a lens.
 * @param {Function} registerLensAction the domain registration fn
 * @param {string} domain the lens domain string (e.g. "ops")
 * @param {object} [opts]
 * @param {string} [opts.noun="record"] singular noun for the record
 * @param {string[]|null} [opts.kinds=null] optional kind whitelist
 * @param {string[]} [opts.statuses=["open","active","done"]] status whitelist
 * @param {string} [opts.idPrefix] id prefix (defaults to first 3 chars of noun)
 */
export function registerLensSubstrate(registerLensAction, domain, opts = {}) {
  const noun = opts.noun || "record";
  const kinds = Array.isArray(opts.kinds) && opts.kinds.length ? opts.kinds : null;
  const statuses = Array.isArray(opts.statuses) && opts.statuses.length
    ? opts.statuses : ["open", "active", "done"];
  const idPrefix = opts.idPrefix || noun.slice(0, 3);
  const stateKey = `${domain.replace(/[^a-z0-9]/gi, "_")}Substrate`;

  function getState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE[stateKey]) STATE[stateKey] = {};
    const s = STATE[stateKey];
    if (!(s.items instanceof Map)) s.items = new Map(); // userId -> Array
    return s;
  }
  function listFor(s, userId) {
    if (!s.items.has(userId)) s.items.set(userId, []);
    return s.items.get(userId);
  }

  registerLensAction(domain, "record-add", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = clean(params.title, 200);
    if (!title) return { ok: false, error: `${noun} title required` };
    const record = {
      id: newId(idPrefix), title,
      kind: kinds ? (kinds.includes(params.kind) ? params.kind : kinds[0]) : clean(params.kind, 60),
      status: statuses.includes(params.status) ? params.status : statuses[0],
      notes: clean(params.notes, 2000),
      fields: (params.fields && typeof params.fields === "object" && !Array.isArray(params.fields)) ? params.fields : {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    listFor(s, actorOf(ctx)).push(record);
    saveState();
    return { ok: true, result: { record } };
  });

  registerLensAction(domain, "record-list", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let items = [...listFor(s, actorOf(ctx))];
    if (params.status) items = items.filter((r) => r.status === params.status);
    if (params.kind) items = items.filter((r) => r.kind === params.kind);
    items.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    return { ok: true, result: { noun, items, count: items.length } };
  });

  registerLensAction(domain, "record-update", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const record = listFor(s, actorOf(ctx)).find((r) => r.id === params.id);
    if (!record) return { ok: false, error: `${noun} not found` };
    if (params.status !== undefined && statuses.includes(params.status)) record.status = params.status;
    if (params.title !== undefined) { const t = clean(params.title, 200); if (t) record.title = t; }
    if (params.notes !== undefined) record.notes = clean(params.notes, 2000);
    if (params.fields && typeof params.fields === "object" && !Array.isArray(params.fields)) {
      record.fields = { ...record.fields, ...params.fields };
    }
    record.updatedAt = new Date().toISOString();
    saveState();
    return { ok: true, result: { record } };
  });

  registerLensAction(domain, "record-delete", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = listFor(s, actorOf(ctx));
    const i = arr.findIndex((r) => r.id === params.id);
    if (i < 0) return { ok: false, error: `${noun} not found` };
    arr.splice(i, 1);
    saveState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction(domain, "record-dashboard", (ctx, _a, _params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const items = listFor(s, actorOf(ctx));
    const byStatus = {}; const byKind = {};
    for (const r of items) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      if (r.kind) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    }
    return {
      ok: true,
      result: {
        noun,
        total: items.length,
        open: items.filter((r) => r.status === statuses[0]).length,
        byStatus, byKind,
        statuses, kinds: kinds || Object.keys(byKind),
      },
    };
  });
}
