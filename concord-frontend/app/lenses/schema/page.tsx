'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useMutation } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useState } from 'react';
import { FileCode, Plus, Check, X, Database, Code, FileJson, Tag, Zap } from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { motion } from 'framer-motion';
import { ErrorState } from '@/components/common/EmptyState';
import { showToast } from '@/components/common/Toasts';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

export default function SchemaLensPage() {
  useLensNav('schema');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('schema');
  const [showCreate, setShowCreate] = useState(false);
  const [validateData, setValidateData] = useState({ schemaName: '', data: '' });
  const [validationResult, setValidationResult] = useState<{ valid: boolean; errors?: { field: string; error: string }[] } | null>(null);

  const { items: schemaItems, isLoading, isError: isError, error: error, refetch: refetch, create: createSchemaItem } = useLensData<Record<string, unknown>>('schema', 'definition', { seed: [] });
  const schemas = schemaItems.map(i => ({ id: i.id, name: i.title, ...(i.data || {}) })) as unknown as Record<string, unknown>[];

  const createMutation = useMutation({
    mutationFn: (data: unknown) => createSchemaItem({ title: (data as Record<string, string>)?.name || 'schema', data: data as Record<string, unknown> }),
    onSuccess: () => {
      refetch();
      setShowCreate(false);
    },
    onError: (err) => {
      console.error('Schema creation failed:', err instanceof Error ? err.message : err);
      showToast('error', 'Schema creation failed');
    },
  });

  const validateMutation = useMutation({
    mutationFn: (data: { schemaName: string; data: unknown }) =>
      apiHelpers.lens.run('schema', data.schemaName, { action: 'validate', params: data }),
    onSuccess: (result) => setValidationResult(result.data),
    onError: (err) => {
      setValidationResult({ valid: false, errors: [{ field: 'API', error: err instanceof Error ? err.message : 'Validation request failed' }] });
    },
  });

  const runSchemaAction = useRunArtifact('schema');
  const [schemaActionResult, setSchemaActionResult] = useState<Record<string, unknown> | null>(null);
  const [schemaActiveAction, setSchemaActiveAction] = useState<string | null>(null);

  const handleSchemaAction = async (action: string) => {
    const id = schemaItems[0]?.id;
    if (!id) return;
    setSchemaActiveAction(action);
    try {
      const res = await runSchemaAction.mutateAsync({ id, action });
      if (res.ok === false) { setSchemaActionResult({ action, message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setSchemaActionResult({ action, ...(res.result as Record<string, unknown>) }); }
    } catch (err) { console.error('Schema action failed:', err); }
    finally { setSchemaActiveAction(null); }
  };

  const handleValidate = () => {
    try {
      const parsed = JSON.parse(validateData.data);
      validateMutation.mutate({ schemaName: validateData.schemaName, data: parsed });
    } catch {
      setValidationResult({ valid: false, errors: [{ field: 'JSON', error: 'Invalid JSON' }] });
    }
  };


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

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }
  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileCode className="w-8 h-8 text-neon-cyan" />
          <div>
            <h1 className="text-xl font-bold">Dynamic Schemas</h1>
            <p className="text-sm text-gray-400">
              Create and manage DTU schema templates (CRETI enhanced)
            </p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="schema" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Create Schema
        </button>
      </header>


      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="lens-card">
          <Database className="w-5 h-5 text-neon-cyan mb-2" />
          <p className="text-2xl font-bold text-neon-cyan">{schemas.length}</p>
          <p className="text-sm text-gray-400">Total Schemas</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="lens-card">
          <Code className="w-5 h-5 text-neon-green mb-2" />
          <p className="text-2xl font-bold text-neon-green">
            {schemas.reduce((sum, s) => sum + ((s.fields as unknown[])?.length || 0), 0)}
          </p>
          <p className="text-sm text-gray-400">Total Fields</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="lens-card">
          <FileJson className="w-5 h-5 text-neon-purple mb-2" />
          <p className="text-2xl font-bold text-neon-purple">
            {new Set(schemas.map(s => s.kind as string).filter(Boolean)).size}
          </p>
          <p className="text-sm text-gray-400">Unique Kinds</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="lens-card">
          <Check className="w-5 h-5 text-neon-green mb-2" />
          <p className="text-2xl font-bold text-neon-green">{validationResult?.valid ? 'Pass' : '--'}</p>
          <p className="text-sm text-gray-400">Last Validation</p>
        </motion.div>
      </div>

      {/* Schema Version Badges */}
      {schemas.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
          className="panel p-4">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Tag className="w-4 h-4 text-neon-purple" /> Schema Versions
          </h2>
          <div className="flex flex-wrap gap-2">
            {schemas.map((s) => (
              <span key={(s.id || s.name) as string}
                className="text-xs px-3 py-1.5 rounded-full bg-lattice-deep border border-white/10 flex items-center gap-2">
                <FileCode className="w-3 h-3 text-neon-cyan" />
                <span className="font-medium">{s.name as string}</span>
                <span className="text-gray-500">v{(s.version as number) || 1}</span>
                <span className={`w-2 h-2 rounded-full ${(s.version as number) >= 1 ? 'bg-green-400' : 'bg-amber-400'}`} />
              </span>
            ))}
          </div>
        </motion.div>
      )}

      {/* AI Actions */}
      <UniversalActions domain="schema" artifactId={schemaItems[0]?.id} compact />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Schema List */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Available Schemas ({schemas?.length || 0})</h2>
          {isLoading ? (
            <div className="text-gray-400">Loading...</div>
          ) : (
            <div className="space-y-3">
              {schemas?.map((schema: Record<string, unknown>) => (
                <SchemaCard key={(schema.id || schema.name) as string} schema={schema} />
              ))}
            </div>
          )}
        </div>

        {/* Validation Tester */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Schema Validator</h2>
          <div className="panel p-4 space-y-4">
            <select
              value={validateData.schemaName}
              onChange={(e) => setValidateData({ ...validateData, schemaName: e.target.value })}
              className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded"
            >
              <option value="">Select Schema</option>
              {schemas?.map((s: Record<string, unknown>) => (
                <option key={s.name as string} value={s.name as string}>{s.name as string}</option>
              ))}
            </select>
            <textarea
              placeholder='{"field": "value"}'
              value={validateData.data}
              onChange={(e) => setValidateData({ ...validateData, data: e.target.value })}
              className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded h-32 font-mono text-sm"
            />
            <button
              onClick={handleValidate}
              disabled={!validateData.schemaName || !validateData.data || validateMutation.isPending}
              className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {validateMutation.isPending ? 'Validating...' : 'Validate'}
            </button>

            {validationResult && (
              <div className={`p-3 rounded ${validationResult.valid ? 'bg-green-500/20 border border-green-500/50' : 'bg-red-500/20 border border-red-500/50'}`}>
                <div className="flex items-center gap-2 mb-2">
                  {validationResult.valid ? (
                    <Check className="w-5 h-5 text-green-400" />
                  ) : (
                    <X className="w-5 h-5 text-red-400" />
                  )}
                  <span className={validationResult.valid ? 'text-green-400' : 'text-red-400'}>
                    {validationResult.valid ? 'Valid' : 'Invalid'}
                  </span>
                </div>
                {(validationResult.errors as Array<{ field: string; error: string }> | undefined)?.length ? (
                  <ul className="text-sm text-red-300 space-y-1">
                    {(validationResult.errors as Array<{ field: string; error: string }>).map((err, i: number) => (
                      <li key={i}>{err.field}: {err.error}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>

      <RealtimeDataPanel data={realtimeInsights} />

      {/* Schema Domain Actions */}
      <div className="panel p-4 space-y-3">
        <h3 className="text-sm font-semibold text-neon-blue flex items-center gap-2"><Database className="w-4 h-4" /> Schema Operations</h3>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'schemaValidate', label: 'Validate Schema' },
            { action: 'schemaDiff', label: 'Schema Diff' },
            { action: 'schemaEvolution', label: 'Schema Evolution' },
          ].map(({ action, label }) => (
            <button key={action} onClick={() => handleSchemaAction(action)} disabled={schemaActiveAction === action || !schemaItems[0]?.id}
              className="px-3 py-1.5 text-xs bg-neon-blue/10 border border-neon-blue/20 rounded-lg hover:bg-neon-blue/20 disabled:opacity-50 flex items-center gap-1.5">
              {schemaActiveAction === action ? <div className="w-3 h-3 border border-neon-blue border-t-transparent rounded-full animate-spin" /> : <Zap className="w-3 h-3 text-neon-blue" />}
              {label}
            </button>
          ))}
        </div>
        {schemaActionResult && (
          <div className="p-3 bg-black/40 rounded-lg border border-neon-blue/20 text-xs space-y-2">
            {schemaActionResult.action === 'schemaValidate' && (
              <div className="space-y-1">
                <div className="flex gap-4 flex-wrap">
                  <span className={`font-semibold ${schemaActionResult.valid ? 'text-green-400' : 'text-red-400'}`}>{schemaActionResult.valid ? '✓ Valid schema' : '✗ Invalid schema'}</span>
                  <span className="text-gray-400">Invalid: <span className="text-red-400 font-mono">{String((schemaActionResult.summary as Record<string,unknown>)?.invalidRecords ?? 0)}</span></span>
                  <span className="text-gray-400">Rate: <span className="text-neon-blue font-mono">{String((schemaActionResult.summary as Record<string,unknown>)?.validationRate ?? 0)}%</span></span>
                </div>
                {Array.isArray(schemaActionResult.topErrors) && (schemaActionResult.topErrors as unknown[]).length > 0 && (
                  <div className="space-y-0.5">{(schemaActionResult.topErrors as {issue:string;occurrences:number}[]).slice(0,3).map((e, i) => <p key={i} className="text-red-300">✗ {e.issue} ({e.occurrences}×)</p>)}</div>
                )}
                {!!schemaActionResult.message && <p className="text-gray-400 italic">{String(schemaActionResult.message)}</p>}
              </div>
            )}
            {schemaActionResult.action === 'schemaDiff' && (
              <div className="space-y-1">
                <div className="flex gap-4 flex-wrap">
                  <span className="text-gray-400">Added: <span className="text-green-400 font-mono">{String((schemaActionResult.summary as Record<string,unknown>)?.added ?? 0)}</span></span>
                  <span className="text-gray-400">Removed: <span className="text-red-400 font-mono">{String((schemaActionResult.summary as Record<string,unknown>)?.removed ?? 0)}</span></span>
                  <span className="text-gray-400">Modified: <span className="text-yellow-400 font-mono">{String((schemaActionResult.summary as Record<string,unknown>)?.modified ?? 0)}</span></span>
                  <span className={`${!(schemaActionResult.summary as Record<string,unknown>)?.backwardCompatible ? 'text-red-400' : 'text-green-400'}`}>{!(schemaActionResult.summary as Record<string,unknown>)?.backwardCompatible ? 'Breaking changes' : 'Non-breaking'}</span>
                </div>
                {!!schemaActionResult.message && <p className="text-gray-400 italic">{String(schemaActionResult.message)}</p>}
              </div>
            )}
            {schemaActionResult.action === 'schemaEvolution' && (
              <div className="space-y-1">
                <div className="flex gap-4 flex-wrap">
                  <span className="text-gray-400">Latest version: <span className="text-neon-blue font-mono">{String((schemaActionResult.summary as Record<string,unknown>)?.latestVersion ?? '')}</span></span>
                  <span className="text-gray-400">Versions: <span className="text-white capitalize">{String((schemaActionResult.summary as Record<string,unknown>)?.totalVersions ?? '')}</span></span>
                  <span className="text-gray-400">Breaking: <span className="text-red-400 font-mono">{String((schemaActionResult.summary as Record<string,unknown>)?.breakingTransitions ?? 0)}</span></span>
                </div>
                {Array.isArray(schemaActionResult.transitions) && (schemaActionResult.transitions as unknown[]).length > 0 && (
                  <div className="space-y-0.5">{(schemaActionResult.transitions as Array<{from:string;to:string;backwardCompatible:boolean}>).slice(0,3).map((t, i) => <p key={i} className="text-gray-300">→ v{t.from} to v{t.to} {t.backwardCompatible ? <span className="text-green-400">✓</span> : <span className="text-red-400">⚠</span>}</p>)}</div>
                )}
                {!!schemaActionResult.message && <p className="text-gray-400 italic">{String(schemaActionResult.message)}</p>}
              </div>
            )}
            <button onClick={() => setSchemaActionResult(null)} className="text-gray-600 hover:text-gray-400 text-xs flex items-center gap-1"><X className="w-3 h-3" /> Dismiss</button>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateSchemaModal
          onClose={() => setShowCreate(false)}
          onCreate={(data: { name: string; kind: string; fields: Array<{ name: string; type: string; required: boolean }> }) => createMutation.mutate(data)}
          creating={createMutation.isPending}
        />
      )}
    </div>
  );
}

function SchemaCard({ schema }: { schema: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="panel p-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">{schema.name as string}</h3>
          <p className="text-xs text-gray-400">Kind: {schema.kind as string} | Fields: {(schema.fields as unknown[])?.length || 0}</p>
        </div>
        <span className="text-xs text-gray-400">v{(schema.version as number) || 1}</span>
      </div>
      {expanded && (
        <div className="mt-3 pt-3 border-t border-lattice-border">
          <h4 className="text-sm font-medium mb-2">Fields:</h4>
          <div className="space-y-1">
            {(schema.fields as Record<string, unknown>[])?.map((field: Record<string, unknown>) => (
              <div key={field.name as string} className="text-sm flex items-center gap-2">
                <span className="text-neon-cyan">{field.name as string}</span>
                <span className="text-gray-500">: {field.type as string}</span>
                {(field.required as boolean) && <span className="text-xs text-red-400">*</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CreateSchemaModal({ onClose, onCreate, creating }: { onClose: () => void; onCreate: (data: { name: string; kind: string; fields: { name: string; type: string; required: boolean }[] }) => void; creating: boolean }) {
  const [form, setForm] = useState({
    name: '',
    kind: '',
    fields: [{ name: '', type: 'string', required: false }]
  });

  const addField = () => {
    setForm({ ...form, fields: [...form.fields, { name: '', type: 'string', required: false }] });
  };

  const updateField = (idx: number, key: string, value: unknown) => {
    const fields = [...form.fields];
    fields[idx] = { ...fields[idx], [key]: value };
    setForm({ ...form, fields });
  };

  return (
    <div data-lens-theme="schema" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-lattice-bg border border-lattice-border rounded-lg p-6 w-full max-w-lg space-y-4 max-h-[80vh] overflow-y-auto">
        <h2 className="text-lg font-bold">Create Schema</h2>
        <input
          type="text"
          placeholder="Schema Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded"
        />
        <input
          type="text"
          placeholder="Kind (e.g., hypothesis, experiment)"
          value={form.kind}
          onChange={(e) => setForm({ ...form, kind: e.target.value })}
          className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded"
        />
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Fields</h3>
            <button onClick={addField} className="text-xs text-neon-cyan">+ Add Field</button>
          </div>
          {form.fields.map((field, idx) => (
            <div key={idx} className="flex gap-2">
              <input
                type="text"
                placeholder="Field name"
                value={field.name}
                onChange={(e) => updateField(idx, 'name', e.target.value)}
                className="flex-1 px-2 py-1 bg-lattice-surface border border-lattice-border rounded text-sm"
              />
              <select
                value={field.type}
                onChange={(e) => updateField(idx, 'type', e.target.value)}
                className="px-2 py-1 bg-lattice-surface border border-lattice-border rounded text-sm"
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="array">array</option>
                <option value="reference">reference</option>
              </select>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) => updateField(idx, 'required', e.target.checked)}
                />
                Req
              </label>
            </div>
          ))}
        </div>
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={() => onCreate(form)}
            disabled={creating || !form.name || !form.kind}
            className="btn-primary"
          >
            {creating ? 'Creating...' : 'Create Schema'}
          </button>
        </div>
      </div>
    </div>
  );
}
