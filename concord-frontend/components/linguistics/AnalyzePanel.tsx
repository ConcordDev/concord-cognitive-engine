'use client';

/**
 * AnalyzePanel — quick morphosyntactic analysis via linguistics.analyze.
 * Extracted from the linguistics page thin-shell consolidation.
 */

import { useCallback, useState } from 'react';
import { Sparkles, Type, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

export function AnalyzePanel() {
  const [analyzeText, setAnalyzeText] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState<string | null>(null);

  const handleAnalyze = useCallback(async () => {
    if (!analyzeText.trim()) return;
    setAnalyzing(true);
    setAnalyzeResult(null);
    try {
      // lensRun unwraps the { ok, result } envelope so data.result is the macro's
      // payload directly (raw api.post leaves it double-wrapped → blank/JSON render).
      const res = await lensRun({
        domain: 'linguistics',
        action: 'analyze',
        input: { text: analyzeText.trim(), type: 'morphosyntactic' },
      });
      const data = res.data;
      const content = typeof data?.result === 'string'
        ? data.result
        : typeof data?.result?.content === 'string'
          ? data.result.content
          : JSON.stringify(data?.result ?? data, null, 2);
      setAnalyzeResult(content);
    } catch {
      setAnalyzeResult('Analysis unavailable. Try again later.');
    } finally {
      setAnalyzing(false);
    }
  }, [analyzeText]);

  return (
    <div className="p-4 bg-lattice-surface border border-lattice-border rounded-xl space-y-3">
      <div className="flex items-center gap-2">
        <Type className="w-5 h-5 text-pink-400" />
        <h2 className="text-sm font-semibold text-white">Quick Analysis</h2>
      </div>
      <div className="flex gap-3">
        <input
          type="text"
          value={analyzeText}
          onChange={e => setAnalyzeText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
          placeholder="Enter text for linguistic analysis..."
          className="flex-1 px-4 py-2.5 bg-lattice-deep border border-lattice-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-pink-400 text-sm"
        />
        <button
          type="button"
          onClick={handleAnalyze}
          disabled={analyzing || !analyzeText.trim()}
          className="flex items-center gap-2 px-5 py-2.5 bg-pink-400/20 text-pink-400 rounded-lg text-sm font-medium hover:bg-pink-400/30 disabled:opacity-50 transition-colors whitespace-nowrap"
        >
          {analyzing ? (
            <span className="w-4 h-4 border-2 border-pink-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          {analyzing ? 'Analyzing...' : 'Analyze'}
        </button>
      </div>
      {analyzeResult && (
        <div className="p-4 rounded-lg bg-lattice-deep border border-lattice-border">
          <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed max-h-48 overflow-auto">
            {analyzeResult}
          </div>
          <button type="button" onClick={() => setAnalyzeResult(null)} className="mt-2 text-xs text-gray-400 hover:text-white">
            <X className="w-3 h-3 inline mr-1" /> Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
