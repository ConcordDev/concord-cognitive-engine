/**
 * Numerical Compute
 *
 * Numerical methods that don't require symbolic manipulation:
 * - Root finding (bisection, Newton-Raphson)
 * - Numerical integration (trapezoidal, Simpson's, adaptive)
 * - Numerical differentiation (central difference)
 * - ODE solvers (Euler, RK4)
 * - Linear system solving (Gauss elimination)
 * - Eigenvalue computation (power iteration)
 * - Optimization (gradient descent, golden section)
 *
 * Pure ES module. No dependencies.
 * All functions are pure: no side effects, numeric inputs/outputs.
 */

// ---------------------------------------------------------------------------
// Root finding
// ---------------------------------------------------------------------------

/**
 * Bisection method: finds a root of f in [a, b] where f(a) and f(b) have
 * opposite signs.
 *
 * Returns { root, iterations, converged, error }
 */
export function bisection(f, a, b, { tolerance = 1e-6, maxIter = 100 } = {}) {
  let fa = f(a);
  let fb = f(b);
  if (fa === 0) return { root: a, iterations: 0, converged: true, error: 0 };
  if (fb === 0) return { root: b, iterations: 0, converged: true, error: 0 };
  if (fa * fb > 0) {
    return {
      root: NaN,
      iterations: 0,
      converged: false,
      error: Infinity,
      reason: 'f(a) and f(b) have same sign',
    };
  }
  let lo = a;
  let hi = b;
  let mid = (lo + hi) / 2;
  for (let i = 1; i <= maxIter; i++) {
    mid = (lo + hi) / 2;
    const fm = f(mid);
    if (fm === 0 || (hi - lo) / 2 < tolerance) {
      return {
        root: mid,
        iterations: i,
        converged: true,
        error: (hi - lo) / 2,
      };
    }
    if (fa * fm < 0) {
      hi = mid;
      fb = fm;
    } else {
      lo = mid;
      fa = fm;
    }
  }
  return {
    root: mid,
    iterations: maxIter,
    converged: false,
    error: (hi - lo) / 2,
  };
}

/**
 * Newton-Raphson root finder.
 * df can be omitted; if so, uses numerical derivative.
 */
export function newtonRaphson(f, df, x0, { tolerance = 1e-6, maxIter = 50 } = {}) {
  const dF = typeof df === 'function' ? df : (x) => derivative(f, x);
  let x = x0;
  for (let i = 1; i <= maxIter; i++) {
    const fx = f(x);
    const dfx = dF(x);
    if (dfx === 0 || !Number.isFinite(dfx)) {
      return { root: x, iterations: i, converged: false, error: Math.abs(fx), reason: 'zero derivative' };
    }
    const next = x - fx / dfx;
    if (Math.abs(next - x) < tolerance) {
      return { root: next, iterations: i, converged: true, error: Math.abs(next - x) };
    }
    x = next;
  }
  return { root: x, iterations: maxIter, converged: false, error: Math.abs(f(x)) };
}

// ---------------------------------------------------------------------------
// Numerical integration
// ---------------------------------------------------------------------------

/**
 * Trapezoidal rule on n subintervals.
 */
export function trapezoidal(f, a, b, n = 1000) {
  if (n <= 0) n = 1;
  const h = (b - a) / n;
  let sum = 0.5 * (f(a) + f(b));
  for (let i = 1; i < n; i++) {
    sum += f(a + i * h);
  }
  return sum * h;
}

/**
 * Simpson's 1/3 rule on n subintervals (n must be even; rounded up if odd).
 */
export function simpson(f, a, b, n = 1000) {
  if (n <= 0) n = 2;
  if (n % 2 === 1) n += 1;
  const h = (b - a) / n;
  let sum = f(a) + f(b);
  for (let i = 1; i < n; i++) {
    const x = a + i * h;
    sum += (i % 2 === 0 ? 2 : 4) * f(x);
  }
  return (sum * h) / 3;
}

/**
 * Adaptive Simpson quadrature with tolerance control.
 */
