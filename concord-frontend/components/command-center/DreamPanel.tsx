'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import {
  Moon, Send
} from 'lucide-react';


export function DreamPanel() {
  const [text, setText] = useState('');
  const qc = useQueryClient();
  const submitMutation = useMutation({
    mutationFn: (body: { text: string; capturedAt: string }) => apiHelpers.dream.run({ seed: body.text }),
    onSuccess: () => { setText(''); qc.invalidateQueries({ queryKey: ['cc-meta'] }); qc.invalidateQueries({ queryKey: ['cc-dream-history'] }); },
    onError: (err) => console.error('Dream input submission failed:', err instanceof Error ? err.message : err),
  });

  // Dream history for display
  const { data: dreamHistory } = useQuery({
    queryKey: ['cc-dream-history'],
    queryFn: () => apiHelpers.dream.history(10).then(r => r.data).catch(() => ({ dreams: [] })),
    refetchInterval: 30000,
  });

  const dreams = (dreamHistory?.dreams || []) as Array<{ id: string; title: string; capturedAt?: string; convergence?: boolean; tags?: string[] }>;
  const dreamTopics = dreams.slice(0, 5).map(d => d.title).filter(Boolean);

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-purple-400 uppercase tracking-wider flex items-center gap-2">
        <Moon className="w-4 h-4" /> Dream Synthesis
      </h3>

      {/* Dream topics summary — purple/indigo styling */}
      {dreamTopics.length > 0 && (
        <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3">
          <p className="text-xs text-indigo-300 mb-2">Concord dreamed about:</p>
          <div className="flex flex-wrap gap-1.5">
            {dreamTopics.map((topic, i) => (
              <span key={i} className="px-2 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                {topic}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Dream capture input */}
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="What did you derive in your sleep?"
        className="w-full h-32 bg-lattice-deep border border-purple-500/30 rounded-lg p-3 text-sm text-white placeholder-gray-600 resize-none focus:outline-none focus:border-purple-400/50"
      />
      <button
        onClick={() => submitMutation.mutate({ text, capturedAt: new Date().toISOString() })}
        disabled={!text.trim() || submitMutation.isPending}
        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30 disabled:opacity-40 transition-colors"
      >
        <Send className="w-4 h-4" /> {submitMutation.isPending ? 'Capturing...' : 'Capture Dream'}
      </button>
      {submitMutation.isSuccess && <p className="text-xs text-purple-300 text-center">Captured. The lattice will process your dream.</p>}

      {/* Recent dream DTUs — indigo/purple styling */}
      {dreams.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-400">Recent dream DTUs</p>
          {dreams.slice(0, 5).map(d => (
            <div key={d.id} className="flex items-center gap-2 bg-indigo-500/5 border border-indigo-500/10 rounded p-2 text-xs">
              <Moon className="w-3 h-3 text-indigo-400 flex-shrink-0" />
              <span className="text-indigo-200 truncate flex-1">{d.title}</span>
              {d.convergence && <span className="text-green-400 text-[10px] flex-shrink-0">converged</span>}
              {d.capturedAt && <span className="text-gray-600 text-[10px] flex-shrink-0">{new Date(d.capturedAt).toLocaleTimeString()}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
