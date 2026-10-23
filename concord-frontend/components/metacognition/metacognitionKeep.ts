/**
 * Keep a logged prediction as a private DTU, then a Thread draft (shared
 * dtu.create -> dtu.get read-back -> thread.thread-draft handoff in
 * components/lens/recordKeep.ts). Built only from the prediction row the
 * predictions list already rendered — no statement, nothing to keep.
 */

import type { KeptRecord } from '@/components/lens/recordKeep';

function text(value: unknown, max = 4000): string {
  return String(value == null ? '' : value).trim().slice(0, max);
}

/**
 * A prediction row from metacognition.predictions, read the way the
 * predictions list reads it (statement/claim/description/prediction aliases,
 * outcome/resolved/result aliases).
 */
export function metacognitionKeptRecord(p: Record<string, unknown> | null | undefined): KeptRecord | null {
  const title = text(p?.statement || p?.claim || p?.description || p?.prediction, 400);
  const id = text(p?.id || p?.prediction_id, 80);
  if (!p || !title || !id) return null;
  const lines = [title, `Prediction ${id}`];
  const confidenceRaw = p.confidence;
  const confidence = typeof confidenceRaw === 'number' && Number.isFinite(confidenceRaw) ? confidenceRaw : null;
  if (confidence != null) {
    const pct = Math.round(Math.min(1, Math.max(0, confidence)) * 100);
    lines.push(`Confidence: ${pct}%`);
  }
  const domain = text(p.domain, 60);
  if (domain) lines.push(`Domain: ${domain}`);
  const outcome = p.outcome ?? p.resolved ?? p.result;
  const outcomeText =
    outcome === true || outcome === 'correct' || outcome === 'hit'
      ? 'correct'
      : outcome === false || outcome === 'incorrect' || outcome === 'miss'
        ? 'incorrect'
        : outcome == null
          ? null
          : text(outcome, 20) || null;
  if (outcomeText) lines.push(`Outcome: ${outcomeText}`);
  const createdAt = text(p.createdAt || p.timestamp || p.created_at, 60);
  if (createdAt) lines.push(`Logged: ${createdAt}`);
  return {
    title,
    body: lines.join('\n'),
    tags: ['metacognition', 'prediction'],
    source: 'metacognition-lens:prediction',
    createdFrom: 'metacognition',
    draftTitle: `Prediction — ${title}`.slice(0, 120),
    machine: {
      kind: 'metacognition_prediction',
      predictionId: id,
      statement: title,
      confidence,
      domain: domain || null,
      outcome: outcomeText,
      createdAt: createdAt || null,
    },
  };
}