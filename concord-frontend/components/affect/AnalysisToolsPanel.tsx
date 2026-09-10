'use client';

/**
 * AnalysisToolsPanel — VAD/NLP macros over real journal notes (never ATS 7D).
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Sparkles, Loader2, Search, MessageSquare, Activity, Hand,
  ArrowUpRight, ArrowDownRight, ArrowRight,
  Heart, AlertTriangle, Clock, TrendingUp, TrendingDown, Users, Brain, RefreshCw,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';

export function AnalysisToolsPanel() {
  // panel-owned analysis macros

  const [isRunning, setIsRunning] = useState<string | null>(null);
  const [sentimentResult, setSentimentResult] = useState<Record<string, unknown> | null>(null);
  const [timelineResult, setTimelineResult] = useState<Record<string, unknown> | null>(null);
  const [empathyResult, setEmpathyResult] = useState<Record<string, unknown> | null>(null);
  const [patternResult, setPatternResult] = useState<Record<string, unknown> | null>(null);
  const [analysisText, setAnalysisText] = useState('');

  const { data: checkinHistoryResult } = useQuery({
    queryKey: ['affect-checkin-history-for-analysis'],
    queryFn: () =>
      lensRun<{ entries?: Array<{ id: string; note: string; promptAnswer: string; createdAt: string }> }>(
        'affect',
        'checkinHistory',
        { limit: 200 }
      ).then((r) => r.data.result),
    staleTime: 15000,
  });

  const journalEntries = useMemo(() => {
    const entries = checkinHistoryResult?.entries || [];
    return entries
      .map((e) => ({
        id: e.id,
        text: [e.note, e.promptAnswer].filter((s) => typeof s === 'string' && s.trim()).join('. ').trim(),
        timestamp: e.createdAt,
      }))
      .filter((e) => e.text.length > 0)
      .reverse();
  }, [checkinHistoryResult]);

  const runSentimentAnalysis = async () => {
    const text = analysisText.trim() || journalEntries.map((e) => e.text).join('. ');
    if (!text) {
      setSentimentResult({ message: 'No text provided for sentiment analysis.' });
      return;
    }
    setIsRunning('sentimentAnalysis');
    try {
      const r = await lensRun<Record<string, unknown>>('affect', 'sentimentAnalysis', { text });
      setSentimentResult(r.data.ok && r.data.result ? r.data.result : { message: r.data.error || 'Analysis failed' });
    } catch (e) {
      setSentimentResult({ message: e instanceof Error ? e.message : 'Analysis failed' });
    }
    setIsRunning(null);
  };

  const runEmotionTimeline = async () => {
    if (journalEntries.length === 0) {
      setTimelineResult({ message: 'No journal entries yet. Log a few mood check-ins with notes (Mood tab) to trace an emotional arc.' });
      return;
    }
    setIsRunning('emotionTimeline');
    try {
      const r = await lensRun<Record<string, unknown>>('affect', 'emotionTimeline', { entries: journalEntries });
      setTimelineResult(r.data.ok && r.data.result ? r.data.result : { message: r.data.error || 'Timeline build failed' });
    } catch (e) {
      setTimelineResult({ message: e instanceof Error ? e.message : 'Timeline build failed' });
    }
    setIsRunning(null);
  };

  const runEmpathyMap = async () => {
    if (journalEntries.length === 0) {
      setEmpathyResult({ message: 'No journal entries yet. Log a few mood check-ins with notes (Mood tab) to build an empathy map.' });
      return;
    }
    setIsRunning('empathyMap');
    try {
      const feedback = journalEntries.map((e) => ({ userId: 'self', text: e.text, context: e.timestamp }));
      const r = await lensRun<Record<string, unknown>>('affect', 'empathyMap', { feedback });
      setEmpathyResult(r.data.ok && r.data.result ? r.data.result : { message: r.data.error || 'Empathy map failed' });
    } catch (e) {
      setEmpathyResult({ message: e instanceof Error ? e.message : 'Empathy map failed' });
    }
    setIsRunning(null);
  };

  const runDetectPatterns = async () => {
    if (journalEntries.length === 0) {
      setPatternResult({ message: 'No journal entries yet. Log a few mood check-ins with notes (Mood tab) to detect patterns.' });
      return;
    }
    setIsRunning('detect-patterns');
    try {
      const r = await lensRun<Record<string, unknown>>('affect', 'detect-patterns', { entries: journalEntries });
      setPatternResult(r.data.ok && r.data.result ? r.data.result : { message: r.data.error || 'Pattern detection failed' });
    } catch (e) {
      setPatternResult({ message: e instanceof Error ? e.message : 'Pattern detection failed' });
    }
    setIsRunning(null);
  };

  return (
        <div className="space-y-6">
          {/* Intro */}
          <div className="panel p-4 space-y-3">
            <h2 className="font-semibold mb-1 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-neon-pink" />
              Affect Analysis Engine
            </h2>
            <p className="text-sm text-gray-400">
              Real NLP tools (VAD sentiment scoring, emotional-arc detection, empathy mapping,
              pattern/trigger detection) run against your own words &mdash; either pasted below,
              or your recent mood check-in notes &amp; journal answers (Mood tab).
            </p>
            <div>
              <label className="text-xs text-gray-400 block mb-1">
                Text to analyze (optional &mdash; leave blank to use your journal notes)
              </label>
              <textarea
                value={analysisText}
                onChange={(e) => setAnalysisText(e.target.value)}
                rows={2}
                placeholder="Paste or type text here for Sentiment Analysis…"
                className="input-lattice w-full text-sm resize-none"
              />
            </div>
            <p className="text-xs text-gray-400">
              {journalEntries.length > 0
                ? `${journalEntries.length} journal entr${journalEntries.length === 1 ? 'y' : 'ies'} with notes available for Timeline / Empathy Map / Pattern Detection.`
                : 'No journal entries with notes yet — log a mood check-in with a note (Mood tab) to power Timeline / Empathy Map / Pattern Detection.'}
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* --- Sentiment Analysis Panel --- */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="panel p-4 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold flex items-center gap-2">
                  <Heart className="w-4 h-4 text-pink-400" />
                  Sentiment Analysis
                </h2>
                <button
                  onClick={runSentimentAnalysis}
                  disabled={isRunning !== null || (!analysisText.trim() && journalEntries.length === 0)}
                  className="btn-neon text-xs flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isRunning === 'sentimentAnalysis' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Heart className="w-3.5 h-3.5" />
                  )}
                  {isRunning === 'sentimentAnalysis' ? 'Analyzing...' : 'Analyze Sentiment'}
                </button>
              </div>
              <p className="text-xs text-gray-400">
                Multi-dimensional VAD (Valence-Arousal-Dominance) sentiment scoring with sarcasm detection and emotion classification.
              </p>

              {sentimentResult && !('message' in sentimentResult) ? (
                <div className="space-y-3">
                  {/* Sentiment Label & Primary Emotion */}
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-bold uppercase px-3 py-1 rounded-full ${
                      sentimentResult.sentimentLabel === 'positive'
                        ? 'bg-green-500/20 text-green-400'
                        : sentimentResult.sentimentLabel === 'negative'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-gray-500/20 text-gray-400'
                    }`}>
                      {String(sentimentResult.sentimentLabel)}
                    </span>
                    <span className="text-xs text-gray-400">Primary:</span>
                    <span className="text-sm font-medium text-neon-cyan capitalize">
                      {String(sentimentResult.primaryEmotion)}
                    </span>
                    {!!sentimentResult.isMixedEmotion && (
                      <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full">
                        Mixed
                      </span>
                    )}
                  </div>

                  {/* VAD Scores */}
                  <div className="space-y-2">
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">VAD Model Scores</p>
                    {(() => {
                      const vad = sentimentResult.vad as Record<string, number> | undefined;
                      if (!vad) return null;
                      const dims = [
                        { key: 'valence', label: 'Valence', color: 'bg-pink-500', desc: 'Positive vs Negative' },
                        { key: 'arousal', label: 'Arousal', color: 'bg-orange-500', desc: 'Calm vs Excited' },
                        { key: 'dominance', label: 'Dominance', color: 'bg-purple-500', desc: 'Submissive vs Dominant' },
                      ];
                      return dims.map((d) => (
                        <div key={d.key} className="flex items-center gap-3">
                          <span className="text-xs text-gray-400 w-20">{d.label}</span>
                          <div className="flex-1 h-2 bg-lattice-deep rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${(vad[d.key] || 0) * 100}%` }}
                              transition={{ duration: 0.5 }}
                              className={`h-full rounded-full ${d.color}`}
                            />
                          </div>
                          <span className="text-xs font-mono text-gray-300 w-12 text-right">
                            {((vad[d.key] || 0) * 100).toFixed(1)}%
                          </span>
                        </div>
                      ));
                    })()}
                  </div>

                  {/* Stats Row */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="lens-card text-center">
                      <p className="text-xs text-gray-400">Tokens</p>
                      <p className="text-sm font-mono font-bold">{String(sentimentResult.tokenCount)}</p>
                    </div>
                    <div className="lens-card text-center">
                      <p className="text-xs text-gray-400">Matched</p>
                      <p className="text-sm font-mono font-bold">{String(sentimentResult.matchedTokens)}</p>
                    </div>
                    <div className="lens-card text-center">
                      <p className="text-xs text-gray-400">Coverage</p>
                      <p className="text-sm font-mono font-bold">{String(sentimentResult.coverage)}%</p>
                    </div>
                  </div>

                  {/* Emotion Keywords */}
                  {Array.isArray(sentimentResult.emotionHits) && (sentimentResult.emotionHits as Array<Record<string, unknown>>).length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 font-medium mb-2">Detected Emotion Words</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(sentimentResult.emotionHits as Array<Record<string, unknown>>).slice(0, 20).map((hit, i) => (
                          <span
                            key={i}
                            className={`text-xs px-2 py-0.5 rounded-full font-mono ${
                              (hit.valence as number) >= 0.65
                                ? 'bg-green-500/15 text-green-400'
                                : (hit.valence as number) <= 0.35
                                  ? 'bg-red-500/15 text-red-400'
                                  : 'bg-gray-500/15 text-gray-400'
                            } ${hit.negated ? 'line-through opacity-60' : ''}`}
                          >
                            {String(hit.word)}
                            {!!hit.negated && <span className="ml-1 text-yellow-400 no-underline">(neg)</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Sarcasm Indicators */}
                  {Array.isArray(sentimentResult.sarcasmIndicators) && (sentimentResult.sarcasmIndicators as Array<Record<string, unknown>>).length > 0 && (
                    <div className="p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/15">
                      <p className="text-xs font-medium text-yellow-400 mb-1.5 flex items-center gap-1.5">
                        <AlertTriangle className="w-3 h-3" />
                        Sarcasm Detected ({String(sentimentResult.sarcasmLikelihood)} likelihood)
                      </p>
                      {(sentimentResult.sarcasmIndicators as Array<Record<string, unknown>>).map((ind, i) => (
                        <p key={i} className="text-xs text-gray-400 ml-5">
                          {String(ind.detail)}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ) : sentimentResult && 'message' in sentimentResult ? (
                <p className="text-sm text-gray-400 py-4 text-center">{String(sentimentResult.message)}</p>
              ) : (
                <div className="text-center py-6 text-gray-600">
                  <Heart className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">Click &quot;Analyze Sentiment&quot; to run VAD analysis</p>
                </div>
              )}
            </motion.div>

            {/* --- Emotion Timeline Panel --- */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="panel p-4 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold flex items-center gap-2">
                  <Clock className="w-4 h-4 text-neon-green" />
                  Emotion Timeline
                </h2>
                <button
                  onClick={runEmotionTimeline}
                  disabled={isRunning !== null || journalEntries.length === 0}
                  className="btn-neon text-xs flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isRunning === 'emotionTimeline' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Clock className="w-3.5 h-3.5" />
                  )}
                  {isRunning === 'emotionTimeline' ? 'Tracking...' : 'Build Timeline'}
                </button>
              </div>
              <p className="text-xs text-gray-400">
                Track emotional valence changes over time. Detects emotional arcs (rags-to-riches, tragedy, etc.) and turning points.
              </p>

              {timelineResult && !('message' in timelineResult) ? (
                <div className="space-y-4">
                  {/* Arc Type & Summary */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-bold uppercase px-3 py-1 rounded-full bg-neon-green/20 text-neon-green">
                      {String(timelineResult.arcType).replace(/-/g, ' ')}
                    </span>
                    <span className="text-xs text-gray-400">
                      {String(timelineResult.entryCount)} entries analyzed
                    </span>
                    <span className="text-xs text-gray-400">
                      Volatility: <span className="font-mono text-gray-300">{String(timelineResult.volatility)}</span>
                    </span>
                  </div>

                  {/* Mini Timeline Chart */}
                  {Array.isArray(timelineResult.smoothedValence) && (timelineResult.smoothedValence as number[]).length > 1 && (
                    <div className="bg-lattice-deep rounded-lg p-3">
                      <p className="text-xs text-gray-400 mb-2">Smoothed Valence Over Time</p>
                      <div className="h-24 flex items-end gap-[2px]">
                        {(timelineResult.smoothedValence as number[]).map((val, i) => {
                          const normalized = (val + 1) / 2; // -1..1 -> 0..1
                          const height = Math.max(4, normalized * 100);
                          return (
                            <div
                              key={i}
                              className="flex-1 rounded-t transition-all"
                              style={{
                                height: `${height}%`,
                                backgroundColor: val > 0.15
                                  ? 'rgba(74, 222, 128, 0.6)'
                                  : val < -0.15
                                    ? 'rgba(248, 113, 113, 0.6)'
                                    : 'rgba(156, 163, 175, 0.4)',
                              }}
                              title={`Entry ${i}: ${val.toFixed(3)}`}
                            />
                          );
                        })}
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-[10px] text-gray-400">Start</span>
                        <span className="text-[10px] text-gray-400">End</span>
                      </div>
                    </div>
                  )}

                  {/* Arc Segments */}
                  {!!timelineResult.arcSegments && (
                    <div className="grid grid-cols-3 gap-2">
                      {Object.entries(timelineResult.arcSegments as Record<string, number>).map(([seg, val]) => {
                        const arrow = val > 0.1
                          ? <ArrowUpRight className="w-3.5 h-3.5 text-green-400" />
                          : val < -0.1
                            ? <ArrowDownRight className="w-3.5 h-3.5 text-red-400" />
                            : <ArrowRight className="w-3.5 h-3.5 text-gray-400" />;
                        return (
                          <div key={seg} className="lens-card text-center">
                            <p className="text-xs text-gray-400 capitalize">{seg}</p>
                            <div className="flex items-center justify-center gap-1">
                              {arrow}
                              <span className={`text-sm font-mono font-bold ${
                                val > 0.1 ? 'text-green-400' : val < -0.1 ? 'text-red-400' : 'text-gray-400'
                              }`}>
                                {val.toFixed(3)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Turning Points */}
                  {Array.isArray(timelineResult.turningPoints) && (timelineResult.turningPoints as Array<Record<string, unknown>>).length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 font-medium mb-2">Turning Points</p>
                      <div className="space-y-1">
                        {(timelineResult.turningPoints as Array<Record<string, unknown>>).map((tp, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            {tp.type === 'peak' ? (
                              <TrendingUp className="w-3 h-3 text-green-400" />
                            ) : (
                              <TrendingDown className="w-3 h-3 text-red-400" />
                            )}
                            <span className="text-gray-400">
                              Entry #{String(tp.index)}
                            </span>
                            <span className={`font-mono ${
                              tp.type === 'peak' ? 'text-green-400' : 'text-red-400'
                            }`}>
                              {String(tp.type)} ({Number(tp.valence).toFixed(3)})
                            </span>
                            <span className="text-gray-600">
                              magnitude: {Number(tp.magnitude).toFixed(3)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Overall Stats */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="lens-card text-center">
                      <p className="text-xs text-gray-400">Overall Valence</p>
                      <p className={`text-sm font-mono font-bold ${
                        (timelineResult.overallValence as number) > 0.1
                          ? 'text-green-400'
                          : (timelineResult.overallValence as number) < -0.1
                            ? 'text-red-400'
                            : 'text-gray-400'
                      }`}>
                        {String(timelineResult.overallValence)}
                      </p>
                    </div>
                    <div className="lens-card text-center">
                      <p className="text-xs text-gray-400">Overall Intensity</p>
                      <p className="text-sm font-mono font-bold text-orange-400">
                        {String(timelineResult.overallIntensity)}
                      </p>
                    </div>
                  </div>
                </div>
              ) : timelineResult && 'message' in timelineResult ? (
                <p className="text-sm text-gray-400 py-4 text-center">{String(timelineResult.message)}</p>
              ) : (
                <div className="text-center py-6 text-gray-600">
                  <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">Click &quot;Build Timeline&quot; to trace emotional arcs</p>
                </div>
              )}
            </motion.div>

            {/* --- Empathy Map Panel --- */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="panel p-4 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold flex items-center gap-2">
                  <Users className="w-4 h-4 text-neon-cyan" />
                  Empathy Map
                </h2>
                <button
                  onClick={runEmpathyMap}
                  disabled={isRunning !== null || journalEntries.length === 0}
                  className="btn-neon text-xs flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isRunning === 'empathyMap' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Users className="w-3.5 h-3.5" />
                  )}
                  {isRunning === 'empathyMap' ? 'Mapping...' : 'Build Empathy Map'}
                </button>
              </div>
              <p className="text-xs text-gray-400">
                Categorize feedback into Think/Feel/Say/Do quadrants. Identifies pain points, gains, and recurring themes.
              </p>

              {empathyResult && !('message' in empathyResult) ? (
                <div className="space-y-4">
                  {/* Feedback Summary */}
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span>{String(empathyResult.totalFeedback)} feedback items analyzed</span>
                    {!!empathyResult.analyzedAt && (
                      <span className="text-gray-600">{new Date(String(empathyResult.analyzedAt)).toLocaleTimeString()}</span>
                    )}
                  </div>

                  {/* Empathy Map Quadrants */}
                  {!!empathyResult.quadrants && (
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { key: 'thinks', label: 'Thinks', icon: <Brain className="w-3.5 h-3.5" />, color: 'text-blue-400', borderColor: 'border-blue-500/30', bgColor: 'bg-blue-500/5' },
                        { key: 'feels', label: 'Feels', icon: <Heart className="w-3.5 h-3.5" />, color: 'text-pink-400', borderColor: 'border-pink-500/30', bgColor: 'bg-pink-500/5' },
                        { key: 'says', label: 'Says', icon: <MessageSquare className="w-3.5 h-3.5" />, color: 'text-green-400', borderColor: 'border-green-500/30', bgColor: 'bg-green-500/5' },
                        { key: 'does', label: 'Does', icon: <Hand className="w-3.5 h-3.5" />, color: 'text-orange-400', borderColor: 'border-orange-500/30', bgColor: 'bg-orange-500/5' },
                      ].map((q) => {
                        const qData = (empathyResult.quadrants as Record<string, Record<string, unknown>>)[q.key];
                        const items = Array.isArray(qData?.items) ? qData.items as Array<Record<string, unknown>> : [];
                        return (
                          <div key={q.key} className={`rounded-lg border p-3 ${q.borderColor} ${q.bgColor}`}>
                            <div className={`flex items-center gap-1.5 mb-2 ${q.color}`}>
                              {q.icon}
                              <span className="text-xs font-bold uppercase tracking-wider">{q.label}</span>
                              <span className="ml-auto text-xs text-gray-400">{String(qData?.count || 0)}</span>
                            </div>
                            {items.length > 0 ? (
                              <div className="space-y-1 max-h-32 overflow-y-auto">
                                {items.slice(0, 5).map((item, j) => (
                                  <p key={j} className="text-xs text-gray-400 truncate">
                                    {String(item.text || '')}
                                  </p>
                                ))}
                                {items.length > 5 && (
                                  <p className="text-xs text-gray-400">+{items.length - 5} more</p>
                                )}
                              </div>
                            ) : (
                              <p className="text-xs text-gray-400 italic">No items</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Pain Points & Gains */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs font-medium text-red-400 mb-2 flex items-center gap-1">
                        <TrendingDown className="w-3 h-3" />
                        Pain Points ({String((empathyResult.summary as Record<string, unknown>)?.totalPainPoints || 0)})
                      </p>
                      {Array.isArray(empathyResult.painPoints) && (empathyResult.painPoints as Array<Record<string, unknown>>).length > 0 ? (
                        <div className="space-y-1.5">
                          {(empathyResult.painPoints as Array<Record<string, unknown>>).slice(0, 5).map((pp, i) => (
                            <div key={i} className="text-xs p-2 bg-red-500/5 rounded border border-red-500/10">
                              <p className="text-gray-400 truncate">{String(pp.text)}</p>
                              <div className="flex gap-1 mt-1 flex-wrap">
                                {Array.isArray(pp.keywords) && (pp.keywords as string[]).map((kw, k) => (
                                  <span key={k} className="text-[10px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">
                                    {kw}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 italic">None detected</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-green-400 mb-2 flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" />
                        Gains ({String((empathyResult.summary as Record<string, unknown>)?.totalGains || 0)})
                      </p>
                      {Array.isArray(empathyResult.gains) && (empathyResult.gains as Array<Record<string, unknown>>).length > 0 ? (
                        <div className="space-y-1.5">
                          {(empathyResult.gains as Array<Record<string, unknown>>).slice(0, 5).map((g, i) => (
                            <div key={i} className="text-xs p-2 bg-green-500/5 rounded border border-green-500/10">
                              <p className="text-gray-400 truncate">{String(g.text)}</p>
                              <div className="flex gap-1 mt-1 flex-wrap">
                                {Array.isArray(g.keywords) && (g.keywords as string[]).map((kw, k) => (
                                  <span key={k} className="text-[10px] text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">
                                    {kw}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 italic">None detected</p>
                      )}
                    </div>
                  </div>

                  {/* Top Themes */}
                  {Array.isArray(empathyResult.topThemes) && (empathyResult.topThemes as Array<Record<string, unknown>>).length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 font-medium mb-2">Top Themes</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(empathyResult.topThemes as Array<Record<string, unknown>>).map((theme, i) => (
                          <span key={i} className="text-xs bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded-full">
                            {String(theme.phrase)} ({String(theme.count)})
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Sentiment Balance */}
                  {!!empathyResult.summary && (
                    <div className="flex items-center gap-4 p-3 bg-lattice-deep rounded-lg text-xs">
                      <div className="text-center">
                        <p className="text-gray-400">Balance</p>
                        <p className={`font-mono font-bold ${
                          ((empathyResult.summary as Record<string, unknown>).sentimentBalance as number) > 0
                            ? 'text-green-400'
                            : ((empathyResult.summary as Record<string, unknown>).sentimentBalance as number) < 0
                              ? 'text-red-400'
                              : 'text-gray-400'
                        }`}>
                          {((empathyResult.summary as Record<string, unknown>).sentimentBalance as number) > 0 ? '+' : ''}
                          {String((empathyResult.summary as Record<string, unknown>).sentimentBalance)}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-gray-400">Avg Pain</p>
                        <p className="font-mono font-bold text-red-400">
                          {String((empathyResult.summary as Record<string, unknown>).avgPainScore)}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-gray-400">Avg Gain</p>
                        <p className="font-mono font-bold text-green-400">
                          {String((empathyResult.summary as Record<string, unknown>).avgGainScore)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ) : empathyResult && 'message' in empathyResult ? (
                <p className="text-sm text-gray-400 py-4 text-center">{String(empathyResult.message)}</p>
              ) : (
                <div className="text-center py-6 text-gray-600">
                  <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">Click &quot;Build Empathy Map&quot; to categorize feedback</p>
                </div>
              )}
            </motion.div>

            {/* --- Pattern Detection Panel --- */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="panel p-4 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold flex items-center gap-2">
                  <Search className="w-4 h-4 text-neon-purple" />
                  Pattern Detection
                </h2>
                <button
                  onClick={runDetectPatterns}
                  disabled={isRunning !== null || journalEntries.length === 0}
                  className="btn-neon text-xs flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isRunning === 'detect-patterns' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Search className="w-3.5 h-3.5" />
                  )}
                  {isRunning === 'detect-patterns' ? 'Detecting...' : 'Detect Patterns'}
                </button>
              </div>
              <p className="text-xs text-gray-400">
                Identify emotional triggers, cycles, and correlations across affect data using the brain analysis engine.
              </p>

              {patternResult && !('message' in patternResult) ? (
                <div className="space-y-3">
                  {/* Patterns List */}
                  {Array.isArray(patternResult.patterns) && (patternResult.patterns as Array<Record<string, unknown>>).length > 0 ? (
                    <div className="space-y-2">
                      {(patternResult.patterns as Array<Record<string, unknown>>).map((pattern, i) => (
                        <div key={i} className="lens-card">
                          <div className="flex items-start gap-2">
                            <Sparkles className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
                              pattern.severity === 'high' || pattern.importance === 'high'
                                ? 'text-red-400'
                                : pattern.severity === 'medium' || pattern.importance === 'medium'
                                  ? 'text-yellow-400'
                                  : 'text-purple-400'
                            }`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-300 capitalize">
                                {String(pattern.theme || pattern.name || pattern.label || pattern.type || `Pattern ${i + 1}`)}
                              </p>
                              {!!(pattern.description || pattern.detail) && (
                                <p className="text-xs text-gray-400 mt-0.5">
                                  {String(pattern.description || pattern.detail)}
                                </p>
                              )}
                              {!!(pattern.count ?? pattern.frequency) && (
                                <span className="text-[10px] text-gray-400 mt-1 block">
                                  Occurrences: {String(pattern.count ?? pattern.frequency)}
                                </span>
                              )}
                            </div>
                            {!!(pattern.confidence || pattern.score) && (
                              <span className="text-xs font-mono text-neon-purple shrink-0">
                                {typeof pattern.confidence === 'number'
                                  ? `${(pattern.confidence * 100).toFixed(0)}%`
                                  : typeof pattern.score === 'number'
                                    ? `${(pattern.score * 100).toFixed(0)}%`
                                    : String(pattern.confidence || pattern.score)}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {/* Triggers */}
                  {Array.isArray(patternResult.triggers) && (patternResult.triggers as Array<Record<string, unknown>>).length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 font-medium mb-2">Emotional Triggers</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(patternResult.triggers as Array<Record<string, unknown>>).map((trigger, i) => (
                          <span key={i} className="text-xs bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full capitalize">
                            {String(trigger.trigger || trigger.name || trigger.label || trigger)}
                            {trigger.count != null && (
                              <span className="ml-1 opacity-70">({String(trigger.count)})</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Cycles */}
                  {Array.isArray(patternResult.cycles) && (patternResult.cycles as Array<Record<string, unknown>>).length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 font-medium mb-2">Emotional Cycles</p>
                      <div className="space-y-1.5">
                        {(patternResult.cycles as Array<Record<string, unknown>>).map((cycle, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs p-2 bg-purple-500/5 rounded border border-purple-500/10">
                            <RefreshCw className="w-3 h-3 text-purple-400 shrink-0" />
                            <span className="text-gray-400">{String(cycle.label || cycle.description || cycle.name || `Cycle ${i + 1}`)}</span>
                            {!!(cycle.count ?? cycle.period) && (
                              <span className="ml-auto text-gray-600 font-mono">{String(cycle.count ?? cycle.period)}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Correlations */}
                  {Array.isArray(patternResult.correlations) && (patternResult.correlations as Array<Record<string, unknown>>).length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 font-medium mb-2">Correlations</p>
                      <div className="space-y-1">
                        {(patternResult.correlations as Array<Record<string, unknown>>).map((corr, i) => {
                          // Canonical handler shape: { between: [a, b], strength: 'strong'|'moderate' }.
                          // Fall back to the alternate shapes the panel historically tolerated.
                          const between = Array.isArray(corr.between)
                            ? (corr.between as unknown[]).map((x) => String(x)).join(' ↔ ')
                            : null;
                          const label =
                            String(corr.description || corr.name || '') ||
                            between ||
                            `${corr.from || ''} -> ${corr.to || ''}`;
                          return (
                            <div key={i} className="flex items-center gap-2 text-xs">
                              <Activity className="w-3 h-3 text-cyan-400" />
                              <span className="text-gray-400">{label}</span>
                              {typeof corr.strength === 'number' ? (
                                <span className="ml-auto font-mono text-cyan-400">
                                  r={(corr.strength as number).toFixed(2)}
                                </span>
                              ) : typeof corr.strength === 'string' ? (
                                <span className="ml-auto font-mono text-cyan-400 capitalize">
                                  {String(corr.strength)}
                                </span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Summary / Raw fallback for arbitrary result shapes */}
                  {!!patternResult.summary && typeof patternResult.summary === 'string' && (
                    <p className="text-xs text-gray-400 p-3 bg-lattice-deep rounded-lg">
                      {String(patternResult.summary)}
                    </p>
                  )}

                  {/* If result has no known sub-fields, show key-value pairs */}
                  {!patternResult.patterns && !patternResult.triggers && !patternResult.cycles && !patternResult.correlations && (
                    <div className="space-y-1.5">
                      {Object.entries(patternResult)
                        .filter(([k]) => k !== 'analyzedAt')
                        .map(([key, val]) => (
                          <div key={key} className="flex items-start justify-between gap-3 text-xs py-1 border-b border-gray-700/20 last:border-0">
                            <span className="text-gray-400 capitalize">{key.replace(/[_-]/g, ' ')}</span>
                            <span className="text-gray-300 font-mono text-right max-w-[60%] break-words">
                              {typeof val === 'number'
                                ? val.toFixed(3)
                                : typeof val === 'boolean'
                                  ? val ? 'Yes' : 'No'
                                  : typeof val === 'object'
                                    ? JSON.stringify(val, null, 0)
                                    : String(val)}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              ) : patternResult && 'message' in patternResult ? (
                <p className="text-sm text-gray-400 py-4 text-center">{String(patternResult.message)}</p>
              ) : (
                <div className="text-center py-6 text-gray-600">
                  <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">Click &quot;Detect Patterns&quot; to find emotional triggers and cycles</p>
                </div>
              )}
            </motion.div>
          </div>
        </div>
  );
}
