// Shared types + API hook for the real macro-backed board workspace.
// Every value here is real user input or computed from real backend state.

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

export interface WsColumn {
  id: string;
  name: string;
}

export interface WsChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface WsComment {
  id: string;
  author: string;
  text: string;
  at: string;
}

export interface WsAttachment {
  id: string;
  url: string;
  name: string;
  kind: string;
  at: string;
}

export interface WsActivity {
  id: string;
  action: string;
  at: string;
}

export interface WsCover {
  type: 'image' | 'color';
  value: string;
}

export interface WsCard {
  id: string;
  columnId: string;
  title: string;
  description: string;
  labels: string[];
  dueDate: string | null;
  assignee: string | null;
  checklist: WsChecklistItem[];
  position: number;
  createdAt: string;
  comments?: WsComment[];
  attachments?: WsAttachment[];
  activity?: WsActivity[];
  cover?: WsCover | null;
  customFields?: Record<string, string | number | boolean>;
}

export interface WsLabelDef {
  id: string;
  name: string;
  color: string;
}

export interface WsAutomation {
  id: string;
  trigger: string;
  columnId: string;
  action: string;
  value: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface WsCollaborator {
  id: string;
  userId: string;
  role: 'viewer' | 'editor' | 'admin';
  addedAt: string;
}

export interface WsCustomField {
  id: string;
  name: string;
  type: 'text' | 'number' | 'date' | 'select' | 'checkbox';
  options: string[];
}

export interface WsBoard {
  id: string;
  name: string;
  columns: WsColumn[];
  cards: WsCard[];
  createdAt: string;
  labelDefs?: WsLabelDef[];
  automations?: WsAutomation[];
  collaborators?: WsCollaborator[];
  customFields?: WsCustomField[];
}

export interface WsBoardSummary {
  id: string;
  name: string;
  columnCount: number;
  cardCount: number;
  createdAt: string;
}

export interface WsCalendarDay {
  date: string;
  cards: {
    id: string;
    title: string;
    columnId: string;
    columnName: string | null;
    dueDate: string;
    overdue: boolean;
    labels: string[];
  }[];
}

export interface WsCalendar {
  days: WsCalendarDay[];
  scheduled: number;
  overdue: number;
  unscheduled: number;
}

/** Thin typed wrapper over lensRun for the board domain. */
export async function boardMacro<T = Record<string, unknown>>(
  name: string,
  params: Record<string, unknown> = {}
): Promise<{ ok: boolean; result?: T; error?: string }> {
  try {
    const r = await lensRun<{ ok: boolean; result?: T; error?: string }>('board', name, params);
    const d = r.data;
    if (d && typeof d === 'object' && 'ok' in d) {
      return d as { ok: boolean; result?: T; error?: string };
    }
    return { ok: false, error: 'unexpected response' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'request failed' };
  }
}

/** Loads the list of boards for the current user. */
export function useBoardList() {
  const [boards, setBoards] = useState<WsBoardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await boardMacro<{ boards: WsBoardSummary[] }>('board-list');
    if (r.ok && r.result) {
      setBoards(r.result.boards);
    } else {
      setError(r.error || 'failed to load boards');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { boards, loading, error, reload };
}

/** Loads a single board's full detail. */
export function useBoardDetail(boardId: string | null) {
  const [board, setBoard] = useState<WsBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!boardId) {
      setBoard(null);
      return;
    }
    setLoading(true);
    setError(null);
    const r = await boardMacro<{ board: WsBoard }>('board-detail', { id: boardId });
    if (r.ok && r.result) {
      setBoard(r.result.board);
    } else {
      setError(r.error || 'failed to load board');
    }
    setLoading(false);
  }, [boardId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { board, loading, error, reload, setBoard };
}

export const LABEL_COLOR_CLASS: Record<string, string> = {
  red: 'bg-red-500/20 text-red-300 border-red-500/40',
  orange: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  yellow: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  green: 'bg-green-500/20 text-green-300 border-green-500/40',
  blue: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  purple: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  pink: 'bg-pink-500/20 text-pink-300 border-pink-500/40',
  gray: 'bg-gray-500/20 text-gray-300 border-gray-500/40',
};

export const LABEL_COLOR_DOT: Record<string, string> = {
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  yellow: 'bg-yellow-500',
  green: 'bg-green-500',
  blue: 'bg-blue-500',
  purple: 'bg-purple-500',
  pink: 'bg-pink-500',
  gray: 'bg-gray-500',
};

export const LABEL_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray'];
