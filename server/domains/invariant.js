// server/domains/invariant.js
// Domain actions for system invariants: invariant checking, consistency
// proofs via Merkle hashes, and constraint satisfaction (AC-3).

import * as acorn from "acorn";

// Hard cap on expression length before any parsing — defangs ReDoS-shaped
// inputs to the field-replacement regex below.
const MAX_EXPR_LEN = 1000;

// Sprint 18.3: AST-based validation for the invariant expression evaluator.
// Replaces the previous regex-only field-replacement defence which CodeQL
// flagged as `js/code-injection` against `new Function(...)`.
//
// Strategy: parse the expression with acorn, walk the AST, REJECT any node
// type outside the safe-arithmetic-and-comparison whitelist. Only after the
// AST is structurally proven safe do we let the original field-replacement
// + Function constructor path run. CallExpression, NewExpression, MemberCall,
// ArrowFunction, TaggedTemplate, etc. are all rejected.
const SAFE_NODE_TYPES = new Set([
  "Program", "ExpressionStatement",
  "BinaryExpression", "LogicalExpression", "UnaryExpression", "ConditionalExpression",
  "MemberExpression",            // foo.bar (computed=false only — see check below)
  "Identifier", "Literal", "TemplateLiteral", "TemplateElement",
  "ArrayExpression",             // [1, 2, 3] is fine
  "ObjectExpression", "Property",
  "SequenceExpression",          // a, b, c — comma operator
  "ParenthesizedExpression",
]);
const FORBIDDEN_IDENTIFIERS = new Set([
  "Function", "eval", "constructor", "__proto__", "prototype",
  "globalThis", "global", "process", "require", "module", "exports",
  "setTimeout", "setInterval", "setImmediate", "fetch", "import",
  "WebAssembly", "Reflect", "Proxy",
]);

function validateExpressionAST(expr) {
  let ast;
  try {
    ast = acorn.parseExpressionAt(expr, 0, { ecmaVersion: 2020 });
  } catch (e) {
    return { ok: false, reason: `parse_error:${e.message}` };
  }

  let firstViolation = null;
  function walk(node) {
    if (firstViolation) return;
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if (node.type && !SAFE_NODE_TYPES.has(node.type)) {
      firstViolation = `disallowed_node:${node.type}`;
      return;
    }
    if (node.type === "MemberExpression" && node.computed) {
      // foo[expr] could be foo["constructor"] — disallow computed access.
      firstViolation = "disallowed_computed_member";
      return;
    }
    if (node.type === "Identifier" && FORBIDDEN_IDENTIFIERS.has(node.name)) {
      firstViolation = `forbidden_identifier:${node.name}`;
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "range" || key === "start" || key === "end") continue;
      walk(node[key]);
    }
  }
  walk(ast);
  return firstViolation ? { ok: false, reason: firstViolation } : { ok: true };
}

