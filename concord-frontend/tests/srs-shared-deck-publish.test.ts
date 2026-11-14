// FIX-srs-003 — publishing a shared deck always failed with "Council
// rejected DTU": the create payload kept the deck's entire content in
// machine.bundle, which the council gate's admission score cannot see.
// Pins the payload shape: the cards ride in core.examples (the DTU's
// knowledge core), the bundle stays in machine for import.
import { describe, it, expect } from 'vitest';
import { sharedDeckDtuInput } from '@/components/srs/SrsWorkbench';

const bundle = {
  deck: { name: 'QA Deck' },
  cards: [
    { front: 'Capital of France?', back: 'Paris' },
    { front: '2 + 2', back: '4' },
    { front: 'Water formula', back: 'H2O' },
    { front: 'Largest planet', back: 'Jupiter' },
  ],
};

describe('sharedDeckDtuInput (FIX-srs-003)', () => {
  it('carries every card in core.examples as front → back', () => {
    const input = sharedDeckDtuInput(bundle, 'deck-qa');
    expect(input.core.examples).toHaveLength(4);
    expect(input.core.examples[0]).toBe('Capital of France? → Paris');
    expect(input.core.examples[3]).toBe('Largest planet → Jupiter');
  });

  it('keeps the full bundle in machine and the public share metadata', () => {
    const input = sharedDeckDtuInput(bundle, 'deck-qa');
    expect(input.machine.kind).toBe('srs_deck_bundle');
    expect(input.machine.bundle).toBe(bundle);
    expect(input.meta.visibility).toBe('public');
    expect(input.meta.srs.deckId).toBe('deck-qa');
    expect(input.title).toBe('QA Deck (shared deck)');
  });

  it('names the deck size in the summary and the add-to-decks next action', () => {
    const input = sharedDeckDtuInput(bundle, 'deck-qa');
    expect(input.human.summary).toContain('4 cards');
    expect(input.core.nextActions[0]).toMatch(/Add this deck/);
  });

  it('a one-card deck still carries structure (example + next action)', () => {
    const input = sharedDeckDtuInput({ deck: { name: 'Tiny' }, cards: [{ front: 'Q', back: 'A' }] }, 'd1');
    expect(input.core.examples).toEqual(['Q → A']);
    expect(input.core.nextActions).toHaveLength(1);
  });
});
