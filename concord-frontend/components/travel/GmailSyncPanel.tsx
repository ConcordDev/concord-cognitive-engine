'use client';

/**
 * GmailSyncPanel — TripIt Pro's "inbox auto-sync" for the travel lens
 * (Wave-4 gap-closure, travel-capability-map.md #2). Reuses the exact
 * connector Concord already ships for the message lens (Gmail only — there
 * is no Outlook connector in Concord, so this is intentionally Gmail-only)
 * via `travel.inbox-sync`, which itself rides the same SSRF-guarded read
 * path as `gmail.list`/`gmail.get` (server/domains/gmail.js).
 *
 * Honesty contract: a not-connected account NEVER renders as "0 synced" —
 * it renders the same Connect-Gmail affordance `GmailSection` (message lens)
 * uses, driven by the same `no_token` / `connector_not_configured` /
 * `gmail_disabled` reason codes `gmail.list` returns. A real failure (network,
 * handler error) is shown as an error, not silently swallowed.
 */

import { useCallback, useState } from 'react';
import { Mail, Loader2, ExternalLink } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

const NOT_CONNECTED = new Set(['no_token', 'connector_not_configured', 'gmail_disabled']);

interface SkippedDetail {
  messageId: string;
  reason: string;
  subject?: string | null;
}

interface SyncResult {
  scanned: number;
  imported: number;
  skippedCount: number;
  skipped: SkippedDetail[];
}

export function GmailSyncPanel({ tripId, onImported }: { tripId: string; onImported: () => void }) {
  const [busy, setBusy] = useState(false);
  const [notConnected, setNotConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);

  const connect = useCallback(async () => {
    try {
      const r = await lensRun('gmail', 'connect', { redirect: window.location.pathname });
      const url = r.data?.result?.authorizeUrl as string | undefined;
      if (url) window.location.href = url;
      else setError('Could not start the Gmail connection.');
    } catch {
      setError('network_error');
    }
  }, []);

  const sync = useCallback(async () => {
    setBusy(true); setError(null); setResult(null); setNotConnected(false);
    try {
      const r = await lensRun('travel', 'inbox-sync', { tripId });
      if (r.data?.ok) {
        const res = r.data.result as SyncResult;
        setResult(res);
        if (res.imported > 0) onImported();
      } else {
        const reason = r.data?.error || 'sync_failed';
        if (NOT_CONNECTED.has(reason)) setNotConnected(true);
        else setError(reason);
      }
    } catch {
      setError('network_error');
    } finally {
      setBusy(false);
    }
  }, [tripId, onImported]);

  return (
    <div data-testid="gmail-sync-panel" className="border-t border-zinc-800 pt-3 mt-3">
      <h4 className="text-xs font-semibold text-zinc-300 mb-2 flex items-center gap-1">
        <Mail className="w-3.5 h-3.5 text-emerald-400" /> Sync from Gmail
      </h4>
      <p className="text-[11px] text-zinc-400 mb-2">
        Scans your inbox for confirmation-shaped emails and imports the ones that
        parse into a real booking — no manual paste.
      </p>
      <button type="button" data-testid="gmail-sync-btn" onClick={() => void sync()} disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />} Sync from Gmail
      </button>

      {notConnected && (
        <div data-testid="gmail-sync-not-connected" className="mt-2 bg-zinc-900/70 border border-amber-900/50 rounded-xl p-3 space-y-2">
          <p className="text-[11px] text-amber-300">Connect your Gmail to auto-import booking confirmations.</p>
          <button type="button" data-testid="gmail-sync-connect-btn" onClick={() => void connect()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-600/30 text-amber-200 hover:bg-amber-600/40 rounded-lg">
            <ExternalLink className="w-3.5 h-3.5" /> Connect Gmail
          </button>
        </div>
      )}

      {error && !notConnected && (
        <p data-testid="gmail-sync-error" className="mt-2 text-[11px] text-rose-400">{error}</p>
      )}

      {result && (
        <div data-testid="gmail-sync-result" className="mt-2 bg-zinc-900/70 border border-emerald-900/50 rounded-xl p-3">
          <p className="text-[11px] text-emerald-300">
            {result.imported > 0
              ? `Imported ${result.imported} booking${result.imported === 1 ? '' : 's'} from ${result.scanned} scanned message${result.scanned === 1 ? '' : 's'}.`
              : `Scanned ${result.scanned} message${result.scanned === 1 ? '' : 's'} — no new bookings found.`}
          </p>
        </div>
      )}
    </div>
  );
}
