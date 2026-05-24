'use client';

import { useState } from 'react';
import { GitBranch, Check, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface BranchSeed {
  role: string;
  content: string;
  ts?: string;
}

interface Props {
  sourceThreadId: string;
  atMessageIdx: number;
  messages: BranchSeed[];
  onForked?: (branchId: string) => void;
  className?: string;
}

export function BranchForkButton({
  sourceThreadId,
  atMessageIdx,
  messages,
  onForked,
  className,
}: Props) {
  const [state, setState] = useState<'idle' | 'pending' | 'done'>('idle');

  const fork = async () => {
    if (state !== 'idle') return;
    setState('pending');
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'chat',
        action: 'branch-fork',
        input: {
          sourceThreadId,
          atMessageIdx,
          messages,
        },
      });
      const result = (res.data as { result?: { branch?: { id: string } } })?.result;
      if (result?.branch?.id) {
        setState('done');
        onForked?.(result.branch.id);
        setTimeout(() => setState('idle'), 1800);
      } else {
        setState('idle');
      }
    } catch (e) {
      console.error('[BranchForkButton] fork failed', e);
      setState('idle');
    }
  };

  return (
    <button
      type="button"
      onClick={fork}
      disabled={state === 'pending'}
      title={state === 'done' ? 'Branched' : 'Branch in new chat'}
      aria-label="Branch in new chat from this message"
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] transition',
        state === 'done'
          ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
          : 'border border-white/10 text-gray-400 hover:border-cyan-500/30 hover:text-cyan-300 hover:bg-cyan-500/5',
        className,
      )}
    >
      {state === 'pending' ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : state === 'done' ? (
        <Check className="w-3 h-3" />
      ) : (
        <GitBranch className="w-3 h-3" />
      )}
      <span>{state === 'done' ? 'Branched' : 'Branch'}</span>
    </button>
  );
}

export default BranchForkButton;
