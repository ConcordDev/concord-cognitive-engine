// Shared docs-lens types — kept in one place so the workspace and its
// sub-panels agree on the page/block/comment/share shapes the docs
// domain macros return.

export interface BlockData {
  language?: string;
  tone?: string;
  emoji?: string;
  open?: boolean;
  url?: string;
  kind?: string;
  rows?: string[][];
}

export interface Block {
  id: string;
  type: string;
  text: string;
  checked: boolean;
  data?: BlockData;
}

export interface PageMeta {
  id: string;
  title: string;
  icon: string;
  parentId: string | null;
  blockCount: number;
  updatedAt?: string;
}

export interface Page {
  id: string;
  title: string;
  icon: string;
  parentId?: string | null;
  blocks: Block[];
}

export interface Comment {
  id: string;
  pageId: string;
  blockId: string | null;
  author: string;
  kind: 'comment' | 'suggestion';
  text: string;
  suggestedText: string;
  resolved: boolean;
  createdAt: string;
}

export interface Snapshot {
  id: string;
  label: string;
  title: string;
  icon: string;
  wordCount: number;
  blockCount: number;
  createdAt: string;
}

export interface Cursor {
  sessionId: string;
  name: string;
  color: string;
  blockId: string | null;
  cursorOffset: number;
}

export interface Share {
  pageId: string;
  visibility: 'private' | 'link' | 'public';
  role: 'view' | 'edit';
  token: string | null;
  invites: { id: string; invitee: string; role: string; invitedAt: string }[];
  updatedAt: string | null;
}

export interface DbColumn {
  id: string;
  name: string;
  type: 'text' | 'number' | 'select' | 'checkbox' | 'date';
  options: string[];
}

export interface DbRow {
  id: string;
  cells: Record<string, string | number | boolean>;
  createdAt: string;
}

export interface DocDatabase {
  id: string;
  name: string;
  columns: DbColumn[];
  rows: DbRow[];
  createdAt: string;
  updatedAt: string;
}
