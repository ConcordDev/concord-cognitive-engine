/**
 * Simulation Routes
 *
 * Async job system for compute-intensive workloads (FEA, multi-physics, etc.).
 * Jobs return immediately with a jobId; client polls GET /api/simulation/:id.
 *
 * POST /api/simulation/run      — queue a job, returns { ok, jobId }
 * GET  /api/simulation/:id      — poll job status / result
 * GET  /api/simulation          — list recent jobs
 * POST /api/simulation/:id/cancel — cancel a queued job
 */

import { Router } from 'express';
import { createJob, getJob, listJobs, runJob, cancelJob } from '../lib/simulation/simulation-jobs.js';
import { runFEA } from '../lib/simulation/fea-solver.js';
import {
  molecularAnalysis, balanceReaction, solutionChemistry,
  enthalpyOfReaction, gibbsFreeEnergy,
} from '../lib/compute/chemistry-compute.js';
import { simulateCircuit, analyzeCircuit } from '../lib/compute/quantum-compute.js';
import * as acorn from 'acorn';

// Sprint 18.4 — AST whitelist for the monte-carlo `fn` expression.
// Same shape as domains/invariant.js#validateExpressionAST. Rejects
// CallExpression / NewExpression / arrow funcs / computed-member / forbidden
// globals before the Function ctor is invoked. The math.* identifiers
// (sin, cos, sqrt, abs, exp, log, PI, E) are explicitly allowed via the
// caller; everything else resolves to undefined → expression evaluates to NaN.
const MAX_FN_LEN = 500;
const ALLOWED_AST_NODES = new Set([
  'Program', 'ExpressionStatement',
  'BinaryExpression', 'LogicalExpression', 'UnaryExpression', 'ConditionalExpression',
  'MemberExpression', 'Identifier', 'Literal',
  'ArrayExpression', 'SequenceExpression',
]);
const FORBIDDEN_FN_IDENTIFIERS = new Set([
  'Function', 'eval', 'constructor', '__proto__', 'prototype',
  'globalThis', 'global', 'process', 'require', 'module', 'exports',
  'setTimeout', 'setInterval', 'setImmediate', 'fetch', 'import',
  'WebAssembly', 'Reflect', 'Proxy',
]);
function validateMonteCarloFn(expr) {
  if (typeof expr !== 'string' || !expr) return { ok: false, reason: 'empty' };
  if (expr.length > MAX_FN_LEN) return { ok: false, reason: 'too_long' };
  let ast;
  try { ast = acorn.parseExpressionAt(expr, 0, { ecmaVersion: 2020 }); }
  catch (e) { return { ok: false, reason: `parse_error:${e.message}` }; }
  let violation = null;
  (function walk(node) {
    if (violation || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.type && !ALLOWED_AST_NODES.has(node.type)) {
      violation = `disallowed_node:${node.type}`; return;
    }
    if (node.type === 'MemberExpression' && node.computed) {
      violation = 'disallowed_computed_member'; return;
    }
    if (node.type === 'Identifier' && FORBIDDEN_FN_IDENTIFIERS.has(node.name)) {
      violation = `forbidden_identifier:${node.name}`; return;
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'range' || k === 'start' || k === 'end') continue;
      walk(node[k]);
    }
  })(ast);
  return violation ? { ok: false, reason: violation } : { ok: true };
}

