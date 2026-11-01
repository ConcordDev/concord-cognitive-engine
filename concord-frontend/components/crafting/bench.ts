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

/**
 * D1 — a bench piece is also a canonical lens artifact (domain "crafting",
 * created through POST /api/lens/crafting), joined to its recipe row by
 * data.recipeId. The artifact is the piece's platform identity: it is what
 * the shared Export reads (lens.list) and what publish acts on. A piece
 * without an artifactId predates D1 or its registration has not landed yet.
 */
export type BenchPiece = BenchRecipe & { artifactId?: string; published?: boolean };

export type CanonicalArtifactRow = {
  id: string;
  recipeId: string;
  title: string;
  published: boolean;
  /** F7: the artifact's embedded name copies (data.name, data.spec.name,
   *  data.spec itself) — a rename must converge all of them, not just
   *  the title, or the exported artifact disagrees with the bench. */
  name?: string;
  specName?: string;
  spec?: unknown;
};

export function artifactsFromList(data: unknown): CanonicalArtifactRow[] {
  const rows = (data as { artifacts?: unknown } | null)?.artifacts;
  if (!Array.isArray(rows)) return [];
  const out: CanonicalArtifactRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as { id?: unknown }).id;
    const title = (row as { title?: unknown }).title;
    const data = (row as { data?: { recipeId?: unknown; name?: unknown; spec?: unknown } }).data;
    const recipeId = data?.recipeId;
    const visibility = (row as { meta?: { visibility?: unknown } }).meta?.visibility;
    if (typeof id !== 'string' || !id) continue;
    if (typeof recipeId !== 'string' || !recipeId) continue;
    const spec = data?.spec && typeof data.spec === 'object' ? data.spec : undefined;
    const specName = (spec as { name?: unknown } | undefined)?.name;
    out.push({
      id,
      recipeId,
      title: typeof title === 'string' ? title : '',
      published: visibility === 'published',
      name: typeof data?.name === 'string' ? data.name : undefined,
      specName: typeof specName === 'string' ? specName : undefined,
      spec,
    });
  }
  return out;
}

/**
 * F7 — the body a rename sends to the canonical artifact. The lens
 * update shallow-merges `data`, so naming the copies converges them:
 * title, data.name, and (when the piece carries a spec) data.spec.name.
 * The spec sent is the piece's current spec with only its name moved —
 * the recipe row of record right after its PATCH, or the artifact's
 * own embedded copy when the row's spec is not at hand.
 */
export function pieceRenameBody(title: string, spec?: unknown): {
  title: string;
  data: Record<string, unknown>;
} {
  return {
    title,
    data: {
      name: title,
      ...(spec && typeof spec === 'object' ? { spec: { ...(spec as Record<string, unknown>), name: title } } : {}),
    },
  };
}

/** F7 — does this artifact's name (in any of its copies) lag the bench title? */
export function artifactNameLag(row: CanonicalArtifactRow, title: string): boolean {
  if (row.title !== title) return true;
  if (row.name !== undefined && row.name !== title) return true;
  if (row.specName !== undefined && row.specName !== title) return true;
  return false;
}

/**
 * F6's duplicate notice: the typed name (trimmed, case-insensitive)
 * already sits on the bench. The piece being edited does not count
 * against itself.
 */
export function isDuplicateName(name: string, pieces: BenchRecipe[], excludeId?: string): boolean {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return false;
  return pieces.some((p) => p.id !== excludeId && p.title.trim().toLowerCase() === wanted);
}

export function joinPieces(recipes: BenchRecipe[], artifacts: CanonicalArtifactRow[]): BenchPiece[] {
  const byRecipe = new Map(artifacts.map((a) => [a.recipeId, a]));
  return recipes.map((r) => {
    const artifact = byRecipe.get(r.id);
    return artifact ? { ...r, artifactId: artifact.id, published: artifact.published } : { ...r };
  });
}

export function pieceArtifactBody(piece: { id: string; title: string; spec?: unknown }): {
  type: string;
  title: string;
  data: Record<string, unknown>;
  meta: { tags: string[] };
} {
  return {
    type: 'recipe',
    title: piece.title,
    data: {
      recipeId: piece.id,
      name: piece.title,
      benchPiece: true,
      ...(piece.spec ? { spec: piece.spec } : {}),
    },
    meta: { tags: ['bench', 'recipe'] },
  };
}

/** The design spec each recipe row carries in its data, keyed by recipe id. */
export function specsFromRecipesList(data: unknown): Map<string, unknown> {
  const rows = (data as { recipes?: unknown } | null)?.recipes;
  const out = new Map<string, unknown>();
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as { id?: unknown }).id;
    const spec = (row as { data?: { spec?: unknown } }).data?.spec;
    if (typeof id === 'string' && id && spec && typeof spec === 'object') out.set(id, spec);
  }
  return out;
}

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
