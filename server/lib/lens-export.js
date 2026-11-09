// server/lib/lens-export.js
//
// Q79: the shared top-bar Export must download the lens's REAL data.
//
// The generic artifact store (STATE.lensArtifacts, read by lens.list)
// is only half of what a lens holds: many lenses keep their records in
// per-domain state (Calendar's events live in STATE.calendarLens), so
// an artifacts-only export is hollow — an honest empty notice when the
// store is empty, a misleading partial bundle when it is not. And the
// store can contain dispatcher scaffolding rows (type "domain_action",
// minted by a legacy path) that are invocation plumbing, never user
// data; exporting them produced the "Copy of undefined" garbage rows.
//
// This module is the export-side fix, deliberately separate from
// lens.list (which other surfaces render from and whose contract does
// not change):
//   - collectLensExport merges (a) artifacts obtained through the
//     canonical lens.list macro — so the ownership/visibility rules are
//     reused, never duplicated — with scaffolding types filtered out,
//     and (b) rows from the domain's registered export provider.
//   - A domain adopts state-backed export by registering a provider:
//     registerLensExportProvider(domain, (ctx) => rows). A provider
//     receives the caller's ctx and MUST scope rows to that caller.
//     Rows are export-shaped: { id, title, type, createdAt, updatedAt,
//     data }.
//   - The result reports its provenance (sources + stateBacked) so the
//     UI can be honest about what an export does and does not include.

const SCAFFOLDING_TYPES = new Set(["domain_action"]);

const providers = new Map(); // domain -> (ctx) => rows[] | Promise<rows[]>

export function registerLensExportProvider(domain, provider) {
  if (!domain || typeof provider !== "function") return false;
  providers.set(domain, provider);
  return true;
}

export function hasLensExportProvider(domain) {
  return providers.has(domain);
}

export function _clearLensExportProvidersForTests() {
  providers.clear();
}

function normalizeRow(row, domain) {
  if (!row || typeof row !== "object") return null;
  return {
    id: row.id ?? null,
    domain,
    type: typeof row.type === "string" ? row.type : "record",
    title: typeof row.title === "string" ? row.title : (typeof row.name === "string" ? row.name : ""),
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? row.createdAt ?? null,
    data: row.data && typeof row.data === "object" ? row.data : row,
  };
}

/**
 * @param {object} deps
 * @param {(domain: string, action: string, input: object, ctx: object) => Promise<object>} deps.runMacro
 * @param {string} deps.domain
 * @param {object} deps.ctx - the caller's macro context (actor scoping rides on it)
 * @param {number} [deps.limit]
 */
export async function collectLensExport({ runMacro, domain, ctx, limit = 1000 }) {
  if (!domain) return { ok: false, error: "domain required" };
  if (typeof runMacro !== "function") return { ok: false, error: "run_macro_unavailable" };

  const listed = await runMacro("lens", "list", { domain, limit }, ctx);
  if (!listed || listed.ok === false) {
    return { ok: false, error: listed?.error || "lens_list_failed" };
  }
  const callerId = ctx?.actor?.userId || ctx?.actor?.id || null;
  const isActivityMint = (a) => {
    const from = a?.meta?.createdFrom;
    if (from === "dtu-auto-sync" || from === "integrity-repair") return true;
    if (typeof a?.id === "string" && a.id.startsWith("dtu_lens_")) return true;
    if (typeof a?.title === "string" && a.title.startsWith("Lens:")) return true;
    return false;
  };
  // Hotfix 2026-11-09: export is caller-scoped. Drop activity-minted
  // mirrors (even if lens.list still returned a stale public copy) unless
  // the caller owns them. Keep genuine non-activity public catalog rows.
  const artifacts = (Array.isArray(listed.artifacts) ? listed.artifacts : [])
    .filter((a) => a && !SCAFFOLDING_TYPES.has(a.type))
    .filter((a) => {
      if (!isActivityMint(a)) return true;
      return !!(callerId && a.ownerId && a.ownerId === callerId && a.ownerId !== "system" && a.ownerId !== "anon");
    });

  let providerRows = [];
  let providerError = null;
  const provider = providers.get(domain);
  if (provider) {
    try {
      const raw = await provider(ctx);
      providerRows = (Array.isArray(raw) ? raw : [])
        .map((r) => normalizeRow(r, domain))
        .filter(Boolean);
    } catch (err) {
      // A failing provider must not take the artifact export down with
      // it — but the failure is reported, never silently swallowed.
      providerError = err?.message || "export_provider_failed";
    }
  }

  // ── A4 Leg A: the caller's own canonical DTUs in this domain ──────
  // Work a user saves inside a lens (SaveAsDtuButton / recordKeep →
  // dtu.create) is a canonical DTU: it is neither a lens artifact nor a
  // provider row, so a two-source export told the user "this lens has
  // no saved data" over their own saved work (Transfer F9 + its ↓.dtu
  // recurrences). The canonical list macro already owns the visibility
  // rules (mine = the caller's own, any scope; domain via
  // dtuMatchesDomain) — reuse them, never duplicate them. A failing
  // dtu leg degrades to the two-source behaviour and is REPORTED in
  // sources, never silently swallowed.
  let dtuRows = [];
  let dtuError = null;
  try {
    const mine = await runMacro("dtu", "list", { domain, mine: true, limit }, ctx);
    const list = Array.isArray(mine?.dtus) ? mine.dtus : (Array.isArray(mine?.items) ? mine.items : []);
    const seen = new Set([...artifacts, ...providerRows].map((r) => r?.id).filter(Boolean));
    dtuRows = list
      .filter((d) => d && d.id && !seen.has(d.id))
      .map((d) => normalizeRow({
        id: d.id,
        type: "dtu",
        title: typeof d.title === "string" ? d.title : "",
        createdAt: d.createdAt ?? null,
        data: {
          title: typeof d.title === "string" ? d.title : "",
          tags: Array.isArray(d.tags) ? d.tags : [],
          summary: (typeof d.human?.summary === "string" && d.human.summary)
            || (typeof d.cretiHuman === "string" ? d.cretiHuman : ""),
          content: typeof d.content === "string" ? d.content : "",
        },
      }, domain))
      .filter(Boolean);
  } catch (err) {
    dtuError = err?.message || "dtu_list_failed";
  }

  const rows = [...artifacts, ...providerRows, ...dtuRows];
  return {
    ok: true,
    domain,
    artifacts: rows,
    total: rows.length,
    sources: { artifacts: artifacts.length, stateRecords: providerRows.length, ownDtus: dtuRows.length },
    stateBacked: Boolean(provider),
    ...(providerError ? { providerError } : {}),
    ...(dtuError ? { dtuError } : {}),
  };
}