export function adaptiveQuadrature(f, a, b, tolerance = 1e-6) {
  function simp(a, b, fa, fb, fm) {
    return ((b - a) / 6) * (fa + 4 * fm + fb);
  }
  function recurse(a, b, fa, fb, fm, whole, depth) {
    const m = (a + b) / 2;
    const lm = (a + m) / 2;
    const rm = (m + b) / 2;
    const flm = f(lm);
    const frm = f(rm);
    const left = simp(a, m, fa, fm, flm);
    const right = simp(m, b, fm, fb, frm);
    const diff = left + right - whole;
    if (depth <= 0 || Math.abs(diff) <= 15 * tolerance) {
      return left + right + diff / 15;
    }
    return (
      recurse(a, m, fa, fm, flm, left, depth - 1) +
      recurse(m, b, fm, fb, frm, right, depth - 1)
    );
  }
  const fa = f(a);
  const fb = f(b);
  const fm = f((a + b) / 2);
  const whole = simp(a, b, fa, fb, fm);
  return recurse(a, b, fa, fb, fm, whole, 30);
}

// ---------------------------------------------------------------------------
// Numerical differentiation
// ---------------------------------------------------------------------------

/**
 * Central difference derivative: f'(x) ≈ (f(x+h) - f(x-h)) / (2h)
 */
export function derivative(f, x, h = 1e-5) {
  return (f(x + h) - f(x - h)) / (2 * h);
}

/**
 * Second derivative via central difference.
 */
export function secondDerivative(f, x, h = 1e-4) {
  return (f(x + h) - 2 * f(x) + f(x - h)) / (h * h);
}

// ---------------------------------------------------------------------------
// ODE solvers
// ---------------------------------------------------------------------------

/**
 * Euler method for dy/dt = f(t, y).
 * y0 can be scalar or array (system of ODEs).
 * Returns array of { t, y }.
 */
export function eulerODE(f, y0, t0, tEnd, dt) {
  const isVec = Array.isArray(y0);
  const steps = Math.max(1, Math.ceil((tEnd - t0) / dt));
  const out = [];
  let t = t0;
  let y = isVec ? y0.slice() : y0;
  out.push({ t, y: isVec ? y.slice() : y });
  for (let i = 0; i < steps; i++) {
    const dy = f(t, y);
    if (isVec) {
      y = y.map((yi, k) => yi + dt * dy[k]);
    } else {
      y = y + dt * dy;
    }
    t += dt;
    out.push({ t, y: isVec ? y.slice() : y });
  }
  return out;
}

/**
 * Classical 4th-order Runge-Kutta.
 */
export function rk4ODE(f, y0, t0, tEnd, dt) {
  const isVec = Array.isArray(y0);
  const steps = Math.max(1, Math.ceil((tEnd - t0) / dt));
  const out = [];
  let t = t0;
  let y = isVec ? y0.slice() : y0;
  out.push({ t, y: isVec ? y.slice() : y });
  const addScaled = (a, b, s) => (isVec ? a.map((ai, i) => ai + s * b[i]) : a + s * b);
  for (let i = 0; i < steps; i++) {
    const k1 = f(t, y);
    const k2 = f(t + dt / 2, addScaled(y, k1, dt / 2));
    const k3 = f(t + dt / 2, addScaled(y, k2, dt / 2));
    const k4 = f(t + dt, addScaled(y, k3, dt));
    if (isVec) {
      y = y.map((yi, j) => yi + (dt / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
    } else {
      y = y + (dt / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    }
    t += dt;
    out.push({ t, y: isVec ? y.slice() : y });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Linear systems
// ---------------------------------------------------------------------------

/**
 * Solve Ax = b via Gaussian elimination with partial pivoting.
 * A is m x m; b is length m. Returns x (length m) or null if singular.
 */
export function solveLinearSystem(A, b) {
  const n = A.length;
  // Build augmented matrix (copy)
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    // Partial pivot
    let maxRow = i;
    let maxVal = Math.abs(M[i][i]);
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > maxVal) {
        maxVal = Math.abs(M[k][i]);
        maxRow = k;
      }
    }
    if (maxVal < 1e-14) return null; // singular
    if (maxRow !== i) {
      const tmp = M[i];
      M[i] = M[maxRow];
      M[maxRow] = tmp;
    }
    // Eliminate below
    for (let k = i + 1; k < n; k++) {
      const factor = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) {
        M[k][j] -= factor * M[i][j];
      }
    }
  }
  // Back substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

/**
 * Matrix-vector multiply.
 */
function matVec(A, v) {
  const n = A.length;
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < v.length; j++) s += A[i][j] * v[j];
    out[i] = s;
  }
  return out;
}

