// server/lib/runtime/dhtp-rs-human-export.js
// Export blind validation subset (DHTP-RS-MASTER-001 §16)

import { writeFileSync } from "node:fs";
import { randomInt } from "node:crypto";

/**
 * Build a randomized blind scoring packet from benchmark runs.
 * Evaluator sees task + response + rubric only — no condition identity.
 */
export function buildHumanValidationExport(bench, { sampleSize = 30, seed = 42 } = {}) {
  const pool = [];
  for (const pr of Object.values(bench.probeResults || {})) {
    for (const runs of Object.values(pr.runs || {})) {
      for (const run of runs) {
        if (!run.ok || !run.live?.preview) continue;
        pool.push({
          probeId: run.probeId,
          trialIndex: run.trialIndex,
          task: pr.probeLabel || run.probeId,
          responseText: run.live.preview,
          rubricDimensions: Object.keys(run.evaluation?.dimensions || {}),
          automatedComposite: run.evaluation?.composite,
          // condition withheld for blind human scoring
          _conditionId: run.conditionId,
        });
      }
    }
  }

  // Deterministic shuffle from seed
  const shuffled = [...pool];
  let s = seed;
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const sample = shuffled.slice(0, Math.min(sampleSize, shuffled.length));
  const blindItems = sample.map((item, idx) => ({
    id: `blind_${String(idx + 1).padStart(3, "0")}`,
    probeId: item.probeId,
    task: item.task,
    responseText: item.responseText,
    rubricDimensions: item.rubricDimensions,
    humanScores: {
      taskCorrectness: null,
      factualCoverage: null,
      importantFactRecall: null,
      hallucinationResistance: null,
      schemaAdherence: null,
      composite: null,
    },
    automatedComposite: item.automatedComposite,
    // sealed for post-hoc agreement analysis only
    _sealedCondition: item._conditionId,
  }));

  return {
    specId: "DHTP-RS-MASTER-001",
    exportedAt: new Date().toISOString(),
    sourceRunId: bench.runId,
    sampleSize: blindItems.length,
    seed,
    instructions: "Score each item 0-1 on each rubric dimension. Do not peek at _sealedCondition until all items scored.",
    items: blindItems,
  };
}

export function writeHumanValidationExport(bench, outPath, opts = {}) {
  const packet = buildHumanValidationExport(bench, opts);
  writeFileSync(outPath, JSON.stringify(packet, null, 2));
  return packet;
}
