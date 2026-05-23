// server/domains/fractal.js
// Domain actions for fractal/self-similar pattern analysis: fractal dimension
// computation, self-similarity detection, and structural complexity measurement.

export default function registerFractalActions(registerLensAction) {
  /**
   * fractalDimension
   * Compute fractal dimension using box-counting method for 2D point sets
   * and Hurst exponent for time series.
   * artifact.data.points = [{ x, y }]  (for box-counting)
   * OR artifact.data.values = number[]  (for Hurst exponent)
   * params.method: "box-counting" | "hurst" | "auto" (default: auto)
   */
  registerLensAction("fractal", "fractalDimension", (ctx, artifact, params) => {
  try {
    const points = artifact.data?.points || [];
    const values = artifact.data?.values || [];
    const method = params.method || "auto";
    const r = (v) => Math.round(v * 1e6) / 1e6;

    const useBoxCounting = method === "box-counting" || (method === "auto" && points.length > 0);
    const useHurst = method === "hurst" || (method === "auto" && points.length === 0 && values.length > 0);

    if (!useBoxCounting && !useHurst) {
      return { ok: false, error: "Provide points (for box-counting) or values (for Hurst exponent)." };
    }

    if (useBoxCounting) {
      if (points.length < 3) return { ok: false, error: "Need at least 3 points for box-counting." };

      // Find bounding box
      const xs = points.map(p => p.x);
      const ys = points.map(p => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const rangeX = maxX - minX || 1;
      const rangeY = maxY - minY || 1;
      const maxRange = Math.max(rangeX, rangeY);

      // Box-counting at multiple scales
      const scales = [];
      const logData = [];
      let epsilon = maxRange;
      while (epsilon > maxRange / 256 && epsilon > 0) {
        // Count non-empty boxes
        const boxSet = new Set();
        for (const p of points) {
          const bx = Math.floor((p.x - minX) / epsilon);
          const by = Math.floor((p.y - minY) / epsilon);
          boxSet.add(`${bx},${by}`);
        }
        const count = boxSet.size;
        if (count > 0) {
          scales.push({ epsilon: r(epsilon), boxCount: count });
          logData.push({ logEpsilon: Math.log(1 / epsilon), logCount: Math.log(count) });
        }
        epsilon /= 2;
      }

      // Linear regression on log-log data to get fractal dimension
      if (logData.length < 2) {
        return { ok: false, error: "Not enough scale levels for dimension estimation." };
      }

      const n = logData.length;
      const sumX = logData.reduce((s, d) => s + d.logEpsilon, 0);
      const sumY = logData.reduce((s, d) => s + d.logCount, 0);
      const sumXY = logData.reduce((s, d) => s + d.logEpsilon * d.logCount, 0);
      const sumX2 = logData.reduce((s, d) => s + d.logEpsilon * d.logEpsilon, 0);
      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      const intercept = (sumY - slope * sumX) / n;

      // R-squared
      const yMean = sumY / n;
      const ssRes = logData.reduce((s, d) => s + (d.logCount - (slope * d.logEpsilon + intercept)) ** 2, 0);
      const ssTot = logData.reduce((s, d) => s + (d.logCount - yMean) ** 2, 0);
      const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

      const fractalDim = slope;

      // Classify
      let classification;
      if (fractalDim < 0.5) classification = "sparse point set";
      else if (fractalDim < 1.1) classification = "approximately 1D (line-like)";
      else if (fractalDim < 1.5) classification = "fractal between line and plane";
      else if (fractalDim < 1.9) classification = "fractal approaching plane-filling";
      else classification = "approximately 2D (plane-filling)";

      return {
        ok: true,
        result: {
          method: "box-counting",
          fractalDimension: r(fractalDim),
          rSquared: r(rSquared),
          classification,
          pointCount: points.length,
          scalesAnalyzed: scales.length,
          scales,
          confidence: rSquared > 0.95 ? "high" : rSquared > 0.85 ? "medium" : "low",
        },
      };
    }

    // Hurst exponent via rescaled range (R/S) analysis
    if (values.length < 10) return { ok: false, error: "Need at least 10 values for Hurst exponent." };

    const n = values.length;
    const logData = [];

    // Compute R/S for different sub-series lengths
    const subLengths = [];
    let len = 8;
    while (len <= n) {
      subLengths.push(len);
      len = Math.floor(len * 1.5);
    }
    if (!subLengths.includes(n) && n >= 8) subLengths.push(n);

    for (const m of subLengths) {
      const numBlocks = Math.floor(n / m);
      if (numBlocks === 0) continue;

      let rsSum = 0;
      for (let block = 0; block < numBlocks; block++) {
        const segment = values.slice(block * m, block * m + m);
        const mean = segment.reduce((s, v) => s + v, 0) / m;

        // Cumulative deviations from mean
        const cumDev = [];
        let cumSum = 0;
        for (const v of segment) {
          cumSum += v - mean;
          cumDev.push(cumSum);
        }

        // Range
        const range = Math.max(...cumDev) - Math.min(...cumDev);

        // Standard deviation
        const std = Math.sqrt(segment.reduce((s, v) => s + (v - mean) ** 2, 0) / m);

        // Rescaled range
        const rs = std > 0 ? range / std : 0;
        rsSum += rs;
      }

      const avgRS = rsSum / numBlocks;
      if (avgRS > 0) {
        logData.push({ logN: Math.log(m), logRS: Math.log(avgRS) });
      }
    }

    if (logData.length < 2) {
      return { ok: false, error: "Not enough data for R/S analysis." };
    }

    // Linear regression on log-log data
    const ld = logData.length;
    const sumX = logData.reduce((s, d) => s + d.logN, 0);
    const sumY = logData.reduce((s, d) => s + d.logRS, 0);
    const sumXY = logData.reduce((s, d) => s + d.logN * d.logRS, 0);
    const sumX2 = logData.reduce((s, d) => s + d.logN * d.logN, 0);
    const hurstExponent = (ld * sumXY - sumX * sumY) / (ld * sumX2 - sumX * sumX);

    // R-squared
    const yMean = sumY / ld;
    const intercept = (sumY - hurstExponent * sumX) / ld;
    const ssRes = logData.reduce((s, d) => s + (d.logRS - (hurstExponent * d.logN + intercept)) ** 2, 0);
    const ssTot = logData.reduce((s, d) => s + (d.logRS - yMean) ** 2, 0);
    const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    // Classification
    let behavior;
    if (hurstExponent > 0.55) behavior = "persistent (trending)";
    else if (hurstExponent < 0.45) behavior = "anti-persistent (mean-reverting)";
    else behavior = "random walk";

    // Fractal dimension from Hurst: D = 2 - H
    const fractalDim = 2 - hurstExponent;

    return {
      ok: true,
      result: {
        method: "hurst-exponent",
        hurstExponent: r(hurstExponent),
        fractalDimension: r(fractalDim),
        rSquared: r(rSquared),
        behavior,
        seriesLength: n,
        scalesAnalyzed: logData.length,
        confidence: rSquared > 0.9 ? "high" : rSquared > 0.75 ? "medium" : "low",
        interpretation: {
          "H > 0.5": "Long-term positive autocorrelation (trending)",
          "H = 0.5": "Random walk (no memory)",
          "H < 0.5": "Long-term negative autocorrelation (mean-reverting)",
          current: `H = ${r(hurstExponent)} → ${behavior}`,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * selfSimilarity
   * Detect self-similar patterns at multiple scales — compute scale-invariant
   * features and identify repeating motifs.
   * artifact.data.values = number[] (1D signal)
   * params.minMotifLength (default: 3), params.maxMotifLength (default: auto)
   * params.numScales (default: 4)
   */
  registerLensAction("fractal", "selfSimilarity", (ctx, artifact, _params) => {
  try {
    const values = (artifact.data?.values || []).map(Number).filter(v => !isNaN(v));
    if (values.length < 8) return { ok: false, error: "Need at least 8 data points." };

    const n = values.length;
    const params = _params || {};
    const minMotifLen = params.minMotifLength || 3;
    const maxMotifLen = params.maxMotifLength || Math.min(Math.floor(n / 3), 50);
    const numScales = params.numScales || 4;
    const r = (v) => Math.round(v * 1e6) / 1e6;

    // Normalize the series
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / n) || 1;
    const normalized = values.map(v => (v - mean) / std);

    // Create multi-scale representations (downsample by averaging)
    const scales = [{ scale: 1, data: normalized }];
    let current = normalized;
    for (let s = 2; s <= numScales; s++) {
      const downsampled = [];
      for (let i = 0; i < current.length - 1; i += 2) {
        downsampled.push((current[i] + current[i + 1]) / 2);
      }
      if (downsampled.length >= minMotifLen) {
        scales.push({ scale: s, data: downsampled });
        current = downsampled;
      }
    }

    // Compute Euclidean distance between two subsequences (z-normalized)
    function subseqDistance(series, i, j, len) {
      // Z-normalize both subsequences
      const sub1 = series.slice(i, i + len);
      const sub2 = series.slice(j, j + len);
      const m1 = sub1.reduce((s, v) => s + v, 0) / len;
      const m2 = sub2.reduce((s, v) => s + v, 0) / len;
      const s1 = Math.sqrt(sub1.reduce((s, v) => s + (v - m1) ** 2, 0) / len) || 1;
      const s2 = Math.sqrt(sub2.reduce((s, v) => s + (v - m2) ** 2, 0) / len) || 1;
      let dist = 0;
      for (let k = 0; k < len; k++) {
        const d = (sub1[k] - m1) / s1 - (sub2[k] - m2) / s2;
        dist += d * d;
      }
      return Math.sqrt(dist / len);
    }

    // Find motifs (repeating patterns) at the original scale
    const motifs = [];
    for (let len = minMotifLen; len <= maxMotifLen; len += Math.max(1, Math.floor((maxMotifLen - minMotifLen) / 5))) {
      let bestDist = Infinity;
      let bestI = 0, bestJ = 0;

      // Use a stride to speed up for large series
      const stride = Math.max(1, Math.floor(n / 200));
      for (let i = 0; i < n - len; i += stride) {
        for (let j = i + len; j < n - len; j += stride) {
          const dist = subseqDistance(normalized, i, j, len);
          if (dist < bestDist) {
            bestDist = dist;
            bestI = i;
            bestJ = j;
          }
        }
      }

      if (bestDist < 1.0) { // threshold for "similar enough"
        motifs.push({
          length: len,
          position1: bestI,
          position2: bestJ,
          distance: r(bestDist),
          similarity: r(Math.max(0, 1 - bestDist)),
        });
      }
    }

    // Cross-scale similarity: compare patterns between scales
    const crossScaleSimilarity = [];
    for (let si = 0; si < scales.length - 1; si++) {
      const s1 = scales[si];
      const s2 = scales[si + 1];
      const compareLen = Math.min(minMotifLen * 2, s2.data.length);

      if (s2.data.length < compareLen) continue;

      // Compare the overall shape at each scale
      // Resample s1 to match s2 length, then compute correlation
      const resampledLen = Math.min(s1.data.length, s2.data.length * 2);
      const resampled = [];
      for (let i = 0; i < s2.data.length; i++) {
        const srcIdx = Math.floor(i * resampledLen / s2.data.length);
        resampled.push(s1.data[Math.min(srcIdx, s1.data.length - 1)]);
      }

      // Pearson correlation
      const len = Math.min(resampled.length, s2.data.length);
      const m1 = resampled.slice(0, len).reduce((s, v) => s + v, 0) / len;
      const m2 = s2.data.slice(0, len).reduce((s, v) => s + v, 0) / len;
      let num = 0, den1 = 0, den2 = 0;
      for (let i = 0; i < len; i++) {
        num += (resampled[i] - m1) * (s2.data[i] - m2);
        den1 += (resampled[i] - m1) ** 2;
        den2 += (s2.data[i] - m2) ** 2;
      }
      const corr = den1 > 0 && den2 > 0 ? num / Math.sqrt(den1 * den2) : 0;

      crossScaleSimilarity.push({
        scale1: s1.scale,
        scale2: s2.scale,
        correlation: r(corr),
        isSelfSimilar: Math.abs(corr) > 0.7,
      });
    }

    const selfSimilarCount = crossScaleSimilarity.filter(c => c.isSelfSimilar).length;
    const selfSimilarityScore = crossScaleSimilarity.length > 0
      ? selfSimilarCount / crossScaleSimilarity.length
      : 0;

    // Scale-invariant features: statistics that are preserved across scales
    const scaleStats = scales.map(s => {
      const d = s.data;
      const m = d.reduce((sum, v) => sum + v, 0) / d.length;
      const variance = d.reduce((sum, v) => sum + (v - m) ** 2, 0) / d.length;
      const skewness = variance > 0
        ? d.reduce((sum, v) => sum + ((v - m) / Math.sqrt(variance)) ** 3, 0) / d.length
        : 0;
      return {
        scale: s.scale,
        length: d.length,
        mean: r(m),
        variance: r(variance),
        skewness: r(skewness),
      };
    });

    return {
      ok: true,
      result: {
        seriesLength: n,
        scalesAnalyzed: scales.length,
        motifs: motifs.sort((a, b) => a.distance - b.distance).slice(0, 10),
        motifCount: motifs.length,
        crossScaleSimilarity,
        selfSimilarityScore: r(selfSimilarityScore),
        selfSimilarityLabel: selfSimilarityScore > 0.7 ? "strongly self-similar" : selfSimilarityScore > 0.4 ? "moderately self-similar" : "weakly self-similar",
        scaleStatistics: scaleStats,
        bestMotif: motifs.length > 0 ? motifs.sort((a, b) => a.distance - b.distance)[0] : null,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * complexityMeasure
   * Measure structural complexity — Lempel-Ziv complexity, Shannon entropy
   * at multiple scales, and multi-scale entropy.
   * artifact.data.values = number[] or artifact.data.sequence = string
   * params.symbolize (number of bins for numeric data, default: 8)
   * params.maxScale (for multi-scale entropy, default: 10)
   */
  registerLensAction("fractal", "complexityMeasure", (ctx, artifact, params) => {
  try {
    const rawValues = artifact.data?.values || [];
    const rawSequence = artifact.data?.sequence || "";
    const numBins = params.symbolize || 8;
    const maxScale = params.maxScale || 10;
    const r = (v) => Math.round(v * 1e6) / 1e6;

    // Convert input to symbol sequence
    let symbols;
    if (rawSequence.length > 0) {
      symbols = rawSequence.split("");
    } else if (rawValues.length > 0) {
      const vals = rawValues.map(Number).filter(v => !isNaN(v));
      if (vals.length === 0) return { ok: false, error: "No valid numeric data." };

      // Bin the values into symbols
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const range = max - min || 1;
      symbols = vals.map(v => {
        const bin = Math.min(numBins - 1, Math.floor((v - min) / range * numBins));
        return String(bin);
      });
    } else {
      return { ok: false, error: "Provide values (numeric array) or sequence (string)." };
    }

    const n = symbols.length;
    if (n < 4) return { ok: false, error: "Need at least 4 data points." };

    // --- Lempel-Ziv complexity (LZ76) ---
    // Count the number of distinct substrings in sequential parsing
    let lzComplexity = 0;
    let i = 0;
    const dictionary = new Set();
    let currentWord = "";

    while (i < n) {
      currentWord += symbols[i];
      if (!dictionary.has(currentWord)) {
        dictionary.add(currentWord);
        lzComplexity++;
        currentWord = "";
      }
      i++;
    }
    if (currentWord.length > 0) lzComplexity++;

    // Normalized LZ complexity: C(n) / (n / log_b(n))
    const uniqueSymbols = new Set(symbols);
    const b = uniqueSymbols.size || 2;
    const logBn = Math.log(n) / Math.log(b);
    const normalizedLZ = logBn > 0 ? lzComplexity / (n / logBn) : 0;

    // --- Shannon entropy ---
    function shannonEntropy(seq) {
      const freq = {};
      for (const s of seq) freq[s] = (freq[s] || 0) + 1;
      let entropy = 0;
      for (const count of Object.values(freq)) {
        const p = count / seq.length;
        if (p > 0) entropy -= p * Math.log2(p);
      }
      return entropy;
    }

    const baseEntropy = shannonEntropy(symbols);
    const maxEntropy = Math.log2(uniqueSymbols.size || 1);
    const normalizedEntropy = maxEntropy > 0 ? baseEntropy / maxEntropy : 0;

    // --- Multi-scale entropy (coarse-graining) ---
    // For numeric data, use sample entropy at multiple scales
    const numericValues = rawValues.length > 0
      ? rawValues.map(Number).filter(v => !isNaN(v))
      : symbols.map(Number).filter(v => !isNaN(v));

    const multiScaleEntropy = [];

    if (numericValues.length >= 10) {
      // Sample entropy computation
      function sampleEntropy(data, m, tolerance) {
        const N = data.length;
        if (N < m + 1) return 0;

        function countMatches(templateLen) {
          let count = 0;
          for (let i = 0; i < N - templateLen; i++) {
            for (let j = i + 1; j < N - templateLen; j++) {
              let match = true;
              for (let k = 0; k < templateLen; k++) {
                if (Math.abs(data[i + k] - data[j + k]) > tolerance) {
                  match = false;
                  break;
                }
              }
              if (match) count++;
            }
          }
          return count;
        }

        const A = countMatches(m + 1);
        const B = countMatches(m);
        return B > 0 ? -Math.log(A / B) : 0;
      }

      // Standard deviation for tolerance
      const vMean = numericValues.reduce((s, v) => s + v, 0) / numericValues.length;
      const vStd = Math.sqrt(numericValues.reduce((s, v) => s + (v - vMean) ** 2, 0) / numericValues.length) || 1;
      const tolerance = 0.2 * vStd;
      const templateLen = 2;

      for (let scale = 1; scale <= Math.min(maxScale, Math.floor(numericValues.length / 10)); scale++) {
        // Coarse-grain: average consecutive scale-length segments
        const coarsened = [];
        for (let i = 0; i <= numericValues.length - scale; i += scale) {
          const seg = numericValues.slice(i, i + scale);
          coarsened.push(seg.reduce((s, v) => s + v, 0) / scale);
        }

        if (coarsened.length >= templateLen + 2) {
          const se = sampleEntropy(coarsened, templateLen, tolerance);
          multiScaleEntropy.push({ scale, sampleEntropy: r(se), coarsenedLength: coarsened.length });
        }
      }
    }

    // Entropy at multiple block sizes (Shannon)
    const blockEntropies = [];
    for (let blockSize = 1; blockSize <= Math.min(5, Math.floor(n / 4)); blockSize++) {
      const blocks = [];
      for (let i = 0; i <= n - blockSize; i++) {
        blocks.push(symbols.slice(i, i + blockSize).join(""));
      }
      const entropy = shannonEntropy(blocks);
      const entropyRate = blockSize > 1 ? entropy - blockEntropies[blockEntropies.length - 1]?.entropy : entropy;
      blockEntropies.push({ blockSize, entropy: r(entropy), entropyRate: r(entropyRate) });
    }

    // Complexity classification
    let complexityLabel;
    if (normalizedLZ > 0.9 && normalizedEntropy > 0.9) complexityLabel = "random/maximum complexity";
    else if (normalizedLZ > 0.5) complexityLabel = "complex/structured";
    else if (normalizedLZ > 0.2) complexityLabel = "moderately complex";
    else complexityLabel = "low complexity/highly regular";

    return {
      ok: true,
      result: {
        sequenceLength: n,
        uniqueSymbols: uniqueSymbols.size,
        lempelZiv: {
          complexity: lzComplexity,
          normalized: r(normalizedLZ),
          dictionarySize: dictionary.size,
        },
        shannonEntropy: {
          value: r(baseEntropy),
          maxPossible: r(maxEntropy),
          normalized: r(normalizedEntropy),
        },
        blockEntropies,
        multiScaleEntropy: multiScaleEntropy.length > 0 ? multiScaleEntropy : null,
        complexityLabel,
        compositeScore: r((normalizedLZ + normalizedEntropy) / 2),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ──────────────────────────────────────────────────────────────────────
  // Fractal renderer — escape-time computation + presets + render history
  // ──────────────────────────────────────────────────────────────────────

  function getFractalState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.fractalLens) STATE.fractalLens = {};
    const s = STATE.fractalLens;
    if (!(s.presets instanceof Map)) s.presets = new Map();   // userId -> Array
    if (!(s.renders instanceof Map)) s.renders = new Map();   // userId -> Array
    return s;
  }
  function saveFractalState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const fxId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const fxNow = () => new Date().toISOString();
  const fxActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const fxClean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const fxNum = (v, dflt) => { const n = Number(v); return Number.isFinite(n) ? n : dflt; };
  function fxPresetList(s, userId) {
    if (!s.presets.has(userId)) s.presets.set(userId, []);
    return s.presets.get(userId);
  }
  function fxRenderList(s, userId) {
    if (!s.renders.has(userId)) s.renders.set(userId, []);
    return s.renders.get(userId);
  }

  const FRACTAL_TYPES = ["mandelbrot", "julia", "burning-ship", "tricorn", "multibrot"];
  const PALETTES = {
    spectral: [[68,1,84],[59,82,139],[33,144,140],[93,201,99],[253,231,37]],
    fire: [[0,0,0],[120,20,0],[230,90,0],[255,200,40],[255,255,220]],
    ice: [[3,5,30],[18,55,120],[60,140,200],[150,210,235],[240,250,255]],
    grayscale: [[0,0,0],[64,64,64],[128,128,128],[192,192,192],[255,255,255]],
    psychedelic: [[255,0,128],[128,0,255],[0,128,255],[0,255,128],[255,255,0]],
    forest: [[10,20,10],[20,60,25],[50,110,40],[120,170,70],[220,235,160]],
  };

  /**
   * paletteFor — sample a colour-stop palette into N RGB swatches.
   * params.palette (key in PALETTES) | params.stops (custom [[r,g,b],...])
   * params.steps (default 32)
   */
  registerLensAction("fractal", "paletteFor", (ctx, _a, params = {}) => {
    try {
      const steps = Math.max(2, Math.min(256, Math.floor(fxNum(params.steps, 32))));
      const stops = Array.isArray(params.stops) && params.stops.length >= 2
        ? params.stops
        : (PALETTES[params.palette] || PALETTES.spectral);
      const swatches = [];
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const seg = t * (stops.length - 1);
        const lo = Math.min(stops.length - 1, Math.floor(seg));
        const hi = Math.min(stops.length - 1, lo + 1);
        const f = seg - lo;
        const lerp = (a, b) => Math.round(a + (b - a) * f);
        const c = [
          lerp(stops[lo][0], stops[hi][0]),
          lerp(stops[lo][1], stops[hi][1]),
          lerp(stops[lo][2], stops[hi][2]),
        ];
        swatches.push({ rgb: c, hex: "#" + c.map(v => v.toString(16).padStart(2, "0")).join("") });
      }
      return {
        ok: true,
        result: {
          palette: PALETTES[params.palette] ? params.palette : (Array.isArray(params.stops) ? "custom" : "spectral"),
          steps,
          swatches,
          availablePalettes: Object.keys(PALETTES),
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "paletteFor failed" };
    }
  });

  /**
   * render — server-side escape-time computation of a fractal tile.
   * Returns a 2D iteration grid the client paints onto a canvas (and can
   * also be used for headless / high-res export).
   * params: type, width, height, centerX, centerY, scale (units/px),
   *         maxIter, juliaRe, juliaIm, power (for multibrot)
   */
  registerLensAction("fractal", "render", (ctx, _a, params = {}) => {
    try {
      const type = FRACTAL_TYPES.includes(params.type) ? params.type : "mandelbrot";
      const width = Math.max(8, Math.min(640, Math.floor(fxNum(params.width, 200))));
      const height = Math.max(8, Math.min(640, Math.floor(fxNum(params.height, 200))));
      const cx = fxNum(params.centerX, type === "julia" ? 0 : -0.5);
      const cy = fxNum(params.centerY, 0);
      const scale = Math.max(1e-15, fxNum(params.scale, 3 / Math.min(width, height)));
      const maxIter = Math.max(16, Math.min(4000, Math.floor(fxNum(params.maxIter, 200))));
      const power = Math.max(2, Math.min(8, Math.floor(fxNum(params.power, 2))));
      const jRe = fxNum(params.juliaRe, -0.7);
      const jIm = fxNum(params.juliaIm, 0.27015);

      // complex z^power for multibrot (repeated complex multiplication)
      function zpow(zx, zy, p) {
        let rx = zx, ry = zy;
        for (let k = 1; k < p; k++) {
          const nx = rx * zx - ry * zy;
          const nyv = rx * zy + ry * zx;
          rx = nx; ry = nyv;
        }
        return [rx, ry];
      }

      const grid = new Array(height);
      let escapedTotal = 0, insideTotal = 0;
      const histogram = new Array(maxIter + 1).fill(0);

      for (let py = 0; py < height; py++) {
        const rowOut = new Int16Array(width);
        const wy = cy + (py - height / 2) * scale;
        for (let px = 0; px < width; px++) {
          const wx = cx + (px - width / 2) * scale;
          let x, y, iter = 0;
          let cRe, cIm;
          if (type === "julia") { x = wx; y = wy; cRe = jRe; cIm = jIm; }
          else { x = 0; y = 0; cRe = wx; cIm = wy; }
          while (x * x + y * y <= 4 && iter < maxIter) {
            let nx, ny;
            if (type === "tricorn") { nx = x * x - y * y + cRe; ny = -2 * x * y + cIm; }
            else if (type === "burning-ship") {
              const ax = Math.abs(x), ay = Math.abs(y);
              nx = ax * ax - ay * ay + cRe; ny = 2 * ax * ay + cIm;
            } else if (type === "multibrot") {
              const [zx, zy] = zpow(x, y, power);
              nx = zx + cRe; ny = zy + cIm;
            } else { nx = x * x - y * y + cRe; ny = 2 * x * y + cIm; }
            x = nx; y = ny; iter++;
          }
          rowOut[px] = iter;
          histogram[iter]++;
          if (iter >= maxIter) insideTotal++; else escapedTotal++;
        }
        grid[py] = Array.from(rowOut);
      }

      const total = width * height;
      return {
        ok: true,
        result: {
          type, width, height, centerX: cx, centerY: cy, scale, maxIter, power,
          juliaRe: jRe, juliaIm: jIm,
          grid,
          stats: {
            pixels: total,
            insideSet: insideTotal,
            escaped: escapedTotal,
            insideFraction: Math.round((insideTotal / total) * 1e4) / 1e4,
            zoomLevel: Math.round((3 / (scale * Math.min(width, height))) * 100) / 100,
          },
          histogram,
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "render failed" };
    }
  });

  /**
   * orbit — escape-time trace for a single point (used by the live
   * parameter inspector). Returns the full z-orbit for plotting.
   */
  registerLensAction("fractal", "orbit", (ctx, _a, params = {}) => {
    try {
      const type = FRACTAL_TYPES.includes(params.type) ? params.type : "mandelbrot";
      const maxIter = Math.max(8, Math.min(2000, Math.floor(fxNum(params.maxIter, 200))));
      const px = fxNum(params.x, 0);
      const py = fxNum(params.y, 0);
      const jRe = fxNum(params.juliaRe, -0.7);
      const jIm = fxNum(params.juliaIm, 0.27015);
      let x, y, cRe, cIm;
      if (type === "julia") { x = px; y = py; cRe = jRe; cIm = jIm; }
      else { x = 0; y = 0; cRe = px; cIm = py; }
      const orbit = [[x, y]];
      let iter = 0;
      while (x * x + y * y <= 4 && iter < maxIter) {
        let nx, ny;
        if (type === "tricorn") { nx = x * x - y * y + cRe; ny = -2 * x * y + cIm; }
        else if (type === "burning-ship") {
          const ax = Math.abs(x), ay = Math.abs(y);
          nx = ax * ax - ay * ay + cRe; ny = 2 * ax * ay + cIm;
        } else { nx = x * x - y * y + cRe; ny = 2 * x * y + cIm; }
        x = nx; y = ny; iter++;
        orbit.push([Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]);
        if (orbit.length > 512) break;
      }
      const escaped = iter < maxIter;
      return {
        ok: true,
        result: {
          type, point: [px, py], iterations: iter, maxIter,
          escaped, inSet: !escaped,
          finalMagnitude: Math.round(Math.sqrt(x * x + y * y) * 1e6) / 1e6,
          orbit,
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "orbit failed" };
    }
  });

  /**
   * savePreset — persist a named fractal preset (type + viewport + colour)
   * for the calling user. params: name, config {type,centerX,...,palette}
   */
  registerLensAction("fractal", "savePreset", (ctx, _a, params = {}) => {
    try {
      const s = getFractalState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const name = fxClean(params.name, 120);
      if (!name) return { ok: false, error: "preset name required" };
      const cfg = params.config && typeof params.config === "object" ? params.config : {};
      const list = fxPresetList(s, fxActor(ctx));
      const preset = {
        id: fxId("fxp"),
        name,
        config: {
          type: FRACTAL_TYPES.includes(cfg.type) ? cfg.type : "mandelbrot",
          centerX: fxNum(cfg.centerX, -0.5),
          centerY: fxNum(cfg.centerY, 0),
          scale: fxNum(cfg.scale, 0.005),
          maxIter: Math.max(16, Math.min(4000, Math.floor(fxNum(cfg.maxIter, 200)))),
          palette: typeof cfg.palette === "string" ? fxClean(cfg.palette, 40) : "spectral",
          juliaRe: fxNum(cfg.juliaRe, -0.7),
          juliaIm: fxNum(cfg.juliaIm, 0.27015),
          power: Math.max(2, Math.min(8, Math.floor(fxNum(cfg.power, 2)))),
        },
        createdAt: fxNow(),
      };
      list.unshift(preset);
      if (list.length > 100) list.length = 100;
      saveFractalState();
      return { ok: true, result: { preset, count: list.length } };
    } catch (e) {
      return { ok: false, error: e?.message || "savePreset failed" };
    }
  });

  /**
   * listPresets — return the calling user's saved presets.
   */
  registerLensAction("fractal", "listPresets", (ctx, _a, _params = {}) => {
    try {
      const s = getFractalState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const list = fxPresetList(s, fxActor(ctx));
      return { ok: true, result: { presets: list, count: list.length } };
    } catch (e) {
      return { ok: false, error: e?.message || "listPresets failed" };
    }
  });

  /**
   * deletePreset — remove a saved preset by id.
   */
  registerLensAction("fractal", "deletePreset", (ctx, _a, params = {}) => {
    try {
      const s = getFractalState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const id = fxClean(params.id, 120);
      if (!id) return { ok: false, error: "preset id required" };
      const list = fxPresetList(s, fxActor(ctx));
      const idx = list.findIndex((p) => p.id === id);
      if (idx < 0) return { ok: false, error: "preset not found" };
      list.splice(idx, 1);
      saveFractalState();
      return { ok: true, result: { deleted: id, count: list.length } };
    } catch (e) {
      return { ok: false, error: e?.message || "deletePreset failed" };
    }
  });

  /**
   * importPreset — import a shared preset payload (parameter sharing).
   * Accepts params.payload as object OR JSON string.
   */
  registerLensAction("fractal", "importPreset", (ctx, _a, params = {}) => {
    try {
      const s = getFractalState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      let payload = params.payload;
      if (typeof payload === "string") {
        try { payload = JSON.parse(payload); }
        catch (_e) { return { ok: false, error: "payload is not valid JSON" }; }
      }
      if (!payload || typeof payload !== "object") {
        return { ok: false, error: "preset payload required" };
      }
      const cfg = payload.config && typeof payload.config === "object" ? payload.config : payload;
      const list = fxPresetList(s, fxActor(ctx));
      const preset = {
        id: fxId("fxp"),
        name: fxClean(payload.name || cfg.name || "Imported Preset", 120),
        config: {
          type: FRACTAL_TYPES.includes(cfg.type) ? cfg.type : "mandelbrot",
          centerX: fxNum(cfg.centerX, -0.5),
          centerY: fxNum(cfg.centerY, 0),
          scale: fxNum(cfg.scale, 0.005),
          maxIter: Math.max(16, Math.min(4000, Math.floor(fxNum(cfg.maxIter, 200)))),
          palette: typeof cfg.palette === "string" ? fxClean(cfg.palette, 40) : "spectral",
          juliaRe: fxNum(cfg.juliaRe, -0.7),
          juliaIm: fxNum(cfg.juliaIm, 0.27015),
          power: Math.max(2, Math.min(8, Math.floor(fxNum(cfg.power, 2)))),
        },
        imported: true,
        createdAt: fxNow(),
      };
      list.unshift(preset);
      if (list.length > 100) list.length = 100;
      saveFractalState();
      return { ok: true, result: { preset, count: list.length } };
    } catch (e) {
      return { ok: false, error: e?.message || "importPreset failed" };
    }
  });

  /**
   * exportPreset — produce a shareable JSON payload for a saved preset.
   */
  registerLensAction("fractal", "exportPreset", (ctx, _a, params = {}) => {
    try {
      const s = getFractalState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const id = fxClean(params.id, 120);
      const list = fxPresetList(s, fxActor(ctx));
      const preset = id ? list.find((p) => p.id === id) : list[0];
      if (!preset) return { ok: false, error: "preset not found" };
      const payload = {
        spec: "concord-fractal-preset/v1",
        name: preset.name,
        config: preset.config,
        exportedAt: fxNow(),
      };
      return { ok: true, result: { payload, json: JSON.stringify(payload, null, 2) } };
    } catch (e) {
      return { ok: false, error: e?.message || "exportPreset failed" };
    }
  });

  /**
   * recordRender — log a high-resolution export render in the user's
   * render history (export is no longer metadata-only on the artifact tab).
   * params: type, width, height, format, config, dataUrlLength
   */
  registerLensAction("fractal", "recordRender", (ctx, _a, params = {}) => {
    try {
      const s = getFractalState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const list = fxRenderList(s, fxActor(ctx));
      const entry = {
        id: fxId("fxr"),
        type: FRACTAL_TYPES.includes(params.type) ? params.type : "mandelbrot",
        width: Math.max(1, Math.min(8192, Math.floor(fxNum(params.width, 1920)))),
        height: Math.max(1, Math.min(8192, Math.floor(fxNum(params.height, 1080)))),
        format: fxClean(params.format, 16) || "PNG",
        config: params.config && typeof params.config === "object" ? params.config : {},
        bytes: Math.max(0, Math.floor(fxNum(params.dataUrlLength, 0))),
        createdAt: fxNow(),
      };
      list.unshift(entry);
      if (list.length > 200) list.length = 200;
      saveFractalState();
      return { ok: true, result: { render: entry, count: list.length } };
    } catch (e) {
      return { ok: false, error: e?.message || "recordRender failed" };
    }
  });

  /**
   * listRenders — return the calling user's render/export history.
   */
  registerLensAction("fractal", "listRenders", (ctx, _a, _params = {}) => {
    try {
      const s = getFractalState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const list = fxRenderList(s, fxActor(ctx));
      return { ok: true, result: { renders: list, count: list.length } };
    } catch (e) {
      return { ok: false, error: e?.message || "listRenders failed" };
    }
  });

  /**
   * zoomPath — interpolate a deep-zoom animation path from a start view to
   * a target view (geometric scale interpolation for smooth zoom video).
   * params: from {centerX,centerY,scale}, to {centerX,centerY,scale}, frames
   */
  registerLensAction("fractal", "zoomPath", (ctx, _a, params = {}) => {
    try {
      const from = params.from && typeof params.from === "object" ? params.from : {};
      const to = params.to && typeof params.to === "object" ? params.to : {};
      const frames = Math.max(2, Math.min(600, Math.floor(fxNum(params.frames, 60))));
      const fx0 = fxNum(from.centerX, -0.5), fy0 = fxNum(from.centerY, 0);
      const fs0 = Math.max(1e-15, fxNum(from.scale, 0.01));
      const fx1 = fxNum(to.centerX, fx0), fy1 = fxNum(to.centerY, fy0);
      const fs1 = Math.max(1e-15, fxNum(to.scale, fs0 / 1000));
      const path = [];
      const logS0 = Math.log(fs0), logS1 = Math.log(fs1);
      for (let i = 0; i < frames; i++) {
        const t = i / (frames - 1);
        // ease-in-out for centre, geometric (log-lerp) for scale
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        path.push({
          frame: i,
          centerX: Math.round((fx0 + (fx1 - fx0) * ease) * 1e12) / 1e12,
          centerY: Math.round((fy0 + (fy1 - fy0) * ease) * 1e12) / 1e12,
          scale: Math.exp(logS0 + (logS1 - logS0) * t),
        });
      }
      return {
        ok: true,
        result: {
          frames,
          totalZoom: Math.round((fs0 / fs1) * 100) / 100,
          path,
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "zoomPath failed" };
    }
  });

  /**
   * mandelbulb — sample a 3D Mandelbulb distance/iteration field as a set of
   * z-slices the client can render with simple diffuse lighting.
   * params: power, maxIter, resolution (per axis), slices, bound
   */
  registerLensAction("fractal", "mandelbulb", (ctx, _a, params = {}) => {
    try {
      const power = Math.max(2, Math.min(16, fxNum(params.power, 8)));
      const maxIter = Math.max(2, Math.min(24, Math.floor(fxNum(params.maxIter, 8))));
      const res = Math.max(8, Math.min(96, Math.floor(fxNum(params.resolution, 48))));
      const sliceCount = Math.max(1, Math.min(48, Math.floor(fxNum(params.slices, 16))));
      const bound = Math.max(0.5, Math.min(2, fxNum(params.bound, 1.25)));
      const light = [0.577, 0.577, 0.577]; // normalised diffuse light dir

      // Mandelbulb escape-iteration for a single 3D point.
      function bulbIter(x0, y0, z0) {
        let x = x0, y = y0, z = z0;
        let dr = 1, r = 0, iter = 0;
        for (; iter < maxIter; iter++) {
          r = Math.sqrt(x * x + y * y + z * z);
          if (r > 2) break;
          let theta = Math.acos(z / (r || 1e-9));
          let phi = Math.atan2(y, x);
          dr = Math.pow(r, power - 1) * power * dr + 1;
          const zr = Math.pow(r, power);
          theta *= power; phi *= power;
          const st = Math.sin(theta);
          x = zr * st * Math.cos(phi) + x0;
          y = zr * st * Math.sin(phi) + y0;
          z = zr * Math.cos(theta) + z0;
        }
        return { iter, r, dr };
      }

      const slices = [];
      let surfaceVoxels = 0;
      for (let sz = 0; sz < sliceCount; sz++) {
        const wz = -bound + (2 * bound) * (sz / Math.max(1, sliceCount - 1));
        const cells = [];
        for (let iy = 0; iy < res; iy++) {
          const wy = -bound + (2 * bound) * (iy / (res - 1));
          const row = [];
          for (let ix = 0; ix < res; ix++) {
            const wx = -bound + (2 * bound) * (ix / (res - 1));
            const { iter, r } = bulbIter(wx, wy, wz);
            const inside = iter >= maxIter;
            // crude surface-normal lighting via central difference on iter count
            let shade = 0;
            if (inside) {
              const nx = bulbIter(wx + 0.04, wy, wz).r - bulbIter(wx - 0.04, wy, wz).r;
              const ny = bulbIter(wx, wy + 0.04, wz).r - bulbIter(wx, wy - 0.04, wz).r;
              const nz = bulbIter(wx, wy, wz + 0.04).r - bulbIter(wx, wy, wz - 0.04).r;
              const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
              shade = Math.max(0, (nx * light[0] + ny * light[1] + nz * light[2]) / nl);
              surfaceVoxels++;
            }
            row.push(inside ? Math.round(shade * 100) / 100 : -1);
          }
          cells.push(row);
        }
        slices.push({ z: Math.round(wz * 1e4) / 1e4, cells });
      }

      return {
        ok: true,
        result: {
          power, maxIter, resolution: res, slices: sliceCount, bound,
          surfaceVoxels,
          field: slices,
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "mandelbulb failed" };
    }
  });
}
