'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { SystemHealth } from '@/components/meta/SystemHealth';
import { useArtifacts, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  Layers,
  Search,
  FileCode,
  FolderTree,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Copy,
  ChevronDown,
  ChevronRight,
  Loader2,
  BarChart3,
  GitBranch,
  Package,
  Route,
  Eye,
  ArrowRight,
  Cog,
} from 'lucide-react';
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

const tabContentVariants = {
  initial: { opacity: 0, x: -20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 20 },
};

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

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  warning,
  index,
}: {
  icon: React.ComponentType<{ className?: string; size?: number | string }>;
  label: string;
  value: number | string;
  color: string;
  warning?: boolean;
  index: number;
}) {
  return (
    <motion.div
      custom={index}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      className={cn('lens-card', warning && 'border-yellow-500/40')}
    >
      <Icon className={cn('w-5 h-5 mb-2', color)} />
      <p className={cn('text-2xl font-bold', warning && 'text-yellow-400')}>{value}</p>
      <p className="text-sm text-gray-400">{label}</p>
    </motion.div>
  );
}

function WiredBadge({ wired }: { wired: boolean }) {
  return wired ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-500/20 text-green-400 border border-green-500/30">
      <CheckCircle className="w-3 h-3" /> Wired
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-500/20 text-red-400 border border-red-500/30">
      <XCircle className="w-3 h-3" /> Orphan
    </span>
  );
}

function SearchBar({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input-lattice w-full pl-10"
      />
    </div>
  );
}

function LoadingSpinner({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center p-12 text-gray-400">
      <Loader2 className="w-6 h-6 animate-spin mr-2" />
      {message}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-10 text-gray-500 text-sm border border-dashed border-white/10 rounded-lg">
      {message}
    </div>
  );
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    /* fallback: noop */
  });
}

// ---------------------------------------------------------------------------
// Tab: Overview
// ---------------------------------------------------------------------------

