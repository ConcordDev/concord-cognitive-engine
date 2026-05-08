'use client';

/**
 * ForgeWorkbench — Polyglot Monolith Template Engine UI
 *
 * Full workbench for generating, configuring, previewing, and exporting
 * Forge single-file apps. Integrated as a mode within the Code lens.
 *
 * Features:
 *   - Template selector (blank, SaaS, e-commerce, social, API-only, realtime)
 *   - Section configurator with all 13 sections visualized
 *   - Config editor with validation
 *   - Live code preview with section navigation
 *   - Repair Cortex status display
 *   - Export / download generated app
 *   - Domain table editor
 */

import { useState, useCallback, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import {
  Hammer, Download, Play, Check, X, ChevronDown, ChevronRight,
  Shield, Cpu, Database, Lock, CreditCard, Globe, Wifi, Clock,
  Layers, TestTube, Rocket, Heart, Settings, Plus, Trash2,
  FileCode, AlertTriangle, Eye, EyeOff, Copy, Loader2,
  Zap, RefreshCw
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

// ── Section icon mapping ────────────────────────────────────────────────
const SECTION_ICONS: Record<string, React.ElementType> = {
  dependencies: Layers,
  config: Settings,
  database: Database,
  auth: Lock,
  payments: CreditCard,
  api: Globe,
  frontend: Eye,
  websocket: Wifi,
  jobs: Clock,
  threads: Cpu,
  testing: TestTube,
  deployment: Rocket,
  repair: Heart,
};

const SECTION_COLORS: Record<string, string> = {
  dependencies: 'text-gray-400',
  config: 'text-blue-400',
  database: 'text-green-400',
  auth: 'text-yellow-400',
  payments: 'text-purple-400',
  api: 'text-cyan-400',
  frontend: 'text-pink-400',
  websocket: 'text-orange-400',
  jobs: 'text-teal-400',
  threads: 'text-red-400',
  testing: 'text-lime-400',
  deployment: 'text-indigo-400',
  repair: 'text-rose-500',
};

interface ForgeTemplate {
  id: string;
  label: string;
  description: string;
  price: number;
  sections: string[];
  prefilledDomainTables?: string[];
}

interface ForgeSection {
  id: string;
  number: number;
  label: string;
  description: string;
  required: boolean;
  language: string;
  immutable?: boolean;
}

interface GenerateResult {
  ok: boolean;
  code: string;
  sections: ForgeSection[];
  config: Record<string, unknown>;
  template: string;
  stats: {
    totalSections: number;
    linesEstimate: number;
    domainTables: number;
  };
}

export function ForgeWorkbench() {
  // ── State ───────────────────────────────────────────────────────────
  const [selectedTemplate, setSelectedTemplate] = useState<string>('blank');
  const [appName, setAppName] = useState('my-forge-app');
  const [port, setPort] = useState(3000);
  const [dbDriver, setDbDriver] = useState<'sqlite' | 'postgres'>('sqlite');
  const [concordNode, setConcordNode] = useState(false);
  const [domainTables, setDomainTables] = useState<string[]>([]);
  const [newTableName, setNewTableName] = useState('');
  const [enabledSections, setEnabledSections] = useState<string[] | null>(null);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<'config' | 'preview' | 'sections'>('config');
  const [previewSection, setPreviewSection] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [jwtSecret, setJwtSecret] = useState('');
  const [stripeKey, setStripeKey] = useState('');

  // ── Queries ─────────────────────────────────────────────────────────
  const { data: templatesData } = useQuery({
    queryKey: ['forge', 'templates'],
    queryFn: async () => {
      const res = await fetch('/api/forge/templates');
      return res.json();
    },
  });

  const { data: sectionsData } = useQuery({
    queryKey: ['forge', 'sections'],
    queryFn: async () => {
      const res = await fetch('/api/forge/sections');
      return res.json();
    },
  });

  const templates: ForgeTemplate[] = templatesData?.templates || [];
  const allSections: ForgeSection[] = sectionsData?.sections || [];
  const currentTemplate = templates.find(t => t.id === selectedTemplate);

  // ── Mutations ───────────────────────────────────────────────────────
  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/forge/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: selectedTemplate,
          config: {
            appName,
            port,
            database: { driver: dbDriver },
            auth: { jwtSecret: jwtSecret || undefined },
            stripe: { secretKey: stripeKey || undefined },
            concordNode,
          },
          domainTables,
          enabledSections,
        }),
      });
      return res.json() as Promise<GenerateResult>;
    },
    onSuccess: (data) => {
      if (data.ok) {
        setGeneratedCode(data.code);
        setActivePanel('preview');
      }
    },
  });

  const validateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/forge/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: {
            appName,
            port,
            database: { driver: dbDriver, path: dbDriver === 'sqlite' ? './data/app.db' : undefined },
            auth: { jwtSecret: jwtSecret || 'CHANGE_ME_IN_PRODUCTION' },
            stripe: { secretKey: stripeKey || undefined },
            concordNode,
          },
        }),
      });
      return res.json();
    },
  });

  // ── Handlers ────────────────────────────────────────────────────────
  const handleAddTable = useCallback(() => {
    const name = newTableName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (name && !domainTables.includes(name)) {
      setDomainTables(prev => [...prev, name]);
      setNewTableName('');
    }
  }, [newTableName, domainTables]);

  const handleRemoveTable = useCallback((table: string) => {
    setDomainTables(prev => prev.filter(t => t !== table));
  }, []);

  const handleToggleSection = useCallback((sectionId: string) => {
    const section = allSections.find(s => s.id === sectionId);
    if (section?.required || section?.immutable) return;

    setEnabledSections(prev => {
      const current = prev || currentTemplate?.sections || allSections.map(s => s.id);
      return current.includes(sectionId)
        ? current.filter(s => s !== sectionId)
        : [...current, sectionId];
    });
  }, [allSections, currentTemplate]);

  const handleDownload = useCallback(() => {
    if (!generatedCode) return;
    const blob = new Blob([generatedCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${appName || 'forge-app'}.mjs`;
    a.click();
    URL.revokeObjectURL(url);
  }, [generatedCode, appName]);

  const handleCopyCode = useCallback(() => {
    if (generatedCode) navigator.clipboard?.writeText(generatedCode);
  }, [generatedCode]);

  // ── Section navigation in preview ─────────────────────────────────
  const sectionOffsets = useMemo(() => {
    if (!generatedCode) return new Map<string, number>();
    const offsets = new Map<string, number>();
    const lines = generatedCode.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/SECTION (\d+)/);
      if (match) {
        const sectionNum = parseInt(match[1]);
        const section = allSections.find(s => s.number === sectionNum);
        if (section) offsets.set(section.id, i);
      }
    }
    return offsets;
  }, [generatedCode, allSections]);

  const activeSections = enabledSections || currentTemplate?.sections || allSections.map(s => s.id);

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-lattice-border bg-lattice-surface/50">
        <div className="flex items-center gap-3">
          <Hammer className="w-6 h-6 text-orange-400" />
          <div>
            <h2 className="text-lg font-bold">Forge</h2>
            <p className="text-xs text-gray-400">Polyglot Monolith Template Engine — One file. One process. Everything alive.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => validateMutation.mutate()}
            disabled={validateMutation.isPending}
            className="px-3 py-1.5 text-sm rounded-lg border border-lattice-border hover:bg-lattice-elevated text-gray-300 transition-colors flex items-center gap-1.5"
          >
            {validateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Validate
          </button>
          <button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            className="px-3 py-1.5 text-sm rounded-lg bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 transition-colors flex items-center gap-1.5 font-medium"
          >
            {generateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            Generate App
          </button>
          {generatedCode && (
            <>
              <button onClick={handleCopyCode} className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400" title="Copy to clipboard">
                <Copy className="w-4 h-4" />
              </button>
              <button onClick={handleDownload} className="p-2 rounded-lg hover:bg-lattice-elevated text-orange-400" title="Download .mjs file">
                <Download className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Validation result banner */}
      <AnimatePresence>
        {validateMutation.data && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className={cn(
              'px-4 py-2 text-sm border-b border-lattice-border',
              validateMutation.data.valid ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
            )}
          >
            {validateMutation.data.valid ? (
              <span className="flex items-center gap-2"><Check className="w-4 h-4" /> Configuration is valid</span>
            ) : (
              <div>
                <span className="flex items-center gap-2 mb-1"><AlertTriangle className="w-4 h-4" /> Validation issues:</span>
                <ul className="list-disc list-inside text-xs">
                  {validateMutation.data.errors?.map((e: string, i: number) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Panel tabs */}
      <div className="flex items-center gap-1 px-4 py-1.5 bg-lattice-surface/30 border-b border-lattice-border">
        {(['config', 'sections', 'preview'] as const).map(panel => (
          <button
            key={panel}
            onClick={() => setActivePanel(panel)}
            className={cn(
              'px-3 py-1.5 text-sm rounded-lg transition-colors capitalize',
              activePanel === panel ? 'bg-lattice-elevated text-white' : 'text-gray-500 hover:text-gray-300'
            )}
          >
            {panel === 'config' && <Settings className="w-3.5 h-3.5 inline mr-1.5" />}
            {panel === 'sections' && <Layers className="w-3.5 h-3.5 inline mr-1.5" />}
            {panel === 'preview' && <FileCode className="w-3.5 h-3.5 inline mr-1.5" />}
            {panel}
            {panel === 'preview' && generatedCode && (
              <span className="ml-1.5 text-xs text-orange-400">
                ({generateMutation.data?.stats?.linesEstimate || '?'} lines)
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-hidden">
        {/* CONFIG PANEL */}
        {activePanel === 'config' && (
          <div className="h-full overflow-y-auto p-4 space-y-6">
            {/* Template selector */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Base Template</label>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                {templates.map(t => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setSelectedTemplate(t.id);
                      setEnabledSections(null);
                      if (t.prefilledDomainTables) setDomainTables(t.prefilledDomainTables);
                    }}
                    className={cn(
                      'p-3 rounded-lg border text-left transition-all',
                      selectedTemplate === t.id
                        ? 'border-orange-500/50 bg-orange-500/10'
                        : 'border-lattice-border hover:border-gray-600 bg-lattice-surface/30'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{t.label}</span>
                      {t.price > 0 && <span className="text-xs text-orange-400">${t.price}</span>}
                      {t.price === 0 && <span className="text-xs text-green-400">Free</span>}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{t.description}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Basic config */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">App Name</label>
                <input
                  value={appName}
                  onChange={e => setAppName(e.target.value)}
                  className="w-full px-3 py-2 bg-lattice-deep border border-lattice-border rounded-lg text-sm text-white focus:outline-none focus:border-orange-500/50"
                  placeholder="my-forge-app"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Port</label>
                <input
                  type="number"
                  value={port}
                  onChange={e => setPort(parseInt(e.target.value) || 3000)}
                  className="w-full px-3 py-2 bg-lattice-deep border border-lattice-border rounded-lg text-sm text-white focus:outline-none focus:border-orange-500/50"
                />
              </div>
            </div>

            {/* Database driver */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Database</label>
              <div className="flex gap-2">
                {(['sqlite', 'postgres'] as const).map(d => (
                  <button
                    key={d}
                    onClick={() => setDbDriver(d)}
                    className={cn(
                      'px-3 py-2 rounded-lg text-sm border transition-colors',
                      dbDriver === d
                        ? 'border-green-500/50 bg-green-500/10 text-green-400'
                        : 'border-lattice-border text-gray-400 hover:text-white'
                    )}
                  >
                    <Database className="w-3.5 h-3.5 inline mr-1.5" />
                    {d === 'sqlite' ? 'SQLite' : 'PostgreSQL'}
                  </button>
                ))}
              </div>
            </div>

            {/* Concord node toggle */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setConcordNode(!concordNode)}
                className={cn(
                  'relative w-11 h-6 rounded-full transition-colors',
                  concordNode ? 'bg-orange-500' : 'bg-gray-700'
                )}
              >
                <div className={cn(
                  'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                  concordNode ? 'left-6' : 'left-1'
                )} />
              </button>
              <div>
                <span className="text-sm text-gray-300">Concord Node</span>
                <p className="text-xs text-gray-500">Enable DTU format, mesh transport, marketplace connectivity, and collective immunity</p>
              </div>
            </div>

            {/* Domain tables */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Domain Tables</label>
              <div className="flex gap-2 mb-2">
                <input
                  value={newTableName}
                  onChange={e => setNewTableName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddTable()}
                  className="flex-1 px-3 py-2 bg-lattice-deep border border-lattice-border rounded-lg text-sm text-white focus:outline-none focus:border-orange-500/50"
                  placeholder="table_name"
                />
                <button onClick={handleAddTable} className="p-2 rounded-lg bg-lattice-elevated hover:bg-lattice-border text-gray-400 hover:text-white">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              {domainTables.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {domainTables.map(t => (
                    <span key={t} className="flex items-center gap-1 px-2 py-1 bg-lattice-elevated rounded text-xs text-gray-300">
                      <Database className="w-3 h-3 text-green-400" />
                      {t}
                      <button onClick={() => handleRemoveTable(t)} className="ml-1 hover:text-red-400"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Advanced config */}
            <div>
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                {showAdvanced ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                Advanced Configuration
              </button>
              <AnimatePresence>
                {showAdvanced && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="mt-3 space-y-3 overflow-hidden"
                  >
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">JWT Secret</label>
                      <input
                        value={jwtSecret}
                        onChange={e => setJwtSecret(e.target.value)}
                        type="password"
                        className="w-full px-3 py-2 bg-lattice-deep border border-lattice-border rounded-lg text-sm text-white focus:outline-none focus:border-orange-500/50"
                        placeholder="Leave empty for dev default"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Stripe Secret Key</label>
                      <input
                        value={stripeKey}
                        onChange={e => setStripeKey(e.target.value)}
                        type="password"
                        className="w-full px-3 py-2 bg-lattice-deep border border-lattice-border rounded-lg text-sm text-white focus:outline-none focus:border-orange-500/50"
                        placeholder="sk_..."
                      />
                    </div>

                    {/* Repair Cortex info */}
                    <div className="p-3 rounded-lg border border-rose-500/20 bg-rose-500/5">
                      <div className="flex items-center gap-2 mb-2">
                        <Heart className="w-4 h-4 text-rose-500" />
                        <span className="text-sm font-medium text-rose-400">Repair Cortex</span>
                        <span className="text-xs px-1.5 py-0.5 bg-rose-500/20 text-rose-400 rounded">Always Active</span>
                      </div>
                      <p className="text-xs text-gray-400">
                        Three-phase self-healing: Prophet (predict) → Surgeon (fix) → Guardian (validate).
                        Cannot be disabled. Every app ships with an immune system.
                      </p>
                      {concordNode && (
                        <p className="text-xs text-orange-400 mt-1">
                          Collective immunity enabled — repair DTUs propagate to the mesh.
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* SECTIONS PANEL */}
        {activePanel === 'sections' && (
          <div className="h-full overflow-y-auto p-4">
            <div className="space-y-2">
              {allSections.map(section => {
                const Icon = SECTION_ICONS[section.id] || Layers;
                const color = SECTION_COLORS[section.id] || 'text-gray-400';
                const isEnabled = activeSections.includes(section.id) || section.id === 'repair';
                const isLocked = section.required || section.immutable;

                return (
                  <div
                    key={section.id}
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-lg border transition-all',
                      isEnabled
                        ? 'border-lattice-border bg-lattice-surface/50'
                        : 'border-lattice-border/50 bg-lattice-deep/50 opacity-50'
                    )}
                  >
                    <button
                      onClick={() => handleToggleSection(section.id)}
                      disabled={isLocked}
                      className={cn(
                        'w-5 h-5 rounded flex items-center justify-center border transition-colors flex-shrink-0',
                        isLocked && isEnabled ? 'bg-orange-500/20 border-orange-500/50' :
                        isEnabled ? 'bg-green-500/20 border-green-500/50' : 'border-gray-600'
                      )}
                    >
                      {isEnabled && <Check className="w-3 h-3 text-green-400" />}
                      {isLocked && <Lock className="w-3 h-3 text-orange-400" />}
                    </button>
                    <Icon className={cn('w-5 h-5 flex-shrink-0', color)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {section.number}. {section.label}
                        </span>
                        {section.immutable && (
                          <span className="text-[10px] px-1 py-0.5 bg-rose-500/20 text-rose-400 rounded">Cannot disable</span>
                        )}
                        {section.required && !section.immutable && (
                          <span className="text-[10px] px-1 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">Required</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 truncate">{section.description}</p>
                    </div>
                    <span className="text-xs text-gray-600 flex-shrink-0">{section.language}</span>
                  </div>
                );
              })}
            </div>

            {/* Section count summary */}
            <div className="mt-4 p-3 rounded-lg bg-lattice-deep border border-lattice-border">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Active sections</span>
                <span className="text-white font-medium">
                  {activeSections.length + (activeSections.includes('repair') ? 0 : 1)} / {allSections.length}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Repair Cortex (Section 13) is always included. Required sections cannot be removed.
              </p>
            </div>
          </div>
        )}

        {/* PREVIEW PANEL */}
        {activePanel === 'preview' && (
          <div className="h-full flex">
            {/* Section navigator sidebar */}
            {generatedCode && (
              <div className="w-48 border-r border-lattice-border bg-lattice-surface/30 overflow-y-auto flex-shrink-0">
                <div className="p-2 text-xs font-semibold text-gray-400 uppercase border-b border-lattice-border">
                  Sections
                </div>
                {allSections.filter(s => activeSections.includes(s.id) || s.id === 'repair').map(section => {
                  const Icon = SECTION_ICONS[section.id] || Layers;
                  const color = SECTION_COLORS[section.id] || 'text-gray-400';
                  return (
                    <button
                      key={section.id}
                      onClick={() => setPreviewSection(section.id)}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-lattice-elevated transition-colors',
                        previewSection === section.id ? 'bg-lattice-elevated text-white' : 'text-gray-400'
                      )}
                    >
                      <Icon className={cn('w-3.5 h-3.5', color)} />
                      <span className="truncate">{section.number}. {section.label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Code preview */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {generatedCode ? (
                <>
                  <div className="flex items-center justify-between px-3 py-1.5 bg-lattice-deep border-b border-lattice-border">
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <FileCode className="w-3.5 h-3.5 text-orange-400" />
                      <span>{appName}.mjs</span>
                      <span className="text-gray-600">|</span>
                      <span>{generateMutation.data?.stats?.linesEstimate} lines</span>
                      <span className="text-gray-600">|</span>
                      <span>{generateMutation.data?.stats?.totalSections} sections</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={handleCopyCode} className="p-1 rounded hover:bg-lattice-elevated text-gray-400" title="Copy">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={handleDownload} className="p-1 rounded hover:bg-lattice-elevated text-orange-400" title="Download">
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto">
                    <pre className="p-4 font-mono text-xs text-gray-300 leading-5 whitespace-pre">
                      {previewSection && sectionOffsets.has(previewSection)
                        ? getCodeSection(generatedCode, sectionOffsets.get(previewSection)!)
                        : generatedCode
                      }
                    </pre>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-500">
                  <Hammer className="w-16 h-16 mb-4 opacity-20" />
                  <p className="text-sm">Configure your app and click &quot;Generate App&quot;</p>
                  <p className="text-xs mt-1 text-gray-600">One file. One process. Everything alive.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Extract a section of code from the full generated output */
function getCodeSection(code: string, startLine: number): string {
  const lines = code.split('\n');
  // Find next section start after this one
  let endLine = lines.length;
  for (let i = startLine + 1; i < lines.length; i++) {
    if (lines[i].match(/^\/\/ ═{50,}/) && i > startLine + 2) {
      endLine = i - 1;
      break;
    }
  }
  return lines.slice(startLine, endLine).join('\n');
}

export default ForgeWorkbench;
