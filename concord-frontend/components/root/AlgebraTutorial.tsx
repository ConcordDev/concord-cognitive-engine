'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { GraduationCap, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Example { input: string; glyph: string; decimal: number | null; reading: string; }
interface Lesson { id: string; title: string; body: string; examples: Example[]; }
interface TutorialResult { lessons: Lesson[]; lessonCount: number; }

/* Algebra tutorial / worked examples — calls root.tutorial. Every example's
   numbers are computed server-side from the real algebra primitives, so the
   lesson can never drift from the implementation. */
export function AlgebraTutorial() {
  const [data, setData] = useState<TutorialResult | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const r = await lensRun<TutorialResult>('root', 'tutorial', {});
    setLoading(false);
    if (r.data?.ok && r.data.result) {
      setData(r.data.result);
      setOpen(new Set(r.data.result.lessons.slice(0, 1).map((l) => l.id)));
    } else setError(r.data?.error || 'Could not load tutorial');
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = useCallback((id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  return (
    <section className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <div className="flex items-center gap-2 mb-3">
        <GraduationCap className="w-4 h-4 text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Algebra Tutorial</h2>
      </div>
      {loading && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading worked examples…
        </div>
      )}
      {error && <div className="text-xs text-red-400">{error}</div>}
      {!loading && !error && (!data || data.lessons.length === 0) && (
        <div className="text-xs text-gray-500">No lessons yet.</div>
      )}
      {data && data.lessons.length > 0 && (
        <div className="space-y-2">
          {data.lessons.map((lesson) => {
            const isOpen = open.has(lesson.id);
            return (
              <div key={lesson.id} className="bg-gray-800/60 rounded-lg border border-gray-800">
                <button
                  onClick={() => toggle(lesson.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left">
                  {isOpen ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
                  <span className="text-sm text-gray-200">{lesson.title}</span>
                </button>
                {isOpen && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-3 pb-3 space-y-2">
                    <p className="text-xs text-gray-400 leading-relaxed">{lesson.body}</p>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {lesson.examples.map((ex, i) => (
                        <div key={i} className="bg-gray-900 rounded-lg p-2.5 border border-gray-800">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 font-mono">{ex.input}</span>
                            <span className="text-gray-600">→</span>
                            <span className="text-lg text-violet-300">{ex.glyph}</span>
                            {ex.decimal !== null && (
                              <span className="text-xs text-emerald-300">= {ex.decimal}</span>
                            )}
                          </div>
                          <div className="text-[11px] text-violet-400/80 italic mt-1">{ex.reading}</div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
