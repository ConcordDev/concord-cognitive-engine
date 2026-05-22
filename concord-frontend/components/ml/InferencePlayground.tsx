'use client';

/**
 * InferencePlayground — run a Hugging Face hosted model on user input
 * in-lens. Wires ml.playground-infer.
 */

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Play, Loader2, Copy, Download, TestTube, Code, FileJson } from 'lucide-react';

interface InferResult {
  modelId: string;
  input: string;
  output: unknown;
  latencyMs: number;
  source: string;
}

export function InferencePlayground({ initialModel = '' }: { initialModel?: string }) {
  const [modelId, setModelId] = useState(initialModel);
  const [input, setInput] = useState('');
  const [result, setResult] = useState<InferResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // sync external model selection
  if (initialModel && initialModel !== modelId && !running && !result) {
    setModelId(initialModel);
  }

  const run = async () => {
    if (!modelId.trim() || !input.trim()) return;
    setRunning(true);
    setError(null);
    setResult(null);
    const r = await lensRun('ml', 'playground-infer', { modelId: modelId.trim(), input });
    if (r.data?.ok && r.data.result) {
      setResult(r.data.result as InferResult);
    } else {
      setError(r.data?.error || 'Inference failed');
    }
    setRunning(false);
  };

  const copyOut = () => {
    if (result) navigator.clipboard.writeText(JSON.stringify(result.output, null, 2));
  };
  const exportOut = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.output, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ml-inference-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <TestTube className="w-4 h-4 text-neon-purple" /> Inference Playground
        </h3>
        <p className="text-xs text-gray-500">
          Runs against the Hugging Face hosted Inference API. First call may cold-start the model.
        </p>
        <div>
          <label className="text-sm text-gray-400 block mb-1">Model ID</label>
          <input
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder="e.g. distilbert-base-uncased-finetuned-sst-2-english"
            className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm font-mono focus:border-neon-purple outline-none"
          />
        </div>
        <div>
          <label className="text-sm text-gray-400 block mb-1">Input</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter prompt or text to classify..."
            className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg h-40 text-sm focus:border-neon-purple outline-none resize-none"
          />
        </div>
        <button
          onClick={run}
          disabled={!modelId.trim() || !input.trim() || running}
          className="btn-neon purple w-full disabled:opacity-50"
        >
          {running ? <Loader2 className="w-4 h-4 mr-2 inline animate-spin" /> : <Play className="w-4 h-4 mr-2 inline" />}
          {running ? 'Running inference...' : 'Run Inference'}
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      <div className="space-y-3">
        <h3 className="font-semibold flex items-center gap-2">
          <Code className="w-4 h-4 text-neon-green" /> Output
          {result && <span className="text-xs text-gray-500 font-normal">· {result.latencyMs}ms</span>}
        </h3>
        <div className="panel p-4 h-[340px] overflow-auto">
          {result ? (
            <pre className="text-xs font-mono text-neon-green whitespace-pre-wrap">
              {JSON.stringify(result.output, null, 2)}
            </pre>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500">
              <div className="text-center">
                <FileJson className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Run inference to see output</p>
              </div>
            </div>
          )}
        </div>
        {result && (
          <div className="flex gap-2">
            <button className="btn-neon small flex-1" onClick={copyOut}>
              <Copy className="w-3 h-3 mr-1" /> Copy
            </button>
            <button className="btn-neon small flex-1" onClick={exportOut}>
              <Download className="w-3 h-3 mr-1" /> Export
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
