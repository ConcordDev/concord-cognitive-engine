// server/domains/ethics.js
// Domain actions for ethical analysis: multi-framework evaluation, stakeholder
// impact assessment, bias detection, and fairness metrics.

export default function registerEthicsActions(registerLensAction) {
  /**
   * frameworkAnalysis
   * Evaluate a decision/action against multiple ethical frameworks simultaneously.
   * artifact.data.action = { description, consequences?, stakeholders?, principles? }
   * artifact.data.context = { domain?, urgency?, reversibility?, scope? }
   */
  registerLensAction("ethics", "frameworkAnalysis", (ctx, artifact, _params) => {
  try {
    const action = artifact.data?.action || {};
    const context = artifact.data?.context || {};
    const consequences = action.consequences || [];
    const stakeholders = action.stakeholders || [];
    const principles = action.principles || [];

    // Framework evaluations
    const frameworks = {};

    // 1. Utilitarianism: greatest good for greatest number
    const positiveConsequences = consequences.filter(c => (c.impact || c.value || 0) > 0);
    const negativeConsequences = consequences.filter(c => (c.impact || c.value || 0) < 0);
    const totalUtility = consequences.reduce((s, c) => {
      const impact = c.impact || c.value || 0;
      const affected = c.affectedCount || c.scope || 1;
      const probability = c.probability || 1;
      return s + impact * affected * probability;
    }, 0);
    const maxPossibleHarm = negativeConsequences.reduce((s, c) =>
      s + Math.abs(c.impact || c.value || 0) * (c.affectedCount || 1), 0);

    frameworks.utilitarian = {
      name: "Utilitarianism",
      score: consequences.length > 0
        ? Math.round(Math.max(-1, Math.min(1, totalUtility / Math.max(Math.abs(totalUtility), maxPossibleHarm, 1))) * 100)
        : 0,
      assessment: totalUtility > 0 ? "net-positive" : totalUtility < 0 ? "net-negative" : "neutral",
      details: {
        totalUtility: Math.round(totalUtility * 100) / 100,
        positiveConsequences: positiveConsequences.length,
        negativeConsequences: negativeConsequences.length,
        totalAffected: consequences.reduce((s, c) => s + (c.affectedCount || 1), 0),
      },
    };

    // 2. Deontology (Kantian): duty-based, universalizability test
    const dutyKeywords = {
      positive: ["truth", "honest", "consent", "respect", "dignity", "rights", "promise", "duty", "fair", "transparent", "autonomous"],
      negative: ["deceive", "coerce", "manipulate", "exploit", "violate", "discriminate", "surveil", "harm", "force", "lie"],
    };
    const desc = (action.description || "").toLowerCase();
    const principleLower = principles.map(p => (typeof p === "string" ? p : p.name || "").toLowerCase());

    let dutyScore = 50; // neutral baseline
    for (const kw of dutyKeywords.positive) {
      if (desc.includes(kw) || principleLower.some(p => p.includes(kw))) dutyScore += 10;
    }
    for (const kw of dutyKeywords.negative) {
      if (desc.includes(kw) || principleLower.some(p => p.includes(kw))) dutyScore -= 15;
    }

    // Universalizability: could everyone do this?
    const universalizable = !dutyKeywords.negative.some(kw => desc.includes(kw));

    frameworks.deontological = {
      name: "Deontological (Kantian)",
      score: Math.max(-100, Math.min(100, dutyScore)),
      assessment: dutyScore >= 60 ? "duty-aligned" : dutyScore >= 30 ? "partially-aligned" : "duty-violating",
      details: {
        universalizable,
        respectsAutonomy: desc.includes("consent") || desc.includes("autonomous") || desc.includes("choice"),
        treatsPeopleAsEnds: !desc.includes("exploit") && !desc.includes("manipulate"),
      },
    };

    // 3. Virtue Ethics: character and virtues
    const virtues = {
      courage: ["brave", "courage", "stand up", "challenge", "risk"],
      justice: ["fair", "just", "equitable", "equal", "right"],
      temperance: ["moderate", "balanced", "restrained", "prudent"],
      wisdom: ["wise", "thoughtful", "considered", "informed", "evidence"],
      compassion: ["care", "empathy", "compassion", "kind", "help"],
      integrity: ["honest", "truthful", "transparent", "accountable", "consistent"],
      humility: ["humble", "listen", "acknowledge", "learn", "admit"],
    };

    const virtueScores = {};
    for (const [virtue, keywords] of Object.entries(virtues)) {
      const matches = keywords.filter(kw => desc.includes(kw) || principleLower.some(p => p.includes(kw)));
      virtueScores[virtue] = matches.length > 0 ? Math.min(100, matches.length * 30) : 0;
    }
    const avgVirtue = Object.values(virtueScores).reduce((s, v) => s + v, 0) / Object.keys(virtueScores).length;

    frameworks.virtue = {
      name: "Virtue Ethics",
      score: Math.round(avgVirtue),
      assessment: avgVirtue >= 50 ? "virtuous" : avgVirtue >= 25 ? "partially-virtuous" : "virtue-deficient",
      details: { virtueScores, strongestVirtue: Object.entries(virtueScores).sort((a, b) => b[1] - a[1])[0]?.[0] },
    };

    // 4. Care Ethics: relationships and vulnerability
    const vulnerableStakeholders = stakeholders.filter(s =>
      (s.vulnerable || s.powerLevel === "low" || (s.description || "").toLowerCase().match(/child|elder|disabled|marginalized|minority/))
    );
    const careScore = stakeholders.length > 0
      ? Math.round((1 - vulnerableStakeholders.filter(s => (s.impact || 0) < 0).length / Math.max(vulnerableStakeholders.length, 1)) * 100)
      : 50;

    frameworks.care = {
      name: "Care Ethics",
      score: careScore,
      assessment: careScore >= 70 ? "care-centered" : careScore >= 40 ? "partially-caring" : "care-deficient",
      details: {
        totalStakeholders: stakeholders.length,
        vulnerableStakeholders: vulnerableStakeholders.length,
        vulnerableHarmed: vulnerableStakeholders.filter(s => (s.impact || 0) < 0).length,
      },
    };

    // Overall synthesis
    const allScores = Object.values(frameworks).map(f => f.score);
    const overallScore = Math.round(allScores.reduce((s, v) => s + v, 0) / allScores.length);
    const consensus = allScores.every(s => s >= 50) ? "all-frameworks-approve"
      : allScores.every(s => s < 30) ? "all-frameworks-disapprove"
        : "frameworks-disagree";

    // Identify ethical tensions
    const tensions = [];
    if (frameworks.utilitarian.score > 50 && frameworks.deontological.score < 30) {
      tensions.push("Utility-duty tension: beneficial outcome but questionable means");
    }
    if (frameworks.deontological.score > 50 && frameworks.utilitarian.score < 0) {
      tensions.push("Duty-utility tension: principled action but net-negative outcome");
    }
    if (frameworks.care.score < 40 && frameworks.utilitarian.score > 50) {
      tensions.push("Care-utility tension: aggregate benefit but vulnerable groups harmed");
    }

    return {
      ok: true, result: {
        frameworks, overallScore, consensus, tensions,
        recommendation: overallScore >= 60 ? "Ethically supportable across frameworks"
          : overallScore >= 30 ? "Proceed with caution — ethical concerns identified"
            : "Significant ethical concerns — reconsider approach",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * stakeholderImpact
   * Map and quantify impacts across all affected stakeholders.
   * artifact.data.stakeholders = [{ name, group, power?, interest?, impact?,
   *   vulnerability?, description? }]
   * artifact.data.action = { description }
   */
  registerLensAction("ethics", "stakeholderImpact", (ctx, artifact, _params) => {
  try {
    const stakeholders = artifact.data?.stakeholders || [];
    if (stakeholders.length === 0) return { ok: true, result: { message: "No stakeholders defined." } };

    const analyzed = stakeholders.map(s => {
      const power = s.power ?? 50; // 0-100
      const interest = s.interest ?? 50;
      const impact = s.impact ?? 0; // -100 to 100
      const vulnerability = s.vulnerability ?? 0; // 0-100

      // Stakeholder salience (Mitchell, Agle & Wood)
      const urgency = Math.abs(impact) > 50 ? 100 : Math.abs(impact) * 2;
      const legitimacy = interest > 30 ? 100 : interest * 3;
      const salience = Math.round((power + urgency + legitimacy) / 3);

      // Quadrant classification (power/interest matrix)
      let quadrant;
      if (power >= 50 && interest >= 50) quadrant = "manage-closely";
      else if (power >= 50 && interest < 50) quadrant = "keep-satisfied";
      else if (power < 50 && interest >= 50) quadrant = "keep-informed";
      else quadrant = "monitor";

      // Weighted impact: vulnerability amplifies negative impacts
      const weightedImpact = impact < 0
        ? impact * (1 + vulnerability / 100)
        : impact;

      return {
        name: s.name, group: s.group,
        power, interest, impact, vulnerability,
        urgency: Math.round(urgency), legitimacy: Math.round(legitimacy),
        salience, quadrant,
        weightedImpact: Math.round(weightedImpact * 100) / 100,
        priority: salience > 70 ? "high" : salience > 40 ? "medium" : "low",
      };
    });

    analyzed.sort((a, b) => b.salience - a.salience);

    // Group analysis
    const groups = {};
    for (const s of analyzed) {
      const g = s.group || "ungrouped";
      if (!groups[g]) groups[g] = { members: 0, avgImpact: 0, avgVulnerability: 0, impacts: [] };
      groups[g].members++;
      groups[g].impacts.push(s.weightedImpact);
      groups[g].avgVulnerability += s.vulnerability;
    }
    for (const [name, g] of Object.entries(groups)) {
      g.avgImpact = Math.round(g.impacts.reduce((s, v) => s + v, 0) / g.members * 100) / 100;
      g.avgVulnerability = Math.round(g.avgVulnerability / g.members);
      g.netSentiment = g.avgImpact > 10 ? "positive" : g.avgImpact < -10 ? "negative" : "neutral";
      delete g.impacts;
    }

    // Equity analysis
    const positiveImpact = analyzed.filter(s => s.weightedImpact > 0);
    const negativeImpact = analyzed.filter(s => s.weightedImpact < 0);
    const vulnerableHarmed = analyzed.filter(s => s.vulnerability > 50 && s.weightedImpact < 0);

    const equityScore = Math.round(Math.max(0, 100 -
      (vulnerableHarmed.length * 20) -
      (negativeImpact.length > positiveImpact.length ? 20 : 0) -
      (analyzed.filter(s => s.power > 70 && s.impact > 50).length > analyzed.filter(s => s.power < 30 && s.impact > 0).length ? 15 : 0)
    ));

    return {
      ok: true, result: {
        stakeholders: analyzed,
        groups,
        summary: {
          total: analyzed.length,
          positivelyAffected: positiveImpact.length,
          negativelyAffected: negativeImpact.length,
          vulnerableHarmed: vulnerableHarmed.length,
          highPriority: analyzed.filter(s => s.priority === "high").length,
        },
        equityScore,
        equityAssessment: equityScore >= 70 ? "equitable" : equityScore >= 40 ? "partially-equitable" : "inequitable",
        quadrantDistribution: {
          "manage-closely": analyzed.filter(s => s.quadrant === "manage-closely").length,
          "keep-satisfied": analyzed.filter(s => s.quadrant === "keep-satisfied").length,
          "keep-informed": analyzed.filter(s => s.quadrant === "keep-informed").length,
          "monitor": analyzed.filter(s => s.quadrant === "monitor").length,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * biasDetection
   * Analyze a dataset or decision criteria for potential biases.
   * artifact.data.decisions = [{ id, outcome, attributes: { age?, gender?, race?, income?, ... } }]
   * Computes disparate impact ratios, statistical parity, and identifies
   * attributes with significant outcome disparities.
   */
  registerLensAction("ethics", "biasDetection", (ctx, artifact, _params) => {
  try {
    const decisions = artifact.data?.decisions || [];
    if (decisions.length < 10) return { ok: false, error: "Need at least 10 decisions for meaningful bias analysis." };

    const protectedAttributes = artifact.data?.protectedAttributes || ["gender", "race", "age", "disability"];

    // Analyze each protected attribute
    const biasResults = {};

    for (const attr of protectedAttributes) {
      const groups = {};
      for (const d of decisions) {
        const val = d.attributes?.[attr];
        if (val == null) continue;
        const group = String(val);
        if (!groups[group]) groups[group] = { total: 0, positive: 0, negative: 0 };
        groups[group].total++;
        const outcome = d.outcome === true || d.outcome === 1 || d.outcome === "approved" || d.outcome === "positive" || d.outcome === "yes";
        if (outcome) groups[group].positive++;
        else groups[group].negative++;
      }

      const groupNames = Object.keys(groups);
      if (groupNames.length < 2) continue;

      // Compute rates
      const rates = {};
      for (const [name, g] of Object.entries(groups)) {
        rates[name] = { total: g.total, positiveRate: g.total > 0 ? g.positive / g.total : 0 };
      }

      // Disparate impact ratio: min rate / max rate (4/5 rule: should be ≥ 0.8)
      const rateValues = Object.values(rates).map(r => r.positiveRate);
      const maxRate = Math.max(...rateValues);
      const minRate = Math.min(...rateValues);
      const disparateImpact = maxRate > 0 ? minRate / maxRate : 1;

      // Statistical parity difference
      const parityDiff = maxRate - minRate;

      // Chi-squared test approximation
      const totalPositive = Object.values(groups).reduce((s, g) => s + g.positive, 0);
      const totalN = Object.values(groups).reduce((s, g) => s + g.total, 0);
      const expectedRate = totalPositive / totalN;
      let chiSquared = 0;
      for (const g of Object.values(groups)) {
        const expected = g.total * expectedRate;
        const expectedNeg = g.total * (1 - expectedRate);
        if (expected > 0) chiSquared += Math.pow(g.positive - expected, 2) / expected;
        if (expectedNeg > 0) chiSquared += Math.pow(g.negative - expectedNeg, 2) / expectedNeg;
      }
      // Rough p-value from chi-squared (df = groups - 1)
      const df = groupNames.length - 1;
      const chiPValue = Math.exp(-chiSquared / 2); // very rough approximation

      const biasDetected = disparateImpact < 0.8 || parityDiff > 0.1;

      biasResults[attr] = {
        groups: Object.entries(rates).map(([name, r]) => ({ group: name, total: r.total, positiveRate: Math.round(r.positiveRate * 10000) / 100 })),
        disparateImpactRatio: Math.round(disparateImpact * 10000) / 10000,
        fourFifthsRule: disparateImpact >= 0.8 ? "passed" : "FAILED",
        statisticalParityDifference: Math.round(parityDiff * 10000) / 10000,
        chiSquared: Math.round(chiSquared * 1000) / 1000,
        pValueApprox: Math.round(chiPValue * 10000) / 10000,
        biasDetected,
        severity: disparateImpact < 0.5 ? "severe" : disparateImpact < 0.8 ? "moderate" : "none",
        favoredGroup: Object.entries(rates).sort((a, b) => b[1].positiveRate - a[1].positiveRate)[0]?.[0],
        disadvantagedGroup: Object.entries(rates).sort((a, b) => a[1].positiveRate - b[1].positiveRate)[0]?.[0],
      };
    }

    const biasedAttributes = Object.entries(biasResults).filter(([, r]) => r.biasDetected).map(([attr]) => attr);

    return {
      ok: true, result: {
        attributes: biasResults,
        totalDecisions: decisions.length,
        biasedAttributes,
        overallAssessment: biasedAttributes.length === 0 ? "no_significant_bias"
          : biasedAttributes.length <= 1 ? "isolated_bias"
            : "systemic_bias_concern",
        recommendations: [
          ...biasedAttributes.map(a => `Review "${a}" — disparate impact detected (ratio: ${biasResults[a].disparateImpactRatio})`),
          ...(biasedAttributes.length > 0 ? ["Consider bias mitigation: re-weighting, threshold adjustment, or criteria review"] : []),
        ],
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ═══════════════════════════════════════════════════════════════
  //  Ethics decision-toolkit features. Persistent per-user state in
  //  globalThis._concordSTATE.ethicsLens. Every handler try/catch
  //  wrapped and returns { ok, result?, error? } — never throws.
  // ═══════════════════════════════════════════════════════════════

  function getEthicsState() {
    const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
    if (!STATE.ethicsLens) {
      STATE.ethicsLens = {
        analyses: new Map(),  // userId -> Array<MultiFrameworkAnalysis>
        maps: new Map(),      // userId -> Array<StakeholderMap>
        matrices: new Map(),  // userId -> Array<DecisionMatrix>
        checklists: new Map(),// userId -> Array<BiasChecklist>
        reviews: new Map(),   // userId -> Array<ReviewWorkflow>
        cases: new Map(),     // userId -> Array<CaseRecord>
        seq: 1,
      };
    }
    return STATE.ethicsLens;
  }
  function saveEthics() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* noop */ }
    }
  }
  function eid(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function euid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
  function enow() { return new Date().toISOString(); }
  function elist(map, key) {
    if (!map.has(key)) map.set(key, []);
    return map.get(key);
  }
  function ewrap(fn) {
    return (ctx, artifact, params) => {
      try { return fn(ctx, artifact, params); }
      catch (e) { return { ok: false, error: String(e?.message || e) }; }
    };
  }

  // Shared keyword tables for lightweight framework scoring of free text.
  const POS_KW = ["truth", "honest", "consent", "respect", "dignity", "rights", "promise", "fair", "transparent", "autonomy", "benefit", "help", "protect", "care"];
  const NEG_KW = ["deceive", "coerce", "manipulate", "exploit", "violate", "discriminate", "surveil", "harm", "force", "lie", "damage", "endanger", "neglect"];

  function scoreText(text) {
    const t = String(text || "").toLowerCase();
    let pos = 0, neg = 0;
    for (const k of POS_KW) if (t.includes(k)) pos++;
    for (const k of NEG_KW) if (t.includes(k)) neg++;
    return { pos, neg };
  }

  // Coerce any value to a finite number, falling back to `dflt` for
  // NaN/Infinity/-Infinity/"1e999"/"Infinity"/non-numeric. The scoring math
  // below MUST never emit NaN/Infinity into a record — poisoned numeric input
  // ("1e999", "Infinity", NaN) is a real attack surface for the lens.
  function fnum(v, dflt = 0) {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : dflt;
  }

  /**
   * multiFrameworkDilemma — run a single dilemma + options through
   * utilitarian / deontological / virtue lenses side by side.
   * params: { dilemma, options: [{ name, description, harmScore?, benefitScore? }] }
   */
  registerLensAction("ethics", "multiFrameworkDilemma", ewrap((ctx, artifact, params) => {
    const p = params || {};
    const dilemma = String(p.dilemma || artifact?.data?.dilemma || "").trim();
    const options = Array.isArray(p.options) ? p.options : [];
    if (!dilemma) return { ok: false, error: "dilemma text required" };
    if (options.length === 0) return { ok: false, error: "at least one option required" };

    const analyzed = options.map((o) => {
      const desc = `${o.name || ""} ${o.description || ""}`;
      const { pos, neg } = scoreText(desc);
      const benefit = Number.isFinite(o.benefitScore) ? Math.max(0, Math.min(100, o.benefitScore)) : pos * 20;
      const harm = Number.isFinite(o.harmScore) ? Math.max(0, Math.min(100, o.harmScore)) : neg * 20;

      // Utilitarian: net welfare.
      const utilitarian = Math.max(0, Math.min(100, 50 + (benefit - harm) / 2));
      // Deontological: duty alignment, penalised hard for harmful means.
      const deontological = Math.max(0, Math.min(100, 50 + pos * 12 - neg * 22));
      // Virtue: character expression, balanced view of harm/benefit.
      const virtue = Math.max(0, Math.min(100, 50 + pos * 10 - neg * 12 + (benefit > harm ? 8 : -8)));
      const composite = Math.round((utilitarian + deontological + virtue) / 3);
      const spread = Math.max(utilitarian, deontological, virtue) - Math.min(utilitarian, deontological, virtue);
      return {
        name: o.name || "Option",
        description: o.description || "",
        scores: {
          utilitarian: Math.round(utilitarian),
          deontological: Math.round(deontological),
          virtue: Math.round(virtue),
        },
        composite,
        agreement: spread < 15 ? "consensus" : spread < 35 ? "mild-disagreement" : "frameworks-conflict",
        benefit, harm,
      };
    });
    analyzed.sort((a, b) => b.composite - a.composite);
    const recommended = analyzed[0];
    const conflicted = analyzed.filter((a) => a.agreement === "frameworks-conflict").map((a) => a.name);

    const st = getEthicsState();
    const id = euid("mfa");
    const record = {
      id, dilemma, options: analyzed, recommended: recommended?.name,
      conflicted, createdAt: enow(),
    };
    elist(st.analyses, eid(ctx)).unshift(record);
    saveEthics();
    return { ok: true, result: record };
  }));

  registerLensAction("ethics", "listMultiFramework", ewrap((ctx) => {
    const st = getEthicsState();
    return { ok: true, result: { analyses: elist(st.analyses, eid(ctx)) } };
  }));

  /**
   * stakeholderMap — list affected parties with impact magnitude per option.
   * params: { title, options: [string], stakeholders: [{ name, group?, vulnerability?,
   *   impacts: { [optionName]: number(-100..100) } }] }
   */
  registerLensAction("ethics", "stakeholderMap", ewrap((ctx, artifact, params) => {
    const p = params || {};
    const title = String(p.title || "Untitled map").trim();
    const options = Array.isArray(p.options) ? p.options.map(String) : [];
    const stakeholders = Array.isArray(p.stakeholders) ? p.stakeholders : [];
    if (options.length === 0) return { ok: false, error: "at least one option required" };
    if (stakeholders.length === 0) return { ok: false, error: "at least one stakeholder required" };

    const rows = stakeholders.map((s) => {
      const vuln = Math.max(0, Math.min(100, fnum(s.vulnerability, 0)));
      const impacts = {};
      let totalWeighted = 0;
      for (const opt of options) {
        const raw = fnum(s.impacts?.[opt], 0);
        const clamped = Math.max(-100, Math.min(100, raw));
        // Vulnerability amplifies negative impact.
        const weighted = clamped < 0 ? clamped * (1 + vuln / 100) : clamped;
        impacts[opt] = { raw: clamped, weighted: Math.round(weighted * 10) / 10 };
        totalWeighted += weighted;
      }
      return {
        name: s.name || "Stakeholder",
        group: s.group || "ungrouped",
        vulnerability: vuln,
        impacts,
        netExposure: Math.round((totalWeighted / options.length) * 10) / 10,
      };
    });

    // Per-option aggregate score (sum of weighted impacts across stakeholders).
    const optionTotals = options.map((opt) => {
      const total = rows.reduce((s, r) => s + r.impacts[opt].weighted, 0);
      const harmed = rows.filter((r) => r.impacts[opt].weighted < 0).length;
      const benefited = rows.filter((r) => r.impacts[opt].weighted > 0).length;
      return {
        option: opt,
        netImpact: Math.round(total * 10) / 10,
        harmed, benefited,
        vulnerableHarmed: rows.filter((r) => r.vulnerability > 50 && r.impacts[opt].weighted < 0).length,
      };
    });
    optionTotals.sort((a, b) => b.netImpact - a.netImpact);

    const st = getEthicsState();
    const id = euid("smap");
    const record = {
      id, title, options, stakeholders: rows, optionTotals,
      bestOption: optionTotals[0]?.option, createdAt: enow(),
    };
    elist(st.maps, eid(ctx)).unshift(record);
    saveEthics();
    return { ok: true, result: record };
  }));

  registerLensAction("ethics", "listStakeholderMaps", ewrap((ctx) => {
    const st = getEthicsState();
    return { ok: true, result: { maps: elist(st.maps, eid(ctx)) } };
  }));

  /**
   * decisionMatrix — score options against weighted ethical criteria.
   * params: { title, criteria: [{ name, weight(0..1) }],
   *   options: [{ name, scores: { [criterionName]: number(0..10) } }] }
   */
  registerLensAction("ethics", "decisionMatrix", ewrap((ctx, artifact, params) => {
    const p = params || {};
    const title = String(p.title || "Untitled matrix").trim();
    const criteria = Array.isArray(p.criteria) ? p.criteria : [];
    const options = Array.isArray(p.options) ? p.options : [];
    if (criteria.length === 0) return { ok: false, error: "at least one criterion required" };
    if (options.length === 0) return { ok: false, error: "at least one option required" };

    // Clamp each weight to a finite, non-negative value BEFORE summing — a
    // poisoned "1e999"/Infinity weight would otherwise make weightSum Infinity
    // and every normalized weight NaN (Infinity/Infinity), leaking NaN/percent
    // into the rendered record.
    const rawWeights = criteria.map((c) => Math.max(0, fnum(c.weight, 0)));
    const weightSum = rawWeights.reduce((s, w) => s + w, 0) || 1;
    const normCriteria = criteria.map((c, i) => ({
      name: typeof c.name === "string" && c.name.trim() ? c.name : "Criterion",
      weight: rawWeights[i] / weightSum,
    }));

    const scored = options.map((o) => {
      const breakdown = normCriteria.map((c) => {
        const raw = Math.max(0, Math.min(10, fnum(o.scores?.[c.name], 0)));
        return { criterion: c.name, raw, weighted: Math.round(raw * c.weight * 100) / 100 };
      });
      const total = Math.round(breakdown.reduce((s, b) => s + b.weighted, 0) * 100) / 100;
      return {
        name: o.name || "Option",
        breakdown,
        total, // 0..10 weighted
        percent: Math.round(total * 10),
      };
    });
    scored.sort((a, b) => b.total - a.total);

    const st = getEthicsState();
    const id = euid("mtx");
    const record = {
      id, title, criteria: normCriteria, options: scored,
      winner: scored[0]?.name, createdAt: enow(),
    };
    elist(st.matrices, eid(ctx)).unshift(record);
    saveEthics();
    return { ok: true, result: record };
  }));

  registerLensAction("ethics", "listDecisionMatrices", ewrap((ctx) => {
    const st = getEthicsState();
    return { ok: true, result: { matrices: elist(st.matrices, eid(ctx)) } };
  }));

  // Canonical cognitive-bias review template.
  const BIAS_ITEMS = [
    { key: "confirmation", label: "Confirmation bias", prompt: "Did you seek evidence that contradicts your preferred option?" },
    { key: "anchoring", label: "Anchoring", prompt: "Is your judgment over-influenced by the first number or framing you saw?" },
    { key: "availability", label: "Availability heuristic", prompt: "Are recent or vivid cases distorting how likely outcomes feel?" },
    { key: "sunk_cost", label: "Sunk-cost fallacy", prompt: "Are past investments pushing you to continue regardless of merit?" },
    { key: "groupthink", label: "Groupthink", prompt: "Did dissenting views get genuine airtime?" },
    { key: "self_serving", label: "Self-serving bias", prompt: "Does the chosen option mostly benefit you or your group?" },
    { key: "status_quo", label: "Status-quo bias", prompt: "Are you defaulting to inaction simply because it is familiar?" },
    { key: "overconfidence", label: "Overconfidence", prompt: "Have you quantified your uncertainty honestly?" },
    { key: "framing", label: "Framing effect", prompt: "Would the decision change if framed as a loss instead of a gain?" },
    { key: "in_group", label: "In-group favoritism", prompt: "Are out-group stakeholders weighted fairly?" },
  ];

  registerLensAction("ethics", "biasChecklistTemplate", ewrap(() => {
    return { ok: true, result: { items: BIAS_ITEMS } };
  }));

  /**
   * biasChecklist — structured cognitive-bias review of a decision.
   * params: { decision, responses: { [biasKey]: { flagged: boolean, note?: string } } }
   */
  registerLensAction("ethics", "biasChecklist", ewrap((ctx, artifact, params) => {
    const p = params || {};
    const decision = String(p.decision || "").trim();
    if (!decision) return { ok: false, error: "decision text required" };
    const responses = p.responses && typeof p.responses === "object" ? p.responses : {};

    const items = BIAS_ITEMS.map((b) => {
      const r = responses[b.key] || {};
      return {
        key: b.key, label: b.label, prompt: b.prompt,
        flagged: !!r.flagged,
        note: String(r.note || ""),
      };
    });
    const flaggedItems = items.filter((i) => i.flagged);
    const riskScore = Math.round((flaggedItems.length / items.length) * 100);
    const riskLevel = riskScore >= 50 ? "high" : riskScore >= 20 ? "moderate" : "low";

    const st = getEthicsState();
    const id = euid("bchk");
    const record = {
      id, decision, items,
      flaggedCount: flaggedItems.length,
      totalCount: items.length,
      riskScore, riskLevel,
      createdAt: enow(),
    };
    elist(st.checklists, eid(ctx)).unshift(record);
    saveEthics();
    return { ok: true, result: record };
  }));

  registerLensAction("ethics", "listBiasChecklists", ewrap((ctx) => {
    const st = getEthicsState();
    return { ok: true, result: { checklists: elist(st.checklists, eid(ctx)) } };
  }));

  /**
   * submitReview — submit a dilemma into the peer-input review workflow.
   * params: { title, dilemma, options?: [string] }
   */
  registerLensAction("ethics", "submitReview", ewrap((ctx, artifact, params) => {
    const p = params || {};
    const title = String(p.title || "").trim();
    const dilemma = String(p.dilemma || "").trim();
    if (!title) return { ok: false, error: "title required" };
    if (!dilemma) return { ok: false, error: "dilemma required" };

    const st = getEthicsState();
    const id = euid("rev");
    const record = {
      id, title, dilemma,
      options: Array.isArray(p.options) ? p.options.map(String) : [],
      status: "open", // open -> deliberating -> decided
      submittedBy: eid(ctx),
      opinions: [], // { id, by, stance, rationale, createdAt }
      verdict: null,
      createdAt: enow(), updatedAt: enow(),
    };
    elist(st.reviews, eid(ctx)).unshift(record);
    saveEthics();
    return { ok: true, result: record };
  }));

  /**
   * addReviewOpinion — record peer input on a review.
   * params: { reviewId, stance(approve|reject|abstain|amend), rationale, by? }
   */
  registerLensAction("ethics", "addReviewOpinion", ewrap((ctx, artifact, params) => {
    const p = params || {};
    const reviewId = String(p.reviewId || "");
    const stance = String(p.stance || "abstain");
    if (!reviewId) return { ok: false, error: "reviewId required" };
    if (!["approve", "reject", "abstain", "amend"].includes(stance)) {
      return { ok: false, error: "invalid stance" };
    }
    const st = getEthicsState();
    const reviews = elist(st.reviews, eid(ctx));
    const rev = reviews.find((r) => r.id === reviewId);
    if (!rev) return { ok: false, error: "review not found" };
    if (rev.status === "decided") return { ok: false, error: "review already decided" };

    rev.opinions.push({
      id: euid("op"),
      by: String(p.by || eid(ctx)),
      stance,
      rationale: String(p.rationale || ""),
      createdAt: enow(),
    });
    rev.status = "deliberating";
    rev.updatedAt = enow();
    saveEthics();
    return { ok: true, result: rev };
  }));

  /**
   * recordVerdict — finalise an ethics review with a verdict.
   * params: { reviewId, decision, rationale }
   */
  registerLensAction("ethics", "recordVerdict", ewrap((ctx, artifact, params) => {
    const p = params || {};
    const reviewId = String(p.reviewId || "");
    const decision = String(p.decision || "").trim();
    if (!reviewId) return { ok: false, error: "reviewId required" };
    if (!decision) return { ok: false, error: "decision required" };
    const st = getEthicsState();
    const reviews = elist(st.reviews, eid(ctx));
    const rev = reviews.find((r) => r.id === reviewId);
    if (!rev) return { ok: false, error: "review not found" };

    const tally = { approve: 0, reject: 0, abstain: 0, amend: 0 };
    for (const o of rev.opinions) tally[o.stance] = (tally[o.stance] || 0) + 1;

    rev.verdict = {
      decision,
      rationale: String(p.rationale || ""),
      tally,
      decidedBy: eid(ctx),
      decidedAt: enow(),
    };
    rev.status = "decided";
    rev.updatedAt = enow();
    saveEthics();
    return { ok: true, result: rev };
  }));

  registerLensAction("ethics", "listReviews", ewrap((ctx) => {
    const st = getEthicsState();
    return { ok: true, result: { reviews: elist(st.reviews, eid(ctx)) } };
  }));

  /**
   * archiveCase — archive a resolved dilemma into the searchable case library.
   * params: { title, dilemma, reasoning, resolution, framework?, tags?: [string] }
   */
  registerLensAction("ethics", "archiveCase", ewrap((ctx, artifact, params) => {
    const p = params || {};
    const title = String(p.title || "").trim();
    const dilemma = String(p.dilemma || "").trim();
    const resolution = String(p.resolution || "").trim();
    if (!title) return { ok: false, error: "title required" };
    if (!dilemma) return { ok: false, error: "dilemma required" };
    if (!resolution) return { ok: false, error: "resolution required" };

    const st = getEthicsState();
    const id = euid("case");
    const record = {
      id, title, dilemma,
      reasoning: String(p.reasoning || ""),
      resolution,
      framework: String(p.framework || ""),
      tags: Array.isArray(p.tags) ? p.tags.map((t) => String(t).toLowerCase()) : [],
      sourceReviewId: p.sourceReviewId ? String(p.sourceReviewId) : null,
      archivedAt: enow(),
    };
    elist(st.cases, eid(ctx)).unshift(record);
    saveEthics();
    return { ok: true, result: record };
  }));

  /**
   * searchCases — searchable archive of resolved dilemmas.
   * params: { query?, tag?, framework? }
   */
  registerLensAction("ethics", "searchCases", ewrap((ctx, artifact, params) => {
    const p = params || {};
    const q = String(p.query || "").toLowerCase().trim();
    const tag = String(p.tag || "").toLowerCase().trim();
    const framework = String(p.framework || "").toLowerCase().trim();
    const st = getEthicsState();
    let cases = elist(st.cases, eid(ctx));
    if (q) {
      cases = cases.filter((c) =>
        c.title.toLowerCase().includes(q) ||
        c.dilemma.toLowerCase().includes(q) ||
        c.reasoning.toLowerCase().includes(q) ||
        c.resolution.toLowerCase().includes(q));
    }
    if (tag) cases = cases.filter((c) => c.tags.includes(tag));
    if (framework) cases = cases.filter((c) => c.framework.toLowerCase().includes(framework));
    const allTags = [...new Set(elist(st.cases, eid(ctx)).flatMap((c) => c.tags))].sort();
    return { ok: true, result: { cases, total: cases.length, allTags } };
  }));

  registerLensAction("ethics", "deleteCase", ewrap((ctx, artifact, params) => {
    const id = String(params?.caseId || "");
    if (!id) return { ok: false, error: "caseId required" };
    const st = getEthicsState();
    const cases = elist(st.cases, eid(ctx));
    const idx = cases.findIndex((c) => c.id === id);
    if (idx === -1) return { ok: false, error: "case not found" };
    cases.splice(idx, 1);
    saveEthics();
    return { ok: true, result: { deleted: id } };
  }));
}
