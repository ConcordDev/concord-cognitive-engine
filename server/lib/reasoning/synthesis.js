/**
 * server/lib/reasoning/synthesis.js
 *
 * Synthesize a final response from accumulated shadow DTUs.
 * Used when reasoning has been crystallized across multiple generations.
 */

import logger from '../../logger.js';
import { TASK_PROMPTS } from '../prompt-registry.js';

const SINGLE_MESSAGE_TOKEN_ESTIMATE = 2000; // ~1500 words

/**
 * Estimate token count from text length (rough: 4 chars ≈ 1 token).
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

/**
 * Split text into natural segments at paragraph/sentence boundaries.
 * @param {string} text
 * @param {number} maxTokensPerSegment
 * @returns {string[]}
 */
export function splitIntoNaturalSegments(text, maxTokensPerSegment = SINGLE_MESSAGE_TOKEN_ESTIMATE) {
  const maxChars = maxTokensPerSegment * 4;
  if (text.length <= maxChars) return [text];

  const segments = [];
  const paragraphs = text.split(/\n\n+/);
  let current = '';

  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length > maxChars && current) {
      segments.push(current.trim());
      current = para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
  }
  if (current.trim()) segments.push(current.trim());

  return segments.length ? segments : [text];
}

/**
 * Determine whether to deliver response as single or multi-message.
 * @param {string} responseText
 * @returns {{ format: string, segments: string[] }}
 */
export function determineDeliveryFormat(responseText) {
  const tokens = estimateTokens(responseText);
  if (tokens <= SINGLE_MESSAGE_TOKEN_ESTIMATE) {
    return { format: 'single_message', segments: [responseText] };
  }
  const segments = splitIntoNaturalSegments(responseText, SINGLE_MESSAGE_TOKEN_ESTIMATE);
  return {
    format: 'multi_message_sequence',
    segments,
    totalSegments: segments.length,
  };
}

/**
 * Build the synthesis prompt from accumulated shadows.
 * @param {string} originalIntent
 * @param {object[]} shadows - Array of shadow DTU objects with .human.summary and .core.invariants
 * @param {string} currentReasoningText - Last reasoning fragment (may be empty)
 * @returns {string}
 */
export function buildSynthesisPrompt(originalIntent, shadows, currentReasoningText) {
  const shadowBlock = shadows.map((s, i) => {
    const summary = s.human?.summary || s.machine?.summary || '';
    const insights = (s.core?.invariants || s.human?.bullets || []).slice(0, 5);
    return `=== Shadow ${i + 1} (generation ${s.machine?.generation || i + 1}) ===
${summary}
${insights.length ? '\nKey insights:\n' + insights.map(k => `• ${k}`).join('\n') : ''}`;
  }).join('\n\n');

  return TASK_PROMPTS.reasoningSynthesis({ shadows, originalIntent, shadowBlock, currentReasoningText });
}

/**
 * Synthesize a final response when shadows exist.
 * If no shadows (single-generation reasoning), returns the finalText directly.
 *
 * @param {object} opts
 * @param {string} opts.originalIntent
 * @param {object[]} opts.shadows - Shadow DTUs for this session
 * @param {string} opts.currentReasoningText - Last agent loop finalText
 * @param {Function} opts.inferFn - infer() function
 * @param {string} opts.callerId
 * @param {string} [opts.brainRole]
 * @returns {Promise<{ text: string, wasSynthesized: boolean, shadowsUsed: number }>}
 */
export async function synthesizeFromShadows({
  originalIntent,
  shadows,
  currentReasoningText,
  inferFn,
  callerId,
  brainRole = 'conscious',
}) {
  if (!shadows || shadows.length === 0) {
    // No crystallization — direct response
    return { text: currentReasoningText, wasSynthesized: false, shadowsUsed: 0 };
  }

  logger.debug('reasoning:synthesis', 'Synthesizing from shadows', {
    shadowCount: shadows.length,
    callerId,
  });

  const prompt = buildSynthesisPrompt(originalIntent, shadows, currentReasoningText);

  try {
    const result = await inferFn({
      role: brainRole,
      intent: prompt,
      history: [],
      callerId: `${callerId}:synthesis`,
      maxSteps: 1,
    });

    return {
      text: result.finalText || currentReasoningText,
      wasSynthesized: true,
      shadowsUsed: shadows.length,
    };
  } catch (err) {
    logger.warn('reasoning:synthesis', 'Synthesis inference failed, returning last text', {
      error: err?.message,
    });
    return {
      text: currentReasoningText,
      wasSynthesized: false,
      shadowsUsed: 0,
    };
  }
}
