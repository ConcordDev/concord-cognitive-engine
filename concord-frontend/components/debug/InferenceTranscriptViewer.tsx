'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import {
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle,
  Clock,
  Brain,
  Wrench,
  Activity,
} from 'lucide-react';

interface Span {
  inferenceId: string;
  type: 'start' | 'step' | 'finish' | 'failure';
  timestamp: number;
  data: {
    brainUsed?: string;
    modelUsed?: string;
    tokensIn?: number;
    tokensOut?: number;
    latencyMs?: number;
    stepCount?: number;
    toolName?: string;
    lensId?: string;
    callerId?: string;
    role?: string;
    error?: string;
    terminated?: string;
  };
}

interface InferenceTrace {
  inferenceId: string;
  spans: Span[];
  summary: {
    brainUsed?: string;
    latencyMs?: number;
    tokensIn?: number;
    tokensOut?: number;
    stepCount?: number;
    failed?: boolean;
    terminated?: string;
  };
}

function SpanRow({ span }: { span: Span }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = Object.keys(span.data).length > 0;

  const typeStyle =
    {
      start: 'border-blue-500/40 bg-blue-500/5 text-blue-300',
      step: 'border-purple-500/40 bg-purple-500/5 text-purple-300',
      finish: 'border-green-500/40 bg-green-500/5 text-green-300',
      failure: 'border-red-500/40 bg-red-500/5 text-red-300',
    }[span.type] || 'border-white/10 bg-white/5 text-white/60';

  const TypeIcon =
    { start: Activity, step: Brain, finish: CheckCircle, failure: AlertCircle }[span.type] ||
    Activity;

  return (
    <div className={`border rounded p-2 text-xs ${typeStyle}`}>
      <div
        className="flex items-center gap-2 cursor-pointer select-none"
        onClick={() => hasDetails && setExpanded((e) => !e)}
      >
        {hasDetails ? (
          expanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )
        ) : (
          <span className="w-3" />
        )}
        <TypeIcon className="w-3 h-3" />
        <span className="font-medium">{span.type}</span>
        {span.data.brainUsed && <span className="text-white/40">{span.data.brainUsed}</span>}
        {span.data.toolName && (
          <span className="flex items-center gap-1">
            <Wrench className="w-3 h-3" />
            {span.data.toolName}
          </span>
        )}
        {span.data.latencyMs && (
          <span className="ml-auto flex items-center gap-1 text-white/40">
            <Clock className="w-3 h-3" />
            {span.data.latencyMs}ms
          </span>
        )}
        {(span.data.tokensIn || span.data.tokensOut) && (
          <span className="text-white/30">
            ↑{span.data.tokensIn || 0} ↓{span.data.tokensOut || 0}
          </span>
        )}
      </div>
      {expanded && hasDetails && (
        <pre className="mt-2 text-white/50 overflow-x-auto whitespace-pre-wrap text-xs">
          {JSON.stringify(span.data, null, 2)}
        </pre>
      )}
    </div>
  );
}

function TraceCard({ trace }: { trace: InferenceTrace }) {
  const [expanded, setExpanded] = useState(false);
  const { summary } = trace;
  const failed = summary?.failed;

  return (
    <div className="border border-white/10 rounded-lg overflow-hidden">
      <div
        className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-white/5 transition-colors ${failed ? 'border-b border-red-500/20' : ''}`}
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-white/40" />
        ) : (
          <ChevronRight className="w-4 h-4 text-white/40" />
        )}
        <span className={`w-2 h-2 rounded-full ${failed ? 'bg-red-400' : 'bg-green-400'}`} />
        <span className="font-mono text-xs text-white/60 flex-1 truncate">{trace.inferenceId}</span>
        {summary.brainUsed && (
          <span className="text-xs px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded">
            {summary.brainUsed}
          </span>
        )}
        {summary.latencyMs && (
          <span className="text-xs text-white/40 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {summary.latencyMs}ms
          </span>
        )}
        {summary.tokensIn !== undefined && (
          <span className="text-xs text-white/30">
            ↑{summary.tokensIn} ↓{summary.tokensOut}
          </span>
        )}
        {failed && <AlertCircle className="w-4 h-4 text-red-400" />}
      </div>
      {expanded && (
        <div className="p-3 space-y-1 bg-black/20">
          {trace.spans.map((span, i) => (
            <SpanRow key={i} span={span} />
          ))}
        </div>
      )}
    </div>
  );
}

function InferenceTranscriptViewer() {
  const [minLatency, setMinLatency] = useState('');
  const [filterInferenceId, setFilterInferenceId] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['inference-traces', minLatency, filterInferenceId],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '30' });
      if (minLatency) params.set('minLatency', minLatency);
      if (filterInferenceId) params.set('inferenceId', filterInferenceId);
      const res = await api.get(`/api/inference/traces?${params}`);
      return res.data;
    },
    refetchInterval: 10000,
  });

  const traces: InferenceTrace[] = data?.traces || [];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-2">
        <input
          type="text"
          value={filterInferenceId}
          onChange={(e) => setFilterInferenceId(e.target.value)}
          placeholder="Filter by inference ID"
          className="flex-1 bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
        />
        <input
          type="number"
          value={minLatency}
          onChange={(e) => setMinLatency(e.target.value)}
          placeholder="Min latency (ms)"
          className="w-36 bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
        />
        <button
          onClick={() => refetch()}
          className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-sm rounded transition-colors"
        >
          Refresh
        </button>
      </div>

      {isError && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          Failed to load traces: {(error as Error)?.message || 'Unknown error'}
        </div>
      )}

      {isLoading && <div className="text-xs text-white/40">Loading traces...</div>}

      {!isLoading && traces.length === 0 && (
        <div className="p-8 text-center text-sm text-white/30">
          No inference traces yet. Traces appear here after inference calls.
        </div>
      )}

      <div className="space-y-2">
        {traces.map((trace) => (
          <TraceCard key={trace.inferenceId} trace={trace} />
        ))}
      </div>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedInferenceTranscriptViewer = withErrorBoundary(InferenceTranscriptViewer);
export { _WrappedInferenceTranscriptViewer as InferenceTranscriptViewer };
