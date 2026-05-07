'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Boxes, Plus, CheckCircle, ArrowUp, Layers, ChevronDown, Rocket, Layout, ShoppingCart, Briefcase, UserCircle, Star, TrendingUp, Loader2, XCircle, Zap, BarChart3, Code, Ruler, ClipboardCheck, AlertTriangle } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';

interface AppEntry {
  id: string;
  name: string;
  status: string;
  author: string;
  version: string;
  createdAt: string;
}

export default function AppMakerLens() {
  useLensNav('app-maker');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('app-maker');

  const [showFeatures, setShowFeatures] = useState(true);

  // Backend action wiring
  const runAction = useRunArtifact('appmaker');
  const { items: appmakerItems } = useLensData<Record<string, unknown>>('appmaker', 'app', { seed: [] });
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);

  const handleAppmakerAction = async (action: string) => {
    let targetId = appmakerItems[0]?.id;
    // Auto-create an app artifact if none exists yet
    if (!targetId) {
      try {
        const created = await apiHelpers.lens.create('appmaker', {
          type: 'app',
          title: 'App Maker Workspace',
          data: { template: selectedTemplate, name: appBuildName || 'Untitled App' },
        });
        targetId = created?.data?.artifact?.id;
      } catch (e) {
        console.error('[AppMaker] Failed to auto-create artifact:', e);
        setActionResult({ message: 'No app artifact found. Please create an app first.' });
        return;
      }
      if (!targetId) {
        setActionResult({ message: 'No app artifact found. Please create an app first.' });
        return;
      }
    }
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setIsRunning(null);
  };

  const [apps, setApps] = useState<AppEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('crm');
  const [appBuildName, setAppBuildName] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [deployStatus, setDeployStatus] = useState<'idle' | 'deploying' | 'deployed'>('idle');

  useEffect(() => {
    loadApps();
  }, []);

  const loadApps = async () => {
    try {
      const resp = await apiHelpers.apps.list();
      setApps(resp.data?.apps || []);
    } catch (e) { console.error('[AppMaker] Failed to load apps:', e); useUIStore.getState().addToast({ type: 'error', message: 'Failed to load apps' }); }
    setLoading(false);
  };

  const createApp = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await apiHelpers.apps.create({
        name: newName.trim(),
        primitives: {
          artifacts: { types: [], schema: {} },
          execution: { macros: [] },
          governance: { council_gated: false },
        },
        ui: { lens: 'custom', layout: 'dashboard', panels: [] },
      });
      setNewName('');
      await loadApps();
    } catch (e) { console.error('[AppMaker] Failed to create app:', e); useUIStore.getState().addToast({ type: 'error', message: 'Failed to create app' }); }
    setCreating(false);
  };

  const promoteApp = async (id: string) => {
    try {
      await apiHelpers.apps.promote(id);
      await loadApps();
    } catch (e) { console.error('[AppMaker] Failed to promote app:', e); useUIStore.getState().addToast({ type: 'error', message: 'Failed to promote app' }); }
  };

  const validateApp = async (id: string) => {
    try {
      const resp = await apiHelpers.apps.validate(id);
      const data = resp.data;
      if (data.valid) {
        alert('App is valid — all invariants pass.');
      } else {
        alert(`Violations:\n${(data.violations || []).join('\n')}`);
      }
    } catch (e) { console.error('[AppMaker] Failed to validate app:', e); useUIStore.getState().addToast({ type: 'error', message: 'Failed to validate app' }); }
  };

  const templates = [
    { id: 'crm', name: 'Business CRM', icon: Briefcase, description: 'Customer relationship management with contacts, deals, and pipeline tracking' },
    { id: 'ecommerce', name: 'E-Commerce', icon: ShoppingCart, description: 'Online store with product catalog, cart, and order management' },
    { id: 'portfolio', name: 'Portfolio', icon: UserCircle, description: 'Personal or agency portfolio with project showcases and testimonials' },
    { id: 'booking', name: 'Service Booking', icon: Layout, description: 'Appointment scheduling with calendar integration and client management' },
  ];

  const handleDeploy = async () => {
    if (!appBuildName.trim()) return;
    setDeploying(true);
    setDeployStatus('deploying');
    try {
      await apiHelpers.apps.create({
        name: appBuildName.trim(),
        primitives: {
          artifacts: { types: [selectedTemplate], schema: {} },
          execution: { macros: [] },
          governance: { council_gated: false },
        },
        ui: { lens: 'custom', layout: 'dashboard', panels: [] },
      });
      setDeployStatus('deployed');
      setAppBuildName('');
      await loadApps();
    } catch {
      setDeployStatus('idle');
    }
    setDeploying(false);
    setTimeout(() => setDeployStatus('idle'), 3000);
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'text-gray-400';
      case 'published': return 'text-blue-400';
      case 'marketplace': return 'text-yellow-400';
      case 'global': return 'text-green-400';
      default: return 'text-gray-500';
    }
  };

  return (
    <div data-lens-theme="app-maker" className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Boxes className="w-6 h-6 text-neon-cyan" />
        <h1 className="text-xl font-bold">App Maker</h1>
      </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="app-maker" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <p className="text-sm text-gray-400">
        Compose apps from existing primitives. Artifact + Execution + Governance + Custom UI.
      </p>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="panel p-3 flex items-center gap-3">
          <Boxes className="w-5 h-5 text-neon-cyan" />
          <div>
            <p className="text-lg font-bold">{apps.length}</p>
            <p className="text-xs text-gray-400">Total Apps</p>
          </div>
        </div>
        <div className="panel p-3 flex items-center gap-3">
          <Star className="w-5 h-5 text-yellow-400" />
          <div>
            <p className="text-lg font-bold">{apps.filter(a => a.status === 'published' || a.status === 'marketplace' || a.status === 'global').length}</p>
            <p className="text-xs text-gray-400">Published</p>
          </div>
        </div>
        <div className="panel p-3 flex items-center gap-3">
          <TrendingUp className="w-5 h-5 text-green-400" />
          <div>
            <p className="text-lg font-bold">{apps.length > 0 ? (apps.filter(a => a.version !== '0.0.1').length / apps.length * 100).toFixed(0) + '%' : '0%'}</p>
            <p className="text-xs text-gray-400">Avg Maturity</p>
          </div>
        </div>
      </div>

      {/* ── Backend Action Panels ── */}
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

        {/* Action Result Display */}
        {actionResult && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 p-3 bg-lattice-deep rounded-lg border border-lattice-border">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-white flex items-center gap-2"><BarChart3 className="w-4 h-4 text-neon-cyan" /> Result</h4>
              <button onClick={() => setActionResult(null)} className="text-gray-400 hover:text-white"><XCircle className="w-4 h-4" /></button>
            </div>

            {/* Scaffold App Result */}
            {actionResult.routes !== undefined && actionResult.fileStructure !== undefined && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center"><p className="text-sm font-bold text-neon-cyan">{(actionResult.routes as unknown[])?.length || 0}</p><p className="text-[10px] text-gray-500">Routes</p></div>
                  <div className="p-2 bg-lattice-surface rounded text-center"><p className="text-sm font-bold text-neon-purple">{actionResult.totalComponents as number}</p><p className="text-[10px] text-gray-500">Components</p></div>
                  <div className="p-2 bg-lattice-surface rounded text-center"><p className="text-sm font-bold text-green-400">{(actionResult.fileStructure as unknown[])?.length || 0}</p><p className="text-[10px] text-gray-500">Files</p></div>
                  <div className="p-2 bg-lattice-surface rounded text-center"><p className="text-sm font-bold text-orange-400">{actionResult.deepestNesting as number}</p><p className="text-[10px] text-gray-500">Max Depth</p></div>
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
                    Shared: {(actionResult.sharedComponents as Array<{ type: string; reuseCount: number }>).map(s => `${s.type} (×${s.reuseCount})`).join(', ')}
                  </div>
                )}
              </div>
            )}

            {/* UI Complexity Result */}
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
                        <p className="text-[10px] text-gray-500 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</p>
                        <p className="text-sm font-bold text-white">{val}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Wireframe Validate Result */}
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
                    {c.detail && <span className="text-gray-500 ml-auto">{c.detail}</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Fallback */}
            {!!actionResult.message && !actionResult.routes && !actionResult.complexityScore && !actionResult.valid && (
              <p className="text-sm text-gray-400">{actionResult.message as string}</p>
            )}
          </motion.div>
        )}
      </div>

      {/* Create App */}
      <div className="panel p-4 flex items-center gap-3">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New app name..."
          className="flex-1 bg-lattice-deep border border-lattice-edge rounded px-3 py-2 text-sm"
          onKeyDown={(e) => e.key === 'Enter' && createApp()}
        />
        <button
          onClick={createApp}
          disabled={creating || !newName.trim()}
          className="bg-neon-cyan/10 border border-neon-cyan/30 rounded px-4 py-2 text-sm text-neon-cyan hover:bg-neon-cyan/20 disabled:opacity-50 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Create
        </button>
      </div>

      {/* App List */}
      <div className="panel p-4">
        <h3 className="text-sm font-semibold mb-3">Your Apps</h3>
        {loading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : apps.length === 0 ? (
          <p className="text-sm text-gray-500">No apps yet. Create your first one above.</p>
        ) : (
          <div className="space-y-3">
            {apps.map((app, index) => (
              <motion.div key={app.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="bg-lattice-deep rounded p-3 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{app.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${statusColor(app.status)} bg-opacity-20`}>
                      {app.status}
                    </span>
                    <span className="text-xs text-gray-500">v{app.version}</span>
                  </div>
                  <span className="text-xs text-gray-500 font-mono">{app.id}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => validateApp(app.id)}
                    className="text-xs text-gray-400 hover:text-neon-cyan flex items-center gap-1"
                    title="Validate"
                  >
                    <CheckCircle className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => promoteApp(app.id)}
                    className="text-xs text-gray-400 hover:text-green-400 flex items-center gap-1"
                    title="Promote"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Invariant Reminder */}
      <div className="text-xs text-gray-500 text-center">
        All fields map to Identity, Artifact, Execution, Governance, Memory, or Economy primitives. No new core objects.

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="app-maker"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
      </div>

      {/* Build Your App */}
      <div className="panel p-4 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Rocket className="w-4 h-4 text-neon-purple" />
          Build Your App
        </h2>
        <p className="text-sm text-gray-400">
          Choose a template, name your app, and deploy it directly into the Lattice ecosystem.
        </p>

        {/* App Name Input */}
        <div className="space-y-2">
          <label className="text-xs text-gray-400 uppercase tracking-wider">App Name</label>
          <input
            type="text"
            value={appBuildName}
            onChange={(e) => setAppBuildName(e.target.value)}
            placeholder="Enter your app name..."
            className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan/50 focus:ring-1 focus:ring-neon-cyan/30 transition-colors"
          />
        </div>

        {/* Template Selector */}
        <div className="space-y-2">
          <label className="text-xs text-gray-400 uppercase tracking-wider">Template</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {templates.map((tpl) => {
              const Icon = tpl.icon;
              const isSelected = selectedTemplate === tpl.id;
              return (
                <button
                  key={tpl.id}
                  onClick={() => setSelectedTemplate(tpl.id)}
                  className={`text-left p-4 rounded-lg border transition-all duration-200 ${
                    isSelected
                      ? 'bg-neon-purple/10 border-neon-purple/50 ring-1 ring-neon-purple/30'
                      : 'bg-black/40 border-white/10 hover:border-white/20 hover:bg-black/60'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`p-2 rounded-lg ${isSelected ? 'bg-neon-purple/20' : 'bg-white/5'}`}>
                      <Icon className={`w-5 h-5 ${isSelected ? 'text-neon-purple' : 'text-gray-400'}`} />
                    </div>
                    <span className={`font-medium text-sm ${isSelected ? 'text-neon-purple' : 'text-white'}`}>
                      {tpl.name}
                    </span>
                    {isSelected && (
                      <CheckCircle className="w-4 h-4 text-neon-purple ml-auto" />
                    )}
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed pl-12">
                    {tpl.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Template Preview */}
        <div className="bg-black/40 border border-white/10 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-gray-400 uppercase tracking-wider">Preview</span>
            <span className="text-xs text-neon-cyan font-mono">
              {templates.find(t => t.id === selectedTemplate)?.name}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {['Dashboard', 'Data View', 'Settings'].map((panel) => (
              <div key={panel} className="bg-white/5 rounded p-2 text-center">
                <div className="h-8 bg-neon-cyan/5 rounded mb-1" />
                <span className="text-[10px] text-gray-500">{panel}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
            <Layers className="w-3 h-3" />
            <span>Includes: Artifact schema, execution macros, governance rules, UI panels</span>
          </div>
        </div>

        {/* Deploy Button */}
        <button
          onClick={handleDeploy}
          disabled={deploying || !appBuildName.trim()}
          className={`w-full py-3 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-all duration-200 ${
            deployStatus === 'deployed'
              ? 'bg-neon-green/20 border border-neon-green/50 text-neon-green'
              : 'bg-neon-purple/10 border border-neon-purple/30 text-neon-purple hover:bg-neon-purple/20 disabled:opacity-50 disabled:cursor-not-allowed'
          }`}
        >
          {deployStatus === 'deploying' ? (
            <>
              <div className="w-4 h-4 border-2 border-neon-purple border-t-transparent rounded-full animate-spin" />
              Deploying...
            </>
          ) : deployStatus === 'deployed' ? (
            <>
              <CheckCircle className="w-4 h-4" />
              Deployed Successfully!
            </>
          ) : (
            <>
              <Rocket className="w-4 h-4" />
              Deploy App
            </>
          )}
        </button>
      </div>

      <ConnectiveTissueBar lensId="app_maker" />

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
            <LensFeaturePanel lensId="app_maker" />
          </div>
        )}
      </div>
    </div>
  );
}
