// Shared types for the saved lens — the cross-lens saved-items surface.

export type SavedKind = 'post' | 'dtu' | 'article' | 'artifact' | 'link' | 'other';
export type SavedState = 'unread' | 'read' | 'archived';

// Provenance stamp shape from server/lib/dtu-protocol.js#stampProvenance —
// proves where a quote/clip actually came from. Optional; a plain bookmark
// has none. Passed through byte-identical, never fabricated client-side.
export interface SavedProvenance {
  sourceUrl: string | null;
  sourceId: string | null;
  contentSha256: string;
  timecode: string | null;
  fetchedAt: string;
  signer: string | null;
}

export interface SavedItem {
  id: string;
  kind: SavedKind;
  refId: string | null;
  title: string;
  url: string | null;
  author: string | null;
  excerpt: string | null;
  mediaType: string;
  folderId: string | null;
  tags: string[];
  note: string;
  state: SavedState;
  sourceLens: string | null;
  // Additive "Clip DB" fields (migration 356) — nullable A/V timecodes in
  // milliseconds. A plain bookmark has neither; clipStartMs alone marks a
  // "starts-at" point, both together mark a range.
  clipStartMs: number | null;
  clipEndMs: number | null;
  provenance: SavedProvenance | null;
  savedAt: string;
  updatedAt: string;
  readAt: string | null;
}

export interface SavedFolder {
  id: string;
  name: string;
  color: string;
  description: string;
  createdAt: string;
  itemCount?: number;
}

export interface SavedStats {
  total: number;
  folders: number;
  byState: Record<string, number>;
  byKind: Record<string, number>;
  byMediaType: Record<string, number>;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface SavedListResult {
  items: SavedItem[];
  total: number;
  matched: number;
  offset: number;
  limit: number;
}
