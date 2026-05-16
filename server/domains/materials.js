// server/domains/materials.js
// Domain actions for materials science: property comparison, material
// selection, composite analysis, corrosion prediction, thermal
// analysis, plus real Materials Project API for ~150,000 inorganic
// crystalline materials. Free with API key from materialsproject.org
// (set MATERIALS_PROJECT_API_KEY env).

const MP_BASE = "https://api.materialsproject.org";

export default function registerMaterialsActions(registerLensAction) {
  /**
   * compareProperties
   * Side-by-side comparison of material properties with scoring.
   * artifact.data: { materials: [{ name, density, tensileStrength, thermalConductivity, meltingPoint, youngsModulus, hardness, cost }] }
   */
  registerLensAction("materials", "compareProperties", (ctx, artifact, _params) => {
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
  });

  /**
   * selectMaterial
   * Recommend materials based on application requirements.
   * artifact.data: { requirements: { minTensile?, maxDensity?, minMelting?, maxCost?, application? }, candidates: [material objects] }
   */
  registerLensAction("materials", "selectMaterial", (ctx, artifact, _params) => {
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
  });

  /**
   * compositeAnalysis
   * Analyze composite material properties using rule of mixtures.
   * artifact.data: { components: [{ name, volumeFraction, density, tensileStrength, youngsModulus }] }
   */
  registerLensAction("materials", "compositeAnalysis", (ctx, artifact, _params) => {
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
  });

  /**
   * corrosionRisk
   * Assess corrosion risk based on material and environment.
   * artifact.data: { material, category, environment, temperature, humidity, exposure }
   */
  registerLensAction("materials", "corrosionRisk", (ctx, artifact, _params) => {
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
  });

  /**
   * thermalAnalysis
   * Analyze thermal behavior for material selection.
   * artifact.data: { name, thermalConductivity, meltingPoint, thermalExpansion, operatingTemp, application }
   */
  registerLensAction("materials", "thermalAnalysis", (ctx, artifact, _params) => {
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
}
