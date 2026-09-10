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
            className="fixed top-20 right-4 bottom-4 w-[28rem] max-w-[92vw] z-50 flex flex-col bg-lattice-surface border border-lattice-border rounded-lg shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-lattice-border flex-shrink-0">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-neon-yellow" />
                <span className="text-sm font-semibold text-white">Analysis &amp; features</span>
              </div>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-white transition-colors"
                title="Close"
                aria-label="Close chat tools"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {/* ── Chat Computational Actions ── */}
              <div className="border-t border-white/10 px-4 py-4 space-y-3">
                <div className="panel p-4">
                  <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-neon-yellow" /> Computational Actions
                  </h3>
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      onClick={() => onChatAction('threadSummarize')}
                      disabled={chatActionRunning !== null}
                      className="flex flex-col items-center gap-2 p-3 bg-lattice-bg rounded-lg border border-lattice-border hover:border-neon-cyan/50 transition-colors disabled:opacity-50"
                    >
                      {chatActionRunning === 'threadSummarize' ? (
                        <Loader2 className="w-5 h-5 text-neon-cyan animate-spin" />
                      ) : (
                        <MessageSquare className="w-5 h-5 text-neon-cyan" />
                      )}
                      <span className="text-xs text-gray-300">Thread Summarize</span>
                    </button>
                    <button
                      onClick={() => onChatAction('participantAnalysis')}
                      disabled={chatActionRunning !== null}
                      className="flex flex-col items-center gap-2 p-3 bg-lattice-bg rounded-lg border border-lattice-border hover:border-neon-purple/50 transition-colors disabled:opacity-50"
                    >
                      {chatActionRunning === 'participantAnalysis' ? (
                        <Loader2 className="w-5 h-5 text-neon-purple animate-spin" />
                      ) : (
                        <Users className="w-5 h-5 text-neon-purple" />
                      )}
                      <span className="text-xs text-gray-300">Participant Analysis</span>
                    </button>
                    <button
                      onClick={() => onChatAction('topicDetection')}
                      disabled={chatActionRunning !== null}
                      className="flex flex-col items-center gap-2 p-3 bg-lattice-bg rounded-lg border border-lattice-border hover:border-neon-green/50 transition-colors disabled:opacity-50"
                    >
                      {chatActionRunning === 'topicDetection' ? (
                        <Loader2 className="w-5 h-5 text-neon-green animate-spin" />
                      ) : (
                        <BarChart3 className="w-5 h-5 text-neon-green" />
                      )}
                      <span className="text-xs text-gray-300">Topic Detection</span>
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
                      <h3 className="font-semibold text-white flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-neon-cyan" /> Thread Summary
                      </h3>
                      <button
                        onClick={onClearThreadSummarize}
                        className="text-gray-400 hover:text-white"
                        aria-label="Clear thread summary"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="space-y-2 text-sm text-gray-300">
                      {!!threadSummarizeResult.summary && (
                        <p className="text-white">{threadSummarizeResult.summary as string}</p>
                      )}
                      {!!threadSummarizeResult.message && !threadSummarizeResult.summary && (
                        <p className="text-amber-300">{threadSummarizeResult.message as string}</p>
                      )}
                      {Array.isArray(threadSummarizeResult.keyPoints) &&
                        (threadSummarizeResult.keyPoints as string[]).length > 0 && (
                          <ul className="list-disc list-inside space-y-1 text-gray-300">
                            {(threadSummarizeResult.keyPoints as string[]).map((pt, i) => (
                              <li key={i}>{pt}</li>
                            ))}
                          </ul>
                        )}
                      {threadSummarizeResult.messageCount !== undefined && (
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <div className="p-2 bg-lattice-bg rounded text-center">
                            <p className="text-sm font-bold text-neon-cyan">
                              {threadSummarizeResult.messageCount as number}
                            </p>
                            <p className="text-[10px] text-gray-400">Messages</p>
                          </div>
                          {threadSummarizeResult.participants !== undefined && (
                            <div className="p-2 bg-lattice-bg rounded text-center">
                              <p className="text-sm font-bold text-neon-purple">
                                {threadSummarizeResult.participants as number}
                              </p>
                              <p className="text-[10px] text-gray-400">Participants</p>
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
                      <h3 className="font-semibold text-white flex items-center gap-2">
                        <Users className="w-4 h-4 text-neon-purple" /> Participant Analysis
                      </h3>
                      <button
                        onClick={onClearParticipantAnalysis}
                        className="text-gray-400 hover:text-white"
                        aria-label="Clear participant analysis"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="space-y-2 text-sm text-gray-300">
                      {participantAnalysisResult.totalParticipants !== undefined && (
                        <div className="grid grid-cols-3 gap-2">
                          <div className="p-2 bg-lattice-bg rounded text-center">
                            <p className="text-sm font-bold text-neon-purple">
                              {participantAnalysisResult.totalParticipants as number}
                            </p>
                            <p className="text-[10px] text-gray-400">Total</p>
                          </div>
                          {participantAnalysisResult.activeParticipants !== undefined && (
                            <div className="p-2 bg-lattice-bg rounded text-center">
                              <p className="text-sm font-bold text-neon-green">
                                {participantAnalysisResult.activeParticipants as number}
                              </p>
                              <p className="text-[10px] text-gray-400">Active</p>
                            </div>
                          )}
                          {participantAnalysisResult.engagementScore !== undefined && (
                            <div className="p-2 bg-lattice-bg rounded text-center">
                              <p className="text-sm font-bold text-neon-cyan">
                                {participantAnalysisResult.engagementScore as number}
                              </p>
                              <p className="text-[10px] text-gray-400">Engagement</p>
                            </div>
                          )}
                        </div>
                      )}
                      {!!participantAnalysisResult.message &&
                        participantAnalysisResult.totalParticipants === undefined && (
                          <p className="text-amber-300">
                            {participantAnalysisResult.message as string}
                          </p>
                        )}
                      {Array.isArray(participantAnalysisResult.participants) &&
                        (participantAnalysisResult.participants as Array<Record<string, unknown>>)
                          .length > 0 && (
                          <div className="mt-2 space-y-1">
                            <p className="text-xs text-gray-400 uppercase tracking-wider">
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
                                  className="flex items-center justify-between text-xs bg-lattice-bg rounded px-2 py-1"
                                >
                                  <span className="text-gray-300">{p.name as string}</span>
                                  <span className="text-neon-purple">
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
                      <h3 className="font-semibold text-white flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-neon-green" /> Topic Detection
                      </h3>
                      <button
                        onClick={onClearTopicDetection}
                        className="text-gray-400 hover:text-white"
                        aria-label="Clear topic detection"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="space-y-2 text-sm text-gray-300">
                      {!!topicDetectionResult.primaryTopic && (
                        <p>
                          Primary:{' '}
                          <span className="text-white font-medium">
                            {topicDetectionResult.primaryTopic as string}
                          </span>
                        </p>
                      )}
                      {!!topicDetectionResult.message && !topicDetectionResult.primaryTopic && (
                        <p className="text-amber-300">{topicDetectionResult.message as string}</p>
                      )}
                      {Array.isArray(topicDetectionResult.topics) &&
                        (topicDetectionResult.topics as Array<Record<string, unknown>>).length >
                          0 && (
                          <div className="space-y-1">
                            {(topicDetectionResult.topics as Array<Record<string, unknown>>).map(
                              (t, i) => (
                                <div
                                  key={i}
                                  className="flex items-center justify-between text-xs bg-lattice-bg rounded px-2 py-1"
                                >
                                  <span className="text-gray-300">
                                    {(t.topic || t.name) as string}
                                  </span>
                                  {t.score !== undefined && (
                                    <span className="text-neon-green">
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
                                className="px-2 py-0.5 rounded-full text-[10px] bg-neon-green/10 text-neon-green border border-neon-green/20"
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
              <div className="border-t border-white/10">
                <button
                  onClick={() => setFeaturesOpen(!featuresOpen)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
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
                      <div className="p-3 rounded-lg border border-neon-purple/20 bg-neon-purple/5 space-y-2">
                        <p className="text-xs font-semibold text-neon-purple flex items-center gap-1.5">
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
                              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-lattice-surface border border-lattice-border hover:border-neon-purple/50 transition-colors text-left group"
                            >
                              <span className="text-xs font-medium text-white group-hover:text-neon-purple transition-colors">
                                {rec.name}
                              </span>
                              <span className="text-[10px] text-gray-400">
                                {Math.round(rec.score * 100)}%
                              </span>
                            </button>
                          ))}
                        </div>
                        <p className="text-[10px] text-gray-400">
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
