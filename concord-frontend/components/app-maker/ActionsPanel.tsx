'use client';

/**
 * ActionsPanel — scaffoldApp / uiComplexity / wireframeValidate bench.
 * Extracted from former app-maker/page.tsx "App Compute Actions" section.
 * Domain id is "app-maker" (hyphen) — must match server/domains/appmaker.js.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Zap, Loader2, Code, Ruler, ClipboardCheck, AlertTriangle, BarChart3,
  XCircle, CheckCircle,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensData } from '@/lib/hooks/use-lens-data';

export function ActionsPanel({
  selectedTemplate = 'crm',
  appBuildName = '',
}: {
  selectedTemplate?: string;
  appBuildName?: string;
} = {}) {
  const runAction = useRunArtifact('app-maker');
  const { items: appmakerItems } = useLensData<Record<string, unknown>>('app-maker', 'app', { seed: [] });
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleAppmakerAction = async (action: string) => {
    setLastAction(action);
    setActionError(null);
    let targetId = appmakerItems[0]?.id;
    if (!targetId) {
      try {
        const created = await apiHelpers.lens.create('app-maker', {
          type: 'app',
          title: 'App Maker Workspace',
          data: { template: selectedTemplate, name: appBuildName || 'Untitled App' },
        });
        targetId = created?.data?.artifact?.id;
      } catch (e) {
        console.error('[AppMaker] Failed to auto-create artifact:', e);
        setActionResult(null);
        setActionError(e instanceof Error ? e.message : 'Failed to create app workspace.');
        return;
      }
      if (!targetId) {
        setActionResult(null);
        setActionError('No app artifact found. Please create an app first.');
        return;
      }
    }
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) {
        setActionResult(null);
        setActionError(String((res as Record<string, unknown>).error || 'Unknown error'));
      } else {
        setActionResult(res.result as Record<string, unknown>);
      }
    } catch (e) {
      console.error(`Action ${action} failed:`, e);
      setActionResult(null);
      setActionError(e instanceof Error ? e.message : 'Unknown error');
    }
    setIsRunning(null);
  };

  return (
    <div className="panel p-4">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Zap className="w-4 h-4 text-neon-cyan" />
        App Compute Actions
      </h3>
      <div className="grid grid-cols-3 gap-3">
        <button onClick={() => handleAppmakerAction('scaffoldApp')} disabled={isRunning !== null} className="flex flex-col items-center gap-2 p-3 bg-lattice-deep rounded-lg border border-lattice-border hover:border-neon-cyan/50 transition-colors disabled:opacity-50">
          {isRunning === 'scaffoldApp' ? <Loader2 className="w-5 h-5 text-neon-cyan animate-spin" /> : <Code className="w-5 h-5 text-neon-cyan" />}
          <span className="text-xs text-gray-300">Scaffold App</span>
        </button>
        <button onClick={() => handleAppmakerAction('uiComplexity')} disabled={isRunning !== null} className="flex flex-col items-center gap-2 p-3 bg-lattice-deep rounded-lg border border-lattice-border hover:border-neon-purple/50 transition-colors disabled:opacity-50">
          {isRunning === 'uiComplexity' ? <Loader2 className="w-5 h-5 text-neon-purple animate-spin" /> : <Ruler className="w-5 h-5 text-neon-purple" />}
          <span className="text-xs text-gray-300">UI Complexity</span>
        </button>
        <button onClick={() => handleAppmakerAction('wireframeValidate')} disabled={isRunning !== null} className="flex flex-col items-center gap-2 p-3 bg-lattice-deep rounded-lg border border-lattice-border hover:border-green-400/50 transition-colors disabled:opacity-50">
          {isRunning === 'wireframeValidate' ? <Loader2 className="w-5 h-5 text-green-400 animate-spin" /> : <ClipboardCheck className="w-5 h-5 text-green-400" />}
          <span className="text-xs text-gray-300">Wireframe Validate</span>
        </button>
      </div>

      {isRunning && (
        <div role="status" aria-live="polite" className="mt-4 flex items-center gap-2 p-3 bg-lattice-deep rounded-lg border border-lattice-border text-sm text-gray-300">
          <Loader2 className="w-4 h-4 text-neon-cyan animate-spin" />
          <span>Running {isRunning}…</span>
        </div>
      )}

      {!isRunning && actionError && (
        <div role="alert" className="mt-4 p-3 bg-red-500/10 rounded-lg border border-red-500/30">
          <div className="flex items-center gap-2 text-sm text-red-400">
            <AlertTriangle className="w-4 h-4" />
            <span>Action failed: {actionError}</span>
          </div>
          {lastAction && (
            <button
              onClick={() => handleAppmakerAction(lastAction)}
              className="mt-2 text-xs px-3 py-1 rounded bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {!isRunning && !actionError && !actionResult && (
        <p className="mt-4 text-xs text-gray-500">
          Run an action above to scaffold a structure, measure UI complexity, or validate a wireframe.
        </p>
      )}

      {actionResult && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 p-3 bg-lattice-deep rounded-lg border border-lattice-border">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-white flex items-center gap-2"><BarChart3 className="w-4 h-4 text-neon-cyan" /> Result</h4>
            <button onClick={() => setActionResult(null)} className="text-gray-400 hover:text-white" aria-label="Xcircle"><XCircle className="w-4 h-4" /></button>
          </div>

          {actionResult.routes !== undefined && actionResult.fileStructure !== undefined && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="p-2 bg-lattice-surface rounded text-center"><p className="text-sm font-bold text-neon-cyan">{(actionResult.routes as unknown[])?.length || 0}</p><p className="text-[10px] text-gray-400">Routes</p></div>
                <div className="p-2 bg-lattice-surface rounded text-center"><p className="text-sm font-bold text-neon-purple">{actionResult.totalComponents as number}</p><p className="text-[10px] text-gray-400">Components</p></div>
                <div className="p-2 bg-lattice-surface rounded text-center"><p className="text-sm font-bold text-green-400">{(actionResult.fileStructure as unknown[])?.length || 0}</p><p className="text-[10px] text-gray-400">Files</p></div>
                <div className="p-2 bg-lattice-surface rounded text-center"><p className="text-sm font-bold text-orange-400">{actionResult.deepestNesting as number}</p><p className="text-[10px] text-gray-400">Max Depth</p></div>
              </div>
              {(actionResult.routes as Array<{ name: string; path: string; componentCount: number; dynamic: boolean }>)?.map((r, i) => (
                <div key={i} className="flex items-center gap-3 p-2 bg-lattice-surface rounded text-xs">
                  <span className="text-neon-cyan font-mono flex-1">{r.path}</span>
                  <span className="text-white">{r.name}</span>
                  <span className="text-gray-400">{r.componentCount} components</span>
                  {!!r.dynamic && <span className="text-yellow-400 text-[10px]">dynamic</span>}
                </div>
              ))}
              {(actionResult.sharedComponents as Array<{ type: string; reuseCount: number }>)?.length > 0 && (
                <div className="text-xs text-gray-400">
                  Shared: {(actionResult.sharedComponents as Array<{ type: string; reuseCount: number }>).map((s) => `${s.type} (×${s.reuseCount})`).join(', ')}
                </div>
              )}
            </div>
          )}

          {actionResult.complexityScore !== undefined && actionResult.complexityLevel !== undefined && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className={`text-3xl font-bold ${(actionResult.complexityLevel as string) === 'simple' ? 'text-green-400' : (actionResult.complexityLevel as string) === 'moderate' ? 'text-yellow-400' : 'text-red-400'}`}>
                  {actionResult.complexityScore as number}
                </div>
                <div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded uppercase ${(actionResult.complexityLevel as string) === 'simple' ? 'bg-green-500/20 text-green-400' : (actionResult.complexityLevel as string) === 'moderate' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
                    {actionResult.complexityLevel as string}
                  </span>
                </div>
              </div>
              {!!actionResult.metrics && (
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(actionResult.metrics as Record<string, number>).map(([key, val]) => (
                    <div key={key} className="p-2 bg-lattice-surface rounded">
                      <p className="text-[10px] text-gray-400 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</p>
                      <p className="text-sm font-bold text-white">{val}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {actionResult.valid !== undefined && actionResult.checks !== undefined && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {(actionResult.valid as boolean)
                  ? <CheckCircle className="w-6 h-6 text-green-400" />
                  : <AlertTriangle className="w-6 h-6 text-red-400" />
                }
                <span className={`text-lg font-bold ${(actionResult.valid as boolean) ? 'text-green-400' : 'text-red-400'}`}>
                  {(actionResult.valid as boolean) ? 'Valid' : 'Issues Found'}
                </span>
                <span className="text-xs text-gray-400 ml-auto">{actionResult.passedChecks as number}/{actionResult.totalChecks as number} checks passed</span>
              </div>
              {(actionResult.checks as Array<{ name: string; passed: boolean; detail?: string }>)?.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-xs p-1.5 rounded bg-lattice-surface">
                  {c.passed ? <CheckCircle className="w-3 h-3 text-green-400" /> : <XCircle className="w-3 h-3 text-red-400" />}
                  <span className="text-white">{c.name}</span>
                  {c.detail && <span className="text-gray-400 ml-auto">{c.detail}</span>}
                </div>
              ))}
            </div>
          )}

          {!!actionResult.message && !actionResult.routes && !actionResult.complexityScore && !actionResult.valid && (
            <p className="text-sm text-gray-400">{actionResult.message as string}</p>
          )}
        </motion.div>
      )}
    </div>
  );
}

export default ActionsPanel;
