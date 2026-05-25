'use client';

/**
 * ConversationTurn — renders one Q+A turn inside a threaded expert-mode
 * conversation: the question, the synthesized answer with clickable
 * [N] citation chips, the numbered source list (DTU + live web rows),
 * related-question suggestions, and per-turn Markdown / share export.
 *
 * Citation chips, sources, related questions, and exports are all real:
 * chips come from the answer text, sources from expert_mode.ask,
 * related from the macro response, exports from expert_mode.export_*.
 */

import { useCallback, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Copy, Check, Share2, ExternalLink, Loader2, Sparkles, ListChecks,
} from 'lucide-react';

export interface TurnSource {
  idx: number;
  id: string;
  title: string;
  creatorId: string | null;
  scope: string;
  origin?: string;
  url?: string;
  sourceName?: string;
  snippet?: string;
  mintedByProvider: string | null;
  mintedByModel: string | null;
}

export interface Turn {
  id: string;
  query: string;
  answer: string;
  sources: TurnSource[];
  provider: string | null;
  model: string | null;
  citationsRecorded: number;
  focus: string;
  webCount: number;
  askedAt: number;
}

function providerBadge(
  provider: string | null | undefined,
  model: string | null | undefined,
): { label: string; color: string } | null {
  if (!provider || provider === 'concord_default') return null;
  const colors: Record<string, string> = {
    anthropic: 'bg-orange-600/80 text-orange-50',
    openai: 'bg-emerald-600/80 text-emerald-50',
    xai: 'bg-zinc-700 text-zinc-100',
    google: 'bg-blue-600/80 text-blue-50',
  };
  const labels: Record<string, string> = {
    anthropic: 'Claude',
    openai: 'GPT',
    xai: 'Grok',
    google: 'Gemini',
  };
  return {
    label: `${labels[provider] || provider}${model ? ` · ${model.replace(/^(claude|gpt|grok|gemini)-?/i, '')}` : ''}`,
    color: colors[provider] || 'bg-zinc-700 text-zinc-100',
  };
}

function renderAnswerWithChips(
  answer: string,
  sources: TurnSource[],
  onClick: (idx: number) => void,
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  const re = /\[\s*(\d+(?:\s*,\s*\d+)*|U)\s*\]/g;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(answer)) !== null) {
    if (m.index > lastIdx) parts.push(answer.slice(lastIdx, m.index));
    const raw = m[1];
    if (raw === 'U') {
      parts.push(
        <button
          key={`chip-u-${key++}`}
          onClick={() => onClick(0)}
          className="inline-flex items-baseline px-1.5 py-0.5 mx-0.5 rounded bg-sky-500/85 hover:bg-sky-400 text-sky-50 text-[10px] font-semibold ring-1 ring-sky-700/50"
          title="Uploaded document"
        >
          U
        </button>,
      );
    } else {
      const nums = raw.split(',').map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite);
      parts.push(
        <span key={`chip-${key++}`} className="inline-flex items-baseline gap-0.5 mx-0.5">
          {nums.map((n, i) => {
            const s = sources.find((src) => src.idx === n);
            const badge = providerBadge(s?.mintedByProvider, s?.mintedByModel);
            return (
              <button
                key={`c-${n}-${i}`}
                onClick={() => onClick(n)}
                className="inline-flex items-baseline px-1.5 py-0.5 rounded bg-amber-500/85 hover:bg-amber-400 text-amber-50 text-[10px] font-semibold ring-1 ring-amber-700/50"
                title={s ? `Source: ${s.title}` : `Source [${n}]`}
              >
                {n}
                {badge ? (
                  <span className={`ml-1 px-1 rounded text-[9px] ${badge.color}`}>{badge.label}</span>
                ) : null}
              </button>
            );
          })}
        </span>,
      );
    }
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < answer.length) parts.push(answer.slice(lastIdx));
  return parts;
}

