'use client';

/**
 * AppsPanel — create / list / promote / validate / template-deploy desk.
 * Extracted from former app-maker/page.tsx stacked sections (stats, create,
 * your apps, build-your-app). Preserves apiHelpers.apps.* call sites.
 */

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Boxes, Plus, CheckCircle, ArrowUp, Layers, Rocket, Layout, ShoppingCart,
  Briefcase, UserCircle, Star, TrendingUp, AlertTriangle,
} from 'lucide-react';
import { Icon as SvgIcon } from '@/components/icons/Icon';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { useLensCommand } from '@/hooks/useLensCommand';

interface AppEntry {
  id: string;
  name: string;
  status: string;
  author: string;
  version: string;
  createdAt: string;
}

const TEMPLATES = [
  { id: 'crm', name: 'Business CRM', icon: Briefcase, description: 'Customer relationship management with contacts, deals, and pipeline tracking' },
  { id: 'ecommerce', name: 'E-Commerce', icon: ShoppingCart, description: 'Online store with product catalog, cart, and order management' },
  { id: 'portfolio', name: 'Portfolio', icon: UserCircle, description: 'Personal or agency portfolio with project showcases and testimonials' },
  { id: 'booking', name: 'Service Booking', icon: Layout, description: 'Appointment scheduling with calendar integration and client management' },
];

