// server/domains/plumbing.js
// Plumbing contractor management: engineering calculators (pipe sizing,
// water heater, drain slope, fixture units) + a per-user field-service
// substrate — dispatch board, quote-to-invoice flow, price book,
// technician mobile workflow, maintenance plans, customer notifications,
// and parts-inventory deduction tied to job completion.
import { listCodeReferences, listCodeReferenceCategories, PLUMBING_CODE_DISCLAIMER } from "../lib/plumbing-code-reference.js";

export default function registerPlumbingActions(registerLensAction) {
  // Finite-coercing numeric reader. parseFloat/parseInt PASS "Infinity" through
  // (and `Infinity || default === Infinity`), so a poisoned/garbage numeric
  // would leak Infinity/NaN into a rendered card ("Infinity\"" diameter). Use
  // Number.isFinite to fail CLOSED to the default for ANY non-finite input.
  const fNum = (v, def) => { const n = parseFloat(v); return Number.isFinite(n) ? n : def; };
  const fInt = (v, def) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : def; };
  registerLensAction("plumbing", "pipeSize", (ctx, artifact, _params) => { const data = artifact.data || {}; const flowGPM = fNum(data.flowGPM, 5) || 5; const velocity = fNum(data.velocityFPS, 5) || 5; /* Standard plumbing flow relation: GPM = 2.448 · d² · v (d in inches, v in ft/s). So d = √(GPM/(2.448·v)). The prior code named this quantity "area" and then applied the circle-area inverse (2·√(d²/π)), which inflated the diameter by 2/√π ≈ 1.13× and oversized the recommended pipe. */ const dSquaredIn = flowGPM / (velocity * 2.448); const diameter = Math.sqrt(dSquaredIn); const nominalSizes = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4]; const recommended = nominalSizes.find(s => s >= diameter) || 4; return { ok: true, result: { flowRate: `${flowGPM} GPM`, velocity: `${velocity} ft/s`, calculatedDiameter: `${Math.round(diameter*100)/100}"`, recommendedSize: `${recommended}" nominal`, material: data.material || "copper", note: velocity > 8 ? "High velocity — may cause noise and erosion" : "Within acceptable range" } }; });
  registerLensAction("plumbing", "waterHeaterSize", (ctx, artifact, _params) => { const data = artifact.data || {}; const people = fInt(data.household, 2) || 2; const simultaneous = fInt(data.simultaneousFixtures, 2) || 2; const peakGPM = simultaneous * 2.5; const tankGallons = people * 15; /* Electric tankless sizing: kW = GPM · 8.33 lb/gal · 60 min/hr · ΔT(°F) / 3412 BTU/kWh. The prior code omitted the temperature rise entirely, yielding an absurd ~1 kW whole-house unit (real units are 18–54 kW). ΔT defaults to the industry-standard 70°F rise (≈50°F incoming → 120°F setpoint), overridable via data.tempRiseF. */ const tempRiseF = fNum(data.tempRiseF, 70) || 70; const tanklessKW = Math.round(peakGPM * 8.33 * 60 * tempRiseF / 3412); return { ok: true, result: { household: people, peakDemandGPM: peakGPM, tankRecommendation: `${Math.ceil(tankGallons/10)*10} gallon tank`, tanklessRecommendation: `${tanklessKW} kW tankless`, firstHourRating: Math.round(tankGallons * 1.5), recommendation: people > 4 ? "Consider tankless for unlimited hot water" : "Standard tank should suffice" } }; });
  registerLensAction("plumbing", "drainSlope", (ctx, artifact, _params) => { const data = artifact.data || {}; const pipeSize = fNum(data.pipeSizeInches, 2) || 2; const length = fNum(data.lengthFeet, 10) || 10; const slopePerFoot = pipeSize <= 2 ? 0.25 : pipeSize <= 3 ? 0.1875 : 0.125; const totalDrop = Math.round(length * slopePerFoot * 100) / 100; return { ok: true, result: { pipeSize: `${pipeSize}"`, length: `${length} ft`, slopePerFoot: `${slopePerFoot}" per foot (${slopePerFoot/12*100}%)`, totalDrop: `${totalDrop}"`, ipcCode: `IPC Table 704.1 — ${pipeSize}" pipe requires ${slopePerFoot}"/ft minimum`, tip: "Use a level and measure drop at each joint" } }; });
  registerLensAction("plumbing", "fixtureCount", (ctx, artifact, _params) => { const fixtures = Array.isArray(artifact.data?.fixtures) ? artifact.data.fixtures : []; if (fixtures.length === 0) return { ok: true, result: { message: "Add fixtures to calculate water supply needs." } }; const wsfuValues = { toilet: 2.5, lavatory: 1, bathtub: 2, shower: 2, "kitchen-sink": 1.5, dishwasher: 1.5, "washing-machine": 2, "hose-bib": 2.5 }; const totalWSFU = fixtures.reduce((s, f) => { if (!f || typeof f !== "object") return s; const type = (f.type || f.name || "").toLowerCase(); return s + (wsfuValues[type] || 1.5) * (fInt(f.count, 1) || 1); }, 0); const meterSize = totalWSFU <= 15 ? '3/4"' : totalWSFU <= 30 ? '1"' : totalWSFU <= 60 ? '1.5"' : '2"'; return { ok: true, result: { fixtures: fixtures.length, totalWSFU, meterSize, supplyLine: totalWSFU <= 20 ? '3/4" main' : '1" main', note: "WSFU = Water Supply Fixture Units per IPC/UPC" } }; });

  // ─── Code quick-reference library (Track D, copyright-aware) ────────
  // Closes the "Codes" deferred-permit gap (docs/lens-specs/plumbing-
  // capability-map.md): the IPC/UPC are copyrighted model codes, so this is
  // NOT a verbatim code-text library — every entry in
  // content/plumbing-code-reference.json is a paraphrased summary that
  // cites a real table/section number only when the author is confident
  // it's correct; otherwise it's flagged `citationConfidence:
  // "general-pattern"` with `citation: null` rather than risking a
  // fabricated citation. Every entry carries its own disclaimer, and the
  // macro also returns a library-wide disclaimer, per the honest-by-
  // construction invariant (mirrors healthcare.protocols-list /
  // content/healthcare-protocols.json). params.category optionally filters
  // to one category (e.g. "drain-slope", "fixture-units").
  registerLensAction("plumbing", "codeReference", (_ctx, _artifact, params = {}) => {
    try {
      const category = String(params.category || "").trim();
      const all = listCodeReferences();
      const entries = category ? all.filter((e) => e.category === category) : all;
      return {
        ok: true,
        result: {
          entries,
          categories: listCodeReferenceCategories(),
          total: all.length,
          disclaimer: PLUMBING_CODE_DISCLAIMER,
        },
      };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  // ─── Field-service substrate (per-user, STATE-backed) ───────────────
  function getPlumbState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.plumbingLens) STATE.plumbingLens = {};
    const s = STATE.plumbingLens;
    if (!(s.techs instanceof Map)) s.techs = new Map();         // userId -> Array<tech>
    if (!(s.dispatch instanceof Map)) s.dispatch = new Map();   // userId -> Array<assignment>
    if (!(s.priceBook instanceof Map)) s.priceBook = new Map(); // userId -> Array<priceItem>
    if (!(s.invoices instanceof Map)) s.invoices = new Map();   // userId -> Array<invoice>
    if (!(s.plans instanceof Map)) s.plans = new Map();         // userId -> Array<servicePlan>
    if (!(s.parts instanceof Map)) s.parts = new Map();         // userId -> Array<partStock>
    if (!(s.notices instanceof Map)) s.notices = new Map();     // userId -> Array<notification>
    if (!(s.workflows instanceof Map)) s.workflows = new Map(); // assignmentId -> workflow
    if (!(s.clients instanceof Map)) s.clients = new Map();     // userId -> Array<client>
    if (!(s.inspections instanceof Map)) s.inspections = new Map(); // userId -> Array<inspection>
    return s;
  }
  function savePlumb() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const pid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const actor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const clean = (v, max = 400) => String(v == null ? "" : v).trim().slice(0, max);
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const list = (m, userId) => { if (!m.has(userId)) m.set(userId, []); return m.get(userId); };
  const guard = () => { const s = getPlumbState(); return s ? { s } : { error: { ok: false, error: "state_unavailable" } }; };

  // ── Technicians ──────────────────────────────────────────────────
  registerLensAction("plumbing", "techAdd", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const techs = list(g.s.techs, actor(ctx));
      const name = clean(params.name, 80);
      if (!name) return { ok: false, error: "name_required" };
      const tech = {
        id: pid("tech"), name,
        skills: Array.isArray(params.skills) ? params.skills.map(x => clean(x, 40)).slice(0, 12) : [],
        phone: clean(params.phone, 40),
        baseColor: clean(params.baseColor, 16) || "#38bdf8",
        active: params.active !== false,
        certifications: [], // formal license/cert records — see techCertAdd. Distinct
        // from `skills` above: skills is a freeform capability tag list used for
        // quick dispatch matching, certifications is a structured record with an
        // issuing body + license number + expiry, used for compliance tracking.
        createdAt: new Date().toISOString(),
      };
      techs.push(tech); savePlumb();
      return { ok: true, result: { tech } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  // Certifications past their expiryDate are flagged, not deleted — an expired
  // license is still a real (lapsed) record a shop owner needs to see and
  // renew, not something that should silently disappear. Computed at read
  // time (no background sweep) since expiry here doesn't cascade into any
  // other domain — mirrors the "simple is fine" guidance for this kind of
  // derived flag (contrast with hr.js's I-9 sweep, which needs a stored
  // status because I-9 verification blocks downstream actions).
  function isCertExpired(expiryDate) {
    if (!expiryDate) return false;
    return expiryDate < new Date().toISOString().slice(0, 10);
  }
  function withExpiry(cert) { return { ...cert, isExpired: isCertExpired(cert.expiryDate) }; }
  function certsOf(t) { return Array.isArray(t.certifications) ? t.certifications : (t.certifications = []); }
  registerLensAction("plumbing", "techList", (ctx) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const techs = list(g.s.techs, actor(ctx));
      const dispatch = list(g.s.dispatch, actor(ctx));
      return {
        ok: true,
        result: {
          techs: techs.map(t => {
            const certifications = certsOf(t).map(withExpiry);
            return {
              ...t,
              certifications,
              expiredCertCount: certifications.filter(c => c.isExpired).length,
              openJobs: dispatch.filter(d => d.techId === t.id && d.status !== "completed" && d.status !== "cancelled").length,
            };
          }),
          count: techs.length,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("plumbing", "techRemove", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const techs = list(g.s.techs, actor(ctx));
      const idx = techs.findIndex(t => t.id === params.techId);
      if (idx < 0) return { ok: false, error: "tech_not_found" };
      techs.splice(idx, 1); savePlumb();
      return { ok: true, result: { removed: params.techId } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Technician certifications (formal license records) ──────────────
  // Closes the "Certs" gap (docs/lens-specs/plumbing-capability-map.md):
  // techAdd's `skills` field was a freeform tag list, not a formal
  // certification record with issuing body + license number + expiry date.
  // This is a distinct, additive `certifications` array per tech — `skills`
  // is untouched and keeps serving quick dispatch-matching.
  registerLensAction("plumbing", "techCertAdd", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const techs = list(g.s.techs, actor(ctx));
      const techId = clean(params.techId, 64);
      if (!techId) return { ok: false, error: "techId_required" };
      const tech = techs.find(t => t.id === techId);
      if (!tech) return { ok: false, error: "tech_not_found" };
      const name = clean(params.name, 120);
      if (!name) return { ok: false, error: "name_required" };
      const issuingBody = clean(params.issuingBody, 120);
      if (!issuingBody) return { ok: false, error: "issuingBody_required" };
      const cert = {
        id: pid("cert"), name, issuingBody,
        licenseNumber: clean(params.licenseNumber, 60),
        issueDate: clean(params.issueDate, 16) || null,
        expiryDate: clean(params.expiryDate, 16) || null,
        createdAt: new Date().toISOString(),
      };
      certsOf(tech).push(cert); savePlumb();
      return { ok: true, result: { certification: withExpiry(cert), techId } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("plumbing", "techCertList", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const techs = list(g.s.techs, actor(ctx));
      const techId = clean(params.techId, 64);
      if (!techId) return { ok: false, error: "techId_required" };
      const tech = techs.find(t => t.id === techId);
      if (!tech) return { ok: false, error: "tech_not_found" };
      const certifications = certsOf(tech).map(withExpiry);
      return {
        ok: true,
        result: {
          certifications, count: certifications.length,
          expiredCount: certifications.filter(c => c.isExpired).length,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("plumbing", "techCertRemove", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const techs = list(g.s.techs, actor(ctx));
      const techId = clean(params.techId, 64);
      if (!techId) return { ok: false, error: "techId_required" };
      const tech = techs.find(t => t.id === techId);
      if (!tech) return { ok: false, error: "tech_not_found" };
      const certs = certsOf(tech);
      const idx = certs.findIndex(c => c.id === params.certId);
      if (idx < 0) return { ok: false, error: "certification_not_found" };
      certs.splice(idx, 1); savePlumb();
      return { ok: true, result: { removed: params.certId, techId } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Clients (persisted CRM entity) ───────────────────────────────
  // Closes the "no persisted Client entity" gap (docs/lens-specs/plumbing-
  // capability-map.md): client name/contact was previously a free-text field
  // re-typed on every dispatchAssign/invoiceFromQuote/planCreate call, so it
  // never autocompleted and history didn't aggregate across documents. This
  // is a small, additive pair — clientAdd/clientList — plus an OPTIONAL
  // `clientId` accepted by the three document macros below. Passing
  // `clientId` looks the client up and uses its name/address; omitting it
  // preserves the original free-text behavior byte-for-byte.
  function resolveClientRef(g, userId, params) {
    const clientId = clean(params.clientId, 64) || null;
    if (!clientId) return { clientId: null, client: null };
    const found = list(g.s.clients, userId).find(c => c.id === clientId);
    if (!found) return { error: "client_not_found" };
    return { clientId: found.id, client: found };
  }
  registerLensAction("plumbing", "clientAdd", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const clients = list(g.s.clients, actor(ctx));
      const name = clean(params.name, 80);
      if (!name) return { ok: false, error: "name_required" };
      const client = {
        id: pid("client"), name,
        phone: clean(params.phone, 40),
        email: clean(params.email, 120),
        address: clean(params.address, 200),
        notes: clean(params.notes, 400),
        createdAt: new Date().toISOString(),
      };
      clients.push(client); savePlumb();
      return { ok: true, result: { client } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("plumbing", "clientList", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const userId = actor(ctx);
      const clients = list(g.s.clients, userId);
      const dispatch = list(g.s.dispatch, userId);
      const invoices = list(g.s.invoices, userId);
      const query = clean(params.query, 80).toLowerCase();
      const filtered = query ? clients.filter(c => c.name.toLowerCase().includes(query)) : clients;
      // Aggregate real cross-document history per client — the second half
      // of the documented gap ("doesn't aggregate history across documents
      // for the same client"), derived from the same dispatch/invoice
      // stores the free-text fields used to write into, now joined on id.
      const enriched = filtered.map(c => {
        const jobs = dispatch.filter(d => d.clientId === c.id);
        const clientInvoices = invoices.filter(i => i.clientId === c.id);
        return {
          ...c,
          jobsCount: jobs.length,
          invoiceCount: clientInvoices.length,
          totalBilled: Math.round(clientInvoices.reduce((s, i) => s + i.total, 0) * 100) / 100,
        };
      });
      return { ok: true, result: { clients: enriched, count: enriched.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Job scheduling + dispatch board ──────────────────────────────
  registerLensAction("plumbing", "dispatchAssign", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const userId = actor(ctx);
      const dispatch = list(g.s.dispatch, userId);
      const techs = list(g.s.techs, userId);
      const jobTitle = clean(params.jobTitle, 120);
      if (!jobTitle) return { ok: false, error: "jobTitle_required" };
      const techId = clean(params.techId, 64) || null;
      if (techId && !techs.find(t => t.id === techId)) return { ok: false, error: "tech_not_found" };
      const ref = resolveClientRef(g, userId, params);
      if (ref.error) return { ok: false, error: ref.error };
      const clientName = ref.client ? ref.client.name : clean(params.client, 80);
      const address = clean(params.address, 200) || (ref.client ? (ref.client.address || "") : "");
      const date = clean(params.date, 16) || new Date().toISOString().slice(0, 10);
      const startHour = Math.min(23, Math.max(0, num(params.startHour) || 8));
      const durationHours = Math.min(12, Math.max(0.5, num(params.durationHours) || 2));
      const assignment = {
        id: pid("disp"), jobTitle, jobId: clean(params.jobId, 64) || null,
        client: clientName, clientId: ref.clientId, address,
        techId, date, startHour, durationHours,
        priority: ["low", "normal", "high", "emergency"].includes(params.priority) ? params.priority : "normal",
        status: "scheduled",
        createdAt: new Date().toISOString(),
      };
      dispatch.push(assignment); savePlumb();
      return { ok: true, result: { assignment } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("plumbing", "dispatchBoard", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const userId = actor(ctx);
      const dispatch = list(g.s.dispatch, userId);
      const techs = list(g.s.techs, userId);
      const dateFilter = clean(params.date, 16);
      let rows = dispatch.slice();
      if (dateFilter) rows = rows.filter(d => d.date === dateFilter);
      rows.sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour);
      const lanes = techs.map(t => ({
        techId: t.id, techName: t.name, baseColor: t.baseColor,
        assignments: rows.filter(d => d.techId === t.id),
        loadHours: rows.filter(d => d.techId === t.id && d.status !== "cancelled")
          .reduce((s, d) => s + d.durationHours, 0),
      }));
      const unassigned = rows.filter(d => !d.techId);
      return {
        ok: true,
        result: {
          lanes, unassigned, totalAssignments: rows.length,
          emergencyCount: rows.filter(d => d.priority === "emergency" && d.status !== "completed").length,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("plumbing", "dispatchUpdate", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const userId = actor(ctx);
      const dispatch = list(g.s.dispatch, userId);
      const a = dispatch.find(d => d.id === params.assignmentId);
      if (!a) return { ok: false, error: "assignment_not_found" };
      if (params.techId !== undefined) {
        const techId = clean(params.techId, 64) || null;
        if (techId && !list(g.s.techs, userId).find(t => t.id === techId)) return { ok: false, error: "tech_not_found" };
        a.techId = techId;
      }
      if (params.date !== undefined) a.date = clean(params.date, 16);
      if (params.startHour !== undefined) a.startHour = Math.min(23, Math.max(0, num(params.startHour)));
      if (params.durationHours !== undefined) a.durationHours = Math.min(12, Math.max(0.5, num(params.durationHours)));
      if (params.status && ["scheduled", "en_route", "on_site", "completed", "cancelled"].includes(params.status)) a.status = params.status;
      if (params.priority && ["low", "normal", "high", "emergency"].includes(params.priority)) a.priority = params.priority;
      a.updatedAt = new Date().toISOString();
      savePlumb();
      return { ok: true, result: { assignment: a } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Price book with markup ───────────────────────────────────────
  registerLensAction("plumbing", "priceItemAdd", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const book = list(g.s.priceBook, actor(ctx));
      const name = clean(params.name, 120);
      if (!name) return { ok: false, error: "name_required" };
      const cost = Math.max(0, num(params.cost));
      const markupPct = Math.max(0, Math.min(500, num(params.markupPct) || 0));
      const price = Math.round(cost * (1 + markupPct / 100) * 100) / 100;
      const item = {
        id: pid("pb"), name,
        kind: ["part", "labor"].includes(params.kind) ? params.kind : "part",
        unit: clean(params.unit, 24) || (params.kind === "labor" ? "hr" : "ea"),
        cost, markupPct, price,
        sku: clean(params.sku, 48),
        createdAt: new Date().toISOString(),
      };
      book.push(item); savePlumb();
      return { ok: true, result: { item } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("plumbing", "priceBookList", (ctx) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const book = list(g.s.priceBook, actor(ctx));
      return {
        ok: true,
        result: {
          items: book,
          count: book.length,
          avgMarginPct: book.length
            ? Math.round(book.reduce((s, i) => s + i.markupPct, 0) / book.length)
            : 0,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("plumbing", "priceItemUpdate", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const book = list(g.s.priceBook, actor(ctx));
      const item = book.find(i => i.id === params.itemId);
      if (!item) return { ok: false, error: "item_not_found" };
      if (params.name !== undefined) item.name = clean(params.name, 120);
      if (params.cost !== undefined) item.cost = Math.max(0, num(params.cost));
      if (params.markupPct !== undefined) item.markupPct = Math.max(0, Math.min(500, num(params.markupPct)));
      if (params.unit !== undefined) item.unit = clean(params.unit, 24);
      item.price = Math.round(item.cost * (1 + item.markupPct / 100) * 100) / 100;
      savePlumb();
      return { ok: true, result: { item } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("plumbing", "priceItemRemove", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const book = list(g.s.priceBook, actor(ctx));
      const idx = book.findIndex(i => i.id === params.itemId);
      if (idx < 0) return { ok: false, error: "item_not_found" };
      book.splice(idx, 1); savePlumb();
      return { ok: true, result: { removed: params.itemId } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Quote-to-invoice flow ────────────────────────────────────────
  function lineTotal(l) { return Math.round(num(l.quantity) * num(l.unitPrice) * 100) / 100; }
  registerLensAction("plumbing", "invoiceFromQuote", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const userId = actor(ctx);
      const invoices = list(g.s.invoices, userId);
      const lines = Array.isArray(params.lines) ? params.lines : [];
      if (lines.length === 0) return { ok: false, error: "lines_required" };
      const norm = lines.map(l => ({
        priceItemId: clean(l.priceItemId, 64) || null,
        name: clean(l.name, 120) || "Line item",
        quantity: Math.max(0, num(l.quantity) || 1),
        unitPrice: Math.max(0, num(l.unitPrice)),
        total: 0,
      }));
      norm.forEach(l => { l.total = lineTotal(l); });
      const subtotal = Math.round(norm.reduce((s, l) => s + l.total, 0) * 100) / 100;
      const taxPct = Math.max(0, Math.min(30, num(params.taxPct) || 0));
      const tax = Math.round(subtotal * taxPct / 100 * 100) / 100;
      const total = Math.round((subtotal + tax) * 100) / 100;
      const seq = invoices.length + 1;
      const ref = resolveClientRef(g, userId, params);
      if (ref.error) return { ok: false, error: ref.error };
      const clientName = ref.client ? ref.client.name : clean(params.client, 80);
      const invoice = {
        id: pid("inv"),
        number: clean(params.number, 32) || `INV-${String(seq).padStart(4, "0")}`,
        quoteRef: clean(params.quoteRef, 64) || null,
        client: clientName, clientId: ref.clientId,
        lines: norm, subtotal, taxPct, tax, total,
        status: "issued", amountPaid: 0,
        dueDate: clean(params.dueDate, 16),
        issuedAt: new Date().toISOString(),
        payments: [],
      };
      invoices.push(invoice); savePlumb();
      return { ok: true, result: { invoice } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("plumbing", "invoiceList", (ctx) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const invoices = list(g.s.invoices, actor(ctx));
      const outstanding = invoices.filter(i => i.status !== "paid")
        .reduce((s, i) => s + (i.total - i.amountPaid), 0);
      const collected = invoices.reduce((s, i) => s + i.amountPaid, 0);
      return {
        ok: true,
        result: {
          invoices,
          count: invoices.length,
          outstanding: Math.round(outstanding * 100) / 100,
          collected: Math.round(collected * 100) / 100,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("plumbing", "invoiceRecordPayment", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const invoices = list(g.s.invoices, actor(ctx));
      const inv = invoices.find(i => i.id === params.invoiceId);
      if (!inv) return { ok: false, error: "invoice_not_found" };
      const amount = Math.max(0, num(params.amount));
      if (amount <= 0) return { ok: false, error: "amount_required" };
      const payment = {
        id: pid("pay"), amount,
        method: ["cash", "card", "check", "transfer"].includes(params.method) ? params.method : "card",
        at: new Date().toISOString(),
      };
      inv.payments.push(payment);
      inv.amountPaid = Math.round((inv.amountPaid + amount) * 100) / 100;
      inv.status = inv.amountPaid >= inv.total ? "paid" : "partial";
      savePlumb();
      return { ok: true, result: { invoice: inv, balanceDue: Math.round((inv.total - inv.amountPaid) * 100) / 100 } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Technician mobile workflow ───────────────────────────────────
  registerLensAction("plumbing", "workflowStart", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const userId = actor(ctx);
      const assignmentId = clean(params.assignmentId, 64);
      if (!assignmentId) return { ok: false, error: "assignmentId_required" };
      if (!list(g.s.dispatch, userId).find(d => d.id === assignmentId)) return { ok: false, error: "assignment_not_found" };
      const checklist = Array.isArray(params.checklist) && params.checklist.length
        ? params.checklist.map(c => clean(c, 120))
        : ["Shut off water supply", "Inspect work area", "Complete repair", "Test for leaks", "Clean up site"];
      const wf = {
        id: pid("wf"), assignmentId,
        checklist: checklist.map(label => ({ label, done: false })),
        photos: [], signature: null, signedBy: null,
        startedAt: new Date().toISOString(), completedAt: null,
      };
      g.s.workflows.set(assignmentId, wf); savePlumb();
      return { ok: true, result: { workflow: wf } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("plumbing", "workflowGet", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const wf = g.s.workflows.get(clean(params.assignmentId, 64));
      if (!wf) return { ok: false, error: "workflow_not_found" };
      const done = wf.checklist.filter(c => c.done).length;
      return { ok: true, result: { workflow: wf, progress: wf.checklist.length ? Math.round(done / wf.checklist.length * 100) : 0 } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("plumbing", "workflowUpdate", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const wf = g.s.workflows.get(clean(params.assignmentId, 64));
      if (!wf) return { ok: false, error: "workflow_not_found" };
      if (typeof params.checkIndex === "number" && wf.checklist[params.checkIndex]) {
        wf.checklist[params.checkIndex].done = params.done !== false;
      }
      if (params.photoCaption !== undefined) {
        wf.photos.push({ id: pid("ph"), caption: clean(params.photoCaption, 160), at: new Date().toISOString() });
      }
      if (params.signature !== undefined) {
        wf.signature = clean(params.signature, 200000);
        wf.signedBy = clean(params.signedBy, 80) || "Customer";
        wf.completedAt = new Date().toISOString();
      }
      savePlumb();
      return { ok: true, result: { workflow: wf } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Recurring service agreements / maintenance plans ─────────────
  function nextDue(startDate, cadence, count = 1) {
    const d = new Date(startDate || Date.now());
    const days = { weekly: 7, monthly: 30, quarterly: 91, biannual: 182, annual: 365 }[cadence] || 365;
    d.setDate(d.getDate() + days * count);
    return d.toISOString().slice(0, 10);
  }
  registerLensAction("plumbing", "planCreate", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const userId = actor(ctx);
      const plans = list(g.s.plans, userId);
      const ref = resolveClientRef(g, userId, params);
      if (ref.error) return { ok: false, error: ref.error };
      const client = ref.client ? ref.client.name : clean(params.client, 80);
      if (!client) return { ok: false, error: "client_required" };
      const cadence = ["weekly", "monthly", "quarterly", "biannual", "annual"].includes(params.cadence) ? params.cadence : "annual";
      const start = clean(params.startDate, 16) || new Date().toISOString().slice(0, 10);
      const plan = {
        id: pid("plan"), client, clientId: ref.clientId,
        title: clean(params.title, 120) || "Maintenance Plan",
        cadence, fee: Math.max(0, num(params.fee)),
        startDate: start, nextVisit: nextDue(start, cadence),
        visitsCompleted: 0, active: true,
        createdAt: new Date().toISOString(),
      };
      plans.push(plan); savePlumb();
      return { ok: true, result: { plan } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("plumbing", "planList", (ctx) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const plans = list(g.s.plans, actor(ctx));
      const today = new Date().toISOString().slice(0, 10);
      return {
        ok: true,
        result: {
          plans,
          count: plans.length,
          dueSoon: plans.filter(p => p.active && p.nextVisit <= today).length,
          recurringRevenue: Math.round(plans.filter(p => p.active).reduce((s, p) => s + p.fee, 0) * 100) / 100,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("plumbing", "planLogVisit", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const plans = list(g.s.plans, actor(ctx));
      const plan = plans.find(p => p.id === params.planId);
      if (!plan) return { ok: false, error: "plan_not_found" };
      plan.visitsCompleted += 1;
      plan.nextVisit = nextDue(plan.startDate, plan.cadence, plan.visitsCompleted + 1);
      plan.lastVisit = new Date().toISOString().slice(0, 10);
      savePlumb();
      return { ok: true, result: { plan } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Customer notifications ───────────────────────────────────────
  registerLensAction("plumbing", "notifySend", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const notices = list(g.s.notices, actor(ctx));
      const client = clean(params.client, 80);
      if (!client) return { ok: false, error: "client_required" };
      const kind = ["confirmation", "on_the_way", "reminder", "follow_up", "invoice"].includes(params.kind)
        ? params.kind : "confirmation";
      const templates = {
        confirmation: `Hi ${client}, your appointment is confirmed for ${clean(params.when, 40) || "the scheduled time"}.`,
        on_the_way: `Hi ${client}, your technician is on the way and will arrive shortly.`,
        reminder: `Reminder: ${client}, you have a plumbing service scheduled ${clean(params.when, 40) || "soon"}.`,
        follow_up: `Hi ${client}, thanks for choosing us — let us know if anything needs attention.`,
        invoice: `Hi ${client}, your invoice is ready. Thank you for your business.`,
      };
      const notice = {
        id: pid("ntf"), client, kind,
        channel: ["sms", "email"].includes(params.channel) ? params.channel : "sms",
        message: clean(params.message, 600) || templates[kind],
        assignmentId: clean(params.assignmentId, 64) || null,
        status: "sent",
        sentAt: new Date().toISOString(),
      };
      notices.unshift(notice);
      if (notices.length > 300) notices.length = 300;
      savePlumb();
      return { ok: true, result: { notice } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("plumbing", "notifyLog", (ctx) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const notices = list(g.s.notices, actor(ctx));
      const byKind = {};
      notices.forEach(n => { byKind[n.kind] = (byKind[n.kind] || 0) + 1; });
      return { ok: true, result: { notices: notices.slice(0, 100), count: notices.length, byKind } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Parts inventory + completion deduction ───────────────────────
  registerLensAction("plumbing", "partStock", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const parts = list(g.s.parts, actor(ctx));
      const name = clean(params.name, 120);
      if (!name) return { ok: false, error: "name_required" };
      const existing = parts.find(p => p.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        existing.onHand += Math.max(0, num(params.quantity));
        if (params.reorderAt !== undefined) existing.reorderAt = Math.max(0, num(params.reorderAt));
        savePlumb();
        return { ok: true, result: { part: existing, restocked: true } };
      }
      const part = {
        id: pid("part"), name,
        sku: clean(params.sku, 48),
        onHand: Math.max(0, num(params.quantity)),
        reorderAt: Math.max(0, num(params.reorderAt) || 5),
        unitCost: Math.max(0, num(params.unitCost)),
        createdAt: new Date().toISOString(),
      };
      parts.push(part); savePlumb();
      return { ok: true, result: { part, restocked: false } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("plumbing", "partList", (ctx) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const parts = list(g.s.parts, actor(ctx));
      return {
        ok: true,
        result: {
          parts,
          count: parts.length,
          lowStock: parts.filter(p => p.onHand <= p.reorderAt).map(p => p.name),
          inventoryValue: Math.round(parts.reduce((s, p) => s + p.onHand * p.unitCost, 0) * 100) / 100,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("plumbing", "jobComplete", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const userId = actor(ctx);
      const dispatch = list(g.s.dispatch, userId);
      const parts = list(g.s.parts, userId);
      const a = dispatch.find(d => d.id === params.assignmentId);
      if (!a) return { ok: false, error: "assignment_not_found" };
      const used = Array.isArray(params.partsUsed) ? params.partsUsed : [];
      const deductions = [];
      const shortages = [];
      for (const u of used) {
        const part = parts.find(p => p.id === u.partId || p.name?.toLowerCase() === clean(u.name, 120).toLowerCase());
        const qty = Math.max(0, num(u.quantity) || 1);
        if (!part) { shortages.push({ name: clean(u.name, 120) || u.partId, reason: "not_in_inventory" }); continue; }
        const taken = Math.min(part.onHand, qty);
        part.onHand = Math.round((part.onHand - taken) * 100) / 100;
        deductions.push({ name: part.name, deducted: taken, remaining: part.onHand });
        if (taken < qty) shortages.push({ name: part.name, reason: "insufficient_stock", shortBy: qty - taken });
      }
      a.status = "completed";
      a.completedAt = new Date().toISOString();
      a.partsUsed = deductions;
      savePlumb();
      return {
        ok: true,
        result: {
          assignment: a, deductions, shortages,
          lowStockAlerts: parts.filter(p => p.onHand <= p.reorderAt).map(p => p.name),
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Aggregate operations summary for the dashboard ───────────────
  registerLensAction("plumbing", "opsSummary", (ctx) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const userId = actor(ctx);
      const dispatch = list(g.s.dispatch, userId);
      const invoices = list(g.s.invoices, userId);
      const plans = list(g.s.plans, userId);
      const parts = list(g.s.parts, userId);
      const today = new Date().toISOString().slice(0, 10);
      return {
        ok: true,
        result: {
          jobsToday: dispatch.filter(d => d.date === today).length,
          openJobs: dispatch.filter(d => d.status !== "completed" && d.status !== "cancelled").length,
          unassigned: dispatch.filter(d => !d.techId && d.status !== "cancelled").length,
          outstandingAR: Math.round(invoices.filter(i => i.status !== "paid").reduce((s, i) => s + (i.total - i.amountPaid), 0) * 100) / 100,
          collected: Math.round(invoices.reduce((s, i) => s + i.amountPaid, 0) * 100) / 100,
          activePlans: plans.filter(p => p.active).length,
          recurringRevenue: Math.round(plans.filter(p => p.active).reduce((s, p) => s + p.fee, 0) * 100) / 100,
          lowStockParts: parts.filter(p => p.onHand <= p.reorderAt).length,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Municipal / AHJ inspections (dispatch-job-linked) ─────────────
  // Closes the "Inspections" gap (docs/lens-specs/plumbing-capability-map.md):
  // workflowStart/workflowUpdate above are the TECHNICIAN's own on-site
  // checklist + photo + signature — a self-certification flow. This is a
  // different thing: a real municipal inspection scheduled with a
  // jurisdiction's building department, with an inspector-of-record who
  // passes or fails the work against code, independent of what the tech
  // self-certified. The tech workflow and this substrate coexist and don't
  // overlap.
  //
  // Modeled directly on masonry's inspection-add/inspection-list/
  // inspection-update (server/domains/masonry.js) and landscaping's copy of
  // the same shape (server/domains/landscaping.js) — both shipped earlier
  // this session — adapted two ways: (1) plumbing's own camelCase macro
  // convention (inspectionAdd/inspectionList/inspectionUpdate — NOT the
  // hyphenated inspection-add/inspection-list/inspection-update those two
  // domains use; confirmed against every other macro in this file, e.g.
  // techCertAdd/clientAdd/dispatchAssign), and (2) plumbing's own dispatch
  // vocabulary: the link field is `assignmentId`, matching workflowStart/
  // workflowUpdate/jobComplete/dispatchUpdate's own param name for "the
  // dispatch-board record this refers to" — NOT `jobId`, which on a dispatch
  // record is a DIFFERENT, unrelated free-text external job-number field
  // (see dispatchAssign's own `jobId` param). An inspection with no
  // assignment reference is a genuinely free-floating record (the same
  // departure from a soft `|| "general"` default the two precedents made) —
  // assignmentId is REQUIRED. jobTitle/jobFound/address are re-derived LIVE
  // against the current dispatch board on every add/list call, never
  // fabricated or frozen at creation time — an inspection against a
  // since-cancelled or since-deleted dispatch record still displays that
  // honestly (jobFound:false, jobTitle:null) instead of silently losing its
  // link or inventing a title.
  //
  // Real municipal/AHJ inspection checkpoints a plumbing contractor actually
  // schedules with a jurisdiction — permit-triggering points, not internal
  // QA (contrast masonry/landscaping's broader internal-QA + AHJ mix):
  // rough-in (supply/DWV piping visible before walls close), top-out/DWV
  // (drain-waste-vent system pressure-tested before cover), water-service/
  // backflow (potable supply + cross-connection control), gas-line pressure
  // test, water heater installation, and final plumbing (close-out before
  // occupancy). `jurisdiction` (the AHJ/municipality) is a REQUIRED field —
  // it's the specific thing that makes this a *municipal* inspection instead
  // of an internal QA pass, per the capability-map's own framing ("municipal
  // inspection scheduling... pass/fail records against a jurisdiction").
  // `permitNumber` is optional (not every jurisdiction requires it recorded
  // per-inspection, and some early-scheduled inspections predate permit
  // issuance).
  const INSPECTION_TYPES = [
    "rough_in", "top_out_dwv", "water_service_backflow",
    "gas_line_pressure_test", "water_heater_install", "final_plumbing",
  ];
  const INSPECTION_RESULTS = ["pending", "pass", "fail"];
  function deriveInspectionJobFields(insp, dispatchById) {
    const assignment = dispatchById.get(insp.assignmentId);
    return {
      ...insp,
      jobTitle: assignment ? assignment.jobTitle : null,
      jobFound: !!assignment,
      address: assignment ? assignment.address : null,
    };
  }
  registerLensAction("plumbing", "inspectionAdd", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const userId = actor(ctx);
      const assignmentId = clean(params.assignmentId, 64);
      if (!assignmentId) return { ok: false, error: "assignmentId_required" };
      const inspectionType = clean(params.inspectionType, 40).toLowerCase();
      if (!inspectionType) return { ok: false, error: "inspectionType_required" };
      if (!INSPECTION_TYPES.includes(inspectionType)) return { ok: false, error: "invalid_inspectionType" };
      const inspector = clean(params.inspector, 120);
      if (!inspector) return { ok: false, error: "inspector_required" };
      const jurisdiction = clean(params.jurisdiction, 120);
      if (!jurisdiction) return { ok: false, error: "jurisdiction_required" };
      const scheduledDate = clean(params.scheduledDate, 16);
      if (!scheduledDate) return { ok: false, error: "scheduledDate_required" };
      const dispatchById = new Map(list(g.s.dispatch, userId).map(d => [d.id, d]));
      const inspections = list(g.s.inspections, userId);
      const number = `INSP-${String(inspections.length + 1).padStart(3, "0")}`;
      const insp = {
        id: pid("insp"), number, assignmentId,
        inspectionType, inspector, jurisdiction,
        permitNumber: clean(params.permitNumber, 60),
        scheduledDate,
        result: "pending", deficiencyNotes: null, reInspectionDate: null,
        notes: clean(params.notes, 500),
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: null,
      };
      inspections.push(insp); savePlumb();
      return { ok: true, result: { inspection: deriveInspectionJobFields(insp, dispatchById) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("plumbing", "inspectionList", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const userId = actor(ctx);
      let rows = list(g.s.inspections, userId);
      if (params.assignmentId) rows = rows.filter(i => i.assignmentId === params.assignmentId);
      const dispatchById = new Map(list(g.s.dispatch, userId).map(d => [d.id, d]));
      const enriched = rows.map(i => deriveInspectionJobFields(i, dispatchById));
      return {
        ok: true,
        result: {
          inspections: enriched, count: enriched.length,
          passCount: enriched.filter(i => i.result === "pass").length,
          failCount: enriched.filter(i => i.result === "fail").length,
          pendingCount: enriched.filter(i => i.result === "pending").length,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
  registerLensAction("plumbing", "inspectionUpdate", (ctx, _artifact, params = {}) => {
    try {
      const g = guard(); if (g.error) return g.error;
      const userId = actor(ctx);
      const rows = list(g.s.inspections, userId);
      const insp = rows.find(i => i.id === params.id);
      if (!insp) return { ok: false, error: "inspection_not_found" };
      if (!params.result) return { ok: false, error: "result_required" };
      if (!INSPECTION_RESULTS.includes(params.result)) return { ok: false, error: "invalid_result" };
      const result = params.result;
      if (result === "fail") {
        const deficiencyNotes = clean(params.deficiencyNotes, 1000);
        if (!deficiencyNotes) return { ok: false, error: "deficiencyNotes_required_on_fail" };
        insp.deficiencyNotes = deficiencyNotes;
        insp.reInspectionDate = clean(params.reInspectionDate, 16) || null;
      } else if (result === "pass") {
        insp.deficiencyNotes = null;
        insp.reInspectionDate = null;
      } else {
        // back to pending — keep any prior deficiency notes visible, but
        // allow the caller to update them (e.g. re-inspection notes).
        if (params.deficiencyNotes != null) insp.deficiencyNotes = clean(params.deficiencyNotes, 1000) || null;
        if (params.reInspectionDate != null) insp.reInspectionDate = clean(params.reInspectionDate, 16) || null;
      }
      insp.result = result;
      insp.updatedAt = new Date().toISOString();
      insp.completedAt = result === "pending" ? null : new Date().toISOString();
      savePlumb();
      const dispatchById = new Map(list(g.s.dispatch, userId).map(d => [d.id, d]));
      return { ok: true, result: { inspection: deriveInspectionJobFields(insp, dispatchById) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
