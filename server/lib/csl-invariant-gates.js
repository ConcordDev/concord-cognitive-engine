/**
 * CSL Invariant Gates — Runtime Pre-Persist Verification
 *
 * Called between macro invoke (step 4) and DTU-mint (step 6). Enforces:
 * - Per-turn working-set budget (Operator Decision 1, replaces spec's 512MB gate)
 * - Memory pressure (if process shedding, reject turn)
 * - Envelope validation (dtu-protocol integrity)
 * - Lattice bounds (INT4 coordinate checks)
 * - KV cache retention policy (enum validation)
 *
 * Spec: docs/SPRINT-33-OPERATOR-DECISIONS.md §25, docs/SPRINT-33-ARCH-RISK-REGISTER.md §Q3/Q6
 */

import logger from '../logger.js';

/**
 * Verify invariants before persisting CSL turn output
 * @param {object} db - SQLite connection
 * @param {object} turnState - { macroResult, context, userId, sessionId }
 * @returns {Promise<{ isValid: boolean, proofArtifact: object }>}
 */
export async function checkInvariants(db, turnState = {}) {
  const turnId = turnState.turnId || `csl:${Date.now()}`;
  const timestamp = new Date().toISOString();
  const checks = [];
  let isValid = true;

  try {
    // Check 1: Per-turn working-set budget
    const budgetBytes = parseInt(process.env.CONCORD_CSL_TURN_BUDGET_BYTES || `${8 * 1024 * 1024}`, 10);
    const serializedSize = JSON.stringify(turnState.macroResult || {}).length +
                          JSON.stringify(turnState.context || []).length;

    checks.push({
      name: 'working_set_budget',
      pass: serializedSize <= budgetBytes,
      detail: `${serializedSize} bytes / ${budgetBytes} bytes`
    });
    if (!checks[checks.length - 1].pass) {
      isValid = false;
    }

    // Check 2: Memory pressure gate
    let memoryPressureLevel = 'normal';
    try {
      const { getMemoryPressureLevel } = await import('./memory-pressure.js');
      if (getMemoryPressureLevel) {
        memoryPressureLevel = getMemoryPressureLevel();
      }
    } catch (e) {
      logger.debug?.('[csl-invariant-gates] memory-pressure import error: %s', e.message);
    }

    const shouldRejectMemory = memoryPressureLevel === 'shed' || memoryPressureLevel === 'critical';
    checks.push({
      name: 'memory_pressure',
      pass: !shouldRejectMemory,
      detail: memoryPressureLevel
    });
    if (!checks[checks.length - 1].pass) {
      isValid = false;
    }

    // Check 3: Envelope validation (hard gate — must always run)
    let envelopeValid = true;
    try {
      const { validate: validateEnvelope } = await import('./dtu-protocol.js');
      if (validateEnvelope && turnState.macroResult) {
        envelopeValid = validateEnvelope(turnState.macroResult);
      }
    } catch (e) {
      logger.debug?.('[csl-invariant-gates] envelope validation error: %s', e.message);
      envelopeValid = false;
    }

    checks.push({
      name: 'envelope_valid',
      pass: envelopeValid
    });
    if (!checks[checks.length - 1].pass) {
      isValid = false;
    }

    // Check 4: Lattice bounds (if coordinates present)
    const latticeCoordinateBound = 127; // start with INT8 range; coordinate with oc-embed
    if (turnState.latticeCoords) {
      const { lattice_x, lattice_y, lattice_z } = turnState.latticeCoords;
      const boundsOk = (lattice_x != null && Math.abs(lattice_x) <= latticeCoordinateBound) &&
                       (lattice_y != null && Math.abs(lattice_y) <= latticeCoordinateBound) &&
                       (lattice_z != null && Math.abs(lattice_z) <= latticeCoordinateBound);
      checks.push({
        name: 'lattice_bounds',
        pass: boundsOk,
        detail: boundsOk ? 'in-bounds' : `coords out of [-${latticeCoordinateBound}, ${latticeCoordinateBound}]`
      });
      if (!boundsOk) {
        isValid = false;
      }
    } else {
      checks.push({
        name: 'lattice_bounds',
        pass: true,
        detail: 'no-coords'
      });
    }

    // Check 5: KV cache retention policy enum
    const validRetentionPolicies = ['PERSIST', 'SESSION_TTL', 'EXPIRE_7D', 'EXPIRE_30D'];
    if (turnState.kvCacheRetentionPolicy) {
      const policyOk = validRetentionPolicies.includes(turnState.kvCacheRetentionPolicy);
      checks.push({
        name: 'kv_retention_policy',
        pass: policyOk,
        detail: turnState.kvCacheRetentionPolicy
      });
      if (!policyOk) {
        isValid = false;
      }
    } else {
      checks.push({
        name: 'kv_retention_policy',
        pass: true,
        detail: 'no-kv-cache'
      });
    }

    // Check 6: Cheap inline format checks (avoid full detector suite)
    let formatOk = true;
    if (turnState.macroResult) {
      const result = turnState.macroResult;
      // Very cheap checks: is it object-shaped, does it have required envelope fields
      formatOk = result && typeof result === 'object' && (result.ok !== undefined);
    }
    checks.push({
      name: 'result_format',
      pass: formatOk,
      detail: formatOk ? 'valid' : 'malformed'
    });
    if (!formatOk) {
      isValid = false;
    }

    const proofArtifact = {
      turnId,
      timestamp,
      workingSetBytes: serializedSize,
      memoryPressureLevel,
      checks
    };

    logger.debug?.('[csl-invariant-gates] Turn %s: %d checks, %d pass', turnId, checks.length, checks.filter(c => c.pass).length);

    return {
      isValid,
      proofArtifact
    };
  } catch (e) {
    logger.warn?.('[csl-invariant-gates] Invariant check error: %s', e.message);
    return {
      isValid: false,
      proofArtifact: {
        turnId,
        timestamp,
        checks: [{ name: 'gate_exception', pass: false, detail: e.message }]
      }
    };
  }
}
