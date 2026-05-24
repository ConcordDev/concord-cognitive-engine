'use client';

/**
 * Quick Capture Page — /capture
 *
 * Minimal, fast DTU creation. One field. One button.
 * Type anything → backend auto-detects domain, generates tags,
 * links to related DTUs, creates in local lattice.
 *
 * Also accessible via:
 *   - Floating action button (mobile)
 *   - Cmd+Shift+N shortcut (desktop)
 */

import { useState, useRef, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api/client';
import { Brain, Zap, ArrowRight, Check, Loader } from 'lucide-react';
import Link from 'next/link';

interface CaptureResult {
  ok: boolean;
  dtu?: { id: string; title?: string };
  domain?: string;
  tags?: string[];
  error?: string;
}

export default function CapturePage() {
  const router = useRouter();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<'idle' | 'capturing' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<CaptureResult | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!content.trim() || status === 'capturing') return;

    setStatus('capturing');
    try {
      const res = await api.post('/api/capture/quick', {
        content: content.trim(),
        captureType: 'thought',
      });
      const data = res.data as CaptureResult;
      if (data?.ok) {
        setResult(data);
        setStatus('done');
      } else {
        setResult(data);
        setStatus('error');
      }
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : 'Capture failed' });
      setStatus('error');
    }
  }

  function handleReset() {
    setContent('');
    setResult(null);
    setStatus('idle');
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  }

  return (
    <div className="min-h-screen bg-lattice-void flex items-center justify-center px-4">
      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-neon-cyan/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-6">
          <Link href="/" className="inline-flex items-center gap-2 mb-3">
            <Brain className="w-6 h-6 text-neon-cyan" />
            <span className="text-lg font-semibold text-white">Quick Capture</span>
          </Link>
          <p className="text-gray-400 text-sm">
            Type anything. We&apos;ll handle the rest.
          </p>
        </div>

        {status === 'done' && result?.ok ? (
          /* Success state */
          <div className="bg-lattice-surface border border-green-500/30 rounded-2xl p-8 text-center space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-green-500/10 flex items-center justify-center">
              <Check className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <p className="text-white font-medium">DTU Created</p>
              {result.domain && (
                <p className="text-gray-400 text-sm mt-1">
                  Domain: <span className="text-neon-cyan">{result.domain}</span>
                </p>
              )}
              {result.tags && result.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 justify-center mt-2">
                  {result.tags.slice(0, 6).map(tag => (
                    <span key={tag} className="px-2 py-0.5 bg-lattice-deep rounded text-xs text-gray-400">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 justify-center pt-2">
              <button
                onClick={handleReset}
                className="px-4 py-2 bg-neon-cyan/10 text-neon-cyan rounded-lg text-sm font-medium hover:bg-neon-cyan/20 transition-colors"
              >
                Capture Another
              </button>
              {result.dtu?.id && (
                <button
                  onClick={() => router.push(`/dtu/${result.dtu!.id}`)}
                  className="px-4 py-2 bg-lattice-elevated text-white rounded-lg text-sm font-medium hover:bg-lattice-border transition-colors flex items-center gap-1.5"
                >
                  View DTU <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        ) : (
          /* Capture form */
          <form onSubmit={handleSubmit} className="bg-lattice-surface border border-lattice-border rounded-2xl p-6">
            {status === 'error' && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                {result?.error || 'Capture failed. Try again.'}
              </div>
            )}

            <textarea
              ref={inputRef}
              value={content}
              onChange={e => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="TIG welding works better on aluminum than MIG..."
              rows={3}
              className="w-full bg-lattice-deep border border-lattice-border rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan/50 focus:ring-1 focus:ring-neon-cyan/30 transition-colors resize-none text-sm leading-relaxed"
              disabled={status === 'capturing'}
            />

            <div className="flex items-center justify-between mt-4">
              <span className="text-gray-600 text-xs">
                {content.length > 0 ? `${content.length} chars` : 'Cmd+Enter to submit'}
              </span>
              <button
                type="submit"
                disabled={!content.trim() || status === 'capturing'}
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-neon-cyan to-neon-blue rounded-xl text-white font-semibold text-sm hover:shadow-lg hover:shadow-neon-cyan/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {status === 'capturing' ? (
                  <><Loader className="w-4 h-4 animate-spin" /> Capturing...</>
                ) : (
                  <><Zap className="w-4 h-4" /> Capture</>
                )}
              </button>
            </div>
          </form>
        )}

        <p className="text-center text-gray-600 text-xs mt-4">
          Auto-detects domain &middot; generates tags &middot; links related DTUs
        </p>
      </div>
    </div>
  );
}