function vecNorm(v) {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

// ---------------------------------------------------------------------------
// Eigenvalues (power iteration)
// ---------------------------------------------------------------------------

/**
 * Power iteration for dominant eigenvalue/eigenvector of a square matrix.
 * Returns { eigenvalue, eigenvector, iterations, converged }
 */
export function powerIteration(matrix, { iterations = 100, tolerance = 1e-8 } = {}) {
  const n = matrix.length;
  let v = new Array(n).fill(0).map(() => Math.random() + 0.5);
  const norm = vecNorm(v);
  v = v.map((x) => x / norm);
  let lambda = 0;
  let converged = false;
  let iter = 0;
  for (iter = 1; iter <= iterations; iter++) {
    const w = matVec(matrix, v);
    const nw = vecNorm(w);
    if (nw === 0) break;
    const vNew = w.map((x) => x / nw);
    // Rayleigh quotient
    const Av = matVec(matrix, vNew);
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += vNew[i] * Av[i];
      den += vNew[i] * vNew[i];
    }
    const newLambda = num / den;
    if (Math.abs(newLambda - lambda) < tolerance) {
      lambda = newLambda;
      v = vNew;
      converged = true;
      break;
    }
    lambda = newLambda;
    v = vNew;
  }
  return { eigenvalue: lambda, eigenvector: v, iterations: iter, converged };
}

// ---------------------------------------------------------------------------
// Optimization
// ---------------------------------------------------------------------------

/**
 * Gradient descent.
 * f: objective (for monitoring), grad: gradient function returning array.
 * x0: initial array.
 */
export function gradientDescent(
  f,
  grad,
  x0,
  { learningRate = 0.01, iterations = 1000, tolerance = 1e-8 } = {}
) {
  let x = Array.isArray(x0) ? x0.slice() : [x0];
  const isScalar = !Array.isArray(x0);
  const history = [];
  let converged = false;
  let iter = 0;
  for (iter = 1; iter <= iterations; iter++) {
    const g = grad(isScalar ? x[0] : x);
    const gArr = Array.isArray(g) ? g : [g];
    let maxStep = 0;
    const next = x.map((xi, i) => {
      const step = learningRate * gArr[i];
      if (Math.abs(step) > maxStep) maxStep = Math.abs(step);
      return xi - step;
    });
    x = next;
    history.push({ x: x.slice(), f: f(isScalar ? x[0] : x) });
    if (maxStep < tolerance) {
      converged = true;
      break;
    }
  }
  return {
    x: isScalar ? x[0] : x,
    value: f(isScalar ? x[0] : x),
    iterations: iter,
    converged,
    history,
  };
}

/**
 * Golden section search for minimum of unimodal f in [a, b].
 */
export function goldenSection(f, a, b, tolerance = 1e-6) {
  const phi = (Math.sqrt(5) - 1) / 2; // ~0.618
  let lo = a;
  let hi = b;
  let x1 = hi - phi * (hi - lo);
  let x2 = lo + phi * (hi - lo);
  let f1 = f(x1);
  let f2 = f(x2);
  let iter = 0;
  const maxIter = 1000;
  while (Math.abs(hi - lo) > tolerance && iter < maxIter) {
    if (f1 < f2) {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = hi - phi * (hi - lo);
      f1 = f(x1);
    } else {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = lo + phi * (hi - lo);
      f2 = f(x2);
    }
    iter++;
  }
  const x = (lo + hi) / 2;
  return {
    x,
    value: f(x),
    iterations: iter,
    converged: Math.abs(hi - lo) <= tolerance,
    interval: [lo, hi],
  };
}

// ---------------------------------------------------------------------------
// Utilities (matrix helpers exported for convenience)
// ---------------------------------------------------------------------------

export function matrixMultiply(A, B) {
  const n = A.length;
  const m = B[0].length;
  const p = B.length;
  const C = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let k = 0; k < p; k++) s += A[i][k] * B[k][j];
      C[i][j] = s;
    }
  }
  return C;
}

export function transpose(A) {
  const n = A.length;
  const m = A[0].length;
  const T = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) T[j][i] = A[i][j];
  return T;
}

export function identity(n) {
  const I = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) I[i][i] = 1;
  return I;
}

export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function norm(v) {
  return vecNorm(v);
}
