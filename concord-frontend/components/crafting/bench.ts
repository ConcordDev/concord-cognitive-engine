/**
 * The bench stores one kind of row: a recipe DTU from POST /api/crafting/design,
 * read back by GET /api/crafting/recipes.
 *
 * output_subtype "piece" is an unknown subtype in recipe-validator.js. That
 * path has no skill gate and no invented ore list. Sword, bow, and staff
 * require levels a new bench does not have, so the first save must not
 * pretend to be one of those.
 */

export type BenchRecipe = { id: string; title: string };

export function pieceDesignBody(name: string): {
  name: string;
  spec: { name: string; output_type: 'piece'; output_subtype: 'piece' };
} {
  const title = name.trim();
  return {
    name: title,
    spec: { name: title, output_type: 'piece', output_subtype: 'piece' },
  };
}

export function recipesFromList(data: unknown): BenchRecipe[] {
  const rows = (data as { recipes?: unknown } | null)?.recipes;
  if (!Array.isArray(rows)) return [];
  const out: BenchRecipe[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as { id?: unknown }).id;
    const title = (row as { title?: unknown }).title;
    if (typeof id !== 'string' || !id) continue;
    if (typeof title !== 'string' || !title.trim()) continue;
    out.push({ id, title });
  }
  return out;
}

export function saveErrorFrom(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { error?: unknown; errors?: unknown } } } | null)
    ?.response?.data;
  if (data && Array.isArray(data.errors)) {
    const lines = data.errors.filter((line): line is string => typeof line === 'string' && line.length > 0);
    if (lines.length) return lines.join(' ');
  }
  if (data && typeof data.error === 'string' && data.error) return data.error;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
