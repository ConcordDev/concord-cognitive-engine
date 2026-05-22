// server/domains/hypothesis.js
// Domain actions for hypothesis testing: statistical tests, A/B experiment
// analysis, Bayesian inference, power analysis, the full classical test
// battery (t-test, ANOVA, chi-square, correlation, regression), dataset
// import, assumption checks, a pre-registration registry, multiple-comparison
// correction, and APA-formatted report export.
//
// All statistics are real computations — no mock/seed data anywhere. Per-user
// persistent state (imported datasets, saved analyses, pre-registered
// hypotheses) lives in globalThis._concordSTATE.hypothesisLens, keyed by userId.

export default function registerHypothesisActions(rawRegister) {
  // Local registry so dataset-driven dispatch can re-enter handlers without
  // depending on the server-scoped LENS_ACTIONS map. Every registration both
  // forwards to the server registrar and caches the handler by its action name.
  const LENS = new Map();
  function registerLensAction(domain, action, handler) {
    LENS.set(action, handler);
    return rawRegister(domain, action, handler);
  }

  // ===========================================================================
  // Numerical primitives
  // ===========================================================================

  // Standard normal CDF approximation (Abramowitz & Stegun)
  function normCDF(z) {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = z < 0 ? -1 : 1;
    z = Math.abs(z) / Math.SQRT2;
    const t = 1 / (1 + p * z);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
    return 0.5 * (1 + sign * y);
  }

  // Inverse normal CDF (rational approximation)
  function normInv(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    if (p === 0.5) return 0;
    const a = [
      -3.969683028665376e+01, 2.209460984245205e+02,
      -2.759285104469687e+02, 1.383577518672690e+02,
      -3.066479806614716e+01, 2.506628277459239e+00
    ];
    const b = [
      -5.447609879822406e+01, 1.615858368580409e+02,
      -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01
    ];
    const c = [
      -7.784894002430293e-03, -3.223964580411365e-01,
      -2.400758277161838e+00, -2.549732539343734e+00,
      4.374664141464968e+00, 2.938163982698783e+00
    ];
    const d = [
      7.784695709041462e-03, 3.224671290700398e-01,
      2.445134137142996e+00, 3.754408661907416e+00
    ];
    const pLow = 0.02425, pHigh = 1 - pLow;
    let q, r;
    if (p < pLow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p <= pHigh) {
      q = p - 0.5; r = q * q;
      return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
  }

  // Log-gamma (Lanczos approximation)
  function logGamma(z) {
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
    z -= 1;
    const g = 7;
    const coefs = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
      771.32342877765313, -176.61502916214059, 12.507343278686905,
      -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    let x = coefs[0];
    for (let i = 1; i < g + 2; i++) x += coefs[i] / (z + i);
    const t = z + g + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }

  // Regularised lower incomplete gamma P(a,x) — continued fraction + series
  function gammaP(a, x) {
    if (x <= 0 || a <= 0) return 0;
    if (x < a + 1) {
      // Series expansion
      let term = 1 / a, sum = term;
      for (let n = 1; n < 500; n++) {
        term *= x / (a + n);
        sum += term;
        if (Math.abs(term) < Math.abs(sum) * 1e-12) break;
      }
      return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
    }
    // Continued fraction for Q(a,x), then P = 1 - Q
    const tiny = 1e-30;
    let b = x + 1 - a, c = 1 / tiny, d = 1 / b, h = d;
    for (let i = 1; i < 500; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b; if (Math.abs(d) < tiny) d = tiny;
      c = b + an / c; if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-12) break;
    }
    const q = Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
    return 1 - q;
  }

  // Regularised incomplete beta I_x(a,b) — Lentz continued fraction
  function betaInc(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const lbeta = logGamma(a + b) - logGamma(a) - logGamma(b);
    const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b + lbeta) / a;
    const tiny = 1e-30;
    let f = 1, c = 1, d = 0;
    for (let i = 0; i <= 250; i++) {
      const m = Math.floor(i / 2);
      let numerator;
      if (i === 0) numerator = 1;
      else if (i % 2 === 0) numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
      else numerator = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
      d = 1 + numerator * d; if (Math.abs(d) < tiny) d = tiny; d = 1 / d;
      c = 1 + numerator / c; if (Math.abs(c) < tiny) c = tiny;
      const cd = c * d;
      f *= cd;
      if (Math.abs(1 - cd) < 1e-12) break;
    }
    const result = front * (f - 1);
    return result < 0 ? 0 : result > 1 ? 1 : result;
  }

  // Two-tailed p-value for Student's t with df degrees of freedom
  function tDistTwoTailed(t, df) {
    if (df <= 0 || Number.isNaN(t)) return 1;
    if (!Number.isFinite(t)) return 0; // infinite t-statistic => p = 0
    const x = df / (df + t * t);
    return betaInc(x, df / 2, 0.5);
  }

  // One-tailed (right) p-value for Student's t
  function tDistRightTail(t, df) {
    const two = tDistTwoTailed(t, df);
    return t >= 0 ? two / 2 : 1 - two / 2;
  }

  // Right-tail p-value for chi-square with df degrees of freedom
  function chiSquarePValue(x2, df) {
    if (x2 <= 0 || df <= 0) return 1;
    return 1 - gammaP(df / 2, x2 / 2);
  }

  // Right-tail p-value for F distribution with (d1, d2) degrees of freedom
  function fDistPValue(f, d1, d2) {
    if (f <= 0 || d1 <= 0 || d2 <= 0) return 1;
    const x = d2 / (d2 + d1 * f);
    return betaInc(x, d2 / 2, d1 / 2);
  }

  const rd = v => (Number.isFinite(v) ? Math.round(v * 100000) / 100000 : v);

  function mean(arr) { return arr.reduce((s, v) => s + v, 0) / arr.length; }
  function variance(arr, m) {
    if (arr.length < 2) return 0;
    const mu = m === undefined ? mean(arr) : m;
    return arr.reduce((s, v) => s + (v - mu) * (v - mu), 0) / (arr.length - 1);
  }
  function toNumbers(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(Number).filter(v => Number.isFinite(v));
  }
  function effectMag(d) {
    return d < 0.2 ? "negligible" : d < 0.5 ? "small" : d < 0.8 ? "medium" : "large";
  }

  // ===========================================================================
  // Per-user persistent state
  // ===========================================================================

  function hstate() {
    const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
    if (!STATE.hypothesisLens) {
      STATE.hypothesisLens = {
        datasets: new Map(),    // userId -> Map<datasetId, dataset>
        analyses: new Map(),    // userId -> Map<analysisId, analysisRecord>
        registry: new Map(),    // userId -> Map<hypId, preRegistration>
      };
    }
    return STATE.hypothesisLens;
  }
  function userIdOf(ctx) {
    return (ctx && (ctx.userId || (ctx.actor && ctx.actor.userId))) || "anon";
  }
  function bucket(map, uid) {
    if (!map.has(uid)) map.set(uid, new Map());
    return map.get(uid);
  }
  function rid(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  // Save a completed analysis to the per-user history so it is reusable.
  function recordAnalysis(ctx, kind, summary, result) {
    try {
      const uid = userIdOf(ctx);
      const analyses = bucket(hstate().analyses, uid);
      const id = rid("ana");
      analyses.set(id, {
        id, kind, summary, result,
        createdAt: new Date().toISOString(),
      });
      return id;
    } catch (_e) { return null; }
  }

  // ===========================================================================
  // Existing tests (z, A/B, Bayesian, power) — preserved verbatim in behaviour
  // ===========================================================================

  /**
   * zTest — one-sample or two-sample Z-test for means.
   * artifact.data.sample = { mean, stdDev, n }
   * artifact.data.sample2 = { mean, stdDev, n } (two-sample)
   * artifact.data.populationMean (one-sample)
   */
  registerLensAction("hypothesis", "zTest", (ctx, artifact, params) => {
    try {
      const s1 = artifact.data?.sample;
      if (!s1) return { ok: false, error: "sample data required: { mean, stdDev, n }" };

      const alpha = params.alpha || 0.05;
      const alt = params.alternative || "two-sided";
      const s2 = artifact.data?.sample2;

      let z, se, effectSize, testType;

      if (s2) {
        testType = "two-sample";
        se = Math.sqrt((s1.stdDev * s1.stdDev) / s1.n + (s2.stdDev * s2.stdDev) / s2.n);
        z = (s1.mean - s2.mean) / se;
        const pooledSD = Math.sqrt((s1.stdDev * s1.stdDev + s2.stdDev * s2.stdDev) / 2);
        effectSize = pooledSD > 0 ? Math.abs(s1.mean - s2.mean) / pooledSD : 0;
      } else {
        testType = "one-sample";
        const mu0 = artifact.data?.populationMean ?? 0;
        se = s1.stdDev / Math.sqrt(s1.n);
        z = (s1.mean - mu0) / se;
        effectSize = s1.stdDev > 0 ? Math.abs(s1.mean - mu0) / s1.stdDev : 0;
      }

      let pValue;
      if (alt === "greater") pValue = 1 - normCDF(z);
      else if (alt === "less") pValue = normCDF(z);
      else pValue = 2 * (1 - normCDF(Math.abs(z)));

      const reject = pValue < alpha;
      const zCrit = alt === "two-sided" ? normInv(1 - alpha / 2) : normInv(1 - alpha);
      const marginOfError = zCrit * se;
      const ciLow = (s2 ? s1.mean - s2.mean : s1.mean) - marginOfError;
      const ciHigh = (s2 ? s1.mean - s2.mean : s1.mean) + marginOfError;

      const result = {
        testType, alternative: alt, alpha,
        zStatistic: rd(z), pValue: rd(pValue),
        criticalValue: rd(zCrit),
        reject, conclusion: reject
          ? `Reject H₀ at α=${alpha} (p=${rd(pValue)} < ${alpha})`
          : `Fail to reject H₀ at α=${alpha} (p=${rd(pValue)} ≥ ${alpha})`,
        confidenceInterval: { level: 1 - alpha, lower: rd(ciLow), upper: rd(ciHigh) },
        effectSize: rd(effectSize),
        effectMagnitude: effectMag(effectSize),
        standardError: rd(se),
      };
      recordAnalysis(ctx, "zTest", `${testType} Z-test`, result);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * abTest — A/B conversion-rate experiment analysis.
   */
  registerLensAction("hypothesis", "abTest", (ctx, artifact, params) => {
    try {
      const control = artifact.data?.control;
      const variant = artifact.data?.variant;
      if (!control || !variant) return { ok: false, error: "Both control and variant data required." };

      const alpha = params.alpha || 0.05;
      const pC = control.conversions / control.visitors;
      const pV = variant.conversions / variant.visitors;
      const nC = control.visitors;
      const nV = variant.visitors;

      const pPooled = (control.conversions + variant.conversions) / (nC + nV);
      const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / nC + 1 / nV));
      const z = se > 0 ? (pV - pC) / se : 0;
      const pValue = 2 * (1 - normCDF(Math.abs(z)));

      const seUnpooled = Math.sqrt(pC * (1 - pC) / nC + pV * (1 - pV) / nV);
      const zCrit = normInv(1 - alpha / 2);
      const diff = pV - pC;
      const ciLow = diff - zCrit * seUnpooled;
      const ciHigh = diff + zCrit * seUnpooled;
      const relativeUplift = pC > 0 ? (pV - pC) / pC : 0;

      const z80 = normInv(0.9);
      const zAlpha = normInv(1 - alpha / 2);
      const avgP = (pC + pV) / 2;
      const requiredN = diff !== 0
        ? Math.ceil(Math.pow(zAlpha * Math.sqrt(2 * avgP * (1 - avgP)) + z80 * Math.sqrt(pC * (1 - pC) + pV * (1 - pV)), 2) / (diff * diff))
        : Infinity;

      const nonCentrality = seUnpooled > 0 ? Math.abs(diff) / seUnpooled : 0;
      const power = 1 - normCDF(zCrit - nonCentrality);
      const significant = pValue < alpha;

      const result = {
        control: { visitors: nC, conversions: control.conversions, rate: rd(pC * 100) + "%" },
        variant: { visitors: nV, conversions: variant.conversions, rate: rd(pV * 100) + "%" },
        absoluteDifference: rd(diff * 100) + " pp",
        relativeUplift: rd(relativeUplift * 100) + "%",
        zStatistic: rd(z), pValue: rd(pValue),
        significant,
        confidenceInterval: { level: (1 - alpha) * 100 + "%", lower: rd(ciLow * 100) + " pp", upper: rd(ciHigh * 100) + " pp" },
        statisticalPower: rd(power * 100) + "%",
        sampleSizeForPower80: requiredN < Infinity ? requiredN : "no detectable effect",
        recommendation: !significant ? "Not statistically significant — continue collecting data"
          : pV > pC ? `Variant wins with ${rd(relativeUplift * 100)}% uplift (p=${rd(pValue)})`
          : `Control wins — variant decreases conversion by ${rd(Math.abs(relativeUplift) * 100)}%`,
      };
      recordAnalysis(ctx, "abTest", "A/B test", result);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * bayesianInference — conjugate-prior Bayesian update.
   */
  registerLensAction("hypothesis", "bayesianInference", (ctx, artifact, _params) => {
    try {
      const prior = artifact.data?.prior || { distribution: "beta", alpha: 1, beta: 1 };
      const obs = artifact.data?.observations || {};

      function betaPDF(x, a, b) {
        const logBeta = logGamma(a) + logGamma(b) - logGamma(a + b);
        return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - logBeta);
      }

      if (prior.distribution === "beta") {
        const a0 = prior.alpha || 1;
        const b0 = prior.beta || 1;
        const successes = obs.successes || 0;
        const trials = obs.trials || 0;
        const failures = trials - successes;

        const aPost = a0 + successes;
        const bPost = b0 + failures;

        const m = aPost / (aPost + bPost);
        const mode = (aPost > 1 && bPost > 1) ? (aPost - 1) / (aPost + bPost - 2) : m;
        const v = (aPost * bPost) / ((aPost + bPost) * (aPost + bPost) * (aPost + bPost + 1));
        const sd = Math.sqrt(v);

        const ciLow = Math.max(0, m - 1.96 * sd);
        const ciHigh = Math.min(1, m + 1.96 * sd);

        const priorMean = a0 / (a0 + b0);
        const priorVar = (a0 * b0) / ((a0 + b0) * (a0 + b0) * (a0 + b0 + 1));

        const priorAt05 = betaPDF(0.5, a0, b0);
        const posteriorAt05 = betaPDF(0.5, aPost, bPost);
        const bayesFactor = posteriorAt05 > 0 ? priorAt05 / posteriorAt05 : Infinity;

        let evidence;
        if (bayesFactor > 100) evidence = "decisive";
        else if (bayesFactor > 30) evidence = "very_strong";
        else if (bayesFactor > 10) evidence = "strong";
        else if (bayesFactor > 3) evidence = "substantial";
        else if (bayesFactor > 1) evidence = "anecdotal";
        else evidence = "supports_null";

        artifact.data.posterior = { distribution: "beta", alpha: aPost, beta: bPost };

        const result = {
          prior: { distribution: "Beta", alpha: a0, beta: b0, mean: rd(priorMean), variance: rd(priorVar) },
          likelihood: { successes, failures, trials },
          posterior: {
            distribution: "Beta", alpha: aPost, beta: bPost,
            mean: rd(m), mode: rd(mode), stdDev: rd(sd), variance: rd(v),
          },
          credibleInterval: { level: "95%", lower: rd(ciLow), upper: rd(ciHigh) },
          bayesFactor: rd(bayesFactor),
          evidenceStrength: evidence,
          shrinkage: rd(Math.abs(m - priorMean) / Math.abs(successes / Math.max(trials, 1) - priorMean)),
        };
        recordAnalysis(ctx, "bayesianInference", "Bayesian (Beta-Binomial)", result);
        return { ok: true, result };
      }

      if (prior.distribution === "normal") {
        const mu0 = prior.mean || 0;
        const tau0 = prior.precision || 1;
        const values = obs.values || [];
        if (values.length === 0) return { ok: false, error: "No observation values provided." };

        const n = values.length;
        const xBar = mean(values);
        const sampleVar = n > 1 ? variance(values, xBar) : 1;
        const tauData = n / sampleVar;

        const tauPost = tau0 + tauData;
        const muPost = (tau0 * mu0 + tauData * xBar) / tauPost;
        const sigmaPost = Math.sqrt(1 / tauPost);

        const ciLow = muPost - 1.96 * sigmaPost;
        const ciHigh = muPost + 1.96 * sigmaPost;

        artifact.data.posterior = { distribution: "normal", mean: muPost, precision: tauPost };

        const result = {
          prior: { distribution: "Normal", mean: rd(mu0), precision: rd(tau0), stdDev: rd(Math.sqrt(1 / tau0)) },
          data: { sampleMean: rd(xBar), sampleVariance: rd(sampleVar), n },
          posterior: { distribution: "Normal", mean: rd(muPost), precision: rd(tauPost), stdDev: rd(sigmaPost) },
          credibleInterval: { level: "95%", lower: rd(ciLow), upper: rd(ciHigh) },
          weightOfPrior: rd(tau0 / tauPost * 100) + "%",
          weightOfData: rd(tauData / tauPost * 100) + "%",
        };
        recordAnalysis(ctx, "bayesianInference", "Bayesian (Normal-Normal)", result);
        return { ok: true, result };
      }

      return { ok: false, error: `Unsupported prior distribution: ${prior.distribution}. Use "beta" or "normal".` };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * powerAnalysis — solve for sample size, power, or detectable effect.
   */
  registerLensAction("hypothesis", "powerAnalysis", (ctx, artifact, params) => {
    try {
      const solve = params.solve || "sampleSize";
      const alpha = params.alpha || 0.05;

      if (solve === "sampleSize") {
        const power = params.power || 0.8;
        const d = params.effectSize || 0.5;
        if (d <= 0) return { ok: false, error: "effectSize must be > 0." };

        const zAlpha = normInv(1 - alpha / 2);
        const zBeta = normInv(power);
        const n = Math.ceil(Math.pow((zAlpha + zBeta) / d, 2));

        const result = {
          solve: "sampleSize", requiredN: n, perGroup: n,
          totalForTwoGroups: n * 2,
          effectSize: d, alpha, power,
          effectMagnitude: effectMag(d),
        };
        recordAnalysis(ctx, "powerAnalysis", "Power: sample size", result);
        return { ok: true, result };
      }

      if (solve === "power") {
        const n = params.sampleSize || 100;
        const d = params.effectSize || 0.5;
        const zAlpha = normInv(1 - alpha / 2);
        const nonCentrality = d * Math.sqrt(n);
        const power = 1 - normCDF(zAlpha - nonCentrality);

        const result = {
          solve: "power", power: rd(power), powerPercent: rd(power * 100) + "%",
          sampleSize: n, effectSize: d, alpha,
          adequate: power >= 0.8,
          recommendation: power < 0.8 ? `Need ~${Math.ceil(Math.pow((normInv(1 - alpha / 2) + normInv(0.8)) / d, 2))} per group for 80% power` : "Adequate power",
        };
        recordAnalysis(ctx, "powerAnalysis", "Power: achieved power", result);
        return { ok: true, result };
      }

      if (solve === "effectSize") {
        const n = params.sampleSize || 100;
        const power = params.power || 0.8;
        const zAlpha = normInv(1 - alpha / 2);
        const zBeta = normInv(power);
        const d = (zAlpha + zBeta) / Math.sqrt(n);

        const result = {
          solve: "effectSize", minimumDetectableEffect: rd(d),
          effectMagnitude: effectMag(d),
          sampleSize: n, alpha, power,
        };
        recordAnalysis(ctx, "powerAnalysis", "Power: detectable effect", result);
        return { ok: true, result };
      }

      return { ok: false, error: `Unknown solve target "${solve}". Use: sampleSize, power, effectSize.` };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ===========================================================================
  // Full test battery — t-tests
  // ===========================================================================

  /**
   * tTest — Student's / Welch's / paired t-test on raw sample arrays.
   * params.sample1, params.sample2 (arrays of numbers)
   * params.populationMean (one-sample H₀ mean, default 0)
   * params.kind: "one-sample" | "two-sample" | "welch" | "paired" (auto-detected)
   * params.alpha (default 0.05), params.alternative: "two-sided"|"greater"|"less"
   */
  registerLensAction("hypothesis", "tTest", (ctx, artifact, params) => {
    try {
      const src = params || {};
      const s1 = toNumbers(src.sample1 || artifact.data?.sample1);
      const s2 = toNumbers(src.sample2 || artifact.data?.sample2);
      if (s1.length < 2) return { ok: false, error: "sample1 needs at least 2 numeric values." };

      const alpha = src.alpha || 0.05;
      const alt = src.alternative || "two-sided";
      let kind = src.kind;
      if (!kind) kind = s2.length === 0 ? "one-sample" : (src.paired ? "paired" : "welch");

      let t, df, se, effectSize, mDiff;

      if (kind === "one-sample") {
        const mu0 = src.populationMean ?? artifact.data?.populationMean ?? 0;
        const m1 = mean(s1);
        const v1 = variance(s1, m1);
        se = Math.sqrt(v1 / s1.length);
        t = se > 0 ? (m1 - mu0) / se : 0;
        df = s1.length - 1;
        mDiff = m1 - mu0;
        effectSize = Math.sqrt(v1) > 0 ? Math.abs(mDiff) / Math.sqrt(v1) : 0;
      } else if (kind === "paired") {
        if (s2.length !== s1.length) return { ok: false, error: "Paired t-test requires equal-length samples." };
        const diffs = s1.map((v, i) => v - s2[i]);
        const md = mean(diffs);
        const vd = variance(diffs, md);
        se = Math.sqrt(vd / diffs.length);
        t = se > 0 ? md / se : 0;
        df = diffs.length - 1;
        mDiff = md;
        effectSize = Math.sqrt(vd) > 0 ? Math.abs(md) / Math.sqrt(vd) : 0;
      } else {
        if (s2.length < 2) return { ok: false, error: "Two-sample t-test needs at least 2 values in sample2." };
        const m1 = mean(s1), m2 = mean(s2);
        const v1 = variance(s1, m1), v2 = variance(s2, m2);
        const n1 = s1.length, n2 = s2.length;
        mDiff = m1 - m2;
        if (kind === "two-sample") {
          // Pooled (equal-variance) Student's t
          const pooledVar = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2);
          se = Math.sqrt(pooledVar * (1 / n1 + 1 / n2));
          df = n1 + n2 - 2;
          effectSize = pooledVar > 0 ? Math.abs(mDiff) / Math.sqrt(pooledVar) : 0;
        } else {
          // Welch's unequal-variance t
          se = Math.sqrt(v1 / n1 + v2 / n2);
          const num = Math.pow(v1 / n1 + v2 / n2, 2);
          const den = Math.pow(v1 / n1, 2) / (n1 - 1) + Math.pow(v2 / n2, 2) / (n2 - 1);
          df = den > 0 ? num / den : n1 + n2 - 2;
          const pooledSD = Math.sqrt((v1 + v2) / 2);
          effectSize = pooledSD > 0 ? Math.abs(mDiff) / pooledSD : 0;
        }
        t = se > 0 ? mDiff / se : 0;
      }

      let pValue;
      if (alt === "greater") pValue = tDistRightTail(t, df);
      else if (alt === "less") pValue = 1 - tDistRightTail(t, df);
      else pValue = tDistTwoTailed(t, df);

      const reject = pValue < alpha;
      // CI for the mean difference using a t critical value
      const tCrit = (() => {
        // invert two-tailed t via bisection on the survival function
        let lo = 0, hi = 1000;
        const target = alt === "two-sided" ? 1 - alpha : 1 - 2 * alpha;
        for (let i = 0; i < 100; i++) {
          const mid = (lo + hi) / 2;
          const covered = 1 - tDistTwoTailed(mid, df);
          if (covered < target) lo = mid; else hi = mid;
        }
        return (lo + hi) / 2;
      })();
      const ciLow = mDiff - tCrit * se;
      const ciHigh = mDiff + tCrit * se;

      const result = {
        testType: kind,
        alternative: alt, alpha,
        tStatistic: rd(t), degreesOfFreedom: rd(df),
        pValue: rd(pValue), criticalValue: rd(tCrit),
        meanDifference: rd(mDiff),
        standardError: rd(se),
        reject,
        conclusion: reject
          ? `Reject H₀ at α=${alpha} (p=${rd(pValue)} < ${alpha})`
          : `Fail to reject H₀ at α=${alpha} (p=${rd(pValue)} ≥ ${alpha})`,
        confidenceInterval: { level: 1 - alpha, lower: rd(ciLow), upper: rd(ciHigh) },
        effectSize: rd(effectSize),
        effectMagnitude: effectMag(effectSize),
        n1: s1.length, n2: s2.length || null,
      };
      recordAnalysis(ctx, "tTest", `${kind} t-test`, result);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ===========================================================================
  // Full test battery — one-way ANOVA
  // ===========================================================================

  /**
   * anova — one-way ANOVA across 2+ groups.
   * params.groups: [{ label?, values: number[] }, ...] OR array of number[]
   * params.alpha (default 0.05)
   */
  registerLensAction("hypothesis", "anova", (ctx, artifact, params) => {
    try {
      const raw = params.groups || artifact.data?.groups;
      if (!Array.isArray(raw) || raw.length < 2) {
        return { ok: false, error: "anova requires at least 2 groups." };
      }
      const groups = raw.map((g, i) => {
        const values = toNumbers(Array.isArray(g) ? g : g.values);
        return { label: (g && g.label) || `Group ${i + 1}`, values };
      }).filter(g => g.values.length > 0);
      if (groups.length < 2) return { ok: false, error: "Need at least 2 non-empty groups." };

      const alpha = params.alpha || 0.05;
      const allValues = groups.flatMap(g => g.values);
      const N = allValues.length;
      const k = groups.length;
      if (N <= k) return { ok: false, error: "Total observations must exceed group count." };

      const grandMean = mean(allValues);
      let ssBetween = 0, ssWithin = 0;
      const groupStats = groups.map(g => {
        const gm = mean(g.values);
        ssBetween += g.values.length * Math.pow(gm - grandMean, 2);
        const sw = g.values.reduce((s, v) => s + Math.pow(v - gm, 2), 0);
        ssWithin += sw;
        return { label: g.label, n: g.values.length, mean: rd(gm), variance: rd(variance(g.values, gm)) };
      });
      const ssTotal = ssBetween + ssWithin;

      const dfBetween = k - 1;
      const dfWithin = N - k;
      const msBetween = ssBetween / dfBetween;
      const msWithin = ssWithin / dfWithin;
      const F = msWithin > 0 ? msBetween / msWithin : Infinity;
      const pValue = fDistPValue(F, dfBetween, dfWithin);
      const reject = pValue < alpha;

      // Effect sizes: eta-squared and omega-squared
      const etaSquared = ssTotal > 0 ? ssBetween / ssTotal : 0;
      const omegaSquared = (ssTotal + msWithin) > 0
        ? (ssBetween - dfBetween * msWithin) / (ssTotal + msWithin) : 0;

      const result = {
        groups: groupStats,
        grandMean: rd(grandMean),
        sumOfSquares: { between: rd(ssBetween), within: rd(ssWithin), total: rd(ssTotal) },
        degreesOfFreedom: { between: dfBetween, within: dfWithin, total: N - 1 },
        meanSquares: { between: rd(msBetween), within: rd(msWithin) },
        fStatistic: rd(F),
        pValue: rd(pValue), alpha,
        reject,
        conclusion: reject
          ? `Reject H₀ — at least one group mean differs (F(${dfBetween},${dfWithin})=${rd(F)}, p=${rd(pValue)})`
          : `Fail to reject H₀ — no significant difference among group means (p=${rd(pValue)})`,
        etaSquared: rd(etaSquared),
        omegaSquared: rd(Math.max(0, omegaSquared)),
        effectMagnitude: etaSquared < 0.01 ? "negligible" : etaSquared < 0.06 ? "small" : etaSquared < 0.14 ? "medium" : "large",
      };
      recordAnalysis(ctx, "anova", `One-way ANOVA (${k} groups)`, result);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ===========================================================================
  // Full test battery — chi-square
  // ===========================================================================

  /**
   * chiSquare — goodness-of-fit OR test of independence.
   * Goodness-of-fit: params.observed = number[], params.expected = number[] (optional, defaults uniform)
   * Independence:    params.table = number[][] (contingency table)
   * params.alpha (default 0.05)
   */
  registerLensAction("hypothesis", "chiSquare", (ctx, artifact, params) => {
    try {
      const alpha = params.alpha || 0.05;
      const table = params.table || artifact.data?.table;

      if (Array.isArray(table) && Array.isArray(table[0])) {
        // Test of independence on a contingency table
        const rows = table.map(r => toNumbers(r));
        const nRows = rows.length;
        const nCols = rows[0].length;
        if (nRows < 2 || nCols < 2) return { ok: false, error: "Contingency table needs at least 2 rows and 2 columns." };
        if (rows.some(r => r.length !== nCols)) return { ok: false, error: "All rows must have equal length." };

        const rowTotals = rows.map(r => r.reduce((s, v) => s + v, 0));
        const colTotals = [];
        for (let c = 0; c < nCols; c++) colTotals[c] = rows.reduce((s, r) => s + r[c], 0);
        const grand = rowTotals.reduce((s, v) => s + v, 0);
        if (grand <= 0) return { ok: false, error: "Contingency table totals to zero." };

        let chi2 = 0;
        const expectedTable = [];
        for (let r = 0; r < nRows; r++) {
          expectedTable[r] = [];
          for (let c = 0; c < nCols; c++) {
            const exp = (rowTotals[r] * colTotals[c]) / grand;
            expectedTable[r][c] = rd(exp);
            if (exp > 0) chi2 += Math.pow(rows[r][c] - exp, 2) / exp;
          }
        }
        const df = (nRows - 1) * (nCols - 1);
        const pValue = chiSquarePValue(chi2, df);
        const reject = pValue < alpha;

        // Cramér's V effect size
        const cramersV = grand > 0 ? Math.sqrt(chi2 / (grand * Math.min(nRows - 1, nCols - 1))) : 0;

        const result = {
          testType: "independence",
          chiSquare: rd(chi2), degreesOfFreedom: df,
          pValue: rd(pValue), alpha,
          reject,
          observed: rows, expected: expectedTable,
          conclusion: reject
            ? `Reject H₀ — variables are associated (χ²(${df})=${rd(chi2)}, p=${rd(pValue)})`
            : `Fail to reject H₀ — no significant association (p=${rd(pValue)})`,
          cramersV: rd(cramersV),
          effectMagnitude: cramersV < 0.1 ? "negligible" : cramersV < 0.3 ? "small" : cramersV < 0.5 ? "medium" : "large",
          minExpected: rd(Math.min(...expectedTable.flat())),
          expectedCellWarning: Math.min(...expectedTable.flat()) < 5
            ? "At least one expected cell < 5 — chi-square approximation may be unreliable." : null,
        };
        recordAnalysis(ctx, "chiSquare", "Chi-square (independence)", result);
        return { ok: true, result };
      }

      // Goodness-of-fit
      const observed = toNumbers(params.observed || artifact.data?.observed);
      if (observed.length < 2) return { ok: false, error: "Provide an observed[] array (≥2) or a 2D table." };
      let expected = toNumbers(params.expected);
      const totalObs = observed.reduce((s, v) => s + v, 0);
      if (expected.length === 0) {
        // default: uniform expectation
        expected = observed.map(() => totalObs / observed.length);
      } else if (expected.length !== observed.length) {
        return { ok: false, error: "observed and expected must have equal length." };
      } else {
        // if expected are probabilities, scale to counts
        const expTotal = expected.reduce((s, v) => s + v, 0);
        if (Math.abs(expTotal - 1) < 1e-6) expected = expected.map(p => p * totalObs);
      }

      let chi2 = 0;
      for (let i = 0; i < observed.length; i++) {
        if (expected[i] > 0) chi2 += Math.pow(observed[i] - expected[i], 2) / expected[i];
      }
      const df = observed.length - 1;
      const pValue = chiSquarePValue(chi2, df);
      const reject = pValue < alpha;

      const result = {
        testType: "goodness-of-fit",
        chiSquare: rd(chi2), degreesOfFreedom: df,
        pValue: rd(pValue), alpha,
        reject,
        observed, expected: expected.map(rd),
        conclusion: reject
          ? `Reject H₀ — observed distribution differs from expected (χ²(${df})=${rd(chi2)}, p=${rd(pValue)})`
          : `Fail to reject H₀ — observed fits expected distribution (p=${rd(pValue)})`,
        minExpected: rd(Math.min(...expected)),
        expectedCellWarning: Math.min(...expected) < 5
          ? "At least one expected count < 5 — chi-square approximation may be unreliable." : null,
      };
      recordAnalysis(ctx, "chiSquare", "Chi-square (goodness-of-fit)", result);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ===========================================================================
  // Full test battery — correlation
  // ===========================================================================

  /**
   * correlation — Pearson and Spearman correlation with significance test.
   * params.x, params.y (equal-length numeric arrays)
   * params.alpha (default 0.05)
   */
  registerLensAction("hypothesis", "correlation", (ctx, artifact, params) => {
    try {
      const x = toNumbers(params.x || artifact.data?.x);
      const y = toNumbers(params.y || artifact.data?.y);
      if (x.length < 3 || y.length < 3) return { ok: false, error: "Need at least 3 paired numeric values." };
      if (x.length !== y.length) return { ok: false, error: "x and y must be equal length." };

      const alpha = params.alpha || 0.05;
      const n = x.length;

      // Pearson r
      const mx = mean(x), my = mean(y);
      let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < n; i++) {
        sxy += (x[i] - mx) * (y[i] - my);
        sxx += (x[i] - mx) * (x[i] - mx);
        syy += (y[i] - my) * (y[i] - my);
      }
      const pearson = (sxx > 0 && syy > 0) ? sxy / Math.sqrt(sxx * syy) : 0;

      // Spearman rho via rank transform (average ties)
      const rank = (arr) => {
        const idx = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
        const ranks = new Array(arr.length);
        let i = 0;
        while (i < idx.length) {
          let j = i;
          while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
          const avg = (i + j) / 2 + 1;
          for (let k = i; k <= j; k++) ranks[idx[k].i] = avg;
          i = j + 1;
        }
        return ranks;
      };
      const rx = rank(x), ry = rank(y);
      const mrx = mean(rx), mry = mean(ry);
      let rxy = 0, rxx = 0, ryy = 0;
      for (let i = 0; i < n; i++) {
        rxy += (rx[i] - mrx) * (ry[i] - mry);
        rxx += (rx[i] - mrx) * (rx[i] - mrx);
        ryy += (ry[i] - mry) * (ry[i] - mry);
      }
      const spearman = (rxx > 0 && ryy > 0) ? rxy / Math.sqrt(rxx * ryy) : 0;

      // Significance test for Pearson r (t with n-2 df)
      const df = n - 2;
      const tStat = Math.abs(pearson) < 1
        ? pearson * Math.sqrt(df / (1 - pearson * pearson))
        : (pearson > 0 ? Infinity : -Infinity);
      const pValue = tDistTwoTailed(tStat, df);
      const reject = pValue < alpha;

      // Fisher z confidence interval for Pearson r
      let ciLow = null, ciHigh = null;
      if (Math.abs(pearson) < 1 && n > 3) {
        const z = 0.5 * Math.log((1 + pearson) / (1 - pearson));
        const seZ = 1 / Math.sqrt(n - 3);
        const zCrit = normInv(1 - alpha / 2);
        const lo = z - zCrit * seZ, hi = z + zCrit * seZ;
        ciLow = (Math.exp(2 * lo) - 1) / (Math.exp(2 * lo) + 1);
        ciHigh = (Math.exp(2 * hi) - 1) / (Math.exp(2 * hi) + 1);
      }

      const strength = (r) => {
        const a = Math.abs(r);
        return a < 0.1 ? "negligible" : a < 0.3 ? "weak" : a < 0.5 ? "moderate" : a < 0.7 ? "strong" : "very strong";
      };

      const result = {
        n,
        pearson: rd(pearson),
        spearman: rd(spearman),
        rSquared: rd(pearson * pearson),
        tStatistic: rd(tStat),
        degreesOfFreedom: df,
        pValue: rd(pValue), alpha,
        reject,
        direction: pearson > 0 ? "positive" : pearson < 0 ? "negative" : "none",
        strength: strength(pearson),
        confidenceInterval: ciLow !== null ? { level: 1 - alpha, lower: rd(ciLow), upper: rd(ciHigh) } : null,
        scatter: x.map((xv, i) => ({ x: xv, y: y[i] })),
        conclusion: reject
          ? `Significant ${strength(pearson)} ${pearson > 0 ? "positive" : "negative"} correlation (r=${rd(pearson)}, p=${rd(pValue)})`
          : `No significant correlation (r=${rd(pearson)}, p=${rd(pValue)})`,
      };
      recordAnalysis(ctx, "correlation", "Correlation analysis", result);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ===========================================================================
  // Full test battery — simple linear regression (OLS)
  // ===========================================================================

  /**
   * regression — ordinary least squares simple linear regression.
   * params.x, params.y (equal-length numeric arrays)
   * params.alpha (default 0.05)
   */
  registerLensAction("hypothesis", "regression", (ctx, artifact, params) => {
    try {
      const x = toNumbers(params.x || artifact.data?.x);
      const y = toNumbers(params.y || artifact.data?.y);
      if (x.length < 3 || y.length < 3) return { ok: false, error: "Need at least 3 paired numeric values." };
      if (x.length !== y.length) return { ok: false, error: "x and y must be equal length." };

      const alpha = params.alpha || 0.05;
      const n = x.length;
      const mx = mean(x), my = mean(y);

      let sxx = 0, sxy = 0, syy = 0;
      for (let i = 0; i < n; i++) {
        sxx += (x[i] - mx) * (x[i] - mx);
        sxy += (x[i] - mx) * (y[i] - my);
        syy += (y[i] - my) * (y[i] - my);
      }
      if (sxx === 0) return { ok: false, error: "x has zero variance — cannot fit a regression line." };

      const slope = sxy / sxx;
      const intercept = my - slope * mx;

      // Residuals + sums of squares
      const fitted = x.map(xv => intercept + slope * xv);
      const residuals = y.map((yv, i) => yv - fitted[i]);
      const ssResidual = residuals.reduce((s, r) => s + r * r, 0);
      const ssRegression = syy - ssResidual;
      const rSquared = syy > 0 ? ssRegression / syy : 0;
      const adjRSquared = n > 2 ? 1 - (1 - rSquared) * (n - 1) / (n - 2) : rSquared;

      const df = n - 2;
      const mse = ssResidual / df;
      const residualSE = Math.sqrt(mse);
      const slopeSE = Math.sqrt(mse / sxx);
      const interceptSE = Math.sqrt(mse * (1 / n + (mx * mx) / sxx));

      // A perfect fit (zero residual variance) gives a degenerate SE of 0;
      // the slope is then infinitely precise — treat the t-statistic as
      // infinite (p → 0) rather than collapsing it to 0.
      const tSlope = slopeSE > 0 ? slope / slopeSE
        : (slope !== 0 ? (slope > 0 ? Infinity : -Infinity) : 0);
      const tIntercept = interceptSE > 0 ? intercept / interceptSE
        : (intercept !== 0 ? (intercept > 0 ? Infinity : -Infinity) : 0);
      const pSlope = tDistTwoTailed(tSlope, df);
      const pIntercept = tDistTwoTailed(tIntercept, df);

      // Overall F test
      const fStat = mse > 0 ? ssRegression / mse : Infinity;
      const fPValue = fDistPValue(fStat, 1, df);

      // t critical for slope CI
      const tCrit = (() => {
        let lo = 0, hi = 1000;
        for (let i = 0; i < 100; i++) {
          const mid = (lo + hi) / 2;
          if (1 - tDistTwoTailed(mid, df) < 1 - alpha) lo = mid; else hi = mid;
        }
        return (lo + hi) / 2;
      })();

      const result = {
        n,
        slope: rd(slope),
        intercept: rd(intercept),
        equation: `y = ${rd(intercept)} ${slope >= 0 ? "+" : "-"} ${rd(Math.abs(slope))}·x`,
        rSquared: rd(rSquared),
        adjustedRSquared: rd(adjRSquared),
        correlation: rd(Math.sign(slope) * Math.sqrt(Math.max(0, rSquared))),
        residualStandardError: rd(residualSE),
        slopeStdError: rd(slopeSE),
        interceptStdError: rd(interceptSE),
        slopeTStatistic: rd(tSlope),
        slopePValue: rd(pSlope),
        interceptTStatistic: rd(tIntercept),
        interceptPValue: rd(pIntercept),
        slopeConfidenceInterval: { level: 1 - alpha, lower: rd(slope - tCrit * slopeSE), upper: rd(slope + tCrit * slopeSE) },
        fStatistic: rd(fStat),
        fPValue: rd(fPValue),
        degreesOfFreedom: df,
        significant: pSlope < alpha,
        sumOfSquares: { regression: rd(ssRegression), residual: rd(ssResidual), total: rd(syy) },
        points: x.map((xv, i) => ({ x: xv, y: y[i], fitted: rd(fitted[i]), residual: rd(residuals[i]) })),
        conclusion: pSlope < alpha
          ? `Significant linear relationship — each unit of x changes y by ${rd(slope)} (p=${rd(pSlope)}, R²=${rd(rSquared)})`
          : `No significant linear relationship (slope p=${rd(pSlope)})`,
      };
      recordAnalysis(ctx, "regression", "Linear regression (OLS)", result);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ===========================================================================
  // Assumption checks — normality + homoscedasticity
  // ===========================================================================

  /**
   * assumptionCheck — pre-test diagnostics on one or more samples.
   * params.sample (number[]) for normality of a single sample
   * params.groups ([{values}]) for homoscedasticity (Levene's test) across groups
   * Runs both whenever the relevant data is present.
   */
  registerLensAction("hypothesis", "assumptionCheck", (ctx, artifact, params) => {
    try {
      const out = { checks: [] };

      // ---- Normality (D'Agostino skewness/kurtosis omnibus on each sample) ----
      function normalityOf(values, label) {
        const n = values.length;
        if (n < 8) {
          return { test: "normality", label, n, ok: null,
            note: "Need at least 8 observations for a reliable normality test." };
        }
        const m = mean(values);
        const s2 = values.reduce((s, v) => s + (v - m) * (v - m), 0) / n;
        const sd = Math.sqrt(s2);
        if (sd === 0) return { test: "normality", label, n, ok: false, note: "Zero variance — degenerate." };

        // Sample skewness (g1) and excess kurtosis (g2)
        let m3 = 0, m4 = 0;
        for (const v of values) { const d = (v - m) / sd; m3 += d ** 3; m4 += d ** 4; }
        const g1 = m3 / n;
        const g2 = m4 / n - 3;

        // D'Agostino skewness Z
        const Y = g1 * Math.sqrt(((n + 1) * (n + 3)) / (6 * (n - 2)));
        const beta2 = (3 * (n * n + 27 * n - 70) * (n + 1) * (n + 3)) /
          ((n - 2) * (n + 5) * (n + 7) * (n + 9));
        const W2 = -1 + Math.sqrt(2 * (beta2 - 1));
        const delta = 1 / Math.sqrt(0.5 * Math.log(W2));
        const aSk = Math.sqrt(2 / (W2 - 1));
        const Zskew = delta * Math.log(Y / aSk + Math.sqrt((Y / aSk) ** 2 + 1));

        // Anscombe-Glynn kurtosis Z
        const eK = (3 * (n - 1)) / (n + 1);
        const varK = (24 * n * (n - 2) * (n - 3)) / ((n + 1) ** 2 * (n + 3) * (n + 5));
        const xK = (g2 + 3 - eK) / Math.sqrt(varK);
        const sqrtBeta1 = (6 * (n * n - 5 * n + 2)) / ((n + 7) * (n + 9)) *
          Math.sqrt((6 * (n + 3) * (n + 5)) / (n * (n - 2) * (n - 3)));
        const A = 6 + (8 / sqrtBeta1) * (2 / sqrtBeta1 + Math.sqrt(1 + 4 / (sqrtBeta1 * sqrtBeta1)));
        const term = (1 - 2 / A) / (1 + xK * Math.sqrt(2 / (A - 4)));
        const Zkurt = ((1 - 2 / (9 * A)) - Math.cbrt(term)) / Math.sqrt(2 / (9 * A));

        // Omnibus K² ~ chi-square with 2 df
        const k2 = Zskew * Zskew + Zkurt * Zkurt;
        const pValue = chiSquarePValue(k2, 2);
        const normal = pValue >= 0.05;
        return {
          test: "normality", label, n,
          skewness: rd(g1), excessKurtosis: rd(g2),
          omnibusK2: rd(k2), pValue: rd(pValue),
          ok: normal,
          conclusion: normal
            ? `Sample is consistent with normality (K²=${rd(k2)}, p=${rd(pValue)})`
            : `Sample deviates from normality (K²=${rd(k2)}, p=${rd(pValue)}) — consider a non-parametric test.`,
        };
      }

      const single = toNumbers(params.sample || artifact.data?.sample);
      const groupsRaw = params.groups || artifact.data?.groups;

      if (single.length > 0) out.checks.push(normalityOf(single, "sample"));

      if (Array.isArray(groupsRaw) && groupsRaw.length >= 2) {
        const groups = groupsRaw.map((g, i) => ({
          label: (g && g.label) || `Group ${i + 1}`,
          values: toNumbers(Array.isArray(g) ? g : g.values),
        })).filter(g => g.values.length >= 2);

        // Per-group normality
        for (const g of groups) out.checks.push(normalityOf(g.values, g.label));

        // Levene's test for homogeneity of variance (Brown-Forsythe, median-centred)
        if (groups.length >= 2) {
          const k = groups.length;
          const N = groups.reduce((s, g) => s + g.values.length, 0);
          if (N > k) {
            const median = (arr) => {
              const a = [...arr].sort((p, q) => p - q);
              const mid = Math.floor(a.length / 2);
              return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
            };
            const z = groups.map(g => {
              const med = median(g.values);
              return g.values.map(v => Math.abs(v - med));
            });
            const zMeans = z.map(mean);
            const zGrand = mean(z.flat());
            let numer = 0, denom = 0;
            z.forEach((zi, i) => {
              numer += zi.length * Math.pow(zMeans[i] - zGrand, 2);
              for (const v of zi) denom += Math.pow(v - zMeans[i], 2);
            });
            const W = denom > 0 ? ((N - k) / (k - 1)) * (numer / denom) : 0;
            const pValue = fDistPValue(W, k - 1, N - k);
            const equalVar = pValue >= 0.05;
            out.checks.push({
              test: "homoscedasticity", method: "Levene (Brown-Forsythe)",
              statistic: rd(W), pValue: rd(pValue),
              degreesOfFreedom: { between: k - 1, within: N - k },
              ok: equalVar,
              conclusion: equalVar
                ? `Group variances are homogeneous (W=${rd(W)}, p=${rd(pValue)}) — pooled-variance tests valid.`
                : `Group variances differ (W=${rd(W)}, p=${rd(pValue)}) — prefer Welch's test.`,
            });
          }
        }
      }

      if (out.checks.length === 0) {
        return { ok: false, error: "Provide a `sample` array and/or a `groups` array to check assumptions." };
      }
      out.allPassed = out.checks.every(c => c.ok !== false);
      out.recommendation = out.allPassed
        ? "Assumptions satisfied — parametric tests (t-test, ANOVA) are appropriate."
        : "One or more assumptions violated — consider non-parametric alternatives or Welch corrections.";
      recordAnalysis(ctx, "assumptionCheck", "Assumption diagnostics", out);
      return { ok: true, result: out };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ===========================================================================
  // Multiple-comparison correction
  // ===========================================================================

  /**
   * multipleComparison — adjust a family of p-values.
   * params.pValues: number[]  (raw p-values)
   * params.labels: string[]   (optional, names per test)
   * params.method: "bonferroni" | "holm" | "fdr" (Benjamini-Hochberg) | "all"
   * params.alpha (default 0.05)
   */
  registerLensAction("hypothesis", "multipleComparison", (ctx, artifact, params) => {
    try {
      const pValues = toNumbers(params.pValues || artifact.data?.pValues);
      if (pValues.length < 2) return { ok: false, error: "Provide at least 2 p-values." };
      if (pValues.some(p => p < 0 || p > 1)) return { ok: false, error: "p-values must be within [0, 1]." };

      const alpha = params.alpha || 0.05;
      const method = params.method || "all";
      const labels = Array.isArray(params.labels) && params.labels.length === pValues.length
        ? params.labels : pValues.map((_, i) => `Test ${i + 1}`);
      const m = pValues.length;

      const bonferroni = pValues.map(p => Math.min(1, p * m));

      // Holm step-down
      const ascByP = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
      const holm = new Array(m);
      let runningMax = 0;
      ascByP.forEach((e, rank) => {
        const adj = Math.min(1, (m - rank) * e.p);
        runningMax = Math.max(runningMax, adj);
        holm[e.i] = runningMax;
      });

      // Benjamini-Hochberg FDR step-up
      const descByP = pValues.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p);
      const fdr = new Array(m);
      let runningMin = 1;
      descByP.forEach((e, idx) => {
        const rank = m - idx; // 1-based rank from largest
        const adj = Math.min(1, (e.p * m) / rank);
        runningMin = Math.min(runningMin, adj);
        fdr[e.i] = runningMin;
      });

      const tests = pValues.map((p, i) => ({
        label: labels[i],
        rawP: rd(p),
        bonferroniP: rd(bonferroni[i]),
        bonferroniReject: bonferroni[i] < alpha,
        holmP: rd(holm[i]),
        holmReject: holm[i] < alpha,
        fdrP: rd(fdr[i]),
        fdrReject: fdr[i] < alpha,
      }));

      const summary = {
        familySize: m,
        alpha,
        bonferroniThreshold: rd(alpha / m),
        rawSignificant: pValues.filter(p => p < alpha).length,
        bonferroniSignificant: bonferroni.filter(p => p < alpha).length,
        holmSignificant: holm.filter(p => p < alpha).length,
        fdrSignificant: fdr.filter(p => p < alpha).length,
      };

      const result = {
        method: method === "all" ? ["bonferroni", "holm", "fdr"] : method,
        tests, summary,
        recommendation: `${summary.rawSignificant} of ${m} tests significant uncorrected; ` +
          `${summary.fdrSignificant} survive FDR control, ${summary.bonferroniSignificant} survive Bonferroni.`,
      };
      recordAnalysis(ctx, "multipleComparison", `Multiple-comparison correction (${m} tests)`, result);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ===========================================================================
  // Dataset import + management
  // ===========================================================================

  /**
   * datasetImport — parse a CSV/TSV blob into a typed, queryable dataset.
   * params.name, params.csv (string), params.delimiter (default auto), params.hasHeader (default true)
   */
  registerLensAction("hypothesis", "datasetImport", (ctx, artifact, params) => {
    try {
      const name = (params.name || artifact.data?.name || "").trim();
      const csv = params.csv || artifact.data?.csv;
      if (!name) return { ok: false, error: "Dataset name is required." };
      if (typeof csv !== "string" || !csv.trim()) return { ok: false, error: "csv text is required." };

      const lines = csv.replace(/\r\n/g, "\n").split("\n").filter(l => l.trim().length > 0);
      if (lines.length === 0) return { ok: false, error: "csv contains no rows." };

      let delim = params.delimiter;
      if (!delim) {
        const head = lines[0];
        delim = (head.split("\t").length > head.split(",").length) ? "\t"
          : (head.split(";").length > head.split(",").length) ? ";" : ",";
      }
      const splitRow = (line) => line.split(delim).map(c => c.trim().replace(/^"|"$/g, ""));

      const hasHeader = params.hasHeader !== false;
      const firstRow = splitRow(lines[0]);
      const columnNames = hasHeader ? firstRow : firstRow.map((_, i) => `col${i + 1}`);
      const dataRows = (hasHeader ? lines.slice(1) : lines).map(splitRow);

      // Build columns, infer numeric vs categorical
      const columns = columnNames.map((cName, ci) => {
        const cells = dataRows.map(r => (r[ci] !== undefined ? r[ci] : ""));
        const numericCells = cells.map(Number);
        const numericCount = numericCells.filter((v, i) => Number.isFinite(v) && cells[i] !== "").length;
        const nonEmpty = cells.filter(c => c !== "").length;
        const isNumeric = nonEmpty > 0 && numericCount / nonEmpty >= 0.9;
        const col = { name: cName, type: isNumeric ? "numeric" : "categorical", values: isNumeric ? numericCells : cells };
        if (isNumeric) {
          const nums = numericCells.filter(Number.isFinite);
          if (nums.length > 0) {
            const m = mean(nums);
            col.stats = {
              count: nums.length, mean: rd(m),
              stdDev: rd(Math.sqrt(variance(nums, m))),
              min: rd(Math.min(...nums)), max: rd(Math.max(...nums)),
            };
          }
        } else {
          col.stats = { count: nonEmpty, distinct: new Set(cells.filter(c => c !== "")).size };
        }
        return col;
      });

      const uid = userIdOf(ctx);
      const datasets = bucket(hstate().datasets, uid);
      const id = rid("ds");
      const dataset = {
        id, name,
        rowCount: dataRows.length,
        columnCount: columns.length,
        columns,
        delimiter: delim === "\t" ? "tab" : delim,
        createdAt: new Date().toISOString(),
      };
      datasets.set(id, dataset);

      return {
        ok: true, result: {
          id, name, rowCount: dataRows.length, columnCount: columns.length,
          columns: columns.map(c => ({ name: c.name, type: c.type, stats: c.stats })),
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * datasetList — list the calling user's imported datasets.
   */
  registerLensAction("hypothesis", "datasetList", (ctx, _artifact, _params) => {
    try {
      const uid = userIdOf(ctx);
      const datasets = bucket(hstate().datasets, uid);
      const list = [...datasets.values()].map(d => ({
        id: d.id, name: d.name, rowCount: d.rowCount, columnCount: d.columnCount,
        columns: d.columns.map(c => ({ name: c.name, type: c.type })),
        createdAt: d.createdAt,
      })).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      return { ok: true, result: { datasets: list, count: list.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * datasetGet — fetch a single dataset's columns + values.
   */
  registerLensAction("hypothesis", "datasetGet", (ctx, _artifact, params) => {
    try {
      const uid = userIdOf(ctx);
      const datasets = bucket(hstate().datasets, uid);
      const d = datasets.get(params.id);
      if (!d) return { ok: false, error: "Dataset not found." };
      return { ok: true, result: d };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * datasetDelete — remove an imported dataset.
   */
  registerLensAction("hypothesis", "datasetDelete", (ctx, _artifact, params) => {
    try {
      const uid = userIdOf(ctx);
      const datasets = bucket(hstate().datasets, uid);
      if (!datasets.has(params.id)) return { ok: false, error: "Dataset not found." };
      datasets.delete(params.id);
      return { ok: true, result: { deleted: params.id } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * runTestOnDataset — run a battery test against named columns of a dataset.
   * params.datasetId, params.test ("tTest"|"anova"|"correlation"|"regression"|"chiSquare")
   * params.columns: string[]  (numeric column names for the test)
   * params.groupColumn + params.valueColumn  (for ANOVA grouped by a categorical column)
   * params.alpha
   */
  registerLensAction("hypothesis", "runTestOnDataset", (ctx, artifact, params) => {
    try {
      const uid = userIdOf(ctx);
      const datasets = bucket(hstate().datasets, uid);
      const d = datasets.get(params.datasetId);
      if (!d) return { ok: false, error: "Dataset not found." };

      const colByName = (n) => d.columns.find(c => c.name === n);
      const test = params.test;
      const alpha = params.alpha || 0.05;

      if (test === "anova" && params.groupColumn && params.valueColumn) {
        const gc = colByName(params.groupColumn);
        const vc = colByName(params.valueColumn);
        if (!gc || !vc) return { ok: false, error: "groupColumn/valueColumn not found in dataset." };
        const buckets = new Map();
        gc.values.forEach((g, i) => {
          const v = Number(vc.values[i]);
          if (!Number.isFinite(v) || g === "" || g == null) return;
          const key = String(g);
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(v);
        });
        const groups = [...buckets.entries()].map(([label, values]) => ({ label, values }));
        return runAnovaInline(ctx, groups, alpha);
      }

      const cols = (params.columns || []).map(colByName);
      if (cols.some(c => !c)) return { ok: false, error: "One or more columns not found in dataset." };

      if (test === "tTest") {
        const s1 = toNumbers(cols[0]?.values);
        const s2 = cols[1] ? toNumbers(cols[1].values) : [];
        return dispatchTTest(ctx, { sample1: s1, sample2: s2, alpha, kind: params.kind, alternative: params.alternative });
      }
      if (test === "correlation" || test === "regression") {
        if (cols.length < 2) return { ok: false, error: `${test} needs two numeric columns.` };
        const x = toNumbers(cols[0].values), y = toNumbers(cols[1].values);
        return test === "correlation"
          ? dispatchCorrelation(ctx, { x, y, alpha })
          : dispatchRegression(ctx, { x, y, alpha });
      }
      return { ok: false, error: `Unsupported test "${test}" for runTestOnDataset.` };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ----- inline dispatch helpers (reuse the registered handlers' math) --------
  // Re-enter the already-registered handlers via the local LENS map so a
  // dataset-driven test runs the identical statistics as the direct macro.
  function dispatchTTest(ctx, p) {
    const fn = LENS.get("tTest");
    return fn(ctx, { data: {} }, p);
  }
  function dispatchCorrelation(ctx, p) {
    const fn = LENS.get("correlation");
    return fn(ctx, { data: {} }, p);
  }
  function dispatchRegression(ctx, p) {
    const fn = LENS.get("regression");
    return fn(ctx, { data: {} }, p);
  }
  function runAnovaInline(ctx, groups, alpha) {
    const fn = LENS.get("anova");
    return fn(ctx, { data: {} }, { groups, alpha });
  }

  // dispatch helpers reference these handlers; ensure they exist at call time.
  void LENS;

  // ===========================================================================
  // Hypothesis registry — pre-registration + outcome tracking
  // ===========================================================================

  /**
   * preregister — pre-register a hypothesis with its design before testing.
   * params.statement (required), params.predictedDirection, params.test, params.alpha,
   * params.plannedSampleSize, params.notes
   */
  registerLensAction("hypothesis", "preregister", (ctx, _artifact, params) => {
    try {
      const statement = (params.statement || "").trim();
      if (!statement) return { ok: false, error: "Hypothesis statement is required." };
      const uid = userIdOf(ctx);
      const registry = bucket(hstate().registry, uid);
      const id = rid("preg");
      const record = {
        id, statement,
        nullHypothesis: params.nullHypothesis || `No effect: ${statement} is false.`,
        predictedDirection: params.predictedDirection || "two-sided",
        plannedTest: params.test || null,
        alpha: params.alpha || 0.05,
        plannedSampleSize: Number(params.plannedSampleSize) || null,
        notes: params.notes || "",
        status: "registered",
        outcome: null,
        registeredAt: new Date().toISOString(),
      };
      registry.set(id, record);
      return { ok: true, result: record };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * registryList — list pre-registered hypotheses with status counts.
   */
  registerLensAction("hypothesis", "registryList", (ctx, _artifact, _params) => {
    try {
      const uid = userIdOf(ctx);
      const registry = bucket(hstate().registry, uid);
      const items = [...registry.values()].sort(
        (a, b) => (b.registeredAt || "").localeCompare(a.registeredAt || ""));
      const counts = { registered: 0, confirmed: 0, refuted: 0, inconclusive: 0 };
      for (const r of items) {
        const k = r.status === "resolved"
          ? (r.outcome?.verdict || "inconclusive")
          : "registered";
        if (counts[k] !== undefined) counts[k]++;
      }
      return { ok: true, result: { items, count: items.length, counts } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * recordOutcome — close out a pre-registered hypothesis with a verified result.
   * params.id, params.pValue, params.reject (bool), params.effectSize, params.observedDirection, params.notes
   */
  registerLensAction("hypothesis", "recordOutcome", (ctx, _artifact, params) => {
    try {
      const uid = userIdOf(ctx);
      const registry = bucket(hstate().registry, uid);
      const rec = registry.get(params.id);
      if (!rec) return { ok: false, error: "Pre-registration not found." };

      const reject = params.reject === true || params.reject === "true";
      const pValue = params.pValue != null ? Number(params.pValue) : null;
      let verdict;
      if (!reject) verdict = "refuted";
      else if (rec.predictedDirection !== "two-sided" && params.observedDirection &&
        params.observedDirection !== rec.predictedDirection) verdict = "inconclusive";
      else verdict = "confirmed";

      rec.status = "resolved";
      rec.outcome = {
        verdict,
        reject,
        pValue: pValue != null ? rd(pValue) : null,
        effectSize: params.effectSize != null ? rd(Number(params.effectSize)) : null,
        observedDirection: params.observedDirection || null,
        notes: params.notes || "",
        resolvedAt: new Date().toISOString(),
        predictionConfirmed: verdict === "confirmed",
      };
      return { ok: true, result: rec };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  /**
   * registryDelete — remove a pre-registration.
   */
  registerLensAction("hypothesis", "registryDelete", (ctx, _artifact, params) => {
    try {
      const uid = userIdOf(ctx);
      const registry = bucket(hstate().registry, uid);
      if (!registry.has(params.id)) return { ok: false, error: "Pre-registration not found." };
      registry.delete(params.id);
      return { ok: true, result: { deleted: params.id } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ===========================================================================
  // Analysis history + APA report export
  // ===========================================================================

  /**
   * analysisHistory — list the calling user's saved analysis runs.
   */
  registerLensAction("hypothesis", "analysisHistory", (ctx, _artifact, _params) => {
    try {
      const uid = userIdOf(ctx);
      const analyses = bucket(hstate().analyses, uid);
      const items = [...analyses.values()]
        .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
        .slice(0, 100)
        .map(a => ({ id: a.id, kind: a.kind, summary: a.summary, createdAt: a.createdAt }));
      return { ok: true, result: { items, count: items.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // APA-format a p-value (no leading zero, "< .001" floor)
  function apaP(p) {
    if (p == null || !Number.isFinite(p)) return "p = n/a";
    if (p < 0.001) return "p < .001";
    return "p = " + p.toFixed(3).replace(/^0/, "");
  }
  function apaNum(v, dp = 2) {
    if (v == null || !Number.isFinite(v)) return "n/a";
    return v.toFixed(dp);
  }

  /**
   * apaReport — generate an APA-formatted write-up of a stored or supplied result.
   * Either params.analysisId (a previously stored analysis) OR params.kind + params.result.
   */
  registerLensAction("hypothesis", "apaReport", (ctx, _artifact, params) => {
    try {
      let kind = params.kind;
      let result = params.result;
      if (params.analysisId) {
        const uid = userIdOf(ctx);
        const analyses = bucket(hstate().analyses, uid);
        const rec = analyses.get(params.analysisId);
        if (!rec) return { ok: false, error: "Stored analysis not found." };
        kind = rec.kind; result = rec.result;
      }
      if (!kind || !result) return { ok: false, error: "Provide analysisId, or kind + result." };

      let statSentence = "";
      let title = "Statistical Analysis";

      if (kind === "tTest") {
        title = "Independent/Paired Samples t-Test";
        statSentence = `A ${result.testType} t-test was conducted. ` +
          `The test was ${result.reject ? "" : "not "}statistically significant, ` +
          `t(${apaNum(result.degreesOfFreedom)}) = ${apaNum(result.tStatistic)}, ${apaP(result.pValue)}, ` +
          `d = ${apaNum(result.effectSize)} (${result.effectMagnitude} effect). ` +
          `Mean difference = ${apaNum(result.meanDifference)}, ` +
          `${Math.round((result.confidenceInterval?.level || 0.95) * 100)}% CI ` +
          `[${apaNum(result.confidenceInterval?.lower)}, ${apaNum(result.confidenceInterval?.upper)}].`;
      } else if (kind === "anova") {
        title = "One-Way Analysis of Variance";
        statSentence = `A one-way ANOVA across ${result.groups?.length} groups ` +
          `was ${result.reject ? "" : "not "}significant, ` +
          `F(${result.degreesOfFreedom?.between}, ${result.degreesOfFreedom?.within}) = ` +
          `${apaNum(result.fStatistic)}, ${apaP(result.pValue)}, ` +
          `η² = ${apaNum(result.etaSquared)} (${result.effectMagnitude} effect).`;
      } else if (kind === "chiSquare") {
        title = result.testType === "independence"
          ? "Chi-Square Test of Independence" : "Chi-Square Goodness-of-Fit Test";
        statSentence = `A chi-square test was ${result.reject ? "" : "not "}significant, ` +
          `χ²(${result.degreesOfFreedom}) = ${apaNum(result.chiSquare)}, ${apaP(result.pValue)}` +
          (result.cramersV != null ? `, Cramér's V = ${apaNum(result.cramersV)}` : "") + ".";
      } else if (kind === "correlation") {
        title = "Correlation Analysis";
        statSentence = `A Pearson correlation indicated a ${result.strength} ${result.direction} ` +
          `relationship that was ${result.reject ? "" : "not "}significant, ` +
          `r(${result.degreesOfFreedom}) = ${apaNum(result.pearson)}, ${apaP(result.pValue)}, ` +
          `R² = ${apaNum(result.rSquared)}.`;
      } else if (kind === "regression") {
        title = "Simple Linear Regression";
        statSentence = `A simple linear regression ${result.significant ? "" : "did not "}significantly ` +
          `predict the outcome, F(1, ${result.degreesOfFreedom}) = ${apaNum(result.fStatistic)}, ` +
          `${apaP(result.fPValue)}, R² = ${apaNum(result.rSquared)}. ` +
          `The slope (B = ${apaNum(result.slope)}, SE = ${apaNum(result.slopeStdError)}) ` +
          `was ${result.significant ? "" : "not "}significant (${apaP(result.slopePValue)}).`;
      } else if (kind === "zTest") {
        title = "Z-Test";
        statSentence = `A ${result.testType} z-test was ${result.reject ? "" : "not "}significant, ` +
          `Z = ${apaNum(result.zStatistic)}, ${apaP(result.pValue)}, ` +
          `d = ${apaNum(result.effectSize)} (${result.effectMagnitude} effect).`;
      } else {
        statSentence = `Result for ${kind}: ` + JSON.stringify(result).slice(0, 400);
      }

      const apa = `Results\n\n${statSentence}`;
      return {
        ok: true, result: {
          kind, title, apa,
          statement: statSentence,
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

}
