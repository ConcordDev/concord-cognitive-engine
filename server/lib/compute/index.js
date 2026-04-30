/**
 * Compute Primitives — Unified export surface
 *
 * Domain-independent computational modules callable by the Oracle Engine
 * and any domain handler.
 *
 *   import { logic, symbolic, numerical } from './compute/index.js';
 *   logic.isTautology('P ∨ ¬P');
 *   symbolic.differentiate('x^2 + 3*x');
 *   numerical.bisection(f, 0, 10);
 *
 * Or lazily:
 *   const mod = await loadComputeModule('symbolic');
 */

export * as logic from './formal-logic.js';
export * as symbolic from './symbolic-math.js';
export * as numerical from './numerical.js';
export * as engineering from './engineering-compute.js';
export * as physics from './physics-compute.js';
export * as statistics from './statistics-compute.js';
export * as chemistry from './chemistry-compute.js';
export * as quantum from './quantum-compute.js';

/**
 * Lazy-load a compute module by name.
 * Returns the module namespace or null if the name is unknown.
 */
export async function loadComputeModule(name) {
  switch (name) {
    case 'logic':
    case 'formal-logic':
      return await import('./formal-logic.js');
    case 'symbolic':
    case 'symbolic-math':
      return await import('./symbolic-math.js');
    case 'numerical':
    case 'numeric':
      return await import('./numerical.js');
    case 'engineering':
    case 'engineering-compute':
      return await import('./engineering-compute.js');
    case 'physics':
    case 'physics-compute':
      return await import('./physics-compute.js');
    case 'statistics':
    case 'statistics-compute':
      return await import('./statistics-compute.js');
    case 'chemistry':
    case 'chemistry-compute':
    case 'chem':
      return await import('./chemistry-compute.js');
    case 'quantum':
    case 'quantum-compute':
      return await import('./quantum-compute.js');
    default:
      return null;
  }
}

/**
 * List the compute modules available to the engine.
 */
export function listComputeModules() {
  return [
    {
      name: 'logic',
      description:
        'Propositional/first-order logic: parse, evaluate, truth tables, tautology/SAT, natural deduction, CNF/DNF',
    },
    {
      name: 'symbolic',
      description:
        'Symbolic algebra/calculus: simplify, expand, differentiate, integrate, solve (linear/quadratic/cubic), substitute',
    },
    {
      name: 'numerical',
      description:
        'Numerical methods: root finding, quadrature, ODE solvers, linear systems, eigenvalues, optimization',
    },
    {
      name: 'engineering',
      description:
        'Structural/electrical/thermal engineering: reinforced concrete, column buckling, weld strength, circuit analysis',
    },
    {
      name: 'physics',
      description:
        'Classical mechanics/thermodynamics: wind load, moment of inertia, beam deflection, heat transfer',
    },
    {
      name: 'statistics',
      description:
        'Bayesian inference, regression, distributions: normal PDF/CDF, binomial, hypothesis testing, confidence intervals',
    },
    {
      name: 'chemistry',
      description:
        'Molecular analysis, reaction balancing, solution chemistry (pH/pOH), enthalpy (Hess\'s Law), Gibbs free energy',
    },
    {
      name: 'quantum',
      description:
        'Quantum circuit statevector simulation: H/CNOT/Phase gates, Bell states, circuit depth, entropy, measurement',
    },
  ];
}