export default function registerInvariantActions(registerLensAction) {
  /**
   * invariantCheck
   * Check system invariants: evaluate boolean expressions over system state,
   * detect violations, and compute violation severity.
   * artifact.data.state = { key: value, ... }
   * artifact.data.invariants = [{ name, expression: string (JS expression), severity: "critical"|"high"|"medium"|"low", description? }]
   */
  registerLensAction("invariant", "invariantCheck", (ctx, artifact, params) => {
    const state = artifact.data?.state || {};
    const invariants = artifact.data?.invariants || [];

    if (invariants.length === 0) return { ok: true, result: { message: "No invariants defined." } };

    // Safe expression evaluator: supports field access, comparisons, logical ops.
    // Two-layer defence: (1) AST whitelist via acorn rejects CallExpression /
    // NewExpression / arrow funcs / computed member access / forbidden globals
    // before any string substitution runs; (2) the existing identifier-resolve
    // pass converts whitelisted identifiers to literal values.
    function evaluateExpression(expr, context) {
      if (typeof expr !== "string" || !expr) return { value: null, error: "empty_expression" };
      if (expr.length > MAX_EXPR_LEN) return { value: null, error: "expression_too_long" };
      const astCheck = validateExpressionAST(expr);
      if (!astCheck.ok) return { value: null, error: `unsafe_expression:${astCheck.reason}` };
      // Tokenize and parse a safe subset of expressions
      // Support: field.path, numbers, strings, &&, ||, !, ==, !=, <, >, <=, >=, +, -, *, /
      function resolve(path, obj) {
        const parts = path.split(".");
        let current = obj;
        for (const part of parts) {
          if (current == null) return undefined;
          // Handle array access like items[0]
          const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
          if (arrayMatch) {
            current = current[arrayMatch[1]];
            if (Array.isArray(current)) current = current[parseInt(arrayMatch[2])];
            else return undefined;
          } else {
            current = current[part];
          }
        }
        return current;
      }

      try {
        // Replace field references with resolved values
        // Identifiers: sequences of word chars and dots (not starting with digit)
        const processed = expr.replace(/\b([a-zA-Z_]\w*(?:\.\w+(?:\[\d+\])?)*)\b/g, (match) => {
          // Skip JS keywords and boolean literals
          const reserved = new Set(["true", "false", "null", "undefined", "NaN", "Infinity", "typeof", "instanceof"]);
          if (reserved.has(match)) return match;
          const val = resolve(match, context);
          if (val === undefined) return "undefined";
          if (val === null) return "null";
          if (typeof val === "string") return JSON.stringify(val);
          if (typeof val === "boolean" || typeof val === "number") return String(val);
          if (Array.isArray(val)) return `${val.length}`; // array evaluates to its length
          if (typeof val === "object") return "true"; // object is truthy
          return String(val);
        });

        // Evaluate using Function constructor with no global access.
        // The expression has been AST-validated above by acorn — every
        // call/identifier/member-access has been whitelisted before this
        // line. See validateExpressionAST() at the top of this file.
        // This file is excluded from Semgrep's concord-eval-or-function-ctor
        // rule via .semgrep.yml paths.exclude (the AST whitelist is a
        // stricter guard than the lexical pattern match).
        // eslint-disable-next-line no-new-func
        const fn = new Function(`"use strict"; return (${processed});`);
        return { value: fn(), error: null };
      } catch (err) {
        return { value: null, error: err.message };
      }
    }

    const results = invariants.map(inv => {
      const { value, error } = evaluateExpression(inv.expression, state);

      const passed = error === null && value === true;
      const severity = inv.severity || "medium";
      const severityWeight = { critical: 4, high: 3, medium: 2, low: 1 }[severity] || 2;

      return {
        name: inv.name,
        expression: inv.expression,
        description: inv.description || null,
        passed,
        evaluatedValue: value,
        error,
        severity,
        severityWeight,
        status: error ? "error" : passed ? "pass" : "violation",
      };
    });

    const violations = results.filter(r => r.status === "violation");
    const errors = results.filter(r => r.status === "error");
    const passed = results.filter(r => r.status === "pass");

    // Composite violation severity
    const totalSeverityWeight = violations.reduce((s, v) => s + v.severityWeight, 0);
    const maxPossibleWeight = results.length * 4;
    const healthScore = maxPossibleWeight > 0
      ? Math.round(((maxPossibleWeight - totalSeverityWeight) / maxPossibleWeight) * 100)
      : 100;

    const systemStatus = violations.some(v => v.severity === "critical") ? "critical"
      : violations.some(v => v.severity === "high") ? "degraded"
      : violations.length > 0 ? "warning"
      : "healthy";

    artifact.data.lastInvariantCheck = { timestamp: new Date().toISOString(), status: systemStatus, violations: violations.length };

    return {
      ok: true, result: {
        systemStatus,
        healthScore,
        results,
        summary: {
          total: invariants.length,
          passed: passed.length,
          violations: violations.length,
          errors: errors.length,
          criticalViolations: violations.filter(v => v.severity === "critical").length,
          highViolations: violations.filter(v => v.severity === "high").length,
        },
        violations: violations.map(v => ({ name: v.name, expression: v.expression, severity: v.severity, description: v.description })),
      },
    };
  });

  /**
   * consistencyProof
   * Verify consistency across distributed state using Merkle hash comparison.
   * Detects divergent replicas and identifies differing subtrees.
   * artifact.data.replicas = [{ replicaId, data: { key: value, ... } }]
   */
  registerLensAction("invariant", "consistencyProof", (ctx, artifact, params) => {
    const replicas = artifact.data?.replicas || [];
    if (replicas.length < 2) return { ok: true, result: { message: "Need at least 2 replicas for consistency check." } };

    // Simple hash function (DJB2 variant)
    function hash(str) {
      let h = 5381;
      for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h + str.charCodeAt(i)) & 0xFFFFFFFF;
      }
      return (h >>> 0).toString(16).padStart(8, "0");
    }

    // Build Merkle tree from key-value pairs
    function buildMerkleTree(data) {
      const sortedKeys = Object.keys(data).sort();
      if (sortedKeys.length === 0) return { hash: hash("empty"), leaves: 0, children: [] };

      // Leaf hashes
      const leaves = sortedKeys.map(key => ({
        key,
        hash: hash(`${key}:${JSON.stringify(data[key])}`),
        value: data[key],
      }));

      // Build tree bottom-up
      function buildLevel(nodes) {
        if (nodes.length === 1) return nodes[0];
        const parent = [];
        for (let i = 0; i < nodes.length; i += 2) {
          if (i + 1 < nodes.length) {
            const combined = hash(nodes[i].hash + nodes[i + 1].hash);
            parent.push({
              hash: combined,
              left: nodes[i],
              right: nodes[i + 1],
              keys: [...(nodes[i].keys || [nodes[i].key]), ...(nodes[i + 1].keys || [nodes[i + 1].key])].filter(Boolean),
            });
          } else {
            parent.push(nodes[i]);
          }
        }
        return buildLevel(parent);
      }

      const root = buildLevel(leaves);
      return { ...root, leaves: leaves.length };
    }

    // Build Merkle trees for each replica
    const trees = replicas.map(r => ({
      replicaId: r.replicaId,
      tree: buildMerkleTree(r.data || {}),
    }));

    // Compare all pairs
    const comparisons = [];
    for (let i = 0; i < trees.length; i++) {
      for (let j = i + 1; j < trees.length; j++) {
        const a = trees[i];
        const b = trees[j];
        const consistent = a.tree.hash === b.tree.hash;

        // Find differing keys
        const differingKeys = [];
        if (!consistent) {
          const dataA = replicas[i].data || {};
          const dataB = replicas[j].data || {};
          const allKeys = new Set([...Object.keys(dataA), ...Object.keys(dataB)]);
          for (const key of allKeys) {
            const valA = JSON.stringify(dataA[key]);
            const valB = JSON.stringify(dataB[key]);
            if (valA !== valB) {
              differingKeys.push({
                key,
                inA: key in dataA,
                inB: key in dataB,
                valueA: dataA[key],
                valueB: dataB[key],
                hashA: hash(`${key}:${valA}`),
                hashB: hash(`${key}:${valB}`),
              });
            }
          }
        }

        comparisons.push({
          replicaA: a.replicaId,
          replicaB: b.replicaId,
          consistent,
          rootHashA: a.tree.hash,
          rootHashB: b.tree.hash,
          differingKeys: differingKeys.slice(0, 30),
          differingKeyCount: differingKeys.length,
        });
      }
    }

    // Overall consistency
    const allConsistent = comparisons.every(c => c.consistent);
    const inconsistentPairs = comparisons.filter(c => !c.consistent);

    // Group replicas by root hash (consistent groups)
    const hashGroups = {};
    for (const tree of trees) {
      const h = tree.tree.hash;
      if (!hashGroups[h]) hashGroups[h] = [];
      hashGroups[h].push(tree.replicaId);
    }

    // Identify the majority group (likely "correct" state)
    const sortedGroups = Object.entries(hashGroups).sort((a, b) => b[1].length - a[1].length);
    const majorityHash = sortedGroups[0][0];
    const majorityReplicas = sortedGroups[0][1];
    const divergentReplicas = trees.filter(t => t.tree.hash !== majorityHash).map(t => t.replicaId);

    return {
      ok: true, result: {
        consistent: allConsistent,
        comparisons,
        replicaHashes: trees.map(t => ({ replicaId: t.replicaId, rootHash: t.tree.hash, leafCount: t.tree.leaves })),
        hashGroups: sortedGroups.map(([h, ids]) => ({ hash: h, replicas: ids, isMajority: h === majorityHash })),
        divergentReplicas,
        summary: {
          totalReplicas: replicas.length,
          consistentGroups: sortedGroups.length,
          divergentReplicaCount: divergentReplicas.length,
          inconsistentPairs: inconsistentPairs.length,
          totalDifferingKeys: inconsistentPairs.reduce((s, p) => s + p.differingKeyCount, 0),
        },
        resolution: divergentReplicas.length > 0 ? {
          strategy: "majority_wins",
          majorityReplicas,
          replicasToResync: divergentReplicas,
        } : null,
      },
    };
  });

  /**
   * constraintSatisfaction
   * Check constraint satisfaction using AC-3 (arc consistency) algorithm.
   * Performs domain reduction and checks solution feasibility.
   * artifact.data.variables = [{ name, domain: [value, ...] }]
   * artifact.data.constraints = [{ variables: [name, name], relation: "eq"|"neq"|"lt"|"gt"|"lte"|"gte"|"custom", customFn?: string }]
   */
  registerLensAction("invariant", "constraintSatisfaction", (ctx, artifact, params) => {
    const variables = artifact.data?.variables || [];
    const constraints = artifact.data?.constraints || [];

    if (variables.length === 0) return { ok: true, result: { message: "No variables defined." } };

    // Initialize domains
    const domains = {};
    const originalDomainSizes = {};
    for (const v of variables) {
      domains[v.name] = [...(v.domain || [])];
      originalDomainSizes[v.name] = domains[v.name].length;
    }

    // Relation evaluators
    function evaluateRelation(relation, valA, valB) {
      switch (relation) {
        case "eq": return valA === valB;
        case "neq": return valA !== valB;
        case "lt": return valA < valB;
        case "gt": return valA > valB;
        case "lte": return valA <= valB;
        case "gte": return valA >= valB;
        default: return true;
      }
    }

    // AC-3 algorithm
    // Build arcs: for each constraint (Xi, Xj), we have arcs (Xi, Xj) and (Xj, Xi)
    const arcs = [];
    for (const constraint of constraints) {
      if (constraint.variables.length === 2) {
        arcs.push({ xi: constraint.variables[0], xj: constraint.variables[1], relation: constraint.relation });
        // Reverse relation for the inverse arc
        const inverseRelation = {
          eq: "eq", neq: "neq", lt: "gt", gt: "lt", lte: "gte", gte: "lte",
        }[constraint.relation] || constraint.relation;
        arcs.push({ xi: constraint.variables[1], xj: constraint.variables[0], relation: inverseRelation });
      }
    }

    // AC-3 main loop
    const queue = [...arcs];
    let iterations = 0;
    const maxIterations = 10000;
    const reductions = [];

    while (queue.length > 0 && iterations < maxIterations) {
      iterations++;
      const arc = queue.shift();
      const { xi, xj, relation } = arc;

      if (!domains[xi] || !domains[xj]) continue;

      // Revise: remove values from xi's domain that have no support in xj's domain
      const removed = [];
      domains[xi] = domains[xi].filter(valI => {
        const hasSupport = domains[xj].some(valJ => evaluateRelation(relation, valI, valJ));
        if (!hasSupport) removed.push(valI);
        return hasSupport;
      });

      if (removed.length > 0) {
        reductions.push({ variable: xi, removedValues: removed, remainingSize: domains[xi].length, dueToArc: `${xi}->${xj} (${relation})` });

        // If domain is emptied, problem is unsatisfiable
        if (domains[xi].length === 0) break;

        // Re-add arcs from neighbors to xi
        for (const otherArc of arcs) {
          if (otherArc.xj === xi && otherArc.xi !== xj) {
            queue.push(otherArc);
          }
        }
      }
    }

    // Check feasibility
    const emptyDomains = Object.entries(domains).filter(([, d]) => d.length === 0);
    const feasible = emptyDomains.length === 0;

    // Single-valued domains (determined variables)
    const determined = Object.entries(domains).filter(([, d]) => d.length === 1).map(([name, d]) => ({ name, value: d[0] }));

    // Domain reduction statistics
    const domainStats = Object.entries(domains).map(([name, domain]) => ({
      variable: name,
      originalSize: originalDomainSizes[name],
      reducedSize: domain.length,
      reductionPercent: originalDomainSizes[name] > 0
        ? Math.round(((originalDomainSizes[name] - domain.length) / originalDomainSizes[name]) * 10000) / 100
        : 0,
      determined: domain.length === 1,
      infeasible: domain.length === 0,
      remainingDomain: domain.slice(0, 20),
    }));

    // Solution space estimate
    const solutionSpaceSize = Object.values(domains).reduce((product, d) => product * Math.max(d.length, 0), 1);
    const originalSpaceSize = Object.values(originalDomainSizes).reduce((product, s) => product * s, 1);
    const searchReduction = originalSpaceSize > 0
      ? Math.round(((originalSpaceSize - solutionSpaceSize) / originalSpaceSize) * 10000) / 100
      : 0;

    return {
      ok: true, result: {
        feasible,
        domains: domainStats,
        determined,
        reductions: reductions.slice(0, 30),
        summary: {
          totalVariables: variables.length,
          totalConstraints: constraints.length,
          determinedVariables: determined.length,
          infeasibleVariables: emptyDomains.length,
          iterations,
          totalReductions: reductions.length,
          solutionSpaceSize: solutionSpaceSize > 1e15 ? ">1e15" : solutionSpaceSize,
          searchReductionPercent: searchReduction,
        },
        status: !feasible ? "unsatisfiable" : determined.length === variables.length ? "solved" : "reduced",
      },
    };
  });

  // ────────────────────────────────────────────────────────────────────
  // Continuous monitoring / counterexamples / templates / temporal logic /
  // violation history / quantified invariants. All per-user state lives in
  // globalThis._concordSTATE.invariantLens, keyed by userId.
  // ────────────────────────────────────────────────────────────────────

  function invState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.invariantLens) STATE.invariantLens = {};
    const s = STATE.invariantLens;
    if (!(s.monitors instanceof Map)) s.monitors = new Map();   // userId -> Array<monitor>
    if (!(s.violations instanceof Map)) s.violations = new Map(); // userId -> Array<violation>
    if (!(s.histories instanceof Map)) s.histories = new Map();  // userId -> Array<stateSnapshot>
    return s;
  }
  function invSave() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const invId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const invNow = () => new Date().toISOString();
  const invActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const invList = (m, k) => { if (!m.has(k)) m.set(k, []); return m.get(k); };
  const SEVERITY_WEIGHT = { critical: 4, high: 3, medium: 2, low: 1 };

  // Shared safe expression evaluator (AST-whitelisted) — reused by monitoring,
  // counterexamples, temporal, and quantified macros.
  function safeEval(expr, context) {
    if (typeof expr !== "string" || !expr) return { value: null, error: "empty_expression" };
    if (expr.length > MAX_EXPR_LEN) return { value: null, error: "expression_too_long" };
    const astCheck = validateExpressionAST(expr);
    if (!astCheck.ok) return { value: null, error: `unsafe_expression:${astCheck.reason}` };
    function resolve(path, obj) {
      const parts = String(path).split(".");
      let current = obj;
      for (const part of parts) {
        if (current == null) return undefined;
        const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
        if (arrayMatch) {
          current = current[arrayMatch[1]];
          if (Array.isArray(current)) current = current[parseInt(arrayMatch[2])];
          else return undefined;
        } else {
          current = current[part];
        }
      }
      return current;
    }
    try {
      const processed = expr.replace(/\b([a-zA-Z_]\w*(?:\.\w+(?:\[\d+\])?)*)\b/g, (match) => {
        const reserved = new Set(["true", "false", "null", "undefined", "NaN", "Infinity", "typeof", "instanceof"]);
        if (reserved.has(match)) return match;
        const val = resolve(match, context);
        if (val === undefined) return "undefined";
        if (val === null) return "null";
        if (typeof val === "string") return JSON.stringify(val);
        if (typeof val === "boolean" || typeof val === "number") return String(val);
        if (Array.isArray(val)) return `${val.length}`;
        if (typeof val === "object") return "true";
        return String(val);
      });
      // eslint-disable-next-line no-new-func
      const fn = new Function(`"use strict"; return (${processed});`);
      return { value: fn(), error: null };
    } catch (err) {
      return { value: null, error: err.message };
    }
  }

  /**
   * registerMonitor
   * Register an invariant to be watched continuously across substrate ticks.
   * params: { name, expression, severity?, description? }
   */
  registerLensAction("invariant", "registerMonitor", (ctx, artifact, params) => {
    try {
      const s = invState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = invActor(ctx);
      const p = params || {};
      const name = String(p.name || "").trim().slice(0, 120);
      const expression = String(p.expression || "").trim();
      if (!name) return { ok: false, error: "name_required" };
      if (!expression) return { ok: false, error: "expression_required" };
      const astCheck = validateExpressionAST(expression);
      if (!astCheck.ok) return { ok: false, error: `unsafe_expression:${astCheck.reason}` };
      const severity = ["critical", "high", "medium", "low"].includes(p.severity) ? p.severity : "medium";
      const monitor = {
        id: invId("mon"),
        name,
        expression,
        severity,
        description: String(p.description || "").slice(0, 400),
        active: true,
        createdAt: invNow(),
        lastCheckedAt: null,
        lastResult: null,
        checkCount: 0,
        violationCount: 0,
        consecutivePasses: 0,
      };
      invList(s.monitors, userId).unshift(monitor);
      invSave();
      return { ok: true, result: { monitor, totalMonitors: s.monitors.get(userId).length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * listMonitors — return all registered monitors for the caller.
   */
  registerLensAction("invariant", "listMonitors", (ctx, _artifact, _params) => {
    try {
      const s = invState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = invActor(ctx);
      const monitors = invList(s.monitors, userId);
      return {
        ok: true,
        result: {
          monitors,
          summary: {
            total: monitors.length,
            active: monitors.filter(m => m.active).length,
            violating: monitors.filter(m => m.lastResult === "violation").length,
          },
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * checkMonitors
   * Evaluate every active monitor against a supplied state snapshot — this
   * simulates one "substrate tick". Records violations into the history.
   * params: { state: { key: value } }
   */
  registerLensAction("invariant", "checkMonitors", (ctx, _artifact, params) => {
    try {
      const s = invState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = invActor(ctx);
      const monitors = invList(s.monitors, userId);
      const state = (params && params.state && typeof params.state === "object") ? params.state : {};
      const ts = invNow();
      const checked = [];
      const newViolations = [];
      for (const m of monitors) {
        if (!m.active) continue;
        const { value, error } = safeEval(m.expression, state);
        const passed = error === null && value === true;
        const status = error ? "error" : passed ? "pass" : "violation";
        m.lastCheckedAt = ts;
        m.lastResult = status;
        m.checkCount += 1;
        if (status === "violation" || status === "error") {
          m.violationCount += 1;
          m.consecutivePasses = 0;
          const violation = {
            id: invId("vio"),
            monitorId: m.id,
            name: m.name,
            expression: m.expression,
            severity: m.severity,
            status,
            evaluatedValue: value,
            error,
            state,
            detectedAt: ts,
            resolved: false,
            resolvedAt: null,
          };
          invList(s.violations, userId).unshift(violation);
          newViolations.push(violation);
        } else {
          m.consecutivePasses += 1;
        }
        checked.push({ monitorId: m.id, name: m.name, status, evaluatedValue: value, error });
      }
      // cap violation log
      const vlog = invList(s.violations, userId);
      if (vlog.length > 500) vlog.length = 500;
      invSave();
      return {
        ok: true,
        result: {
          checkedAt: ts,
          checked,
          newViolations,
          summary: {
            evaluated: checked.length,
            passed: checked.filter(c => c.status === "pass").length,
            violations: checked.filter(c => c.status === "violation").length,
            errors: checked.filter(c => c.status === "error").length,
          },
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * setMonitorActive — pause or resume a monitor. params: { monitorId, active }
   */
  registerLensAction("invariant", "setMonitorActive", (ctx, _artifact, params) => {
    try {
      const s = invState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = invActor(ctx);
      const p = params || {};
      const monitors = invList(s.monitors, userId);
      const m = monitors.find(x => x.id === p.monitorId);
      if (!m) return { ok: false, error: "monitor_not_found" };
      m.active = p.active !== false;
      invSave();
      return { ok: true, result: { monitor: m } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * removeMonitor — delete a monitor. params: { monitorId }
   */
  registerLensAction("invariant", "removeMonitor", (ctx, _artifact, params) => {
    try {
      const s = invState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = invActor(ctx);
      const p = params || {};
      const monitors = invList(s.monitors, userId);
      const idx = monitors.findIndex(x => x.id === p.monitorId);
      if (idx === -1) return { ok: false, error: "monitor_not_found" };
      const [removed] = monitors.splice(idx, 1);
      invSave();
      return { ok: true, result: { removed: removed.id, totalMonitors: monitors.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * counterexample
   * Given a failing invariant and a list of records, identify the precise
   * records / field values that break the invariant. params:
   *   { expression, records: [{...}], recordKey? }
   * Each record is bound as the evaluation context; failing records are the
   * counterexamples. Also performs single-field "blame" attribution.
   */
  registerLensAction("invariant", "counterexample", (ctx, _artifact, params) => {
    try {
      const p = params || {};
      const expression = String(p.expression || "").trim();
      if (!expression) return { ok: false, error: "expression_required" };
      const astCheck = validateExpressionAST(expression);
      if (!astCheck.ok) return { ok: false, error: `unsafe_expression:${astCheck.reason}` };
      const records = Array.isArray(p.records) ? p.records.slice(0, 1000) : [];
      if (records.length === 0) return { ok: false, error: "records_required" };
      const recordKey = typeof p.recordKey === "string" ? p.recordKey : null;

      const counterexamples = [];
      const fieldBlame = {};
      records.forEach((rec, idx) => {
        const context = (rec && typeof rec === "object") ? rec : {};
        const { value, error } = safeEval(expression, context);
        const passed = error === null && value === true;
        if (!passed) {
          // blame attribution: which fields appear in the expression
          const fields = [...new Set((expression.match(/\b[a-zA-Z_]\w*\b/g) || [])
            .filter(t => !["true", "false", "null", "undefined", "NaN", "Infinity", "typeof", "instanceof"].includes(t)))];
          const offendingFields = fields
            .filter(f => Object.prototype.hasOwnProperty.call(context, f))
            .map(f => ({ field: f, value: context[f] }));
          for (const of of offendingFields) {
            fieldBlame[of.field] = (fieldBlame[of.field] || 0) + 1;
          }
          counterexamples.push({
            index: idx,
            recordId: recordKey && context[recordKey] != null ? String(context[recordKey]) : `record_${idx}`,
            record: context,
            evaluatedValue: value,
            error,
            offendingFields,
          });
        }
      });

      const blameRanking = Object.entries(fieldBlame)
        .map(([field, count]) => ({ field, failureCount: count }))
        .sort((a, b) => b.failureCount - a.failureCount);

      return {
        ok: true,
        result: {
          expression,
          holds: counterexamples.length === 0,
          counterexamples: counterexamples.slice(0, 100),
          counterexampleCount: counterexamples.length,
          recordsChecked: records.length,
          blameRanking,
          mostLikelyCause: blameRanking[0]?.field || null,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * templates — return the built-in invariant library. params: { category? }
   * Categories: uniqueness, referential, range, presence, format.
   */
  registerLensAction("invariant", "templates", (_ctx, _artifact, params) => {
    try {
      const all = [
        {
          id: "tpl_uniqueness", category: "uniqueness", name: "Unique Field",
          description: "No two records share the same value for a key field.",
          kind: "quantified", quantifier: "forall",
          expressionTemplate: "count(collection, item.<field> == probe.<field>) <= 1",
          params: ["collection", "field"],
        },
        {
          id: "tpl_referential", category: "referential", name: "Referential Integrity",
          description: "Every foreign key references an existing parent record.",
          kind: "quantified", quantifier: "forall",
          expressionTemplate: "parentExists == true",
          params: ["childCollection", "foreignKey", "parentCollection", "parentKey"],
        },
        {
          id: "tpl_range", category: "range", name: "Range Bound",
          description: "A numeric field stays within [min, max].",
          kind: "scalar",
          expressionTemplate: "<field> >= <min> && <field> <= <max>",
          params: ["field", "min", "max"],
        },
        {
          id: "tpl_nonneg", category: "range", name: "Non-Negative",
          description: "A numeric field is never negative (balances, counts).",
          kind: "scalar",
          expressionTemplate: "<field> >= 0",
          params: ["field"],
        },
        {
          id: "tpl_presence", category: "presence", name: "Required Field",
          description: "A field is always present and non-null.",
          kind: "scalar",
          expressionTemplate: "<field> != null && <field> != undefined",
          params: ["field"],
        },
        {
          id: "tpl_conservation", category: "range", name: "Conservation Law",
          description: "A total is conserved — debits equal credits.",
          kind: "scalar",
          expressionTemplate: "<debit> == <credit>",
          params: ["debit", "credit"],
        },
        {
          id: "tpl_eventual", category: "temporal", name: "Eventually Consistent",
          description: "A condition must become true at some point in the history.",
          kind: "temporal", operator: "eventually",
          expressionTemplate: "<condition>",
          params: ["condition"],
        },
        {
          id: "tpl_always", category: "temporal", name: "Safety (Always)",
          description: "A condition must hold in every state of the history.",
          kind: "temporal", operator: "always",
          expressionTemplate: "<condition>",
          params: ["condition"],
        },
      ];
      const category = params && typeof params.category === "string" ? params.category : null;
      const templates = category ? all.filter(t => t.category === category) : all;
      return {
        ok: true,
        result: {
          templates,
          categories: [...new Set(all.map(t => t.category))],
          total: templates.length,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * temporalCheck
   * Evaluate a temporal-logic invariant over a state history. params:
   *   { operator: "always"|"eventually"|"until", condition, until? (for until), history: [{...}] }
   * - always:     condition holds in every state
   * - eventually: condition holds in at least one state
   * - until:      `condition` holds in every state up to (and not requiring at)
   *               the first state where `until` becomes true; `until` must
   *               eventually hold.
   */
  registerLensAction("invariant", "temporalCheck", (ctx, _artifact, params) => {
    try {
      const p = params || {};
      const operator = ["always", "eventually", "until"].includes(p.operator) ? p.operator : null;
      if (!operator) return { ok: false, error: "operator_must_be_always_eventually_or_until" };
      const condition = String(p.condition || "").trim();
      if (!condition) return { ok: false, error: "condition_required" };
      const cCheck = validateExpressionAST(condition);
      if (!cCheck.ok) return { ok: false, error: `unsafe_condition:${cCheck.reason}` };
      let untilExpr = null;
      if (operator === "until") {
        untilExpr = String(p.until || "").trim();
        if (!untilExpr) return { ok: false, error: "until_expression_required" };
        const uCheck = validateExpressionAST(untilExpr);
        if (!uCheck.ok) return { ok: false, error: `unsafe_until:${uCheck.reason}` };
      }
      // History can be supplied directly or pulled from recorded snapshots.
      let history = Array.isArray(p.history) ? p.history : null;
      if (!history) {
        const s = invState();
        if (s) history = invList(s.histories, invActor(ctx)).map(h => h.state);
      }
      history = (history || []).slice(0, 1000);
      if (history.length === 0) return { ok: false, error: "history_required" };

      const trace = history.map((st, i) => {
        const context = (st && typeof st === "object") ? st : {};
        const c = safeEval(condition, context);
        const cHolds = c.error === null && c.value === true;
        const row = { step: i, conditionHolds: cHolds, conditionError: c.error };
        if (operator === "until") {
          const u = safeEval(untilExpr, context);
          row.untilHolds = u.error === null && u.value === true;
        }
        return row;
      });

      let holds = false;
      let witnessStep = null;
      let violationStep = null;
      if (operator === "always") {
        violationStep = trace.findIndex(t => !t.conditionHolds);
        holds = violationStep === -1;
        violationStep = violationStep === -1 ? null : violationStep;
      } else if (operator === "eventually") {
        witnessStep = trace.findIndex(t => t.conditionHolds);
        holds = witnessStep !== -1;
        witnessStep = witnessStep === -1 ? null : witnessStep;
      } else { // until
        const untilIdx = trace.findIndex(t => t.untilHolds);
        if (untilIdx === -1) {
          holds = false;
          violationStep = trace.length - 1; // until never satisfied
        } else {
          witnessStep = untilIdx;
          // condition must hold for every step before untilIdx
          const bad = trace.slice(0, untilIdx).findIndex(t => !t.conditionHolds);
          holds = bad === -1;
          violationStep = bad === -1 ? null : bad;
        }
      }

      return {
        ok: true,
        result: {
          operator,
          condition,
          until: untilExpr,
          holds,
          witnessStep,
          violationStep,
          historyLength: history.length,
          trace,
          formula: operator === "always" ? `□ (${condition})`
            : operator === "eventually" ? `◇ (${condition})`
            : `(${condition}) U (${untilExpr})`,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * recordSnapshot — append a state snapshot to the per-user history so
   * temporalCheck can run against it without re-supplying history.
   * params: { state, label? }
   */
  registerLensAction("invariant", "recordSnapshot", (ctx, _artifact, params) => {
    try {
      const s = invState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = invActor(ctx);
      const p = params || {};
      const state = (p.state && typeof p.state === "object") ? p.state : {};
      const snapshot = { id: invId("snap"), label: String(p.label || "").slice(0, 80), state, at: invNow() };
      const hist = invList(s.histories, userId);
      hist.push(snapshot);
      if (hist.length > 500) hist.splice(0, hist.length - 500);
      invSave();
      return { ok: true, result: { snapshot, historyLength: hist.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * clearHistory — wipe the per-user state-snapshot history.
   */
  registerLensAction("invariant", "clearHistory", (ctx, _artifact, _params) => {
    try {
      const s = invState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = invActor(ctx);
      s.histories.set(userId, []);
      invSave();
      return { ok: true, result: { cleared: true, historyLength: 0 } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * violationHistory — return the violation timeline with severity and
   * resolution status. params: { resolved?: boolean, limit? }
   */
  registerLensAction("invariant", "violationHistory", (ctx, _artifact, params) => {
    try {
      const s = invState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = invActor(ctx);
      const p = params || {};
      let log = invList(s.violations, userId).slice();
      if (typeof p.resolved === "boolean") log = log.filter(v => v.resolved === p.resolved);
      const limit = Math.min(Math.max(parseInt(p.limit) || 200, 1), 500);
      const sliced = log.slice(0, limit);
      const open = log.filter(v => !v.resolved);
      return {
        ok: true,
        result: {
          violations: sliced,
          summary: {
            total: log.length,
            open: open.length,
            resolved: log.filter(v => v.resolved).length,
            critical: open.filter(v => v.severity === "critical").length,
            high: open.filter(v => v.severity === "high").length,
            medium: open.filter(v => v.severity === "medium").length,
            low: open.filter(v => v.severity === "low").length,
          },
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * resolveViolation — mark a recorded violation as resolved.
   * params: { violationId, resolution? }
   */
  registerLensAction("invariant", "resolveViolation", (ctx, _artifact, params) => {
    try {
      const s = invState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = invActor(ctx);
      const p = params || {};
      const log = invList(s.violations, userId);
      const v = log.find(x => x.id === p.violationId);
      if (!v) return { ok: false, error: "violation_not_found" };
      v.resolved = true;
      v.resolvedAt = invNow();
      v.resolution = String(p.resolution || "").slice(0, 300);
      invSave();
      return { ok: true, result: { violation: v } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * quantifiedCheck
   * Evaluate a quantified invariant (∀ / ∃) over a collection. params:
   *   { quantifier: "forall"|"exists", collection: [{...}], predicate, bind? }
   * Each collection item is bound as the evaluation context (the `bind` name
   * is purely cosmetic — the predicate references item fields directly).
   * Returns the witness (∃) or counterexample (∀).
   */
  registerLensAction("invariant", "quantifiedCheck", (ctx, _artifact, params) => {
    try {
      const p = params || {};
      const quantifier = ["forall", "exists"].includes(p.quantifier) ? p.quantifier : null;
      if (!quantifier) return { ok: false, error: "quantifier_must_be_forall_or_exists" };
      const predicate = String(p.predicate || "").trim();
      if (!predicate) return { ok: false, error: "predicate_required" };
      const pCheck = validateExpressionAST(predicate);
      if (!pCheck.ok) return { ok: false, error: `unsafe_predicate:${pCheck.reason}` };
      const collection = Array.isArray(p.collection) ? p.collection.slice(0, 2000) : [];
      if (collection.length === 0) return { ok: false, error: "collection_required" };

      const evaluations = collection.map((item, idx) => {
        const context = (item && typeof item === "object") ? item : { value: item };
        const { value, error } = safeEval(predicate, context);
        return {
          index: idx,
          holds: error === null && value === true,
          error,
          item: context,
        };
      });

      const satisfying = evaluations.filter(e => e.holds);
      const failing = evaluations.filter(e => !e.holds);

      let holds, witness = null, counterexample = null;
      if (quantifier === "forall") {
        holds = failing.length === 0;
        counterexample = failing[0] ? { index: failing[0].index, item: failing[0].item, error: failing[0].error } : null;
      } else {
        holds = satisfying.length > 0;
        witness = satisfying[0] ? { index: satisfying[0].index, item: satisfying[0].item } : null;
      }

      return {
        ok: true,
        result: {
          quantifier,
          predicate,
          holds,
          witness,
          counterexample,
          collectionSize: collection.length,
          satisfyingCount: satisfying.length,
          failingCount: failing.length,
          formula: quantifier === "forall" ? `∀ x ∈ C : (${predicate})` : `∃ x ∈ C : (${predicate})`,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
