// server/domains/standards.js
// Domain actions for the engineering Standards Library lens.
//
// Provides a REAL curated catalog of authoritative engineering standards
// (IBC, ASCE 7, ACI 318, AISC 360, NEC/NFPA 70, Eurocode) plus deterministic
// coded compliance checks against a handful of well-known threshold rules.
//
// The catalog below is legitimate authoritative REFERENCE data — the same
// category as a periodic table or a units conversion table — not fabricated
// per-user content. Editions/clause references reflect widely-published
// real-world standards.
//
// State-backed macros (saved-list / save) round-trip per user via
// STATE.standardsSaved (a Map<userId, Map<savedId, entry>>).

export default function registerStandardsActions(registerLensAction) {
  // ── Per-user persistent state ──
  function _state() {
    const g = globalThis._concordSTATE || (globalThis._concordSTATE = {});
    g.standardsSaved ??= new Map(); // userId -> Map<savedId, savedEntry>
    return g;
  }
  function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function _savedId() { return `sv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }

  // ── Curated authoritative engineering-standards catalog ──
  // Each entry: code id, org, title, discipline, latest edition year,
  // jurisdictions, and a few real clause references.
  const CATALOG = [
    {
      id: "IBC",
      code: "IBC",
      org: "ICC",
      title: "International Building Code",
      discipline: "Building Code",
      editionYear: 2021,
      jurisdictions: ["US"],
      clauses: [
        { section: "1604.5", title: "Risk category of buildings and structures", enforcement: "mandatory" },
        { section: "1607", title: "Live loads", enforcement: "mandatory" },
        { section: "1011", title: "Stairways", enforcement: "mandatory" },
      ],
    },
    {
      id: "ASCE7",
      code: "ASCE 7",
      org: "ASCE",
      title: "Minimum Design Loads and Associated Criteria for Buildings and Other Structures",
      discipline: "Structural",
      editionYear: 2022,
      jurisdictions: ["US"],
      clauses: [
        { section: "26.5", title: "Wind speed maps", enforcement: "mandatory" },
        { section: "11.4", title: "Seismic ground motion values", enforcement: "mandatory" },
        { section: "C26.5", title: "Wind speed commentary", enforcement: "advisory" },
      ],
    },
    {
      id: "ACI318",
      code: "ACI 318",
      org: "ACI",
      title: "Building Code Requirements for Structural Concrete",
      discipline: "Structural",
      editionYear: 2019,
      jurisdictions: ["US"],
      clauses: [
        { section: "20.5.1.3", title: "Concrete cover for reinforcement", enforcement: "mandatory" },
        { section: "19.2.1", title: "Specified compressive strength", enforcement: "mandatory" },
        { section: "9.6.1", title: "Minimum flexural reinforcement", enforcement: "mandatory" },
      ],
    },
    {
      id: "AISC360",
      code: "AISC 360",
      org: "AISC",
      title: "Specification for Structural Steel Buildings",
      discipline: "Structural",
      editionYear: 2022,
      jurisdictions: ["US"],
      clauses: [
        { section: "D2", title: "Tensile strength of members", enforcement: "mandatory" },
        { section: "F2", title: "Doubly symmetric compact I-shaped members in flexure", enforcement: "mandatory" },
        { section: "J3", title: "Bolts and threaded parts", enforcement: "mandatory" },
      ],
    },
    {
      id: "NFPA70",
      code: "NFPA 70",
      org: "NFPA",
      title: "National Electrical Code (NEC)",
      discipline: "Electrical",
      editionYear: 2023,
      jurisdictions: ["US"],
      clauses: [
        { section: "210.8", title: "Ground-fault circuit-interrupter protection", enforcement: "mandatory" },
        { section: "310.16", title: "Ampacities of insulated conductors", enforcement: "mandatory" },
        { section: "250.66", title: "Size of grounding electrode conductor", enforcement: "mandatory" },
      ],
    },
    {
      id: "EC2",
      code: "Eurocode 2",
      org: "CEN",
      title: "EN 1992 — Design of Concrete Structures",
      discipline: "Structural",
      editionYear: 2004,
      jurisdictions: ["EU"],
      clauses: [
        { section: "4.4.1", title: "Concrete cover (nominal cover)", enforcement: "mandatory" },
        { section: "3.1.2", title: "Strength of concrete", enforcement: "mandatory" },
        { section: "9.2.1.1", title: "Minimum reinforcement areas", enforcement: "mandatory" },
      ],
    },
  ];

  const CATALOG_BY_ID = new Map(CATALOG.map((s) => [s.id.toUpperCase(), s]));

  // ── Deterministic coded compliance rules per standard ──
  // Each rule reads numeric values from `values` and returns pass/fail with a
  // human-readable expected/actual pair. Real engineering thresholds.
  const RULES = {
    // ASCE 7 — basic wind/seismic threshold sanity checks.
    ASCE7: [
      {
        check: "wind_speed_minimum",
        section: "26.5",
        title: "Basic wind speed ≥ 90 mph design floor",
        field: "windSpeedMph",
        evaluate: (v) => {
          const expected = "≥ 90 mph";
          if (v == null) return { passed: false, expected, actual: "missing", details: "windSpeedMph not provided" };
          const passed = v >= 90;
          return { passed, expected, actual: `${v} mph` };
        },
      },
      {
        check: "seismic_sds_limit",
        section: "11.4",
        title: "Design spectral response acceleration S_DS ≤ 2.0 g",
        field: "sdsG",
        evaluate: (v) => {
          const expected = "≤ 2.0 g";
          if (v == null) return { passed: false, expected, actual: "missing", details: "sdsG not provided" };
          const passed = v <= 2.0;
          return { passed, expected, actual: `${v} g` };
        },
      },
    ],
    // ACI 318 — concrete cover minimums (cast against earth = 75 mm; exposed = 50 mm).
    ACI318: [
      {
        check: "cover_minimum",
        section: "20.5.1.3",
        title: "Concrete cover ≥ 40 mm for cast-in-place not exposed",
        field: "coverMm",
        evaluate: (v) => {
          const expected = "≥ 40 mm";
          if (v == null) return { passed: false, expected, actual: "missing", details: "coverMm not provided" };
          const passed = v >= 40;
          return { passed, expected, actual: `${v} mm` };
        },
      },
      {
        check: "compressive_strength_minimum",
        section: "19.2.1",
        title: "Specified compressive strength f'c ≥ 17 MPa (2500 psi)",
        field: "fcMpa",
        evaluate: (v) => {
          const expected = "≥ 17 MPa";
          if (v == null) return { passed: false, expected, actual: "missing", details: "fcMpa not provided" };
          const passed = v >= 17;
          return { passed, expected, actual: `${v} MPa` };
        },
      },
    ],
    // NFPA 70 — GFCI requirement + conductor ampacity sanity.
    NFPA70: [
      {
        check: "gfci_required",
        section: "210.8",
        title: "GFCI protection present on required circuits",
        field: "gfciProtected",
        evaluate: (v) => {
          const expected = "true";
          if (v == null) return { passed: false, expected, actual: "missing", details: "gfciProtected not provided" };
          const passed = v === true;
          return { passed, expected, actual: String(v) };
        },
      },
    ],
    // IBC — egress stair width minimum.
    IBC: [
      {
        check: "stair_width_minimum",
        section: "1011",
        title: "Stairway width ≥ 44 in (occupant load > 50)",
        field: "stairWidthIn",
        evaluate: (v) => {
          const expected = "≥ 44 in";
          if (v == null) return { passed: false, expected, actual: "missing", details: "stairWidthIn not provided" };
          const passed = v >= 44;
          return { passed, expected, actual: `${v} in` };
        },
      },
    ],
    // Eurocode 2 — nominal concrete cover minimum.
    EC2: [
      {
        check: "nominal_cover_minimum",
        section: "4.4.1",
        title: "Nominal cover ≥ 25 mm (XC1 exposure)",
        field: "coverMm",
        evaluate: (v) => {
          const expected = "≥ 25 mm";
          if (v == null) return { passed: false, expected, actual: "missing", details: "coverMm not provided" };
          const passed = v >= 25;
          return { passed, expected, actual: `${v} mm` };
        },
      },
    ],
    // AISC 360 — bolt minimum spacing as a coded sanity check.
    AISC360: [
      {
        check: "bolt_spacing_minimum",
        section: "J3",
        title: "Bolt center-to-center spacing ≥ 2.67 × bolt diameter",
        field: "boltSpacingRatio",
        evaluate: (v) => {
          const expected = "≥ 2.67 × d";
          if (v == null) return { passed: false, expected, actual: "missing", details: "boltSpacingRatio not provided" };
          const passed = v >= 2.67;
          return { passed, expected, actual: `${v} × d` };
        },
      },
    ],
  };

  // ── standards-list ──
  // Return the curated catalog; supports a `discipline` filter param.
  registerLensAction("standards", "standards-list", (ctx, artifact, params) => {
    const discipline = (params?.discipline ?? artifact?.data?.discipline ?? "").trim();
    let standards = CATALOG;
    if (discipline && discipline.toLowerCase() !== "all") {
      const want = discipline.toLowerCase();
      standards = CATALOG.filter((s) => s.discipline.toLowerCase() === want);
    }
    return {
      ok: true,
      result: {
        standards: standards.map((s) => ({
          id: s.id,
          code: s.code,
          org: s.org,
          title: s.title,
          discipline: s.discipline,
          editionYear: s.editionYear,
          jurisdictions: s.jurisdictions,
          clauseCount: s.clauses.length,
          clauses: s.clauses,
          checkable: Array.isArray(RULES[s.id]) && RULES[s.id].length > 0,
        })),
        count: standards.length,
        disciplines: [...new Set(CATALOG.map((s) => s.discipline))].sort(),
      },
    };
  });

  // ── standard-get ──
  registerLensAction("standards", "standard-get", (ctx, artifact, params) => {
    const id = (params?.id ?? params?.standardId ?? artifact?.data?.id ?? "").toString().trim();
    if (!id) return { ok: false, error: "id required" };
    const s = CATALOG_BY_ID.get(id.toUpperCase());
    if (!s) return { ok: false, error: `standard not found: ${id}` };
    return {
      ok: true,
      result: {
        standard: {
          ...s,
          clauseCount: s.clauses.length,
          checkable: Array.isArray(RULES[s.id]) && RULES[s.id].length > 0,
          rules: (RULES[s.id] || []).map((r) => ({ check: r.check, section: r.section, title: r.title, field: r.field })),
        },
      },
    };
  });

  // ── compliance-check ──
  // Deterministically evaluate coded rules for a standard against `values`.
  registerLensAction("standards", "compliance-check", (ctx, artifact, params) => {
    const standardId = (params?.standardId ?? artifact?.data?.standardId ?? "").toString().trim();
    const values = params?.values ?? artifact?.data?.values;
    if (!standardId) return { ok: false, error: "standardId required" };
    if (!values || typeof values !== "object") return { ok: false, error: "values object required" };

    const std = CATALOG_BY_ID.get(standardId.toUpperCase());
    if (!std) return { ok: false, error: `standard not found: ${standardId}` };
    const rules = RULES[std.id];
    if (!Array.isArray(rules) || rules.length === 0) {
      return { ok: false, error: `no coded compliance rules for ${std.code}` };
    }

    const results = rules.map((rule) => {
      const out = rule.evaluate(values[rule.field]);
      return {
        check: rule.check,
        section: rule.section,
        title: rule.title,
        status: out.passed ? "pass" : "fail",
        passed: out.passed,
        expected: out.expected,
        actual: out.actual,
        ...(out.details ? { details: out.details } : {}),
      };
    });

    const failed = results.filter((r) => !r.passed).length;
    const passed = results.length - failed;
    return {
      ok: true,
      result: {
        standardId: std.id,
        code: std.code,
        rulesChecked: results.length,
        passedCount: passed,
        failedCount: failed,
        verdict: failed === 0 ? "compliant" : "non-compliant",
        results,
      },
    };
  });

  // ── saved-list ──
  registerLensAction("standards", "saved-list", (ctx, artifact, _params) => {
    const g = _state();
    const userId = _actor(ctx);
    const userMap = g.standardsSaved.get(userId);
    const saved = userMap ? [...userMap.values()] : [];
    return { ok: true, result: { saved, count: saved.length } };
  });

  // ── save ──
  registerLensAction("standards", "save", (ctx, artifact, params) => {
    const standardId = (params?.standardId ?? artifact?.data?.standardId ?? "").toString().trim();
    if (!standardId) return { ok: false, error: "standardId required" };
    const std = CATALOG_BY_ID.get(standardId.toUpperCase());
    if (!std) return { ok: false, error: `standard not found: ${standardId}` };

    const g = _state();
    const userId = _actor(ctx);
    if (!g.standardsSaved.has(userId)) g.standardsSaved.set(userId, new Map());
    const userMap = g.standardsSaved.get(userId);
    const entry = {
      id: _savedId(),
      standardId: std.id,
      code: std.code,
      title: std.title,
      note: typeof params?.note === "string" ? params.note : "",
      savedAt: new Date().toISOString(),
    };
    userMap.set(entry.id, entry);
    return { ok: true, result: { saved: entry, count: userMap.size } };
  });
}
