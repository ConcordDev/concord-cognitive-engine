/**
 * Honest copy for the five brain slots and the High Power confirm.
 *
 * Brains run on Concord's GPU pod (Ollama on the pod), and fall back to
 * the operator's Mac when that pod is offline. They do not run on a public
 * "concord-os.org Ollama" the browser can reach. Model names come from
 * `/api/brain/status` — this module never invents one.
 */

export const HIGH_POWER_OUTSIDE_PROVIDERS = ['Google Gemini', 'Mistral', 'Groq'] as const;

export const SLOT_LABELS: Record<string, string> = {
  conscious: 'Conscious',
  subconscious: 'Subconscious',
  utility: 'Utility',
  repair: 'Repair',
  vision: 'Vision',
};

export interface PodBrain {
  model?: string | null;
  role?: string | null;
  enabled?: boolean;
}

export function brainRecordForSlot(
  brains: Record<string, PodBrain> | null | undefined,
  slot: string,
): PodBrain | undefined {
  if (!brains) return undefined;
  if (slot === 'vision') return brains.vision || brains.multimodal;
  return brains[slot];
}

export function slotRouteCopy(slot: string, brain: PodBrain | undefined, statusLoaded: boolean): string {
  const name = SLOT_LABELS[slot] || slot;
  if (!statusLoaded) return `Concord GPU pod · ${name} brain`;
  const model = typeof brain?.model === 'string' ? brain.model.trim() : '';
  if (!model) {
    return `Concord GPU pod · ${name} brain. The pod did not report a model name. Falls back to the Mac when the pod is offline.`;
  }
  return `Concord GPU pod · ${name} · ${model}. Falls back to the Mac when the pod is offline.`;
}

export function highPowerConfirmCopy(): string {
  const [gemini, mistral, groq] = HIGH_POWER_OUTSIDE_PROVIDERS;
  return `High Power sends what you type to ${gemini}, ${mistral}, and ${groq}. ${gemini} and ${mistral} may use those messages to train their models. ${groq} does not.`;
}
