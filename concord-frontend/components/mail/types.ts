'use client';

import type { DTU } from '@/lib/api/generated-types';

export const MAX_ATTACHMENTS = 12;
export const STATUS_FILTERS = ['all', 'unread', 'read', 'claimed', 'expired'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export type MailTab = 'inbox' | 'sent' | 'compose';

export interface MailRow {
  id: string;
  fromUser?: string;
  toUser?: string;
  worldId?: string | null;
  subject: string;
  body: string;
  status: 'unread' | 'read' | 'claimed' | 'expired';
  sentAt: number;
  readAt?: number;
  claimedAt?: number;
  expiresAt: number;
  attachment_dtu_ids: string[];
  attachmentCc: number;
  codCc: number;
}

export type { DTU };
