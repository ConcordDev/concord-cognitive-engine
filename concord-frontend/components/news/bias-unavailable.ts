/**
 * Shared rendering for news bias fields the server returns as null.
 *
 * The news domain returns null plus a reason code when it cannot measure a
 * lean (no loaded/hedge words, or no article text). Consumers must show
 * "Not available" and a plain sentence, never the raw code, "null",
 * "undefined", "NaN", or a fake 0. Measured values (including a real 0) are
 * passed through unchanged.
 */

export const NOT_AVAILABLE = 'Not available';

const REASON_SENTENCE: Record<string, string> = {
  no_bias_terms: 'no loaded or hedge words found in the text',
  no_text: 'no article text to score',
};

/** Plain-language sentence for a bias reason code. Never returns the raw code. */
export function biasReasonSentence(reason: string | null | undefined): string {
  return (reason && REASON_SENTENCE[reason]) || 'not enough text to score';
}

/** `Not available: <reason>` for a null bias field. */
export function biasUnavailableText(reason: string | null | undefined): string {
  return `${NOT_AVAILABLE}: ${biasReasonSentence(reason)}`;
}

/** A real finite number, or null. Anything else (null, undefined, NaN) is unmeasured. */
export function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
