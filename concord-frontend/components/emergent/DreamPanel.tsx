'use client';

import { useState, useEffect } from 'react';
import { Moon, Send, Sparkles, Clock } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { getSocket } from '@/lib/realtime/socket';
import { showToast } from '@/components/common/Toasts';

interface DreamEntry {
  id: string;
  title: string;
  summary: string;
  convergence: boolean;
  capturedAt: string;
  tags: string[];
}

function DreamPanel() {
  const [text, setText] = useState('');
  const [dreams, setDreams] = useState<DreamEntry[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [lastCapture, setLastCapture] = useState<{ convergence: boolean; title: string } | null>(
    null
  );

  useEffect(() => {
    apiHelpers.dream
      .history(10)
      .then((resp) => {
        setDreams(resp.data?.dreams || []);
      })
      .catch((err) => {
        console.error('[Dream] Failed to load history:', err);
        showToast('error', 'Failed to load dream history');
      });

    const socket = getSocket();
    const handler = (data: { id: string; title: string; convergence: boolean }) => {
      setLastCapture({ convergence: data.convergence, title: data.title });
      // Refresh list
      apiHelpers.dream
        .history(10)
        .then((resp) => {
          setDreams(resp.data?.dreams || []);
        })
        .catch((err) => {
          console.error('[Dream] Failed to refresh history:', err);
          showToast('error', 'Failed to load dream history');
        });
    };
    socket.on('dream:captured', handler);
    return () => {
      socket.off('dream:captured', handler);
    };
  }, []);

  const capture = async () => {
    if (!text.trim() || text.length < 10) return;
    setCapturing(true);
    try {
      const resp = await apiHelpers.dream.capture(text.trim());
      if (resp.data?.ok) {
        setText('');
        setLastCapture({
          convergence: resp.data.convergence?.found || false,
          title: resp.data.dtu?.title || '',
        });
        // Refresh list
        const hist = await apiHelpers.dream.history(10);
        setDreams(hist.data?.dreams || []);
      }
    } catch (e) {
      console.error('[Dream] Failed to capture dream:', e);
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to capture dream' });
    }
    setCapturing(false);
  };

  return (
    <div className="panel p-4 space-y-3">
      <h3 className="font-semibold text-sm flex items-center gap-2">
        <Moon className="w-4 h-4 text-purple-400" />
        Dream Capture
      </h3>

      {/* Capture input */}
      <div className="space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Describe your derivation, insight, or dream..."
          className="w-full bg-lattice-deep border border-lattice-edge rounded px-3 py-2 text-sm resize-none h-20"
        />
        <button
          onClick={capture}
          disabled={capturing || text.length < 10}
          className="w-full bg-purple-500/10 border border-purple-500/30 rounded py-1.5 text-xs text-purple-400 hover:bg-purple-500/20 disabled:opacity-50 flex items-center justify-center gap-1"
        >
          <Send className="w-3 h-3" /> {capturing ? 'Capturing...' : 'Capture Dream'}
        </button>
      </div>

      {/* Last capture notification */}
      {lastCapture && (
        <div
          className={`rounded p-2 text-xs flex items-center gap-2 ${
            lastCapture.convergence
              ? 'bg-green-500/10 border border-green-500/30 text-green-400'
              : 'bg-purple-500/10 border border-purple-500/30 text-purple-400'
          }`}
        >
          {lastCapture.convergence ? (
            <>
              <Sparkles className="w-3 h-3" />
              Convergence detected! &ldquo;{lastCapture.title}&rdquo;
            </>
          ) : (
            <>
              <Moon className="w-3 h-3" />
              Captured: &ldquo;{lastCapture.title}&rdquo;
            </>
          )}
        </div>
      )}

      {/* Recent dreams */}
      {dreams.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500">Recent dreams</p>
          {dreams.slice(0, 5).map((d) => (
            <div
              key={d.id}
              className="bg-lattice-deep rounded p-2 text-xs flex items-center justify-between"
            >
              <div className="flex-1 truncate">
                <span className="text-gray-300">{d.title}</span>
                {d.capturedAt && (
                  <span className="text-gray-600 ml-2 flex items-center gap-0.5 inline-flex">
                    <Clock className="w-2.5 h-2.5" />
                    {new Date(d.capturedAt).toLocaleTimeString()}
                  </span>
                )}
              </div>
              {d.convergence && (
                <span className="text-green-400 flex items-center gap-1 ml-2">
                  <Sparkles className="w-3 h-3" /> converged
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedDreamPanel = withErrorBoundary(DreamPanel);
export { _WrappedDreamPanel as DreamPanel };
