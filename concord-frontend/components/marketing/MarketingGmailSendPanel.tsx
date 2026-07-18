'use client';

/**
 * MarketingGmailSendPanel — real per-user Gmail send for a campaign
 * (Wave-4 gap-closure: campaign "send" used to be compute-only ROI/KPI
 * math on typed-in numbers; there was no way to actually deliver a
 * campaign to anyone).
 *
 * Reuses `marketing.campaign-send-gmail`, which itself rides the same
 * real, SSRF-guarded, per-user-OAuth Gmail sender Concord already ships
 * for the message lens (server/lib/connector-client.js#writeGmailMessage,
 * consumed by server/domains/gmail.js#send). Every message is a real
 * Gmail `messages/send` call through the CALLING USER's own connected
 * inbox — one API call per recipient, capped low.
 *
 * Honesty contract (mirrors GmailSyncPanel, the travel lens's Gmail
 * surface): a not-connected account never renders as "0 sent" — it
 * renders the same Connect-Gmail affordance, driven by the macro's
 * `gmail_not_connected` reason code. A recipient is only ever shown as
 * "Sent" when the backend reports a real Gmail 2xx; a rejected recipient
 * shows its real failure reason. No open/click metrics are shown because
 * none are collected — this is delivery status only.
 *
 * This is deliberately NOT a bulk sender: the low cap is shown up front
 * and, if the recipient list exceeds it, the response's honest `capped`
 * flag is surfaced rather than silently dropping the extras. Bulk
 * deliverability (dedicated sending domain/IP, SPF/DKIM alignment, an
 * ESP like SendGrid/Postmark/SES) is a genuine external dependency this
 * intentionally does not fake — see the note rendered under Send.
 */

import { useCallback, useEffect, useState } from 'react';
import { Mail, Loader2, ExternalLink, Send, CheckCircle2, XCircle, History } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

const NOT_CONNECTED_REASONS = new Set(['gmail_not_connected', 'no_token', 'connector_not_configured', 'gmail_disabled', 'reauth_required']);
const RECIPIENT_CAP = 20;

interface SendResultRow { to: string; status: 'sent' | 'failed'; reason?: string; providerMessageId?: string | null }
interface SendResult {
  id: string; at: string; requested: number; attempted: number;
  sent: number; failed: number; capped: boolean; cap: number;
  results: SendResultRow[]; note: string;
}
interface HistoryEntry { id: string; at: string; sent: number; failed: number; requested: number; attempted: number }

