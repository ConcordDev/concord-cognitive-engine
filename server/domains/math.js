// server/domains/math.js
// Domain actions for mathematics: statistical analysis, matrix operations,
// polynomial evaluation, and proof-step verification.

export default function registerMathActions(registerLensAction) {
  /**
   * statisticalAnalysis
   * Compute descriptive statistics, distribution shape, and outlier detection
   * from artifact.data.values (array of numbers).
   */
  registerLensAction("math", "statisticalAnalysis", (ctx, artifact, _params) => {
    const raw = artifact.data?.values || [];
    const values = raw.map(Number).filter(v => !isNaN(v));
    if (values.length === 0) {
      return { ok: true, result: { message: "No numeric values to analyze." } };
    }

    const n = values.length;
    const sorted = [...values].sort((a, b) => a - b);

    // Central tendency
    const sum = values.reduce((s, v) => s + v, 0);
    const mean = sum / n;
    const median = n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];

    // Mode (most frequent value)
    const freq = {};
    let maxFreq = 0;
    for (const v of values) { freq[v] = (freq[v] || 0) + 1; maxFreq = Math.max(maxFreq, freq[v]); }
    const modes = maxFreq > 1 ? Object.entries(freq).filter(([, f]) => f === maxFreq).map(([v]) => Number(v)) : [];

    // Spread
    const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / n;
    const sampleVariance = n > 1 ? values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (n - 1) : 0;
    const stdDev = Math.sqrt(variance);
    const sampleStdDev = Math.sqrt(sampleVariance);
    const range = sorted[n - 1] - sorted[0];
    const q1 = sorted[Math.floor(n * 0.25)];
    const q3 = sorted[Math.floor(n * 0.75)];
    const iqr = q3 - q1;
    const coefficientOfVariation = mean !== 0 ? stdDev / Math.abs(mean) : Infinity;

    // Shape: skewness and kurtosis
    const m3 = values.reduce((s, v) => s + Math.pow(v - mean, 3), 0) / n;
    const m4 = values.reduce((s, v) => s + Math.pow(v - mean, 4), 0) / n;
    const skewness = stdDev > 0 ? m3 / Math.pow(stdDev, 3) : 0;
    const kurtosis = stdDev > 0 ? m4 / Math.pow(stdDev, 4) - 3 : 0; // excess kurtosis

    // Outlier detection (1.5 * IQR fence)
    const lowerFence = q1 - 1.5 * iqr;
    const upperFence = q3 + 1.5 * iqr;
    const outliers = values.filter(v => v < lowerFence || v > upperFence);

    // Distribution shape classification
    let shape = "symmetric";
    if (Math.abs(skewness) > 1) shape = skewness > 0 ? "right-skewed" : "left-skewed";
    else if (Math.abs(skewness) > 0.5) shape = skewness > 0 ? "moderately-right-skewed" : "moderately-left-skewed";
    const tailWeight = kurtosis > 1 ? "heavy-tailed" : kurtosis < -1 ? "light-tailed" : "normal-tailed";

    const r = (v) => Math.round(v * 1e6) / 1e6;

    return {
      ok: true, result: {
        n,
        centralTendency: { mean: r(mean), median: r(median), modes },
        spread: { stdDev: r(stdDev), sampleStdDev: r(sampleStdDev), variance: r(variance), range: r(range), iqr: r(iqr), coefficientOfVariation: r(coefficientOfVariation) },
        shape: { skewness: r(skewness), kurtosis: r(kurtosis), classification: shape, tailWeight },
        quartiles: { q1: r(q1), median: r(median), q3: r(q3) },
        extremes: { min: sorted[0], max: sorted[n - 1] },
        outliers: { count: outliers.length, values: outliers.slice(0, 20), lowerFence: r(lowerFence), upperFence: r(upperFence) },
      },
    };
  });

  /**
   * matrixOperations
   * Perform operations on matrices stored as 2D arrays.
   * artifact.data.matrixA, artifact.data.matrixB (optional)
   * params.operation: "determinant" | "transpose" | "multiply" | "inverse" | "eigenvalues" | "rank"
   */
  registerLensAction("math", "matrixOperations", (ctx, artifact, params) => {
    const A = artifact.data?.matrixA || artifact.data?.matrix || [];
    const B = artifact.data?.matrixB;
    const op = params.operation || "determinant";

    if (A.length === 0) return { ok: false, error: "matrixA is empty or missing." };
    const rows = A.length;
    const cols = A[0]?.length || 0;

    // Helper: determinant via LU decomposition for arbitrary NxN
    function det(M) {
      const n = M.length;
      if (n === 1) return M[0][0];
      if (n === 2) return M[0][0] * M[1][1] - M[0][1] * M[1][0];
      // Gaussian elimination with partial pivoting
      const work = M.map(row => [...row]);
      let d = 1;
      for (let i = 0; i < n; i++) {
        // Pivot
        let maxRow = i;
        for (let k = i + 1; k < n; k++) {
          if (Math.abs(work[k][i]) > Math.abs(work[maxRow][i])) maxRow = k;
        }
        if (maxRow !== i) { [work[i], work[maxRow]] = [work[maxRow], work[i]]; d *= -1; }
        if (Math.abs(work[i][i]) < 1e-12) return 0;
        d *= work[i][i];
        for (let k = i + 1; k < n; k++) {
          const factor = work[k][i] / work[i][i];
          for (let j = i; j < n; j++) work[k][j] -= factor * work[i][j];
        }
      }
      return d;
    }

    function transpose(M) {
      const r = M.length, c = M[0].length;
      const T = Array.from({ length: c }, () => new Array(r));
      for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) T[j][i] = M[i][j];
      return T;
    }

    function multiply(M1, M2) {
      const r1 = M1.length, c1 = M1[0].length, c2 = M2[0].length;
      const result = Array.from({ length: r1 }, () => new Array(c2).fill(0));
      for (let i = 0; i < r1; i++)
        {for (let j = 0; j < c2; j++)
          {for (let k = 0; k < c1; k++)
            {result[i][j] += M1[i][k] * M2[k][j];}}}
      return result;
    }

    // Matrix rank via row echelon form
    function rank(M) {
      const work = M.map(row => [...row]);
      const r = work.length, c = work[0].length;
      let rnk = 0;
      for (let col = 0; col < c && rnk < r; col++) {
        let pivotRow = -1;
        for (let row = rnk; row < r; row++) {
          if (Math.abs(work[row][col]) > 1e-10) { pivotRow = row; break; }
        }
        if (pivotRow === -1) continue;
        [work[rnk], work[pivotRow]] = [work[pivotRow], work[rnk]];
        const pivot = work[rnk][col];
        for (let j = col; j < c; j++) work[rnk][j] /= pivot;
        for (let row = 0; row < r; row++) {
          if (row === rnk) continue;
          const factor = work[row][col];
          for (let j = col; j < c; j++) work[row][j] -= factor * work[rnk][j];
        }
        rnk++;
      }
      return rnk;
    }

    const r = (v) => Math.round(v * 1e8) / 1e8;

    switch (op) {
      case "determinant": {
        if (rows !== cols) return { ok: false, error: "Determinant requires a square matrix." };
        return { ok: true, result: { operation: "determinant", rows, cols, determinant: r(det(A)) } };
      }
      case "transpose": {
        return { ok: true, result: { operation: "transpose", originalDimensions: [rows, cols], resultDimensions: [cols, rows], matrix: transpose(A) } };
      }
      case "multiply": {
        if (!B) return { ok: false, error: "matrixB required for multiplication." };
        if (cols !== B.length) return { ok: false, error: `Dimension mismatch: A is ${rows}x${cols}, B is ${B.length}x${B[0]?.length || 0}.` };
        const product = multiply(A, B);
        return { ok: true, result: { operation: "multiply", dimensions: [rows, B[0].length], matrix: product.map(row => row.map(r)) } };
      }
      case "inverse": {
        if (rows !== cols) return { ok: false, error: "Inverse requires a square matrix." };
        const d = det(A);
        if (Math.abs(d) < 1e-12) return { ok: false, error: "Matrix is singular (determinant ≈ 0), no inverse exists." };
        // Gauss-Jordan elimination
        const n = rows;
        const aug = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)]);
        for (let i = 0; i < n; i++) {
          let maxRow = i;
          for (let k = i + 1; k < n; k++) if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) maxRow = k;
          [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];
          const pivot = aug[i][i];
          for (let j = 0; j < 2 * n; j++) aug[i][j] /= pivot;
          for (let k = 0; k < n; k++) {
            if (k === i) continue;
            const factor = aug[k][i];
            for (let j = 0; j < 2 * n; j++) aug[k][j] -= factor * aug[i][j];
          }
        }
        const inv = aug.map(row => row.slice(n).map(r));
        return { ok: true, result: { operation: "inverse", dimensions: [n, n], determinant: r(d), matrix: inv } };
      }
      case "rank": {
        return { ok: true, result: { operation: "rank", dimensions: [rows, cols], rank: rank(A), fullRank: rank(A) === Math.min(rows, cols) } };
      }
      case "eigenvalues": {
        // QR algorithm for eigenvalue approximation (small matrices only)
        if (rows !== cols) return { ok: false, error: "Eigenvalues require a square matrix." };
        if (rows > 10) return { ok: false, error: "Eigenvalue computation limited to 10x10 matrices." };
        // Power iteration for dominant eigenvalue, plus characteristic polynomial for 2x2/3x3
        if (rows === 2) {
          const trace = A[0][0] + A[1][1];
          const d = det(A);
          const disc = trace * trace - 4 * d;
          if (disc >= 0) {
            return { ok: true, result: { operation: "eigenvalues", eigenvalues: [r((trace + Math.sqrt(disc)) / 2), r((trace - Math.sqrt(disc)) / 2)], trace: r(trace), determinant: r(d), real: true } };
          } else {
            return { ok: true, result: { operation: "eigenvalues", eigenvalues: [{ real: r(trace / 2), imag: r(Math.sqrt(-disc) / 2) }, { real: r(trace / 2), imag: r(-Math.sqrt(-disc) / 2) }], trace: r(trace), determinant: r(d), real: false } };
          }
        }
        // For larger: simple QR iteration (30 steps)
        let Q = A.map(row => [...row]);
        for (let iter = 0; iter < 30; iter++) {
          // QR decomposition via Gram-Schmidt
          const n = Q.length;
          const Qm = Array.from({ length: n }, () => new Array(n).fill(0));
          const R = Array.from({ length: n }, () => new Array(n).fill(0));
          for (let j = 0; j < n; j++) {
            const v = Q.map(row => row[j]);
            for (let i = 0; i < j; i++) {
              let dot = 0;
              for (let k = 0; k < n; k++) dot += Qm[k][i] * v[k];
              R[i][j] = dot;
              for (let k = 0; k < n; k++) v[k] -= dot * Qm[k][i];
            }
            let norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
            if (norm < 1e-12) norm = 1e-12;
            R[j][j] = norm;
            for (let k = 0; k < n; k++) Qm[k][j] = v[k] / norm;
          }
          Q = multiply(R, Qm.map(row => [...row]));
          // Extract from the correct orientation
          const temp = Array.from({ length: n }, () => new Array(n).fill(0));
          for (let i = 0; i < n; i++) {for (let j = 0; j < n; j++) {
            for (let k = 0; k < n; k++) temp[i][j] += R[i][k] * Qm[k][j];
          }}
          Q = temp;
        }
        const eigenvalues = Array.from({ length: rows }, (_, i) => r(Q[i][i]));
        return { ok: true, result: { operation: "eigenvalues", eigenvalues, approximate: true, iterations: 30 } };
      }
      default:
        return { ok: false, error: `Unknown operation "${op}". Supported: determinant, transpose, multiply, inverse, rank, eigenvalues` };
    }
  });

  /**
   * polynomialAnalysis
   * Analyze polynomial from coefficients [a_n, ..., a_1, a_0] (highest degree first).
   * Evaluate at points, find roots (for degree ≤ 4), compute derivative/integral.
   */
  registerLensAction("math", "polynomialAnalysis", (ctx, artifact, params) => {
    const coefficients = artifact.data?.coefficients || params.coefficients || [];
    if (coefficients.length === 0) return { ok: false, error: "No coefficients provided." };

    const degree = coefficients.length - 1;
    const r = (v) => Math.round(v * 1e8) / 1e8;

    // Evaluate polynomial at a point using Horner's method
    function evaluate(x) {
      let result = 0;
      for (let i = 0; i < coefficients.length; i++) {
        result = result * x + coefficients[i];
      }
      return result;
    }

    // Derivative coefficients
    const derivative = coefficients.slice(0, -1).map((c, i) => c * (degree - i));

    // Integral coefficients (constant = 0)
    const integral = coefficients.map((c, i) => c / (degree - i + 1));
    integral.push(0); // constant of integration

    // Evaluation at requested points
    const evalPoints = params.evaluateAt || [0, 1, -1];
    const evaluations = evalPoints.map(x => ({ x, y: r(evaluate(x)) }));

    // Root finding for small degrees
    let roots = null;
    if (degree === 1) {
      roots = [r(-coefficients[1] / coefficients[0])];
    } else if (degree === 2) {
      const [a, b, c] = coefficients;
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        roots = [r((-b + Math.sqrt(disc)) / (2 * a)), r((-b - Math.sqrt(disc)) / (2 * a))];
      } else {
        roots = [
          { real: r(-b / (2 * a)), imag: r(Math.sqrt(-disc) / (2 * a)) },
          { real: r(-b / (2 * a)), imag: r(-Math.sqrt(-disc) / (2 * a)) },
        ];
      }
    } else if (degree <= 4) {
      // Newton-Raphson from multiple starting points
      roots = [];
      const starts = [-10, -5, -2, -1, -0.5, 0, 0.5, 1, 2, 5, 10];
      const found = new Set();
      for (const start of starts) {
        let x = start;
        for (let i = 0; i < 100; i++) {
          const fx = evaluate(x);
          let fpx = 0;
          for (let j = 0; j < derivative.length; j++) fpx = fpx * x + derivative[j];
          if (Math.abs(fpx) < 1e-14) break;
          x = x - fx / fpx;
        }
        if (Math.abs(evaluate(x)) < 1e-8) {
          const rounded = r(x);
          const key = String(rounded);
          if (!found.has(key)) { found.add(key); roots.push(rounded); }
        }
        if (roots.length >= degree) break;
      }
    }

    return {
      ok: true, result: {
        degree, coefficients,
        derivative: { degree: Math.max(degree - 1, 0), coefficients: derivative },
        integral: { degree: degree + 1, coefficients: integral.map(r), note: "+C" },
        evaluations,
        roots: roots ? { values: roots, method: degree <= 2 ? "analytic" : "newton-raphson" } : { note: "Root-finding for degree > 4 not implemented" },
      },
    };
  });

  /**
   * regressionFit
   * Fit a regression model to data points.
   * artifact.data.points = [{ x, y }]
   * params.type: "linear" | "polynomial" | "exponential"
   * params.degree: number (for polynomial, default 2)
   */
  registerLensAction("math", "regressionFit", (ctx, artifact, params) => {
    const points = artifact.data?.points || [];
    if (points.length < 2) return { ok: false, error: "Need at least 2 data points." };

    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const n = points.length;
    const type = params.type || "linear";
    const r = (v) => Math.round(v * 1e8) / 1e8;

    if (type === "linear" || (type === "polynomial" && (params.degree || 2) === 1)) {
      // Least squares: y = mx + b
      const sumX = xs.reduce((s, v) => s + v, 0);
      const sumY = ys.reduce((s, v) => s + v, 0);
      const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
      const sumX2 = xs.reduce((s, x) => s + x * x, 0);
      const m = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      const b = (sumY - m * sumX) / n;

      // R² calculation
      const yMean = sumY / n;
      const ssRes = ys.reduce((s, y, i) => s + Math.pow(y - (m * xs[i] + b), 2), 0);
      const ssTot = ys.reduce((s, y) => s + Math.pow(y - yMean, 2), 0);
      const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

      // Standard error of the estimate
      const se = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;

      // Pearson correlation
      const sumY2 = ys.reduce((s, y) => s + y * y, 0);
      const correlation = (n * sumXY - sumX * sumY) / Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

      artifact.data.regression = { type: "linear", slope: r(m), intercept: r(b), rSquared: r(rSquared) };

      return {
        ok: true, result: {
          type: "linear", equation: `y = ${r(m)}x + ${r(b)}`,
          slope: r(m), intercept: r(b),
          rSquared: r(rSquared), correlation: r(correlation),
          standardError: r(se), n,
          fit: rSquared > 0.9 ? "excellent" : rSquared > 0.7 ? "good" : rSquared > 0.5 ? "moderate" : "poor",
        },
      };
    }

    if (type === "exponential") {
      // y = a * e^(bx) → ln(y) = ln(a) + bx
      const positiveYs = ys.every(y => y > 0);
      if (!positiveYs) return { ok: false, error: "Exponential regression requires all y values > 0." };

      const lnYs = ys.map(y => Math.log(y));
      const sumX = xs.reduce((s, v) => s + v, 0);
      const sumLnY = lnYs.reduce((s, v) => s + v, 0);
      const sumXLnY = xs.reduce((s, x, i) => s + x * lnYs[i], 0);
      const sumX2 = xs.reduce((s, x) => s + x * x, 0);
      const b = (n * sumXLnY - sumX * sumLnY) / (n * sumX2 - sumX * sumX);
      const lnA = (sumLnY - b * sumX) / n;
      const a = Math.exp(lnA);

      const yMean = ys.reduce((s, y) => s + y, 0) / n;
      const ssRes = ys.reduce((s, y, i) => s + Math.pow(y - a * Math.exp(b * xs[i]), 2), 0);
      const ssTot = ys.reduce((s, y) => s + Math.pow(y - yMean, 2), 0);
      const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

      return {
        ok: true, result: {
          type: "exponential", equation: `y = ${r(a)} * e^(${r(b)}x)`,
          a: r(a), b: r(b), rSquared: r(rSquared), n,
          growthRate: r(b), doublingTime: b > 0 ? r(Math.log(2) / b) : null,
          fit: rSquared > 0.9 ? "excellent" : rSquared > 0.7 ? "good" : rSquared > 0.5 ? "moderate" : "poor",
        },
      };
    }

    // Polynomial regression via normal equations
    const deg = Math.min(params.degree || 2, Math.min(n - 1, 10));

    // Build Vandermonde matrix X^T * X and X^T * y
    const XtX = Array.from({ length: deg + 1 }, () => new Array(deg + 1).fill(0));
    const XtY = new Array(deg + 1).fill(0);
    for (let i = 0; i <= deg; i++) {
      for (let j = 0; j <= deg; j++) {
        XtX[i][j] = xs.reduce((s, x) => s + Math.pow(x, i + j), 0);
      }
      XtY[i] = xs.reduce((s, x, k) => s + Math.pow(x, i) * ys[k], 0);
    }

    // Solve via Gauss elimination
    const size = deg + 1;
    const aug = XtX.map((row, i) => [...row, XtY[i]]);
    for (let i = 0; i < size; i++) {
      let maxRow = i;
      for (let k = i + 1; k < size; k++) if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) maxRow = k;
      [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];
      if (Math.abs(aug[i][i]) < 1e-12) continue;
      for (let k = i + 1; k < size; k++) {
        const factor = aug[k][i] / aug[i][i];
        for (let j = i; j <= size; j++) aug[k][j] -= factor * aug[i][j];
      }
    }
    const coeffs = new Array(size).fill(0);
    for (let i = size - 1; i >= 0; i--) {
      coeffs[i] = aug[i][size];
      for (let j = i + 1; j < size; j++) coeffs[i] -= aug[i][j] * coeffs[j];
      coeffs[i] /= aug[i][i] || 1;
    }

    // R²
    const yMean = ys.reduce((s, y) => s + y, 0) / n;
    const predict = (x) => coeffs.reduce((s, c, i) => s + c * Math.pow(x, i), 0);
    const ssRes = ys.reduce((s, y, i) => s + Math.pow(y - predict(xs[i]), 2), 0);
    const ssTot = ys.reduce((s, y) => s + Math.pow(y - yMean, 2), 0);
    const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    // Format equation
    const terms = coeffs.map((c, i) => {
      if (Math.abs(c) < 1e-10) return null;
      return i === 0 ? String(r(c)) : `${r(c)}x^${i}`;
    }).filter(Boolean).reverse().join(" + ");

    return {
      ok: true, result: {
        type: "polynomial", degree: deg,
        equation: `y = ${terms}`,
        coefficients: coeffs.map(r),
        rSquared: r(rSquared), n,
        fit: rSquared > 0.9 ? "excellent" : rSquared > 0.7 ? "good" : rSquared > 0.5 ? "moderate" : "poor",
      },
    };
  });
}
