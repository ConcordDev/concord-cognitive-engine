/** Deck-option rules the Study options panel and the server both enforce. */

export interface DeckParentChoice {
  id: string;
  name: string;
  parentId?: string | null;
  filtered?: boolean;
}

export function parseLearningSteps(
  text: string,
): { ok: true; steps: number[] } | { ok: false; error: string } {
  const tokens = text.trim().split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) {
    return { ok: false, error: 'Enter at least one learning step in minutes, like 1 10.' };
  }
  if (tokens.length > 8) {
    return { ok: false, error: 'Use at most 8 learning steps.' };
  }
  for (const token of tokens) {
    if (!/^\d+(\.\d+)?$/.test(token) || !(Number(token) > 0)) {
      return {
        ok: false,
        error: `“${token}” is not a number of minutes. Use steps like 1 10.`,
      };
    }
  }
  return { ok: true, steps: tokens.map(Number) };
}

/** Parents a deck may move under: not itself, not a filtered deck, not its own descendants. */
export function eligibleDeckParents<T extends DeckParentChoice>(decks: T[], deckId: string): T[] {
  const banned = new Set<string>([deckId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const deck of decks) {
      if (deck.parentId && banned.has(deck.parentId) && !banned.has(deck.id)) {
        banned.add(deck.id);
        grew = true;
      }
    }
  }
  return decks.filter((deck) => !banned.has(deck.id) && !deck.filtered);
}
