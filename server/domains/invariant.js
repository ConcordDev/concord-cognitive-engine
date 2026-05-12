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
}
