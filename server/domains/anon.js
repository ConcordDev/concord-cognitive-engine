// server/domains/anon.js
// Domain actions for anonymization/privacy: k-anonymity, re-identification
// risk assessment, and differential privacy noise injection.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerAnonActions(registerLensAction) {
  /**
   * anonymize
   * Anonymize data fields using k-anonymity via generalization hierarchies.
   * Detects quasi-identifiers, applies generalization, and computes information loss.
   * artifact.data.records = [{ field1: val, field2: val, ... }]
   * artifact.data.quasiIdentifiers = ["field1", "field2"] (optional — auto-detected if absent)
   * artifact.data.sensitiveFields = ["fieldN"] (optional)
   * params.k = desired k-anonymity level (default 3)
   */
  registerLensAction("anon", "anonymize", (ctx, artifact, params) => {
    const records = artifact.data?.records || [];
    if (records.length === 0) return { ok: true, result: { message: "No records to anonymize." } };

    const k = params.k || 3;

    // Auto-detect quasi-identifiers if not specified
    const qids = artifact.data?.quasiIdentifiers || [];
    const sensitiveFields = new Set(artifact.data?.sensitiveFields || []);

    if (qids.length === 0) {
      // Heuristic: fields with moderate cardinality (not unique, not constant) are quasi-identifiers
      const allFields = Object.keys(records[0] || {});
      for (const field of allFields) {
        if (sensitiveFields.has(field)) continue;
        const uniqueVals = new Set(records.map(r => r[field]));
        const ratio = uniqueVals.size / records.length;
        // Quasi-identifiers typically have cardinality between 2% and 80% of record count
        if (ratio > 0.02 && ratio < 0.8 && uniqueVals.size > 1) {
          qids.push(field);
        }
      }
    }

    // Build generalization hierarchies
    function generalizeValue(value, level) {
      if (value == null) return "*";
      const str = String(value);

      // Numeric generalization: widen range
      const num = parseFloat(str);
      if (!isNaN(num)) {
        const bucketSize = Math.pow(10, level);
        const lower = Math.floor(num / bucketSize) * bucketSize;
        return `${lower}-${lower + bucketSize - 1}`;
      }

      // String generalization: truncate from right
      if (level >= str.length) return "*";
      return str.substring(0, Math.max(1, str.length - level)) + "*";
    }

    // Check k-anonymity: every equivalence class must have >= k records
    function checkKAnonymity(recs, fields, level) {
      const groups = {};
      for (const rec of recs) {
        const key = fields.map(f => generalizeValue(rec[f], level)).join("||");
        groups[key] = (groups[key] || 0) + 1;
      }
      const counts = Object.values(groups);
      const satisfied = counts.every(c => c >= k);
      const minGroupSize = Math.min(...counts);
      const numGroups = counts.length;
      return { satisfied, minGroupSize, numGroups, groups };
    }

    // Find minimum generalization level that achieves k-anonymity
    let generalizationLevel = 0;
    let result = checkKAnonymity(records, qids, 0);
    while (!result.satisfied && generalizationLevel < 10) {
      generalizationLevel++;
      result = checkKAnonymity(records, qids, generalizationLevel);
    }

    // Apply generalization to produce anonymized records
    const anonymized = records.map(rec => {
      const newRec = { ...rec };
      for (const field of qids) {
        newRec[field] = generalizeValue(rec[field], generalizationLevel);
      }
      // Suppress sensitive fields
      for (const field of sensitiveFields) {
        newRec[field] = "[REDACTED]";
      }
      return newRec;
    });

    // Compute information loss (normalized certainty penalty)
    // For each QID, loss = 1 - (1 / generalization_domain_size)
    let totalInfoLoss = 0;
    for (const field of qids) {
      const originalCardinality = new Set(records.map(r => r[field])).size;
      const anonymizedCardinality = new Set(anonymized.map(r => r[field])).size;
      const fieldLoss = originalCardinality > 1
        ? 1 - (anonymizedCardinality / originalCardinality)
        : 0;
      totalInfoLoss += fieldLoss;
    }
    const avgInfoLoss = qids.length > 0 ? totalInfoLoss / qids.length : 0;

    // Equivalence class statistics
    const eqGroups = {};
    for (const rec of anonymized) {
      const key = qids.map(f => rec[f]).join("||");
      eqGroups[key] = (eqGroups[key] || 0) + 1;
    }
    const groupSizes = Object.values(eqGroups);

    artifact.data.anonymizedRecords = anonymized;

    return {
      ok: true, result: {
        kAchieved: result.satisfied,
        k,
        generalizationLevel,
        quasiIdentifiers: qids,
        sensitiveFieldsRedacted: [...sensitiveFields],
        informationLoss: Math.round(avgInfoLoss * 10000) / 100,
        equivalenceClasses: groupSizes.length,
        minClassSize: Math.min(...groupSizes),
        maxClassSize: Math.max(...groupSizes),
        avgClassSize: Math.round((groupSizes.reduce((s, v) => s + v, 0) / groupSizes.length) * 100) / 100,
        recordCount: records.length,
        anonymizedSample: anonymized.slice(0, 5),
      },
    };
  });

  /**
   * privacyRisk
   * Compute re-identification risk using prosecutor, journalist, and marketer
   * attack models. Scores uniqueness of records.
   * artifact.data.records = [{ field1: val, ... }]
   * artifact.data.quasiIdentifiers = ["field1", "field2"]
   */
  registerLensAction("anon", "privacyRisk", (ctx, artifact, params) => {
    const records = artifact.data?.records || [];
    if (records.length === 0) return { ok: true, result: { message: "No records to assess." } };

    const qids = artifact.data?.quasiIdentifiers || Object.keys(records[0] || {});

    // Build equivalence classes
    const eqClasses = {};
    for (const rec of records) {
      const key = qids.map(f => String(rec[f] ?? "")).join("||");
      if (!eqClasses[key]) eqClasses[key] = [];
      eqClasses[key].push(rec);
    }

    const classSizes = Object.values(eqClasses).map(c => c.length);
    const n = records.length;

    // Prosecutor model: attacker targets a specific individual they know is in the dataset
    // Risk = max(1/|eq_class|) — worst case for any individual
    const prosecutorRisk = Math.max(...classSizes.map(s => 1 / s));

    // Journalist model: attacker wants to re-identify any individual (expected success)
    // Risk = (1/n) * sum(1/|eq_class_i|) for each record i
    let journalistSum = 0;
    for (const cls of Object.values(eqClasses)) {
      journalistSum += cls.length * (1 / cls.length); // each record contributes 1/|class|
    }
    const journalistRisk = journalistSum / n;

    // Marketer model: attacker wants to re-identify as many as possible
    // Risk = number_of_unique_records / n
    const uniqueRecords = classSizes.filter(s => s === 1).length;
    const marketerRisk = uniqueRecords / n;

    // Uniqueness scoring per field combination (power set of QIDs, up to 4 fields)
    const fieldRisks = [];
    const maxComboSize = Math.min(qids.length, 4);
    function combinations(arr, size) {
      if (size === 0) return [[]];
      if (arr.length === 0) return [];
      const [first, ...rest] = arr;
      const withFirst = combinations(rest, size - 1).map(c => [first, ...c]);
      const withoutFirst = combinations(rest, size);
      return [...withFirst, ...withoutFirst];
    }

    for (let size = 1; size <= maxComboSize; size++) {
      const combos = combinations(qids, size);
      for (const combo of combos.slice(0, 20)) { // cap to avoid explosion
        const groups = {};
        for (const rec of records) {
          const key = combo.map(f => String(rec[f] ?? "")).join("||");
          groups[key] = (groups[key] || 0) + 1;
        }
        const sizes = Object.values(groups);
        const uniques = sizes.filter(s => s === 1).length;
        fieldRisks.push({
          fields: combo,
          uniqueRecords: uniques,
          uniquenessRatio: Math.round((uniques / n) * 10000) / 100,
          minGroupSize: Math.min(...sizes),
          distinctGroups: sizes.length,
        });
      }
    }

    fieldRisks.sort((a, b) => b.uniquenessRatio - a.uniquenessRatio);

    // Overall risk level
    const maxRisk = Math.max(prosecutorRisk, journalistRisk, marketerRisk);
    const riskLevel = maxRisk > 0.5 ? "critical" : maxRisk > 0.2 ? "high" : maxRisk > 0.1 ? "moderate" : "low";

    return {
      ok: true, result: {
        attackModels: {
          prosecutor: { risk: Math.round(prosecutorRisk * 10000) / 100, description: "Targeted attack on known individual" },
          journalist: { risk: Math.round(journalistRisk * 10000) / 100, description: "Random re-identification attempt" },
          marketer: { risk: Math.round(marketerRisk * 10000) / 100, description: "Bulk re-identification" },
        },
        overallRiskLevel: riskLevel,
        uniqueRecords,
        totalRecords: n,
        equivalenceClasses: classSizes.length,
        smallestClassSize: Math.min(...classSizes),
        fieldCombinationRisks: fieldRisks.slice(0, 15),
        recommendations: [
          ...(prosecutorRisk > 0.2 ? ["Apply k-anonymity (k >= 5) to reduce prosecutor risk"] : []),
          ...(uniqueRecords > 0 ? [`${uniqueRecords} unique records need generalization or suppression`] : []),
          ...(fieldRisks.some(f => f.fields.length <= 2 && f.uniquenessRatio > 50) ? ["High uniqueness with few fields — consider removing or generalizing key quasi-identifiers"] : []),
        ],
      },
    };
  });

  /**
   * differentialPrivacy
   * Add differential privacy noise using the Laplace mechanism with epsilon
   * budget tracking and sensitivity calibration.
   * artifact.data.values = [number, ...] or artifact.data.queries = [{ type: "count"|"sum"|"mean", values: [...] }]
   * params.epsilon = privacy budget (default 1.0)
   * params.sensitivity = global sensitivity (auto-computed if absent)
   */
  registerLensAction("anon", "differentialPrivacy", (ctx, artifact, params) => {
    const epsilon = params.epsilon || 1.0;
    const queries = artifact.data?.queries || [];
    const rawValues = artifact.data?.values || [];

    // Laplace noise generator (using inverse CDF method)
    function laplace(scale) {
      const u = Math.random() - 0.5;
      return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
    }

    // Process single query
    function processQuery(query, epsilonBudget) {
      const values = query.values || rawValues;
      if (values.length === 0) return { trueAnswer: 0, noisyAnswer: 0, noise: 0, sensitivity: 0 };

      const type = query.type || "count";
      let trueAnswer, sensitivity;

      switch (type) {
        case "count":
          trueAnswer = values.length;
          sensitivity = 1; // adding/removing one record changes count by 1
          break;
        case "sum": {
          trueAnswer = values.reduce((s, v) => s + (parseFloat(v) || 0), 0);
          // Sensitivity = max possible contribution of one record
          const maxVal = Math.max(...values.map(v => Math.abs(parseFloat(v) || 0)));
          sensitivity = query.sensitivity || maxVal || 1;
          break;
        }
        case "mean": {
          const nums = values.map(v => parseFloat(v) || 0);
          trueAnswer = nums.reduce((s, v) => s + v, 0) / nums.length;
          const range = Math.max(...nums) - Math.min(...nums);
          sensitivity = query.sensitivity || (range / nums.length) || 1;
          break;
        }
        case "max": {
          const nums = values.map(v => parseFloat(v) || 0).sort((a, b) => a - b);
          trueAnswer = nums[nums.length - 1];
          // Smooth sensitivity: difference between top two values
          sensitivity = query.sensitivity || (nums.length > 1 ? nums[nums.length - 1] - nums[nums.length - 2] : 1);
          break;
        }
        case "median": {
          const nums = values.map(v => parseFloat(v) || 0).sort((a, b) => a - b);
          const mid = Math.floor(nums.length / 2);
          trueAnswer = nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
          // Local sensitivity for median
          sensitivity = query.sensitivity || (nums.length > 1 ? nums[Math.min(mid + 1, nums.length - 1)] - nums[Math.max(mid - 1, 0)] : 1);
          break;
        }
        default:
          trueAnswer = values.length;
          sensitivity = 1;
      }

      const scale = sensitivity / epsilonBudget;
      const noise = laplace(scale);
      const noisyAnswer = trueAnswer + noise;

      // Confidence interval (Laplace: P(|noise| > t) = exp(-t/scale))
      // 95% CI: t = scale * ln(1/0.05) ≈ scale * 3.0
      const ci95 = scale * Math.log(1 / 0.05);

      return {
        type,
        trueAnswer: Math.round(trueAnswer * 10000) / 10000,
        noisyAnswer: Math.round(noisyAnswer * 10000) / 10000,
        noise: Math.round(noise * 10000) / 10000,
        sensitivity: Math.round(sensitivity * 10000) / 10000,
        scale: Math.round(scale * 10000) / 10000,
        confidenceInterval95: Math.round(ci95 * 10000) / 10000,
        relativeError: trueAnswer !== 0
          ? Math.round((Math.abs(noise) / Math.abs(trueAnswer)) * 10000) / 100
          : null,
      };
    }

    // If no structured queries, treat raw values as a single count+sum+mean
    let results;
    let totalEpsilonUsed;

    if (queries.length > 0) {
      // Sequential composition: split epsilon budget across queries
      const perQueryEpsilon = epsilon / queries.length;
      results = queries.map(q => processQuery(q, perQueryEpsilon));
      totalEpsilonUsed = epsilon;
    } else if (rawValues.length > 0) {
      // Run three default queries, splitting budget equally
      const perQueryEpsilon = epsilon / 3;
      results = [
        processQuery({ type: "count", values: rawValues }, perQueryEpsilon),
        processQuery({ type: "sum", values: rawValues }, perQueryEpsilon),
        processQuery({ type: "mean", values: rawValues }, perQueryEpsilon),
      ];
      totalEpsilonUsed = epsilon;
    } else {
      return { ok: true, result: { message: "No values or queries to process." } };
    }

    // Budget tracking
    const previousBudget = artifact.data?.epsilonBudgetUsed || 0;
    const cumulativeBudget = previousBudget + totalEpsilonUsed;
    artifact.data.epsilonBudgetUsed = cumulativeBudget;

    // Privacy guarantee assessment
    const privacyLevel = epsilon <= 0.1 ? "strong" : epsilon <= 1.0 ? "moderate" : epsilon <= 5.0 ? "weak" : "minimal";

    return {
      ok: true, result: {
        results,
        privacyParameters: {
          epsilon,
          privacyLevel,
          queriesProcessed: results.length,
          epsilonPerQuery: Math.round((epsilon / results.length) * 10000) / 10000,
        },
        budgetTracking: {
          thisInvocation: totalEpsilonUsed,
          cumulative: Math.round(cumulativeBudget * 10000) / 10000,
          previouslyUsed: previousBudget,
          warning: cumulativeBudget > 10 ? "High cumulative epsilon — privacy guarantees significantly degraded" : null,
        },
        utilityAnalysis: {
          avgRelativeError: Math.round(
            (results.filter(r => r.relativeError != null).reduce((s, r) => s + r.relativeError, 0) /
            Math.max(1, results.filter(r => r.relativeError != null).length)) * 100
          ) / 100,
          maxNoise: Math.max(...results.map(r => Math.abs(r.noise || 0))),
        },
      },
    };
  });

  // Persistent records substrate (audit THIN-tier depth pass).
  registerLensSubstrate(registerLensAction, "anon", {
    noun: "identity", idPrefix: "idn",
    kinds: ["pseudonym","alias","mask","burner"],
    statuses: ["active","dormant","retired"],
  });
}
