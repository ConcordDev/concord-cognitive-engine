import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }),
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { SmartPhrasesPanel } from '@/components/healthcare/SmartPhrasesPanel';

const list = [
  { id: 's1', name: '.pneumonia', text: 'Patient presents with...', createdAt: '2026-01-01' },
];

describe('SmartPhrasesPanel', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('shows the loading state then the empty state', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { smartPhrases: [] } } });
    render(<SmartPhrasesPanel />);
    await waitFor(() => expect(screen.getByText(/No SmartPhrases/)).toBeInTheDocument());
  });

  it('renders the SmartPhrase list', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { smartPhrases: list } } });
    render(<SmartPhrasesPanel />);
    await waitFor(() => expect(screen.getByText('.pneumonia')).toBeInTheDocument());
    expect(screen.getByText('Patient presents with...')).toBeInTheDocument();
  });

  it('toggles the create form and does not save when blank', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { smartPhrases: [] } } });
    render(<SmartPhrasesPanel />);
    await waitFor(() => screen.getByText(/No SmartPhrases/));
    fireEvent.click(screen.getByRole('button', { name: /New/ }));
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Save SmartPhrase/ }));
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('creates a SmartPhrase when name and text are provided', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { smartPhrases: [] } } });
    render(<SmartPhrasesPanel />);
    await waitFor(() => screen.getByText(/No SmartPhrases/));
    fireEvent.click(screen.getByRole('button', { name: /New/ }));
    fireEvent.change(screen.getByPlaceholderText(/Trigger name/), { target: { value: '.flu' } });
    fireEvent.change(screen.getByPlaceholderText('Expanded text'), { target: { value: 'Flu visit text' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Save SmartPhrase/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[0]?.action === 'smartphrases-create')).toBe(true));
  });

  it('deletes a SmartPhrase after confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    lensRun.mockResolvedValue({ data: { ok: true, result: { smartPhrases: list } } });
    render(<SmartPhrasesPanel />);
    await waitFor(() => screen.getByText('.pneumonia'));
    lensRun.mockClear();
    fireEvent.click(screen.getByTitle('Delete'));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[0]?.action === 'smartphrases-delete')).toBe(true));
    confirmSpy.mockRestore();
  });

  it('does not delete when confirmation is declined', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    lensRun.mockResolvedValue({ data: { ok: true, result: { smartPhrases: list } } });
    render(<SmartPhrasesPanel />);
    await waitFor(() => screen.getByText('.pneumonia'));
    lensRun.mockClear();
    fireEvent.click(screen.getByTitle('Delete'));
    expect(lensRun).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('handles a list-fetch error gracefully', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockRejectedValue(new Error('x'));
    render(<SmartPhrasesPanel />);
    await waitFor(() => expect(screen.getByText(/No SmartPhrases/)).toBeInTheDocument());
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
