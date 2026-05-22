// Shared types for the saved lens — the cross-lens saved-items surface.

export type SavedKind = 'post' | 'dtu' | 'article' | 'artifact' | 'link' | 'other';
export type SavedState = 'unread' | 'read' | 'archived';

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
