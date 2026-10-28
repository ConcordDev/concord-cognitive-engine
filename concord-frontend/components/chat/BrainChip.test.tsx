import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import BrainChip, { brainChipLabel } from './BrainChip';

const FULL = {
  mode: 'five_brain',
  onlineCount: 5,
  brains: { conscious: {}, subconscious: {}, utility: {}, repair: {}, multimodal: {} },
  routing: { chatPrimary: 'ollama_conscious' },
};
const PARTIAL = { ...FULL, mode: 'partial', onlineCount: 3 };
const FALLBACK = { mode: 'fallback', onlineCount: 0, brains: FULL.brains, routing: { chatPrimary: 'none' } };

describe('brainChipLabel', () => {
  it('names the conscious slot and full health', () => {
    expect(brainChipLabel(FULL)).toEqual({ slot: 'Conscious brain', state: 'All 5 brains online', tone: 'ok' });
  });
  it('reports a partial pool honestly', () => {
    expect(brainChipLabel(PARTIAL).state).toBe('3 of 5 brains online');
    expect(brainChipLabel(PARTIAL).tone).toBe('warn');
  });
  it('says the GPU brain is offline and a backup answers in fallback', () => {
    const l = brainChipLabel(FALLBACK);
    expect(l.state).toContain('GPU brain offline');
    expect(l.slot).toBe('Backup model');
    expect(l.tone).toBe('down');
  });
  it('never invents state when the status read has not landed', () => {
    expect(brainChipLabel(null)).toEqual({ slot: 'Brain', state: 'status unavailable', tone: 'unknown' });
  });
});

describe('BrainChip', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the live status from /api/brain/status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => FULL })));
    render(<BrainChip />);
    const chip = await screen.findByTestId('brain-chip');
    await waitFor(() => expect(chip.getAttribute('data-tone')).toBe('ok'));
    expect(chip.textContent).toContain('Conscious brain');
    expect(chip.textContent).toContain('All 5 brains online');
  });

  it('shows fallback state while generating when the pool is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => FALLBACK })));
    render(<BrainChip generating />);
    const chip = await screen.findByTestId('brain-chip');
    await waitFor(() => expect(chip.getAttribute('data-tone')).toBe('down'));
    expect(chip.textContent).toContain('Answering');
  });

  it('falls back to "status unavailable" when the read fails — no invented state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    render(<BrainChip />);
    const chip = await screen.findByTestId('brain-chip');
    await waitFor(() => expect(chip.textContent).toContain('status unavailable'));
  });
});
