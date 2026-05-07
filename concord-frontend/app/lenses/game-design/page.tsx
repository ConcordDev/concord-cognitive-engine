'use client';

import { useState, useCallback, useMemo } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Gamepad2, Plus, Trash2, X, Save,
  BookOpen, Users, Map,
  BarChart3, Search, Loader2,
  FileText, Settings, Zap, TrendingUp, DollarSign, GitBranch,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/store/ui';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

type DesignTab = 'projects' | 'gdd' | 'mechanics' | 'narrative' | 'levels' | 'balance';
type GameGenre = 'rpg' | 'platformer' | 'puzzle' | 'strategy' | 'simulation' | 'adventure' | 'action' | 'sandbox' | 'other';

interface GameDesignProject {
  id: string;
  title: string;
  genre: GameGenre;
  description: string;
  status: 'concept' | 'pre-production' | 'production' | 'testing' | 'released';
  mechanics: string[];
  targetPlatform: string;
  createdAt: string;
}

interface GameMechanic {
  id: string;
  name: string;
  description: string;
  category: string;
  complexity: 'low' | 'medium' | 'high';
  dependencies: string[];
}

const GAME_GENRES: { id: GameGenre; label: string }[] = [
  { id: 'rpg', label: 'RPG' },
  { id: 'platformer', label: 'Platformer' },
  { id: 'puzzle', label: 'Puzzle' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'simulation', label: 'Simulation' },
  { id: 'adventure', label: 'Adventure' },
  { id: 'action', label: 'Action' },
  { id: 'sandbox', label: 'Sandbox' },
  { id: 'other', label: 'Other' },
];

const MECHANIC_CATEGORIES = ['Core Loop', 'Combat', 'Progression', 'Economy', 'Social', 'Exploration', 'Crafting', 'Narrative', 'UI/UX'];

