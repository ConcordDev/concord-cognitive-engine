'use client';

import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Globe,
  Calculator,
  Link,
  Database,
  Zap,
  CheckCircle,
  XCircle,
} from 'lucide-react';

export interface ToolCall {
  tool: string;
  params: Record<string, unknown>;
  result: unknown;
  ok: boolean;
  key?: string; // for run_compute
  url?: string; // for browse_url
  title?: string; // for browse_url / create_dtu
}

interface ToolCallCardProps {
  call: ToolCall;
}

const TOOL_META: Record<string, { icon: React.ComponentType<{ className?: string; size?: number | string }>; label: string; color: string }> = {
  web_search: { icon: Globe, label: 'Web Search', color: 'text-blue-400' },
  run_compute: { icon: Calculator, label: 'Compute', color: 'text-green-400' },
  browse_url: { icon: Link, label: 'Browse URL', color: 'text-purple-400' },
  create_dtu: { icon: Database, label: 'Saved to Memory', color: 'text-yellow-400' },
  run_lens_action: { icon: Zap, label: 'Lens Action', color: 'text-neon-cyan' },
};

function WebSearchResult({ result }: { result: unknown }) {
  const r = result as { source?: string; result?: string } | null;
  if (!r) return null;
  return (
    <div className="space-y-1">
      {r.source && <p className="text-xs text-gray-500 font-mono">{r.source}</p>}
      {r.result && <p className="text-xs text-gray-300 leading-relaxed line-clamp-3">{r.result}</p>}
    </div>
  );
}

function ComputeResult({ call }: { call: ToolCall }) {
  const result = call.result as Record<string, unknown> | null;
  if (!result) return null;

  // Show top-level scalar values in a compact grid
  const entries = Object.entries(result)
    .filter(
      ([k, v]) =>
        k !== 'ok' && (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')
    )
    .slice(0, 8);

  return (
    <div className="space-y-1.5">
      {call.key && <p className="text-xs font-mono text-green-400/70">{call.key}</p>}
      {entries.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-1.5">
              <span className="text-[10px] text-gray-500 shrink-0">{k}</span>
              <span className="text-xs font-mono text-green-300 truncate">
                {typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(4)) : String(v)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <pre className="text-xs text-gray-300 overflow-x-auto max-h-32">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}

function BrowseResult({ call }: { call: ToolCall }) {
  const result = call.result as { title?: string; text?: string; url?: string } | null;
  if (!result) return null;
  return (
    <div className="space-y-1">
      {result.url && (
        <a
          href={result.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-purple-400 hover:text-purple-300 font-mono truncate block"
        >
          {result.url}
        </a>
      )}
      {result.title && <p className="text-xs font-medium text-gray-200">{result.title}</p>}
      {result.text && (
        <p className="text-xs text-gray-400 line-clamp-3 leading-relaxed">{result.text}</p>
      )}
    </div>
  );
}

function LensActionResult({ call }: { call: ToolCall }) {
  const domain = String(call.params?.domain || '');
  const action = String(call.params?.action || '');
  const result = call.result as Record<string, unknown> | null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-mono text-neon-cyan/70">
        {domain}.{action}
      </p>
      {result && (
        <pre className="text-xs text-gray-300 overflow-x-auto max-h-32 whitespace-pre-wrap">
          {JSON.stringify(result, null, 2).slice(0, 500)}
        </pre>
      )}
    </div>
  );
}

function DTUResult({ call }: { call: ToolCall }) {
  return (
    <p className="text-xs text-yellow-300">
      Saved: &ldquo;{call.title || String(call.params?.title || 'Note')}&rdquo; to your knowledge
      base.
    </p>
  );
}

export function ToolCallCard({ call }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const meta = TOOL_META[call.tool] ?? { icon: Zap, label: call.tool, color: 'text-gray-400' };
  const Icon = meta.icon;

  const hasContent = call.ok && call.result != null;

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] overflow-hidden text-sm">
      <button
        onClick={() => hasContent && setExpanded((e) => !e)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left ${hasContent ? 'hover:bg-white/5' : ''}`}
      >
        <Icon className={`w-3.5 h-3.5 shrink-0 ${meta.color}`} />
        <span className={`text-xs font-medium ${meta.color}`}>{meta.label}</span>
        <span className="text-xs text-gray-500 truncate flex-1">
          {call.tool === 'web_search' && String(call.params?.query || '')}
          {call.tool === 'run_compute' && String(call.key || call.params?.key || '')}
          {call.tool === 'browse_url' && String(call.url || call.params?.url || '')}
          {call.tool === 'run_lens_action' && `${call.params?.domain}.${call.params?.action}`}
          {call.tool === 'create_dtu' && String(call.params?.title || '')}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {call.ok ? (
            <CheckCircle className="w-3 h-3 text-green-400" />
          ) : (
            <XCircle className="w-3 h-3 text-red-400" />
          )}
          {hasContent &&
            (expanded ? (
              <ChevronDown className="w-3 h-3 text-gray-500" />
            ) : (
              <ChevronRight className="w-3 h-3 text-gray-500" />
            ))}
        </div>
      </button>

      {expanded && hasContent && (
        <div className="px-3 pb-3 pt-0 border-t border-white/5">
          {!call.ok && (
            <p className="text-xs text-red-400 mt-2">
              Error: {String((call.result as { error?: string })?.error || 'Unknown error')}
            </p>
          )}
          {call.ok && call.tool === 'web_search' && <WebSearchResult result={call.result} />}
          {call.ok && call.tool === 'run_compute' && <ComputeResult call={call} />}
          {call.ok && call.tool === 'browse_url' && <BrowseResult call={call} />}
          {call.ok && call.tool === 'run_lens_action' && <LensActionResult call={call} />}
          {call.ok && call.tool === 'create_dtu' && <DTUResult call={call} />}
        </div>
      )}
    </div>
  );
}
