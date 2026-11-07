// An empty filtered list is not an empty closet. The unfiltered empty
// state is the only one that invites the member to add a first piece.

const EMPTY_CLOSET = 'No items. Add pieces to build your digital closet.';

export function closetEmptyCopy(filter: { category: string; laundryLabel: string | null }): string {
  const category = filter.category.trim();
  const laundry = (filter.laundryLabel || '').trim();
  if (!category && !laundry) return EMPTY_CLOSET;
  const named = [category, laundry].filter(Boolean).join(', ');
  return `No items match ${named}. Clear the filter to see the rest of the closet.`;
}
