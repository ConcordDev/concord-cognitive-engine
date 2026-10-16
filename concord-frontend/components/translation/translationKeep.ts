/**
 * Keep a finished translation as a private DTU, then a Thread draft (shared
 * dtu.create -> dtu.get read-back -> thread.thread-draft handoff in
 * components/lens/recordKeep.ts). Built only from a translate result the
 * panel already shows — no input or output text, nothing to keep.
 */

import type { KeptRecord } from '@/components/lens/recordKeep';

export interface TranslationKeepInput {
  source?: string;
  target?: string;
  formality?: string;
  input?: string;
  output?: string;
}

function text(value: unknown, max = 4000): string {
  return String(value == null ? '' : value).trim().slice(0, max);
}

/** A translation the panel already rendered. Null with no input or output text. */
export function translationKeptRecord(t: TranslationKeepInput | null | undefined): KeptRecord | null {
  const input = text(t?.input, 8000);
  const output = text(t?.output, 8000);
  if (!t || !input || !output) return null;
  const title = text(output.split('\n')[0], 240);
  if (!title) return null;
  const source = text(t.source, 40);
  const target = text(t.target, 40);
  const formality = text(t.formality, 40);
  const lines = [title];
  if (source && target) lines.push(`${source} → ${target}`);
  if (formality) lines.push(`Register: ${formality}`);
  lines.push('Source text:', input);
  lines.push('Translation:', output);
  return {
    title,
    body: lines.join('\n'),
    tags: ['translation', 'output'],
    source: 'translation-lens:translation',
    createdFrom: 'translation',
    draftTitle: `Translation — ${title}`.slice(0, 120),
    machine: {
      kind: 'translation',
      source: source || null,
      target: target || null,
      formality: formality || null,
      input,
      output,
    },
  };
}