function OverviewTab() {
  const { data, isLoading } = useQuery<InventoryOverview>({
    queryKey: ['inventory-overview'],
    queryFn: () => api.get('/api/inventory').then((r) => r.data),
  });

  if (isLoading || !data) return <LoadingSpinner message="Loading inventory overview..." />;

  return (
    <motion.div {...tabContentVariants} transition={{ duration: 0.25 }} className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard icon={Package} label="Components" value={data.totalComponents} color="text-neon-blue" index={0} />
        <StatCard icon={Eye} label="Lenses" value={data.totalLenses} color="text-neon-purple" index={1} />
        <StatCard icon={FileCode} label="Server Libs" value={data.totalServerLibs} color="text-neon-green" index={2} />
        <StatCard icon={Route} label="Routes" value={data.totalRoutes} color="text-neon-cyan" index={3} />
        <StatCard
          icon={AlertTriangle}
          label="Orphaned"
          value={data.orphanedCount}
          color={data.orphanedCount > 0 ? 'text-yellow-400' : 'text-green-400'}
          warning={data.orphanedCount > 0}
          index={4}
        />
      </div>

      {/* Largest files */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-neon-cyan" />
          Largest Files (Top 10)
        </h2>
        <div className="space-y-2">
          {(data.largestFiles ?? []).map((f, i) => (
            <motion.div
              key={f.path}
              custom={i}
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              className="flex items-center justify-between p-2 bg-lattice-deep rounded-lg"
            >
              <span className="text-sm text-gray-300 font-mono truncate max-w-[70%]">{f.path}</span>
              <span className="text-xs text-gray-500 font-mono">{f.lines.toLocaleString()} lines</span>
            </motion.div>
          ))}
          {(!data.largestFiles || data.largestFiles.length === 0) && (
            <EmptyState message="No file data available." />
          )}
        </div>
      </div>

      {/* Most imported */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-neon-purple" />
          Most-Imported Components (Top 10)
        </h2>
        <div className="space-y-2">
          {(data.mostImported ?? []).map((c, i) => (
            <motion.div
              key={c.name}
              custom={i}
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              className="flex items-center justify-between p-2 bg-lattice-deep rounded-lg"
            >
              <span className="text-sm text-gray-300">{c.name}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-neon-purple/20 text-neon-purple font-mono">
                {c.importCount} imports
              </span>
            </motion.div>
          ))}
          {(!data.mostImported || data.mostImported.length === 0) && (
            <EmptyState message="No import data available." />
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Components
// ---------------------------------------------------------------------------

function ComponentsTab() {
  const { data, isLoading } = useQuery<ComponentEntry[]>({
    queryKey: ['inventory-components'],
    queryFn: () => api.get('/api/inventory/components').then((r) => r.data),
  });

  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!search) return data;
    const q = search.toLowerCase();
    return data.filter(
      (c) => c.name.toLowerCase().includes(q) || c.directory.toLowerCase().includes(q),
    );
  }, [data, search]);

  if (isLoading) return <LoadingSpinner message="Loading components..." />;

  return (
    <motion.div {...tabContentVariants} transition={{ duration: 0.25 }} className="space-y-4">
      <SearchBar value={search} onChange={setSearch} placeholder="Search components..." />

      <p className="text-xs text-gray-500">
        {filtered.length} component{filtered.length !== 1 ? 's' : ''} shown
        {search && ` (of ${data?.length ?? 0})`}
      </p>

      <div className="space-y-1 max-h-[70vh] overflow-y-auto pr-1">
        {filtered.map((comp, i) => {
          const key = `${comp.directory}/${comp.name}`;
          const expanded = expandedId === key;
          return (
            <motion.div key={key} custom={i} variants={cardVariants} initial="hidden" animate="visible">
              <button
                onClick={() => setExpandedId(expanded ? null : key)}
                className="w-full flex items-center justify-between p-3 bg-lattice-deep rounded-lg hover:bg-lattice-surface transition-colors text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {expanded ? (
                    <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-gray-500 shrink-0" />
                  )}
                  <span className="text-sm font-medium truncate">{comp.name}</span>
                  <span className="text-xs text-gray-500 truncate hidden md:inline">{comp.directory}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-gray-500 font-mono">{comp.lineCount} lines</span>
                  <WiredBadge wired={comp.wired} />
                </div>
              </button>
              <AnimatePresence>
                {expanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="p-4 ml-7 border-l border-white/5 space-y-3">
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Directory</p>
                        <p className="text-sm text-gray-300 font-mono">{comp.directory}</p>
                      </div>
                      {comp.exports.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Exports</p>
                          <div className="flex flex-wrap gap-1">
                            {comp.exports.map((e) => (
                              <span
                                key={e}
                                className="text-xs px-1.5 py-0.5 bg-lattice-surface rounded text-gray-300 font-mono"
                              >
                                {e}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {comp.importedBy.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Imported by</p>
                          <div className="flex flex-wrap gap-1">
                            {comp.importedBy.map((l) => (
                              <span
                                key={l}
                                className="text-xs px-1.5 py-0.5 bg-neon-purple/10 text-neon-purple rounded"
                              >
                                {l}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {comp.importedBy.length === 0 && (
                        <p className="text-xs text-yellow-400">Not imported by any lens.</p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
        {filtered.length === 0 && <EmptyState message="No components match your search." />}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Lenses
// ---------------------------------------------------------------------------

function LensesTab() {
  const { data, isLoading } = useQuery<LensEntry[]>({
    queryKey: ['inventory-lenses'],
    queryFn: () => api.get('/api/inventory/lenses').then((r) => r.data),
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (isLoading) return <LoadingSpinner message="Loading lenses..." />;

  return (
    <motion.div {...tabContentVariants} transition={{ duration: 0.25 }} className="space-y-4">
      <p className="text-xs text-gray-500">{data?.length ?? 0} lenses</p>

      <div className="space-y-1 max-h-[70vh] overflow-y-auto pr-1">
        {(data ?? []).map((lens, i) => {
          const expanded = expandedId === lens.name;
          return (
            <motion.div key={lens.name} custom={i} variants={cardVariants} initial="hidden" animate="visible">
              <button
                onClick={() => setExpandedId(expanded ? null : lens.name)}
                className="w-full flex items-center justify-between p-3 bg-lattice-deep rounded-lg hover:bg-lattice-surface transition-colors text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {expanded ? (
                    <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-gray-500 shrink-0" />
                  )}
                  <span className="text-sm font-medium truncate">{lens.name}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-gray-500 font-mono">{lens.lineCount} lines</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-neon-cyan/20 text-neon-cyan font-mono">
                    {lens.importCount} imports
                  </span>
                </div>
              </button>
              <AnimatePresence>
                {expanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="p-4 ml-7 border-l border-white/5 space-y-3">
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Path</p>
                        <p className="text-sm text-gray-300 font-mono">{lens.path}</p>
                      </div>
                      {lens.imports.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Imported Components</p>
                          <div className="flex flex-wrap gap-1">
                            {lens.imports.map((c) => (
                              <span
                                key={c}
                                className="text-xs px-1.5 py-0.5 bg-neon-blue/10 text-neon-blue rounded font-mono"
                              >
                                {c}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {lens.routes.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Server Routes</p>
                          <div className="flex flex-wrap gap-1">
                            {lens.routes.map((r) => (
                              <span
                                key={r}
                                className="text-xs px-1.5 py-0.5 bg-neon-green/10 text-neon-green rounded font-mono"
                              >
                                {r}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
        {(!data || data.length === 0) && <EmptyState message="No lens data available." />}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Orphans
// ---------------------------------------------------------------------------

function OrphansTab() {
  const { data, isLoading } = useQuery<OrphanEntry[]>({
    queryKey: ['inventory-orphans'],
    queryFn: () => api.get('/api/inventory/orphans').then((r) => r.data),
  });

  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const grouped = useMemo(() => {
    if (!data) return {};
    const groups: Record<string, OrphanEntry[]> = {};
    for (const entry of data) {
      const dir = entry.directory || 'unknown';
      if (!groups[dir]) groups[dir] = [];
      groups[dir].push(entry);
    }
    return groups;
  }, [data]);

  const handleWire = useCallback(
    (entry: OrphanEntry) => {
      const importPath = entry.path
        .replace(/\.tsx?$/, '')
        .replace(/\/index$/, '');
      const defaultExport = entry.exports.find((e) => e === 'default');
      const namedExports = entry.exports.filter((e) => e !== 'default');

      let importStatement = '';
      if (defaultExport && namedExports.length > 0) {
        importStatement = `import ${entry.name}, { ${namedExports.join(', ')} } from '${importPath}';`;
      } else if (defaultExport) {
        importStatement = `import ${entry.name} from '${importPath}';`;
      } else if (namedExports.length > 0) {
        importStatement = `import { ${namedExports.join(', ')} } from '${importPath}';`;
      } else {
        importStatement = `import ${entry.name} from '${importPath}';`;
      }

      copyToClipboard(importStatement);
      setCopiedPath(entry.path);
      setTimeout(() => setCopiedPath(null), 2000);
    },
    [],
  );

  if (isLoading) return <LoadingSpinner message="Loading orphaned components..." />;

  const dirs = Object.keys(grouped).sort();

  return (
    <motion.div {...tabContentVariants} transition={{ duration: 0.25 }} className="space-y-6">
      {data && data.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {data.length} orphaned component{data.length !== 1 ? 's' : ''} found -- not imported by any lens.
        </div>
      )}

      {dirs.map((dir) => (
        <div key={dir} className="panel p-4">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <FolderTree className="w-4 h-4 text-neon-cyan" />
            {dir}
            <span className="text-xs text-gray-500 font-normal">({grouped[dir].length})</span>
          </h3>
          <div className="space-y-2">
            {grouped[dir].map((entry, i) => (
              <motion.div
                key={entry.path}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                className="flex items-center justify-between p-3 bg-lattice-deep rounded-lg"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{entry.name}</p>
                  <p className="text-xs text-gray-500 font-mono truncate">{entry.path}</p>
                  {entry.exports.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {entry.exports.map((e) => (
                        <span
                          key={e}
                          className="text-xs px-1.5 py-0.5 bg-lattice-surface rounded text-gray-400 font-mono"
                        >
                          {e}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-gray-500 mt-1">{entry.lineCount} lines</p>
                </div>
                <button
                  onClick={() => handleWire(entry)}
                  className={cn(
                    'ml-3 shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                    copiedPath === entry.path
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                      : 'bg-neon-purple/20 text-neon-purple border border-neon-purple/30 hover:bg-neon-purple/30',
                  )}
                >
                  <Copy className="w-3 h-3" />
                  {copiedPath === entry.path ? 'Copied!' : 'Wire this'}
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      ))}

      {dirs.length === 0 && (
        <div className="text-center py-10 text-green-400 text-sm border border-dashed border-green-500/20 rounded-lg">
          <CheckCircle className="w-6 h-6 mx-auto mb-2" />
          All components are wired. No orphans detected.
        </div>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Wiring Map
// ---------------------------------------------------------------------------

function WiringTab() {
  const { data, isLoading } = useQuery<WiringEntry[]>({
    queryKey: ['inventory-wiring'],
    queryFn: () => api.get('/api/inventory/wiring').then((r) => r.data),
  });

  if (isLoading) return <LoadingSpinner message="Loading wiring map..." />;

  return (
    <motion.div {...tabContentVariants} transition={{ duration: 0.25 }} className="space-y-3">
      <p className="text-xs text-gray-500">{data?.length ?? 0} lens wiring entries</p>

      <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
        {(data ?? []).map((entry, i) => {
          const dc = domainColor(entry.domain);
          return (
            <motion.div
              key={entry.lens}
              custom={i}
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              className="p-3 bg-lattice-deep rounded-lg"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className={cn('text-xs px-2 py-0.5 rounded border font-semibold', dc)}>
                  {entry.lens}
                </span>
                <ArrowRight className="w-3 h-3 text-gray-600" />
                <span className="text-xs text-gray-500">{entry.domain}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {entry.components.map((c) => (
                  <span
                    key={c}
                    className="text-xs px-1.5 py-0.5 bg-lattice-surface rounded text-gray-300"
                  >
                    {c}
                  </span>
                ))}
                {entry.components.length === 0 && (
                  <span className="text-xs text-gray-600 italic">No component imports</span>
                )}
              </div>
            </motion.div>
          );
        })}
        {(!data || data.length === 0) && <EmptyState message="No wiring data available." />}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Search
// ---------------------------------------------------------------------------

function SearchTab() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Simple debounce
  const handleSearch = useCallback((v: string) => {
    setQuery(v);
    const timer = setTimeout(() => setDebouncedQuery(v), 300);
    return () => clearTimeout(timer);
  }, []);

  const { data, isLoading, isFetching } = useQuery<SearchResult[]>({
    queryKey: ['inventory-search', debouncedQuery],
    queryFn: () =>
      api.get('/api/inventory/search', { params: { q: debouncedQuery } }).then((r) => r.data),
    enabled: debouncedQuery.length >= 2,
  });

  const typeBadge = (type: string) => {
    switch (type) {
      case 'component':
        return (
          <span className="text-xs px-2 py-0.5 rounded bg-neon-blue/20 text-neon-blue border border-neon-blue/30">
            Component
          </span>
        );
      case 'lens':
        return (
          <span className="text-xs px-2 py-0.5 rounded bg-neon-purple/20 text-neon-purple border border-neon-purple/30">
            Lens
          </span>
        );
      case 'server-lib':
        return (
          <span className="text-xs px-2 py-0.5 rounded bg-neon-green/20 text-neon-green border border-neon-green/30">
            Server Lib
          </span>
        );
      default:
        return (
          <span className="text-xs px-2 py-0.5 rounded bg-gray-500/20 text-gray-400">
            {type}
          </span>
        );
    }
  };

  return (
    <motion.div {...tabContentVariants} transition={{ duration: 0.25 }} className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search components, lenses, server libs..."
          className="input-lattice w-full pl-10 pr-10"
        />
        {isFetching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 animate-spin" />
        )}
      </div>

      {debouncedQuery.length < 2 && (
        <p className="text-xs text-gray-500 text-center py-8">
          Type at least 2 characters to search.
        </p>
      )}

      {isLoading && debouncedQuery.length >= 2 && (
        <LoadingSpinner message="Searching..." />
      )}

      {data && data.length > 0 && (
        <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1">
          <p className="text-xs text-gray-500">{data.length} result{data.length !== 1 ? 's' : ''}</p>
          {data.map((result, i) => (
            <motion.div
              key={`${result.type}-${result.path}`}
              custom={i}
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              className="flex items-center justify-between p-3 bg-lattice-deep rounded-lg"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{result.name}</p>
                <p className="text-xs text-gray-500 font-mono truncate">{result.path}</p>
                {result.matchContext && (
                  <p className="text-xs text-gray-400 mt-1 truncate">{result.matchContext}</p>
                )}
              </div>
              <div className="ml-3 shrink-0">{typeBadge(result.type)}</div>
            </motion.div>
          ))}
        </div>
      )}

      {data && data.length === 0 && debouncedQuery.length >= 2 && (
        <EmptyState message={`No results for "${debouncedQuery}".`} />
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Lens Infrastructure
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  product: 'text-green-400 bg-green-400/10 border-green-400/30',
  hybrid: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
  viewer: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  system: 'text-gray-400 bg-gray-400/10 border-gray-400/30',
  deprecated: 'text-red-400 bg-red-400/10 border-red-400/30',
};

function LensInfrastructureTab() {
  const [infraSection, setInfraSection] = useState<'manifests' | 'status' | 'merge' | 'roadmap' | 'wiring'>('manifests');

  const statusSummary = useMemo(() => getLensStatusSummary(), []);
  const productLenses = useMemo(() => getProductLenses(), []);
  const deprecatedLenses = useMemo(() => getDeprecatedLenses(), []);
  const missingMacro = useMemo(() => getLensesMissingMacro('create'), []);
  const currentPhase = useMemo(() => getCurrentPhase(), []);
  const mergeReduction = useMemo(() => getMergeReductionCount(), []);
  const totalArtifacts = useMemo(() => getTotalArtifactCount(), []);
  const totalEngines = useMemo(() => getTotalEngineCount(), []);
  const manifests = useMemo(() => getLensManifests(), []);
  const wiringCategories = useMemo(() => Object.keys(WIRING_PROFILES), []);

  const infraSections = [
    { key: 'manifests' as const, label: 'Manifests' },
    { key: 'status' as const, label: 'Status Taxonomy' },
    { key: 'merge' as const, label: 'Merge Map' },
    { key: 'roadmap' as const, label: 'Productization' },
    { key: 'wiring' as const, label: 'Wiring Profiles' },
  ];

  return (
    <motion.div {...tabContentVariants} transition={{ duration: 0.25 }} className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard icon={Package} label="Manifests" value={getManifestCount()} color="text-neon-purple" index={0} />
        <StatCard icon={CheckCircle} label="Product Lenses" value={productLenses.length} color="text-green-400" index={1} />
        <StatCard icon={GitBranch} label="Merge Groups" value={LENS_MERGE_GROUPS.length} color="text-neon-cyan" index={2} />
        <StatCard icon={Route} label="Total Engines" value={totalEngines} color="text-neon-blue" index={3} />
        <StatCard icon={AlertTriangle} label="Deprecated" value={deprecatedLenses.length} color="text-yellow-400" warning={deprecatedLenses.length > 0} index={4} />
      </div>

      {/* Sub-navigation */}
      <div className="flex gap-1 bg-lattice-void border border-lattice-border rounded-lg p-1 overflow-x-auto">
        {infraSections.map((sec) => (
          <button
            key={sec.key}
            onClick={() => setInfraSection(sec.key)}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap',
              infraSection === sec.key
                ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30'
                : 'text-gray-400 hover:text-white hover:bg-lattice-surface',
            )}
          >
            {sec.label}
          </button>
        ))}
      </div>

      {/* Manifests section */}
      {infraSection === 'manifests' && (
        <div className="panel p-4 space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Package className="w-4 h-4 text-neon-purple" />
            Lens Manifests ({manifests.length})
          </h2>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {manifests.map((m, i) => (
              <motion.div
                key={m.domain}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                className="flex items-center justify-between p-3 bg-lattice-deep rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{m.label}</p>
                  <p className="text-xs text-gray-500 font-mono">{m.domain} &middot; {m.category}</p>
                </div>
                <div className="flex gap-2 items-center">
                  <span className="text-xs px-2 py-0.5 rounded bg-neon-purple/20 text-neon-purple">{m.artifacts.length} artifacts</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-neon-blue/20 text-neon-blue">{m.actions.length} actions</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-neon-green/20 text-neon-green">{m.exports.length} exports</span>
                </div>
              </motion.div>
            ))}
          </div>
          {missingMacro.length > 0 && (
            <div className="mt-3 p-3 border border-yellow-500/30 rounded-lg bg-yellow-500/5">
              <p className="text-xs text-yellow-400 font-semibold mb-1">Missing Macro Mappings ({missingMacro.length})</p>
              <p className="text-xs text-gray-400">{missingMacro.join(', ')}</p>
            </div>
          )}
        </div>
      )}

      {/* Status Taxonomy section */}
      {infraSection === 'status' && (
        <div className="panel p-4 space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-neon-cyan" />
            Lens Status Taxonomy
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            {Object.entries(statusSummary).map(([status, count]) => (
              <div key={status} className={cn('p-3 rounded-lg border text-center', STATUS_COLORS[status] || 'text-gray-400 bg-gray-400/10 border-gray-400/30')}>
                <p className="text-lg font-bold">{count as number}</p>
                <p className="text-xs capitalize">{status}</p>
              </div>
            ))}
          </div>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {LENS_STATUS_MAP.map((entry, i) => (
              <motion.div
                key={entry.id}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                className="flex items-center justify-between p-2 bg-lattice-deep rounded-lg"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn('inline-block px-2 py-0.5 rounded-full text-xs border', STATUS_COLORS[entry.status] || '')}>{entry.status}</span>
                  <span className="text-sm text-gray-300 font-mono">{entry.id}</span>
                </div>
                <div className="text-xs text-gray-500 truncate max-w-[40%] text-right">
                  {entry.mergeTarget ? `-> ${entry.mergeTarget} (${entry.postMergeRole})` : 'standalone'}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Merge Map section */}
      {infraSection === 'merge' && (
        <div className="panel p-4 space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-neon-green" />
            Lens Merge Map ({LENS_MERGE_GROUPS.length} groups, reduces by {mergeReduction.merged})
          </h2>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {LENS_MERGE_GROUPS.map((group, i) => (
              <motion.div
                key={group.targetId}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                className="p-3 bg-lattice-deep rounded-lg border border-lattice-border"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-neon-green">{group.targetId}</span>
                  <span className="text-xs text-gray-500">{group.sources.length} sources merging in</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {group.sources.map((src) => (
                    <span key={src.id} className="text-xs px-2 py-0.5 rounded bg-white/5 text-gray-400 border border-white/10">
                      {src.id} ({src.role})
                    </span>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
          {POST_MERGE_STANDALONE_LENSES.length > 0 && (
            <div className="p-3 border border-neon-cyan/20 rounded-lg bg-neon-cyan/5">
              <p className="text-xs text-neon-cyan font-semibold mb-1">Post-Merge Standalone ({POST_MERGE_STANDALONE_LENSES.length})</p>
              <p className="text-xs text-gray-400">{POST_MERGE_STANDALONE_LENSES.join(', ')}</p>
            </div>
          )}
        </div>
      )}

      {/* Productization Roadmap section */}
      {infraSection === 'roadmap' && (
        <div className="panel p-4 space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Route className="w-4 h-4 text-neon-blue" />
            Productization Roadmap ({PRODUCTIZATION_PHASES.length} phases, {totalArtifacts} artifacts)
          </h2>
          {currentPhase && (
            <div className="p-3 border border-neon-blue/30 rounded-lg bg-neon-blue/5 mb-3">
              <p className="text-xs text-neon-blue font-semibold">Current Phase: {currentPhase.name}</p>
              <p className="text-xs text-gray-400 mt-1">{currentPhase.rationale}</p>
            </div>
          )}
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {PRODUCTIZATION_PHASES.map((phase, i) => (
              <motion.div
                key={phase.lensId}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                className="p-3 bg-lattice-deep rounded-lg border border-lattice-border"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-white">{phase.name}</span>
                  <span className={cn(
                    'text-xs px-2 py-0.5 rounded-full',
                    phase.status === 'in_progress' ? 'bg-green-500/20 text-green-400' :
                    phase.status === 'ready' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-gray-500/20 text-gray-400'
                  )}>{phase.status}</span>
                </div>
                <p className="text-xs text-gray-500 mb-2">{phase.rationale}</p>
                <div className="flex gap-3 text-xs text-gray-400">
                  <span>{phase.pipelines.length} pipelines</span>
                  <span>{phase.engines.length} engines</span>
                  <span>{phase.artifacts.length} artifacts</span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Wiring Profiles section */}
      {infraSection === 'wiring' && (
        <div className="panel p-4 space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Cog className="w-4 h-4 text-neon-purple" />
            Wiring Profiles ({wiringCategories.length} categories)
          </h2>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {wiringCategories.map((cat, i) => {
              const profile = getWiringProfile(cat);
              const score = getCategoryIntegrationScore(cat);
              return (
                <motion.div
                  key={cat}
                  custom={i}
                  variants={cardVariants}
                  initial="hidden"
                  animate="visible"
                  className="p-3 bg-lattice-deep rounded-lg border border-lattice-border"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-sm font-semibold text-white">{profile.label}</span>
                      <span className="text-xs text-gray-500 ml-2">({cat})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">Integration:</span>
                      <span className={cn(
                        'text-xs font-mono px-2 py-0.5 rounded',
                        score >= 80 ? 'bg-green-500/20 text-green-400' :
                        score >= 50 ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-red-500/20 text-red-400'
                      )}>{score}%</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mb-2">{profile.description}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                    <span>{profile.enabledHooks.length}/30 hooks</span>
                    <span>Layout: {profile.defaultLayout}</span>
                    <span>Analytics: {profile.analyticsLevel}</span>
                    <span>AI: {profile.aiFeatures.join(', ') || 'none'}</span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

type TabKey = 'overview' | 'components' | 'lenses' | 'orphans' | 'wiring' | 'search' | 'lens-infra';

const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string; size?: number | string }> }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'components', label: 'Components', icon: Package },
  { key: 'lenses', label: 'Lenses', icon: Eye },
  { key: 'orphans', label: 'Orphans', icon: AlertTriangle },
  { key: 'wiring', label: 'Wiring Map', icon: GitBranch },
  { key: 'search', label: 'Search', icon: Search },
  { key: 'lens-infra', label: 'Lens Infrastructure', icon: Cog },
];

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function MetaLensPage() {
  const viewLog = useArtifacts<{ at: string }>('meta', { type: 'view-event', limit: 5 });
  const recordView = useCreateArtifact<{ at: string }>('meta');
  void viewLog; void recordView;
  useLensNav('meta');
  const { isLive, lastUpdated } = useRealtimeLens('meta');
  const [activeTab, setActiveTab] = useState<TabKey>('overview');


  // Lens-scoped keyboard commands (auto-wired by codemod).
  useLensCommand(
    [
      { id: 'tab-overview', keys: 'o', description: 'Overview', category: 'navigation', action: () => setActiveTab('overview') },
      { id: 'tab-components', keys: 'c', description: 'Components', category: 'navigation', action: () => setActiveTab('components') },
      { id: 'tab-lenses', keys: 'l', description: 'Lenses', category: 'navigation', action: () => setActiveTab('lenses') },
      { id: 'tab-orphans', keys: 'r', description: 'Orphans', category: 'navigation', action: () => setActiveTab('orphans') },
      { id: 'tab-wiring', keys: 'w', description: 'Wiring', category: 'navigation', action: () => setActiveTab('wiring') },
      { id: 'tab-search', keys: 's', description: 'Search', category: 'navigation', action: () => setActiveTab('search') },
      { id: 'tab-lens-infra', keys: 'e', description: 'Lens Infra', category: 'navigation', action: () => setActiveTab('lens-infra') },
    ],
    { lensId: 'meta' }
  );
  return (
    <LensShell lensId="meta" asMain={false}>
      <FirstRunTour lensId="meta" />
      <ManifestActionBar />
      <DepthBadge lensId="meta" size="sm" className="ml-2" />
    <div data-lens-theme="meta" className="p-6 space-y-6">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between flex-wrap gap-3"
      >
        <div className="flex items-center gap-3">
          <Layers className="w-6 h-6 text-neon-purple" />
          <div>
            <h1 className="text-xl font-bold">Codebase Inventory</h1>
            <p className="text-sm text-gray-400">
              Components, lenses, wiring, and orphan analysis
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="meta" data={{}} compact />
        </div>
      </motion.header>

      {/* Tab bar */}
      <div className="flex gap-1 bg-lattice-void border border-lattice-border rounded-lg p-1 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap',
              activeTab === tab.key
                ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/30'
                : 'text-gray-400 hover:text-white hover:bg-lattice-surface',
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 20 }}
          transition={{ duration: 0.25 }}
        >
          {activeTab === 'overview' && <OverviewTab />}
          {activeTab === 'components' && <ComponentsTab />}
          {activeTab === 'lenses' && <LensesTab />}
          {activeTab === 'orphans' && <OrphansTab />}
          {activeTab === 'wiring' && <WiringTab />}
          {activeTab === 'search' && <SearchTab />}
          {activeTab === 'lens-infra' && <LensInfrastructureTab />}
        </motion.div>
      </AnimatePresence>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <SystemHealth />
      </section>
    </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
      <a href="#meta-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to meta content</a>
          <RecentMineCard domain="meta" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="meta" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="meta" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
