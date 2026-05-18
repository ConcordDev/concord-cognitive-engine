'use client';

/**
 * DocQAPanel — Q&A surface in the right tab strip. Asks ai_qa,
 * which grounds the answer on the current doc + workspace search
 * hits and inlines [1][2] citations the user can click.
 */

import { useState, useCallback } from 'react';
import { Search, Loader2, Sparkles } from 'lucide-react';
import { callDocsMacro } from '@/lib/api/docs';

interface Source { id: string; title: string; snippet: string; }

interface Props { documentId: string; onJumpToDoc?: (docId: string) => void; }

export function DocQAPanel({ documentId, onJumpToDoc }: Props) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [source, setSource] = useState<string>('');

  const ask = useCallback(async () => {
    if (!question.trim() || busy) return;
    setBusy(true); setAnswer(''); setSources([]);
    try {
      const r = await callDocsMacro<{ answer?: string; sources?: Source[]; source?: string }>('ai_qa', {
        documentId, question: question.trim(),
      });
      if (r?.ok) {
        setAnswer(r.answer || '');
        setSources(r.sources || []);
        setSource(r.source || '');
      } else {
        setAnswer(`Couldn't answer that: ${r?.reason || 'unknown'}`);
      }
    } catch (e: unknown) {
      setAnswer(`Error: ${(e as Error)?.message || 'request failed'}`);
    } finally {
      setBusy(false);
    }
  }, [question, documentId, busy]);

  return (
    <div className="flex flex-col h-full p-3 gap-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-white/40">
        <Sparkles className="w-3.5 h-3.5" /> Ask the workspace
      </div>
      <div className="flex gap-1">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') ask(); }}
          placeholder="What is the answer to…?"
          className="flex-1 px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white placeholder-white/40 focus:outline-none focus:border-cyan-400/40"
        />
        <button
          onClick={ask}
          disabled={busy || !question.trim()}
          className="px-3 py-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
        </button>
      </div>

      {answer && (
        <div className="bg-cyan-500/5 border border-cyan-500/20 rounded p-2 text-sm text-white/90 whitespace-pre-wrap">
          {answer}
          {source && <div className="mt-1 text-[10px] text-white/40 uppercase tracking-wide">via {source}</div>}
        </div>
      )}

      {sources.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          <div className="text-xs uppercase tracking-wide text-white/40 mb-1">Sources ({sources.length})</div>
          <div className="space-y-1">
            {sources.map((s, i) => (
              <button
                key={s.id}
                onClick={() => onJumpToDoc?.(s.id)}
                className="w-full text-left p-2 rounded bg-white/5 hover:bg-white/10"
              >
                <div className="flex items-center gap-2 text-xs text-cyan-300">
                  <span className="font-mono">[{i + 1}]</span>
                  <span className="font-medium text-white truncate">{s.title}</span>
                </div>
                <div className="mt-1 text-xs text-white/50 line-clamp-2">{s.snippet}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
