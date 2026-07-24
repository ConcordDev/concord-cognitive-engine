// server/lib/simulation/envelope-artifact.js
//
// W1-C — turns a computeEnvelope() result into a static data artifact for a
// real RT toolchain (PLC / FPGA / microcontroller) to compile and execute.
// This module never emits executable control logic — only a lookup table
// plus its bounds and provenance.
//
// ---------------------------------------------------------------------------
// Concord does not and cannot execute real-time control. This engine performs
// OFFLINE design and verification only. Node.js has no real-time guarantees —
// garbage-collection pauses alone are milliseconds, orders of magnitude above
// a sub-millisecond actuator deadline — so nothing here is a controller and
// nothing here should be placed in a control loop. The output is a static
// data artifact: a lookup table plus its bounds and provenance, intended to
// be compiled into, and executed by, real RT hardware (PLC / FPGA /
// microcontroller) whose timing guarantees are established by that platform
// and its own certification process, not by this engine.
//
// The envelope is computed by gridded forward reachability with a Grönwall
// growth-bound inflation. It is conservative if and only if the supplied
// Lipschitz constant is a true upper bound over the state box. When the
// bound is declared by the caller or exact for a linear plant, the artifact
// is tagged certified_modulo_declared_bound. When it is estimated by
// sampling the Jacobian, it is tagged empirical_sampled and only empirical
// evidence language is used, never certification wording — a sup over
// samples is not a bound over a continuum. Fixed-step RK4 truncation error
// is reported, not eliminated.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';

export const RUNTIME_BOUNDARY = `Concord does not and cannot execute real-time control. This engine performs OFFLINE design and verification only. Node.js has no real-time guarantees — garbage-collection pauses alone are milliseconds, orders of magnitude above a sub-millisecond actuator deadline — so nothing here is a controller and nothing here should be placed in a control loop. The output is a static data artifact: a lookup table plus its bounds and provenance, intended to be compiled into, and executed by, real RT hardware (PLC / FPGA / microcontroller) whose timing guarantees are established by that platform and its own certification process, not by this engine.

The envelope is computed by gridded forward reachability with a Grönwall growth-bound inflation. It is conservative if and only if the supplied Lipschitz constant is a true upper bound over the state box. When the bound is declared by the caller or exact for a linear plant, the artifact is tagged certified_modulo_declared_bound. When it is estimated by sampling the Jacobian, it is tagged empirical_sampled and only empirical evidence language is used, never certification wording — a sup over samples is not a bound over a continuum. Fixed-step RK4 truncation error is reported, not eliminated.`;

const SCHEMA_VERSION = '1.0.0';
const ENGINE_VERSION = '1.0.0';

function stableStringify(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return JSON.stringify(value);
}

function hashInput(payload) {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

/**
 * Build the final data artifact from a computeEnvelope() result.
 * @param {object} envelopeResult - the return value of computeEnvelope()
 * @param {object} [meta] - optional extra provenance fields
 */
export function buildArtifact(envelopeResult, meta = {}) {
  const {
    plant, constraints, adversarialInput, horizon,
    grid, labels, dims, safeCount, totalCells, coverageFraction,
    lipschitz, growthInflation, integratorStepError, equilibrium,
  } = envelopeResult;

  const certified = lipschitz.basis === 'declared' || lipschitz.basis === 'exact_linear';
  const claimTier = certified ? 'certified_modulo_declared_bound' : 'empirical_sampled';

  const inputHash = hashInput({ plant, constraints, adversarialInput, horizon, grid });

  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    plant,
    constraints,
    grid,
    table: {
      encoding: 'row-major-int8',
      dims,
      data: Array.from(labels),
    },
    safeCount,
    totalCells,
    coverageFraction,
    bounds: {
      lipschitz,
      growthInflation,
      integratorStepError,
    },
    equilibrium,
    claimTier,
    provenance: {
      engine: 'concord-safety-envelope',
      version: ENGINE_VERSION,
      generatedAt: new Date().toISOString(),
      inputHash,
      ...meta,
    },
    runtimeBoundary: RUNTIME_BOUNDARY,
  };

  // 🔴 Two-tier claim — mandatory. A sup over samples is not a bound over a
  // continuum: when the Lipschitz bound is only a sampled estimate, the word
  // "proof" must not appear anywhere in this artifact.
  if (certified) {
    artifact.proofOfBounds = {
      method: 'gridded-forward-reachability-gronwall-inflation',
      lipschitz,
      growthInflation,
      integratorStepError,
      statement: 'Every cell labeled SAFE is conservative modulo the declared/exact Lipschitz bound and the reported fixed-step RK4 truncation error.',
    };
  } else {
    artifact.empiricalBoundsEvidence = {
      method: 'gridded-forward-reachability-gronwall-inflation',
      lipschitz,
      growthInflation,
      integratorStepError,
      statement: 'Lipschitz value is a sup over sampled Jacobian evaluations, not a bound established over the whole continuum. Treat as empirical evidence, not certification.',
    };
  }

  return artifact;
}

