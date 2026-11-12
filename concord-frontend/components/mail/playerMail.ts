/**
 * Concord player mail goes through the mail.* macros (server/domains/mail.js).
 * There is no /api/mail REST surface. Gmail stays a separate, labeled connector.
 */

import { lensRun } from '@/lib/api/client';
import type { MailRow } from './types';

/** FIX-mail-002: the autosaved compose draft (mail.draft-get/save). */
export interface MailDraft {
  toUserId: string;
  subject: string;
  body: string;
  attachmentCc: number;
  codCc: number;
  attachmentDtuIds: string[];
  attachmentTitles: Record<string, string>;
  updatedAt: number;
}

export interface MailClaimBody {
  ok?: boolean;
  error?: string;
  id?: string;
  mail?: MailRow[];
  claimed?: boolean;
  alreadyClaimed?: boolean;
  dtuIds?: string[];
  draft?: MailDraft | null;
  payout?: { attachmentCc?: number; codCcPaid?: number };
  attachments?: { dtuIds?: string[]; transferred?: string[]; skipped?: string[] };
}

export type PlayerMailResult =
  | ({ ok: true } & MailClaimBody)
  | { ok: false; error: string; dtuIds?: string[] };

export async function playerMail(action: string, input: Record<string, unknown> = {}): Promise<PlayerMailResult> {
  const r = await lensRun<MailClaimBody>('mail', action, input);
  const body = r.data.result;
  if (!r.data.ok || !body || body.ok === false) {
    return { ok: false, error: body?.error || r.data.error || 'mail_failed', dtuIds: body?.dtuIds };
  }
  return { ...body, ok: true };
}

export function sendFailureText(error: string | undefined): string {
  if (error === 'dtu_not_owned') return 'Not sent. You can only attach DTUs you own.';
  if (error === 'insufficient_funds') return 'Not sent. Not enough Concord Coin to escrow that gift.';
  if (error === 'cannot_mail_self') return 'Not sent. You cannot mail yourself.';
  if (error === 'subject_required') return 'Not sent. A subject is required.';
  if (error === 'missing_users' || error === 'no_user' || error === 'recipient_unresolved') return 'Not sent. Pick a recipient who has a Concord account.';
  return error ? `Not sent. ${error.replace(/_/g, ' ')}.` : 'Not sent.';
}

/**
 * Display label for a mail party (F3). The server resolves a display
 * name for every party; when it cannot, the label is a neutral word —
 * never the raw account id.
 */
export function mailPartyLabel(name: string | null | undefined, handle: string | null | undefined): string {
  if (name && name.trim()) return name;
  if (handle && handle.trim()) return `@${handle}`;
  return 'A Concord member';
}

export function deleteResultText(j: PlayerMailResult): { kind: 'ok' | 'err'; msg: string } {
  if (!j.ok) {
    if (j.error === 'already_claimed') return { kind: 'err', msg: 'Not removed. This mail was claimed, so it stays as the claim record.' };
    if (j.error === 'not_authorized') return { kind: 'err', msg: 'Not removed. You can only remove mail you sent.' };
    if (j.error === 'not_found') return { kind: 'err', msg: 'Not removed. That mail is already gone.' };
    return { kind: 'err', msg: 'Not removed. Mail could not be reached just now.' };
  }
  return { kind: 'ok', msg: 'Removed from your Sent list. The recipient keeps their copy.' };
}

export function claimResultText(j: PlayerMailResult): { kind: 'ok' | 'err'; msg: string } {
  if (!j.ok) return { kind: 'err', msg: j.error ? `Not claimed. ${j.error.replace(/_/g, ' ')}.` : 'Not claimed.' };
  if (j.alreadyClaimed) return { kind: 'ok', msg: 'Already claimed. Nothing new moved.' };
  const cc = j.payout?.attachmentCc || 0;
  const cod = j.payout?.codCcPaid || 0;
  const moved = j.attachments?.transferred ?? [];
  const skipped = j.attachments?.skipped ?? [];
  const bits = [`Claimed ${cc} CC`];
  if (cod > 0) bits.push(`paid ${cod} CC cash on delivery`);
  bits.push(`${moved.length} DTU${moved.length === 1 ? '' : 's'} transferred`);
  let msg = `${bits.join(', ')}.`;
  if (skipped.length) msg += ` ${skipped.length} DTU${skipped.length === 1 ? '' : 's'} stayed with the owner.`;
  return { kind: 'ok', msg };
}