export function ConversationTurn({
  turn,
  threadId,
  related,
  onAskRelated,
}: {
  turn: Turn;
  threadId: string | null;
  related: string[];
  onAskRelated: (q: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'md' | 'share' | null>(null);

  const scrollToSource = (idx: number) => {
    const el = document.getElementById(`turn-${turn.id}-source-${idx}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const copyMarkdown = useCallback(async () => {
    setExporting('md');
    const r = await lensRun<{ markdown: string }>('expert_mode', 'export_markdown', {
      query: turn.query,
      answer: turn.answer,
      sources: turn.sources,
      provider: turn.provider,
      model: turn.model,
    });
    setExporting(null);
    if (r.data.ok && r.data.result?.markdown) {
      try {
        await navigator.clipboard.writeText(r.data.result.markdown);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch { /* clipboard unavailable */ }
    }
  }, [turn]);

  const makeShareLink = useCallback(async () => {
    setExporting('share');
    const r = await lensRun<{ shareUrl: string }>('expert_mode', 'share_answer', {
      query: turn.query,
      answer: turn.answer,
      sources: turn.sources,
      provider: turn.provider,
      model: turn.model,
    });
    setExporting(null);
    if (r.data.ok && r.data.result?.shareUrl) {
      const full = window.location.origin + r.data.result.shareUrl;
      setShareUrl(full);
      try {
        await navigator.clipboard.writeText(full);
      } catch { /* clipboard unavailable — link still shown */ }
    }
  }, [turn]);

  const answerBadge = providerBadge(turn.provider, turn.model);

  return (
    <article className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h3 className="text-base font-semibold text-zinc-100">{turn.query}</h3>

      <div className="flex items-center gap-2 flex-wrap text-xs text-zinc-400">
        <span>Synthesized by</span>
        {answerBadge ? (
          <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${answerBadge.color}`}>
            {answerBadge.label}
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px] font-medium">
            Concord default (free Ollama)
          </span>
        )}
        <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[11px]">
          focus: {turn.focus}
        </span>
        {turn.webCount > 0 && (
          <span className="px-2 py-0.5 rounded bg-sky-900/50 text-sky-300 text-[11px]">
            {turn.webCount} live web
          </span>
        )}
        {turn.citationsRecorded > 0 && (
          <span className="ml-auto text-emerald-400">
            ✓ {turn.citationsRecorded} cascade citation{turn.citationsRecorded === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="text-zinc-100 leading-relaxed whitespace-pre-wrap text-[15px]">
        {renderAnswerWithChips(turn.answer, turn.sources, scrollToSource)}
      </div>

      {turn.sources.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-zinc-300 mb-2">
            Sources ({turn.sources.length})
          </h4>
          <ul className="space-y-2">
            {turn.sources.map((s) => {
              const badge = providerBadge(s.mintedByProvider, s.mintedByModel);
              return (
                <li
                  key={`${turn.id}-${s.id}`}
                  id={`turn-${turn.id}-source-${s.idx}`}
                  className="px-3 py-2 rounded-lg bg-zinc-950/70 ring-1 ring-zinc-800 text-sm"
                >
                  <div className="flex items-baseline gap-2">
                    <span
                      className={
                        'shrink-0 font-semibold ' +
                        (s.origin === 'web' ? 'text-sky-400' : 'text-amber-400')
                      }
                    >
                      [{s.idx}]
                    </span>
                    <span className="font-medium text-zinc-100 flex-1 min-w-0 truncate">
                      {s.title}
                    </span>
                    {s.origin === 'web' && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-900/60 text-sky-300">
                        web
                      </span>
                    )}
                    {badge && (
                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${badge.color}`}>
                        {badge.label}
                      </span>
                    )}
                  </div>
                  {s.snippet && (
                    <p className="mt-1 text-[11px] text-zinc-400 line-clamp-2">{s.snippet}</p>
                  )}
                  <div className="mt-1 text-[11px] text-zinc-400 flex items-center gap-2">
                    {s.origin === 'web' ? (
                      s.url ? (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-500 hover:text-sky-400 inline-flex items-center gap-1"
                        >
                          {s.sourceName || 'web'} <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span>{s.sourceName || 'web'}</span>
                      )
                    ) : (
                      <span>
                        by {s.creatorId || 'unknown'} · scope: {s.scope}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {related.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-zinc-300 mb-2 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Related questions
          </h4>
          <div className="flex flex-col gap-1.5">
            {related.map((q, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onAskRelated(q)}
                className="text-left px-3 py-2 rounded-lg bg-zinc-950/60 ring-1 ring-zinc-800 hover:ring-amber-500/50 text-[13px] text-zinc-300 hover:text-zinc-100 flex items-center gap-2"
              >
                <ListChecks className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap pt-1">
        <button
          type="button"
          onClick={copyMarkdown}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium"
        >
          {exporting === 'md' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : copied ? (
            <Check className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          {copied ? 'Copied Markdown' : 'Copy as Markdown'}
        </button>
        <button
          type="button"
          onClick={makeShareLink}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium"
        >
          {exporting === 'share' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Share2 className="w-3.5 h-3.5" />
          )}
          Share link
        </button>
        {threadId && (
          <span className="text-[10px] text-zinc-400 font-mono">thread {threadId.slice(0, 10)}…</span>
        )}
      </div>

      {shareUrl && (
        <div className="rounded border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-300 break-all">
          Share link copied: {shareUrl}
        </div>
      )}
    </article>
  );
}
