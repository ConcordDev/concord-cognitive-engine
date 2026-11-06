'use client';

/**
 * Typed wrappers over the gmail.* macros (server/domains/gmail.js) plus the
 * pure helpers the client needs: address parsing, reply/forward drafting and
 * date formatting. Nothing here invents mail — every list and body comes from
 * the user's own Gmail through the connector.
 */

import { lensRun } from '@/lib/api/client';

export interface ThreadSummary {
  id: string;
  subject: string;
  snippet: string;
  participants: string[];
  from: string;
  messageCount: number;
  lastDate: string;
  lastInternalDate: number | null;
  unread: boolean;
  starred: boolean;
  labelIds: string[];
}

export interface MailAttachment { attachmentId: string; filename: string; mimeType: string; size: number }

export interface FullMessage {
  id: string;
  threadId: string;
  snippet: string;
  labelIds: string[];
  unread: boolean;
  starred: boolean;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  internalDate: number | null;
  messageIdHeader: string;
  references: string;
  replyTo: string;
  text: string;
  html: string;
  attachments: MailAttachment[];
}

export interface GmailLabel { id: string; name: string; type: string }
export interface Draft { id: string; message: FullMessage }

export interface OutgoingAttachment { filename: string; mimeType: string; data: string; size: number }
export interface Outgoing {
  to: string; cc: string; bcc: string; subject: string; body: string;
  threadId?: string; inReplyTo?: string; references?: string;
  attachments: OutgoingAttachment[];
  draftId?: string;
}

export const NOT_CONNECTED = new Set(['no_token', 'connector_not_configured', 'gmail_disabled', 'no_user']);

/**
 * Every gmail failure renders in product words (F2). The NOT_CONNECTED
 * codes never reach the surface at all — the client consumes them into
 * the connect wall. Anything else the server or the transport can
 * return maps here; an unmapped code falls back to a plain sentence,
 * so a raw reason code never renders on any mail surface.
 */
const GMAIL_ERROR_WORDS: Record<string, string> = {
  no_token: 'Gmail isn’t connected yet.',
  connector_not_configured: 'Gmail isn’t connected yet.',
  gmail_disabled: 'Gmail is turned off on this Concord right now.',
  no_user: 'Sign in to Concord to use Gmail here.',
  auth_expired: 'Your Gmail sign-in has expired. Reconnect Gmail to keep reading.',
  reauth_required: 'Gmail needs you to sign in again. Reconnect Gmail to continue.',
  handler_error: 'Gmail could not complete that just now. Try again in a moment.',
  network_error: 'Gmail could not be reached. Check your connection and try again.',
  db_unavailable: 'Mail is unavailable on this Concord right now. Try again in a moment.',
};

export function gmailErrorText(error: string | undefined): string {
  if (!error) return 'Something went wrong with Gmail. Try again in a moment.';
  if (error === 'db unavailable') return GMAIL_ERROR_WORDS.db_unavailable;
  const known = GMAIL_ERROR_WORDS[error];
  if (known) return known;
  if (/^[a-z0-9_]+(_failed)?$/.test(error)) return 'Gmail could not complete that just now. Try again in a moment.';
  return error;
}

type Res<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(action: string, input: Record<string, unknown> = {}): Promise<Res<T>> {
  try {
    const r = await lensRun<T>('gmail', action, input);
    if (r.data.ok && r.data.result) return { ok: true, data: r.data.result };
    return { ok: false, error: r.data.error || `${action}_failed` };
  } catch (e) {
    return { ok: false, error: (e as Error).message || 'network_error' };
  }
}

export const gmail = {
  threads: (p: { label?: string; q?: string; pageToken?: string; maxResults?: number }) =>
    call<{ threads: ThreadSummary[]; nextPageToken: string | null; resultSizeEstimate: number }>('threads', p),
  thread: (threadId: string) => call<{ thread: { id: string; messages: FullMessage[] } }>('thread', { threadId }),
  modify: (threadId: string, action: string) => call<{ threadId: string }>('thread-modify', { threadId, action }),
  label: (threadId: string, add: string[], remove: string[] = []) => call<{ threadId: string }>('thread-modify', { threadId, addLabelIds: add, removeLabelIds: remove }),
  trash: (threadId: string) => call<{ threadId: string }>('thread-trash', { threadId }),
  untrash: (threadId: string) => call<{ threadId: string }>('thread-untrash', { threadId }),
  labels: () => call<{ labels: GmailLabel[] }>('labels', {}),
  createLabel: (name: string) => call<{ label: GmailLabel }>('label-create', { name }),
  profile: () => call<{ profile: { emailAddress: string; messagesTotal: number | null; threadsTotal: number | null } }>('profile', {}),
  attachment: (messageId: string, attachmentId: string) => call<{ data: string; size: number | null }>('attachment', { messageId, attachmentId }),
  drafts: () => call<{ drafts: Draft[] }>('drafts', {}),
  saveDraft: (m: Outgoing) => call<{ draft: { id: string; threadId: string | null } }>('draft-save', toWire(m)),
  sendDraft: (draftId: string) => call<{ sent: boolean }>('draft-send', { draftId }),
  deleteDraft: (draftId: string) => call<{ deleted: string }>('draft-delete', { draftId }),
  send: (m: Outgoing) => call<{ sent: boolean; threadId: string | null }>('send', toWire(m)),
  connect: () => call<{ authorizeUrl: string }>('connect', { redirect: typeof window !== 'undefined' ? window.location.pathname : '/lenses/mail' }),
};

