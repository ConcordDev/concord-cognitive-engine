'use client';

/** Calls and shapes for the Cork Wall (board.* lens actions). */
import { lensRun } from '@/lib/api/client';

export interface Res<T> { ok: boolean; result: T | null; error: string | null }
export async function bx<T>(action: string, input: Record<string, unknown> = {}): Promise<Res<T>> {
  try {
    const r = await lensRun<T>('board', action, input);
    const d = r.data as ({ ok?: boolean; result?: T; error?: string; message?: string } & Record<string, unknown>) | undefined;
    if (!d) return { ok: false, result: null, error: 'No answer from the server.' };
    if (d.ok === false) return { ok: false, result: null, error: d.error || d.message || 'That did not work.' };
    const payload = (d.result && typeof d.result === 'object' ? d.result : d) as T & { ok?: boolean; error?: string };
    if (payload.ok === false) return { ok: false, result: null, error: payload.error || 'That did not work.' };
    return { ok: true, result: payload, error: null };
  } catch (e) {
    return { ok: false, result: null, error: e instanceof Error ? e.message : 'That did not work.' };
  }
}

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export const canEdit = (r: Role | null | undefined) => r === 'owner' || r === 'admin' || r === 'editor';
export const canManage = (r: Role | null | undefined) => r === 'owner' || r === 'admin';

export interface BoardSummary { id: string; name: string; columnCount: number; cardCount: number; createdAt: string; role: Role; owner: { id: string; name: string }; shared: boolean }
export interface Column { id: string; name: string; archived?: boolean }
export interface CheckItem { id: string; text: string; done: boolean }
export interface Comment { id: string; author: string; authorName?: string; text: string; at: string }
export interface Activity { id: string; action: string; at: string; by?: string | null; byName?: string | null }
export interface Card {
  id: string; columnId: string; title: string; description: string; labels: string[]; dueDate: string | null; assignee: string | null;
  checklist: CheckItem[]; position: number; createdAt: string; createdBy?: string; archived?: boolean;
  comments?: Comment[]; attachments?: { id: string; url: string; name?: string }[]; activity?: Activity[]; customFields?: Record<string, unknown>;
  transitions?: { columnId: string; at: string }[];
}
export interface LabelDef { id: string; name: string; color: string }
export interface Automation { id: string; trigger: string; columnId: string; action: string; value: string | null; enabled: boolean }
export interface Template { id: string; name: string; title: string }
export interface Member { userId: string; name: string; role: Role; id?: string }
export interface Board {
  id: string; name: string; description?: string | null; columns: Column[]; cards: Card[]; labelDefs?: LabelDef[];
  automations?: Automation[]; templates?: Template[]; customFields?: { id: string; name: string; type: string; options?: string[] }[];
  ownerId: string; createdAt: string;
}
export interface BoardDetail { board: Board; role: Role; members: Member[]; me: string }
export interface BoardActivity { id: string; at: string; by: string; byName: string; action: string; words: string; cardId: string | null; cardTitle: string | null; toColumn: string | null }
export interface MyTask { boardId: string; boardName: string; cardId: string; title: string; columnName: string | null; dueDate: string | null; labels: string[]; assignedToMe: boolean; done: boolean; bucket: 'overdue' | 'today' | 'week' | 'later' | 'done'; checklist: { done: number; total: number } }

export const TAPE = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray'];
export const tapeOf = (name: string, defs?: LabelDef[]) => {
  const d = defs?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (d) return `var(--t-${d.color})`;
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `var(--t-${TAPE[h % TAPE.length]})`;
};
const AVATAR = ['#c8372d', '#2f6d5f', '#7a4fa3', '#b9770e', '#2c6aa0', '#8a5a2b'];
export const avatarColour = (id: string) => { let h = 0; for (const c of id) h = (h * 33 + c.charCodeAt(0)) >>> 0; return AVATAR[h % AVATAR.length]; };
export const initials = (name: string) => name.replace(/[^A-Za-z0-9 _]/g, '').split(/[ _]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
export function dueState(due: string | null): 'overdue' | 'today' | 'soon' | 'later' | null {
  if (!due) return null;
  const t = Date.parse(due); if (!Number.isFinite(t)) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = (t - today.getTime()) / 86400000;
  return d < 0 ? 'overdue' : d < 1 ? 'today' : d < 3 ? 'soon' : 'later';
}
export const shortDate = (due: string) => new Date(due.length === 10 ? `${due}T12:00:00` : due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(iso).toLocaleDateString();
};

export const TRIGGERS: { id: string; label: string }[] = [
  { id: 'card-moved-to-column', label: 'a card is moved into' },
  { id: 'card-created-in-column', label: 'a card is added to' },
  { id: 'checklist-completed', label: 'a checklist is finished in' },
];
export const ACTIONS: { id: string; label: string; value: 'none' | 'label' | 'member' | 'days' | 'column' }[] = [
  { id: 'check-all-checklist', label: 'tick the whole checklist', value: 'none' },
  { id: 'clear-due', label: 'clear the due date', value: 'none' },
  { id: 'add-label', label: 'add the label', value: 'label' },
  { id: 'set-assignee', label: 'assign it to', value: 'member' },
  { id: 'set-due-in-days', label: 'set it due in (days)', value: 'days' },
  { id: 'move-to-column', label: 'move it to', value: 'column' },
];
