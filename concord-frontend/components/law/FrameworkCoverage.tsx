'use client';

/**
 * FrameworkCoverage — real per-framework compliance-coverage analysis via
 * `law.analyze` (a genuine backend macro — keyword coverage against
 * GDPR/CCPA/DMCA/EU AI Act term lists, per-framework risk + status +
 * matched keywords). This macro had ZERO frontend callers before this
 * rebuild: the old page's "Legal Frameworks" panel showed 4 permanently
 * hardcoded framework tiles with a fixed "compliant"/"review" status that
 * never changed no matter what — a fabricated-data anti-pattern sitting
 * right next to a real analysis macro that could have powered it. This
 * replaces that with the real computation.
 *
 * Honest scope: `law.analyze` also reads `citations`/`drafts` off a real
 * persisted case artifact when called id-scoped (via `law.draft` /
 * `law.cite`) — that per-case logging isn't wired yet (see the capability
 * map's disposition for `law.draft`/`law.cite`), so this panel always
 * passes `citations: [] / drafts: []`. Coverage/risk from body-text
 * keyword matching is real; citation-backed "documented" status is not
 * yet reachable from this panel — flagged, not faked.
 */

import { useState } from 'react';
import { Landmark, Loader2, Play, AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import { useMacroDispatchFeedback } from '@/hooks/useMacroDispatchFeedback';
import { EmptyState } from '@/components/ui';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

const DEFAULT_FRAMEWORKS = ['GDPR', 'CCPA', 'DMCA', 'EU AI Act'];

interface FrameworkResult {
  framework: string;
  status: 'no_issues' | 'needs_review' | 'documented';
  risk: 'low' | 'medium' | 'high';
  coverage: number;
  matchedKeywords: string[];
  citationCount: number;
  lastChecked: string;
}
interface AnalyzeResult {
  analysis: FrameworkResult[];
  overallRisk: 'low' | 'medium' | 'high';
  totalDrafts: number;
  totalCitations: number;
}

const RISK_STYLE: Record<string, string> = {
  low: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
  medium: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
  high: 'text-rose-300 border-rose-500/30 bg-rose-500/10',
};
const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  no_issues: CheckCircle2,
  needs_review: AlertTriangle,
  documented: HelpCircle,
};

export function FrameworkCoverage() {
  const [text, setText] = useState('');
  const [frameworks, setFrameworks] = useState<string[]>(DEFAULT_FRAMEWORKS);
  const { status, error, result, dispatch } = useMacroDispatchFeedback<AnalyzeResult>();
  const busy = status === 'dispatched' || status === 'running';

  function toggleFramework(f: string) {
    setFrameworks((fs) => (fs.includes(f) ? fs.filter((x) => x !== f) : [...fs, f]));
  }

  async function analyze() {
    if (!text.trim() || frameworks.length === 0) return;
    await dispatch('law', 'analyze', { body: text, frameworks, citations: [], drafts: [] });
  }

  return (
    <div className={cn(ds.panel, 'space-y-3')}>
      <div className="flex items-center gap-2">
        <Landmark className="w-4 h-4 text-indigo-300" />
        <h2 className="font-semibold text-white">Framework Coverage Analysis</h2>
        <span className="text-[10px] text-gray-400">real keyword-coverage scoring — not a fixed status</span>
      </div>
      <p className="text-[11px] text-gray-400">
        Paste text (a policy, contract clause, or proposal) and pick frameworks — coverage, risk, and matched
        terms are computed live by <code className="text-gray-300">law.analyze</code>, never a fixed answer.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {DEFAULT_FRAMEWORKS.map((f) => (
          <button
            key={f}
            onClick={() => toggleFramework(f)}
            aria-pressed={frameworks.includes(f)}
            className={cn(
              'text-[10px] px-2 py-1 rounded border font-medium transition-colors',
              frameworks.includes(f) ? 'bg-indigo-400/20 border-indigo-400/40 text-indigo-300' : 'bg-gray-500/10 border-gray-500/30 text-gray-400 hover:bg-white/5'
            )}
          >
            {f}
          </button>
        ))}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste a policy, contract clause, or proposal to check framework coverage…"
        rows={4}
        className={cn(ds.textarea, 'text-xs font-mono py-1.5')}
      />

      <button
        onClick={analyze}
        disabled={busy || !text.trim() || frameworks.length === 0}
        className="px-3 py-1.5 text-xs rounded bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 disabled:opacity-50 inline-flex items-center gap-1.5"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
        {busy ? 'Analyzing…' : 'Analyze coverage'}
      </button>

      {status === 'error' && <p className="text-xs text-rose-400" role="alert">{error}</p>}

      {status === 'done' && result && (
        <div className="space-y-2">
          <p className="text-[11px] text-gray-400">
            Overall risk:{' '}
            <span className={cn('font-semibold uppercase', result.overallRisk === 'high' ? 'text-rose-300' : result.overallRisk === 'medium' ? 'text-amber-300' : 'text-emerald-300')}>
              {result.overallRisk}
            </span>
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {result.analysis.map((a) => {
              const Icon = STATUS_ICON[a.status] || HelpCircle;
              return (
                <div key={a.framework} className={cn('rounded-lg border p-2.5', RISK_STYLE[a.risk])}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-xs font-semibold text-white flex-1">{a.framework}</span>
                    <span className="text-[9px] uppercase tracking-wide">{a.risk} risk</span>
                  </div>
                  <p className="text-[10px] text-gray-400 mb-1">
                    {a.status.replace('_', ' ')} · {Math.round(a.coverage * 100)}% keyword coverage
                  </p>
                  {a.matchedKeywords.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {a.matchedKeywords.map((k) => (
                        <span key={k} className="text-[9px] px-1 py-0.5 rounded bg-black/30 text-gray-300">{k}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {status !== 'done' && !busy && (
        <EmptyState compact icon={<Landmark className="h-5 w-5" aria-hidden="true" />} title="No analysis run yet." description="Paste text and press Analyze coverage." ariaLabel="Framework coverage empty" />
      )}
    </div>
  );
}
