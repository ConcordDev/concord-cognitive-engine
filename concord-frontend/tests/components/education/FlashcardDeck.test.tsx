import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { FlashcardDeck } from '@/components/education/FlashcardDeck';

const DECKS = [
  { id: 'd1', title: 'Spanish', count: 20, due: 5 },
  { id: 'd2', title: 'History', count: 8, due: 0 },
];
const CARDS = [
  { id: 'c1', deckId: 'd1', front: 'hola', back: 'hello', ease: 2.5, interval: 1, repetitions: 0, dueAt: '', scheduler: 'sm2' as const },
  { id: 'c2', deckId: 'd1', front: 'gato', back: 'cat', ease: 2.3, interval: 3, repetitions: 2, dueAt: '', scheduler: 'sm2' as const },
];

function mockBy(map: Record<string, unknown>) {
  lensRun.mockImplementation((spec: { action: string }) =>
    Promise.resolve({ data: { ok: true, result: map[spec.action] ?? {} } }));
}

describe('FlashcardDeck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
  });

  it('shows the empty decks state', async () => {
    render(<FlashcardDeck />);
    expect(await screen.findByText(/No decks yet/)).toBeInTheDocument();
  });

  it('renders decks with due badges', async () => {
    mockBy({ 'flashcards-decks': { decks: DECKS } });
    render(<FlashcardDeck />);
    expect(await screen.findByText('Spanish')).toBeInTheDocument();
    expect(screen.getByText('History')).toBeInTheDocument();
    expect(screen.getByText('20 cards · 5 due today')).toBeInTheDocument();
  });

  it('creates a deck and opens it', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'flashcards-decks') return Promise.resolve({ data: { ok: true, result: { decks: DECKS } } });
      if (spec.action === 'flashcards-deck-create') return Promise.resolve({ data: { ok: true, result: { deck: { id: 'd1' } } } });
      if (spec.action === 'flashcards-due') return Promise.resolve({ data: { ok: true, result: { cards: [] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<FlashcardDeck />);
    await screen.findByText('Spanish');
    fireEvent.change(screen.getByPlaceholderText('New deck name…'), { target: { value: 'New Deck' } });
    fireEvent.click(screen.getByText(/Deck/, { selector: 'button' }));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'flashcards-deck-create', input: { title: 'New Deck' } }),
      ),
    );
  });

  it('does not create a deck with an empty title', async () => {
    mockBy({ 'flashcards-decks': { decks: DECKS } });
    render(<FlashcardDeck />);
    await screen.findByText('Spanish');
    lensRun.mockClear();
    fireEvent.click(screen.getByText(/Deck/, { selector: 'button' }));
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'flashcards-deck-create' }));
  });

  it('opens a deck and shows the review front, then reveals the answer', async () => {
    mockBy({ 'flashcards-decks': { decks: DECKS }, 'flashcards-due': { cards: CARDS } });
    render(<FlashcardDeck />);
    fireEvent.click(await screen.findByText('Spanish'));
    expect(await screen.findByText('hola')).toBeInTheDocument();
    expect(screen.getByText('Card 1 of 2')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Show answer/));
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('reviews a card and advances to the next', async () => {
    mockBy({ 'flashcards-decks': { decks: DECKS }, 'flashcards-due': { cards: CARDS }, 'flashcards-review': {} });
    render(<FlashcardDeck />);
    fireEvent.click(await screen.findByText('Spanish'));
    await screen.findByText('hola');
    fireEvent.click(screen.getByText(/Show answer/));
    fireEvent.click(screen.getByText('Good'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'flashcards-review', input: { cardId: 'c1', quality: 4 } }),
      ),
    );
    expect(await screen.findByText('gato')).toBeInTheDocument();
  });

  it('shows inbox-zero when no cards are due', async () => {
    mockBy({ 'flashcards-decks': { decks: DECKS }, 'flashcards-due': { cards: [] } });
    render(<FlashcardDeck />);
    fireEvent.click(await screen.findByText('Spanish'));
    expect(await screen.findByText(/Inbox zero/)).toBeInTheDocument();
  });

  it('opens the add-card form and creates a card', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'flashcards-decks') return Promise.resolve({ data: { ok: true, result: { decks: DECKS } } });
      if (spec.action === 'flashcards-due') return Promise.resolve({ data: { ok: true, result: { cards: [] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<FlashcardDeck />);
    fireEvent.click(await screen.findByText('Spanish'));
    await screen.findByText(/Inbox zero/);
    fireEvent.click(screen.getByTitle('Add card'));
    fireEvent.change(screen.getByPlaceholderText('Front (prompt)'), { target: { value: 'F' } });
    fireEvent.change(screen.getByPlaceholderText('Back (answer)'), { target: { value: 'B' } });
    fireEvent.click(screen.getByText('Add card'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'flashcards-card-create', input: { deckId: 'd1', front: 'F', back: 'B' } }),
      ),
    );
  });

  it('cancels the add-card form', async () => {
    mockBy({ 'flashcards-decks': { decks: DECKS }, 'flashcards-due': { cards: [] } });
    render(<FlashcardDeck />);
    fireEvent.click(await screen.findByText('Spanish'));
    await screen.findByText(/Inbox zero/);
    fireEvent.click(screen.getByTitle('Add card'));
    expect(screen.getByPlaceholderText('Front (prompt)')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByPlaceholderText('Front (prompt)')).not.toBeInTheDocument();
  });

  it('returns to the deck list via the back button', async () => {
    mockBy({ 'flashcards-decks': { decks: DECKS }, 'flashcards-due': { cards: CARDS } });
    render(<FlashcardDeck />);
    fireEvent.click(await screen.findByText('Spanish'));
    await screen.findByText('hola');
    fireEvent.click(screen.getByLabelText('Back to decks'));
    expect(await screen.findByText('History')).toBeInTheDocument();
  });

  it('opens directly into review mode when initialDeckId is set', async () => {
    mockBy({ 'flashcards-decks': { decks: DECKS }, 'flashcards-due': { cards: CARDS } });
    render(<FlashcardDeck initialDeckId="d1" />);
    expect(await screen.findByText('hola')).toBeInTheDocument();
  });

  it('reloads the queue via the reload button', async () => {
    mockBy({ 'flashcards-decks': { decks: DECKS }, 'flashcards-due': { cards: CARDS } });
    render(<FlashcardDeck initialDeckId="d1" />);
    await screen.findByText('hola');
    lensRun.mockClear();
    fireEvent.click(screen.getByTitle('Reload queue'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'flashcards-due' })),
    );
  });
});
