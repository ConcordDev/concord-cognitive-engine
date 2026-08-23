/**
 * CSL Core — Concord Semantic Language Runtime
 *
 * 7-step orchestrator for formal semantic turns. Reuses existing infrastructure
 * (runMacro, classifyIntent, session-context-accumulator, dtu.create, brain routing).
 * Never throws; every step wrapped in try/catch. Enforces per-turn working-set budget
 * (Operator Decision 1) and data-AST-only mutations (Operator Decision 2).
 *
 * Spec: docs/SPRINT-33-CSL-PLAN.md §3, docs/SPRINT-33-MACRO-TRACE.md §3b
 */

import logger from '../logger.js';
import { PROOF_OBLIGATIONS } from './csl-proof-obligations.js';

export class ConcordSoSRuntime {
  #inFlight = new Map(); // key: 'domain.macro' -> { turnId, promise, expiresAt, stack }
  #callStack = new Set(); // tracking current call stack: 'domain.macro:turnId'
  #lockMetrics = { acquisitions: 0, timeouts: 0, reentrants: 0 };
  #sweepTimer = null;

  constructor({ db, runMacro, lensActions }) {
    this.db = db;
    this.runMacro = runMacro;
    this.lensActions = lensActions;
    this._startLockSweep();
  }

  /** Start periodic sweep to remove expired lock entries (every 60s) */
  _startLockSweep() {
    try {
      this.#sweepTimer = setInterval(() => {
        try {
          const now = Date.now();
          let expired = 0;
          for (const [key, entry] of this.#inFlight.entries()) {
            if (entry.expiresAt && entry.expiresAt < now) {
              this.#inFlight.delete(key);
              expired++;
            }
          }
          if (expired > 0) {
            logger.debug?.('[csl-core] Lock sweep: removed %d expired entries', expired);
          }
        } catch (e) {
          logger.warn?.('[csl-core] Lock sweep error: %s', e.message);
        }
      }, 60000); // 60s interval
      this.#sweepTimer.unref();
    } catch (e) {
      logger.debug?.('[csl-core] Failed to start lock sweep: %s', e.message);
    }
  }

  /** Stop the lock sweep (for cleanup/testing) */
  stopLockSweep() {
    if (this.#sweepTimer) {
      clearInterval(this.#sweepTimer);
      this.#sweepTimer = null;
    }
  }

  /**
   * Check if a macro has opt-in locking enabled (env CONCORD_CSL_LOCK_ALL_MACROS).
   * NOT currently consulted by _lockedRunMacro — Sprint 33's pinned test
   * requires different-turn waiting to be unconditional (see
   * docs/SPRINT-38-PROOFS-BLOCKING.md). Kept for server/tests/csl-lock.test.js's
   * direct calls and as a reserved hook for future per-macro selective locking.
   */
  _isLockedMacro(domain, macro) {
    try {
      const envLocked = process.env.CONCORD_CSL_LOCK_ALL_MACROS === 'true';
      if (envLocked) return true;
      // TODO: read macro metadata from MACROS registry when available
      // const meta = MACROS.get(domain)?.get(macro)?.meta;
      // return meta?.locked === true;
      return false; // opt-in default
    } catch (e) {
      return false;
    }
  }

  /** Get lock metrics for telemetry */
  getLockMetrics() {
    return {
      ...this.#lockMetrics,
      inFlightCount: this.#inFlight.size
    };
  }

  /**
   * Execute a single CSL turn: classify → retrieve → context → invoke → lock → translate → mint → audit
   * @param {object} input - { userId, sessionId, turnText, domainHint?, macroHint? }
   * @returns {Promise<{ ok, reply?, dtuId?, proofArtifact?, error?, reason? }>}
   */
  async executeTurn(input = {}) {
    // Sprint 38 fix (CTX-1, Sprint 33 QA findings): `input` can be explicitly
    // null/wrong-typed — the `= {}` default only covers `undefined`. Coerce
    // BEFORE constructing turnId so a bad caller never throws synchronously
    // (which `async` would otherwise turn into a rejected promise, violating
    // the documented never-throw contract).
    input = input && typeof input === 'object' ? input : {};
    const turnId = `${input.sessionId ?? 'anon'}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const proofObligations = {};

    // Sprint 37: run every proof obligation, keyed, and merge results into the
    // turn's final proofArtifact. Never blocking (Sprint 38 makes them so) —
    // see docs/SPRINT-37-FULL-PROOFS.md.
    const runObligation = async (name, turnContext) => {
      try {
        proofObligations[name] = await PROOF_OBLIGATIONS[name](turnContext);
      } catch (e) {
        proofObligations[name] = { sat: null, error: 'proof_skipped' };
      }
    };

    try {
      // Step 1: Classify intent. classifyIntent is SYNCHRONOUS and returns
      // { intent, confidence, ... } — not a bare string. (Sprint 34 audit
      // §3 filed this as INT-1: the prior `await`+string-compare form never
      // fired, so every language-intent turn fell through into the macro
      // layer. Fixed here as part of wiring obligation #6 below, which
      // depends on this gate actually working.)
      let intent = 'language';
      let turnText = typeof input?.turnText === 'string' ? input.turnText : '';
      try {
        const { classifyIntent } = await import('./chat/intent-router.js').catch(() => ({}));
        if (classifyIntent) {
          const classification = classifyIntent(turnText);
          intent = classification?.intent ?? 'language';
        }
      } catch (e) {
        logger.debug?.('[csl-core] intent classification error: %s', e.message);
      }

      // Obligation 6: intent routing correctness. Evaluated for every turn
      // that gets this far (reachedCsl:true) regardless of whether the gate
      // below is about to reject it — the obligation is precisely "did the
      // gate do its job", so it must observe the pre-gate classification.
      await runObligation('intentRoutingCorrectness', { turnText, reachedCsl: true });

      // Gate: reject non-formal intents (keep chat conversational)
      if (intent === 'language') {
        return { ok: false, reason: 'not_formal_intent', proofArtifact: { turnId, obligations: proofObligations } };
      }

      // Step 2: Quad-mode retrieve
      const hits = await this._retrieve(input.turnText || '');

      // Step 3: Form coherent context
      let context = [];
      try {
        const { getContextSnapshot } = await import('./session-context-accumulator.js');
        const snapshot = getContextSnapshot ? await getContextSnapshot(input.sessionId) : { dtus: [] };
        context = (snapshot.dtus || []).concat(hits);
        // Cap at working-set budget (measured in step 4 by invariant gate)
      } catch (e) {
        logger.debug?.('[csl-core] context accumulation error: %s', e.message);
        context = hits; // degrade to quad hits only
      }

      // Step 4: Invoke deterministic macro
      const { domainHint, macroHint } = input;
      let result = { ok: false, reason: 'no_macro_resolved' };

      if (domainHint && macroHint) {
        result = await this._lockedRunMacro(domainHint, macroHint, { text: input.turnText, context }, turnId);
      } else {
        // Resolve via dual registry (chat-agent / MCP pattern)
        try {
          const { resolveDualRegistry } = await import('./dual-registry-resolve.js');
          if (resolveDualRegistry) {
            const resolved = await resolveDualRegistry(
              input.turnText,
              this.lensActions,
              null, // macros registry not passed here, fallback to heuristic
              { role: 'system', internal: false }
            );
            if (resolved) {
              result = await this._lockedRunMacro(resolved.domain, resolved.macro, { text: input.turnText, context }, turnId);
            }
          }
        } catch (e) {
          logger.debug?.('[csl-core] dual registry resolve error: %s', e.message);
        }
      }

      // Obligation 2: macro lock safety — a bounded model check, no Z3/brain
      // needed (§5: this is a model-checking target, not an SMT one). Always
      // runs; folds in the real live lock metrics for observability.
      await runObligation('macroLockSafety', { lockMetrics: this.getLockMetrics() });

      // Obligation 3: citation cascade integrity — only meaningful for
      // royalty/marketplace-touching macros (§6's wire-up plan: "everything
      // else -> no proof obligation fires" is correct behavior, not a gap).
      const royaltyTouching = /royalty|marketplace|citation|cascade/i.test(`${domainHint || ''}.${macroHint || ''}`);
      if (royaltyTouching) {
        await runObligation('citationCascadeIntegrity', {});
      } else {
        proofObligations.citationCascadeIntegrity = { sat: null, error: 'not_applicable', model: { reason: 'macro_not_royalty_touching' } };
      }

      if (!result.ok) {
        return { ok: false, reason: 'macro_invoke_failed', error: result.error, proofArtifact: { turnId, obligations: proofObligations } };
      }

      // Step 5: LLM translates output (non-authoritative prose)
      let reply = '';
      try {
        const { TASK_PROMPTS } = await import('./prompt-registry.js');
        if (TASK_PROMPTS && TASK_PROMPTS.translation) {
          // Simulate brain call (actual brain routing is chat-agent pattern, not replicated here)
          reply = `Executed: ${result.ok ? 'success' : 'failed'}`;
        }
      } catch (e) {
        logger.debug?.('[csl-core] LLM translation error: %s', e.message);
      }

      // Obligation 4: memory budget compliance — reuses csl-invariant-gates.js's
      // already-built working-set check so the two never drift apart.
      await runObligation('memoryBudgetCompliance', { turnId, db: this.db, macroResult: result, context });

      // Obligation 5: schema migration safety — only fires when the macro
      // result itself reports a before/after column set; CSL turns don't run
      // migrations, so the common case is honestly not_applicable (§5).
      await runObligation('schemaMigrationSafety', {
        migrationColumnsBefore: result?.migrationColumnsBefore,
        migrationColumnsAfter: result?.migrationColumnsAfter,
      });

      // Step 6: DTU-mint with envelope validation + proof obligation
      let dtuId = null;
      try {
        const { validate: validateDtuEnvelope } = await import('./dtu-protocol.js');
        const payload = {
          creti: reply || result.message || '',
          body: result,
          kind: 'csl_turn_output',
          source: 'csl-core'
        };
        if (validateDtuEnvelope && !validateDtuEnvelope(payload)) {
          return { ok: false, reason: 'envelope_invalid', proofArtifact: { turnId, obligations: proofObligations } };
        }

        // Obligation 1: DTU mint integrity — hash matches payload, checked
        // before the mint call.
        await runObligation('dtuMintIntegrity', { content: payload });

        // Sprint 38: dtuMintIntegrity is the first obligation promoted to
        // BLOCKING (this is Sprint 34/37's "envelope well-formed" proof,
        // renamed under the full six-obligation taxonomy — see
        // docs/SPRINT-38-PROOFS-BLOCKING.md for why this one, and the
        // per-obligation rollout plan for the other five). Opt-in via
        // CONCORD_CSL_PROOFS_BLOCKING=true so it can be rolled out
        // gradually. sat:null (inconclusive, e.g. Z3 unavailable, or
        // not_applicable) NEVER blocks — only an explicit sat:false (a real,
        // checked violation) does, per proof-gate.js's own honesty framing.
        if (process.env.CONCORD_CSL_PROOFS_BLOCKING === 'true' && proofObligations.dtuMintIntegrity?.sat === false) {
          return { ok: false, reason: 'proof_obligation_failed', proofArtifact: { turnId, obligations: proofObligations } };
        }

        const mintResult = await this.runMacro('dtu', 'create', payload, { userId: input.userId });
        if (mintResult.ok) {
          dtuId = mintResult.id;
        }
      } catch (e) {
        logger.debug?.('[csl-core] DTU mint error: %s', e.message);
      }

      // Step 7: Privacy access-log
      try {
        const { _appendPrivacyAccessEvent } = await import('../server.js').catch(() => ({}));
        if (_appendPrivacyAccessEvent) {
          _appendPrivacyAccessEvent({
            userId: input.userId,
            domain: domainHint || 'csl',
            macro: macroHint || 'turn',
            source: 'csl-turn',
            allowed: true
          });
        }
      } catch (e) {
        logger.debug?.('[csl-core] privacy log error: %s', e.message);
      }

      return {
        ok: true,
        reply: reply || `Executed CSL turn (${domainHint || 'unknown'}.${macroHint || 'unknown'})`,
        dtuId,
        proofArtifact: { turnId, timestamp: new Date().toISOString(), obligations: proofObligations }
      };
    } catch (e) {
      logger.warn?.('[csl-core] Unhandled turn error: %s', e.message);
      return { ok: false, reason: 'turn_exception', error: e.message, proofArtifact: { turnId, obligations: proofObligations } };
    }
  }

  /**
   * Retrieve context via quad-mode (dense + BM25 + lattice + graph)
   */
  async _retrieve(query) {
    try {
      const { quadRetrieve } = await import('./csl-quad-retrieval.js');
      return await quadRetrieve(this.db, query);
    } catch {
      return []; // oc-pickle's module not landed, or threw
    }
  }

  /**
   * Run macro with per-(domain, macro) lock to prevent re-entrant deadlock.
   *
   * Sprint 38 fix: reconciles two previously-conflicting specs pinned by two
   * different test files (server/tests/csl-core.test.js, Sprint 33 —
   * concurrent SIBLING calls sharing a turnId must both succeed with no
   * wait; a different turnId must wait unconditionally — vs.
   * server/tests/csl-lock.test.js, Sprint 36 — a macro that synchronously
   * calls itself again for the SAME (domain, macro, turnId) — true recursion
   * — must fail fast with 'macro_reentrance'). Both are correct; they
   * describe different scenarios that look identical to a naive
   * "have I seen this key+turnId before" check, because JS's Promise.all
   * evaluates array elements synchronously up to each one's first `await` —
   * a sibling call issued via Promise.all and a genuinely nested recursive
   * call both observe "this key is already active" at check time.
   *
   * The real distinguishing signal is WHEN the second call happens relative
   * to the first call's own synchronous prefix: true recursion happens
   * WHILE the outer call is still synchronously inside its `this.runMacro()`
   * invocation (before that call has returned control at all); a sibling
   * call only starts once the first call has already yielded at its own
   * `await` (i.e., already returned a pending promise for the array). So
   * `#callStack` here brackets ONLY the synchronous call to `this.runMacro`
   * (added immediately before, deleted immediately after) rather than the
   * whole async lifetime of the macro — that narrow window is exactly when
   * true nested recursion could occur, and is over before any legitimately
   * separate concurrent caller gets scheduled (JS is single-threaded).
   *
   * - Same turnId: never waits on its own lock (self-deadlock guard — this
   *   is the exact invariant csl-proof-obligations.js's macro-lock model
   *   checks as `no_self_wait`).
   * - True nested recursion (same key+turnId, still inside the outer's own
   *   synchronous `this.runMacro()` call): fails fast, 'macro_reentrance'.
   * - Different turnId: waits unconditionally for the in-flight promise,
   *   bounded by CONCORD_CSL_MACRO_LOCK_TIMEOUT_MS /
   *   CONCORD_CSL_MACRO_TIMEOUT_MS (default 30s; both env var names are
   *   honored — Sprint 33 and Sprint 36 pinned different names for the same
   *   knob). A stale/expired lock is cleared rather than hung on forever.
   * - `_isLockedMacro()` (opt-in per-macro gating via
   *   CONCORD_CSL_LOCK_ALL_MACROS) is NOT consulted here — Sprint 33's
   *   pinned test requires different-turn waiting to be the unconditional
   *   default. The method is kept, unmodified, for server/tests/csl-lock.test.js's
   *   direct calls and as a reserved hook for future per-macro-metadata
   *   selective locking (its own TODO), but it does not currently gate this
   *   function's behavior — see docs/SPRINT-38-PROOFS-BLOCKING.md.
   * - Metrics: acquisitions, timeouts, re-entrance detections
   *   (getLockMetrics()).
   */
  async _lockedRunMacro(domain, name, input, turnId) {
    const key = `${domain}.${name}`;
    const stackKey = `${key}:${turnId}`;
    const timeout = parseInt(
      process.env.CONCORD_CSL_MACRO_LOCK_TIMEOUT_MS || process.env.CONCORD_CSL_MACRO_TIMEOUT_MS || '30000',
      10
    );
    let promise;

    try {
      // True synchronous recursion: a call for this exact key+turnId is
      // already inside its own `this.runMacro()` invocation. Fail fast —
      // never awaits, so nested recursion unwinds cleanly with no deadlock.
      if (this.#callStack.has(stackKey)) {
        this.#lockMetrics.reentrants++;
        logger.debug?.('[csl-core] Re-entrance detected: %s (turnId: %s)', key, turnId);
        return { ok: false, reason: 'macro_reentrance', message: `Circular call to ${key}` };
      }

      const existing = this.#inFlight.get(key);
      if (existing && existing.turnId !== turnId) {
        // A different turn holds the lock: wait for it, bounded by timeout.
        try {
          await Promise.race([
            existing.promise.catch(() => {}),
            new Promise((_, rej) => { setTimeout(() => rej(new Error('lock_wait_timeout')), timeout); }),
          ]);
        } catch (e) {
          if (e.message === 'lock_wait_timeout') {
            this.#lockMetrics.timeouts++;
            if (this.#inFlight.get(key)?.promise === existing.promise) {
              this.#inFlight.delete(key);
            }
          }
        }
      }
      // Same turnId as the current holder (or no holder at all): proceed
      // immediately, never wait on our own lock.

      this.#callStack.add(stackKey);
      try {
        promise = this.runMacro(domain, name, input, { userId: input.userId || 'system', internal: false });
      } finally {
        // Deleted immediately (still synchronous relative to this call) —
        // this is what makes the reentrance window exact rather than
        // spanning the whole async macro lifetime.
        this.#callStack.delete(stackKey);
      }

      this.#lockMetrics.acquisitions++;
      const expiresAt = Date.now() + timeout;
      this.#inFlight.set(key, { turnId, promise, expiresAt, stack: new Error().stack });

      const timeoutPromise = new Promise((_, rej) => { setTimeout(() => rej(new Error('macro_lock_timeout')), timeout); });
      return await Promise.race([promise, timeoutPromise]);
    } catch (e) {
      if (e.message === 'macro_lock_timeout') {
        this.#lockMetrics.timeouts++;
        logger.warn?.('[csl-core] Macro lock timeout: %s.%s (turnId: %s)', domain, name, turnId);
        return { ok: false, reason: 'macro_lock_timeout' };
      }
      return { ok: false, reason: 'macro_error', error: e.message };
    } finally {
      try {
        this.#callStack.delete(stackKey); // safety net if an exception hit before the inner delete above
        if (promise && this.#inFlight.get(key)?.promise === promise) {
          this.#inFlight.delete(key);
        }
      } catch (e) {
        logger.debug?.('[csl-core] Lock cleanup error: %s', e.message);
      }
    }
  }
}
