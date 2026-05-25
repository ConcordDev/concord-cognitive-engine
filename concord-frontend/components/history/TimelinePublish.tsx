'use client';

/**
 * TimelinePublish — publishes a timeline to a public read-only snapshot,
 * surfacing a share URL + embeddable <iframe> code. Wires
 * history.timeline-publish / timeline-unpublish. No hardcoded data.
 */

import { useCallback, useState } from 'react';
import { Share2, Copy, Check, Globe2, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface PublishResult {
  shareId: string;
  shareUrl: string;
  embedCode: string;
  eventCount: number;
  publishedAt: string;
}

export function TimelinePublish({ timelineId, title }: { timelineId: string; title: string }) {
  const [pub, setPub] = useState<PublishResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<'url' | 'embed' | null>(null);

  const publish = useCallback(async () => {
    setBusy(true); setError('');
    const r = await lensRun<PublishResult>('history', 'timeline-publish', { timelineId });
    if (r.data?.ok && r.data.result) setPub(r.data.result);
    else setError(r.data?.error || 'Publish failed');
    setBusy(false);
  }, [timelineId]);

  const unpublish = useCallback(async () => {
    if (!pub) return;
    setBusy(true); setError('');
    const r = await lensRun('history', 'timeline-unpublish', { shareId: pub.shareId });
    if (r.data?.ok) setPub(null);
    else setError(r.data?.error || 'Unpublish failed');
    setBusy(false);
  }, [pub]);

  const copy = useCallback(async (text: string, which: 'url' | 'embed') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* clipboard unavailable */ }
  }, []);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-2">
      <p className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1">
        <Globe2 className="w-3.5 h-3.5 text-amber-400" /> Publish &amp; embed
      </p>
      {!pub ? (
        <button onClick={publish} disabled={busy}
          className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold disabled:opacity-40 inline-flex items-center gap-1.5">
          <Share2 className="w-3.5 h-3.5" /> {busy ? 'Publishing…' : `Publish "${title}"`}
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] text-emerald-400">
            Published · {pub.eventCount} event{pub.eventCount !== 1 ? 's' : ''} ·{' '}
            {new Date(pub.publishedAt).toLocaleString()}
          </p>
          <div>
            <p className="text-[10px] text-zinc-400 mb-0.5">Share link</p>
            <div className="flex gap-1">
              <input readOnly value={pub.shareUrl}
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[10px] text-zinc-300 font-mono" />
              <button onClick={() => copy(pub.shareUrl, 'url')}
                className="px-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300">
                {copied === 'url' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div>
            <p className="text-[10px] text-zinc-400 mb-0.5">Embed code</p>
            <div className="flex gap-1">
              <textarea readOnly value={pub.embedCode} rows={2}
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[10px] text-zinc-300 font-mono resize-none" />
              <button onClick={() => copy(pub.embedCode, 'embed')}
                className="px-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 self-stretch">
                {copied === 'embed' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <button onClick={unpublish} disabled={busy}
            className="text-[10px] text-rose-400 hover:text-rose-300 inline-flex items-center gap-1 disabled:opacity-40">
            <Trash2 className="w-3 h-3" /> Unpublish
          </button>
        </div>
      )}
      {error && <p className="text-[10px] text-rose-400">{error}</p>}
    </div>
  );
}
