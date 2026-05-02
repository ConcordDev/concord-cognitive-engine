'use client';
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { Layers, Sparkles, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react';

interface LensTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
}

interface TemplatesResponse {
  ok: boolean;
  templates: LensTemplate[];
}

interface GenerateResponse {
  ok: boolean;
  lens: object;
}

const DEFAULT_CONFIG = '{"domain": ""}';

function LensTemplateGenerator() {
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [configText, setConfigText] = useState(DEFAULT_CONFIG);
  const [generatedLens, setGeneratedLens] = useState<object | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<TemplatesResponse>({
    queryKey: ['lens-templates'],
    queryFn: () => api.get('/api/lens-features/templates').then((r) => r.data),
  });

  const generateMutation = useMutation<
    GenerateResponse,
    Error,
    { template: string; config: object }
  >({
    mutationFn: (payload) => api.post('/api/lens-features/generate', payload).then((r) => r.data),
    onSuccess: (res) => {
      setGeneratedLens(res.lens);
      setGenError(null);
    },
    onError: (err: Error) => {
      setGenError(err.message);
      setGeneratedLens(null);
    },
  });

  const templates: LensTemplate[] = data?.templates ?? [];

  const handleGenerate = () => {
    if (!selectedTemplate) return;
    let config: object = {};
    try {
      const parsed = JSON.parse(configText);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        config = parsed;
      } else {
        setGenError('Config must be a JSON object');
        return;
      }
    } catch {
      setGenError('Invalid JSON in config');
      return;
    }
    setGenError(null);
    generateMutation.mutate({ template: selectedTemplate, config });
  };

  // Group templates by category
  const byCategory = templates.reduce<Record<string, LensTemplate[]>>((acc, t) => {
    const cat = t.category || 'general';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(t);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Layers className="w-6 h-6 text-neon-purple" />
        <h2 className="text-xl font-bold text-gray-100">Lens Template Generator</h2>
        <span className="text-xs px-2 py-0.5 rounded-full bg-neon-purple/10 text-neon-purple border border-neon-purple/20">
          Generate
        </span>
      </div>

      {/* Template grid */}
      <div className="bg-lattice-surface border border-lattice-border rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-300">Select Template</h3>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 bg-lattice-deep animate-pulse rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex items-center gap-2 text-sm text-neon-orange px-3 py-2 bg-neon-orange/5 border border-neon-orange/20 rounded-lg">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Failed to load templates
          </div>
        ) : templates.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No templates available</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(byCategory).map(([category, catTemplates]) => (
              <div key={category}>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                  {category}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {catTemplates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTemplate(t.id)}
                      className={`text-left p-4 rounded-lg border transition-colors ${
                        selectedTemplate === t.id
                          ? 'border-neon-purple/50 bg-neon-purple/10 text-gray-100'
                          : 'border-lattice-border bg-lattice-deep text-gray-300 hover:border-neon-purple/30 hover:bg-neon-purple/5'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-sm font-medium leading-snug">{t.name}</p>
                        {selectedTemplate === t.id && (
                          <CheckCircle2 className="w-4 h-4 text-neon-purple shrink-0" />
                        )}
                      </div>
                      {t.description && (
                        <p className="text-xs text-gray-500 line-clamp-2">{t.description}</p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Config and generate */}
      <div className="bg-lattice-surface border border-lattice-border rounded-lg p-5 space-y-4">
        <div>
          <label className="text-xs text-gray-400 block mb-1.5">Config (JSON object)</label>
          <textarea
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
            rows={4}
            placeholder='{"domain": ""}'
            className="w-full bg-lattice-deep border border-lattice-border rounded-lg px-4 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-neon-purple/50 font-mono resize-none"
          />
        </div>

        <button
          onClick={handleGenerate}
          disabled={!selectedTemplate || generateMutation.isPending}
          className="flex items-center gap-2 px-5 py-2.5 bg-neon-purple/10 text-neon-purple border border-neon-purple/20 rounded-lg text-sm font-medium hover:bg-neon-purple/20 disabled:opacity-50 transition-colors"
        >
          {generateMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Generating...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" /> Generate Lens
            </>
          )}
        </button>
      </div>

      {/* Error display */}
      {genError && (
        <div className="flex items-start gap-2 px-4 py-3 bg-neon-orange/5 border border-neon-orange/20 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-neon-orange shrink-0 mt-0.5" />
          <p className="text-sm text-neon-orange">{genError}</p>
        </div>
      )}

      {/* Generated lens result */}
      {generatedLens !== null && (
        <div className="bg-lattice-surface border border-lattice-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-neon-purple" />
            Generated Lens
          </h3>
          <pre className="bg-lattice-deep rounded-lg p-4 text-sm font-mono text-neon-cyan overflow-auto max-h-80">
            {JSON.stringify(generatedLens, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedLensTemplateGenerator = withErrorBoundary(LensTemplateGenerator);
export { _WrappedLensTemplateGenerator as LensTemplateGenerator };
export default _WrappedLensTemplateGenerator;