export function AppsPanel() {
  const { latestData: realtimeData, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('app-maker');
  const newNameInputRef = useRef<HTMLInputElement>(null);
  const appSearchInputRef = useRef<HTMLInputElement>(null);

  const [apps, setApps] = useState<AppEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('crm');
  const [appSearch, setAppSearch] = useState('');
  const [appStatusFilter, setAppStatusFilter] = useState<string>('all');
  const [appBuildName, setAppBuildName] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [deployStatus, setDeployStatus] = useState<'idle' | 'deploying' | 'deployed'>('idle');

  useLensCommand(
    [
      { id: 'new-app', keys: 'n', description: 'Focus new-app name input', category: 'actions', action: () => newNameInputRef.current?.focus() },
      { id: 'focus-search', keys: '/', description: 'Search your apps', category: 'navigation', action: () => appSearchInputRef.current?.focus() },
      { id: 'tpl-crm', keys: '1', description: 'CRM template', category: 'view', action: () => setSelectedTemplate('crm') },
      { id: 'tpl-ecommerce', keys: '2', description: 'E-commerce template', category: 'view', action: () => setSelectedTemplate('ecommerce') },
      { id: 'tpl-portfolio', keys: '3', description: 'Portfolio template', category: 'view', action: () => setSelectedTemplate('portfolio') },
      { id: 'tpl-dashboard', keys: '4', description: 'Dashboard template', category: 'view', action: () => setSelectedTemplate('dashboard') },
    ],
    { lensId: 'app-maker' },
  );

  useEffect(() => {
    loadApps();
  }, []);

  const loadApps = async () => {
    setLoading(true);
    setAppsError(null);
    try {
      const resp = await apiHelpers.apps.list();
      setApps(resp.data?.apps || []);
    } catch (e) {
      console.error('[AppMaker] Failed to load apps:', e);
      setAppsError(e instanceof Error ? e.message : 'Failed to load apps');
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to load apps' });
    }
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
    } catch (e) {
      console.error('[AppMaker] Failed to create app:', e);
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to create app' });
    }
    setCreating(false);
  };

  const promoteApp = async (id: string) => {
    try {
      await apiHelpers.apps.promote(id);
      await loadApps();
    } catch (e) {
      console.error('[AppMaker] Failed to promote app:', e);
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to promote app' });
    }
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
    } catch (e) {
      console.error('[AppMaker] Failed to validate app:', e);
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to validate app' });
    }
  };

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
      default: return 'text-gray-400';
    }
  };

  return (
    <div className="space-y-6">
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
            <p className="text-lg font-bold">{apps.filter((a) => a.status === 'published' || a.status === 'marketplace' || a.status === 'global').length}</p>
            <p className="text-xs text-gray-400">Published</p>
          </div>
        </div>
        <div className="panel p-3 flex items-center gap-3">
          <TrendingUp className="w-5 h-5 text-green-400" />
          <div>
            <p className="text-lg font-bold">{apps.length > 0 ? ((apps.filter((a) => a.version !== '0.0.1').length / apps.length) * 100).toFixed(0) + '%' : '0%'}</p>
            <p className="text-xs text-gray-400">Avg Maturity</p>
          </div>
        </div>
      </div>

      <div className="panel p-4 flex items-center gap-3">
        <input
          ref={newNameInputRef}
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New app name…  (press N to focus)"
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

      <div className="panel p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-sm font-semibold">
            Your Apps
            {(appSearch || appStatusFilter !== 'all') && (
              <span className="text-xs text-gray-400 font-normal ml-2">
                ({apps.filter((a) => {
                  const q = appSearch.trim().toLowerCase();
                  if (q && !((a.name || '').toLowerCase().includes(q) || (a.id || '').toLowerCase().includes(q))) return false;
                  if (appStatusFilter !== 'all' && a.status !== appStatusFilter) return false;
                  return true;
                }).length} of {apps.length})
              </span>
            )}
          </h3>
          {apps.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <input
                ref={appSearchInputRef}
                type="text"
                value={appSearch}
                onChange={(e) => setAppSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { setAppSearch(''); appSearchInputRef.current?.blur(); } }}
                placeholder="Filter…  / focuses"
                className="bg-lattice-deep border border-lattice-edge rounded px-2 py-1 w-36"
              />
              <select
                value={appStatusFilter}
                onChange={(e) => setAppStatusFilter(e.target.value)}
                className="bg-lattice-deep border border-lattice-edge rounded px-2 py-1"
              >
                <option value="all">All</option>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="marketplace">Marketplace</option>
                <option value="global">Global</option>
              </select>
              <button onClick={loadApps} className="text-neon-cyan hover:underline">Refresh</button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 gap-2" role="status" aria-live="polite">
            <div className="w-6 h-6 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin" aria-hidden="true" />
            <span className="text-sm text-gray-400">Loading your apps…</span>
          </div>
        ) : appsError ? (
          <div role="alert" className="text-center py-6">
            <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-red-400" />
            <p className="text-sm text-red-400 mb-2">{appsError}</p>
            <button onClick={loadApps} className="text-xs px-3 py-1 rounded bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30">
              Retry
            </button>
          </div>
        ) : apps.length === 0 ? (
          <div className="text-center py-6">
            <SvgIcon name="blueprint" size={56} className="mx-auto mb-3 text-gray-600" />
            <p className="text-sm text-gray-400">No apps yet. Create your first one above.</p>
          </div>
        ) : (() => {
          const visible = apps.filter((a) => {
            const q = appSearch.trim().toLowerCase();
            if (q && !((a.name || '').toLowerCase().includes(q) || (a.id || '').toLowerCase().includes(q))) return false;
            if (appStatusFilter !== 'all' && a.status !== appStatusFilter) return false;
            return true;
          });
          if (visible.length === 0) {
            return <p className="text-sm text-gray-400">No apps match the current filters.</p>;
          }
          return (
            <div className="space-y-3">
              {visible.map((app, index) => (
                <motion.div key={app.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="bg-lattice-deep rounded p-3 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{app.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${statusColor(app.status)} bg-opacity-20`}>
                        {app.status}
                      </span>
                      <span className="text-xs text-gray-400">v{app.version}</span>
                    </div>
                    <span className="text-xs text-gray-400 font-mono">{app.id}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => validateApp(app.id)} className="text-xs text-gray-400 hover:text-neon-cyan flex items-center gap-1" title="Validate">
                      <CheckCircle className="w-3 h-3" />
                    </button>
                    <button onClick={() => promoteApp(app.id)} className="text-xs text-gray-400 hover:text-green-400 flex items-center gap-1" title="Promote">
                      <ArrowUp className="w-3 h-3" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          );
        })()}
      </div>

      <p className="text-xs text-gray-400 text-center">
        All fields map to Identity, Artifact, Execution, Governance, Memory, or Economy primitives. No new core objects.
      </p>

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

      <div className="panel p-4 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Rocket className="w-4 h-4 text-neon-purple" />
          Build Your App
        </h2>
        <p className="text-sm text-gray-400">
          Choose a template, name your app, and deploy it directly into the Lattice ecosystem.
        </p>

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

        <div className="space-y-2">
          <label className="text-xs text-gray-400 uppercase tracking-wider">Template</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {TEMPLATES.map((tpl) => {
              const Icon = tpl.icon;
              const isSelected = selectedTemplate === tpl.id;
              return (
                <button
                  key={tpl.id}
                  type="button"
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
                    {isSelected && <CheckCircle className="w-4 h-4 text-neon-purple ml-auto" />}
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed pl-12">{tpl.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-black/40 border border-white/10 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-gray-400 uppercase tracking-wider">Preview</span>
            <span className="text-xs text-neon-cyan font-mono">
              {TEMPLATES.find((t) => t.id === selectedTemplate)?.name}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {['Dashboard', 'Data View', 'Settings'].map((panel) => (
              <div key={panel} className="bg-white/5 rounded p-2 text-center">
                <div className="h-8 bg-neon-cyan/5 rounded mb-1" />
                <span className="text-[10px] text-gray-400">{panel}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
            <Layers className="w-3 h-3" />
            <span>Includes: Artifact schema, execution macros, governance rules, UI panels</span>
          </div>
        </div>

        <button
          type="button"
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
    </div>
  );
}

export default AppsPanel;