export function MarketingGmailSendPanel({ campaignId, campaignName }: { campaignId: string; campaignName: string }) {
  const [recipients, setRecipients] = useState('');
  const [subject, setSubject] = useState(campaignName);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [notConnected, setNotConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const loadHistory = useCallback(async () => {
    const r = await lensRun('marketing', 'campaign-gmail-send-history', { campaignId });
    setHistory((r.data?.result as { sends?: HistoryEntry[] } | null)?.sends || []);
  }, [campaignId]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);
  useEffect(() => { setSubject(campaignName); }, [campaignName]);

  const parsedRecipients = recipients
    .split(/[\n,]/)
    .map((r) => r.trim())
    .filter(Boolean);

  const connect = useCallback(async () => {
    try {
      const r = await lensRun('gmail', 'connect', { redirect: window.location.pathname });
      const url = (r.data?.result as { authorizeUrl?: string } | null)?.authorizeUrl;
      if (url) window.location.href = url;
      else setError('Could not start the Gmail connection.');
    } catch {
      setError('network_error');
    }
  }, []);

  const send = useCallback(async () => {
    if (parsedRecipients.length === 0) { setError('Add at least one recipient.'); return; }
    if (!body.trim()) { setError('Write the email body before sending.'); return; }
    setBusy(true); setError(null); setResult(null); setNotConnected(false);
    try {
      const r = await lensRun('marketing', 'campaign-send-gmail', {
        campaignId, recipients: parsedRecipients, subject: subject.trim() || campaignName, body: body.trim(),
      });
      if (r.data?.ok) {
        setResult(r.data.result as SendResult);
        void loadHistory();
      } else {
        const reason = r.data?.error || 'send_failed';
        if (NOT_CONNECTED_REASONS.has(reason)) setNotConnected(true);
        else setError(reason);
      }
    } catch {
      setError('network_error');
    } finally {
      setBusy(false);
    }
  }, [campaignId, campaignName, subject, body, parsedRecipients, loadHistory]);

  return (
    <div data-testid="marketing-gmail-send-panel" className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-3">
      <h4 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
        <Mail className="w-3.5 h-3.5 text-emerald-400" /> Send via Gmail
      </h4>
      <p className="text-[11px] text-zinc-400">
        Sends real email through your connected Gmail account — one message per
        recipient, capped at {RECIPIENT_CAP} per send. This is a low-volume,
        per-user send, not bulk delivery.
      </p>

      <div className="space-y-2">
        <textarea
          data-testid="gmail-send-recipients" rows={2} placeholder="Recipients — one per line or comma-separated"
          value={recipients} onChange={(e) => setRecipients(e.target.value)}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 resize-none" />
        {parsedRecipients.length > 0 && (
          <p className="text-[10px] text-zinc-500">
            {parsedRecipients.length} recipient{parsedRecipients.length === 1 ? '' : 's'}
            {parsedRecipients.length > RECIPIENT_CAP && (
              <span className="text-amber-400"> — only the first {RECIPIENT_CAP} will be sent this run</span>
            )}
          </p>
        )}
        <input
          data-testid="gmail-send-subject" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <textarea
          data-testid="gmail-send-body" rows={4} placeholder="Email body" value={body} onChange={(e) => setBody(e.target.value)}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 resize-none" />
      </div>

      <button type="button" data-testid="gmail-send-btn" onClick={() => void send()} disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send campaign
      </button>

      {notConnected && (
        <div data-testid="gmail-send-not-connected" className="bg-zinc-950/60 border border-amber-900/50 rounded-xl p-3 space-y-2">
          <p className="text-[11px] text-amber-300">Connect your Gmail to send this campaign.</p>
          <button type="button" data-testid="gmail-send-connect-btn" onClick={() => void connect()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-600/30 text-amber-200 hover:bg-amber-600/40 rounded-lg">
            <ExternalLink className="w-3.5 h-3.5" /> Connect Gmail
          </button>
        </div>
      )}

      {error && !notConnected && (
        <p data-testid="gmail-send-error" className="text-[11px] text-rose-400">{error}</p>
      )}

      {result && (
        <div data-testid="gmail-send-result" className="bg-zinc-950/60 border border-zinc-800 rounded-xl p-3 space-y-2">
          <p className="text-[11px] text-zinc-300">
            <span className="text-emerald-400 font-semibold">{result.sent} sent</span>
            {result.failed > 0 && <span className="text-rose-400 font-semibold"> · {result.failed} failed</span>}
            {' '}of {result.attempted} attempted
            {result.capped && <span className="text-amber-400"> (capped at {result.cap} of {result.requested} requested)</span>}
          </p>
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {result.results.map((row) => (
              <li key={row.to} className="flex items-center gap-1.5 text-[11px]">
                {row.status === 'sent'
                  ? <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  : <XCircle className="w-3 h-3 text-rose-400 shrink-0" />}
                <span className="text-zinc-300 truncate">{row.to}</span>
                {row.status === 'failed' && <span className="text-rose-400 text-[10px]">({row.reason})</span>}
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-zinc-500 border-t border-zinc-800 pt-2">{result.note}</p>
        </div>
      )}

      {history.length > 0 && (
        <div data-testid="gmail-send-history" className="border-t border-zinc-800 pt-2 space-y-1">
          <p className="text-[10px] text-zinc-500 flex items-center gap-1"><History className="w-3 h-3" /> Send history</p>
          {history.slice(0, 5).map((h) => (
            <p key={h.id} className="text-[10px] text-zinc-500">
              {new Date(h.at).toLocaleString()} — {h.sent} sent{h.failed > 0 ? `, ${h.failed} failed` : ''}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
