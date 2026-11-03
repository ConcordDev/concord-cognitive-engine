// The closet card's edit sends only the fields the member can correct.
// Wear count, last worn, and laundry stay off the body so a cost fix
// cannot reset the history those figures are computed from.

export interface ClosetEditForm {
  name: string;
  brand: string;
  color: string;
  category: string;
  cost: string;
}

export type ClosetEditResult =
  | { ok: false; error: string }
  | { ok: true; input: { id: string; name: string; brand: string; color: string; category: string; cost?: number } };

export function closetItemEditInput(id: string, form: ClosetEditForm): ClosetEditResult {
  const name = form.name.trim();
  if (!name) return { ok: false, error: 'Item name is required.' };
  const input: ClosetEditResult & { ok: true } = {
    ok: true,
    input: {
      id,
      name,
      brand: form.brand.trim(),
      color: form.color.trim(),
      category: form.category,
    },
  };
  const costText = form.cost.trim();
  if (costText !== '') {
    const cost = Number(costText);
    if (!Number.isFinite(cost)) return { ok: false, error: 'Cost must be a number.' };
    if (cost < 0) return { ok: false, error: 'Cost cannot be negative.' };
    input.input.cost = cost;
  }
  return input;
}
