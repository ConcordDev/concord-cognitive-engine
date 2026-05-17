'use client';

/**
 * AgentSpecEditor — minimal JSON editor for agent manifests with the
 * server-side validator wired so authors see capability_denied / shape
 * errors before they publish.
 *
 * Phase 13 (Stage C). Deliberately not Monaco — that's a heavier add than
 * this needs. A plain textarea + the round-trip validate macro covers the
 * "author sees errors" outcome without bringing in 5MB of editor.
 */

import { useState, useCallback } from 'react';
import { Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const EXAMPLE_MANIFEST = `{
  "id": "agent:spec:translator",
  "name": "Document Translator",
  "version": "1.0.0",
  "creator_id": "user:me",
  "license": "MIT",
  "capabilities": [
    { "domain": "translation", "macros": ["translate", "batch_translate"] }
  ],
  "constraints": {
    "max_concurrent_tasks": 10,
    "memory_required_mb": 2048,
    "execution_timeout_s": 300
  },
  "description": "Fast document translation between supported languages",
  "summary": "Doc translator"
}`;

interface ValidationResult {
  ok: boolean;
  reason?: string;
  detail?: string;
  normalized?: Record<string, unknown>;
}

export interface AgentSpecEditorProps {
  initial?: string;
  /** Called whenever validation succeeds with the parsed + normalized manifest. */
  onValidated?: (manifest: Record<string, unknown>) => void;
  className?: string;
}

export function AgentSpecEditor({ initial, onValidated, className }: AgentSpecEditorProps) {
  const [source, setSource] = useState(initial ?? EXAMPLE_MANIFEST);
  const [validating, setValidating] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [parseErr, setParseErr] = useState<string | null>(null);

  const validate = useCallback(async () => {
    setParseErr(null);
    setResult(null);
    let manifest: unknown;
    try {
      manifest = JSON.parse(source);
    } catch (e) {
      setParseErr(e instanceof Error ? e.message : 'Invalid JSON');
      return;
    }
    setValidating(true);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'agent', name: 'validate', input: { manifest },
      });
      const body = (r?.data ?? {}) as ValidationResult;
      setResult(body);
      if (body.ok && body.normalized && onValidated) {
        onValidated(body.normalized);
      }
    } catch (e) {
      setResult({ ok: false, reason: 'request_failed', detail: e instanceof Error ? e.message : 'network error' });
    } finally {
      setValidating(false);
    }
  }, [source, onValidated]);

  return (
    <div data-testid="agent-spec-editor" className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between">
        <label className="text-[11px] uppercase tracking-wider text-zinc-400">Agent manifest (JSON)</label>
        <button
          type="button"
          onClick={validate}
          disabled={validating}
          className="px-3 py-1.5 text-xs rounded bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-100 border border-emerald-500/40 inline-flex items-center gap-1.5 disabled:opacity-40"
        >
          {validating ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
          Validate
        </button>
      </div>
      <textarea
        value={source}
        onChange={(e) => setSource(e.target.value)}
        rows={18}
        spellCheck={false}
        className="w-full font-mono text-[11px] bg-zinc-950 border border-zinc-800 rounded p-2 text-zinc-100 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 resize-none"
      />
      {parseErr && (
        <div className="px-2 py-1 rounded border border-rose-500/40 bg-rose-500/10 text-[11px] text-rose-200 inline-flex gap-1">
          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
          JSON parse error: {parseErr}
        </div>
      )}
      {result && (
        <div
          data-testid="agent-spec-validation-result"
          data-ok={result.ok ? '1' : '0'}
          className={cn(
            'px-2 py-1 rounded border text-[11px] inline-flex gap-1',
            result.ok
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-200',
          )}
        >
          {result.ok
            ? <><CheckCircle className="w-3 h-3 mt-0.5" /> Manifest validates ({(result.normalized?.capabilities as unknown[])?.length || 0} capability group(s))</>
            : <><AlertTriangle className="w-3 h-3 mt-0.5" /> {result.reason}{result.detail ? `: ${result.detail}` : ''}</>}
        </div>
      )}
    </div>
  );
}

export default AgentSpecEditor;
