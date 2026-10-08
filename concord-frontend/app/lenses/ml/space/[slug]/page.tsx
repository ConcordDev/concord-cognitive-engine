'use client';

/**
 * ML Space: a shareable demo of one hosted model (Hugging Face Spaces style).
 * Loads the space with ml.space-get and runs real inference through
 * ml.playground-infer; failures are shown as returned, never filled in.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, Play, Eye } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { lensRun } from '@/lib/api/client';

interface Space {
  id: string; title: string; modelId: string; description: string;
  sdk: string; task: string; visibility: string; views: number; createdAt: string;
}

export default function MlSpacePage() {
  const params = useParams<{ slug: string }>();
  const slug = (params?.slug as string) || '';
  const [space, setSpace] = useState<Space | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<{ ok: boolean; text: string; latencyMs?: number } | null>(null);

  useEffect(() => {
    let alive = true;
    lensRun<{ space: Space }>('ml', 'space-get', { slug })
      .then((r) => {
        if (!alive) return;
        if (r.data?.ok && r.data.result?.space) setSpace(r.data.result.space);
        else setLoadError(r.data?.error || 'Space not found');
      })
      .catch(() => { if (alive) setLoadError('Could not load this space'); });
    return () => { alive = false; };
  }, [slug]);

  const run = useCallback(async () => {
    if (!space || !input.trim()) return;
    setBusy(true);
    setOutput(null);
    try {
      const r = await lensRun<{ output: unknown; latencyMs: number }>('ml', 'playground-infer', { modelId: space.modelId, input: input.trim() });
      setOutput(r.data?.ok && r.data.result
        ? { ok: true, text: JSON.stringify(r.data.result.output, null, 2), latencyMs: r.data.result.latencyMs }
        : { ok: false, text: r.data?.error || 'Inference failed' });
    } catch {
      setOutput({ ok: false, text: 'Inference request failed' });
    } finally {
      setBusy(false);
    }
  }, [space, input]);

  return (
    <LensShell lensId="ml" asMain={false}>
      <NorthStarFrame
        lensId="ml"
        crumb="ML · Space"
        title={space?.title || (loadError ? 'Space unavailable' : 'Opening space')}
        subtitle={space ? `${space.modelId} · ${space.task}` : undefined}
      >
        {!space && !loadError && (
          <p role="status" className="flex items-center gap-2 text-sm text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
        )}
        {loadError && <p role="alert" className="text-sm text-rose-300">{loadError}</p>}
        {space && (
          <div className="max-w-3xl space-y-4 rounded-2xl border border-white/10 bg-zinc-950 p-5">
            {space.description && <p className="text-sm text-zinc-300">{space.description}</p>}
            <p className="flex items-center gap-3 text-xs text-zinc-500">
              <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> {space.views} views</span>
              <span>{space.visibility}</span>
              <span>Runs on the hosted Hugging Face inference API</span>
            </p>
            <label className="block text-xs text-zinc-400" htmlFor="space-input">Input</label>
            <textarea
              id="space-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-white/10 bg-black/40 p-3 text-sm text-zinc-100"
              placeholder="Type something for the model"
            />
            <button
              type="button"
              onClick={() => void run()}
              disabled={busy || !input.trim()}
              className="inline-flex items-center gap-2 rounded-full bg-teal-400 px-5 py-2 text-sm font-medium text-black disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run
            </button>
            {output && (
              <pre
                role={output.ok ? undefined : 'alert'}
                className={`max-h-80 overflow-auto rounded-lg bg-black/50 p-3 text-xs ${output.ok ? 'text-zinc-200' : 'text-rose-300'}`}
              >
                {output.text}{output.ok && output.latencyMs != null ? `\n\n(${output.latencyMs} ms)` : ''}
              </pre>
            )}
          </div>
        )}
      </NorthStarFrame>
    </LensShell>
  );
}