const EXECUTORS = {
  'fea-frame': (input) => runFEA(input),

  'chem-balance': (input) => {
    if (input.equation) return balanceReaction(input);
    if (input.formula)  return molecularAnalysis(input);
    if (input.type)     return solutionChemistry(input);
    return { ok: false, error: 'Provide equation, formula, or type for chem job' };
  },

  'quantum-circuit': (input) => {
    if (input.analyze) return analyzeCircuit(input);
    return simulateCircuit(input);
  },

  'multiphysics': async (input) => {
    // Chain: structural → thermal → fluid coupling
    const results = {};
    if (input.structural) results.structural = runFEA(input.structural);
    if (input.chemistry)  results.chemistry  = balanceReaction(input.chemistry);
    if (input.quantum)    results.quantum     = simulateCircuit(input.quantum);
    return { ok: true, results };
  },

  'monte-carlo-stats': (input) => {
    // Simple Monte Carlo integration / uncertainty propagation
    const { samples = 1000, fn, params = {} } = input;
    if (!fn) return { ok: false, error: 'fn required (string expression)' };

    // Safety: AST whitelist via acorn rejects CallExpression / NewExpression /
    // arrow funcs / computed-member access / forbidden globals before the
    // Function ctor runs. The regex check at the legacy site was insufficient
    // (a leading `(` opened a bypass — `fn = "(this.constructor.constructor('return process')())"`).
    const astCheck = validateMonteCarloFn(fn);
    if (!astCheck.ok) {
      return { ok: false, error: `unsafe_expression:${astCheck.reason}` };
    }

    const results = [];
    try {
      const math = { sin: Math.sin, cos: Math.cos, sqrt: Math.sqrt, abs: Math.abs,
                     exp: Math.exp, log: Math.log, PI: Math.PI, E: Math.E };
      // The `fn` expression has been validated by validateMonteCarloFn()
      // above — acorn AST whitelist rejects CallExpression / NewExpression /
      // arrow functions / forbidden identifiers before this line runs.
      // This file is excluded from Semgrep's concord-eval-or-function-ctor
      // rule via .semgrep.yml paths.exclude (the AST whitelist is a
      // stricter guard than the lexical pattern match).
      // eslint-disable-next-line no-new-func
      const evalFn = new Function(...Object.keys(math), 'x', `return ${fn}`);
      for (let i = 0; i < Math.min(samples, 10000); i++) {
        const x = (Math.random() - 0.5) * 2 * (params.range || 1);
        results.push(evalFn(...Object.values(math), x));
      }
    } catch (e) {
      return { ok: false, error: `Expression error: ${e.message}` };
    }

    const n    = results.length;
    const mean = results.reduce((s, v) => s + v, 0) / n;
    const variance = results.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const sorted = results.slice().sort((a, b) => a - b);

    return {
      ok: true,
      samples: n,
      mean: parseFloat(mean.toFixed(6)),
      stdDev: parseFloat(Math.sqrt(variance).toFixed(6)),
      min: parseFloat(sorted[0].toFixed(6)),
      max: parseFloat(sorted[n - 1].toFixed(6)),
      p25: parseFloat(sorted[Math.floor(n * 0.25)].toFixed(6)),
      p50: parseFloat(sorted[Math.floor(n * 0.50)].toFixed(6)),
      p75: parseFloat(sorted[Math.floor(n * 0.75)].toFixed(6)),
    };
  },
};

const ALLOWED_TYPES = new Set(Object.keys(EXECUTORS));

export function createSimulationRouter() {
  const router = Router();

  // POST /api/simulation/run — queue job, return immediately
  router.post('/run', async (req, res) => {
    try {
      const { type, input = {} } = req.body || {};

      if (!type || !ALLOWED_TYPES.has(type)) {
        return res.status(400).json({
          ok: false,
          error: `type must be one of: ${[...ALLOWED_TYPES].join(', ')}`,
        });
      }

      const { id } = createJob(type, input);

      // Run async without blocking response
      const executor = EXECUTORS[type];
      runJob(id, () => executor(input)).catch(() => {});

      return res.json({ ok: true, jobId: id, status: 'queued' });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // GET /api/simulation — list recent jobs
  router.get('/', (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const jobs  = listJobs(limit).map(j => ({
        id: j.id, type: j.type, status: j.status,
        progress: j.progress, createdAt: j.createdAt,
        completedAt: j.completedAt, error: j.error,
      }));
      return res.json({ ok: true, jobs, count: jobs.length });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // GET /api/simulation/:id — poll job
  router.get('/:id', (req, res) => {
    try {
      const job = getJob(req.params.id);
      if (!job) return res.status(404).json({ ok: false, error: 'Job not found' });
      return res.json({ ok: true, job });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // POST /api/simulation/:id/cancel
  router.post('/:id/cancel', (req, res) => {
    try {
      const result = cancelJob(req.params.id);
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  return router;
}
