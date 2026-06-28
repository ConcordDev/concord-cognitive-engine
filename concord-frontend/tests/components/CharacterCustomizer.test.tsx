// Behavior test for CharacterCustomizer — proves it renders REAL options from
// the `appearance.options` macro and has NO fabricated-data fallback path.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));

import { CharacterCustomizer } from '@/components/world/CharacterCustomizer';

// A trimmed but REAL-shaped options payload (enum values mirror character-schema.ts).
const OPTIONS = {
  slots: {
    body: [
      { assetId: 'slim', name: 'Slim' },
      { assetId: 'average', name: 'Average' },
      { assetId: 'legend', name: 'Legend' },
    ],
    hair: [{ assetId: 'undercut', name: 'Undercut' }],
    face: [{ assetId: 'soft', name: 'Soft' }],
    top: [{ assetId: 'synth-jacket', name: 'Synth Jacket' }],
    bottom: [{ assetId: 'cargo', name: 'Cargo' }],
    shoes: [{ assetId: 'boot', name: 'Boot' }],
    hat: [{ assetId: 'circlet', name: 'Circlet' }],
    glasses: [{ assetId: 'visor', name: 'Visor' }],
    back: [{ assetId: 'cape-glyph', name: 'Cape Glyph' }],
    hand: [{ assetId: 'staff', name: 'Staff' }],
    particle: [{ assetId: 'glyph', name: 'Glyph' }],
  },
  skinTones: [
    { assetId: 'fair-cool', name: 'Fair Cool', color: '#e8beac' },
    { assetId: 'tan-warm', name: 'Tan Warm', color: '#c89878' },
  ],
  colors: [{ assetId: 'silver', name: 'Silver', color: '#c8c8c8' }],
  savedOutfits: [],
};

describe('CharacterCustomizer', () => {
  beforeEach(() => lensRun.mockReset());

  it('fetches options from the appearance.options macro (no fabricated source)', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: OPTIONS, error: null } });
    render(<CharacterCustomizer />);
    await screen.findByTestId('character-customizer');
    expect(lensRun).toHaveBeenCalledWith('appearance', 'options', {});
  });

  it('renders the REAL enum options for the active slot', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: OPTIONS, error: null } });
    render(<CharacterCustomizer />);
    // Body slot is active by default — real archetype names, never "Body 1".
    expect(await screen.findByText('Average')).toBeInTheDocument();
    expect(screen.getByText('Legend')).toBeInTheDocument();
    expect(screen.queryByText(/Body \d/)).not.toBeInTheDocument();
  });

  it('switches slots and shows that slot\'s real options', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: OPTIONS, error: null } });
    render(<CharacterCustomizer />);
    await screen.findByTestId('character-customizer');
    fireEvent.click(screen.getByRole('button', { name: /Top/ }));
    expect(await screen.findByText('Synth Jacket')).toBeInTheDocument();
  });

  it('saves the selected real assetId via onSave', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: OPTIONS, error: null } });
    const onSave = vi.fn();
    render(<CharacterCustomizer onSave={onSave} />);
    fireEvent.click(await screen.findByText('Legend'));
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ body: 'legend' });
  });

  it('renders skin tones from the backend, not a baked placeholder list', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: OPTIONS, error: null } });
    render(<CharacterCustomizer />);
    expect(await screen.findByRole('button', { name: /Fair Cool/i })).toBeInTheDocument();
  });

  it('shows an honest empty state on fetch failure — NEVER fabricated options', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, result: null, error: 'boom' } });
    render(<CharacterCustomizer />);
    expect(await screen.findByTestId('customizer-load-error')).toBeInTheDocument();
    // No fabricated synthetic option names leaked through.
    expect(screen.queryByText(/Body \d/)).not.toBeInTheDocument();
    expect(screen.queryByText('Average')).not.toBeInTheDocument();
  });
});
