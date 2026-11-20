'use client';

/** One AI proposal, file by file: the diff against what is in the project now, and Accept or Discard. */

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { ArrowLeft, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { languageOf } from './proofApi';
import { PROOF_CODE_FONT, PROOF_DIFF_THEME } from './proofTheme';
import type { AgentApi, AiProposal } from './AgentPane';

const MonacoDiffViewer = dynamic(() => import('../MonacoDiffViewer'), { ssr: false });

const ORIGIN: Record<AiProposal['origin'], string> = { change: 'Project change', edit: 'File edit', refactor: 'Refactor', tests: 'Tests', draft: 'New file (built)', generate: 'New file (template)' };

export function ProposalView({ proposal, agent, onBack, narrow }: { proposal: AiProposal; agent: AgentApi; onBack: () => void; narrow: boolean }) {
  const [file, setFile] = useState(proposal.edits[0]?.path || '');
  const [busy, setBusy] = useState(false);
  const edit = proposal.edits.find((e) => e.path === file) || proposal.edits[0];
  const open = proposal.status === 'open';
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="pf-proposal-view">
      <div className="flex min-h-10 flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b pf-rule px-3 py-1.5">
        <button type="button" className="pf-btn pf-btn-ghost h-7 px-2" onClick={onBack}><ArrowLeft className="h-3.5 w-3.5" />Editor</button>
        <span className="pf-label">{ORIGIN[proposal.origin]}</span>
        <h2 className="min-w-0 flex-1 truncate text-[13px]">{proposal.title}</h2>
        {open ? (
          <span className="flex gap-1.5">
            <button type="button" className="pf-btn h-7" onClick={async () => { setBusy(true); await agent.discard(proposal.id); setBusy(false); onBack(); }} disabled={busy} data-testid="pf-proposal-discard"><X className="h-3.5 w-3.5" />Discard</button>
            <button type="button" className="pf-btn h-7 border-[var(--pf-text-2)]" onClick={async () => { setBusy(true); await agent.accept(proposal.id); setBusy(false); }} disabled={busy} data-testid="pf-proposal-accept"><Check className="h-3.5 w-3.5" />Accept {proposal.edits.length > 1 ? `${proposal.edits.length} files` : ''}</button>
          </span>
        ) : (
          <span className={cn('pf-mono text-[11px]', proposal.status === 'accepted' ? 'pf-ok' : proposal.status === 'conflict' ? 'pf-fail' : 'pf-faint')} data-testid="pf-proposal-status">{proposal.status}</span>
        )}
      </div>
      {(proposal.evidence || proposal.note) && (
        <p className="border-b pf-rule px-3 py-1.5 text-[11.5px] pf-muted">{proposal.note || proposal.evidence}</p>
      )}
      {proposal.edits.length > 1 && (
        <div className="pf-scroll flex flex-shrink-0 gap-0 overflow-x-auto border-b pf-rule" role="tablist" aria-label="Files in this proposal">
          {proposal.edits.map((e) => (
            <button key={e.path} type="button" role="tab" aria-selected={e.path === edit?.path} className="pf-tab pf-mono" data-active={e.path === edit?.path ? 'true' : 'false'} onClick={() => setFile(e.path)}>{e.path}{e.before === null && <span className="pf-add text-[10px]">new</span>}</button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {edit && <MonacoDiffViewer original={edit.before ?? ''} modified={edit.after} language={languageOf(edit.path)} height="100%" renderSideBySide={!narrow} theme={PROOF_DIFF_THEME} fontFamily={PROOF_CODE_FONT} className="h-full" />}
      </div>
    </div>
  );
}
