import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { QuizGenerator } from '@/components/education/QuizGenerator';

const CARDS = [
  { front: 'Q1', back: 'A1', difficulty: 'easy' as const },
  { front: 'Q2', back: 'A2', difficulty: 'hard' as const },
  { front: 'Q3', back: 'A3', difficulty: 'medium' as const },
];

describe('QuizGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { cards: [] } } });
  });

  it('shows an error when no source and no dtu', () => {
    render(<QuizGenerator />);
    fireEvent.click(screen.getByText('Generate'));
    expect(screen.getByText(/Paste some notes/)).toBeInTheDocument();
  });

  it('generates cards from pasted source and shows difficulty badges', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { cards: CARDS } } });
    render(<QuizGenerator />);
    fireEvent.change(screen.getByPlaceholderText(/Paste notes/), { target: { value: 'Photosynthesis converts light' } });
    fireEvent.click(screen.getByText('Generate'));
    await waitFor(() => expect(screen.getAllByText('Q1').length).toBeGreaterThan(0));
    expect(screen.getByText('easy')).toBeInTheDocument();
    expect(screen.getByText('hard')).toBeInTheDocument();
    expect(screen.getByText('medium')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'quiz-from-text' }));
  });

  it('shows a no-cards error when generation returns empty', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { cards: [] } } });
    render(<QuizGenerator />);
    fireEvent.change(screen.getByPlaceholderText(/Paste notes/), { target: { value: 'text' } });
    fireEvent.click(screen.getByText('Generate'));
    expect(await screen.findByText(/No cards generated/)).toBeInTheDocument();
  });

  it('toggles a card exclusion and updates the accepted count', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { cards: CARDS } } });
    render(<QuizGenerator />);
    fireEvent.change(screen.getByPlaceholderText(/Paste notes/), { target: { value: 'text' } });
    fireEvent.click(screen.getByText('Generate'));
    await waitFor(() => expect(screen.getAllByText('Q1').length).toBeGreaterThan(0));
    expect(screen.getByText('Add 3 to deck')).toBeInTheDocument();
    // Exclude the first card (one of three "Exclude" buttons).
    fireEvent.click(screen.getAllByTitle('Exclude')[0]);
    expect(await screen.findByText('Add 2 to deck')).toBeInTheDocument();
    // re-include the one we just excluded
    fireEvent.click(screen.getByTitle('Include'));
    expect(await screen.findByText('Add 3 to deck')).toBeInTheDocument();
  });

  it('creates a deck from accepted cards and calls onDeckCreated', async () => {
    const onDeck = vi.fn();
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'quiz-from-text') return Promise.resolve({ data: { ok: true, result: { cards: CARDS } } });
      return Promise.resolve({ data: { ok: true, result: { deck: { id: 'deck-9' } } } });
    });
    render(<QuizGenerator onDeckCreated={onDeck} />);
    fireEvent.change(screen.getByPlaceholderText(/Paste notes/), { target: { value: 'text' } });
    fireEvent.click(screen.getByText('Generate'));
    await waitFor(() => expect(screen.getAllByText('Q1').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('Add 3 to deck'));
    await waitFor(() => expect(onDeck).toHaveBeenCalledWith('deck-9'));
    expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'quiz-mint-deck' }));
  });

  it('renders the dtu-source banner and generates without a textarea', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { cards: CARDS } } });
    render(<QuizGenerator sourceDtuId="dtu-abcdef123456" />);
    expect(screen.getByText(/Source: DTU dtu-abcdef12/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Paste notes/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Generate'));
    await waitFor(() => expect(screen.getAllByText('Q1').length).toBeGreaterThan(0));
  });

  it('uses initialSource as the textarea value', () => {
    render(<QuizGenerator initialSource="prefilled notes" />);
    expect(screen.getByDisplayValue('prefilled notes')).toBeInTheDocument();
  });

  it('clamps the card count between 1 and 30', () => {
    render(<QuizGenerator />);
    const countInput = screen.getByDisplayValue('10') as HTMLInputElement;
    fireEvent.change(countInput, { target: { value: '99' } });
    expect(countInput.value).toBe('30');
    // The component uses `Number(value) || 10` so falsy values (including '0')
    // fall back to 10. Use a negative number to exercise the lower clamp.
    fireEvent.change(countInput, { target: { value: '-5' } });
    expect(countInput.value).toBe('1');
  });

  it('changes the difficulty select', () => {
    render(<QuizGenerator />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'hard' } });
    expect(select.value).toBe('hard');
  });

  it('shows an error string when generation rejects', async () => {
    lensRun.mockRejectedValue(new Error('llm down'));
    render(<QuizGenerator />);
    fireEvent.change(screen.getByPlaceholderText(/Paste notes/), { target: { value: 'text' } });
    fireEvent.click(screen.getByText('Generate'));
    expect(await screen.findByText('llm down')).toBeInTheDocument();
  });
});