function toWire(m: Outgoing): Record<string, unknown> {
  return {
    to: m.to, cc: m.cc || undefined, bcc: m.bcc || undefined, subject: m.subject, body: m.body,
    threadId: m.threadId, inReplyTo: m.inReplyTo, references: m.references, draftId: m.draftId,
    attachments: m.attachments.map(({ filename, mimeType, data }) => ({ filename, mimeType, data })),
  };
}

export function senderName(from: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</);
  return (m ? m[1] : from).trim() || from;
}

export function addressOf(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}

/** Split a header address list on commas that are not inside quotes. */
export function splitAddresses(list: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of list || '') {
    if (ch === '"') quoted = !quoted;
    if (ch === ',' && !quoted) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function fmtListDate(ms: number | null, fallback: string): string {
  const t = ms ? new Date(ms) : fallback ? new Date(fallback) : null;
  if (!t || isNaN(t.getTime())) return '';
  const now = new Date();
  if (t.toDateString() === now.toDateString()) return t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (t.getFullYear() === now.getFullYear()) return t.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return t.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtFullDate(ms: number | null, fallback: string): string {
  const t = ms ? new Date(ms) : fallback ? new Date(fallback) : null;
  if (!t || isNaN(t.getTime())) return fallback;
  return t.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

const prefixed = (subject: string, p: 'Re' | 'Fwd') =>
  new RegExp(`^${p}:`, 'i').test(subject.trim()) ? subject : `${p}: ${subject}`;

function quote(m: FullMessage): string {
  const body = (m.text || m.snippet || '').split('\n').map((l) => `> ${l}`).join('\n');
  return `\n\nOn ${fmtFullDate(m.internalDate, m.date)}, ${m.from} wrote:\n${body}`;
}

/** Reply / reply-all draft: threaded to the original, quoting it, never including yourself. */
export function replyDraft(m: FullMessage, me: string, all: boolean): Outgoing {
  const mine = me.toLowerCase();
  const to = m.replyTo || m.from;
  const others = all
    ? [...splitAddresses(m.to), ...splitAddresses(m.cc)].filter((a) => {
      const addr = addressOf(a).toLowerCase();
      return addr && addr !== mine && addr !== addressOf(to).toLowerCase();
    })
    : [];
  const sentByMe = addressOf(m.from).toLowerCase() === mine;
  return {
    to: sentByMe ? m.to : to,
    cc: others.join(', '),
    bcc: '',
    subject: prefixed(m.subject, 'Re'),
    body: quote(m),
    threadId: m.threadId,
    inReplyTo: m.messageIdHeader || undefined,
    references: [m.references, m.messageIdHeader].filter(Boolean).join(' ') || undefined,
    attachments: [],
  };
}

export function forwardDraft(m: FullMessage): Outgoing {
  const header = [
    '---------- Forwarded message ---------',
    `From: ${m.from}`,
    `Date: ${fmtFullDate(m.internalDate, m.date)}`,
    `Subject: ${m.subject}`,
    `To: ${m.to}`,
    m.cc ? `Cc: ${m.cc}` : '',
  ].filter(Boolean).join('\n');
  return {
    to: '', cc: '', bcc: '',
    subject: prefixed(m.subject, 'Fwd'),
    body: `\n\n${header}\n\n${m.text || m.snippet || ''}`,
    attachments: [],
  };
}

export const SYSTEM_FOLDERS = [
  { id: 'INBOX', label: 'Inbox' },
  { id: 'STARRED', label: 'Starred' },
  { id: 'IMPORTANT', label: 'Important' },
  { id: 'SENT', label: 'Sent' },
  { id: 'DRAFT', label: 'Drafts' },
  { id: 'ALL', label: 'All mail' },
  { id: 'SPAM', label: 'Spam' },
  { id: 'TRASH', label: 'Trash' },
] as const;
