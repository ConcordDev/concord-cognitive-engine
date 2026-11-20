'use client';

/**
 * Review: read every changed file against the base the proof measures from,
 * mark each one read, see the change's signals, and push. Push creates a
 * governed proposal on a NEW branch; nothing reaches GitHub until you
 * approve it here, and the approval result lists each real commit.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { ArrowLeft, Check, ExternalLink, GitBranch, UploadCloud, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BLOCKER_TEXT, ago, call, code, languageOf, type DiffHunk, type Ledger, type Proposal } from './proofApi';
import { PROOF_CODE_FONT, PROOF_DIFF_THEME } from './proofTheme';
import { StateMark } from './ProofStrip';

const MonacoDiffViewer = dynamic(() => import('../MonacoDiffViewer'), { ssr: false });

interface FileDiff { path: string; status: string; hash: string; before: string; after: string; hunks: DiffHunk[] }
interface Signals { risk?: { overallRisk: string; files: { file: string; riskLevel: string; factors: string[] }[] }; complexity: Record<string, { cyclomatic?: number; cognitive?: number; risk?: string }>; deps: string[] }

export function ReviewView({ ledger, onLedger, onBack, startPush, narrow }: { ledger: Ledger; onLedger: (l: Ledger) => void; onBack: () => void; startPush: boolean; narrow: boolean }) {
  const [selected, setSelected] = useState<string | null>(ledger.changes.find((c) => !c.reviewed)?.path || ledger.changes[0]?.path || null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signals, setSignals] = useState<Signals | null>(null);
  const [pushing, setPushing] = useState(startPush);
  const change = ledger.changes.find((c) => c.path === selected) || null;

  useEffect(() => {
    if (!selected) { setDiff(null); return; }
    let live = true;
    void (async () => {
      const r = await code<FileDiff>('proof-diff', { projectId: ledger.projectId, path: selected });
      if (!live) return;
      if (r.ok) { setDiff(r.result); setError(null); } else { setDiff(null); setError(r.message); }
    })();
    return () => { live = false; };
  }, [ledger.projectId, selected, change?.hash]);

  // Signals: measured facts about the change (churn, complexity, imports). They inform; they never gate.
  useEffect(() => {
    let live = true;
    void (async () => {
      const risk = await code<NonNullable<Signals['risk']>>('changeRiskAssessment', { changes: ledger.changes.map((c) => ({ file: c.path, linesAdded: c.additions, linesRemoved: c.deletions })) });
      const complexity: Signals['complexity'] = {};
      const deps = new Set<string>();
      for (const c of ledger.changes.filter((x) => x.code && x.status !== 'deleted').slice(0, 8)) {
        const d = await code<{ after: string }>('proof-diff', { projectId: ledger.projectId, path: c.path });
        if (!d.ok) continue;
        const language = languageOf(c.path);
        const [cx, dp] = await Promise.all([
          code<{ cyclomatic?: number; cognitive?: number; risk?: string }>('complexityAnalysis', { code: d.result.after, language }),
          code<{ dependencies?: { name: string }[] }>('dependencyAudit', { code: d.result.after, language }),
        ]);
        if (cx.ok) complexity[c.path] = cx.result;
        if (dp.ok) for (const x of dp.result.dependencies || []) deps.add(x.name);
      }
      if (live) setSignals({ risk: risk.ok ? risk.result : undefined, complexity, deps: [...deps].sort() });
    })();
    return () => { live = false; };
  }, [ledger.projectId, ledger.codeFingerprint, ledger.changes]);

  const markRead = async (reviewed: boolean) => {
    if (!diff) return;
    const r = await code<{ proof: Ledger }>('proof-review', { projectId: ledger.projectId, path: diff.path, hash: diff.hash, reviewed });
    if (!r.ok) { setError(r.message); return; }
    onLedger(r.result.proof);
    if (reviewed) {
      const next = r.result.proof.changes.find((c) => !c.reviewed);
      if (next) setSelected(next.path);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const idx = ledger.changes.findIndex((c) => c.path === selected);
      if (e.key === 'j' || e.key === 'ArrowDown') { const n = ledger.changes[Math.min(idx + 1, ledger.changes.length - 1)]; if (n) setSelected(n.path); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { const n = ledger.changes[Math.max(idx - 1, 0)]; if (n) setSelected(n.path); }
      else if (e.key === 'r' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); void markRead(!change?.reviewed); }
      else if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const reviewed = ledger.changes.filter((c) => c.reviewed).length;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="pf-review-view">
      <div className="flex h-10 flex-shrink-0 items-center gap-3 border-b pf-rule px-3">
        <button type="button" className="pf-btn pf-btn-ghost h-7 px-2" onClick={onBack}><ArrowLeft className="h-3.5 w-3.5" />Editor<span className="pf-kbd">esc</span></button>
        <h2 className="text-[13px] font-medium">Review</h2>
        <span className="pf-num text-[11px] pf-muted">{reviewed}/{ledger.changes.length} read · against {ledger.base.label}</span>
        <span className="ml-auto hidden items-center gap-2 text-[11px] pf-faint sm:flex"><span className="pf-kbd">j</span><span className="pf-kbd">k</span> move <span className="pf-kbd">r</span> mark read</span>
        <button type="button" className="pf-btn pf-btn-go h-7" disabled={!ledger.canPush} onClick={() => setPushing(true)} data-testid="pf-review-push"><UploadCloud className="h-3.5 w-3.5" />Push</button>
      </div>

      <div className={cn('flex min-h-0 flex-1', narrow && 'flex-col')}>
        <nav className={cn('pf-panel pf-scroll flex-shrink-0 overflow-y-auto border-r pf-rule', narrow ? 'max-h-40 border-b border-r-0' : 'w-64')} aria-label="Changed files">
          <ul className="py-1">
            {ledger.changes.map((c) => (
              <li key={c.path}>
                <button type="button" className="pf-row py-1.5 text-[12px]" data-active={c.path === selected ? 'true' : 'false'} onClick={() => setSelected(c.path)} data-testid="pf-review-file">
                  <StateMark s={c.reviewed ? 'proved' : 'not_run'} />
                  <span className="pf-mono min-w-0 flex-1 truncate" title={c.path}>{c.path}</span>
                  <span className="pf-num text-[10.5px]"><span className="pf-add">+{c.additions}</span> <span className="pf-del">−{c.deletions}</span></span>
                </button>
              </li>
            ))}
          </ul>
          {signals && (
            <div className="border-t pf-rule p-3 text-[11.5px]" data-testid="pf-signals">
              <p className="pf-label pb-1">Signals <span className="normal-case tracking-normal pf-faint">· inform, never gate</span></p>
              {signals.risk && <p className="pf-text-2">Change risk: <span className={cn('pf-mono', signals.risk.overallRisk === 'high' ? 'pf-fail' : signals.risk.overallRisk === 'medium' ? 'pf-stale' : '')}>{signals.risk.overallRisk}</span></p>}
              {Object.entries(signals.complexity).map(([p, c]) => (
                <p key={p} className="pf-muted"><span className="pf-mono pf-text-2">{p.split('/').pop()}</span> cyclomatic <span className="pf-num">{c.cyclomatic ?? '–'}</span>, cognitive <span className="pf-num">{c.cognitive ?? '–'}</span></p>
              ))}
              {signals.deps.length > 0 && <p className="pf-muted">Imports: <span className="pf-mono pf-text-2">{signals.deps.join(', ')}</span></p>}
            </div>
          )}
        </nav>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Diff">
          {change && (
            <div className="flex h-9 flex-shrink-0 items-center gap-2 border-b pf-rule px-3">
              <span className="pf-mono min-w-0 flex-1 truncate text-[12px]">{change.path}</span>
              <span className="text-[11px] pf-faint">{change.status}</span>
              {change.reviewed ? (
                <button type="button" className="pf-btn h-6 px-2" onClick={() => void markRead(false)} data-testid="pf-unmark-read"><Check className="h-3 w-3 pf-ok" />Read</button>
              ) : (
                <button type="button" className="pf-btn h-6 px-2" onClick={() => void markRead(true)} disabled={!diff} data-testid="pf-mark-read">Mark read<span className="pf-kbd">r</span></button>
              )}
            </div>
          )}
          {error && <p className="px-3 py-2 text-[12px] pf-fail" role="alert">{error}</p>}
          <div className="min-h-0 flex-1">
            {diff ? (
              diff.status === 'deleted' ? (
                <pre className="pf-diff pf-scroll h-full overflow-auto p-3">{diff.before.split('\n').map((l, i) => <div key={i} data-t="del">− {l}</div>)}</pre>
              ) : (
                <MonacoDiffViewer original={diff.before} modified={diff.after} language={languageOf(diff.path)} height="100%" renderSideBySide={!narrow} theme={PROOF_DIFF_THEME} fontFamily={PROOF_CODE_FONT} className="h-full" />
              )
            ) : !error && selected ? <div className="h-full animate-pulse pf-raised" role="status" aria-label="Loading diff" /> : null}
            {!selected && <p className="p-6 text-[12.5px] pf-faint">Nothing has changed against {ledger.base.label}.</p>}
          </div>
        </section>
      </div>

      {pushing && <PushDialog ledger={ledger} onClose={() => setPushing(false)} onLedger={onLedger} />}
      <Proposals />
    </div>
  );
}

function slug(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'change'; }

function PushDialog({ ledger, onClose, onLedger }: { ledger: Ledger; onClose: () => void; onLedger: (l: Ledger) => void }) {
  const [message, setMessage] = useState('');
  const [branch, setBranch] = useState(`proof/${slug(ledger.changes[0]?.path.split('/').pop()?.replace(/\.\w+$/, '') || 'change')}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [approving, setApproving] = useState(false);

  const propose = async () => {
    setBusy(true); setError(null);
    const r = await code<{ proposal: Proposal }>('proof-push', { projectId: ledger.projectId, branchName: branch.trim(), message: message.trim(), fingerprint: ledger.codeFingerprint });
    setBusy(false);
    if (!r.ok) { setError(r.message); return; }
    setProposal(r.result.proposal);
    const l = await code<{ proof: Ledger }>('proof-get', { projectId: ledger.projectId });
    if (l.ok) onLedger(l.result.proof);
  };
  const approve = async () => {
    if (!proposal) return;
    setApproving(true); setError(null);
    const r = await call<{ proposal: Proposal }>('code', 'push-proposal-approve', { id: proposal.id });
    setApproving(false);
    if (r.ok) setProposal(r.result.proposal);
    else {
      setError(r.message);
      const list = await code<{ proposals: Proposal[] }>('push-proposal-list');
      if (list.ok) setProposal(list.result.proposals.find((p) => p.id === proposal.id) || proposal);
    }
  };
  const reject = async () => {
    if (!proposal) return;
    const r = await code<{ proposal: Proposal }>('push-proposal-reject', { id: proposal.id, reason: 'Withdrawn in review' });
    if (r.ok) setProposal(r.result.proposal);
  };

  return (
    <div className="pf-scrim fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Push to GitHub" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="pf-palette w-full max-w-md p-4" data-testid="pf-push-dialog">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[14px] font-medium">Push to {ledger.remote ? `${ledger.remote.owner}/${ledger.remote.repo}` : 'GitHub'}</h3>
          <button type="button" className="rounded p-1 pf-faint hover:text-[color:var(--pf-text)]" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <ul className="mb-3 flex flex-wrap gap-x-3 gap-y-1" aria-label="Proof">
          {ledger.order.map((k) => <li key={k} className="flex items-center gap-1 text-[11.5px] pf-text-2"><StateMark s={ledger.checks[k].status} />{k}</li>)}
        </ul>
        {!proposal ? (
          <form onSubmit={(e) => { e.preventDefault(); void propose(); }} className="space-y-2">
            <label className="block text-[11.5px] pf-muted">New branch
              <input className="pf-input pf-mono mt-1" value={branch} onChange={(e) => setBranch(e.target.value)} data-testid="pf-push-branch" />
            </label>
            <label className="block text-[11.5px] pf-muted">Commit message
              <input className="pf-input mt-1" value={message} onChange={(e) => setMessage(e.target.value)} placeholder={`Update ${ledger.changes.length} file${ledger.changes.length === 1 ? '' : 's'}`} data-testid="pf-push-message" />
            </label>
            <p className="text-[11px] pf-faint">Pushes {ledger.changes.length} file{ledger.changes.length === 1 ? '' : 's'} to a new branch off <span className="pf-mono">{ledger.base.ref}</span>. Nothing is sent until you approve the next step.</p>
            {!ledger.canPush && <p className="text-[11.5px] pf-fail">{ledger.pushBlockers.map((b) => BLOCKER_TEXT[b] || b).join(' ')}</p>}
            <button type="submit" className="pf-btn pf-btn-go h-8 w-full justify-center" disabled={busy || !ledger.canPush || !branch.trim()} data-testid="pf-push-propose">{busy ? 'Preparing…' : 'Prepare push'}</button>
          </form>
        ) : (
          <div className="space-y-2" data-testid="pf-push-proposal">
            <p className="flex items-center gap-1.5 text-[12px]"><GitBranch className="h-3.5 w-3.5 pf-faint" /><span className="pf-mono">{proposal.branchName}</span><span className="pf-faint">·</span><span className="pf-text-2" data-testid="pf-push-status">{proposal.status}</span></p>
            {proposal.status === 'pending' && (
              <div className="flex gap-2">
                <button type="button" className="pf-btn pf-btn-go h-8 flex-1 justify-center" onClick={() => void approve()} disabled={approving} data-testid="pf-push-approve">{approving ? 'Pushing…' : 'Approve and push'}</button>
                <button type="button" className="pf-btn h-8" onClick={() => void reject()}>Withdraw</button>
              </div>
            )}
            {proposal.pushResult && (
              <ul className="space-y-0.5 text-[11.5px]">
                {proposal.pushResult.committed.map((c) => <li key={c.filename} className="flex items-center gap-1"><Check className="h-3 w-3 pf-ok" /><span className="pf-mono">{c.filename}</span>{c.htmlUrl && <a href={c.htmlUrl} target="_blank" rel="noreferrer" className="pf-faint hover:text-[color:var(--pf-text)]" aria-label={`Open ${c.filename} on GitHub`}><ExternalLink className="h-3 w-3" /></a>}</li>)}
                {proposal.pushResult.conflicts.map((c) => <li key={c.filename} className="pf-stale"><span className="pf-mono">{c.filename}</span>: {c.reason}</li>)}
                {proposal.pushResult.failed.map((c) => <li key={c.filename} className="pf-fail"><span className="pf-mono">{c.filename}</span>: {c.stage} — {c.error}</li>)}
                {proposal.pushResult.error && <li className="pf-fail">{proposal.pushResult.stage}: {proposal.pushResult.error}</li>}
              </ul>
            )}
          </div>
        )}
        {error && <p className="mt-2 text-[11.5px] pf-fail" role="alert">{error}</p>}
      </div>
    </div>
  );
}

/** Every push proposal you have made, with the real outcome of each. */
function Proposals() {
  const [list, setList] = useState<Proposal[] | null>(null);
  const load = useCallback(async () => { const r = await code<{ proposals: Proposal[] }>('push-proposal-list'); if (r.ok) setList(r.result.proposals); }, []);
  useEffect(() => { void load(); }, [load]);
  const pending = useMemo(() => (list || []).slice(0, 5), [list]);
  if (!pending.length) return null;
  return (
    <div className="pf-panel border-t pf-rule px-3 py-2" aria-label="Push history">
      <p className="pf-label pb-1">Pushes</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {pending.map((p) => (
          <li key={p.id} className="flex items-center gap-1.5 text-[11.5px]">
            <span className={cn('pf-mono', p.status === 'pushed' ? 'pf-ok' : ['conflict', 'push_failed', 'branch_create_failed'].includes(p.status) ? 'pf-fail' : 'pf-text-2')}>{p.status}</span>
            <span className="pf-mono pf-text-2">{p.branchName}</span>
            <span className="pf-faint">{p.repo} · {ago(p.createdAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
