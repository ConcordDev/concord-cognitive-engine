// server/lib/shadow-council.js
//
// Shadow Reasoning Council (#12) — turns the five-voice council (emergent/
// council-voices.js) from a transient VOTE into a persisted, citable
// deliberation. Each voice argues from its bias; the module composes the
// consensus + the DISSENT (the minority report that a plain "accept/reject"
// throws away) and mints a kind='shadow_reasoning' DTU so the reasoning becomes
// a first-class, citable artifact of the substrate. Fully deterministic — the
// council math is pure, so no brains are required; an optional LLM pass can
// enrich each voice's prose but never changes the verdict.

import { runCouncilVoices, COUNCIL_VOICES } from "../emergent/council-voices.js";
import { createDTU } from "../economy/dtu-pipeline.js";

/**
 * Run the shadow council on a question/proposal and (optionally) persist the
 * deliberation as a DTU. Never throws.
 *
 * @param {object} db
 * @param {object} opts
 * @param {string}  opts.question       the question/claim under deliberation
 * @param {object}  [opts.proposal]     optional {scores,tags} signals for the voices
 * @param {object}  [opts.qualiaState]  optional channel state to bias voices
 * @param {string}  [opts.requesterId]  author of the minted DTU
 * @param {boolean} [opts.persist=false] mint a shadow_reasoning DTU
 * @returns {{ok, verdict, confidence, unanimous, voices, consensus, dissent, dtuId?}}
 */
export function deliberate(db, { question, proposal = null, qualiaState = null, requesterId = null, persist = false } = {}) {
  const q = String(question || "").trim();
  if (!q) return { ok: false, reason: "no_question" };

  // Derive a minimal proposal shape when the caller passes only a question.
  const prop = proposal || { title: q, tags: [], scores: {} };
  let council;
  try {
    council = runCouncilVoices(prop, qualiaState);
  } catch (e) {
    return { ok: false, reason: "council_failed", error: String(e?.message || e) };
  }

  const entries = Object.entries(council.voices).map(([id, v]) => ({ id, ...v }));
  const consensus = entries.filter((v) => v.vote === council.verdictAction).map((v) => v.id);
  // The minority report: voices that disagree with the verdict — the value the
  // shadow council preserves that a flat vote discards.
  const dissent = entries
    .filter((v) => v.vote !== council.verdictAction)
    .map((v) => ({ voice: v.id, label: v.label, vote: v.vote, score: v.score, concern: v.perspective }));

  const result = {
    ok: true,
    question: q,
    verdict: council.verdictAction,
    confidence: council.confidence,
    unanimous: council.unanimous,
    voices: council.voices,
    consensus,
    dissent,
  };

  if (persist && db && requesterId) {
    try {
      const body = composeDeliberationProse(q, council, dissent);
      const r = createDTU(db, {
        creatorId: requesterId,
        title: `Shadow council: ${q.slice(0, 80)}`,
        content: body,
        contentType: "text",
        lensId: "reason",
        citationMode: "original",
        tags: ["shadow_reasoning", "council", council.verdictAction],
        metadata: {
          kind: "shadow_reasoning",
          verdict: council.verdictAction,
          confidence: council.confidence,
          unanimous: council.unanimous,
          dissent: dissent.map((d) => d.voice),
        },
      });
      if (r?.ok && r.dtu?.id) result.dtuId = r.dtu.id;
    } catch { /* persistence is best-effort — the deliberation stands without it */ }
  }
  return result;
}

/** Deterministic prose rendering of the deliberation (the DTU body). */
export function composeDeliberationProse(question, council, dissent) {
  const lines = [`Question: ${question}`, "", `Verdict: ${council.verdictAction} (confidence ${council.confidence})`, ""];
  for (const voice of COUNCIL_VOICES) {
    const v = council.voices[voice.id];
    if (!v) continue;
    lines.push(`— ${v.label} [${v.vote}, ${v.score}]: ${v.perspective}`);
  }
  if (dissent.length) {
    lines.push("", "Minority report:");
    for (const d of dissent) lines.push(`  • ${d.label} (${d.vote}): ${d.concern}`);
  } else {
    lines.push("", "The council was unanimous.");
  }
  return lines.join("\n");
}

export default { deliberate, composeDeliberationProse };
