'use client';

/**
 * AutoSourceButton — phase 9b. When a lens has thin coverage of a topic,
 * this runs research.auto-source (phase 9a): the server gathers public
 * sources, saves them as public citation DTUs (headline/link/excerpt only —
 * never article text), and drafts ONE private summary whose every sentence
 * cites a fetched source. The draft renders here, and only the user who ran
 * it can publish it (the server enforces that too).
 *
 * Honest states throughout: disabled, rate-limited, and not-enough-sources
 * are said plainly, and nothing claims to be saved when it wasn't.
 */
import { useEffect, useState } from 'react';
import { Loader2, Sparkles, Globe, Lock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface AutoSourceResult {
  covered?: boolean;
  existing?: unknown[];
  summaryId?: string;
  citationIds?: string[];
  sources?: string[];
  providersUsed?: string[];
}

/** research.auto-source-status (9a): server switch, caps and this user's usage. */
interface AutoSourceStatus {
  enabled: boolean;
  signedIn: boolean;
  dailyCap: number;
  perUserHourly: number;
  usedToday: number;
  remainingToday: number;
  usedThisHour?: number;
  remainingThisHour?: number;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'covered'; count: number }
  | { kind: 'draft'; summaryId: string; text: string; sources: string[]; providers: string[] }
  | { kind: 'published' }
  | { kind: 'error'; message: string };

function runErrorMessage(data: { error?: string | null; reason?: string }): string {
  if (data.error === 'auth_required') return 'Sign in to auto-source a topic.';
  if (data.error === 'auto_source_disabled') return 'Auto-source is not enabled on this server yet.';
  if (data.error === 'rate_limited' || data.reason === 'user_hourly_limit') return 'You have hit the auto-source limit (5 runs per hour). Try again later.';
  if (data.reason === 'global_daily_cap') return 'Auto-source has hit its daily limit for everyone. Try again tomorrow.';
  if (data.reason === 'insufficient_sources') return 'Not enough independent public sources turned up to write a reliable summary. Nothing was saved.';
  if (data.error === 'llm_unavailable') return 'The summarizing brain is unavailable right now. Nothing was saved.';
  if (data.error === 'topic_required' || data.error === 'invalid_topic') return 'That topic is too short to source.';
  return data.error ? `Auto-source failed: ${data.error}` : 'Auto-source failed. Nothing was saved.';
}

function publishErrorMessage(data: { error?: string | null }): string {
  if (data.error === 'not_author') return 'Only the person who ran this auto-source can publish it.';
  if (data.error === 'citation_missing') return 'One of the cited sources no longer exists, so this cannot be published.';
  if (data.error === 'summary_not_found') return 'That draft no longer exists.';
  return data.error ? `Publish failed: ${data.error}` : 'Publish failed.';
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export function AutoSourceButton({ topic, lensDomain, className }: { topic: string; lensDomain?: string; className?: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [publishing, setPublishing] = useState(false);
  const [publishNote, setPublishNote] = useState('');

  const trimmed = topic.trim();
  // Server switch + caps, read up front so a disabled server shows a disabled
  // button instead of failing after a click. null = still loading / unknown.
  const [status, setStatus] = useState<AutoSourceStatus | null>(null);
  const [statusTick, setStatusTick] = useState(0);
  useEffect(() => {
    let live = true;
    lensRun<AutoSourceStatus>('research', 'auto-source-status', {})
      .then((r) => { if (live) setStatus(r.data?.ok && r.data.result ? r.data.result : null); })
      .catch(() => { if (live) setStatus(null); });
    return () => { live = false; };
  }, [statusTick]);

  const blocked: string | null = !status ? null
    : !status.enabled ? 'Auto-source is off on this server. Nothing will be gathered until an admin turns it on.'
    : !status.signedIn ? 'Sign in to auto-source a topic.'
    : status.remainingToday <= 0 ? 'Auto-source has hit its daily limit for everyone. Try again tomorrow.'
    : status.remainingThisHour === 0 ? `You have used all ${status.perUserHourly} auto-source runs for this hour. Try again later.`
    : null;

  async function run() {
    if (trimmed.length < 2) return;
    setPhase({ kind: 'running' });
    setPublishNote('');
    try {
      const r = await lensRun<AutoSourceResult>('research', 'auto-source', {
        topic: trimmed,
        ...(lensDomain ? { lensDomain } : {}),
      });
      const d = r.data;
      if (!d.ok || !d.result) {
        setPhase({ kind: 'error', message: runErrorMessage(d as { error?: string | null; reason?: string }) });
        return;
      }
      const res = d.result;
      if (res.covered) {
        setPhase({ kind: 'covered', count: Array.isArray(res.existing) ? res.existing.length : 0 });
        return;
      }
      if (!res.summaryId) {
        setPhase({ kind: 'error', message: 'Auto-source finished without a draft. Nothing was saved.' });
        return;
      }
      // Read the private draft back so the user reviews the actual text.
      let text = '';
      try {
        const back = await lensRun<{ dtu?: { content?: string; human?: { summary?: string } } }>('dtu', 'get', { id: res.summaryId });
        const dtu = back.data?.result?.dtu;
        text = String(dtu?.content || dtu?.human?.summary || '');
      } catch { /* the draft exists; only its preview failed */ }
      setPhase({
        kind: 'draft',
        summaryId: res.summaryId,
        text,
        sources: Array.isArray(res.sources) ? res.sources : [],
        providers: Array.isArray(res.providersUsed) ? res.providersUsed : [],
      });
    } catch {
      setPhase({ kind: 'error', message: 'Auto-source could not be reached. Nothing was saved.' });
    } finally {
      setStatusTick((t) => t + 1);
    }
  }

  async function publish(summaryId: string) {
    setPublishing(true);
    setPublishNote('');
    try {
      const r = await lensRun('research', 'auto-source-publish', { summaryId });
      if (r.data?.ok) {
        setPhase({ kind: 'published' });
      } else {
        setPublishNote(publishErrorMessage(r.data as { error?: string | null }));
      }
    } catch {
      setPublishNote('Publish could not be reached.');
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className={cn('rounded border border-white/10 bg-black/20 p-3 space-y-2', className)}>
      {phase.kind !== 'draft' && phase.kind !== 'published' && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={run}
            disabled={phase.kind === 'running' || trimmed.length < 2 || !!blocked}
            aria-disabled={!!blocked || undefined}
            title={blocked || undefined}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-teal-500/40 bg-teal-500/15 text-xs text-teal-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {phase.kind === 'running' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : blocked ? <Lock className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
            {phase.kind === 'running' ? 'Gathering sources…' : status && !status.enabled ? 'Auto-source is off' : 'Auto-source this topic'}
          </button>
          <span className="text-[11px] text-gray-500">
            {blocked || 'Pulls public sources into Concord and drafts a cited summary for your review.'}
          </span>
          {!blocked && status?.signedIn && typeof status.remainingThisHour === 'number' && (
            <span className="text-[11px] text-gray-500" data-testid="auto-source-remaining">
              {status.remainingThisHour} of {status.perUserHourly} runs left this hour
            </span>
          )}
        </div>
      )}

      {phase.kind === 'running' && (
        <p className="text-[11px] text-gray-400">Checking coverage, then Wikipedia, scholarly indexes, GDELT and data.gov. This can take a moment.</p>
      )}

      {phase.kind === 'covered' && (
        <p className="inline-flex items-start gap-1.5 text-[11px] text-gray-300">
          <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 shrink-0 mt-px" />
          This topic is already covered{phase.count > 0 ? ` (${phase.count} matching item${phase.count === 1 ? '' : 's'})` : ''} — nothing new was gathered.
        </p>
      )}

      {phase.kind === 'error' && (
        <p className="inline-flex items-start gap-1.5 text-[11px] text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          {phase.message}
        </p>
      )}

      {phase.kind === 'draft' && (
        <div className="space-y-2">
          <p className="inline-flex items-center gap-1.5 text-[11px] text-gray-300">
            <Lock className="w-3.5 h-3.5 text-gray-400" />
            Private draft — only you can see it until you publish.
            {phase.providers.length > 0 && <span className="text-gray-500">Sources via {phase.providers.join(', ')}.</span>}
          </p>
          {phase.text
            ? <p className="text-sm text-gray-100 whitespace-pre-wrap">{phase.text}</p>
            : <p className="text-[11px] text-gray-400">The draft was saved but its preview could not be loaded.</p>}
          {phase.sources.length > 0 && (
            <p className="inline-flex items-start gap-1.5 text-[11px] text-gray-400">
              <Globe className="w-3.5 h-3.5 shrink-0 mt-px" />
              {phase.sources.map(hostOf).join(' · ')}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => publish(phase.summaryId)}
              disabled={publishing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-teal-500/40 bg-teal-500/15 text-xs text-teal-100 disabled:opacity-50"
            >
              {publishing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Publish summary
            </button>
            <button
              type="button"
              onClick={() => setPhase({ kind: 'idle' })}
              className="px-3 py-1.5 rounded-md border border-white/10 text-xs text-gray-400 hover:text-gray-200"
            >
              Keep private
            </button>
          </div>
          {publishNote && <p className="text-[11px] text-amber-300">{publishNote}</p>}
        </div>
      )}

      {phase.kind === 'published' && (
        <p className="inline-flex items-start gap-1.5 text-[11px] text-gray-300">
          <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 shrink-0 mt-px" />
          Published. The summary is now public, with its sources saved as public citations.
        </p>
      )}
    </div>
  );
}

export default AutoSourceButton;
