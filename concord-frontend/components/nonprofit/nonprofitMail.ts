/** Wording for nonprofit email + recorded pledge payments.
 *  "Sent" is only used when the server status is sent. */

export interface CommSendData {
  ok?: boolean;
  error?: string | null;
  result?: {
    donor?: string;
    status?: string;
    reason?: string | null;
    comm?: { status?: string; reason?: string | null };
  } | null;
}

export interface ThankYouReason {
  donor?: string;
  gifts?: number;
  reason?: string;
  status?: string;
}

export interface ThankYouResult {
  sent?: number;
  notSent?: number;
  reasons?: ThankYouReason[];
}

const GMAIL_REASONS = new Set(['no_gmail_linked', 'no_token', 'connector_not_configured', 'reauth_required', 'auth_expired']);

export function commSendFeedback(kind: string, data: CommSendData | null | undefined): string {
  if (!data?.ok) return data?.error || 'Send failed.';
  const status = data.result?.status || data.result?.comm?.status;
  const reason = data.result?.reason || data.result?.comm?.reason || '';
  const donor = data.result?.donor || 'donor';
  const label = kind.replace(/_/g, ' ');
  if (status === 'sent') return `Sent ${label} to ${donor}.`;
  if (GMAIL_REASONS.has(reason)) return 'Not sent: connect Gmail';
  if (reason === 'no_email') return `Not sent: ${donor} has no email.`;
  return reason ? `Not sent: ${String(reason).replace(/_/g, ' ')}.` : 'Not sent.';
}

export function thankYouSweepLines(result: ThankYouResult | null | undefined): string[] {
  const sent = result?.sent ?? 0;
  const notSent = result?.notSent ?? 0;
  const reasons = result?.reasons || [];
  if (sent === 0 && notSent === 0) return ['All gifts already acknowledged.'];
  const lines: string[] = [];
  if (sent > 0) lines.push(`Sent ${sent} thank-you message${sent === 1 ? '' : 's'}.`);
  const gmail = reasons.some((r) => r.reason && GMAIL_REASONS.has(r.reason));
  if (notSent > 0 && gmail) lines.push('Not sent: connect Gmail');
  for (const r of reasons) {
    if (r.reason && GMAIL_REASONS.has(r.reason)) continue;
    const why = r.reason === 'no_email' ? 'no email' : (r.reason || 'not sent').replace(/_/g, ' ');
    lines.push(`Not sent: ${r.donor || 'donor'} (${why}).`);
  }
  if (notSent > 0 && lines.length === (sent > 0 ? 1 : 0)) lines.push('Not sent.');
  return lines;
}

export function commStatusLabel(comm: { status?: string; reason?: string | null }): string {
  if (comm.status === 'sent') return 'Sent';
  if (comm.reason && GMAIL_REASONS.has(comm.reason)) return 'Not sent: connect Gmail';
  if (comm.reason === 'no_email') return 'Not sent: no email';
  if (comm.reason) return `Not sent: ${comm.reason.replace(/_/g, ' ')}`;
  return 'Not sent';
}
