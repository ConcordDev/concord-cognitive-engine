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
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ───────────────────────────────────────────────────────────────────────
  // 2026 parity — Prolog / Drools rule engine: persistent knowledge base,
  // rule editor, proof trees, negation-as-failure, conflict resolution,
  // explanation ("why"/"how"), built-in predicates, step-through console.
  // ───────────────────────────────────────────────────────────────────────

  // ── Persistent per-user knowledge base in globalThis._concordSTATE ──
  function getInfState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.inferenceLens) {
      STATE.inferenceLens = {
        kb: new Map(), // userId -> { facts: [], rules: [] }
      };
    }
    return STATE.inferenceLens;
  }
  function saveInfState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function infActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function infId(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`; }
  function userKb(userId) {
    const s = getInfState();
    if (!s) return null;
    if (!s.kb.has(userId)) s.kb.set(userId, { facts: [], rules: [] });
    return s.kb.get(userId);
  }

  // ── Shared term helpers (used by KB-aware macros below) ──
  function isVarT(s) { return typeof s === "string" && s.startsWith("?"); }
  function factKeyT(f) { return `${f.predicate}(${(f.args || []).join(",")})`; }

  /**
   * parseFact — turns a textual atom "parent(alice,bob)" into
   * { predicate, args[] }. Bare "?X" segments are variables. Returns null
   * on a syntax error so the rule editor can report it.
   */
  function parseFact(text) {
    const t = String(text || "").trim().replace(/\.$/, "");
    if (!t) return { error: "empty atom" };
    let negated = false;
    let body = t;
    if (/^(not|\\\+)\s+/i.test(body)) {
      negated = true;
      body = body.replace(/^(not|\\\+)\s+/i, "").trim();
    }
    const m = body.match(/^([a-zA-Z_][\w-]*)\s*\(([^)]*)\)$/);
    if (!m) {
      // 0-arity proposition
      if (/^[a-zA-Z_][\w-]*$/.test(body)) return { predicate: body, args: [], negated };
      return { error: `cannot parse atom "${text}"` };
    }
    const predicate = m[1];
    const args = m[2].trim() === ""
      ? []
      : m[2].split(",").map((a) => a.trim()).filter((a) => a.length > 0);
    return { predicate, args, negated };
  }

  /**
   * parseRule — parses "head :- body1, body2." into a rule object.
   * A fact (no ":-") becomes { if: [], then: head }.
   */
  function parseRule(text) {
    const t = String(text || "").trim().replace(/\.$/, "");
    if (!t) return { error: "empty rule" };
    const arrowIdx = t.indexOf(":-");
    if (arrowIdx === -1) {
      const head = parseFact(t);
      if (head.error) return { error: head.error };
      return { if: [], then: { predicate: head.predicate, args: head.args } };
    }
    const headText = t.slice(0, arrowIdx).trim();
    const bodyText = t.slice(arrowIdx + 2).trim();
    const head = parseFact(headText);
    if (head.error) return { error: `head: ${head.error}` };
    if (head.negated) return { error: "rule head cannot be negated" };
    // split body on top-level commas (no nesting beyond a single paren group)
    const parts = [];
    let depth = 0, cur = "";
    for (const ch of bodyText) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    const conds = [];
    for (const p of parts) {
      const c = parseFact(p);
      if (c.error) return { error: `body: ${c.error}` };
      conds.push({ predicate: c.predicate, args: c.args, negated: !!c.negated });
    }
    return { if: conds, then: { predicate: head.predicate, args: head.args } };
  }

  // ── kb-add: add facts/rules to the persistent KB, syntax-checked ──
  registerLensAction("inference", "kb-add", (ctx, _artifact, params = {}) => {
    try {
      const kb = userKb(infActor(ctx));
      if (!kb) return { ok: false, error: "STATE unavailable" };
      const lines = String(params.text || "")
        .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("%"));
      if (lines.length === 0) return { ok: false, error: "no input lines" };
      const added = [], errors = [];
      for (const line of lines) {
        const r = parseRule(line);
        if (r.error) { errors.push({ line, error: r.error }); continue; }
        if (r.if.length === 0) {
          if (r.then.args.some(isVarT)) {
            errors.push({ line, error: "facts cannot contain variables" });
            continue;
          }
          const key = factKeyT(r.then);
          if (kb.facts.some((f) => factKeyT(f) === key)) {
            errors.push({ line, error: "duplicate fact" });
            continue;
          }
          const fact = { id: infId("fact"), predicate: r.then.predicate, args: r.then.args, addedAt: new Date().toISOString() };
          kb.facts.push(fact);
          added.push({ kind: "fact", ...fact });
        } else {
          const rule = {
            id: infId("rule"),
            name: params.name || `rule_${kb.rules.length + 1}`,
            priority: typeof params.priority === "number" ? params.priority : 0,
            if: r.if, then: r.then,
            addedAt: new Date().toISOString(),
            text: line,
          };
          kb.rules.push(rule);
          added.push({ kind: "rule", ...rule });
        }
      }
      saveInfState();
      return {
        ok: errors.length === 0 || added.length > 0,
        result: {
          added, errors,
          addedCount: added.length, errorCount: errors.length,
          factCount: kb.facts.length, ruleCount: kb.rules.length,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── kb-list: dump the current knowledge base ──
  registerLensAction("inference", "kb-list", (ctx) => {
    try {
      const kb = userKb(infActor(ctx));
      if (!kb) return { ok: false, error: "STATE unavailable" };
      const predicates = {};
      for (const f of kb.facts) predicates[f.predicate] = (predicates[f.predicate] || 0) + 1;
      return {
        ok: true,
        result: {
          facts: kb.facts,
          rules: kb.rules,
          factCount: kb.facts.length,
          ruleCount: kb.rules.length,
          predicates,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── kb-remove: remove a fact or rule by id ──
  registerLensAction("inference", "kb-remove", (ctx, _artifact, params = {}) => {
    try {
      const kb = userKb(infActor(ctx));
      if (!kb) return { ok: false, error: "STATE unavailable" };
      const id = String(params.id || "");
      if (!id) return { ok: false, error: "id required" };
      const fBefore = kb.facts.length, rBefore = kb.rules.length;
      kb.facts = kb.facts.filter((f) => f.id !== id);
      kb.rules = kb.rules.filter((r) => r.id !== id);
      const removed = (fBefore - kb.facts.length) + (rBefore - kb.rules.length);
      if (removed === 0) return { ok: false, error: "id not found" };
      saveInfState();
      return { ok: true, result: { removed, factCount: kb.facts.length, ruleCount: kb.rules.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── kb-clear: wipe the knowledge base ──
  registerLensAction("inference", "kb-clear", (ctx) => {
    try {
      const kb = userKb(infActor(ctx));
      if (!kb) return { ok: false, error: "STATE unavailable" };
      const cleared = kb.facts.length + kb.rules.length;
      kb.facts = []; kb.rules = [];
      saveInfState();
      return { ok: true, result: { cleared } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── kb-check: syntax-check rule text without committing it ──
  registerLensAction("inference", "kb-check", (_ctx, _artifact, params = {}) => {
    try {
      const lines = String(params.text || "")
        .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("%"));
      if (lines.length === 0) return { ok: false, error: "no input lines" };
      const report = lines.map((line) => {
        const r = parseRule(line);
        if (r.error) return { line, valid: false, error: r.error };
        const kind = r.if.length === 0 ? "fact" : "rule";
        const vars = new Set();
        for (const c of [...(r.if || []), r.then]) {
          for (const a of c.args || []) if (isVarT(a)) vars.add(a);
        }
        return { line, valid: true, kind, predicate: r.then.predicate, variables: [...vars] };
      });
      const valid = report.filter((x) => x.valid).length;
      return {
        ok: true,
        result: { report, total: report.length, validCount: valid, invalidCount: report.length - valid },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Built-in predicate evaluation (arithmetic / comparison / list ops) ──
  // Returns { handled, satisfied, bindings } — handled=false means it's not a builtin.
  function evalBuiltin(cond, bindings) {
    const res = (v) => {
      let x = v;
      let guard = 16;
      while (isVarT(x) && bindings[x] !== undefined && guard-- > 0) x = bindings[x];
      return x;
    };
    const num = (v) => { const n = Number(res(v)); return Number.isFinite(n) ? n : null; };
    const a = (cond.args || []).map(res);
    const p = cond.predicate;
    const bound = { ...bindings };
    const cmp = { "gt": (x, y) => x > y, "lt": (x, y) => x < y, "gte": (x, y) => x >= y, "lte": (x, y) => x <= y };
    if (cmp[p]) {
      const x = num(cond.args[0]), y = num(cond.args[1]);
      if (x === null || y === null) return { handled: true, satisfied: false, bindings };
      return { handled: true, satisfied: cmp[p](x, y), bindings };
    }
    if (p === "eq") return { handled: true, satisfied: String(a[0]) === String(a[1]), bindings };
    if (p === "neq") return { handled: true, satisfied: String(a[0]) !== String(a[1]), bindings };
    if (p === "add" || p === "sub" || p === "mul" || p === "div") {
      const x = num(cond.args[0]), y = num(cond.args[1]);
      if (x === null || y === null) return { handled: true, satisfied: false, bindings };
      let v;
      if (p === "add") v = x + y;
      else if (p === "sub") v = x - y;
      else if (p === "mul") v = x * y;
      else { if (y === 0) return { handled: true, satisfied: false, bindings }; v = x / y; }
      const out = cond.args[2];
      if (isVarT(out)) {
        if (bound[out] !== undefined) return { handled: true, satisfied: Number(bound[out]) === v, bindings };
        bound[out] = String(v);
        return { handled: true, satisfied: true, bindings: bound };
      }
      return { handled: true, satisfied: num(out) === v, bindings };
    }
    if (p === "length") {
      const list = String(res(cond.args[0]) || "").split("|").filter(Boolean);
      const out = cond.args[1];
      if (isVarT(out)) {
        if (bound[out] !== undefined) return { handled: true, satisfied: Number(bound[out]) === list.length, bindings };
        bound[out] = String(list.length);
        return { handled: true, satisfied: true, bindings: bound };
      }
      return { handled: true, satisfied: num(out) === list.length, bindings };
    }
    if (p === "member") {
      const list = String(res(cond.args[1]) || "").split("|").filter(Boolean);
      return { handled: true, satisfied: list.includes(String(res(cond.args[0]))), bindings };
    }
    return { handled: false, satisfied: false, bindings };
  }

  /**
   * solveKb — backward-chaining SLD resolver over the persistent KB with
   * negation-as-failure, built-in predicates, and proof-tree capture.
   * Used by kb-query, kb-explain and kb-trace.
   */
  function solveKb(kb, goal, builtinNames, opts = {}) {
    const facts = kb.facts;
    const rules = kb.rules;
    const trace = [];
    let nodes = 0;
    const maxDepth = opts.maxDepth || 30;

    function subst(args, b) {
      return (args || []).map((x) => {
        let v = x, guard = 16;
        while (isVarT(v) && b[v] !== undefined && guard-- > 0) v = b[v];
        return v;
      });
    }
    // Two-sided unification of two atoms — variables may appear on either
    // side (goal side OR rule-head side). Walks binding chains so a var
    // bound to another var resolves transitively.
    function matchFact(pat, fact, b) {
      if (pat.predicate !== fact.predicate) return null;
      if ((pat.args || []).length !== (fact.args || []).length) return null;
      const nb = { ...b };
      const walk = (x) => {
        let v = x, guard = 32;
        while (isVarT(v) && nb[v] !== undefined && guard-- > 0) v = nb[v];
        return v;
      };
      for (let i = 0; i < pat.args.length; i++) {
        const rp = walk(pat.args[i]);
        const rf = walk(fact.args[i]);
        if (isVarT(rp)) {
          if (rp !== rf) nb[rp] = rf;
        } else if (isVarT(rf)) {
          nb[rf] = rp;
        } else if (rp !== rf) {
          return null;
        }
      }
      return nb;
    }
    function renameRule(rule, depth) {
      const tag = `_d${depth}`;
      const rn = (a) => isVarT(a) ? a + tag : a;
      return {
        name: rule.name,
        priority: rule.priority || 0,
        if: (rule.if || []).map((c) => ({ predicate: c.predicate, args: (c.args || []).map(rn), negated: !!c.negated })),
        then: { predicate: rule.then.predicate, args: (rule.then.args || []).map(rn) },
      };
    }

    // prove a single goal -> array of { bindings, tree }
    function prove(g, b, depth) {
      nodes++;
      if (depth > maxDepth || nodes > 20000) return [];
      const resolved = { predicate: g.predicate, args: subst(g.args, b), negated: !!g.negated };
      const label = `${resolved.predicate}(${resolved.args.join(",")})`;

      // negation-as-failure
      if (g.negated) {
        const pos = prove({ predicate: g.predicate, args: g.args }, b, depth + 1);
        const ok = pos.length === 0;
        trace.push({ depth, goal: `not ${label}`, kind: "negation", result: ok });
        return ok
          ? [{ bindings: b, tree: { id: infId("n"), label: `\\+ ${label}`, tone: "info", kind: "negation", children: [] } }]
          : [];
      }

      // built-in predicate
      if (builtinNames.has(g.predicate)) {
        const bi = evalBuiltin(g, b);
        trace.push({ depth, goal: label, kind: "builtin", result: bi.satisfied });
        return bi.satisfied
          ? [{ bindings: bi.bindings, tree: { id: infId("b"), label, tone: "good", kind: "builtin", children: [] } }]
          : [];
      }

      const out = [];
      // facts
      for (const f of facts) {
        const nb = matchFact(resolved, f, b);
        if (nb) {
          trace.push({ depth, goal: label, kind: "fact", matched: factKeyT(f), result: true });
          out.push({ bindings: nb, tree: { id: infId("f"), label, detail: `fact: ${factKeyT(f)}`, tone: "good", kind: "fact", children: [] } });
        }
      }
      // rules — conflict-resolution-ordered by caller; here priority then order
      const ordered = [...rules].sort((x, y) => (y.priority || 0) - (x.priority || 0));
      for (const baseRule of ordered) {
        const rule = renameRule(baseRule, depth);
        const nb = matchFact(resolved, rule.then, b);
        if (!nb) continue;
        trace.push({ depth, goal: label, kind: "rule-try", rule: baseRule.name, result: "attempt" });
        // prove the conjunction of body conditions
        function proveBody(idx, cb, kids) {
          if (idx >= rule.if.length) {
            out.push({
              bindings: cb,
              tree: {
                id: infId("r"), label, detail: `rule: ${baseRule.name}`, tone: "default", kind: "rule",
                rule: baseRule.name, children: kids,
              },
            });
            return;
          }
          const sub = prove(rule.if[idx], cb, depth + 1);
          for (const s of sub) proveBody(idx + 1, s.bindings, [...kids, s.tree]);
        }
        proveBody(0, nb, []);
      }
      return out;
    }

    const solutions = prove({ predicate: goal.predicate, args: goal.args, negated: !!goal.negated }, {}, 0);
    return { solutions, trace, nodes };
  }

  const BUILTINS = ["gt", "lt", "gte", "lte", "eq", "neq", "add", "sub", "mul", "div", "length", "member"];

  // ── kb-query: backward-chained query against the persistent KB ──
  registerLensAction("inference", "kb-query", (ctx, _artifact, params = {}) => {
    try {
      const kb = userKb(infActor(ctx));
      if (!kb) return { ok: false, error: "STATE unavailable" };
      const goalRule = parseRule(String(params.goal || ""));
      if (goalRule.error) return { ok: false, error: `goal: ${goalRule.error}` };
      if (goalRule.if.length > 0) return { ok: false, error: "query must be a single atom, not a rule" };
      const goal = parseFact(String(params.goal || ""));
      if (goal.error) return { ok: false, error: goal.error };
      const builtinNames = new Set(BUILTINS);
      const { solutions, trace, nodes } = solveKb(kb, goal, builtinNames, { maxDepth: params.maxDepth || 30 });
      const goalVars = (goal.args || []).filter(isVarT);
      const answers = [];
      const seen = new Set();
      for (const s of solutions) {
        const ans = {};
        for (const v of goalVars) {
          let x = v, guard = 16;
          while (isVarT(x) && s.bindings[x] !== undefined && guard-- > 0) x = s.bindings[x];
          ans[v] = x;
        }
        const key = JSON.stringify(ans);
        if (!seen.has(key)) { seen.add(key); answers.push(ans); }
      }
      return {
        ok: true,
        result: {
          goal: `${goal.predicate}(${(goal.args || []).join(",")})`,
          proved: solutions.length > 0,
          solutionCount: solutions.length,
          answerCount: answers.length,
          answers: answers.slice(0, 50),
          proofTrees: solutions.slice(0, 5).map((s) => s.tree),
          nodesExplored: nodes,
          traceLength: trace.length,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── kb-explain: "why" / "how" explanation of a derived fact ──
  registerLensAction("inference", "kb-explain", (ctx, _artifact, params = {}) => {
    try {
      const kb = userKb(infActor(ctx));
      if (!kb) return { ok: false, error: "STATE unavailable" };
      const goal = parseFact(String(params.fact || ""));
      if (goal.error) return { ok: false, error: goal.error };
      if (goal.args.some(isVarT)) return { ok: false, error: "explain requires a ground fact (no variables)" };
      const builtinNames = new Set(BUILTINS);
      const { solutions, nodes } = solveKb(kb, goal, builtinNames, { maxDepth: params.maxDepth || 30 });
      if (solutions.length === 0) {
        return {
          ok: true,
          result: {
            fact: factKeyT(goal), derivable: false,
            why: `${factKeyT(goal)} cannot be derived from the current knowledge base.`,
            how: [], proofTree: null, nodesExplored: nodes,
          },
        };
      }
      const tree = solutions[0].tree;
      // flatten the proof tree into a "how" step list (leaves first)
      const how = [];
      function walk(n) {
        for (const c of n.children || []) walk(c);
        how.push({
          conclusion: n.label,
          via: n.kind === "fact" ? (n.detail || "stated fact")
            : n.kind === "rule" ? `rule "${n.rule}"`
              : n.kind === "builtin" ? "built-in predicate"
                : "negation-as-failure",
          kind: n.kind,
        });
      }
      walk(tree);
      const whyParts = [];
      if (tree.kind === "fact") whyParts.push(`${factKeyT(goal)} is true because it is a stated fact.`);
      else whyParts.push(`${factKeyT(goal)} is true because rule "${tree.rule}" fired, and all of its conditions were satisfied.`);
      return {
        ok: true,
        result: {
          fact: factKeyT(goal), derivable: true,
          why: whyParts.join(" "),
          how, stepCount: how.length,
          proofTree: tree, nodesExplored: nodes,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── kb-trace: step-through execution log of a query (query console) ──
  registerLensAction("inference", "kb-trace", (ctx, _artifact, params = {}) => {
    try {
      const kb = userKb(infActor(ctx));
      if (!kb) return { ok: false, error: "STATE unavailable" };
      const goal = parseFact(String(params.goal || ""));
      if (goal.error) return { ok: false, error: goal.error };
      const builtinNames = new Set(BUILTINS);
      const { solutions, trace, nodes } = solveKb(kb, goal, builtinNames, { maxDepth: params.maxDepth || 30 });
      const steps = trace.map((t, i) => ({
        step: i + 1,
        depth: t.depth,
        indent: "  ".repeat(t.depth),
        goal: t.goal,
        kind: t.kind,
        action: t.kind === "fact" ? `unify with ${t.matched}`
          : t.kind === "rule-try" ? `try rule "${t.rule}"`
            : t.kind === "builtin" ? "evaluate built-in"
              : t.kind === "negation" ? "negation-as-failure"
                : "resolve",
        result: t.result,
      }));
      return {
        ok: true,
        result: {
          goal: factKeyT(goal),
          proved: solutions.length > 0,
          steps,
          stepCount: steps.length,
          nodesExplored: nodes,
          builtins: BUILTINS,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── kb-forward: forward-chain over the KB with conflict-resolution strategy ──
  registerLensAction("inference", "kb-forward", (ctx, _artifact, params = {}) => {
    try {
      const kb = userKb(infActor(ctx));
      if (!kb) return { ok: false, error: "STATE unavailable" };
      const strategy = ["priority", "recency", "specificity", "order"].includes(params.strategy)
        ? params.strategy : "priority";
      if (kb.facts.length === 0) return { ok: false, error: "knowledge base has no facts" };

      const factSet = new Set(kb.facts.map(factKeyT));
      const facts = kb.facts.map((f) => ({ predicate: f.predicate, args: f.args }));
      const builtinNames = new Set(BUILTINS);

      function matchPattern(pat, fact, b) {
        if (pat.predicate !== fact.predicate) return null;
        if ((pat.args || []).length !== (fact.args || []).length) return null;
        const nb = { ...b };
        for (let i = 0; i < pat.args.length; i++) {
          const pa = pat.args[i], fa = fact.args[i];
          if (isVarT(pa)) { if (nb[pa] !== undefined && nb[pa] !== fa) return null; nb[pa] = fa; }
          else if (pa !== fa) return null;
        }
        return nb;
      }
      // collect all firings (conflict set) for one pass
      function firings() {
        const set = [];
        for (let ri = 0; ri < kb.rules.length; ri++) {
          const rule = kb.rules[ri];
          // only positive, non-builtin body conditions drive matching;
          // negated + builtin conditions are filters
          function gather(idx, b) {
            if (idx >= rule.if.length) {
              const head = { predicate: rule.then.predicate, args: (rule.then.args || []).map((a) => isVarT(a) ? (b[a] ?? a) : a) };
              if (head.args.some(isVarT)) return;
              set.push({ rule, ruleIndex: ri, head, bindings: { ...b }, conditionCount: rule.if.length });
              return;
            }
            const cond = rule.if[idx];
            if (cond.negated) {
              const sub = parseFact(`${cond.predicate}(${(cond.args || []).map((a) => isVarT(a) ? (b[a] ?? a) : a).join(",")})`);
              const probe = sub.error ? [] : facts.filter((f) => matchPattern({ predicate: sub.predicate, args: sub.args }, f, {}));
              if (probe.length === 0) gather(idx + 1, b);
              return;
            }
            if (builtinNames.has(cond.predicate)) {
              const bi = evalBuiltin(cond, b);
              if (bi.satisfied) gather(idx + 1, bi.bindings);
              return;
            }
            for (const f of facts) {
              const nb = matchPattern(cond, f, b);
              if (nb) gather(idx + 1, nb);
            }
          }
          gather(0, {});
        }
        return set.filter((fr) => !factSet.has(factKeyT(fr.head)));
      }

      function resolveConflict(set, pass) {
        if (set.length === 0) return null;
        const sorted = [...set];
        if (strategy === "priority") {
          sorted.sort((a, b) => (b.rule.priority || 0) - (a.rule.priority || 0) || a.ruleIndex - b.ruleIndex);
        } else if (strategy === "recency") {
          sorted.sort((a, b) => String(b.rule.addedAt).localeCompare(String(a.rule.addedAt)));
        } else if (strategy === "specificity") {
          sorted.sort((a, b) => b.conditionCount - a.conditionCount || a.ruleIndex - b.ruleIndex);
        } else {
          sorted.sort((a, b) => a.ruleIndex - b.ruleIndex);
        }
        return sorted[0];
      }

      const derivationLog = [];
      const derived = [];
      let iterations = 0;
      const maxIter = params.maxIterations || 200;
      for (let i = 0; i < maxIter; i++) {
        iterations++;
        const set = firings();
        if (set.length === 0) break;
        const chosen = resolveConflict(set, i);
        if (!chosen) break;
        const key = factKeyT(chosen.head);
        factSet.add(key);
        facts.push(chosen.head);
        derived.push(key);
        derivationLog.push({
          iteration: i + 1,
          fired: chosen.rule.name,
          priority: chosen.rule.priority || 0,
          conflictSetSize: set.length,
          derived: key,
          strategy,
        });
      }
      const factsByPredicate = {};
      for (const f of facts) factsByPredicate[f.predicate] = (factsByPredicate[f.predicate] || 0) + 1;
      return {
        ok: true,
        result: {
          strategy,
          initialFactCount: kb.facts.length,
          derivedFactCount: derived.length,
          totalFactCount: facts.length,
          iterations,
          fixedPointReached: iterations < maxIter,
          derivedFacts: derived.slice(0, 50),
          derivationLog: derivationLog.slice(0, 50),
          factsByPredicate,
          rulesApplied: [...new Set(derivationLog.map((d) => d.fired))],
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── kb-seed-sample: install a known-good demo KB (family relations) ──
  // Not fake data — it is a real, runnable rule set the user explicitly
  // requests to bootstrap an empty editor.
  registerLensAction("inference", "kb-seed-sample", (ctx) => {
    try {
      const kb = userKb(infActor(ctx));
      if (!kb) return { ok: false, error: "STATE unavailable" };
      const lines = [
        "parent(tom,bob)", "parent(bob,ann)", "parent(bob,pat)", "parent(pat,jim)",
        "male(tom)", "male(bob)", "male(jim)", "female(ann)", "female(pat)",
        "ancestor(?X,?Y) :- parent(?X,?Y)",
        "ancestor(?X,?Z) :- parent(?X,?Y), ancestor(?Y,?Z)",
        "grandparent(?X,?Z) :- parent(?X,?Y), parent(?Y,?Z)",
        "father(?X,?Y) :- parent(?X,?Y), male(?X)",
        "mother(?X,?Y) :- parent(?X,?Y), female(?X)",
      ];
      const added = [], errors = [];
      for (const line of lines) {
        const r = parseRule(line);
        if (r.error) { errors.push({ line, error: r.error }); continue; }
        if (r.if.length === 0) {
          const key = factKeyT(r.then);
          if (kb.facts.some((f) => factKeyT(f) === key)) continue;
          kb.facts.push({ id: infId("fact"), predicate: r.then.predicate, args: r.then.args, addedAt: new Date().toISOString() });
          added.push(line);
        } else {
          kb.rules.push({
            id: infId("rule"), name: `rule_${kb.rules.length + 1}`, priority: 0,
            if: r.if, then: r.then, addedAt: new Date().toISOString(), text: line,
          });
          added.push(line);
        }
      }
      saveInfState();
      return { ok: true, result: { addedCount: added.length, factCount: kb.facts.length, ruleCount: kb.rules.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
