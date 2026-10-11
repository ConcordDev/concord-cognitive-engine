import type { DTU } from '@/lib/api/generated-types';

type Ownable = {
  ownerId?: string;
  createdBy?: string;
  authorId?: string;
  meta?: { createdBy?: unknown } | Record<string, unknown> | null;
};

/** Owner id the paginated `scope=mine` cut uses: owner, creator, or meta.createdBy. */
export function dtuOwnerId(dtu: Ownable | DTU): string | undefined {
  const meta = dtu.meta as { createdBy?: unknown } | undefined;
  const metaOwner = typeof meta?.createdBy === 'string' ? meta.createdBy : undefined;
  const extra = dtu as Ownable;
  const owner = extra.ownerId || extra.createdBy || extra.authorId || metaOwner;
  return owner && owner.length > 0 ? owner : undefined;
}

/**
 * True origin of a review card. The viewer's own DTU is a note they saved.
 * A system, global, or someone else's DTU is the shared library.
 */
export function dtuOriginLabel(dtu: Ownable | DTU, userId?: string | null): 'Your note' | 'Shared library' {
  const owner = dtuOwnerId(dtu);
  if (userId && owner === userId) return 'Your note';
  return 'Shared library';
}
