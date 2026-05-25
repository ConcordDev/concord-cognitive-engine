'use client';

// Inbound moderation queue for federated content — federation domain.
// Macros: federation.reportInbound, listModerationQueue, reviewInbound.

import { useState, useCallback, useEffect } from 'react';
import { lensRun } from '@/lib/api/client';
import { Flag, Loader2, Check, X, ShieldX, Inbox } from 'lucide-react';

interface ModItem {
  id: string;
  sourceDomain: string;
  contentId: string | null;
  summary: string;
  reason: string;
  status: 'open' | 'reviewed';
  decision: string | null;
  reportedAt: number;
  reviewedAt: number | null;
}

interface QueueResult {
  items: ModItem[];
  open: number;
  reviewed: number;
  total: number;
}

type StatusFilter = 'open' | 'reviewed' | 'all';

export function ModerationQueuePanel() {
  const [data, setData] = useState<QueueResult | null>(null);
  const [status, setStatus] = useState<StatusFilter>('open');
  const [loading, setLoading] = useState(false);

  const [srcDomain, setSrcDomain] = useState('');
  const [contentId, setContentId] = useState('');
  const [summary, setSummary] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun<QueueResult>('federation', 'listModerationQueue', { status });
      if (r.data.ok && r.data.result) setData(r.data.result);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const report = useCallback(async () => {
    if (!srcDomain.trim() || !reason.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await lensRun('federation', 'reportInbound', {
        sourceDomain: srcDomain.trim(),
        contentId: contentId.trim() || undefined,
        summary: summary.trim(),
        reason: reason.trim(),
      });
      if (!r.data.ok) { setErr(r.data.error || 'failed'); return; }
      setSrcDomain(''); setContentId(''); setSummary(''); setReason('');
      await load();
    } finally {
      setBusy(false);
    }
  }, [srcDomain, contentId, summary, reason, load]);

  const review = useCallback(async (id: string, decision: 'approve' | 'reject' | 'defederate') => {
    setReviewing(id);
    try {
      await lensRun('federation', 'reviewInbound', { id, decision });
      await load();
    } finally {
      setReviewing(null);
    }
  }, [load]);

  return (
    <section className="rounded-lg border border-rose-500/30 bg-black/60 p-4">
      <h2 className="text-rose-300 font-semibold mb-3 inline-flex items-center gap-1.5">
        <Inbox className="w-4 h-4" /> Inbound moderation queue
      </h2>
      <p className="text-xs text-gray-400 mb-3">
        Report federated content for review. A defederate decision blocks
        the source peer automatically.
      </p>

      {/* Report form */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
        <input
          value={srcDomain}
          onChange={(e) => setSrcDomain(e.target.value)}
          placeholder="source peer domain"
          className="bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-rose-400"
        />
        <input
          value={contentId}
          onChange={(e) => setContentId(e.target.value)}
          placeholder="content / DTU id (optional)"
          className="bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200"
        />
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="content summary (optional)"
          className="bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200"
        />
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="reason for report"
          className="bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200"
        />
      </div>
      <button
        type="button"
        onClick={report}
        disabled={busy || !srcDomain.trim() || !reason.trim()}
        className="px-3 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 rounded text-white text-sm inline-flex items-center gap-1 mb-3"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Flag className="w-4 h-4" />}
        Report content
      </button>
      {err && <div className="text-rose-300 text-xs mb-2">{err}</div>}

      {/* Status filter */}
      <div className="flex items-center gap-2 mb-3 text-xs">
        {(['open', 'reviewed', 'all'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`px-2 py-1 rounded border capitalize ${
              status === s
                ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
            }`}
          >
            {s}
            {data && s === 'open' ? ` (${data.open})` : ''}
            {data && s === 'reviewed' ? ` (${data.reviewed})` : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-xs text-gray-400 italic">Loading queue…</p>
      ) : !data || data.items.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No items in the queue.</p>
      ) : (
        <ul className="space-y-2">
          {data.items.map((item) => (
            <li key={item.id} className="border border-white/10 rounded p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-mono text-gray-100 truncate">{item.sourceDomain}</span>
                <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                  item.status === 'open'
                    ? 'bg-amber-900/40 border-amber-500/30 text-amber-300'
                    : 'bg-zinc-800 border-white/10 text-gray-400'
                }`}>
                  {item.status === 'reviewed' ? `${item.decision}` : 'open'}
                </span>
                {item.contentId && (
                  <span className="text-[10px] text-gray-400 font-mono">{item.contentId}</span>
                )}
              </div>
              {item.summary && <div className="text-xs text-gray-300 mt-1">{item.summary}</div>}
              <div className="text-[11px] text-gray-400 mt-1">reason: {item.reason}</div>
              <div className="text-[10px] text-gray-400 mt-1">
                reported {new Date(item.reportedAt).toLocaleString()}
              </div>
              {item.status === 'open' && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => review(item.id, 'approve')}
                    disabled={reviewing === item.id}
                    className="px-2 py-1 text-xs bg-emerald-700/60 hover:bg-emerald-700 rounded text-white inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    {reviewing === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => review(item.id, 'reject')}
                    disabled={reviewing === item.id}
                    className="px-2 py-1 text-xs bg-amber-700/60 hover:bg-amber-700 rounded text-white inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    <X className="w-3 h-3" /> Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => review(item.id, 'defederate')}
                    disabled={reviewing === item.id}
                    className="px-2 py-1 text-xs bg-rose-700/60 hover:bg-rose-700 rounded text-white inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    <ShieldX className="w-3 h-3" /> Defederate
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
