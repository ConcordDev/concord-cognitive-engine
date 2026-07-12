'use client';

import { useState } from 'react';
import { GitBranch, Check, Loader2, AlertCircle } from 'lucide-react';
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
  /** Called when the server call fails or returns no branch — honest-failure hook. */
  onError?: (error: unknown) => void;
  className?: string;
  /** Idle-state label. Defaults to 'Branch' for back-compat. */
  label?: string;
  /** Label shown briefly after a successful fork. Defaults to 'Branched'. */
  doneLabel?: string;
  /** Tooltip / title attribute. Defaults to 'Branch in new chat'. */
  title?: string;
  /** aria-label override. Defaults to 'Branch in new chat from this message'. */
  ariaLabel?: string;
}

export function BranchForkButton({
  sourceThreadId,
  atMessageIdx,
  messages,
  onForked,
  onError,
  className,
  label = 'Branch',
  doneLabel = 'Branched',
  title,
  ariaLabel,
}: Props) {
  const [state, setState] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');

  const fork = async () => {
    if (state === 'pending') return;
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
      const result = (res.data as { result?: { branch?: { id: string } }; ok?: boolean; error?: string })?.result;
      if (result?.branch?.id) {
        setState('done');
        onForked?.(result.branch.id);
        setTimeout(() => setState('idle'), 1800);
      } else {
        console.error('[BranchForkButton] fork returned no branch', res.data);
        setState('error');
        onError?.(res.data);
        setTimeout(() => setState('idle'), 2200);
      }
    } catch (e) {
      console.error('[BranchForkButton] fork failed', e);
      setState('error');
      onError?.(e);
      setTimeout(() => setState('idle'), 2200);
    }
  };

  return (
    <button
      type="button"
      onClick={fork}
      disabled={state === 'pending'}
      title={state === 'done' ? doneLabel : state === 'error' ? 'Branch failed — try again' : (title || 'Branch in new chat')}
      aria-label={state === 'error' ? 'Branch failed, try again' : (ariaLabel || 'Branch in new chat from this message')}
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] transition',
        state === 'done'
          ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
          : state === 'error'
          ? 'border border-red-500/40 bg-red-500/10 text-red-300'
          : 'border border-white/10 text-gray-400 hover:border-cyan-500/30 hover:text-cyan-300 hover:bg-cyan-500/5',
        className,
      )}
    >
      {state === 'pending' ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : state === 'done' ? (
        <Check className="w-3 h-3" />
      ) : state === 'error' ? (
        <AlertCircle className="w-3 h-3" />
      ) : (
        <GitBranch className="w-3 h-3" />
      )}
      <span>{state === 'done' ? doneLabel : state === 'error' ? 'Retry' : label}</span>
    </button>
  );
}

export default BranchForkButton;