export default function GameDesignPage() {
  useLensNav('game-design');
  const { latestData: realtimeData, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('game-design');
  const { contextDTUs } = useLensDTUs({ lens: 'game-design' });

  const { items: projectItems, isLoading, isError, error, refetch, create: createProject, update: updateProject, remove: removeProject } = useLensData<GameDesignProject>('game-design', 'project', { seed: [] });
  const projects = useMemo(() => projectItems.map(i => ({ ...(i.data as unknown as GameDesignProject), id: i.id, title: i.title })), [projectItems]);

  const { items: mechanicItems, create: createMechanic, remove: removeMechanic } = useLensData<GameMechanic>('game-design', 'mechanic', { seed: [] });
  const mechanics = useMemo(() => mechanicItems.map(i => ({ ...(i.data as unknown as GameMechanic), id: i.id, name: i.title })), [mechanicItems]);

  // Pull gamification stats from game API
  const { data: gameProfile } = useQuery({
    queryKey: ['game', 'profile'],
    queryFn: () => api.get('/api/game/profile').then(r => r.data?.profile),
  });

  const [tab, setTab] = useState<DesignTab>('projects');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFeatures, setShowFeatures] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedProject, setSelectedProject] = useState<GameDesignProject | null>(null);

  // Form state
  const [newTitle, setNewTitle] = useState('');
  const [newGenre, setNewGenre] = useState<GameGenre>('rpg');
  const [newDesc, setNewDesc] = useState('');
  const [newPlatform, setNewPlatform] = useState('PC');

  // GDD editor state
  const [gddContent, setGddContent] = useState('');

  // Mechanic form
  const [showMechanicForm, setShowMechanicForm] = useState(false);
  const [mechName, setMechName] = useState('');
  const [mechDesc, setMechDesc] = useState('');
  const [mechCategory, setMechCategory] = useState('Core Loop');
  const [mechComplexity, setMechComplexity] = useState<'low' | 'medium' | 'high'>('medium');

  // Narrative state
  const [characters, setCharacters] = useState<{ name: string; role: string; description: string }[]>([]);
  const [storyBeats, setStoryBeats] = useState<string[]>([]);
  const [showCharForm, setShowCharForm] = useState(false);
  const [charName, setCharName] = useState('');
  const [charRole, setCharRole] = useState('');
  const [charDesc, setCharDesc] = useState('');
  const [newBeat, setNewBeat] = useState('');

  // Levels state
  const [levels, setLevels] = useState<{ name: string; difficulty: string; description: string }[]>([]);
  const [showLevelForm, setShowLevelForm] = useState(false);
  const [levelName, setLevelName] = useState('');
  const [levelDifficulty, setLevelDifficulty] = useState('easy');
  const [levelDesc, setLevelDesc] = useState('');

  // Backend action wiring
  const runDesignAction = useRunArtifact('game-design');
  const [designActionResult, setDesignActionResult] = useState<Record<string, unknown> | null>(null);
  const [designRunning, setDesignRunning] = useState<string | null>(null);

  const handleDesignAction = useCallback(async (action: string) => {
    const targetId = projectItems[0]?.id;
    if (!targetId) return;
    setDesignRunning(action);
    try {
      const res = await runDesignAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setDesignActionResult({ _action: action, message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setDesignActionResult({ _action: action, ...(res.result as Record<string, unknown>) }); }
    } catch (e) { console.error(`Design action ${action} failed:`, e); setDesignActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setDesignRunning(null);
  }, [projectItems, runDesignAction]);

  const handleCreate = useCallback(async () => {
    if (!newTitle.trim()) return;
    const data: Partial<GameDesignProject> = {
      title: newTitle,
      genre: newGenre,
      description: newDesc,
      status: 'concept',
      mechanics: [],
      targetPlatform: newPlatform,
      createdAt: new Date().toISOString(),
    };
    await createProject({ title: newTitle, data: data as unknown as Record<string, unknown> });
    setShowCreateModal(false);
    setNewTitle('');
    setNewDesc('');
    refetch();
  }, [newTitle, newGenre, newDesc, newPlatform, createProject, refetch]);

  const handleAddCharacter = useCallback(() => {
    if (!charName.trim()) return;
    setCharacters(prev => [...prev, { name: charName, role: charRole, description: charDesc }]);
    setCharName('');
    setCharRole('');
    setCharDesc('');
    setShowCharForm(false);
  }, [charName, charRole, charDesc]);

  const handleAddBeat = useCallback(() => {
    if (!newBeat.trim()) return;
    setStoryBeats(prev => [...prev, newBeat]);
    setNewBeat('');
  }, [newBeat]);

  const handleAddLevel = useCallback(() => {
    if (!levelName.trim()) return;
    setLevels(prev => [...prev, { name: levelName, difficulty: levelDifficulty, description: levelDesc }]);
    setLevelName('');
    setLevelDifficulty('easy');
    setLevelDesc('');
    setShowLevelForm(false);
  }, [levelName, levelDifficulty, levelDesc]);

  const handleAddMechanic = useCallback(async () => {
    if (!mechName.trim()) return;
    await createMechanic({
      title: mechName,
      data: { name: mechName, description: mechDesc, category: mechCategory, complexity: mechComplexity, dependencies: [] } as unknown as Record<string, unknown>,
    });
    setShowMechanicForm(false);
    setMechName('');
    setMechDesc('');
  }, [mechName, mechDesc, mechCategory, mechComplexity, createMechanic]);

  const TABS: { id: DesignTab; label: string; icon: typeof Gamepad2 }[] = [
    { id: 'projects', label: 'Projects', icon: Gamepad2 },
    { id: 'gdd', label: 'GDD', icon: FileText },
    { id: 'mechanics', label: 'Mechanics', icon: Settings },
    { id: 'narrative', label: 'Narrative', icon: BookOpen },
    { id: 'levels', label: 'Levels', icon: Map },
    { id: 'balance', label: 'Balance', icon: BarChart3 },
  ];

  return (
    <div data-lens-theme="game-design" className="min-h-screen">
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/30 to-teal-500/30 border border-emerald-500/20 flex items-center justify-center">
              <Gamepad2 className="w-6 h-6 text-emerald-400" />
            </div>
            <h1 className="text-2xl font-bold">Game Design</h1>
            {isLoading && <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />}
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
          </div>
          <div className="flex items-center gap-2">
            <DTUExportButton domain="game-design" data={{}} compact />
            <button onClick={() => setShowFeatures(!showFeatures)} className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg hover:bg-white/10">Features</button>
            <button onClick={() => setShowCreateModal(true)} className="px-3 py-1.5 text-xs bg-emerald-500/20 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/30 flex items-center gap-1">
              <Plus className="w-3 h-3" /> New Project
            </button>
          </div>
        </div>

        {showFeatures && <LensFeaturePanel lensId="game-design" />}
        <RealtimeDataPanel data={realtimeData} insights={realtimeInsights} />
      <UniversalActions domain="game-design" artifactId={null} compact />

        {/* Game Design Analysis Actions */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Zap className="w-4 h-4 text-emerald-400" />
            Design Analysis
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { action: 'mechanicsAnalysis',  label: 'Mechanics Analysis', icon: Gamepad2,   color: 'text-emerald-400' },
              { action: 'playerFlow',         label: 'Player Flow',        icon: TrendingUp, color: 'text-neon-cyan' },
              { action: 'narrativeBranch',    label: 'Narrative Branch',   icon: GitBranch,  color: 'text-neon-purple' },
              { action: 'monetizationModel',  label: 'Monetization',       icon: DollarSign, color: 'text-neon-green' },
            ].map(({ action, label, icon: Icon, color }) => (
              <button
                key={action}
                onClick={() => handleDesignAction(action)}
                disabled={!!designRunning || !projectItems[0]?.id}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/20 border border-white/10 text-sm hover:border-emerald-500/30 disabled:opacity-40 transition-colors"
              >
                {designRunning === action ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className={`w-4 h-4 ${color}`} />}
                <span className="truncate text-xs">{label}</span>
              </button>
            ))}
          </div>

          {designActionResult && (
            <div className="mt-3 rounded-lg bg-black/30 border border-white/10 p-4 relative">
              <button onClick={() => setDesignActionResult(null)} className="absolute top-3 right-3 text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>

              {/* mechanicsAnalysis */}
              {designActionResult._action === 'mechanicsAnalysis' && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Mechanics Analysis</p>
                  {(designActionResult.message as string) ? <p className="text-sm text-gray-400">{designActionResult.message as string}</p> : (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                          { label: 'Mechanics', value: String(designActionResult.totalMechanics ?? 0), color: 'text-white' },
                          { label: 'Depth Score', value: String(designActionResult.depthScore ?? 0), color: 'text-emerald-400' },
                          { label: 'Loop Count', value: String(designActionResult.loopCount ?? 0), color: 'text-neon-cyan' },
                          { label: 'Emergent', value: String(designActionResult.emergentPotential ?? '—'), color: (designActionResult.emergentPotential as string) === 'high' ? 'text-neon-green' : 'text-yellow-400' },
                        ].map(({ label, value, color }) => (
                          <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                            <p className={`text-sm font-bold ${color} capitalize`}>{value}</p>
                            <p className="text-xs text-gray-400">{label}</p>
                          </div>
                        ))}
                      </div>
                      {Array.isArray(designActionResult.categories) && (
                        <div className="flex flex-wrap gap-2">
                          {(designActionResult.categories as {category:string;count:number}[]).filter(c => c.count > 0).map(c => (
                            <span key={c.category} className="text-xs px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 capitalize">{c.category}: {c.count}</span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* playerFlow */}
              {designActionResult._action === 'playerFlow' && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Player Flow Analysis</p>
                  {(designActionResult.message as string) ? <p className="text-sm text-gray-400">{designActionResult.message as string}</p> : (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                          { label: 'States', value: String(designActionResult.totalStates ?? 0), color: 'text-white' },
                          { label: 'In Flow', value: String(designActionResult.inFlowZone ?? 0), color: 'text-neon-green' },
                          { label: 'Flow %', value: `${designActionResult.flowPercent ?? 0}%`, color: 'text-neon-cyan' },
                          { label: 'Duration', value: `${designActionResult.totalDuration ?? 0}min`, color: 'text-gray-300' },
                        ].map(({ label, value, color }) => (
                          <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                            <p className={`text-lg font-bold ${color}`}>{value}</p>
                            <p className="text-xs text-gray-400">{label}</p>
                          </div>
                        ))}
                      </div>
                      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${(designActionResult.flowPercent as number) > 60 ? 'bg-neon-green' : 'bg-yellow-400'}`} style={{ width: `${designActionResult.flowPercent as number}%` }} />
                      </div>
                      <p className="text-xs text-gray-400">Pacing: <span className="text-white capitalize">{(designActionResult.pacing as string)?.replace(/-/g, ' ')}</span></p>
                    </>
                  )}
                </div>
              )}

              {/* narrativeBranch */}
              {designActionResult._action === 'narrativeBranch' && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Narrative Branching</p>
                  {(designActionResult.message as string) ? <p className="text-sm text-gray-400">{designActionResult.message as string}</p> : (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: 'Nodes', value: String(designActionResult.totalNodes ?? 0), color: 'text-white' },
                        { label: 'Choices', value: String(designActionResult.totalChoices ?? 0), color: 'text-neon-purple' },
                        { label: 'Endings', value: String(designActionResult.endings ?? 0), color: 'text-neon-cyan' },
                        { label: 'Replay Value', value: String(designActionResult.replayValue ?? '—'), color: (designActionResult.replayValue as string) === 'high' ? 'text-neon-green' : (designActionResult.replayValue as string) === 'moderate' ? 'text-yellow-400' : 'text-gray-400' },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                          <p className={`text-sm font-bold ${color} capitalize`}>{value}</p>
                          <p className="text-xs text-gray-400">{label}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* monetizationModel */}
              {designActionResult._action === 'monetizationModel' && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Monetization Model</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {[
                      { label: 'Model', value: String(designActionResult.model ?? '—'), color: 'text-neon-purple' },
                      { label: 'Revenue Type', value: String(designActionResult.revenue ?? '—'), color: 'text-white' },
                      { label: 'Monthly Revenue', value: `$${(designActionResult.projectedMonthlyRevenue as number || 0).toLocaleString()}`, color: 'text-neon-green' },
                      { label: 'Annual Revenue', value: `$${(designActionResult.projectedAnnualRevenue as number || 0).toLocaleString()}`, color: 'text-emerald-400' },
                      { label: 'Avg LTV', value: `$${designActionResult.avgLTV ?? 0}`, color: 'text-neon-cyan' },
                      { label: 'Conversion', value: String(designActionResult.conversionRate ?? '—'), color: 'text-yellow-400' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                        <p className={`text-sm font-bold ${color} capitalize`}>{value}</p>
                        <p className="text-xs text-gray-400">{label}</p>
                      </div>
                    ))}
                  </div>
                  {Array.isArray(designActionResult.ethicalConsiderations) && (
                    <div className="space-y-1">
                      <p className="text-xs text-gray-500">Ethical Considerations</p>
                      {(designActionResult.ethicalConsiderations as string[]).map((e, i) => (
                        <p key={i} className="text-xs text-gray-400 bg-white/5 rounded px-3 py-1">{e}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search projects, mechanics..." className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-emerald-500/50" />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-white/5 p-1 rounded-lg border border-white/10">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors', tab === t.id ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-400 hover:text-white hover:bg-white/5')}>
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </div>

        {isError && <ErrorState error={error?.message} onRetry={refetch} />}

        {/* Projects */}
        {tab === 'projects' && (
          <div className="space-y-4">
            {projects.length === 0 ? (
              <div className="text-center py-16 text-gray-500">
                <Gamepad2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No game projects yet.</p>
                <button onClick={() => setShowCreateModal(true)} className="mt-3 px-4 py-2 text-xs bg-emerald-500/20 rounded-lg hover:bg-emerald-500/30">Create Project</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {projects.map(proj => (
                  <motion.div key={proj.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-white/5 border border-white/10 rounded-lg p-4 hover:border-emerald-500/30 transition-colors cursor-pointer" onClick={() => { setSelectedProject(proj); setTab('gdd'); }}>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h3 className="font-medium text-sm">{proj.title}</h3>
                        <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                          <span className="px-1.5 py-0.5 bg-emerald-500/10 rounded text-emerald-400">{proj.genre}</span>
                          <span>{proj.targetPlatform || 'PC'}</span>
                          <span className={cn('px-1.5 py-0.5 rounded', proj.status === 'released' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400')}>{proj.status || 'concept'}</span>
                        </div>
                      </div>
                      <button onClick={e => { e.stopPropagation(); removeProject(proj.id).then(() => refetch()).catch((err) => { console.error('[GameDesign] Failed to delete project:', err); useUIStore.getState().addToast({ type: 'error', message: 'Failed to delete project' }); }); }} className="p-1 hover:bg-white/10 rounded text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                    {proj.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{proj.description}</p>}
                    {/* Dev phase progress */}
                    <div className="mt-3 flex items-center gap-1.5">
                      {(['concept', 'pre-production', 'production', 'testing', 'released'] as const).map((phase, idx) => {
                        const phaseOrder = ['concept', 'pre-production', 'production', 'testing', 'released'];
                        const currentIdx = phaseOrder.indexOf(proj.status || 'concept');
                        const isPast = idx < currentIdx;
                        const isCurrent = idx === currentIdx;
                        return (
                          <div key={phase} className="flex items-center gap-1.5">
                            <div className={cn(
                              'w-2 h-2 rounded-full transition-colors',
                              isCurrent ? 'bg-emerald-400 ring-2 ring-emerald-400/30' : isPast ? 'bg-emerald-600' : 'bg-white/15'
                            )} title={phase} />
                            {idx < 4 && <div className={cn('h-px w-3', isPast ? 'bg-emerald-600' : 'bg-white/10')} />}
                          </div>
                        );
                      })}
                      <span className="ml-1 text-[10px] text-gray-500">{proj.status || 'concept'}</span>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* GDD */}
        {tab === 'gdd' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <FileText className="w-5 h-5 text-emerald-400" />
                Game Design Document {selectedProject ? `- ${selectedProject.title}` : ''}
              </h2>
              <button onClick={() => {
                if (selectedProject) {
                  updateProject(selectedProject.id, { data: { gddContent } as unknown as Partial<GameDesignProject> }).catch((err) => { console.error('[GameDesign] Failed to save GDD:', err); useUIStore.getState().addToast({ type: 'error', message: 'Failed to save game design document' }); });
                }
              }} className="px-3 py-1.5 text-xs bg-emerald-500/20 rounded-lg hover:bg-emerald-500/30 flex items-center gap-1">
                <Save className="w-3 h-3" /> Save
              </button>
            </div>
            <textarea
              value={gddContent}
              onChange={e => setGddContent(e.target.value)}
              placeholder="# Game Design Document&#10;&#10;## Overview&#10;Describe your game concept...&#10;&#10;## Core Mechanics&#10;&#10;## Target Audience&#10;&#10;## Art Style&#10;&#10;## Technical Requirements"
              className="w-full h-[55vh] px-6 py-4 bg-white/5 border border-white/10 rounded-lg text-sm leading-relaxed focus:outline-none focus:border-emerald-500/30 resize-none font-mono"
            />
          </div>
        )}

        {/* Mechanics */}
        {tab === 'mechanics' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2"><Settings className="w-5 h-5 text-emerald-400" /> Game Mechanics</h2>
              <button onClick={() => setShowMechanicForm(!showMechanicForm)} className="px-3 py-1.5 text-xs bg-emerald-500/20 rounded-lg hover:bg-emerald-500/30 flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add Mechanic
              </button>
            </div>
            {showMechanicForm && (
              <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
                <input value={mechName} onChange={e => setMechName(e.target.value)} placeholder="Mechanic name" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
                <textarea value={mechDesc} onChange={e => setMechDesc(e.target.value)} placeholder="Description" rows={2} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm resize-none" />
                <div className="flex gap-2">
                  <select value={mechCategory} onChange={e => setMechCategory(e.target.value)} className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm">
                    {MECHANIC_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select value={mechComplexity} onChange={e => setMechComplexity(e.target.value as 'low' | 'medium' | 'high')} className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm">
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <button onClick={handleAddMechanic} disabled={!mechName.trim()} className="px-4 py-2 bg-emerald-500/20 rounded-lg text-sm hover:bg-emerald-500/30 disabled:opacity-50">Add</button>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {mechanics.map(mech => (
                <div key={mech.id} className="bg-white/5 border border-white/10 rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <h3 className="font-medium text-sm">{mech.name}</h3>
                    <div className="flex items-center gap-2">
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded', mech.complexity === 'high' ? 'bg-red-500/20 text-red-400' : mech.complexity === 'medium' ? 'bg-amber-500/20 text-amber-400' : 'bg-green-500/20 text-green-400')}>{mech.complexity}</span>
                      <button onClick={() => removeMechanic(mech.id).catch((err) => { console.error('[GameDesign] Failed to delete mechanic:', err); useUIStore.getState().addToast({ type: 'error', message: 'Failed to delete mechanic' }); })} className="p-0.5 hover:text-red-400 text-gray-600 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{mech.category}</div>
                  {mech.description && <p className="text-xs text-gray-600 mt-1">{mech.description}</p>}
                </div>
              ))}
              {mechanics.length === 0 && <div className="col-span-full text-center py-8 text-gray-500 text-sm">No mechanics defined yet.</div>}
            </div>
          </div>
        )}

        {/* Narrative */}
        {tab === 'narrative' && (
          <div className="space-y-6">
            {/* Characters section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Users className="w-5 h-5 text-emerald-400" /> Characters
                </h2>
                <button onClick={() => setShowCharForm(!showCharForm)} className="px-3 py-1.5 text-xs bg-emerald-500/20 rounded-lg hover:bg-emerald-500/30 flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Add Character
                </button>
              </div>
              <AnimatePresence>
                {showCharForm && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
                      <div className="flex gap-2">
                        <input value={charName} onChange={e => setCharName(e.target.value)} placeholder="Character name" className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-emerald-500/30" />
                        <input value={charRole} onChange={e => setCharRole(e.target.value)} placeholder="Role (e.g. Protagonist)" className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-emerald-500/30" />
                      </div>
                      <textarea value={charDesc} onChange={e => setCharDesc(e.target.value)} placeholder="Character description, backstory, motivations..." rows={2} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm resize-none focus:outline-none focus:border-emerald-500/30" />
                      <div className="flex gap-2">
                        <button onClick={handleAddCharacter} disabled={!charName.trim()} className="px-4 py-2 bg-emerald-500/20 rounded-lg text-sm hover:bg-emerald-500/30 disabled:opacity-50">Add</button>
                        <button onClick={() => setShowCharForm(false)} className="px-4 py-2 bg-white/5 rounded-lg text-sm hover:bg-white/10">Cancel</button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              {characters.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {characters.map((char, idx) => (
                    <motion.div key={idx} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-white/5 border border-white/10 rounded-lg p-4 hover:border-emerald-500/20 transition-colors">
                      <div className="flex items-start justify-between mb-1">
                        <h3 className="font-medium text-sm">{char.name}</h3>
                        <div className="flex items-center gap-1.5">
                          {char.role && <span className="px-1.5 py-0.5 text-[10px] bg-emerald-500/10 text-emerald-400 rounded-full border border-emerald-500/20">{char.role}</span>}
                          <button onClick={() => setCharacters(prev => prev.filter((_, i) => i !== idx))} className="p-0.5 hover:text-red-400 text-gray-600 transition-colors"><X className="w-3 h-3" /></button>
                        </div>
                      </div>
                      {char.description && <p className="text-xs text-gray-500 mt-1 line-clamp-3">{char.description}</p>}
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-600 text-xs">No characters yet. Add your first character above.</div>
              )}
            </div>

            {/* Story beats section */}
            <div className="space-y-3">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-emerald-400" /> Story Beats
              </h2>
              <div className="flex gap-2">
                <input
                  value={newBeat}
                  onChange={e => setNewBeat(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddBeat()}
                  placeholder="Describe a story beat and press Enter..."
                  className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-emerald-500/30"
                />
                <button onClick={handleAddBeat} disabled={!newBeat.trim()} className="px-3 py-2 bg-emerald-500/20 rounded-lg text-sm hover:bg-emerald-500/30 disabled:opacity-50 flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Add Beat
                </button>
              </div>
              {storyBeats.length > 0 ? (
                <div className="space-y-2">
                  {storyBeats.map((beat, idx) => (
                    <motion.div key={idx} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="flex items-start gap-3 bg-white/5 border border-white/10 rounded-lg px-4 py-3 group hover:border-emerald-500/20 transition-colors">
                      <span className="text-xs text-emerald-400 font-mono mt-0.5 shrink-0">{String(idx + 1).padStart(2, '0')}</span>
                      <p className="text-sm text-gray-300 flex-1">{beat}</p>
                      <button onClick={() => setStoryBeats(prev => prev.filter((_, i) => i !== idx))} className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 text-gray-600 transition-all shrink-0"><X className="w-3 h-3" /></button>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-600 text-xs">No story beats yet. Add key plot moments above.</div>
              )}
            </div>
            <div className="text-xs text-gray-600">Design DTUs: {contextDTUs.length}</div>
          </div>
        )}

        {/* Levels */}
        {tab === 'levels' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Map className="w-5 h-5 text-emerald-400" /> Level Design
              </h2>
              <button onClick={() => setShowLevelForm(!showLevelForm)} className="px-3 py-1.5 text-xs bg-emerald-500/20 rounded-lg hover:bg-emerald-500/30 flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add Level
              </button>
            </div>
            <AnimatePresence>
              {showLevelForm && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
                    <div className="flex gap-2">
                      <input value={levelName} onChange={e => setLevelName(e.target.value)} placeholder="Level name" className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-emerald-500/30" />
                      <select value={levelDifficulty} onChange={e => setLevelDifficulty(e.target.value)} className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-emerald-500/30">
                        <option value="easy">Easy</option>
                        <option value="medium">Medium</option>
                        <option value="hard">Hard</option>
                        <option value="boss">Boss</option>
                      </select>
                    </div>
                    <textarea value={levelDesc} onChange={e => setLevelDesc(e.target.value)} placeholder="Level description, objectives, layout notes..." rows={2} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm resize-none focus:outline-none focus:border-emerald-500/30" />
                    <div className="flex gap-2">
                      <button onClick={handleAddLevel} disabled={!levelName.trim()} className="px-4 py-2 bg-emerald-500/20 rounded-lg text-sm hover:bg-emerald-500/30 disabled:opacity-50">Add Level</button>
                      <button onClick={() => setShowLevelForm(false)} className="px-4 py-2 bg-white/5 rounded-lg text-sm hover:bg-white/10">Cancel</button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {levels.length > 0 ? (
              <div className="space-y-2">
                {levels.map((lvl, idx) => {
                  const difficultyStyles: Record<string, string> = {
                    easy: 'bg-green-500/10 text-green-400 border-green-500/20',
                    medium: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
                    hard: 'bg-red-500/10 text-red-400 border-red-500/20',
                    boss: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
                  };
                  const difficultyStyle = difficultyStyles[lvl.difficulty] ?? 'bg-gray-500/10 text-gray-400 border-gray-500/20';
                  return (
                    <motion.div key={idx} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-4 bg-white/5 border border-white/10 rounded-lg px-4 py-3 group hover:border-emerald-500/20 transition-colors">
                      <span className="text-sm font-mono text-emerald-400 shrink-0 mt-0.5">{String(idx + 1).padStart(2, '0')}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-medium text-sm">{lvl.name}</span>
                          <span className={cn('px-1.5 py-0.5 text-[10px] rounded border', difficultyStyle)}>{lvl.difficulty}</span>
                        </div>
                        {lvl.description && <p className="text-xs text-gray-500 line-clamp-2">{lvl.description}</p>}
                      </div>
                      <button onClick={() => setLevels(prev => prev.filter((_, i) => i !== idx))} className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 text-gray-600 transition-all shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 text-gray-600">
                <Map className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm">No levels yet. Add your first level above.</p>
                <p className="text-xs mt-1 text-gray-700">Plan levels, zones, and encounters. Use the whiteboard lens for spatial layouts.</p>
              </div>
            )}
          </div>
        )}

        {/* Balance */}
        {tab === 'balance' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2"><BarChart3 className="w-5 h-5 text-emerald-400" /> Balance Sheet</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                <div className="text-xs text-gray-500 mb-1">Projects</div>
                <div className="text-2xl font-bold">{projects.length}</div>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                <div className="text-xs text-gray-500 mb-1">Mechanics Defined</div>
                <div className="text-2xl font-bold">{mechanics.length}</div>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                <div className="text-xs text-gray-500 mb-1">Designer Level</div>
                <div className="text-2xl font-bold text-emerald-400">{gameProfile?.level || 1}</div>
              </div>
            </div>
          </div>
        )}

        {/* Create modal */}
        <AnimatePresence>
          {showCreateModal && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreateModal(false)}>
              <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="bg-gray-900 border border-white/10 rounded-lg p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold">New Game Project</h3>
                  <button onClick={() => setShowCreateModal(false)}><X className="w-4 h-4" /></button>
                </div>
                <div className="space-y-3">
                  <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Game title" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
                  <select value={newGenre} onChange={e => setNewGenre(e.target.value as GameGenre)} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm">
                    {GAME_GENRES.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
                  </select>
                  <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Game concept description" rows={3} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm resize-none" />
                  <input value={newPlatform} onChange={e => setNewPlatform(e.target.value)} placeholder="Target platform" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
                  <button onClick={handleCreate} disabled={!newTitle.trim()} className="w-full py-2 bg-emerald-500/20 rounded-lg text-sm hover:bg-emerald-500/30 disabled:opacity-50">Create</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
