'use client';

import { useState } from 'react';
import { Share2, Check, Loader2, Link as LinkIcon } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Props {
  worldId: string;
  position?: { x: number; y: number; z: number } | null;
  note?: string;
  className?: string;
}

export function WorldShareButton({ worldId, position, note, className }: Props) {
  const [state, setState] = useState<'idle' | 'pending' | 'copied' | 'error'>('idle');

  const share = async () => {
    if (state === 'pending') return;
    setState('pending');
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'world',
        action: 'share-link-create',
        input: {
          worldId,
          x: position?.x,
          y: position?.y,
          z: position?.z,
          note: note || '',
        },
      });
      const link = (res.data as { result?: { link?: { url: string } } })?.result?.link;
      if (!link?.url) throw new Error('no url returned');
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const full = origin ? `${origin}${link.url}` : link.url;
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(full);
      }
      setState('copied');
      setTimeout(() => setState('idle'), 2200);
    } catch (e) {
      console.error('[WorldShareButton] share failed', e);
      setState('error');
      setTimeout(() => setState('idle'), 1800);
    }
  };

  return (
    <button
      type="button"
      onClick={share}
      disabled={state === 'pending'}
      title={
        state === 'copied'
          ? 'Link copied to clipboard'
          : state === 'error'
          ? 'Share failed'
          : 'Share this spot — copies a deep link to your clipboard'
      }
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs transition-colors',
        state === 'copied'
          ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200'
          : state === 'error'
          ? 'border-rose-500/50 bg-rose-500/10 text-rose-200'
          : 'border-cyan-500/30 bg-cyan-500/5 text-cyan-200 hover:brightness-110',
        className,
      )}
    >
      {state === 'pending' ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : state === 'copied' ? (
        <Check className="w-3 h-3" />
      ) : state === 'error' ? (
        <LinkIcon className="w-3 h-3" />
      ) : (
        <Share2 className="w-3 h-3" />
      )}
      <span>
        {state === 'copied' ? 'Copied!' : state === 'error' ? 'Failed' : 'Share spot'}
      </span>
    </button>
  );
}

export default WorldShareButton;
