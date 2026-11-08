/**
 * Platform Chrome II — F17, the chrome half: the saved-DTU record read.
 *
 * The defect (Projects §2b #80): the saved-state indicator was view-local
 * state — navigate away and back and the lens again said "Save the project
 * first" while the DTU itself demonstrably persisted. Two stores disagreed
 * about the same fact in front of the member.
 *
 * This hook makes the indicator a view of the RECORD: it reads the artifact
 * from the server (the lens artifact REST read) and reports the DTU the
 * record links to. The query is keyed by domain + artifactId and cached, so
 * the state survives navigation and remounts — it is never component-local.
 *
 * The link's field name is the lens-side half's to settle (Projects' is
 * B10's standing companion slice: project-note-dtu-save write + project-get
 * read). The default extractor recognises the platform's link field names;
 * a lens whose record uses another name passes its own extractor.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export type SavedDtuExtractor = (record: Record<string, unknown>) => string | null;

const LINK_FIELDS = ['dtuId', 'savedDtuId', 'dtu_id', 'exhaustDtuId'] as const;

export const defaultSavedDtuExtractor: SavedDtuExtractor = (record) => {
  for (const field of LINK_FIELDS) {
    const value = record[field];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  const nested = record.dtu;
  if (nested && typeof nested === 'object') {
    const id = (nested as Record<string, unknown>).id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return null;
};

export interface SavedDtuState {
  /** True once the read has settled (success or honest failure). */
  settled: boolean;
  /** The linked DTU's id when the record carries one, else null. */
  dtuId: string | null;
  /** The record says this artifact is saved as a DTU. */
  isSaved: boolean;
}

export function useSavedDtu(
  domain: string | null | undefined,
  artifactId: string | null | undefined,
  extractor: SavedDtuExtractor = defaultSavedDtuExtractor
): SavedDtuState {
  const query = useQuery({
    queryKey: ['saved-dtu', domain, artifactId],
    queryFn: async () => {
      const res = await api.get(`/api/lens/${domain}/${artifactId}`);
      const data = (res.data || {}) as Record<string, unknown>;
      const record = (data.artifact || data.result || data) as Record<string, unknown>;
      return extractor(record);
    },
    enabled: !!domain && !!artifactId,
    staleTime: 30000,
  });

  return {
    settled: query.isSuccess || query.isError,
    dtuId: query.data ?? null,
    isSaved: !!query.data,
  };
}
