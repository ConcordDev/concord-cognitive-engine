'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useMutation } from '@tanstack/react-query';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Wand2, Plus, Code, Eye, Trash2, Copy, Settings, Layers, ChevronDown, Palette, Sliders, Loader2, XCircle } from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ErrorState } from '@/components/common/EmptyState';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

interface CustomLens {
  id: string;
  name: string;
  description: string;
  config: object;
  createdAt: string;
  isActive: boolean;
}

interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  valid: boolean;
}

interface ValidationResult {
  field: string;
  passed: boolean;
  reason?: string;
}

export default function CustomLensPage() {
  useLensNav('custom');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('custom');

  const [showFeatures, setShowFeatures] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);

  // ── Backend action state ───────────────────────────────────────────────────
  const runAction = useRunArtifact('custom');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunningAction, setIsRunningAction] = useState(false);

  const handleRunAction = async (action: string) => {
    const targetId = lensItems[0]?.id ?? 'custom-default';
    setIsRunningAction(true);
    setActionResult(null);
    try {
      const result = await runAction.mutateAsync({ id: targetId, action });
      setActionResult(result as Record<string, unknown>);
    } catch (err) {
      setActionResult({ error: err instanceof Error ? err.message : 'Action failed' });
    } finally {
      setIsRunningAction(false);
    }
  };
  const [newLensName, setNewLensName] = useState('');
  const [newLensConfig, setNewLensConfig] = useState('{}');
  const [selectedLens, setSelectedLens] = useState<string | null>(null);

  const { items: lensItems, isLoading, isError: isError, error: error, refetch: refetch, create: createLensItem, remove: removeLensItem, update: updateLensItem } = useLensData<Record<string, unknown>>('custom', 'lens-config', { seed: [] });
  const customLenses = lensItems.map(i => ({ id: i.id, name: i.title, config: i.data, ...(i.data || {}) })) as unknown as CustomLens[];

  const { items: templateItems, isError: isError2, error: error2, refetch: refetch2 } = useLensData<Record<string, unknown>>('custom', 'lens-template', { seed: [] });
  const templates = templateItems.map(i => ({ id: i.id, name: i.title, ...(i.data || {}) })) as unknown as Record<string, unknown>[];

  const createLens = useMutation({
    mutationFn: (payload: { name: string; config: string }) => {
      let parsed;
      try { parsed = JSON.parse(payload.config); } catch { throw new Error('Invalid JSON in lens configuration'); }
      return createLensItem({ title: payload.name, data: parsed });
    },
    onSuccess: () => {
      refetch();
      setShowBuilder(false);
      setNewLensName('');
      setNewLensConfig('{}');
    },
    onError: (err) => console.error('createLens failed:', err instanceof Error ? err.message : err),
  });

  const deleteLens = useMutation({
    mutationFn: (id: string) => removeLensItem(id),
    onSuccess: () => {
      refetch();
      setSelectedLens(null);
    },
    onError: (err) => console.error('deleteLens failed:', err instanceof Error ? err.message : err),
  });

  const toggleLens = useMutation({
    mutationFn: (id: string) => {
      const lens = lensItems.find(i => i.id === id);
      const currentEnabled = (lens?.data as Record<string, unknown>)?.enabled ?? true;
      return updateLensItem(id, { data: { ...((lens?.data as Record<string, unknown>) || {}), enabled: !currentEnabled } });
    },
    onSuccess: () => {
      refetch();
    },
    onError: (err) => console.error('toggleLens failed:', err instanceof Error ? err.message : err),
  });


  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError || isError2) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message} onRetry={() => { refetch(); refetch2(); }} />
      </div>
    );
  }
  return (
    <div data-lens-theme="custom" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔧</span>
          <div>
            <h1 className="text-xl font-bold">Custom Lens Builder</h1>
            <p className="text-sm text-gray-400">
              Create and manage custom lens configurations
            </p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="custom" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <button
          onClick={() => setShowBuilder(!showBuilder)}
          className="btn-neon purple"
        >
          <Plus className="w-4 h-4 mr-2 inline" />
          New Lens
        </button>
      </header>


      {/* AI Actions */}
      <UniversalActions domain="custom" artifactId={lensItems[0]?.id} compact />

      {/* Stat Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Palette, color: 'text-neon-purple', value: customLenses?.length || 0, label: 'Custom Lenses' },
          { icon: Settings, color: 'text-neon-cyan', value: customLenses?.filter((l: CustomLens) => l.isActive).length || 0, label: 'Active' },
          { icon: Sliders, color: 'text-neon-green', value: templates?.length || 0, label: 'Templates' },
          { icon: Code, color: 'text-amber-400', value: customLenses?.reduce((s: number, l: CustomLens) => s + (l.config ? Object.keys(l.config).length : 0), 0) || 0, label: 'Config Keys' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="lens-card"
          >
            <stat.icon className={`w-5 h-5 ${stat.color} mb-2`} />
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-sm text-gray-400">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Lens Builder Modal */}
      {showBuilder && (
        <div className="panel p-4 space-y-4 border-neon-purple">
          <h3 className="font-semibold flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-neon-purple" />
            Create Custom Lens
          </h3>

          <div className="space-y-4">
            <div>
              <label className="text-sm text-gray-400 block mb-1">Lens Name</label>
              <input
                type="text"
                value={newLensName}
                onChange={(e) => setNewLensName(e.target.value)}
                placeholder="My Custom Lens"
                className="input-lattice"
              />
            </div>

            <div>
              <label className="text-sm text-gray-400 block mb-1">
                Configuration (JSON)
              </label>
              <textarea
                value={newLensConfig}
                onChange={(e) => setNewLensConfig(e.target.value)}
                placeholder='{"widgets": [], "layout": "grid"}'
                className="input-lattice font-mono text-sm h-40 resize-none"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => createLens.mutate({ name: newLensName, config: newLensConfig })}
                disabled={!newLensName || createLens.isPending}
                className="btn-neon purple flex-1"
              >
                {createLens.isPending ? 'Creating...' : 'Create Lens'}
              </button>
              <button onClick={() => setShowBuilder(false)} className="btn-neon">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Custom Lenses List */}
        <div className="panel p-4 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Settings className="w-4 h-4 text-neon-blue" />
            Your Custom Lenses
          </h3>

          <div className="space-y-2">
            {customLenses?.length === 0 ? (
              <p className="text-center py-8 text-gray-500">
                No custom lenses yet. Create your first one!
              </p>
            ) : (
              customLenses?.map((lens: CustomLens, i: number) => (
                <motion.button
                  key={lens.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  onClick={() => setSelectedLens(lens.id)}
                  className={`w-full text-left lens-card transition-all ${
                    selectedLens === lens.id ? 'border-neon-cyan ring-1 ring-neon-cyan' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{lens.name}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        lens.isActive
                          ? 'bg-neon-green/20 text-neon-green'
                          : 'bg-gray-500/20 text-gray-400'
                      }`}
                    >
                      {lens.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Created {new Date(lens.createdAt).toLocaleDateString()}
                  </p>
                </motion.button>
              ))
            )}
          </div>
        </div>

        {/* Lens Detail / Preview */}
        <div className="lg:col-span-2 panel p-4 space-y-4">
          {selectedLens ? (
            <>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2">
                  <Eye className="w-4 h-4 text-neon-cyan" />
                  Lens Preview
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => toggleLens.mutate(selectedLens)}
                    disabled={toggleLens.isPending}
                    className="btn-neon text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {toggleLens.isPending ? 'Processing...' : customLenses?.find((l: CustomLens) => l.id === selectedLens)?.isActive
                      ? 'Deactivate'
                      : 'Activate'}
                  </button>
                  <button
                    onClick={() => deleteLens.mutate(selectedLens)}
                    disabled={deleteLens.isPending}
                    className="btn-neon pink text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {deleteLens.isPending ? '...' : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Customization Preview Card */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="graph-container relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-neon-purple/5 to-neon-cyan/5 flex items-center justify-center">
                  <div className="text-center space-y-3">
                    <div className="grid grid-cols-3 gap-2 mx-auto max-w-xs">
                      {[...Array(6)].map((_, i) => (
                        <div key={i} className={`h-12 rounded-lg animate-pulse ${i % 3 === 0 ? 'bg-neon-purple/20' : i % 3 === 1 ? 'bg-neon-cyan/20' : 'bg-neon-green/20'}`} style={{ animationDelay: `${i * 0.2}s` }} />
                      ))}
                    </div>
                    <p className="text-sm text-gray-400">Live preview of lens layout</p>
                  </div>
                </div>
              </motion.div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Configuration</span>
                  <button onClick={() => { const cfg = customLenses?.find((l: CustomLens) => l.id === selectedLens)?.config; if (cfg) navigator.clipboard.writeText(JSON.stringify(cfg, null, 2)); }} className="text-gray-400 hover:text-white">
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
                <pre className="bg-lattice-deep p-4 rounded-lg text-sm font-mono overflow-auto max-h-48">
                  {JSON.stringify(
                    customLenses?.find((l: CustomLens) => l.id === selectedLens)?.config,
                    null,
                    2
                  )}
                </pre>
              </div>
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500">
              <div className="text-center">
                <Wand2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Select a lens to preview</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Templates */}
      <div className="panel p-4">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Code className="w-4 h-4 text-neon-purple" />
          Lens Templates
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates?.map((template: Record<string, unknown>) => (
            <div key={template.id as string} className="lens-card">
              <span className="text-2xl">{String(template.icon)}</span>
              <h4 className="font-semibold mt-2">{String(template.name)}</h4>
              <p className="text-sm text-gray-400 mt-1">{String(template.description)}</p>
              <button
                onClick={() => {
                  setNewLensName(template.name as string);
                  setNewLensConfig(JSON.stringify(template.config, null, 2));
                  setShowBuilder(true);
                }}
                className="btn-neon text-sm w-full mt-3"
              >
                Use Template
              </button>
            </div>
          ))}
        </div>

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="custom"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
      </div>

      {/* Backend Actions Panel */}
      <div className="panel p-4 space-y-4">
        <h3 className="font-semibold flex items-center gap-2 text-sm text-gray-300 uppercase tracking-wider">
          <Wand2 className="w-4 h-4 text-neon-purple" />
          Custom Actions
        </h3>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'evaluateSchema', label: 'Evaluate Schema' },
            { action: 'templateRender', label: 'Render Template' },
            { action: 'validateData', label: 'Validate Data' },
            { action: 'transformData', label: 'Transform Data' },
          ].map(({ action, label }) => (
            <button
              key={action}
              onClick={() => handleRunAction(action)}
              disabled={isRunningAction}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-neon-purple/10 text-neon-purple border border-neon-purple/30 hover:bg-neon-purple/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isRunningAction ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Code className="w-3.5 h-3.5" />}
              {label}
            </button>
          ))}
        </div>
        {actionResult && (
          <div className="relative rounded-lg bg-lattice-deep border border-lattice-border p-4">
            <button
              onClick={() => setActionResult(null)}
              className="absolute top-2 right-2 text-gray-500 hover:text-white transition-colors"
              aria-label="Dismiss result"
            >
              <XCircle className="w-4 h-4" />
            </button>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Result</p>
            {(() => {
              const r = (actionResult?.['result'] as Record<string, unknown> | undefined) ?? actionResult;
              const errorMsg = typeof actionResult?.['error'] === 'string' ? (actionResult['error'] as string) : null;
              if (!r) return null;
              return (
                <div className="text-xs space-y-3 max-h-72 overflow-y-auto">
                  {/* Error */}
                  {errorMsg != null ? (
                    <p className="text-red-400">{String(errorMsg)}</p>
                  ) : null}
                  {/* Message-only result */}
                  {r?.message != null && !r?.error ? (
                    <p className="text-gray-300">{String(r.message)}</p>
                  ) : null}

                  {/* evaluateSchema */}
                  {r?.fields !== undefined && r?.totalFields !== undefined ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className="text-sm font-bold text-neon-cyan">{String(r.totalFields)}</p>
                          <p className="text-[10px] text-gray-500">Total Fields</p>
                        </div>
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className="text-sm font-bold text-neon-green">{String(r.validFields)}</p>
                          <p className="text-[10px] text-gray-500">Valid</p>
                        </div>
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className="text-sm font-bold text-yellow-400">{String(r.requiredCount)}</p>
                          <p className="text-[10px] text-gray-500">Required</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">Schema:</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${r.schemaValid ? 'bg-neon-green/20 text-neon-green' : 'bg-red-500/20 text-red-400'}`}>
                          {r.schemaValid ? 'valid' : 'invalid'}
                        </span>
                        {(r.types as string[] || []).length > 0 && (
                          <span className="ml-auto text-gray-500 text-[10px]">Types: {(r.types as string[]).join(', ')}</span>
                        )}
                      </div>
                      <div className="space-y-1">
                        {((r.fields as SchemaField[]) || []).map((f: SchemaField, i: number) => (
                          <div key={i} className="flex items-center justify-between px-2 py-1 bg-lattice-bg rounded">
                            <span className="text-gray-200 font-mono">{f.name}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-gray-500 text-[10px]">{f.type}</span>
                              {f.required && <span className="px-1.5 py-0.5 rounded text-[9px] bg-yellow-500/20 text-yellow-400">req</span>}
                              <span className={f.valid ? 'text-neon-green' : 'text-red-400'}>{f.valid ? '✓' : '✗'}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* templateRender */}
                  {r?.rendered !== undefined ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${r.complete ? 'bg-neon-green/20 text-neon-green' : 'bg-yellow-500/20 text-yellow-400'}`}>
                          {r.complete ? 'complete' : 'missing vars'}
                        </span>
                      </div>
                      <div className="p-2 bg-lattice-bg rounded">
                        <p className="text-[10px] text-gray-500 mb-1 uppercase">Rendered</p>
                        <p className="text-gray-200 whitespace-pre-wrap">{String(r.rendered)}</p>
                      </div>
                      {(r.variablesFound as string[] || []).length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {(r.variablesFound as string[]).map((v: string) => (
                            <span key={v} className="px-1.5 py-0.5 rounded text-[10px] bg-neon-green/10 text-neon-green">{v}</span>
                          ))}
                        </div>
                      )}
                      {(r.variablesMissing as string[] || []).length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          <span className="text-[10px] text-gray-500">Missing:</span>
                          {(r.variablesMissing as string[]).map((v: string) => (
                            <span key={v} className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400">{v}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}

                  {/* validateData */}
                  {r?.results !== undefined && r?.totalRules !== undefined ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className="text-sm font-bold text-neon-cyan">{String(r.totalRules)}</p>
                          <p className="text-[10px] text-gray-500">Rules</p>
                        </div>
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className="text-sm font-bold text-neon-green">{String(r.passed)}</p>
                          <p className="text-[10px] text-gray-500">Passed</p>
                        </div>
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className="text-sm font-bold text-red-400">{String(r.failed)}</p>
                          <p className="text-[10px] text-gray-500">Failed</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">Data:</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${r.valid ? 'bg-neon-green/20 text-neon-green' : 'bg-red-500/20 text-red-400'}`}>
                          {r.valid ? 'valid' : 'invalid'}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {((r.results as ValidationResult[]) || []).map((res: ValidationResult, i: number) => (
                          <div key={i} className={`flex items-center justify-between px-2 py-1 rounded ${res.passed ? 'bg-neon-green/5' : 'bg-red-500/10'}`}>
                            <span className="text-gray-300 font-mono">{res.field}</span>
                            <span className={`text-[10px] ${res.passed ? 'text-neon-green' : 'text-red-400'}`}>{res.passed ? 'OK' : res.reason}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* transformData */}
                  {r?.log !== undefined && r?.output !== undefined ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">Transforms applied:</span>
                        <span className="text-neon-cyan font-bold">{String(r.transformsApplied)}</span>
                      </div>
                      <div className="space-y-1">
                        {((r.log as string[]) || []).map((entry: string, i: number) => (
                          <div key={i} className="px-2 py-1 bg-lattice-bg rounded text-gray-300 font-mono text-[10px]">
                            {entry}
                          </div>
                        ))}
                      </div>
                      <div className="p-2 bg-lattice-bg rounded">
                        <p className="text-[10px] text-gray-500 mb-1 uppercase">Output</p>
                        {Object.entries(r.output as Record<string, unknown> || {}).map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between text-[11px]">
                            <span className="text-gray-500 font-mono">{k}</span>
                            <span className="text-gray-200">{String(v)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="custom" />
          </div>
        )}
      </div>
    </div>
  );
}
