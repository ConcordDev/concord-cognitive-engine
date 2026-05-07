'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wand2, Layout, Code, Eye, Palette, Settings, Loader2, Layers, Link, BarChart } from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import {
  getLensManifests,
  getManifestCount,
  getLensesMissingMacro,
  LENS_STATUS_MAP,
  getLensStatusSummary,
  getProductLenses,
  getDeprecatedLenses,
  LENS_MERGE_GROUPS,
  getMergeReductionCount,
  POST_MERGE_STANDALONE_LENSES,
  PRODUCTIZATION_PHASES,
  getCurrentPhase,
  getTotalArtifactCount,
  getTotalEngineCount,
  WIRING_PROFILES,
  getWiringProfile,
  getCategoryIntegrationScore,
} from '@/lib/lenses';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InventoryOverview {
  totalComponents: number;
  totalLenses: number;
  totalServerLibs: number;
  totalRoutes: number;
  orphanedCount: number;
  largestFiles: { path: string; lines: number }[];
  mostImported: { name: string; importCount: number }[];
}

interface ComponentEntry {
  name: string;
  directory: string;
  lineCount: number;
  wired: boolean;
  exports: string[];
  importedBy: string[];
}

interface LensEntry {
  name: string;
  path: string;
  lineCount: number;
  importCount: number;
  imports: string[];
  routes: string[];
}

interface OrphanEntry {
  name: string;
  path: string;
  directory: string;
  exports: string[];
  lineCount: number;
}

interface WiringEntry {
  lens: string;
  domain: string;
  components: string[];
}

interface SearchResult {
  type: 'component' | 'lens' | 'server-lib';
  name: string;
  path: string;
  matchContext?: string;
}

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.04, duration: 0.3, ease: 'easeOut' },
  }),
};

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.35, ease: 'easeOut' } }),
};

