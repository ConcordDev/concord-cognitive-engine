import { describe, expect, it } from 'vitest';
import {
  brainRecordForSlot,
  highPowerConfirmCopy,
  slotRouteCopy,
} from './slotRouteCopy';

describe('slotRouteCopy', () => {
  it('names the Concord GPU pod before status has loaded, and does not invent a model', () => {
    expect(slotRouteCopy('conscious', undefined, false)).toBe('Concord GPU pod · Conscious brain');
    expect(slotRouteCopy('conscious', { model: 'concord-conscious:latest' }, false)).not.toContain('concord-conscious');
  });

  it('shows the model the pod reported, and says when the pod omitted one', () => {
    expect(slotRouteCopy('utility', { model: 'qwen2.5:3b' }, true)).toBe(
      'Concord GPU pod · Utility · qwen2.5:3b. Falls back to the Mac when the pod is offline.',
    );
    expect(slotRouteCopy('repair', { model: '   ' }, true)).toMatch(/did not report a model name/);
    expect(slotRouteCopy('repair', {}, true)).toMatch(/Falls back to the Mac/);
  });

  it('reads the vision slot from vision or multimodal, and keeps an unknown slot name', () => {
    const brains = {
      multimodal: { model: 'qwen2.5vl:7b' },
      conscious: { model: 'concord-conscious:latest' },
    };
    expect(brainRecordForSlot(brains, 'vision')?.model).toBe('qwen2.5vl:7b');
    expect(brainRecordForSlot({ vision: { model: 'llava' } }, 'vision')?.model).toBe('llava');
    expect(brainRecordForSlot(brains, 'conscious')?.model).toBe('concord-conscious:latest');
    expect(brainRecordForSlot(null, 'conscious')).toBeUndefined();
    expect(slotRouteCopy('custom-slot', { model: 'm' }, true)).toContain('custom-slot · m');
  });

  it('names Google Gemini, Mistral, and Groq in the High Power confirm', () => {
    const copy = highPowerConfirmCopy();
    expect(copy).toContain('Google Gemini');
    expect(copy).toContain('Mistral');
    expect(copy).toContain('Groq');
    expect(copy).toMatch(/Groq does not/);
  });
});