function formatBoundaryComment(prefix) {
  return RUNTIME_BOUNDARY.split('\n').map((line) => (line ? `${prefix}${line}` : prefix.trimEnd())).join('\n');
}

function emitCsv(artifact) {
  const lines = [];
  lines.push(formatBoundaryComment('# '));
  lines.push(`# claimTier: ${artifact.claimTier}`);
  lines.push(`# schemaVersion: ${artifact.schemaVersion}`);
  const axisNames = artifact.grid.axes.map((a) => a.name);
  lines.push([...axisNames.map((n) => `${n}_idx`), 'safe'].join(','));
  const dims = artifact.table.dims;
  const data = artifact.table.data;
  const idx = new Array(dims.length).fill(0);
  for (let flat = 0; flat < data.length; flat++) {
    let rem = flat;
    for (let d = dims.length - 1; d >= 0; d--) {
      idx[d] = rem % dims[d];
      rem = Math.floor(rem / dims[d]);
    }
    lines.push([...idx, data[flat]].join(','));
  }
  return lines.join('\n');
}

function emitCHeader(artifact) {
  const guard = 'CONCORD_SAFETY_ENVELOPE_H';
  const dims = artifact.table.dims;
  const data = artifact.table.data;
  const lines = [];
  lines.push('/*');
  lines.push(formatBoundaryComment(' * '));
  lines.push(` * claimTier: ${artifact.claimTier}`);
  lines.push(` * schemaVersion: ${artifact.schemaVersion}`);
  lines.push(' */');
  lines.push(`#ifndef ${guard}`);
  lines.push(`#define ${guard}`);
  lines.push('');
  lines.push('#include <stdint.h>');
  lines.push('');
  lines.push(`static const unsigned SAFETY_ENVELOPE_DIMS[${dims.length}] = { ${dims.join(', ')} };`);
  lines.push(`static const int8_t SAFETY_ENVELOPE_TABLE[${data.length}] = {`);
  lines.push(`  ${data.join(', ')}`);
  lines.push('};');
  lines.push('');
  lines.push(`#endif /* ${guard} */`);
  return lines.join('\n');
}

/**
 * Emit the artifact in a given format. Every format embeds the runtime
 * boundary text — this is a DATA artifact only, never executable control
 * logic, even in the "c-header" form (a static const lookup table for an RT
 * toolchain to compile, not a control loop).
 */
export function emitTable(artifact, format = 'json') {
  if (format === 'json') return JSON.stringify(artifact, null, 2);
  if (format === 'csv') return emitCsv(artifact);
  if (format === 'c-header') return emitCHeader(artifact);
  const err = new Error(`unsupported artifact format: "${format}"`);
  err.code = 'unsupported_format';
  throw err;
}
