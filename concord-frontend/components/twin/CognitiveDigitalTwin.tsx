'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Clock, Target, AlertTriangle, Sun, Moon,
  ChevronDown, ChevronUp, RefreshCw, Loader2, Sparkles, Send,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const BIAS_LABELS: Record<string, { label: string; color: string }> = {
  anchoring: { label: 'Anchoring', color: 'text-blue-400' },
  confirmation: { label: 'Confirmation', color: 'text-red-400' },
  recency: { label: 'Recency', color: 'text-yellow-400' },
  availabilityHeuristic: { label: 'Availability', color: 'text-purple-400' },
  sunkCost: { label: 'Sunk Cost', color: 'text-orange-400' },
};

function CognitiveDigitalTwin({ className }: { className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [simQuestion, setSimQuestion] = useState('');
  const [cloneQuestion, setCloneQuestion] = useState('');
  const [simResult, setSimResult] = useState<{
    simulations?: { path: string; scenario: string; confidence: number }[];
  } | null>(null);
  const [cloneResult, setCloneResult] = useState<{
    response: string;
    source: string;
    confidence?: number;
    disclaimer?: string;
  } | null>(null);
  const queryClient = useQueryClient();

  const { data: twinData, isLoading } = useQuery({
    queryKey: ['cognitive-twin'],
    queryFn: () => api.get('/api/twin').then(r => r.data),
  });

  const updateTwin = useMutation({
    mutationFn: () => api.post('/api/twin/update'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cognitive-twin'] }),
  });

  const simulateFuture = useMutation({
    mutationFn: (question: string) => api.post('/api/simulate/future', { question }),
    onSuccess: (result) => setSimResult(result.data),
  });

  const askClone = useMutation({
    mutationFn: (question: string) => api.post('/api/clone/ask', { question }),
    onSuccess: (result) => setCloneResult(result.data),
  });

  if (isLoading) {
    return (
      <div className={cn('p-4 bg-lattice-surface border border-lattice-border rounded-xl animate-pulse', className)}>
        <div className="h-6 bg-lattice-deep rounded w-48" />
      </div>
    );
  }

  const twin = twinData?.twin || {};
  const circadian = twin.circadianProfile || {};
  const biases = twin.biasFingerprint || {};
  const domains = Object.entries(twin.processingSpeed || {}).sort(([, a], [, b]) => (b as { count: number }).count - (a as { count: number }).count);

  // Find peak hours
  const peakHours = Object.entries(circadian)
    .map(([h, d]) => ({ hour: parseInt(h), quality: (d as { avgQuality?: number; count?: number }).avgQuality || 0, count: (d as { avgQuality?: number; count?: number }).count || 0 }))
    .sort((a, b) => b.quality - a.quality)
    .slice(0, 3);

  return (
    <div className={cn('bg-lattice-surface border border-lattice-border rounded-xl overflow-hidden', className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-lattice-border">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-neon-purple/20 to-neon-cyan/20 rounded-lg">
            <Brain className="w-5 h-5 text-neon-purple" />
          </div>
          <div>
            <h3 className="font-medium text-white">Cognitive Digital Twin</h3>
            <p className="text-xs text-gray-500">
              {twin.lastUpdated
                ? `Updated ${new Date(twin.lastUpdated).toLocaleDateString()}`
                : 'Your thinking model'
              }
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => updateTwin.mutate()}
            disabled={updateTwin.isPending}
            className="p-1.5 rounded-lg hover:bg-neon-purple/20 text-gray-400 hover:text-neon-purple transition-colors"
            title="Update twin"
          >
            {updateTwin.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-lg hover:bg-lattice-deep text-gray-400 hover:text-white transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="p-4 grid grid-cols-3 gap-3">
        {/* Top domains */}
        <div>
          <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Target className="w-3 h-3" /> Top Domains</p>
          <div className="space-y-1">
            {(domains.slice(0, 3) as [string, { count: number }][]).map(([domain, data]) => (
              <div key={domain} className="flex items-center justify-between">
                <span className="text-xs text-white truncate">{domain}</span>
                <span className="text-[10px] text-gray-500">{data.count} DTUs</span>
              </div>
            ))}
          </div>
        </div>

        {/* Peak hours */}
        <div>
          <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Clock className="w-3 h-3" /> Peak Hours</p>
          <div className="space-y-1">
            {peakHours.map(ph => (
              <div key={ph.hour} className="flex items-center gap-1">
                {ph.hour >= 6 && ph.hour < 18 ? (
                  <Sun className="w-3 h-3 text-yellow-400" />
                ) : (
                  <Moon className="w-3 h-3 text-blue-400" />
                )}
                <span className="text-xs text-white">{ph.hour}:00</span>
                <span className="text-[10px] text-gray-500">{ph.count} DTUs</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bias fingerprint */}
        <div>
          <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Biases</p>
          <div className="space-y-1">
            {Object.entries(biases)
              .filter(([, v]) => (v as number) > 0.05)
              .sort(([, a], [, b]) => (b as number) - (a as number))
              .slice(0, 3)
              .map(([bias, value]) => {
                const conf = BIAS_LABELS[bias] || { label: bias, color: 'text-gray-400' };
                return (
                  <div key={bias} className="flex items-center justify-between">
                    <span className={cn('text-xs', conf.color)}>{conf.label}</span>
                    <span className="text-[10px] text-gray-500">{Math.round((value as number) * 100)}%</span>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {/* Communication style */}
      <div className="px-4 pb-3 flex items-center gap-4 text-xs text-gray-500">
        <span>Style: <span className="text-white capitalize">{twin.communicationStyle?.verbosity || 'moderate'}</span></span>
        <span>Avg length: <span className="text-white">{twin.communicationStyle?.preferredLength || 0} chars</span></span>
      </div>

      {/* Expanded: Future Simulator + Clone */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {/* Future Self Simulator */}
            <div className="p-4 border-t border-lattice-border">
              <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-neon-cyan" /> Future Self Simulator
              </h4>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={simQuestion}
                  onChange={e => setSimQuestion(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && simQuestion.trim() && !simulateFuture.isPending) {
                      simulateFuture.mutate(simQuestion.trim());
                    }
                  }}
                  placeholder="What decision are you facing?"
                  className="flex-1 bg-lattice-deep border border-lattice-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-neon-cyan"
                  disabled={simulateFuture.isPending}
                />
                <button
                  onClick={() => simQuestion.trim() && simulateFuture.mutate(simQuestion.trim())}
                  disabled={!simQuestion.trim() || simulateFuture.isPending}
                  className="px-3 py-2 bg-neon-cyan/20 text-neon-cyan rounded-lg hover:bg-neon-cyan/30 disabled:opacity-50"
                >
                  {simulateFuture.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                </button>
              </div>
              {simResult?.simulations && (
                <div className="mt-3 space-y-2">
                  {simResult.simulations.map((sim: { path: string; scenario: string; confidence: number }, i: number) => (
                    <div key={i} className="p-3 bg-lattice-deep rounded-lg">
                      <p className="text-xs font-medium text-neon-cyan">{sim.path}</p>
                      <p className="text-sm text-gray-300 mt-1">{sim.scenario}</p>
                      <p className="text-[10px] text-gray-500 mt-1">{Math.round(sim.confidence * 100)}% confidence</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Cognitive Clone */}
            <div className="p-4 border-t border-lattice-border">
              <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                <Brain className="w-3 h-3 text-neon-purple" /> Cognitive Clone
              </h4>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={cloneQuestion}
                  onChange={e => setCloneQuestion(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && cloneQuestion.trim() && !askClone.isPending) {
                      askClone.mutate(cloneQuestion.trim());
                    }
                  }}
                  placeholder="Ask your clone a question..."
                  className="flex-1 bg-lattice-deep border border-lattice-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-neon-purple"
                  disabled={askClone.isPending}
                />
                <button
                  onClick={() => cloneQuestion.trim() && askClone.mutate(cloneQuestion.trim())}
                  disabled={!cloneQuestion.trim() || askClone.isPending}
                  className="px-3 py-2 bg-neon-purple/20 text-neon-purple rounded-lg hover:bg-neon-purple/30 disabled:opacity-50"
                >
                  {askClone.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
              {cloneResult && (
                <div className="mt-3 p-3 bg-lattice-deep rounded-lg">
                  <p className="text-sm text-gray-300">{cloneResult.response}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[10px] text-neon-purple">{cloneResult.source}</span>
                    <span className="text-[10px] text-gray-500">{Math.round((cloneResult.confidence || 0) * 100)}% conf</span>
                  </div>
                  {cloneResult.disclaimer && (
                    <p className="text-[10px] text-gray-600 mt-1 italic">{cloneResult.disclaimer}</p>
                  )}
                </div>
              )}
            </div>

            {/* Circadian heatmap */}
            <div className="p-4 border-t border-lattice-border">
              <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Circadian Cognition</h4>
              <div className="flex gap-0.5">
                {Array.from({ length: 24 }, (_, h) => {
                  const data = circadian[h] || { count: 0, avgQuality: 0 };
                  const maxCount = Math.max(1, ...Object.values(circadian).map((d: unknown) => (d as { count?: number }).count || 0));
                  const intensity = data.count / maxCount;
                  return (
                    <div
                      key={h}
                      className="flex-1 flex flex-col items-center gap-0.5"
                      title={`${h}:00 — ${data.count} DTUs, quality: ${Math.round((data.avgQuality || 0) * 100)}%`}
                    >
                      <div
                        className="w-full rounded-sm"
                        style={{
                          height: `${Math.max(4, intensity * 40)}px`,
                          backgroundColor: `rgba(34, 211, 238, ${Math.max(0.1, intensity)})`,
                        }}
                      />
                      {h % 4 === 0 && <span className="text-[8px] text-gray-600">{h}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _CognitiveDigitalTwin = withErrorBoundary(CognitiveDigitalTwin);
export { _CognitiveDigitalTwin as CognitiveDigitalTwin };
