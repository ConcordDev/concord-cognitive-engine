'use client';

/**
 * ComplianceScreener — real, server-computed keyword compliance check via
 * `law.check-compliance` (a genuine backend macro that had ZERO frontend
 * callers before this rebuild — the old page's "Legality Gate Tester" was
 * a client-only reimplementation of a subset of this exact logic,
 * presented as an authoritative "GATE PASSED"/"GATE BLOCKED" verdict with
 * no disclosure of how thin the check was).
 *
 * Still an honest, narrow tool: 4 deterministic keyword rules (shown below
 * in full — nothing hidden), not legal advice, not connected to a legal
 * database. What changed: the computation now runs on the real macro
 * (server/domains law's check-compliance, called generically with
 * `{ text }` — no artifact required), so this is a DESIGNED feature
 * wired to a real backend call, not a hand-duplicated client array.
 */

import { useState } from 'react';
import { ShieldQuestion, CheckCircle, XCircle, Info, Loader2, Play } from 'lucide-react';
import { useMacroDispatchFeedback } from '@/hooks/useMacroDispatchFeedback';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

const RULES: { when: string; flag: string }[] = [
  { when: 'text contains "personal data" AND "sell"', flag: 'GDPR Art. 6: Unlawful processing' },
  { when: 'text contains "copyright" AND "bypass"', flag: 'DMCA §1201: Circumvention' },
  { when: 'text contains "discriminat…"', flag: 'EU AI Act: Prohibited practice' },
  { when: 'text contains "biometric" AND "mass"', flag: 'EU AI Act Art. 5: Prohibited biometric surveillance' },
];

interface CheckComplianceResult {
  passed: boolean;
  violations: string[];
  checkedAt: string;
}

export function ComplianceScreener() {
  const [proposal, setProposal] = useState('');
  const { status, error, result, dispatch } = useMacroDispatchFeedback<CheckComplianceResult>();
  const busy = status === 'dispatched' || status === 'running';

  async function check() {
    if (!proposal.trim()) return;
    await dispatch('law', 'check-compliance', { text: proposal });
  }

  return (
    <div className={cn(ds.panel, 'space-y-3')}>
      <div className="flex items-center gap-2">
        <ShieldQuestion className="w-4 h-4 text-neon-purple" />
        <h2 className="font-semibold text-white">Compliance Keyword Screener</h2>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-300 border border-amber-400/30">illustrative — not legal advice</span>
      </div>
      <p className="text-[11px] text-gray-400 flex items-start gap-1.5">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        Real server-side check (<code className="text-gray-300">law.check-compliance</code>) against exactly 4
        keyword rules — shown in full below. Not connected to any legal database; useful only as a quick
        illustrative screen for the phrases it explicitly checks.
      </p>

      <div className="space-y-1">
        {RULES.map((r) => (
          <div key={r.flag} className="text-[10px] text-gray-400 bg-black/30 rounded px-2 py-1 font-mono">
            if {r.when} → flag &quot;{r.flag}&quot;
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={proposal}
          onChange={(e) => setProposal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void check(); }}
          placeholder="Describe a proposed action…"
          className={cn(ds.input, 'flex-1 text-sm py-1.5')}
        />
        <button
          onClick={check}
          disabled={busy || !proposal.trim()}
          className="px-3 py-1.5 text-xs rounded bg-neon-purple/20 text-neon-purple hover:bg-neon-purple/30 border border-neon-purple/40 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          Screen
        </button>
      </div>

      {status === 'error' && <p className="text-xs text-rose-400" role="alert">{error}</p>}

      {status === 'done' && result && (
        <div className={cn('p-3 rounded-lg border', result.passed ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-rose-500/10 border-rose-500/30')}>
          <div className="flex items-center gap-2 mb-1.5">
            {result.passed ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-rose-400" />}
            <span className={cn('text-sm font-semibold', result.passed ? 'text-emerald-300' : 'text-rose-300')}>
              {result.passed ? 'No rule matched' : `${result.violations.length} rule(s) matched`}
            </span>
            <span className="ml-auto text-[10px] text-gray-500 font-mono">{new Date(result.checkedAt).toLocaleTimeString()}</span>
          </div>
          {result.violations.length > 0 && (
            <ul className="text-xs space-y-1">
              {result.violations.map((r, i) => <li key={i} className="text-gray-300">• {r}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
