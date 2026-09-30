'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { motion } from 'framer-motion';
import { Sparkles, Loader2, CheckCircle2 } from 'lucide-react';

type CreativeKind = 'image' | 'text' | 'melody';

export function CreativePanel() {
  const [creativePrompt, setCreativePrompt] = useState('');
  const [creativeKind, setCreativeKind] = useState<CreativeKind>('text');
  const [creativeResult, setCreativeResult] = useState<unknown>(null);
  const generateCreative = useMutation({
    mutationFn: async () => {
      const r = await apiHelpers.lens.runDomain('creative', 'generate', {
        kind: creativeKind,
        prompt: creativePrompt,
      });
      return r.data?.result ?? r.data;
    },
    onSuccess: (data) => setCreativeResult(data),
    onError: (err) => setCreativeResult({ error: (err as Error).message }),
  });

  return (
    <div className="rounded-lg border border-pink-900/40 bg-pink-950/10 p-4">
      <h3 className="mb-2 text-sm font-semibold text-pink-300">Creative generation</h3>
      <div className="mb-3 flex gap-1 rounded border border-pink-900/40 bg-pink-950/30 p-0.5 text-xs">
        {(['text', 'image', 'melody'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setCreativeKind(k)}
            aria-pressed={creativeKind === k}
            className={`rounded px-2 py-1 ${
              creativeKind === k ? 'bg-pink-700/40 text-pink-100' : 'text-pink-600 hover:text-pink-400'
            }`}
          >
            {k}
          </button>
        ))}
      </div>
      <textarea
        value={creativePrompt}
        onChange={(e) => setCreativePrompt(e.target.value)}
        className="h-24 w-full rounded border border-pink-900/40 bg-black/40 p-2 font-mono text-sm text-pink-100 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500"
        placeholder={`Describe the ${creativeKind} you want generated…`}
        aria-label="Creative prompt"
      />
      <div className="mt-3 flex justify-end">
        <button
          onClick={() => generateCreative.mutate()}
          disabled={!creativePrompt || generateCreative.isPending}
          className="inline-flex items-center gap-2 rounded bg-pink-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-pink-500 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-pink-400"
        >
          {generateCreative.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}{' '}
          Generate
        </button>
      </div>
      {creativeResult != null && (
        <motion.pre
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-4 max-h-80 overflow-auto rounded border border-pink-900/40 bg-black/60 p-3 font-mono text-[11px] text-pink-300"
        >
          {JSON.stringify(creativeResult, null, 2)}
        </motion.pre>
      )}
      {generateCreative.isSuccess && (
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-400">
          <CheckCircle2 className="h-3 w-3" aria-hidden /> Generated
        </p>
      )}
    </div>
  );
}
