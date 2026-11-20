'use client';

/**
 * Chat Analysis & features drawer — computational actions (thread summarize /
 * participant / topic) + related-lens recommender + Atlas overview.
 * Extracted from app/lenses/chat/page.tsx (lens consolidation playbook).
 */

import { useState, type MutableRefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BarChart3,
  ChevronDown,
  Layers,
  Loader2,
  MessageSquare,
  Users,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import AtlasViewer from '@/components/chat/AtlasViewer';
import type { LensRecommendation, SessionContext, SessionTelemetry } from '@/lib/lenses/chat-lens-recommender';
import { recordLensOpened } from '@/lib/lenses/chat-lens-recommender';

export type ChatComputationalAction =
  | 'threadSummarize'
  | 'participantAnalysis'
  | 'topicDetection';

export function ChatToolsDrawer({
  open,
  onClose,
  chatActionRunning,
  onChatAction,
  threadSummarizeResult,
  onClearThreadSummarize,
  participantAnalysisResult,
  onClearParticipantAnalysis,
  topicDetectionResult,
  onClearTopicDetection,
  lensRecommendations,
  lensSessionCtx,
  lensTelemetry,
}: {
  open: boolean;
  onClose: () => void;
  chatActionRunning: string | null;
  onChatAction: (action: ChatComputationalAction) => void;
  threadSummarizeResult: Record<string, unknown> | null;
  onClearThreadSummarize: () => void;
  participantAnalysisResult: Record<string, unknown> | null;
  onClearParticipantAnalysis: () => void;
  topicDetectionResult: Record<string, unknown> | null;
  onClearTopicDetection: () => void;
  lensRecommendations: LensRecommendation[];
  lensSessionCtx: MutableRefObject<SessionContext>;
  lensTelemetry: MutableRefObject<SessionTelemetry>;
}) {
  const [featuresOpen, setFeaturesOpen] = useState(true);

  return (
    <AnimatePresence>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close chat tools"
            tabIndex={-1}
            onClick={onClose}
            className="fixed inset-0 z-40 cursor-default"
          />
          <motion.aside
            initial={{ x: 480, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 480, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            role="complementary"
            aria-label="Chat analysis and features"
            className="fixed top-20 right-4 bottom-4 w-[28rem] max-w-[92vw] z-50 flex flex-col bg-[var(--nb-sheet,rgb(var(--lattice-surface-rgb)))] border border-[color:var(--nb-rule,rgb(var(--lattice-border-rgb)))] rounded-lg shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--nb-rule,rgb(var(--lattice-border-rgb)))] flex-shrink-0">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-[color:var(--nb-ochre,#facc15)]" />
                <span className="text-sm font-semibold text-[color:var(--nb-ink,#ffffff)]">Analysis &amp; features</span>
              </div>
              <button
                onClick={onClose}
                className="text-[color:var(--nb-muted,#9ca3af)] hover:text-[color:var(--nb-ink,#ffffff)] transition-colors"
                title="Close"
                aria-label="Close chat tools"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {/* ── Chat Computational Actions ── */}
              <div className="border-t border-[color:var(--nb-rule,rgba(255,255,255,0.1))] px-4 py-4 space-y-3">
                <div className="panel p-4">
                  <h3 className="font-semibold text-[color:var(--nb-ink,#ffffff)] mb-4 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-[color:var(--nb-ochre,#facc15)]" /> Computational Actions
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <button
                      onClick={() => onChatAction('threadSummarize')}
                      disabled={chatActionRunning !== null}
                      className="flex flex-col items-center gap-2 p-3 bg-[var(--nb-paper,rgb(var(--lattice-bg-rgb)))] rounded-lg border border-[color:var(--nb-rule,rgb(var(--lattice-border-rgb)))] hover:border-[color:var(--nb-blue,rgba(0,255,247,0.5))] transition-colors disabled:opacity-50"
                    >
                      {chatActionRunning === 'threadSummarize' ? (
                        <Loader2 className="w-5 h-5 text-[color:var(--nb-blue,#00fff7)] animate-spin" />
                      ) : (
                        <MessageSquare className="w-5 h-5 text-[color:var(--nb-blue,#00fff7)]" />
                      )}
                      <span className="text-xs text-[color:var(--nb-ink-2,#d1d5db)]">Thread Summarize</span>
                    </button>
                    <button
                      onClick={() => onChatAction('participantAnalysis')}
                      disabled={chatActionRunning !== null}
                      className="flex flex-col items-center gap-2 p-3 bg-[var(--nb-paper,rgb(var(--lattice-bg-rgb)))] rounded-lg border border-[color:var(--nb-rule,rgb(var(--lattice-border-rgb)))] hover:border-[color:var(--nb-red,rgba(168,85,247,0.5))] transition-colors disabled:opacity-50"
                    >
                      {chatActionRunning === 'participantAnalysis' ? (
                        <Loader2 className="w-5 h-5 text-[color:var(--nb-red,#a855f7)] animate-spin" />
                      ) : (
                        <Users className="w-5 h-5 text-[color:var(--nb-red,#a855f7)]" />
                      )}
                      <span className="text-xs text-[color:var(--nb-ink-2,#d1d5db)]">Participant Analysis</span>
                    </button>
                    <button
                      onClick={() => onChatAction('topicDetection')}
                      disabled={chatActionRunning !== null}
                      className="flex flex-col items-center gap-2 p-3 bg-[var(--nb-paper,rgb(var(--lattice-bg-rgb)))] rounded-lg border border-[color:var(--nb-rule,rgb(var(--lattice-border-rgb)))] hover:border-[color:var(--nb-green,rgba(34,197,94,0.5))] transition-colors disabled:opacity-50"
                    >
                      {chatActionRunning === 'topicDetection' ? (
                        <Loader2 className="w-5 h-5 text-[color:var(--nb-green,#22c55e)] animate-spin" />
                      ) : (
                        <BarChart3 className="w-5 h-5 text-[color:var(--nb-green,#22c55e)]" />
                      )}
                      <span className="text-xs text-[color:var(--nb-ink-2,#d1d5db)]">Topic Detection</span>
                    </button>
                  </div>
                </div>

                {threadSummarizeResult && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="panel p-4"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-[color:var(--nb-ink,#ffffff)] flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-[color:var(--nb-blue,#00fff7)]" /> Thread Summary
                      </h3>
                      <button
                        onClick={onClearThreadSummarize}
                        className="text-[color:var(--nb-muted,#9ca3af)] hover:text-[color:var(--nb-ink,#ffffff)]"
                        aria-label="Clear thread summary"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="space-y-2 text-sm text-[color:var(--nb-ink-2,#d1d5db)]">
                      {!!threadSummarizeResult.summary && (
                        <p className="text-[color:var(--nb-ink,#ffffff)]">{threadSummarizeResult.summary as string}</p>
                      )}
                      {!!threadSummarizeResult.message && !threadSummarizeResult.summary && (
                        <p className="text-[color:var(--nb-ochre,#fcd34d)]">{threadSummarizeResult.message as string}</p>
                      )}
                      {Array.isArray(threadSummarizeResult.keyPoints) &&
                        (threadSummarizeResult.keyPoints as string[]).length > 0 && (
                          <ul className="list-disc list-inside space-y-1 text-[color:var(--nb-ink-2,#d1d5db)]">
                            {(threadSummarizeResult.keyPoints as string[]).map((pt, i) => (
                              <li key={i}>{pt}</li>
                            ))}
                          </ul>
                        )}
                      {threadSummarizeResult.messageCount !== undefined && (
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <div className="p-2 bg-[var(--nb-paper,rgb(var(--lattice-bg-rgb)))] rounded text-center">
                            <p className="text-sm font-bold text-[color:var(--nb-blue,#00fff7)]">
                              {threadSummarizeResult.messageCount as number}
                            </p>
                            <p className="text-[10px] text-[color:var(--nb-muted,#9ca3af)]">Messages</p>
                          </div>
                          {threadSummarizeResult.participants !== undefined && (
                            <div className="p-2 bg-[var(--nb-paper,rgb(var(--lattice-bg-rgb)))] rounded text-center">
                              <p className="text-sm font-bold text-[color:var(--nb-red,#a855f7)]">
                                {threadSummarizeResult.participants as number}
                              </p>
                              <p className="text-[10px] text-[color:var(--nb-muted,#9ca3af)]">Participants</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}

                {participantAnalysisResult && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="panel p-4"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-[color:var(--nb-ink,#ffffff)] flex items-center gap-2">
                        <Users className="w-4 h-4 text-[color:var(--nb-red,#a855f7)]" /> Participant Analysis
                      </h3>
                      <button
                        onClick={onClearParticipantAnalysis}
                        className="text-[color:var(--nb-muted,#9ca3af)] hover:text-[color:var(--nb-ink,#ffffff)]"
                        aria-label="Clear participant analysis"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="space-y-2 text-sm text-[color:var(--nb-ink-2,#d1d5db)]">
                      {participantAnalysisResult.totalParticipants !== undefined && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          <div className="p-2 bg-[var(--nb-paper,rgb(var(--lattice-bg-rgb)))] rounded text-center">
                            <p className="text-sm font-bold text-[color:var(--nb-red,#a855f7)]">
                              {participantAnalysisResult.totalParticipants as number}
                            </p>
                            <p className="text-[10px] text-[color:var(--nb-muted,#9ca3af)]">Total</p>
                          </div>
                          {participantAnalysisResult.activeParticipants !== undefined && (
                            <div className="p-2 bg-[var(--nb-paper,rgb(var(--lattice-bg-rgb)))] rounded text-center">
                              <p className="text-sm font-bold text-[color:var(--nb-green,#22c55e)]">
                                {participantAnalysisResult.activeParticipants as number}
                              </p>
                              <p className="text-[10px] text-[color:var(--nb-muted,#9ca3af)]">Active</p>
                            </div>
                          )}
                          {participantAnalysisResult.engagementScore !== undefined && (
                            <div className="p-2 bg-[var(--nb-paper,rgb(var(--lattice-bg-rgb)))] rounded text-center">
                              <p className="text-sm font-bold text-[color:var(--nb-blue,#00fff7)]">
                                {participantAnalysisResult.engagementScore as number}
                              </p>
                              <p className="text-[10px] text-[color:var(--nb-muted,#9ca3af)]">Engagement</p>
                            </div>
                          )}
                        </div>
                      )}
                      {!!participantAnalysisResult.message &&
                        participantAnalysisResult.totalParticipants === undefined && (
                          <p className="text-[color:var(--nb-ochre,#fcd34d)]">
                            {participantAnalysisResult.message as string}
                          </p>
                        )}
                      {Array.isArray(participantAnalysisResult.participants) &&
                        (participantAnalysisResult.participants as Array<Record<string, unknown>>)
                          .length > 0 && (
                          <div className="mt-2 space-y-1">
                            <p className="text-xs text-[color:var(--nb-muted,#9ca3af)] uppercase tracking-wider">
                              Top Participants
                            </p>
                            {(
                              participantAnalysisResult.participants as Array<
                                Record<string, unknown>
                              >
                            )
                              .slice(0, 5)
                              .map((p, i) => (
                                <div
                                  key={i}
                                  className="flex items-center justify-between text-xs bg-[var(--nb-paper,rgb(var(--lattice-bg-rgb)))] rounded px-2 py-1"
                                >
                                  <span className="text-[color:var(--nb-ink-2,#d1d5db)]">{p.name as string}</span>
                                  <span className="text-[color:var(--nb-red,#a855f7)]">
                                    {p.messageCount as number} msgs
                                  </span>
                                </div>
                              ))}
                          </div>
                        )}
                    </div>
                  </motion.div>
                )}

                {topicDetectionResult && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="panel p-4"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-[color:var(--nb-ink,#ffffff)] flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-[color:var(--nb-green,#22c55e)]" /> Topic Detection
                      </h3>
                      <button
                        onClick={onClearTopicDetection}
                        className="text-[color:var(--nb-muted,#9ca3af)] hover:text-[color:var(--nb-ink,#ffffff)]"
                        aria-label="Clear topic detection"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="space-y-2 text-sm text-[color:var(--nb-ink-2,#d1d5db)]">
                      {!!topicDetectionResult.primaryTopic && (
                        <p>
                          Primary:{' '}
                          <span className="text-[color:var(--nb-ink,#ffffff)] font-medium">
                            {topicDetectionResult.primaryTopic as string}
                          </span>
                        </p>
                      )}
                      {!!topicDetectionResult.message && !topicDetectionResult.primaryTopic && (
                        <p className="text-[color:var(--nb-ochre,#fcd34d)]">{topicDetectionResult.message as string}</p>
                      )}
                      {Array.isArray(topicDetectionResult.topics) &&
                        (topicDetectionResult.topics as Array<Record<string, unknown>>).length >
                          0 && (
                          <div className="space-y-1">
                            {(topicDetectionResult.topics as Array<Record<string, unknown>>).map(
                              (t, i) => (
                                <div
                                  key={i}
                                  className="flex items-center justify-between text-xs bg-[var(--nb-paper,rgb(var(--lattice-bg-rgb)))] rounded px-2 py-1"
                                >
                                  <span className="text-[color:var(--nb-ink-2,#d1d5db)]">
                                    {(t.topic || t.name) as string}
                                  </span>
                                  {t.score !== undefined && (
                                    <span className="text-[color:var(--nb-green,#22c55e)]">
                                      {Math.round(Number(t.score) * 100)}%
                                    </span>
                                  )}
                                </div>
                              )
                            )}
                          </div>
                        )}
                      {Array.isArray(topicDetectionResult.keywords) &&
                        (topicDetectionResult.keywords as string[]).length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {(topicDetectionResult.keywords as string[]).map((kw, i) => (
                              <span
                                key={i}
                                className="px-2 py-0.5 rounded-full text-[10px] bg-[var(--nb-green-soft,rgba(34,197,94,0.1))] text-[color:var(--nb-green,#22c55e)] border border-[color:var(--nb-green,rgba(34,197,94,0.2))]"
                              >
                                {kw}
                              </span>
                            ))}
                          </div>
                        )}
                    </div>
                  </motion.div>
                )}
              </div>

              {/* Related lenses + spatial context */}
              <div className="border-t border-[color:var(--nb-rule,rgba(255,255,255,0.1))]">
                <button
                  onClick={() => setFeaturesOpen(!featuresOpen)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm text-[color:var(--nb-ink-2,#d1d5db)] hover:text-[color:var(--nb-ink,#ffffff)] transition-colors bg-[var(--nb-wash,rgba(255,255,255,0.02))] hover:bg-[var(--nb-wash,rgba(255,255,255,0.04))] rounded-lg"
                >
                  <span className="flex items-center gap-2">
                    <Layers className="w-4 h-4" />
                    Related
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${featuresOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {featuresOpen && (
                  <div className="px-4 pb-4 space-y-4">
                    {lensRecommendations.length > 0 && (
                      <div className="p-3 rounded-lg border border-[color:var(--nb-red,rgba(168,85,247,0.2))] bg-[var(--nb-red-soft,rgba(168,85,247,0.05))] space-y-2">
                        <p className="text-xs font-semibold text-[color:var(--nb-red,#a855f7)] flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5" />
                          Suggested Lenses
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {lensRecommendations.map((rec) => (
                            <button
                              key={rec.lensId}
                              onClick={() => {
                                recordLensOpened(
                                  lensTelemetry.current,
                                  rec.lensId,
                                  lensSessionCtx.current.currentTurn
                                );
                                window.location.href = `/lenses/${rec.lensId}`;
                              }}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[var(--nb-sheet,rgb(var(--lattice-surface-rgb)))] border border-[color:var(--nb-rule,rgb(var(--lattice-border-rgb)))] hover:border-[color:var(--nb-red,rgba(168,85,247,0.5))] transition-colors text-left group"
                            >
                              <span className="text-xs font-medium text-[color:var(--nb-ink,#ffffff)] group-hover:text-[color:var(--nb-red,#a855f7)] transition-colors">
                                {rec.name}
                              </span>
                              <span className="text-[10px] text-[color:var(--nb-muted,#9ca3af)]">
                                {Math.round(rec.score * 100)}%
                              </span>
                            </button>
                          ))}
                        </div>
                        <p className="text-[10px] text-[color:var(--nb-muted,#9ca3af)]">
                          Based on your current conversation context
                        </p>
                      </div>
                    )}
                    <AtlasViewer type="overview" />
                  </div>
                )}
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
