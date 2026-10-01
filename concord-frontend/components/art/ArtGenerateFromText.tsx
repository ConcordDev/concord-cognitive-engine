'use client';

/**
 * Generate from Text — the art lens path to local-GPU FLUX.
 * Uses lensRun so a double-wrapped { ok, result } envelope still yields the
 * image. Walks nested result / url / imageB64 / image_b64 / png_b64.
 */

import { useCallback, useState } from 'react';
import { Download, Wand2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';

export type PickedArt = {
  url: string | null;
  provider?: string;
  watermark?: boolean;
  error?: string;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function dataUrlFromB64(b64: unknown): string | null {
  if (typeof b64 !== 'string' || b64.length < 32) return null;
  if (b64.startsWith('data:image/')) return b64;
  return `data:image/png;base64,${b64}`;
}

/** Pull a displayable image out of a lens-run payload, however nested. */
export function pickGeneratedArt(node: unknown, depth = 0): PickedArt {
  if (depth > 6 || node == null) return { url: null };
  if (typeof node === 'string') {
    if (node.startsWith('data:image/') || /^https?:\/\//.test(node)) return { url: node };
    const trimmed = node.trim();
    if (!trimmed || trimmed.toLowerCase() === 'not found') return { url: null };
    return { url: null, error: trimmed.slice(0, 280) };
  }
  const r = asRecord(node);
  if (!r) return { url: null };
  const provider = typeof r.provider === 'string' ? r.provider : undefined;
  const watermark = typeof r.watermark === 'boolean' ? r.watermark : undefined;
  const err =
    (typeof r.error === 'string' && r.error) ||
    (typeof r.reason === 'string' && r.reason) ||
    undefined;
  const direct =
    (typeof r.url === 'string' && (r.url.startsWith('data:image/') || /^https?:\/\//.test(r.url)) ? r.url : null) ||
    dataUrlFromB64(r.imageB64) ||
    dataUrlFromB64(r.image_b64) ||
    dataUrlFromB64(r.png_b64);
  if (direct) return { url: direct, provider, watermark };
  if ('result' in r && r.result != null) {
    const inner = pickGeneratedArt(r.result, depth + 1);
    return {
      url: inner.url,
      provider: inner.provider || provider,
      watermark: inner.watermark ?? watermark,
      error: inner.error || (inner.url ? undefined : err),
    };
  }
  if (r.ok === false) {
    return { url: null, provider, watermark, error: err || 'Generation failed' };
  }
  return { url: null, provider, watermark, error: err };
}

export function ArtGenerateFromText({ compact = false }: { compact?: boolean }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [art, setArt] = useState<PickedArt | null>(null);

  const generate = useCallback(async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setArt(null);
    try {
      const res = await lensRun('art', 'generate', {
        prompt: text,
        type: 'text-to-image',
        width: 768,
        height: 768,
      });
      const data = res.data;
      if (!data?.ok) {
        const msg = data?.error || 'Generation failed';
        setError(msg === 'not found' || msg === 'unknown_macro'
          ? `Art generate unavailable (${msg}). The image service did not return a picture.`
          : msg);
        return;
      }
      const picked = pickGeneratedArt(data.result);
      if (!picked.url) {
        setError(picked.error && picked.error.toLowerCase() !== 'not found'
          ? picked.error
          : 'The art service answered without an image. No picture to show.');
        return;
      }
      setArt(picked);
      const wm = picked.watermark === false ? 'watermark off' : picked.watermark === true ? 'watermark on' : null;
      useUIStore.getState().addToast({
        type: 'success',
        message: ['Art ready', picked.provider, wm].filter(Boolean).join(' · '),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setBusy(false);
    }
  }, [prompt, busy]);

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3 rounded-xl border border-white/10 bg-black/40 p-4'}>
      {!compact && (
        <div>
          <h3 className="text-sm font-semibold text-white">Generate from Text</h3>
          <p className="text-xs text-gray-400 mt-0.5">Local GPU image. The picture renders here when the service returns one.</p>
        </div>
      )}
      <input
        type="text"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void generate(); }}
        placeholder="Describe artwork to generate..."
        aria-label="Artwork prompt"
        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:border-violet-400/50"
      />
      <button
        type="button"
        onClick={() => void generate()}
        disabled={busy || !prompt.trim()}
        className="w-full flex items-center gap-2 px-3 py-2 bg-violet-500/15 text-violet-200 rounded-lg text-xs hover:bg-violet-500/25 disabled:opacity-50"
      >
        {busy ? (
          <span className="w-4 h-4 border-2 border-violet-300 border-t-transparent rounded-full animate-spin" />
        ) : (
          <Wand2 className="w-4 h-4" />
        )}
        {busy ? 'Generating...' : 'Generate from Text'}
      </button>
      {error && <p className="text-xs text-red-400 px-1">{error}</p>}
      {art?.url && (
        <div className="p-2 rounded-lg bg-violet-500/5 border border-violet-400/20 space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={art.url} alt="Generated art" className="w-full rounded-md border border-white/10" />
          <p className="text-[10px] text-gray-400">
            {art.provider || 'image'}
            {art.watermark === false ? ' · watermark false' : art.watermark === true ? ' · watermark true' : ''}
          </p>
          <button
            type="button"
            onClick={() => {
              const a = document.createElement('a');
              a.href = art.url!;
              a.download = 'ai-art.png';
              a.click();
            }}
            className="flex items-center gap-1 px-2 py-1 text-xs text-violet-200 hover:bg-violet-500/10 rounded"
          >
            <Download className="w-3 h-3" /> Download
          </button>
        </div>
      )}
    </div>
  );
}
