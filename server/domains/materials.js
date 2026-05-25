// server/domains/materials.js
// Domain actions for materials science: property comparison, material
// selection, composite analysis, corrosion prediction, thermal
// analysis, plus real Materials Project API for ~150,000 inorganic
// crystalline materials. Free with API key from materialsproject.org
// (set MATERIALS_PROJECT_API_KEY env).

import { cachedFetchJson } from "../lib/external-fetch.js";

const MP_BASE = "https://api.materialsproject.org";

export default function registerMaterialsActions(registerLensAction) {
  /**
   * compareProperties
   * Side-by-side comparison of material properties with scoring.
   * artifact.data: { materials: [{ name, density, tensileStrength, thermalConductivity, meltingPoint, youngsModulus, hardness, cost }] }
   */
  registerLensAction("materials", "compareProperties", (ctx, artifact, _params) => {
  try {
    const materials = artifact.data?.materials || [];
    if (materials.length < 2) {
      return { ok: true, result: { message: "Add at least 2 materials to compare properties." } };
    }

    const properties = ["density", "tensileStrength", "thermalConductivity", "meltingPoint", "youngsModulus", "hardness"];
    const units = { density: "g/cm\u00B3", tensileStrength: "MPa", thermalConductivity: "W/mK", meltingPoint: "\u00B0C", youngsModulus: "GPa", hardness: "HV" };

    // For each property, find min/max and rank
    const comparison = {};
    for (const prop of properties) {
      const values = materials.map(m => ({ name: m.name, value: parseFloat(m[prop]) || 0 })).filter(v => v.value > 0);
      if (values.length === 0) continue;

      values.sort((a, b) => b.value - a.value);
      const max = values[0].value;
      const min = values[values.length - 1].value;

      comparison[prop] = {
        unit: units[prop] || "",
        values: values.map((v, i) => ({
          material: v.name,
          value: v.value,
          rank: i + 1,
          percentOfMax: max > 0 ? Math.round((v.value / max) * 100) : 0,
        })),
        highest: values[0].name,
        lowest: values[values.length - 1].name,
        range: Math.round((max - min) * 100) / 100,
      };
    }

    // Overall suitability scores (weighted)
    const scores = materials.map(m => {
      const name = m.name;
      // Normalize each property 0-1 relative to set
      let score = 0;
      let propCount = 0;
      for (const prop of properties) {
        const val = parseFloat(m[prop]) || 0;
        if (val <= 0) continue;
        const propData = comparison[prop];
        if (!propData) continue;
        const maxVal = propData.values[0]?.value || 1;
        score += val / maxVal;
        propCount++;
      }
      return { name, overallScore: propCount > 0 ? Math.round((score / propCount) * 100) : 0 };
    }).sort((a, b) => b.overallScore - a.overallScore);

    return {
      ok: true,
      result: {
        materialsCompared: materials.length,
        propertiesAnalyzed: Object.keys(comparison).length,
        comparison,
        overallRanking: scores,
        bestOverall: scores[0]?.name || "N/A",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * selectMaterial
   * Recommend materials based on application requirements.
   * artifact.data: { requirements: { minTensile?, maxDensity?, minMelting?, maxCost?, application? }, candidates: [material objects] }
   */
  registerLensAction("materials", "selectMaterial", (ctx, artifact, _params) => {
  try {
    const data = artifact.data || {};
    const requirements = data.requirements || {};
    const candidates = data.candidates || [];

    if (candidates.length === 0) {
      return { ok: true, result: { message: "Add candidate materials with properties to get selection recommendations." } };
    }

    const filtered = candidates.map(mat => {
      const passes = [];
      const fails = [];

      if (requirements.minTensile) {
        const val = parseFloat(mat.tensileStrength) || 0;
        if (val >= requirements.minTensile) passes.push(`Tensile: ${val} >= ${requirements.minTensile} MPa`);
        else fails.push(`Tensile: ${val} < ${requirements.minTensile} MPa`);
      }
      if (requirements.maxDensity) {
        const val = parseFloat(mat.density) || 0;
        if (val <= requirements.maxDensity || val === 0) passes.push(`Density: ${val} <= ${requirements.maxDensity} g/cm\u00B3`);
        else fails.push(`Density: ${val} > ${requirements.maxDensity} g/cm\u00B3`);
      }
      if (requirements.minMelting) {
        const val = parseFloat(mat.meltingPoint) || 0;
        if (val >= requirements.minMelting) passes.push(`Melting: ${val} >= ${requirements.minMelting} \u00B0C`);
        else fails.push(`Melting: ${val} < ${requirements.minMelting} \u00B0C`);
      }
      if (requirements.maxCost) {
        const val = parseFloat(mat.pricePerUnit || mat.cost) || 0;
        if (val <= requirements.maxCost || val === 0) passes.push(`Cost: $${val} <= $${requirements.maxCost}`);
        else fails.push(`Cost: $${val} > $${requirements.maxCost}`);
      }

      return {
        name: mat.name,
        category: mat.category,
        grade: mat.grade,
        passes: passes.length,
        fails: fails.length,
        passDetails: passes,
        failDetails: fails,
        meetsAll: fails.length === 0,
        score: passes.length > 0 ? Math.round((passes.length / (passes.length + fails.length)) * 100) : 0,
      };
    }).sort((a, b) => b.score - a.score);

    const qualifying = filtered.filter(f => f.meetsAll);

    return {
      ok: true,
      result: {
        requirements,
        totalCandidates: candidates.length,
        qualifying: qualifying.length,
        recommended: qualifying[0]?.name || (filtered[0]?.name + " (closest match)"),
        rankings: filtered,
        application: requirements.application || "General purpose",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * compositeAnalysis
   * Analyze composite material properties using rule of mixtures.
   * artifact.data: { components: [{ name, volumeFraction, density, tensileStrength, youngsModulus }] }
   */
  registerLensAction("materials", "compositeAnalysis", (ctx, artifact, _params) => {
  try {
    const components = artifact.data?.components || [];
    if (components.length < 2) {
      return { ok: true, result: { message: "Add at least 2 components with volume fractions and properties." } };
    }

    // Normalize volume fractions
    const totalFraction = components.reduce((s, c) => s + (parseFloat(c.volumeFraction) || 0), 0);
    const normalized = components.map(c => ({
      ...c,
      normalizedFraction: totalFraction > 0 ? (parseFloat(c.volumeFraction) || 0) / totalFraction : 0,
    }));

    // Rule of mixtures (Voigt model — upper bound)
    const compositeDensity = normalized.reduce((s, c) => s + c.normalizedFraction * (parseFloat(c.density) || 0), 0);
    const compositeTensile = normalized.reduce((s, c) => s + c.normalizedFraction * (parseFloat(c.tensileStrength) || 0), 0);
    const compositeModulus = normalized.reduce((s, c) => s + c.normalizedFraction * (parseFloat(c.youngsModulus) || 0), 0);

    // Inverse rule of mixtures (Reuss model — lower bound)
    const inverseTensile = 1 / normalized.reduce((s, c) => {
      const v = parseFloat(c.tensileStrength) || 1;
      return s + c.normalizedFraction / v;
    }, 0);
    const inverseModulus = 1 / normalized.reduce((s, c) => {
      const v = parseFloat(c.youngsModulus) || 1;
      return s + c.normalizedFraction / v;
    }, 0);

    // Specific strength and stiffness
    const specificStrength = compositeDensity > 0 ? Math.round((compositeTensile / compositeDensity) * 100) / 100 : 0;
    const specificStiffness = compositeDensity > 0 ? Math.round((compositeModulus / compositeDensity) * 100) / 100 : 0;

    return {
      ok: true,
      result: {
        components: normalized.map(c => ({
          name: c.name,
          volumeFraction: Math.round(c.normalizedFraction * 100),
        })),
        compositeProperties: {
          density: Math.round(compositeDensity * 100) / 100,
          tensileStrength: { voigt: Math.round(compositeTensile), reuss: Math.round(inverseTensile) },
          youngsModulus: { voigt: Math.round(compositeModulus * 10) / 10, reuss: Math.round(inverseModulus * 10) / 10 },
        },
        specificProperties: { specificStrength, specificStiffness },
        notes: [
          "Voigt (upper bound) assumes equal strain — use for fiber direction loading",
          "Reuss (lower bound) assumes equal stress — use for transverse loading",
          "Actual properties typically fall between Voigt and Reuss bounds",
        ],
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * corrosionRisk
   * Assess corrosion risk based on material and environment.
   * artifact.data: { material, category, environment, temperature, humidity, exposure }
   */
  registerLensAction("materials", "corrosionRisk", (ctx, artifact, _params) => {
  try {
    const data = artifact.data || {};
    const material = (data.name || data.material || "").toLowerCase();
    const category = (data.category || "metal").toLowerCase();
    const environment = (data.environment || "indoor").toLowerCase();
    const temperature = parseFloat(data.temperature) || 25;
    const humidity = parseFloat(data.humidity) || 50;

    // Base corrosion resistance by material category
    const baseResistance = {
      metal: 40, polymer: 85, ceramic: 90, composite: 70, semiconductor: 80, biomaterial: 30,
    };
    let resistance = baseResistance[category] || 50;

    // Material-specific adjustments
    if (material.includes("stainless") || material.includes("316") || material.includes("304")) resistance += 30;
    if (material.includes("aluminum") || material.includes("6061")) resistance += 15;
    if (material.includes("titanium")) resistance += 35;
    if (material.includes("copper") || material.includes("bronze")) resistance += 10;
    if (material.includes("carbon steel") || material.includes("mild steel")) resistance -= 20;
    if (material.includes("cast iron")) resistance -= 15;

    // Environmental factors
    if (environment.includes("marine") || environment.includes("salt")) resistance -= 25;
    if (environment.includes("chemical") || environment.includes("acid")) resistance -= 30;
    if (environment.includes("outdoor")) resistance -= 10;
    if (humidity > 80) resistance -= 15;
    if (temperature > 60) resistance -= 10;
    if (temperature > 200) resistance -= 20;

    resistance = Math.max(0, Math.min(100, resistance));

    const riskLevel = resistance >= 80 ? "low" : resistance >= 50 ? "moderate" : resistance >= 25 ? "high" : "critical";

    const protections = [];
    if (riskLevel === "high" || riskLevel === "critical") {
      if (category === "metal") protections.push("Apply protective coating (powder coat, paint, galvanize)");
      if (environment.includes("marine")) protections.push("Use cathodic protection (sacrificial anode)");
      if (humidity > 70) protections.push("Control humidity — use dehumidifier or desiccant");
      protections.push("Schedule regular inspections every 6 months");
    }
    if (riskLevel === "moderate") {
      protections.push("Consider surface treatment (anodize, passivate, or seal)");
      protections.push("Annual inspection recommended");
    }

    return {
      ok: true,
      result: {
        material: data.name || material,
        category,
        environment,
        conditions: { temperature: `${temperature}\u00B0C`, humidity: `${humidity}%` },
        corrosionResistance: resistance,
        riskLevel,
        protectionMethods: protections,
        estimatedLifespan: riskLevel === "low" ? "20+ years" : riskLevel === "moderate" ? "10-20 years" : riskLevel === "high" ? "3-10 years" : "< 3 years without protection",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * thermalAnalysis
   * Analyze thermal behavior for material selection.
   * artifact.data: { name, thermalConductivity, meltingPoint, thermalExpansion, operatingTemp, application }
   */
  registerLensAction("materials", "thermalAnalysis", (ctx, artifact, _params) => {
  try {
    const data = artifact.data || {};
    const thermalK = parseFloat(data.thermalConductivity) || 0;
    const meltingPoint = parseFloat(data.meltingPoint) || 0;
    const expansion = parseFloat(data.thermalExpansion) || 0;
    const operatingTemp = parseFloat(data.operatingTemp) || 25;
    const application = (data.application || "general").toLowerCase();

    // Safety margin: material should handle 1.5x operating temp
    const safetyMargin = meltingPoint > 0 ? Math.round(((meltingPoint - operatingTemp) / meltingPoint) * 100) : 0;
    const isSafe = meltingPoint === 0 || operatingTemp < meltingPoint * 0.67;

    // Thermal classification
    let thermalClass = "insulator";
    if (thermalK > 100) thermalClass = "excellent-conductor";
    else if (thermalK > 10) thermalClass = "good-conductor";
    else if (thermalK > 1) thermalClass = "moderate";

    // Application suitability
    const suitability = {};
    suitability["heat-sink"] = thermalK > 100 ? "excellent" : thermalK > 50 ? "good" : "poor";
    suitability["insulation"] = thermalK < 1 ? "excellent" : thermalK < 5 ? "good" : "poor";
    suitability["high-temp"] = isSafe && meltingPoint > 500 ? "suitable" : "not-recommended";
    suitability["cryogenic"] = meltingPoint > 200 && expansion < 20 ? "suitable" : "evaluate-further";

    const warnings = [];
    if (!isSafe) warnings.push(`Operating temperature (${operatingTemp}\u00B0C) exceeds 67% of melting point (${meltingPoint}\u00B0C) — risk of creep deformation`);
    if (expansion > 20 && application.includes("precision")) warnings.push("High thermal expansion may cause dimensional issues in precision applications");
    if (thermalK < 1 && application.includes("heat")) warnings.push("Low thermal conductivity — not suitable for heat transfer applications");

    return {
      ok: true,
      result: {
        material: data.name || artifact.title,
        thermalConductivity: thermalK > 0 ? `${thermalK} W/mK` : "Not specified",
        meltingPoint: meltingPoint > 0 ? `${meltingPoint}\u00B0C` : "Not specified",
        thermalExpansion: expansion > 0 ? `${expansion} \u00B5m/m\u00B0C` : "Not specified",
        operatingTemp: `${operatingTemp}\u00B0C`,
        safetyMargin: `${safetyMargin}%`,
        isSafe,
        thermalClass,
        suitability,
        warnings,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * mp-search — Materials Project search by chemical formula or
   * elements. Returns material_id, formula, crystal system, density,
   * band gap, formation energy, magnetism, stability.
   * Requires MATERIALS_PROJECT_API_KEY env (free at materialsproject.org).
   *
   * params: { formula?: "SiO2", elements?: ["Si","O"], limit?: 1-100 }
   */
  registerLensAction("materials", "mp-search", async (_ctx, _artifact, params = {}) => {
    const apiKey = process.env.MATERIALS_PROJECT_API_KEY;
    if (!apiKey) return { ok: false, error: "MATERIALS_PROJECT_API_KEY env required (free at materialsproject.org)" };
    const formula = params.formula ? String(params.formula).trim() : null;
    const elements = Array.isArray(params.elements) ? params.elements : null;
    if (!formula && !elements) return { ok: false, error: "formula or elements required" };
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 20));
    const qs = new URLSearchParams({
      _per_page: String(limit),
      _fields: "material_id,formula_pretty,nelements,symmetry,density,band_gap,formation_energy_per_atom,energy_above_hull,is_stable,is_magnetic,total_magnetization",
    });
    if (formula) qs.set("formula", formula);
    if (elements) qs.set("elements", elements.join(","));
    try {
      const r = await fetch(`${MP_BASE}/materials/summary/?${qs.toString()}`, {
        headers: { "X-API-KEY": apiKey, Accept: "application/json" },
      });
      if (r.status === 401) return { ok: false, error: "MATERIALS_PROJECT_API_KEY invalid" };
      if (!r.ok) throw new Error(`materials project ${r.status}`);
      const data = await r.json();
      const materials = (data.data || []).map((m) => ({
        materialId: m.material_id,
        formula: m.formula_pretty,
        elementCount: m.nelements,
        crystalSystem: m.symmetry?.crystal_system,
        spaceGroup: m.symmetry?.symbol,
        density: m.density,
        bandGapEv: m.band_gap,
        formationEnergyPerAtomEv: m.formation_energy_per_atom,
        energyAboveHullEv: m.energy_above_hull,
        isStable: m.is_stable,
        isMagnetic: m.is_magnetic,
        totalMagnetization: m.total_magnetization,
      }));
      return {
        ok: true,
        result: {
          query: { formula, elements },
          materials, count: materials.length,
          totalAvailable: data.meta?.total_doc,
          source: "materials-project",
        },
      };
    } catch (e) {
      return { ok: false, error: `materials project unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * mp-material — Full record by Materials Project material_id (e.g.
   * "mp-149" for silicon).
   */
  registerLensAction("materials", "mp-material", async (_ctx, _artifact, params = {}) => {
    const apiKey = process.env.MATERIALS_PROJECT_API_KEY;
    if (!apiKey) return { ok: false, error: "MATERIALS_PROJECT_API_KEY env required" };
    const materialId = String(params.materialId || "").trim();
    if (!materialId) return { ok: false, error: "materialId required (e.g. 'mp-149')" };
    if (!/^mp-\d+$/.test(materialId)) return { ok: false, error: "materialId format must be 'mp-<digits>'" };
    try {
      const r = await fetch(`${MP_BASE}/materials/summary/?material_ids=${encodeURIComponent(materialId)}`, {
        headers: { "X-API-KEY": apiKey, Accept: "application/json" },
      });
      if (r.status === 401) return { ok: false, error: "MATERIALS_PROJECT_API_KEY invalid" };
      if (!r.ok) throw new Error(`materials project ${r.status}`);
      const data = await r.json();
      const m = data?.data?.[0];
      if (!m) return { ok: false, error: `material not found: ${materialId}` };
      return {
        ok: true,
        result: {
          materialId: m.material_id,
          formula: m.formula_pretty,
          elementCount: m.nelements,
          crystalSystem: m.symmetry?.crystal_system,
          spaceGroup: m.symmetry?.symbol,
          density: m.density,
          volume: m.volume,
          bandGapEv: m.band_gap,
          formationEnergyPerAtomEv: m.formation_energy_per_atom,
          energyAboveHullEv: m.energy_above_hull,
          isStable: m.is_stable,
          isMagnetic: m.is_magnetic,
          totalMagnetization: m.total_magnetization,
          ordering: m.ordering,
          numSites: m.nsites,
          source: "materials-project",
        },
      };
    } catch (e) {
      return { ok: false, error: `materials project unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Saved materials shortlist (Granta MI-shape comparison set) ──────

  function getMaterialsState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.materialsLens) STATE.materialsLens = {};
    if (!(STATE.materialsLens.saved instanceof Map)) STATE.materialsLens.saved = new Map(); // userId -> Array
    return STATE.materialsLens;
  }
  function saveMaterials() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const mtId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const mtActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const mtClean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const mtNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const mtSaved = (s, userId) => { if (!s.saved.has(userId)) s.saved.set(userId, []); return s.saved.get(userId); };

  registerLensAction("materials", "shortlist-add", (ctx, _a, params = {}) => {
    const s = getMaterialsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = mtClean(params.name, 160);
    if (!name) return { ok: false, error: "material name required" };
    const list = mtSaved(s, mtActor(ctx));
    const refId = mtClean(params.refId, 120) || name.toLowerCase();
    if (list.some((m) => m.refId === refId)) return { ok: false, error: "material already shortlisted" };
    const material = {
      id: mtId("mt"),
      refId,
      name,
      formula: mtClean(params.formula, 80) || null,
      category: mtClean(params.category, 60) || "general",
      properties: {
        density: mtNum(params.density),
        tensileStrengthMPa: mtNum(params.tensileStrengthMPa),
        meltingPointC: mtNum(params.meltingPointC),
        youngsModulusGPa: mtNum(params.youngsModulusGPa),
        costPerKg: mtNum(params.costPerKg),
      },
      notes: mtClean(params.notes, 1000) || "",
      addedAt: new Date().toISOString(),
    };
    list.push(material);
    saveMaterials();
    return { ok: true, result: { material } };
  });

  registerLensAction("materials", "shortlist-list", (ctx, _a, params = {}) => {
  try {
    const s = getMaterialsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let list = [...mtSaved(s, mtActor(ctx))];
    if (params.category) list = list.filter((m) => m.category === params.category);
    return { ok: true, result: { materials: list, count: list.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("materials", "shortlist-remove", (ctx, _a, params = {}) => {
    const s = getMaterialsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = mtSaved(s, mtActor(ctx));
    const i = list.findIndex((m) => m.id === params.id);
    if (i < 0) return { ok: false, error: "material not found" };
    list.splice(i, 1);
    saveMaterials();
    return { ok: true, result: { removed: params.id } };
  });

  // shortlist-compare — side-by-side property table + the best material
  // per property (Granta MI's core selection workflow).
  registerLensAction("materials", "shortlist-compare", (ctx, _a, _params = {}) => {
  try {
    const s = getMaterialsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = mtSaved(s, mtActor(ctx));
    if (list.length < 2) return { ok: false, error: "shortlist at least 2 materials to compare" };
    const PROPS = [
      { key: "density", label: "Density", lowerBetter: true },
      { key: "tensileStrengthMPa", label: "Tensile strength (MPa)", lowerBetter: false },
      { key: "meltingPointC", label: "Melting point (°C)", lowerBetter: false },
      { key: "youngsModulusGPa", label: "Young's modulus (GPa)", lowerBetter: false },
      { key: "costPerKg", label: "Cost per kg", lowerBetter: true },
    ];
    const comparison = PROPS.map((p) => {
      const vals = list.map((m) => ({ id: m.id, name: m.name, value: m.properties[p.key] }))
        .filter((v) => v.value != null);
      let best = null;
      if (vals.length > 0) {
        best = vals.reduce((acc, v) => {
          if (!acc) return v;
          return p.lowerBetter ? (v.value < acc.value ? v : acc) : (v.value > acc.value ? v : acc);
        }, null);
      }
      return { property: p.label, key: p.key, values: vals, best: best ? best.name : null };
    });
    return { ok: true, result: { materials: list.map((m) => ({ id: m.id, name: m.name, formula: m.formula })), comparison } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("materials", "shortlist-dashboard", (ctx, _a, _params = {}) => {
  try {
    const s = getMaterialsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = mtSaved(s, mtActor(ctx));
    const byCategory = {};
    for (const m of list) byCategory[m.category] = (byCategory[m.category] || 0) + 1;
    return { ok: true, result: { shortlisted: list.length, byCategory } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Ashby chart / property plot ────────────────────────────────────
  // Build a 2D material-selection scatter from the user's shortlist.
  // Returns one point per material on the requested X/Y property axes,
  // plus log-scale guide-line slopes for material-index selection
  // (e.g. specific strength = strength / density).
  registerLensAction("materials", "ashby-plot", (ctx, _a, params = {}) => {
    try {
      const s = getMaterialsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const PROP_META = {
        density: { label: "Density (g/cm³)", lowerBetter: true },
        tensileStrengthMPa: { label: "Tensile strength (MPa)", lowerBetter: false },
        meltingPointC: { label: "Melting point (°C)", lowerBetter: false },
        youngsModulusGPa: { label: "Young's modulus (GPa)", lowerBetter: false },
        costPerKg: { label: "Cost per kg", lowerBetter: true },
      };
      const xKey = mtClean(params.xKey, 40) || "density";
      const yKey = mtClean(params.yKey, 40) || "tensileStrengthMPa";
      if (!PROP_META[xKey] || !PROP_META[yKey]) {
        return { ok: false, error: `axis must be one of: ${Object.keys(PROP_META).join(", ")}` };
      }
      const list = mtSaved(s, mtActor(ctx));
      const points = list
        .map((m) => ({
          id: m.id, name: m.name, category: m.category,
          x: m.properties[xKey], y: m.properties[yKey],
        }))
        .filter((p) => p.x != null && p.y != null && p.x > 0 && p.y > 0);
      if (points.length === 0) {
        return { ok: true, result: { points: [], xKey, yKey, xLabel: PROP_META[xKey].label, yLabel: PROP_META[yKey].label, message: "Shortlist materials with both axis properties to plot." } };
      }
      // Material index: ratio of Y to X (handles "maximize Y / minimize X").
      const indexed = points.map((p) => ({ ...p, materialIndex: Math.round((p.y / p.x) * 100) / 100 }));
      indexed.sort((a, b) => b.materialIndex - a.materialIndex);
      return {
        ok: true,
        result: {
          xKey, yKey,
          xLabel: PROP_META[xKey].label, yLabel: PROP_META[yKey].label,
          points: indexed,
          count: indexed.length,
          bestIndex: indexed[0] ? { name: indexed[0].name, materialIndex: indexed[0].materialIndex } : null,
          guideNote: "Material index = Y/X. Higher index sits toward the top-left selection corner.",
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── Multi-criteria selection wizard ────────────────────────────────
  // Weighted-objective ranking against design requirements. Each
  // criterion has a property key, a weight (0-100), and a goal
  // (max|min). Scores each shortlisted material by min-max normalising
  // every criterion across the candidate set, then a weighted sum.
  registerLensAction("materials", "multi-criteria-rank", (ctx, _a, params = {}) => {
    try {
      const s = getMaterialsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const VALID = ["density", "tensileStrengthMPa", "meltingPointC", "youngsModulusGPa", "costPerKg"];
      const rawCriteria = Array.isArray(params.criteria) ? params.criteria : [];
      const criteria = rawCriteria
        .map((c) => ({
          key: mtClean(c?.key, 40),
          weight: Math.max(0, Math.min(100, mtNum(c?.weight) ?? 0)),
          goal: c?.goal === "min" ? "min" : "max",
        }))
        .filter((c) => VALID.includes(c.key) && c.weight > 0);
      if (criteria.length === 0) {
        return { ok: false, error: "supply at least one criterion { key, weight, goal }" };
      }
      const list = mtSaved(s, mtActor(ctx));
      if (list.length === 0) return { ok: false, error: "shortlist materials before ranking" };
      const totalWeight = criteria.reduce((t, c) => t + c.weight, 0);
      // Per-criterion min/max for normalisation.
      const bounds = {};
      for (const c of criteria) {
        const vals = list.map((m) => m.properties[c.key]).filter((v) => v != null);
        bounds[c.key] = { min: vals.length ? Math.min(...vals) : 0, max: vals.length ? Math.max(...vals) : 0 };
      }
      const ranked = list.map((m) => {
        let score = 0;
        const breakdown = [];
        let missing = 0;
        for (const c of criteria) {
          const v = m.properties[c.key];
          const { min, max } = bounds[c.key];
          let norm = 0;
          if (v == null) { missing++; }
          else if (max === min) { norm = 1; }
          else {
            norm = (v - min) / (max - min);
            if (c.goal === "min") norm = 1 - norm;
          }
          const contribution = (norm * c.weight) / totalWeight;
          score += contribution;
          breakdown.push({ key: c.key, value: v, normalized: Math.round(norm * 100) / 100, weight: c.weight, contribution: Math.round(contribution * 1000) / 1000 });
        }
        return { id: m.id, name: m.name, category: m.category, score: Math.round(score * 1000) / 1000, scorePct: Math.round(score * 100), missingCriteria: missing, breakdown };
      }).sort((a, b) => b.score - a.score);
      return {
        ok: true,
        result: {
          criteria, totalWeight,
          rankings: ranked, count: ranked.length,
          recommended: ranked[0]?.name || null,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── 3D crystal-structure viewer data ───────────────────────────────
  // Pulls the structure (lattice + atom sites) for a Materials Project
  // material_id so the frontend can render it in WebGL.
  registerLensAction("materials", "mp-structure", async (_ctx, _artifact, params = {}) => {
    try {
      const apiKey = process.env.MATERIALS_PROJECT_API_KEY;
      if (!apiKey) return { ok: false, error: "MATERIALS_PROJECT_API_KEY env required (free at materialsproject.org)" };
      const materialId = String(params.materialId || "").trim();
      if (!/^mp-\d+$/.test(materialId)) return { ok: false, error: "materialId format must be 'mp-<digits>'" };
      const url = `${MP_BASE}/materials/summary/?material_ids=${encodeURIComponent(materialId)}&_fields=material_id,formula_pretty,structure,symmetry,volume`;
      const data = await cachedFetchJson(url, {
        opts: { headers: { "X-API-KEY": apiKey, Accept: "application/json" } },
        ttlMs: 24 * 60 * 60 * 1000,
      });
      const m = data?.data?.[0];
      if (!m || !m.structure) return { ok: false, error: `structure not found for ${materialId}` };
      const st = m.structure;
      const lattice = st.lattice || {};
      const sites = (st.sites || []).map((site) => ({
        species: (site.species || []).map((sp) => sp.element).join("/") || site.label || "?",
        abc: site.abc || [0, 0, 0],
        xyz: site.xyz || [0, 0, 0],
      }));
      return {
        ok: true,
        result: {
          materialId: m.material_id,
          formula: m.formula_pretty,
          crystalSystem: m.symmetry?.crystal_system,
          spaceGroup: m.symmetry?.symbol,
          volume: m.volume,
          lattice: {
            a: lattice.a, b: lattice.b, c: lattice.c,
            alpha: lattice.alpha, beta: lattice.beta, gamma: lattice.gamma,
            matrix: lattice.matrix || null,
          },
          sites,
          atomCount: sites.length,
          source: "materials-project",
        },
      };
    } catch (e) {
      return { ok: false, error: `materials project unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Material datasheet generator ───────────────────────────────────
  // Assembles an exportable spec sheet from a shortlist material id, or
  // from inline properties passed in params. Returns structured
  // sections plus a plain-text rendering for copy/export.
  registerLensAction("materials", "datasheet", (ctx, _a, params = {}) => {
    try {
      const s = getMaterialsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      let mat = null;
      if (params.id) {
        const list = mtSaved(s, mtActor(ctx));
        mat = list.find((m) => m.id === params.id) || null;
        if (!mat) return { ok: false, error: "material not found in shortlist" };
      } else {
        const name = mtClean(params.name, 160);
        if (!name) return { ok: false, error: "id (shortlist) or name + properties required" };
        mat = {
          name, formula: mtClean(params.formula, 80) || null, category: mtClean(params.category, 60) || "general",
          properties: {
            density: mtNum(params.density),
            tensileStrengthMPa: mtNum(params.tensileStrengthMPa),
            meltingPointC: mtNum(params.meltingPointC),
            youngsModulusGPa: mtNum(params.youngsModulusGPa),
            costPerKg: mtNum(params.costPerKg),
          },
          notes: mtClean(params.notes, 1000) || "",
        };
      }
      const p = mat.properties || {};
      const propRows = [
        { label: "Density", value: p.density, unit: "g/cm³" },
        { label: "Tensile strength", value: p.tensileStrengthMPa, unit: "MPa" },
        { label: "Melting point", value: p.meltingPointC, unit: "°C" },
        { label: "Young's modulus", value: p.youngsModulusGPa, unit: "GPa" },
        { label: "Cost per kg", value: p.costPerKg, unit: "USD" },
      ].filter((r) => r.value != null);
      const derived = [];
      if (p.tensileStrengthMPa != null && p.density != null && p.density > 0) {
        derived.push({ label: "Specific strength", value: Math.round((p.tensileStrengthMPa / p.density) * 100) / 100, unit: "MPa·cm³/g" });
      }
      if (p.youngsModulusGPa != null && p.density != null && p.density > 0) {
        derived.push({ label: "Specific stiffness", value: Math.round((p.youngsModulusGPa / p.density) * 100) / 100, unit: "GPa·cm³/g" });
      }
      const generatedAt = new Date().toISOString();
      const lines = [
        `MATERIAL DATASHEET — ${mat.name}`,
        mat.formula ? `Formula: ${mat.formula}` : null,
        `Category: ${mat.category}`,
        `Generated: ${generatedAt}`,
        "",
        "MEASURED PROPERTIES",
        ...propRows.map((r) => `  ${r.label}: ${r.value} ${r.unit}`),
        derived.length ? "" : null,
        derived.length ? "DERIVED PROPERTIES" : null,
        ...derived.map((r) => `  ${r.label}: ${r.value} ${r.unit}`),
        mat.notes ? "" : null,
        mat.notes ? `NOTES\n  ${mat.notes}` : null,
      ].filter((l) => l != null);
      return {
        ok: true,
        result: {
          datasheet: {
            name: mat.name, formula: mat.formula, category: mat.category,
            generatedAt,
            measuredProperties: propRows,
            derivedProperties: derived,
            notes: mat.notes || "",
          },
          plainText: lines.join("\n"),
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── Test-data import (CSV) ─────────────────────────────────────────
  // Ingest mechanical test results from raw CSV text into a material
  // record. Parses header + rows, computes summary statistics
  // (count / mean / min / max / stdev) per numeric column.
  registerLensAction("materials", "import-test-csv", (ctx, _a, params = {}) => {
    try {
      const s = getMaterialsState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const csv = String(params.csv == null ? "" : params.csv);
      if (!csv.trim()) return { ok: false, error: "csv text required" };
      const rows = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (rows.length < 2) return { ok: false, error: "csv must have a header row plus at least one data row" };
      const header = rows[0].split(",").map((h) => h.trim());
      const records = [];
      for (const line of rows.slice(1)) {
        const cells = line.split(",").map((c) => c.trim());
        const rec = {};
        header.forEach((h, i) => { rec[h] = cells[i] != null ? cells[i] : ""; });
        records.push(rec);
      }
      // Per-column numeric stats.
      const stats = {};
      for (const col of header) {
        const nums = records.map((r) => Number(r[col])).filter((n) => Number.isFinite(n));
        if (nums.length === 0) continue;
        const mean = nums.reduce((t, n) => t + n, 0) / nums.length;
        const variance = nums.reduce((t, n) => t + (n - mean) ** 2, 0) / nums.length;
        stats[col] = {
          count: nums.length,
          mean: Math.round(mean * 1000) / 1000,
          min: Math.min(...nums),
          max: Math.max(...nums),
          stdev: Math.round(Math.sqrt(variance) * 1000) / 1000,
        };
      }
      let attachedTo = null;
      if (params.id) {
        const list = mtSaved(s, mtActor(ctx));
        const mat = list.find((m) => m.id === params.id);
        if (mat) {
          if (!Array.isArray(mat.testData)) mat.testData = [];
          mat.testData.push({ id: mtId("tst"), importedAt: new Date().toISOString(), columns: header, rowCount: records.length, stats });
          attachedTo = mat.name;
          saveMaterials();
        }
      }
      return {
        ok: true,
        result: {
          columns: header,
          rowCount: records.length,
          rows: records.slice(0, 200),
          stats,
          attachedTo,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── Standards cross-reference ──────────────────────────────────────
  // Link a material to ASTM / ISO / EN / DIN / JIS designations. Built
  // from a curated reference table of common engineering alloy/polymer
  // equivalences — returns the matched standard set, never synthesizes.
  const STANDARDS_TABLE = {
    "stainless 304": [
      { body: "UNS", id: "S30400" }, { body: "ASTM", id: "A240/A276" },
      { body: "EN", id: "1.4301 (X5CrNi18-10)" }, { body: "JIS", id: "SUS304" },
      { body: "ISO", id: "X5CrNi18-10" },
    ],
    "stainless 316": [
      { body: "UNS", id: "S31600" }, { body: "ASTM", id: "A240/A276" },
      { body: "EN", id: "1.4401 (X5CrNiMo17-12-2)" }, { body: "JIS", id: "SUS316" },
    ],
    "aluminum 6061": [
      { body: "UNS", id: "A96061" }, { body: "ASTM", id: "B209/B221" },
      { body: "EN", id: "AW-6061 (AlMg1SiCu)" }, { body: "ISO", id: "AlMg1SiCu" },
    ],
    "aluminum 7075": [
      { body: "UNS", id: "A97075" }, { body: "ASTM", id: "B209" },
      { body: "EN", id: "AW-7075 (AlZn5.5MgCu)" },
    ],
    "carbon steel a36": [
      { body: "ASTM", id: "A36" }, { body: "UNS", id: "K02600" },
      { body: "EN", id: "S235JR (1.0038)" }, { body: "JIS", id: "SS400" },
    ],
    "titanium grade 5": [
      { body: "UNS", id: "R56400" }, { body: "ASTM", id: "B265/B348" },
      { body: "EN", id: "3.7165 (TiAl6V4)" }, { body: "ISO", id: "Ti-6Al-4V" },
    ],
    "abs": [{ body: "ASTM", id: "D4673" }, { body: "ISO", id: "2580" }],
    "polycarbonate": [{ body: "ASTM", id: "D3935" }, { body: "ISO", id: "7391" }],
    "nylon 6": [{ body: "ASTM", id: "D4066" }, { body: "ISO", id: "1874" }],
    "copper c11000": [{ body: "UNS", id: "C11000" }, { body: "ASTM", id: "B152" }, { body: "EN", id: "Cu-ETP (CW004A)" }],
  };
  registerLensAction("materials", "standards-crossref", (_ctx, _a, params = {}) => {
    try {
      const query = mtClean(params.material, 120).toLowerCase();
      if (!query) {
        return { ok: true, result: { available: Object.keys(STANDARDS_TABLE), message: "Pass a material name to cross-reference (e.g. 'stainless 304', 'aluminum 6061')." } };
      }
      let key = Object.keys(STANDARDS_TABLE).find((k) => k === query);
      if (!key) key = Object.keys(STANDARDS_TABLE).find((k) => query.includes(k) || k.includes(query));
      if (!key) {
        return {
          ok: true,
          result: {
            material: params.material, matched: false,
            standards: [],
            available: Object.keys(STANDARDS_TABLE),
            disclaimer: "No curated cross-reference for this material — Concord does not synthesize standard designations. Verify against the official standard body.",
          },
        };
      }
      return {
        ok: true,
        result: {
          material: params.material, matched: true, matchedKey: key,
          standards: STANDARDS_TABLE[key],
          source: "curated-engineering-equivalence-table",
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ─── Sustainability / embodied-carbon metrics ───────────────────────
  // Per-material embodied carbon (kg CO₂e/kg), embodied energy, and
  // recyclability from a curated reference table (ICE / industry
  // averages). Computes total footprint for a given mass.
  const CARBON_TABLE = {
    "steel": { embodiedCarbon: 1.9, embodiedEnergy: 25, recyclability: 90, renewable: false },
    "stainless steel": { embodiedCarbon: 6.2, embodiedEnergy: 75, recyclability: 85, renewable: false },
    "aluminum": { embodiedCarbon: 8.2, embodiedEnergy: 155, recyclability: 95, renewable: false },
    "recycled aluminum": { embodiedCarbon: 1.7, embodiedEnergy: 29, recyclability: 95, renewable: false },
    "titanium": { embodiedCarbon: 35, embodiedEnergy: 360, recyclability: 80, renewable: false },
    "copper": { embodiedCarbon: 3.8, embodiedEnergy: 42, recyclability: 90, renewable: false },
    "concrete": { embodiedCarbon: 0.13, embodiedEnergy: 0.95, recyclability: 30, renewable: false },
    "glass": { embodiedCarbon: 0.85, embodiedEnergy: 15, recyclability: 70, renewable: false },
    "abs": { embodiedCarbon: 3.8, embodiedEnergy: 95, recyclability: 25, renewable: false },
    "polycarbonate": { embodiedCarbon: 6.0, embodiedEnergy: 110, recyclability: 20, renewable: false },
    "nylon": { embodiedCarbon: 7.9, embodiedEnergy: 120, recyclability: 20, renewable: false },
    "carbon fiber": { embodiedCarbon: 24, embodiedEnergy: 286, recyclability: 15, renewable: false },
    "wood": { embodiedCarbon: 0.46, embodiedEnergy: 8.5, recyclability: 60, renewable: true },
    "bamboo": { embodiedCarbon: 0.24, embodiedEnergy: 5.6, recyclability: 70, renewable: true },
  };
  registerLensAction("materials", "sustainability", (_ctx, _a, params = {}) => {
    try {
      const query = mtClean(params.material, 120).toLowerCase();
      if (!query) {
        return { ok: true, result: { available: Object.keys(CARBON_TABLE), message: "Pass a material name for embodied-carbon metrics." } };
      }
      let key = Object.keys(CARBON_TABLE).find((k) => k === query);
      if (!key) key = Object.keys(CARBON_TABLE).find((k) => query.includes(k) || k.includes(query));
      if (!key) {
        return {
          ok: true,
          result: {
            material: params.material, matched: false,
            available: Object.keys(CARBON_TABLE),
            disclaimer: "No curated sustainability data for this material — Concord does not estimate embodied carbon for unknown materials.",
          },
        };
      }
      const ref = CARBON_TABLE[key];
      const massKg = mtNum(params.massKg);
      const footprint = massKg != null && massKg > 0
        ? {
            massKg,
            totalCarbonKgCO2e: Math.round(ref.embodiedCarbon * massKg * 100) / 100,
            totalEnergyMJ: Math.round(ref.embodiedEnergy * massKg * 100) / 100,
          }
        : null;
      const ratings = Object.entries(CARBON_TABLE).map(([k, v]) => v.embodiedCarbon).sort((a, b) => a - b);
      const rank = ratings.indexOf(ref.embodiedCarbon) + 1;
      const grade = ref.embodiedCarbon < 1 ? "A" : ref.embodiedCarbon < 4 ? "B" : ref.embodiedCarbon < 10 ? "C" : ref.embodiedCarbon < 25 ? "D" : "E";
      return {
        ok: true,
        result: {
          material: params.material, matched: true, matchedKey: key,
          metrics: {
            embodiedCarbonKgCO2ePerKg: ref.embodiedCarbon,
            embodiedEnergyMJPerKg: ref.embodiedEnergy,
            recyclabilityPct: ref.recyclability,
            renewable: ref.renewable,
            carbonGrade: grade,
            carbonRank: `${rank} of ${ratings.length} (lower = greener)`,
          },
          footprint,
          source: "curated-ICE-industry-averages",
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
