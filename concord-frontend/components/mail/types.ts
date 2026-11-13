'use client';

import type { DTU } from '@/lib/api/generated-types';

export const MAX_ATTACHMENTS = 12;
export const STATUS_FILTERS = ['all', 'unread', 'read', 'claimed', 'expired', 'declined'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export type MailTab = 'inbox' | 'sent' | 'compose';

export interface MailRow {
  id: string;
  fromUser?: string;
  toUser?: string;
  fromName?: string | null;
  fromHandle?: string | null;
  toName?: string | null;
  toHandle?: string | null;
  worldId?: string | null;
  subject: string;
  body: string;
  status: 'unread' | 'read' | 'claimed' | 'expired' | 'declined';
  sentAt: number;
  readAt?: number;
  claimedAt?: number;
  declinedAt?: number;
  parentId?: string | null;
  expiresAt: number;
  attachment_dtu_ids: string[];
  attachmentCc: number;
  codCc: number;
}

/**
 * FIX-mail-016: a compose prefill handed from a folder panel to the
 * composer — a Reply carries the original's id as parentId (the send
 * threads under it), a Forward quotes the original with no thread link
 * and no recipient.
 */
export interface ComposeSeed {
  toUserId?: string;
  subject: string;
  body: string;
  parentId?: string;
}

export type { DTU };
