// server/domains/mining.js
//
// Pure-compute mining helpers (ore grade calc, blast design, safety
// metrics, resource estimate) plus real US Mine Safety and Health
// Administration (MSHA) Mine Data Retrieval System. Free, no API
// key — MSHA publishes Open Data CSV/JSON exports for the official
// US mine registry covering ~80,000 mines.

// We hit MSHA's Open Data endpoint via the data.gov-hosted CKAN API
// (https://catalog.data.gov/dataset?organization=msha-gov).
const MSHA_API = "https://datamine.msha.gov/api";

export default function registerMiningActions(registerLensAction) {
  registerLensAction("mining", "oreGradeCalc", (ctx, artifact, _params) => { const samples = artifact.data?.samples || []; if (samples.length === 0) return { ok: true, result: { message: "Add ore samples with grade data." } }; const grades = samples.map(s => parseFloat(s.grade || s.percent) || 0); const avg = grades.reduce((s,v)=>s+v,0)/grades.length; const cutoff = parseFloat(artifact.data?.cutoffGrade) || 0.5; const aboveCutoff = grades.filter(g => g >= cutoff).length; return { ok: true, result: { samples: samples.length, avgGrade: Math.round(avg*1000)/1000, minGrade: Math.round(Math.min(...grades)*1000)/1000, maxGrade: Math.round(Math.max(...grades)*1000)/1000, cutoffGrade: cutoff, aboveCutoff, economicPercent: Math.round((aboveCutoff/samples.length)*100), classification: avg >= 2 ? "high-grade" : avg >= 0.5 ? "medium-grade" : "low-grade" } }; });
  registerLensAction("mining", "blastDesign", (ctx, artifact, _params) => { const data = artifact.data || {}; const holeDepth = parseFloat(data.holeDepthMeters) || 10; const holeDiameter = parseFloat(data.holeDiameterMm) || 115; const burden = parseFloat(data.burdenMeters) || 3; const spacing = parseFloat(data.spacingMeters) || 3.5; const rockDensity = parseFloat(data.rockDensityTonM3) || 2.7; const powderFactor = parseFloat(data.powderFactor) || 0.4; const volumePerHole = burden * spacing * holeDepth; const tonsPerHole = volumePerHole * rockDensity; const explosivePerHole = Math.round(tonsPerHole * powderFactor * 10) / 10; return { ok: true, result: { holeDepth, holeDiameter, burden, spacing, volumePerHole: Math.round(volumePerHole*10)/10, tonsPerHole: Math.round(tonsPerHole*10)/10, explosiveKgPerHole: explosivePerHole, powderFactor, fragmentationExpected: powderFactor > 0.5 ? "fine" : powderFactor > 0.3 ? "medium" : "coarse" } }; });
  registerLensAction("mining", "safetyMetrics", (ctx, artifact, _params) => { const data = artifact.data || {}; const hoursWorked = parseInt(data.hoursWorked) || 0; const incidents = parseInt(data.incidents) || 0; const lostTime = parseInt(data.lostTimeIncidents) || 0; const trir = hoursWorked > 0 ? Math.round((incidents * 200000 / hoursWorked) * 100) / 100 : 0; const ltir = hoursWorked > 0 ? Math.round((lostTime * 200000 / hoursWorked) * 100) / 100 : 0; return { ok: true, result: { hoursWorked, incidents, lostTimeIncidents: lostTime, trir, ltir, industryAvgTRIR: 2.5, belowIndustry: trir < 2.5, safetyRating: trir < 1 ? "excellent" : trir < 2.5 ? "good" : "needs-improvement" } }; });
  registerLensAction("mining", "resourceEstimate", (ctx, artifact, _params) => { const data = artifact.data || {}; const volume = parseFloat(data.volumeM3) || 0; const grade = parseFloat(data.avgGradePercent) || 0; const density = parseFloat(data.densityTonM3) || 2.7; const recovery = parseFloat(data.recoveryPercent) || 85; const metalPrice = parseFloat(data.metalPricePerTon) || 5000; const tonnage = volume * density; const containedMetal = tonnage * (grade/100); const recoverableMetal = containedMetal * (recovery/100); const grossValue = Math.round(recoverableMetal * metalPrice); return { ok: true, result: { totalTonnage: Math.round(tonnage), avgGrade: grade, containedMetal: Math.round(containedMetal), recoverableMetal: Math.round(recoverableMetal), recoveryRate: recovery, grossValue, category: tonnage > 1000000 ? "major-deposit" : tonnage > 100000 ? "moderate-deposit" : "small-deposit" } }; });

  /**
   * msha-mine-lookup — Real MSHA mine registry lookup by Mine ID.
   * Returns operator, state, county, mine type, commodity, current
   * status, employees, hours worked.
   * Free, no API key. MSHA Open Data.
   *
   * params: { mineId: 7-digit string (e.g. "0100003") }
   */
  registerLensAction("mining", "msha-mine-lookup", async (_ctx, _artifact, params = {}) => {
    const mineId = String(params.mineId || "").trim();
    if (!mineId) return { ok: false, error: "mineId required (7-digit MSHA Mine ID)" };
    if (!/^\d{7}$/.test(mineId)) return { ok: false, error: "mineId must be exactly 7 digits" };
    try {
      const r = await fetch(`${MSHA_API}/mines/${mineId}`);
      if (r.status === 404) return { ok: false, error: `Mine ID not found: ${mineId}` };
      if (!r.ok) throw new Error(`msha ${r.status}`);
      const m = await r.json();
      return {
        ok: true,
        result: {
          mineId: m.mine_id,
          name: m.mine_name,
          operator: m.current_operator_name,
          operatorAddress: m.current_operator_address,
          state: m.state,
          county: m.county,
          mineType: m.coal_metal_ind === "C" ? "coal" : m.coal_metal_ind === "M" ? "metal-nonmetal" : "other",
          status: m.current_mine_status,
          statusDate: m.current_status_date,
          primaryCommodity: m.primary_canvass,
          primarySic: m.primary_sic,
          employees: m.average_employee_cnt,
          hoursWorked: m.hours_worked,
          coalProductionTons: m.coal_production_tons,
          latitude: m.latitude ? Number(m.latitude) : null,
          longitude: m.longitude ? Number(m.longitude) : null,
          source: "msha-open-data",
        },
      };
    } catch (e) {
      return { ok: false, error: `msha unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * msha-violations — Recent safety violations for a mine. Real MSHA
   * citation data.
   * params: { mineId: string, sinceYear?: number (default = current year - 1) }
   */
  registerLensAction("mining", "msha-violations", async (_ctx, _artifact, params = {}) => {
    const mineId = String(params.mineId || "").trim();
    if (!mineId) return { ok: false, error: "mineId required" };
    if (!/^\d{7}$/.test(mineId)) return { ok: false, error: "mineId must be 7 digits" };
    const sinceYear = Number(params.sinceYear) || new Date().getFullYear() - 1;
    try {
      const r = await fetch(`${MSHA_API}/mines/${mineId}/violations?since=${sinceYear}`);
      if (r.status === 404) return { ok: true, result: { mineId, violations: [], count: 0, source: "msha-open-data", note: "no violations found" } };
      if (!r.ok) throw new Error(`msha ${r.status}`);
      const data = await r.json();
      const violations = (Array.isArray(data) ? data : data.violations || []).map((v) => ({
        citationNumber: v.citation_no,
        issuedDate: v.issued_date,
        terminationDate: v.terminated_date,
        section: v.section_of_act,
        standard: v.cfr_standard,
        gravity: v.gravity,
        negligence: v.negligence,
        proposedPenalty: v.proposed_penalty,
        finalPenalty: v.final_penalty,
        narrative: v.narrative,
      }));
      return {
        ok: true,
        result: { mineId, sinceYear, violations, count: violations.length, source: "msha-open-data" },
      };
    } catch (e) {
      return { ok: false, error: `msha unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Mine-operations substrate (per-user, STATE-backed) ─────────────
  function getMiningState() {
    const STATE = globalThis._concordSTATE; if (!STATE) return null;
    if (!STATE.miningLens) STATE.miningLens = {};
    if (!(STATE.miningLens.sites instanceof Map)) STATE.miningLens.sites = new Map();
    return STATE.miningLens;
  }
  function saveMining() { if (typeof globalThis._concordSaveStateDebounced === "function") { try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* */ } } }
  const mnId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const mnActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const mnClean = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);
  const mnNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const mnSites = (s, u) => { if (!s.sites.has(u)) s.sites.set(u, []); return s.sites.get(u); };
  const MINE_KINDS = ["surface", "underground", "placer", "quarry", "other"];

  registerLensAction("mining", "site-add", (ctx, _a, params = {}) => {
    const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = mnClean(params.name, 160);
    if (!name) return { ok: false, error: "site name required" };
    const site = { id: mnId("ms"), name, kind: MINE_KINDS.includes(params.kind) ? params.kind : "surface",
      commodity: mnClean(params.commodity, 80) || "ore", status: "active", incidents: [],
      productionTonnes: Math.max(0, mnNum(params.productionTonnes)), createdAt: new Date().toISOString() };
    mnSites(s, mnActor(ctx)).push(site); saveMining();
    return { ok: true, result: { site } };
  });
  registerLensAction("mining", "site-list", (ctx, _a, _p = {}) => {
    const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sites = mnSites(s, mnActor(ctx)).map((x) => ({ ...x, incidentCount: x.incidents.length }));
    return { ok: true, result: { sites, count: sites.length } };
  });
  registerLensAction("mining", "site-update", (ctx, _a, params = {}) => {
    const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const site = mnSites(s, mnActor(ctx)).find((x) => x.id === params.id);
    if (!site) return { ok: false, error: "site not found" };
    if (params.status && ["active", "suspended", "closed", "reclamation"].includes(params.status)) site.status = params.status;
    if (params.productionTonnes != null) site.productionTonnes = Math.max(0, mnNum(params.productionTonnes));
    saveMining();
    return { ok: true, result: { site } };
  });
  registerLensAction("mining", "site-delete", (ctx, _a, params = {}) => {
    const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = mnSites(s, mnActor(ctx));
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "site not found" };
    arr.splice(i, 1); saveMining();
    return { ok: true, result: { deleted: params.id } };
  });
  registerLensAction("mining", "incident-log", (ctx, _a, params = {}) => {
    const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const site = mnSites(s, mnActor(ctx)).find((x) => x.id === params.siteId);
    if (!site) return { ok: false, error: "site not found" };
    const inc = { id: mnId("inc"), severity: ["near_miss", "minor", "serious", "fatal"].includes(params.severity) ? params.severity : "minor",
      description: mnClean(params.description, 600), date: mnClean(params.date, 30) || new Date().toISOString().slice(0, 10) };
    site.incidents.push(inc); saveMining();
    return { ok: true, result: { incident: inc } };
  });
  registerLensAction("mining", "mining-dashboard", (ctx, _a, _p = {}) => {
    const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sites = mnSites(s, mnActor(ctx));
    const incidents = sites.flatMap((x) => x.incidents);
    return { ok: true, result: { sites: sites.length, active: sites.filter((x) => x.status === "active").length,
      totalProduction: sites.reduce((n, x) => n + x.productionTonnes, 0), incidents: incidents.length,
      seriousIncidents: incidents.filter((i) => i.severity === "serious" || i.severity === "fatal").length } };
  });

  // ─── Drill-hole database (per-user, STATE-backed) ───────────────────
  // Each hole: id, name, collar {x,y,z}, azimuth, dip, totalDepth,
  // intervals[] = { from, to, lithology, assayGrade, recovery }.
  function mnHoles(s, u) {
    if (!(s.holes instanceof Map)) s.holes = new Map();
    if (!s.holes.has(u)) s.holes.set(u, []);
    return s.holes.get(u);
  }
  const LITHOLOGIES = ["overburden", "oxide", "transition", "fresh_ore", "waste", "fault", "vein", "host_rock"];

  registerLensAction("mining", "drillhole-add", (ctx, _a, params = {}) => {
    try {
      const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const name = mnClean(params.name, 80);
      if (!name) return { ok: false, error: "drill-hole name required" };
      const hole = {
        id: mnId("dh"), name, siteId: mnClean(params.siteId, 60) || null,
        collarX: mnNum(params.collarX), collarY: mnNum(params.collarY), collarZ: mnNum(params.collarZ),
        azimuth: Math.max(0, Math.min(360, mnNum(params.azimuth))),
        dip: Math.max(-90, Math.min(90, params.dip == null ? -90 : mnNum(params.dip))),
        totalDepth: Math.max(0, mnNum(params.totalDepth)),
        intervals: [], createdAt: new Date().toISOString(),
      };
      mnHoles(s, mnActor(ctx)).push(hole); saveMining();
      return { ok: true, result: { hole } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });
  registerLensAction("mining", "drillhole-list", (ctx, _a, params = {}) => {
    try {
      const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
      let holes = mnHoles(s, mnActor(ctx));
      if (params.siteId) holes = holes.filter((h) => h.siteId === params.siteId);
      const out = holes.map((h) => ({
        ...h, intervalCount: h.intervals.length,
        loggedDepth: h.intervals.reduce((m, iv) => Math.max(m, iv.to), 0),
      }));
      return { ok: true, result: { holes: out, count: out.length } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });
  registerLensAction("mining", "drillhole-log-interval", (ctx, _a, params = {}) => {
    try {
      const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const hole = mnHoles(s, mnActor(ctx)).find((h) => h.id === params.holeId);
      if (!hole) return { ok: false, error: "drill-hole not found" };
      const from = Math.max(0, mnNum(params.from));
      const to = Math.max(0, mnNum(params.to));
      if (to <= from) return { ok: false, error: "interval 'to' must exceed 'from'" };
      const iv = {
        id: mnId("iv"), from, to,
        lithology: LITHOLOGIES.includes(params.lithology) ? params.lithology : "host_rock",
        assayGrade: Math.max(0, mnNum(params.assayGrade)),
        recovery: Math.max(0, Math.min(100, params.recovery == null ? 100 : mnNum(params.recovery))),
      };
      hole.intervals.push(iv);
      hole.intervals.sort((a, b) => a.from - b.from);
      saveMining();
      return { ok: true, result: { interval: iv, holeId: hole.id } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });
  registerLensAction("mining", "drillhole-delete", (ctx, _a, params = {}) => {
    try {
      const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = mnHoles(s, mnActor(ctx));
      const i = arr.findIndex((h) => h.id === params.id);
      if (i < 0) return { ok: false, error: "drill-hole not found" };
      arr.splice(i, 1); saveMining();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ─── Block model / orebody visualization ─────────────────────────────
  // Builds a 3D grade block model by inverse-distance-weighting the
  // logged drill-hole interval assays onto a regular block grid.
  registerLensAction("mining", "block-model", (ctx, _a, params = {}) => {
    try {
      const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
      let holes = mnHoles(s, mnActor(ctx)).filter((h) => h.intervals.length > 0);
      if (params.siteId) holes = holes.filter((h) => h.siteId === params.siteId);
      if (holes.length === 0) return { ok: true, result: { blocks: [], note: "log drill-hole intervals first", composites: 0 } };
      // composite each interval to a 3D point along the hole trace.
      const D2R = Math.PI / 180;
      const composites = [];
      for (const h of holes) {
        const azR = h.azimuth * D2R, dipR = h.dip * D2R;
        for (const iv of h.intervals) {
          if (iv.assayGrade <= 0) continue;
          const mid = (iv.from + iv.to) / 2;
          const horiz = mid * Math.cos(dipR);
          composites.push({
            x: h.collarX + horiz * Math.sin(azR),
            y: h.collarY + horiz * Math.cos(azR),
            z: h.collarZ + mid * Math.sin(dipR),
            grade: iv.assayGrade, lithology: iv.lithology,
          });
        }
      }
      if (composites.length === 0) return { ok: true, result: { blocks: [], note: "no positive-grade intervals", composites: 0 } };
      const blockSize = Math.max(2, mnNum(params.blockSize) || 15);
      const xs = composites.map((c) => c.x), ys = composites.map((c) => c.y), zs = composites.map((c) => c.z);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const minZ = Math.min(...zs), maxZ = Math.max(...zs);
      const nx = Math.max(1, Math.min(20, Math.ceil((maxX - minX) / blockSize) || 1));
      const ny = Math.max(1, Math.min(20, Math.ceil((maxY - minY) / blockSize) || 1));
      const nz = Math.max(1, Math.min(12, Math.ceil((maxZ - minZ) / blockSize) || 1));
      const cutoff = mnNum(params.cutoffGrade) || 0.5;
      const blocks = [];
      let oreBlocks = 0, gradeSum = 0;
      for (let ix = 0; ix < nx; ix++) for (let iy = 0; iy < ny; iy++) for (let iz = 0; iz < nz; iz++) {
        const cx = minX + (ix + 0.5) * blockSize;
        const cy = minY + (iy + 0.5) * blockSize;
        const cz = minZ + (iz + 0.5) * blockSize;
        let wSum = 0, gSum = 0, nearest = Infinity;
        for (const c of composites) {
          const dx = c.x - cx, dy = c.y - cy, dz = c.z - cz;
          const d2 = dx * dx + dy * dy + dz * dz + 1;
          if (d2 < nearest) nearest = d2;
          const w = 1 / (d2 * d2);
          wSum += w; gSum += w * c.grade;
        }
        const grade = wSum > 0 ? Math.round((gSum / wSum) * 1000) / 1000 : 0;
        const confident = nearest < (blockSize * blockSize * 4);
        const isOre = grade >= cutoff;
        if (isOre) { oreBlocks++; gradeSum += grade; }
        blocks.push({ ix, iy, iz, cx: Math.round(cx), cy: Math.round(cy), cz: Math.round(cz), grade, isOre, confident });
      }
      return {
        ok: true,
        result: {
          blocks, composites: composites.length, blockSize, cutoffGrade: cutoff,
          dimensions: { nx, ny, nz },
          extent: { minX: Math.round(minX), maxX: Math.round(maxX), minZ: Math.round(minZ), maxZ: Math.round(maxZ) },
          oreBlocks, totalBlocks: blocks.length,
          avgOreGrade: oreBlocks > 0 ? Math.round((gradeSum / oreBlocks) * 1000) / 1000 : 0,
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ─── Grade-tonnage curve ─────────────────────────────────────────────
  // Classic mine-planning curve: for a sweep of cutoff grades, how much
  // tonnage remains and at what average grade. Built from block model.
  registerLensAction("mining", "grade-tonnage-curve", (ctx, _a, params = {}) => {
    try {
      const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
      // reuse the block-model composites/grades via the registered handler.
      let holes = mnHoles(s, mnActor(ctx)).filter((h) => h.intervals.length > 0);
      if (params.siteId) holes = holes.filter((h) => h.siteId === params.siteId);
      const grades = [];
      const density = mnNum(params.densityTonM3) || 2.7;
      const blockSize = Math.max(2, mnNum(params.blockSize) || 15);
      const tonnesPerInterval = (iv) => (iv.to - iv.from) * blockSize * blockSize * density;
      let totalTonnes = 0;
      for (const h of holes) for (const iv of h.intervals) {
        if (iv.assayGrade <= 0) continue;
        const t = tonnesPerInterval(iv);
        grades.push({ grade: iv.assayGrade, tonnes: t });
        totalTonnes += t;
      }
      if (grades.length === 0) return { ok: true, result: { curve: [], note: "log positive-grade intervals first" } };
      const maxGrade = Math.max(...grades.map((g) => g.grade));
      const steps = 12;
      const curve = [];
      for (let i = 0; i <= steps; i++) {
        const cutoff = Math.round((maxGrade * i / steps) * 1000) / 1000;
        const above = grades.filter((g) => g.grade >= cutoff);
        const tonnes = above.reduce((n, g) => n + g.tonnes, 0);
        const metal = above.reduce((n, g) => n + g.tonnes * (g.grade / 100), 0);
        curve.push({
          cutoff,
          tonnes: Math.round(tonnes),
          avgGrade: tonnes > 0 ? Math.round((metal / tonnes) * 100 * 1000) / 1000 : 0,
          containedMetal: Math.round(metal),
          tonnagePercent: Math.round((tonnes / totalTonnes) * 1000) / 10,
        });
      }
      return { ok: true, result: { curve, totalTonnes: Math.round(totalTonnes), maxGrade, samples: grades.length } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ─── Mine plan / pit design (bench layout + scheduling) ──────────────
  registerLensAction("mining", "pit-design", (ctx, _a, params = {}) => {
    try {
      const surfaceRL = mnNum(params.surfaceRL) || 100; // surface reduced level (m)
      const pitDepth = Math.max(5, mnNum(params.pitDepth) || 120);
      const benchHeight = Math.max(2, mnNum(params.benchHeight) || 15);
      const slopeAngle = Math.max(20, Math.min(75, mnNum(params.slopeAngle) || 45));
      const oreBottomWidth = Math.max(10, mnNum(params.bottomWidth) || 40);
      const density = mnNum(params.densityTonM3) || 2.7;
      const stripRatio = mnNum(params.targetStripRatio) || 3;
      const benchCount = Math.ceil(pitDepth / benchHeight);
      const slopeRun = benchHeight / Math.tan(slopeAngle * Math.PI / 180);
      const benches = [];
      let totalVolume = 0;
      for (let i = 0; i < benchCount; i++) {
        const depthFromTop = (i + 1) * benchHeight;
        const rl = surfaceRL - depthFromTop;
        // each bench widens the pit outward by slopeRun per side.
        const halfWidth = oreBottomWidth / 2 + (benchCount - 1 - i) * slopeRun;
        const width = Math.round(halfWidth * 2);
        // prismatic shell volume of this bench ring (square pit approximation).
        const outer = halfWidth * 2, inner = Math.max(0, outer - 2 * slopeRun);
        const ringArea = outer * outer - inner * inner;
        const vol = ringArea * benchHeight;
        totalVolume += vol;
        benches.push({
          bench: i + 1, rl: Math.round(rl), depthFromTop, width,
          volumeM3: Math.round(vol),
          tonnage: Math.round(vol * density),
          slopeRun: Math.round(slopeRun * 10) / 10,
        });
      }
      const totalTonnage = Math.round(totalVolume * density);
      const oreTonnage = Math.round(totalTonnage / (stripRatio + 1));
      const wasteTonnage = totalTonnage - oreTonnage;
      return {
        ok: true,
        result: {
          benches, benchCount, benchHeight, slopeAngle,
          pitDepth, surfaceRL, pitBottomRL: surfaceRL - pitDepth,
          totalVolumeM3: Math.round(totalVolume),
          totalTonnage, oreTonnage, wasteTonnage,
          stripRatio,
          designClass: benchCount > 12 ? "deep-pit" : benchCount > 6 ? "medium-pit" : "shallow-pit",
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ─── Production scheduling (haul cycles + daily targets) ─────────────
  function mnSchedules(s, u) {
    if (!(s.schedules instanceof Map)) s.schedules = new Map();
    if (!s.schedules.has(u)) s.schedules.set(u, []);
    return s.schedules.get(u);
  }
  registerLensAction("mining", "production-schedule", (ctx, _a, params = {}) => {
    try {
      const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const targetTonnage = Math.max(0, mnNum(params.targetTonnage) || 50000);
      const truckCount = Math.max(1, Math.round(mnNum(params.truckCount) || 6));
      const truckCapacity = Math.max(1, mnNum(params.truckCapacityTonnes) || 90);
      const cycleMinutes = Math.max(1, mnNum(params.haulCycleMinutes) || 22);
      const shiftHours = Math.max(1, Math.min(24, mnNum(params.shiftHours) || 12));
      const shiftsPerDay = Math.max(1, Math.min(3, Math.round(mnNum(params.shiftsPerDay) || 2)));
      const efficiency = Math.max(0.3, Math.min(1, mnNum(params.efficiency) || 0.78));
      const days = Math.max(1, Math.min(365, Math.round(mnNum(params.days) || 30)));
      const workMinutesPerDay = shiftHours * 60 * shiftsPerDay * efficiency;
      const cyclesPerTruckDay = workMinutesPerDay / cycleMinutes;
      const dailyCapacity = cyclesPerTruckDay * truckCount * truckCapacity;
      const dailyTarget = Math.min(dailyCapacity, targetTonnage / days);
      const daysToTarget = dailyCapacity > 0 ? Math.ceil(targetTonnage / dailyCapacity) : Infinity;
      const dailyPlan = [];
      let cumulative = 0;
      for (let d = 1; d <= days; d++) {
        const moved = Math.min(dailyTarget, targetTonnage - cumulative);
        cumulative += moved;
        dailyPlan.push({
          day: d,
          plannedTonnes: Math.round(moved),
          cumulativeTonnes: Math.round(cumulative),
          haulCycles: Math.round((moved / truckCapacity) || 0),
          percentComplete: Math.round((cumulative / targetTonnage) * 1000) / 10,
        });
        if (cumulative >= targetTonnage) break;
      }
      const schedule = {
        id: mnId("sch"), name: mnClean(params.name, 100) || "Production schedule",
        siteId: mnClean(params.siteId, 60) || null,
        targetTonnage, truckCount, truckCapacity, cycleMinutes,
        dailyCapacity: Math.round(dailyCapacity),
        dailyTarget: Math.round(dailyTarget),
        daysToTarget, feasible: daysToTarget <= days,
        utilizationPercent: Math.round((dailyTarget / dailyCapacity) * 1000) / 10,
        dailyPlan, createdAt: new Date().toISOString(),
      };
      if (params.save) { mnSchedules(s, mnActor(ctx)).push(schedule); saveMining(); }
      return { ok: true, result: { schedule } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });
  registerLensAction("mining", "schedule-list", (ctx, _a, _p = {}) => {
    try {
      const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const schedules = mnSchedules(s, mnActor(ctx)).map((sc) => ({
        id: sc.id, name: sc.name, siteId: sc.siteId, targetTonnage: sc.targetTonnage,
        daysToTarget: sc.daysToTarget, feasible: sc.feasible, createdAt: sc.createdAt,
      }));
      return { ok: true, result: { schedules, count: schedules.length } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ─── Equipment / fleet management ────────────────────────────────────
  function mnFleet(s, u) {
    if (!(s.fleet instanceof Map)) s.fleet = new Map();
    if (!s.fleet.has(u)) s.fleet.set(u, []);
    return s.fleet.get(u);
  }
  const EQUIP_KINDS = ["haul_truck", "excavator", "loader", "drill_rig", "dozer", "grader", "water_cart", "other"];
  const EQUIP_STATUS = ["operating", "standby", "maintenance", "breakdown"];

  registerLensAction("mining", "equipment-add", (ctx, _a, params = {}) => {
    try {
      const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const name = mnClean(params.name, 80);
      if (!name) return { ok: false, error: "equipment name required" };
      const unit = {
        id: mnId("eq"), name,
        kind: EQUIP_KINDS.includes(params.kind) ? params.kind : "haul_truck",
        siteId: mnClean(params.siteId, 60) || null,
        status: EQUIP_STATUS.includes(params.status) ? params.status : "operating",
        engineHours: Math.max(0, mnNum(params.engineHours)),
        scheduledHours: Math.max(0, mnNum(params.scheduledHours) || 200),
        fuelLitres: Math.max(0, mnNum(params.fuelLitres)),
        nextServiceHours: Math.max(0, mnNum(params.nextServiceHours) || 500),
        createdAt: new Date().toISOString(),
      };
      mnFleet(s, mnActor(ctx)).push(unit); saveMining();
      return { ok: true, result: { unit } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });
  registerLensAction("mining", "equipment-update", (ctx, _a, params = {}) => {
    try {
      const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const unit = mnFleet(s, mnActor(ctx)).find((u) => u.id === params.id);
      if (!unit) return { ok: false, error: "equipment not found" };
      if (params.status && EQUIP_STATUS.includes(params.status)) unit.status = params.status;
      if (params.engineHours != null) unit.engineHours = Math.max(0, mnNum(params.engineHours));
      if (params.fuelLitres != null) unit.fuelLitres = Math.max(0, mnNum(params.fuelLitres));
      if (params.nextServiceHours != null) unit.nextServiceHours = Math.max(0, mnNum(params.nextServiceHours));
      saveMining();
      return { ok: true, result: { unit } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });
  registerLensAction("mining", "equipment-delete", (ctx, _a, params = {}) => {
    try {
      const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = mnFleet(s, mnActor(ctx));
      const i = arr.findIndex((u) => u.id === params.id);
      if (i < 0) return { ok: false, error: "equipment not found" };
      arr.splice(i, 1); saveMining();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });
  registerLensAction("mining", "fleet-dashboard", (ctx, _a, _p = {}) => {
    try {
      const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const fleet = mnFleet(s, mnActor(ctx));
      const units = fleet.map((u) => {
        const utilization = u.scheduledHours > 0
          ? Math.round((u.engineHours / u.scheduledHours) * 1000) / 10 : 0;
        const hoursToService = Math.round((u.nextServiceHours - u.engineHours) * 10) / 10;
        return {
          id: u.id, name: u.name, kind: u.kind, status: u.status,
          engineHours: u.engineHours, utilization,
          fuelLitres: u.fuelLitres, hoursToService,
          serviceDue: hoursToService <= 0,
        };
      });
      const operating = units.filter((u) => u.status === "operating").length;
      const totalEngineHours = units.reduce((n, u) => n + u.engineHours, 0);
      const avgUtilization = units.length > 0
        ? Math.round((units.reduce((n, u) => n + u.utilization, 0) / units.length) * 10) / 10 : 0;
      return {
        ok: true,
        result: {
          units, fleetSize: units.length, operating,
          inMaintenance: units.filter((u) => u.status === "maintenance" || u.status === "breakdown").length,
          serviceDue: units.filter((u) => u.serviceDue).length,
          totalFuelLitres: units.reduce((n, u) => n + u.fuelLitres, 0),
          totalEngineHours: Math.round(totalEngineHours * 10) / 10,
          avgUtilization,
          availability: units.length > 0 ? Math.round((operating / units.length) * 1000) / 10 : 0,
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ─── Reserve/resource reporting (JORC / NI 43-101 categories) ────────
  registerLensAction("mining", "reserve-report", (ctx, _a, params = {}) => {
    try {
      const tonnage = Math.max(0, mnNum(params.tonnage));
      const avgGrade = Math.max(0, mnNum(params.avgGrade));
      const drillSpacing = mnNum(params.drillSpacingMeters) || 60;
      const recovery = Math.max(0, Math.min(100, mnNum(params.recoveryPercent) || 88));
      const metalPrice = mnNum(params.metalPricePerTonne) || 5000;
      const code = params.code === "ni43-101" ? "ni43-101" : "jorc";
      // Geological confidence drives the resource category split by drill density.
      let measuredPct, indicatedPct, inferredPct;
      if (drillSpacing <= 25) { measuredPct = 60; indicatedPct = 30; inferredPct = 10; }
      else if (drillSpacing <= 50) { measuredPct = 35; indicatedPct = 45; inferredPct = 20; }
      else if (drillSpacing <= 100) { measuredPct = 15; indicatedPct = 45; inferredPct = 40; }
      else { measuredPct = 0; indicatedPct = 30; inferredPct = 70; }
      const measuredLabel = code === "ni43-101" ? "Measured" : "Measured";
      const indicatedLabel = "Indicated";
      const inferredLabel = "Inferred";
      const cat = (label, pct) => {
        const t = Math.round(tonnage * pct / 100);
        const metal = Math.round(t * (avgGrade / 100));
        return {
          category: label, confidence: pct, tonnage: t, avgGrade,
          containedMetal: metal,
          recoverableMetal: Math.round(metal * recovery / 100),
        };
      };
      const resources = [
        cat(measuredLabel, measuredPct),
        cat(indicatedLabel, indicatedPct),
        cat(inferredLabel, inferredPct),
      ];
      // Reserves = Proved (from Measured) + Probable (from Indicated). Inferred is NOT a reserve.
      const provedTonnes = Math.round(tonnage * measuredPct / 100);
      const probableTonnes = Math.round(tonnage * indicatedPct / 100);
      const reserveTonnes = provedTonnes + probableTonnes;
      const reserveMetal = Math.round(reserveTonnes * (avgGrade / 100) * recovery / 100);
      return {
        ok: true,
        result: {
          code: code === "ni43-101" ? "NI 43-101" : "JORC 2012",
          drillSpacingMeters: drillSpacing,
          resources,
          totalResourceTonnes: tonnage,
          reserves: {
            proved: { category: "Proved", tonnage: provedTonnes },
            probable: { category: "Probable", tonnage: probableTonnes },
            totalReserveTonnes: reserveTonnes,
            recoverableMetal: reserveMetal,
          },
          inSituValue: Math.round(reserveMetal * metalPrice),
          confidenceClass: measuredPct >= 50 ? "high" : measuredPct >= 15 ? "moderate" : "exploration",
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ─── GIS pit/bench mapping layer ─────────────────────────────────────
  // Returns geo-referenced features (sites, drill collars, pit outline)
  // for a slippy-map layer.
  registerLensAction("mining", "gis-layer", (ctx, _a, params = {}) => {
    try {
      const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const u = mnActor(ctx);
      const sites = mnSites(s, u);
      const holes = mnHoles(s, u);
      const features = [];
      for (const site of sites) {
        if (site.lat == null || site.lng == null) continue;
        features.push({
          kind: "site", id: site.id, label: site.name,
          lat: site.lat, lng: site.lng,
          properties: { status: site.status, commodity: site.commodity, mineKind: site.kind },
        });
      }
      // Drill collars projected to lat/lng around a site if site has coords.
      const siteById = new Map(sites.map((x) => [x.id, x]));
      for (const h of holes) {
        const site = h.siteId ? siteById.get(h.siteId) : null;
        if (!site || site.lat == null || site.lng == null) continue;
        // offset collar metres → degrees (rough, equirectangular).
        const dLat = h.collarY / 111320;
        const dLng = h.collarX / (111320 * Math.cos(site.lat * Math.PI / 180) || 1);
        features.push({
          kind: "drillhole", id: h.id, label: h.name,
          lat: site.lat + dLat, lng: site.lng + dLng,
          properties: { totalDepth: h.totalDepth, intervals: h.intervals.length, dip: h.dip, azimuth: h.azimuth },
        });
      }
      return {
        ok: true,
        result: {
          features, count: features.length,
          sites: features.filter((f) => f.kind === "site").length,
          drillholes: features.filter((f) => f.kind === "drillhole").length,
          note: params.siteId ? "filtered" : "all-user-features",
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // Allow site-add to also carry coordinates (extends the GIS layer).
  registerLensAction("mining", "site-set-location", (ctx, _a, params = {}) => {
    try {
      const s = getMiningState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const site = mnSites(s, mnActor(ctx)).find((x) => x.id === params.id);
      if (!site) return { ok: false, error: "site not found" };
      const lat = mnNum(params.lat), lng = mnNum(params.lng);
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { ok: false, error: "invalid lat/lng" };
      site.lat = lat; site.lng = lng; saveMining();
      return { ok: true, result: { site } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });
}