export default function MetaLensPage() {
  useLensNav('meta');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('meta');
  const [lensName, setLensName] = useState('');
  const [lensDescription, setLensDescription] = useState('');
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'connections' | 'insights'>('overview');

// ---------------------------------------------------------------------------
// Domain color map for wiring view
// ---------------------------------------------------------------------------

const DOMAIN_COLORS: Record<string, string> = {
  admin: 'text-red-400 bg-red-400/10 border-red-400/30',
  common: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  lens: 'text-neon-purple bg-neon-purple/10 border-neon-purple/30',
  nervous: 'text-neon-pink bg-neon-pink/10 border-neon-pink/30',
  chat: 'text-neon-cyan bg-neon-cyan/10 border-neon-cyan/30',
  graph: 'text-neon-green bg-neon-green/10 border-neon-green/30',
  dtu: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
  home: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  market: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
};

function domainColor(domain: string): string {
  const key = Object.keys(DOMAIN_COLORS).find((k) => domain.toLowerCase().includes(k));
  return key ? DOMAIN_COLORS[key] : 'text-gray-400 bg-gray-400/10 border-gray-400/30';
}

// ---------------------------------------------------------------------------
// Small helper components
// ---------------------------------------------------------------------------

  const componentLibrary = componentItems.map(item => ({
    id: item.id,
    name: item.data.name || item.title,
    icon: ICON_MAP[item.data.icon] || Layout,
  }));

  const toggleComponent = (id: string) => {
    setSelectedComponents((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const handleGenerate = async () => {
    if (!lensName || selectedComponents.length === 0) return;

    setGenerating(true);
    setGeneratedCode(null);
    try {
      const componentNames = selectedComponents
        .map(id => componentLibrary.find(c => c.id === id)?.name || id)
        .join(', ');

      const prompt = `Generate a Next.js React lens component called "${lensName}" with description: "${lensDescription}". ` +
        `It should include these components: ${componentNames}. ` +
        `Use 'use client' directive, Tailwind CSS with neon-* color classes, and lucide-react icons. ` +
        `Return only the TSX code.`;

      const response = await apiHelpers.chat.ask(prompt, 'meta');
      const respData = response.data;

      // Extract the generated code from the response
      const code = typeof respData === 'string'
        ? respData
        : respData?.reply || respData?.answer || respData?.message || respData?.code || JSON.stringify(respData, null, 2);

      setGeneratedCode(code);

      // Persist the generated lens
      await createGeneratedLens({
        title: lensName,
        data: {
          lensName,
          description: lensDescription,
          components: selectedComponents.map(id => componentLibrary.find(c => c.id === id)?.name || id),
          code,
          generatedAt: new Date().toISOString(),
        } as unknown as Partial<GeneratedLensData>,
        meta: { tags: ['generated', 'lens'], status: 'generated' },
      });
    } catch {
      setGeneratedCode('// Error: Failed to generate lens code. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const isLoading = templatesLoading || componentsLoading || generatedLoading;

  // Cross-lens links (synthetic for meta dashboard)
  const crossLensLinks = [
    { from: 'attention', to: 'reflection', strength: 85, label: 'Focus analysis feeds reflections' },
    { from: 'hypothesis', to: 'transfer', strength: 72, label: 'Hypotheses transfer across domains' },
    { from: 'temporal', to: 'global', strength: 60, label: 'Temporal patterns in global DTUs' },
    { from: 'fractal', to: 'meta', strength: 90, label: 'Fractal structure powers meta-lens' },
    { from: 'mentorship', to: 'reflection', strength: 55, label: 'Mentorship insights drive reflection' },
  ];

  if (isError || isError2 || isError3) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message || error3?.message} onRetry={() => { refetch(); refetch2(); refetch3(); }} />
      </div>
    );
  }

  const tabs = [
    { key: 'overview' as const, label: 'Overview', icon: Layers },
    { key: 'connections' as const, label: 'Connections', icon: Link },
    { key: 'insights' as const, label: 'Insights', icon: BarChart },
  ];

  return (
    <div data-lens-theme="meta" className="p-6 space-y-6">
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3"
      >
        <Layers className="w-6 h-6 text-neon-purple" />
        <div>
          <h1 className="text-xl font-bold">Meta Lens</h1>
          <p className="text-sm text-gray-400">
            Builder for custom lenses - extend the lensbuilder/forge
          </p>
        </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="meta" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      </motion.header>


      {/* AI Actions */}
      <UniversalActions domain="meta" artifactId={templateItems[0]?.id} compact />

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Wand2, color: 'text-neon-purple', value: templates.length, label: 'Templates' },
          { icon: Layout, color: 'text-neon-blue', value: componentLibrary.length, label: 'Components' },
          { icon: Code, color: 'text-neon-green', value: generatedItems.length || '0', label: 'Generated Lenses' },
          { icon: Link, color: 'text-neon-cyan', value: crossLensLinks.length, label: 'Cross-Links' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.08, duration: 0.3 }}
            className="lens-card"
          >
            <stat.icon className={`w-5 h-5 ${stat.color} mb-2`} />
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-sm text-gray-400">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-lattice-void border border-lattice-border rounded-lg p-1">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all flex-1 justify-center',
              activeTab === tab.key
                ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/30'
                : 'text-gray-400 hover:text-white hover:bg-lattice-surface'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-12 text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          Loading meta lens data...
        </div>
      ) : (
        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.25 }}
              className="space-y-6"
            >
              {/* Lens Builder */}
              <div className="panel p-4">
                <h2 className="font-semibold mb-4 flex items-center gap-2">
                  <Wand2 className="w-4 h-4 text-neon-purple" />
                  Create New Lens
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="text-sm text-gray-400 block mb-2">Lens Name</label>
                    <input
                      type="text"
                      value={lensName}
                      onChange={(e) => setLensName(e.target.value)}
                      placeholder="My Custom Lens"
                      className="input-lattice w-full"
                      disabled={generating}
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 block mb-2">Description</label>
                    <input
                      type="text"
                      value={lensDescription}
                      onChange={(e) => setLensDescription(e.target.value)}
                      placeholder="What does this lens do?"
                      className="input-lattice w-full"
                      disabled={generating}
                    />
                  </div>
                </div>

                <div className="mb-4">
                  <label className="text-sm text-gray-400 block mb-2">Select Components</label>
                  <div className="flex flex-wrap gap-2">
                    {componentLibrary.map((comp) => {
                      const Icon = comp.icon;
                      const selected = selectedComponents.includes(comp.id);
                      return (
                        <button
                          key={comp.id}
                          onClick={() => toggleComponent(comp.id)}
                          disabled={generating}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                            selected
                              ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/30'
                              : 'bg-lattice-surface text-gray-400 hover:text-white'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                          {comp.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button
                  onClick={handleGenerate}
                  disabled={!lensName || selectedComponents.length === 0 || generating}
                  className="btn-neon purple w-full flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {generating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Code className="w-4 h-4" />
                  )}
                  {generating ? 'Generating...' : 'Generate Lens Code'}
                </button>
              </div>

              {/* Generated Code */}
              <AnimatePresence>
                {generatedCode && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="panel p-4 overflow-hidden"
                  >
                    <h2 className="font-semibold mb-4 flex items-center gap-2">
                      <Code className="w-4 h-4 text-neon-green" />
                      Generated Code
                    </h2>
                    <pre className="bg-lattice-deep rounded-lg p-4 overflow-x-auto text-sm font-mono text-gray-300 max-h-96 overflow-y-auto">
                      {generatedCode}
                    </pre>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Templates */}
              <div className="panel p-4">
                <h2 className="font-semibold mb-4 flex items-center gap-2">
                  <Layout className="w-4 h-4 text-neon-blue" />
                  Starter Templates
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {templates.map((template, i) => (
                    <motion.button
                      key={template.id}
                      custom={i}
                      variants={cardVariants}
                      initial="hidden"
                      animate="visible"
                      onClick={() => {
                        setLensName(template.name);
                        setLensDescription(template.description);
                      }}
                      className="lens-card text-left hover:border-neon-cyan"
                    >
                      <p className="font-semibold mb-1">{template.name}</p>
                      <p className="text-xs text-gray-400 mb-2">{template.description}</p>
                      <div className="flex flex-wrap gap-1">
                        {template.components.map((c) => (
                          <span key={c} className="text-xs px-1.5 py-0.5 bg-lattice-surface rounded">
                            {c}
                          </span>
                        ))}
                      </div>
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* Generated Lenses History */}
              {generatedItems.length > 0 && (
                <div className="panel p-4">
                  <h2 className="font-semibold mb-4 flex items-center gap-2">
                    <Wand2 className="w-4 h-4 text-neon-purple" />
                    Previously Generated Lenses
                  </h2>
                  <div className="space-y-2">
                    {generatedItems.slice(0, 5).map((item, i) => (
                      <motion.div
                        key={item.id}
                        custom={i}
                        variants={cardVariants}
                        initial="hidden"
                        animate="visible"
                        className="flex items-center justify-between p-3 bg-lattice-deep rounded-lg cursor-pointer hover:bg-lattice-surface"
                        onClick={() => {
                          setLensName(item.data.lensName || item.title);
                          setLensDescription(item.data.description || '');
                          setGeneratedCode(item.data.code || null);
                        }}
                      >
                        <div>
                          <p className="text-sm font-medium">{item.data.lensName || item.title}</p>
                          <p className="text-xs text-gray-500">
                            {item.data.components?.join(', ') || 'No components'}
                          </p>
                        </div>
                        <span className="text-xs text-gray-500">
                          {item.data.generatedAt
                            ? new Date(item.data.generatedAt).toLocaleDateString()
                            : new Date(item.createdAt).toLocaleDateString()}
                        </span>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'connections' && (
            <motion.div
              key="connections"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.25 }}
              className="panel p-6"
            >
              <h2 className="font-semibold mb-4 flex items-center gap-2">
                <Link className="w-4 h-4 text-neon-cyan" /> Cross-Lens Connections
              </h2>
              <p className="text-sm text-gray-400 mb-6">Visualize how lenses interconnect and share knowledge across the cognitive lattice.</p>
              <div className="space-y-3">
                {crossLensLinks.map((link, i) => (
                  <motion.div
                    key={`${link.from}-${link.to}`}
                    custom={i}
                    variants={cardVariants}
                    initial="hidden"
                    animate="visible"
                    className="lens-card"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-neon-purple/20 text-neon-purple text-xs font-semibold">{link.from}</span>
                        <Link className="w-3 h-3 text-gray-500" />
                        <span className="px-2 py-0.5 rounded bg-neon-cyan/20 text-neon-cyan text-xs font-semibold">{link.to}</span>
                      </div>
                      <span className="text-xs font-mono text-gray-400">{link.strength}%</span>
                    </div>
                    <p className="text-xs text-gray-400">{link.label}</p>
                    <div className="mt-2 h-1.5 bg-lattice-deep rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${link.strength}%` }}
                        transition={{ duration: 0.8, delay: i * 0.1 }}
                        className="h-full rounded-full bg-gradient-to-r from-neon-purple to-neon-cyan"
                      />
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === 'insights' && (
            <motion.div
              key="insights"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.25 }}
              className="panel p-6"
            >
              <h2 className="font-semibold mb-4 flex items-center gap-2">
                <BarChart className="w-4 h-4 text-neon-green" /> Meta-Stats Dashboard
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                {[
                  { label: 'Total Lenses', value: '10+', color: 'text-neon-purple' },
                  { label: 'Active Connections', value: crossLensLinks.length, color: 'text-neon-cyan' },
                  { label: 'Templates', value: templates.length, color: 'text-neon-blue' },
                  { label: 'Generated', value: generatedItems.length, color: 'text-neon-green' },
                ].map((stat, i) => (
                  <motion.div
                    key={stat.label}
                    custom={i}
                    variants={cardVariants}
                    initial="hidden"
                    animate="visible"
                    className="text-center p-4 bg-lattice-deep rounded-lg"
                  >
                    <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
                    <p className="text-xs text-gray-500 mt-1">{stat.label}</p>
                  </motion.div>
                ))}
              </div>
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-300">System Health</h3>
                {[
                  { label: 'Lens Coverage', value: 95 },
                  { label: 'Data Freshness', value: 88 },
                  { label: 'Connection Density', value: 72 },
                  { label: 'Generation Quality', value: 81 },
                ].map((metric, i) => (
                  <motion.div
                    key={metric.label}
                    custom={i}
                    variants={cardVariants}
                    initial="hidden"
                    animate="visible"
                  >
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-400">{metric.label}</span>
                      <span className={metric.value > 80 ? 'text-neon-green' : metric.value > 60 ? 'text-yellow-400' : 'text-red-400'}>
                        {metric.value}%
                      </span>
                    </div>
                    <div className="h-2 bg-lattice-deep rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${metric.value}%` }}
                        transition={{ duration: 0.8, delay: i * 0.1 }}
                        className={cn('h-full rounded-full', metric.value > 80 ? 'bg-neon-green' : metric.value > 60 ? 'bg-yellow-400' : 'bg-red-400')}
                      />
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="meta"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
    </div>
  );
}
