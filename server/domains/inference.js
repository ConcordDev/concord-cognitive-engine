// server/domains/inference.js
// Domain actions for logical inference: forward chaining, backward chaining
// (goal-directed reasoning), and unification algorithm.

export default function registerInferenceActions(registerLensAction) {
  /**
   * forwardChain
   * Forward chaining inference — apply rules to facts, compute transitive
   * closure, and detect new derivable facts.
   * artifact.data.facts = [{ predicate, args: string[] }]
   *   e.g. { predicate: "parent", args: ["alice", "bob"] }
   * artifact.data.rules = [{ name?, if: [{ predicate, args: string[] }], then: { predicate, args: string[] } }]
   *   — args may contain variables prefixed with "?"
   *   e.g. { if: [{ predicate: "parent", args: ["?X", "?Y"] }, { predicate: "parent", args: ["?Y", "?Z"] }],
   *          then: { predicate: "grandparent", args: ["?X", "?Z"] } }
   * params.maxIterations (default: 100)
   */
  registerLensAction("inference", "forwardChain", (ctx, artifact, params) => {
    const initialFacts = artifact.data?.facts || [];
    const rules = artifact.data?.rules || [];
    if (initialFacts.length === 0) return { ok: false, error: "No facts provided." };
    if (rules.length === 0) return { ok: true, result: { message: "No rules to apply.", facts: initialFacts } };

    const maxIter = params.maxIterations || 100;

    // Serialize a fact for deduplication
    function factKey(f) {
      return `${f.predicate}(${(f.args || []).join(",")})`;
    }

    // Check if a string is a variable
    function isVar(s) {
      return typeof s === "string" && s.startsWith("?");
    }

    // Attempt to match a pattern against a fact, extending existing bindings
    function matchPattern(pattern, fact, bindings) {
      if (pattern.predicate !== fact.predicate) return null;
      if ((pattern.args || []).length !== (fact.args || []).length) return null;

      const newBindings = { ...bindings };
      for (let i = 0; i < pattern.args.length; i++) {
        const pArg = pattern.args[i];
        const fArg = fact.args[i];
        if (isVar(pArg)) {
          if (newBindings[pArg] !== undefined) {
            if (newBindings[pArg] !== fArg) return null;
          } else {
            newBindings[pArg] = fArg;
          }
        } else {
          if (pArg !== fArg) return null;
        }
      }
      return newBindings;
    }

    // Apply bindings to a conclusion pattern to produce a concrete fact
    function applyBindings(pattern, bindings) {
      return {
        predicate: pattern.predicate,
        args: (pattern.args || []).map(a => isVar(a) ? (bindings[a] ?? a) : a),
      };
    }

    // Find all ways to satisfy a list of conditions against the fact set
    function findAllBindings(conditions, facts, initialBindings = {}) {
      if (conditions.length === 0) return [initialBindings];
      const [first, ...rest] = conditions;
      const results = [];
      for (const fact of facts) {
        const newBindings = matchPattern(first, fact, initialBindings);
        if (newBindings) {
          const subResults = findAllBindings(rest, facts, newBindings);
          results.push(...subResults);
        }
      }
      return results;
    }

    // Forward chaining loop
    const factSet = new Set(initialFacts.map(factKey));
    const facts = [...initialFacts];
    const derivedFacts = [];
    const derivationLog = [];
    let iterations = 0;

    for (let iter = 0; iter < maxIter; iter++) {
      iterations++;
      let newFactsThisRound = 0;

      for (const rule of rules) {
        const conditions = rule.if || [];
        const conclusion = rule.then;
        if (!conclusion) continue;

        const allBindings = findAllBindings(conditions, facts);

        for (const bindings of allBindings) {
          const newFact = applyBindings(conclusion, bindings);
          // Check no unbound variables remain
          if (newFact.args.some(isVar)) continue;

          const key = factKey(newFact);
          if (!factSet.has(key)) {
            factSet.add(key);
            facts.push(newFact);
            derivedFacts.push(newFact);
            newFactsThisRound++;
            derivationLog.push({
              fact: key,
              rule: rule.name || `rule_${rules.indexOf(rule) + 1}`,
              bindings: { ...bindings },
              iteration: iter + 1,
            });
          }
        }
      }

      if (newFactsThisRound === 0) break; // Fixed point reached
    }

    // Compute transitive closure for binary predicates
    const binaryPredicates = new Set();
    for (const f of facts) {
      if ((f.args || []).length === 2) binaryPredicates.add(f.predicate);
    }

    const transitiveClosure = {};
    for (const pred of binaryPredicates) {
      const pairs = facts.filter(f => f.predicate === pred).map(f => [f.args[0], f.args[1]]);
      // Floyd-Warshall-style closure
      const allNodes = new Set();
      for (const [a, b] of pairs) { allNodes.add(a); allNodes.add(b); }
      const nodes = [...allNodes];
      const reachable = {};
      for (const n of nodes) reachable[n] = new Set();
      for (const [a, b] of pairs) reachable[a].add(b);

      let changed = true;
      while (changed) {
        changed = false;
        for (const a of nodes) {
          for (const b of [...reachable[a]]) {
            for (const c of [...(reachable[b] || [])]) {
              if (!reachable[a].has(c)) {
                reachable[a].add(c);
                changed = true;
              }
            }
          }
        }
      }

      transitiveClosure[pred] = {};
      for (const n of nodes) {
        transitiveClosure[pred][n] = [...reachable[n]];
      }
    }

    // Group facts by predicate
    const factsByPredicate = {};
    for (const f of facts) {
      if (!factsByPredicate[f.predicate]) factsByPredicate[f.predicate] = [];
      factsByPredicate[f.predicate].push(f.args);
    }

    return {
      ok: true,
      result: {
        initialFactCount: initialFacts.length,
        derivedFactCount: derivedFacts.length,
        totalFactCount: facts.length,
        iterations,
        fixedPointReached: iterations < maxIter,
        derivedFacts: derivedFacts.slice(0, 50).map(factKey),
        derivationLog: derivationLog.slice(0, 50),
        factsByPredicate: Object.fromEntries(Object.entries(factsByPredicate).map(([k, v]) => [k, v.length])),
        transitiveClosure,
        rulesApplied: [...new Set(derivationLog.map(d => d.rule))],
      },
    };
  });

  /**
   * backwardChain
   * Backward chaining / goal-directed reasoning — depth-first search through
   * rule space with proof tree construction.
   * artifact.data.facts = [{ predicate, args: string[] }]
   * artifact.data.rules = [{ name?, if: [{ predicate, args: string[] }], then: { predicate, args: string[] } }]
   * artifact.data.goal = { predicate, args: string[] }
   *   — args may contain variables prefixed with "?"
   * params.maxDepth (default: 20)
   */
  registerLensAction("inference", "backwardChain", (ctx, artifact, params) => {
    const facts = artifact.data?.facts || [];
    const rules = artifact.data?.rules || [];
    const goal = artifact.data?.goal;
    if (!goal) return { ok: false, error: "Goal is required for backward chaining." };

    const maxDepth = params.maxDepth || 20;

    function isVar(s) {
      return typeof s === "string" && s.startsWith("?");
    }

    function matchPattern(pattern, fact, bindings) {
      if (pattern.predicate !== fact.predicate) return null;
      if ((pattern.args || []).length !== (fact.args || []).length) return null;
      const newBindings = { ...bindings };
      for (let i = 0; i < pattern.args.length; i++) {
        const pArg = pattern.args[i];
        const fArg = fact.args[i];
        const resolvedP = isVar(pArg) && newBindings[pArg] !== undefined ? newBindings[pArg] : pArg;
        const resolvedF = isVar(fArg) && newBindings[fArg] !== undefined ? newBindings[fArg] : fArg;
        if (isVar(resolvedP)) {
          newBindings[resolvedP] = resolvedF;
        } else if (isVar(resolvedF)) {
          newBindings[resolvedF] = resolvedP;
        } else if (resolvedP !== resolvedF) {
          return null;
        }
      }
      return newBindings;
    }

    function substituteArgs(args, bindings) {
      return args.map(a => {
        let resolved = a;
        let safety = 10;
        while (isVar(resolved) && bindings[resolved] !== undefined && safety-- > 0) {
          resolved = bindings[resolved];
        }
        return resolved;
      });
    }

    // DFS backward chaining
    let nodesExplored = 0;
    const allProofs = [];

    function prove(goalPattern, bindings, depth, proofPath) {
      if (depth > maxDepth) return [];
      nodesExplored++;
      if (nodesExplored > 10000) return []; // safety limit

      const resolvedGoal = {
        predicate: goalPattern.predicate,
        args: substituteArgs(goalPattern.args || [], bindings),
      };

      const results = [];

      // Try matching against known facts
      for (const fact of facts) {
        const newBindings = matchPattern(resolvedGoal, fact, bindings);
        if (newBindings) {
          results.push({
            bindings: newBindings,
            proof: [...proofPath, { type: "fact", goal: `${resolvedGoal.predicate}(${resolvedGoal.args.join(",")})`, matched: `${fact.predicate}(${fact.args.join(",")})` }],
          });
        }
      }

      // Try matching against rule conclusions, then prove rule conditions
      for (const rule of rules) {
        const conclusion = rule.then;
        if (!conclusion) continue;

        const ruleBindings = matchPattern(resolvedGoal, conclusion, bindings);
        if (!ruleBindings) continue;

        const conditions = rule.if || [];
        if (conditions.length === 0) {
          results.push({
            bindings: ruleBindings,
            proof: [...proofPath, { type: "rule", rule: rule.name || "anon", goal: `${resolvedGoal.predicate}(${resolvedGoal.args.join(",")})`, conditions: [] }],
          });
          continue;
        }

        // Prove all conditions recursively
        function proveConditions(condIdx, currentBindings, condProofs) {
          if (condIdx >= conditions.length) {
            results.push({
              bindings: currentBindings,
              proof: [...proofPath, { type: "rule", rule: rule.name || "anon", goal: `${resolvedGoal.predicate}(${resolvedGoal.args.join(",")})`, subproofs: condProofs }],
            });
            return;
          }

          const condResults = prove(conditions[condIdx], currentBindings, depth + 1, []);
          for (const cr of condResults) {
            proveConditions(condIdx + 1, cr.bindings, [...condProofs, ...cr.proof]);
          }
        }

        proveConditions(0, ruleBindings, []);
      }

      return results;
    }

    const proofs = prove(goal, {}, 0, []);

    // Extract unique answer substitutions for goal variables
    const goalVars = (goal.args || []).filter(isVar);
    const answers = [];
    const answerSet = new Set();
    for (const p of proofs) {
      const answer = {};
      for (const v of goalVars) {
        let resolved = v;
        let safety = 10;
        while (isVar(resolved) && p.bindings[resolved] !== undefined && safety-- > 0) {
          resolved = p.bindings[resolved];
        }
        answer[v] = resolved;
      }
      const key = JSON.stringify(answer);
      if (!answerSet.has(key)) {
        answerSet.add(key);
        answers.push(answer);
      }
    }

    return {
      ok: true,
      result: {
        goal: `${goal.predicate}(${(goal.args || []).join(",")})`,
        proved: proofs.length > 0,
        answerCount: answers.length,
        answers: answers.slice(0, 20),
        proofCount: proofs.length,
        proofTrees: proofs.slice(0, 5).map(p => p.proof),
        nodesExplored,
        maxDepthUsed: maxDepth,
        factCount: facts.length,
        ruleCount: rules.length,
      },
    };
  });

  /**
   * unify
   * Unification algorithm — variable binding, occurs check, and most general
   * unifier (MGU) computation.
   * artifact.data.term1 = { functor, args: (string | term)[] }
   * artifact.data.term2 = { functor, args: (string | term)[] }
   * Variables are strings prefixed with "?"
   * Constants are plain strings. Compound terms have { functor, args }.
   */
  registerLensAction("inference", "unify", (ctx, artifact, _params) => {
    const term1 = artifact.data?.term1;
    const term2 = artifact.data?.term2;
    if (!term1 || !term2) return { ok: false, error: "Both term1 and term2 are required." };

    function isVar(t) {
      return typeof t === "string" && t.startsWith("?");
    }

    function isConstant(t) {
      return typeof t === "string" && !t.startsWith("?");
    }

    function isCompound(t) {
      return typeof t === "object" && t !== null && t.functor !== undefined;
    }

    // Apply substitution to a term
    function applySubst(term, subst) {
      if (isVar(term)) {
        if (subst[term] !== undefined) {
          return applySubst(subst[term], subst);
        }
        return term;
      }
      if (isConstant(term)) return term;
      if (isCompound(term)) {
        return {
          functor: term.functor,
          args: (term.args || []).map(a => applySubst(a, subst)),
        };
      }
      return term;
    }

    // Occurs check: does variable v occur in term t?
    function occursIn(v, t, subst) {
      const resolved = applySubst(t, subst);
      if (isVar(resolved)) return v === resolved;
      if (isConstant(resolved)) return false;
      if (isCompound(resolved)) {
        return (resolved.args || []).some(a => occursIn(v, a, subst));
      }
      return false;
    }

    // Format a term for display
    function termToString(t) {
      if (typeof t === "string") return t;
      if (isCompound(t)) {
        if (!t.args || t.args.length === 0) return t.functor;
        return `${t.functor}(${t.args.map(termToString).join(", ")})`;
      }
      return JSON.stringify(t);
    }

    // Robinson's unification algorithm
    const steps = [];
    let stepCount = 0;

    function unifyTerms(t1, t2, subst) {
      stepCount++;
      if (stepCount > 1000) return null; // safety limit

      const s1 = applySubst(t1, subst);
      const s2 = applySubst(t2, subst);

      steps.push({
        step: stepCount,
        unifying: `${termToString(s1)} =? ${termToString(s2)}`,
      });

      // Identical terms
      if (typeof s1 === "string" && typeof s2 === "string" && s1 === s2) {
        return subst;
      }

      // Variable cases
      if (isVar(s1)) {
        if (s1 === s2) return subst;
        if (occursIn(s1, s2, subst)) {
          steps.push({ step: stepCount, note: `Occurs check failed: ${s1} occurs in ${termToString(s2)}` });
          return null; // occurs check failure
        }
        return { ...subst, [s1]: s2 };
      }

      if (isVar(s2)) {
        if (occursIn(s2, s1, subst)) {
          steps.push({ step: stepCount, note: `Occurs check failed: ${s2} occurs in ${termToString(s1)}` });
          return null;
        }
        return { ...subst, [s2]: s1 };
      }

      // Both constants
      if (isConstant(s1) && isConstant(s2)) {
        return s1 === s2 ? subst : null;
      }

      // Both compound terms
      if (isCompound(s1) && isCompound(s2)) {
        if (s1.functor !== s2.functor) return null;
        const args1 = s1.args || [];
        const args2 = s2.args || [];
        if (args1.length !== args2.length) return null;

        let currentSubst = subst;
        for (let i = 0; i < args1.length; i++) {
          currentSubst = unifyTerms(args1[i], args2[i], currentSubst);
          if (currentSubst === null) return null;
        }
        return currentSubst;
      }

      // Mismatch (e.g., compound vs constant)
      return null;
    }

    const mgu = unifyTerms(term1, term2, {});

    if (mgu === null) {
      return {
        ok: true,
        result: {
          unifiable: false,
          term1: termToString(term1),
          term2: termToString(term2),
          reason: "Terms cannot be unified",
          steps,
          stepCount,
        },
      };
    }

    // Compute the fully resolved substitution
    const resolvedMGU = {};
    for (const [v, t] of Object.entries(mgu)) {
      resolvedMGU[v] = termToString(applySubst(t, mgu));
    }

    // Apply MGU to both terms to show the unified result
    const unified1 = applySubst(term1, mgu);
    const unified2 = applySubst(term2, mgu);

    return {
      ok: true,
      result: {
        unifiable: true,
        term1: termToString(term1),
        term2: termToString(term2),
        mgu: resolvedMGU,
        bindingCount: Object.keys(resolvedMGU).length,
        unifiedTerm: termToString(unified1),
        verification: termToString(unified1) === termToString(unified2),
        steps,
        stepCount,
      },
    };
  });
}
