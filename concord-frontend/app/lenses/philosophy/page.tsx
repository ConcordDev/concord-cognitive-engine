'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  BookOpen, Plus, Search, X, Edit3, Trash2,
  Eye, Layers, ChevronDown, Scale, Lightbulb,
  MessageSquare, Hash, Sparkles, Target, Brain,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ModeTab = 'Arguments' | 'Concepts' | 'Thinkers' | 'Traditions' | 'Dialogues' | 'Dashboard';
type ArtifactType = 'Argument' | 'Concept' | 'Thinker' | 'Tradition' | 'Dialogue';
type Branch = 'ethics' | 'epistemology' | 'metaphysics' | 'logic' | 'aesthetics' | 'political' | 'philosophy_of_mind' | 'philosophy_of_science' | 'other';

interface PhilosophyArtifact {
  artifactType: ArtifactType;
  branch: Branch;
  description: string;
  era?: string;
  tradition?: string;
  keyWorks?: string[];
  relatedConcepts?: string[];
  premises?: string[];
  conclusion?: string;
  objections?: string[];
  proponents?: string[];
  opponents?: string[];
  status?: 'active' | 'refuted' | 'debated' | 'historical';
}

/* ------------------------------------------------------------------ */
/*  Tab Config                                                         */
/* ------------------------------------------------------------------ */

const MODE_TABS: { id: ModeTab; label: string; icon: typeof BookOpen; type: ArtifactType }[] = [
  { id: 'Arguments', label: 'Arguments', icon: Scale, type: 'Argument' },
  { id: 'Concepts', label: 'Concepts', icon: Lightbulb, type: 'Concept' },
  { id: 'Thinkers', label: 'Thinkers', icon: MessageSquare, type: 'Thinker' },
  { id: 'Traditions', label: 'Traditions', icon: BookOpen, type: 'Tradition' },
  { id: 'Dialogues', label: 'Dialogues', icon: Sparkles, type: 'Dialogue' },
  { id: 'Dashboard', label: 'Dashboard', icon: Target, type: 'Argument' },
];

const BRANCH_COLORS: Record<Branch, string> = {
  ethics: 'text-green-400',
  epistemology: 'text-blue-400',
  metaphysics: 'text-purple-400',
  logic: 'text-cyan-400',
  aesthetics: 'text-pink-400',
  political: 'text-yellow-400',
  philosophy_of_mind: 'text-orange-400',
  philosophy_of_science: 'text-teal-400',
  other: 'text-gray-400',
};

/* ------------------------------------------------------------------ */
/*  Page Component                                                     */
/* ------------------------------------------------------------------ */

export default function PhilosophyLensPage() {
  useLensNav('philosophy');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('philosophy');

  const [activeTab, setActiveTab] = useState<ModeTab>('Arguments');
  const [searchQuery, setSearchQuery] = useState('');
  const [branchFilter, setBranchFilter] = useState<Branch | ''>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showFeatures, setShowFeatures] = useState(false);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formBranch, setFormBranch] = useState<Branch>('ethics');
  const [formDescription, setFormDescription] = useState('');
  const [formPremises, setFormPremises] = useState('');
  const [formConclusion, setFormConclusion] = useState('');

  const currentType = MODE_TABS.find(t => t.id === activeTab)?.type || 'Argument';

  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<PhilosophyArtifact>('philosophy', currentType, {
    seed: [],
  });

  // All items for dashboard counts
  const { items: arguments_ } = useLensData<PhilosophyArtifact>('philosophy', 'Argument', { seed: [] });
  const { items: concepts } = useLensData<PhilosophyArtifact>('philosophy', 'Concept', { seed: [] });
  const { items: thinkers } = useLensData<PhilosophyArtifact>('philosophy', 'Thinker', { seed: [] });
  const { items: traditions } = useLensData<PhilosophyArtifact>('philosophy', 'Tradition', { seed: [] });
  const { items: dialogues } = useLensData<PhilosophyArtifact>('philosophy', 'Dialogue', { seed: [] });

  const runArtifact = useRunArtifact('philosophy');

  // Filtering
  const filtered = useMemo(() => {
    let list = [...items];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(i => i.title.toLowerCase().includes(q) || i.data.description?.toLowerCase().includes(q));
    }
    if (branchFilter) {
      list = list.filter(i => i.data.branch === branchFilter);
    }
    return list;
  }, [items, searchQuery, branchFilter]);

  const selected = useMemo(() => items.find(i => i.id === selectedId), [items, selectedId]);

  const handleCreate = () => {
    if (!formTitle.trim()) return;
    create({
      title: formTitle,
      data: {
        artifactType: currentType,
        branch: formBranch,
        description: formDescription,
        premises: formPremises ? formPremises.split('\n').filter(Boolean) : [],
        conclusion: formConclusion,
      },
    });
    setFormTitle('');
    setFormDescription('');
    setFormPremises('');
    setFormConclusion('');
    setShowCreate(false);
  };

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={(error as Error)?.message} onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div data-lens-theme="philosophy" className="p-6 space-y-6">
      <header className="flex items-center gap-3">
        <BookOpen className="w-6 h-6 text-neon-purple" />
        <div>
          <h1 className="text-xl font-bold">Philosophy</h1>
          <p className="text-sm text-gray-400">
            Arguments, concepts, thinkers, and philosophical traditions
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap ml-auto">
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="philosophy" data={realtimeData || {}} compact />
          {realtimeAlerts.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
              {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <UniversalActions domain="philosophy" artifactId={selectedId} compact />
      </header>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {MODE_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setSelectedId(null); }}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors',
              activeTab === tab.id
                ? 'bg-neon-purple/20 text-neon-purple'
                : 'text-gray-400 hover:text-white hover:bg-lattice-surface/50'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Scale, label: 'Arguments', value: arguments_.length, color: 'text-neon-purple' },
          { icon: Lightbulb, label: 'Concepts', value: concepts.length, color: 'text-neon-cyan' },
          { icon: Brain, label: 'Thinkers', value: thinkers.length, color: 'text-blue-400' },
          { icon: BookOpen, label: 'Traditions', value: traditions.length, color: 'text-green-400' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="lens-card"
          >
            <stat.icon className={cn('w-5 h-5 mb-2', stat.color)} />
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-sm text-gray-400">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Thought Experiment Cards */}
      {activeTab === 'Arguments' && arguments_.filter(a => a.data.premises && a.data.premises.length > 0).length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Brain className="w-4 h-4 text-neon-purple" /> Thought Experiments & Arguments
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {arguments_.filter(a => a.data.premises && a.data.premises.length > 0).slice(0, 4).map((arg, idx) => (
              <motion.div
                key={arg.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.1 }}
                onClick={() => { setSelectedId(arg.id); setActiveTab('Arguments'); }}
                className="panel p-4 cursor-pointer hover:border-neon-purple/30 transition-colors space-y-2"
              >
                <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Lightbulb className="w-3.5 h-3.5 text-yellow-400" />
                  {arg.title}
                </h4>
                <div className="space-y-1">
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Premises</p>
                  {arg.data.premises!.slice(0, 3).map((p, i) => (
                    <p key={i} className="text-xs text-gray-400 pl-2 border-l-2 border-neon-purple/30">{p}</p>
                  ))}
                </div>
                {arg.data.conclusion && (
                  <div className="pt-1.5 border-t border-lattice-border">
                    <p className="text-xs text-neon-purple font-medium">Conclusion: {arg.data.conclusion}</p>
                  </div>
                )}
                <span className={cn('text-xs px-1.5 py-0.5 rounded inline-block', BRANCH_COLORS[arg.data.branch])}>
                  {arg.data.branch?.replace(/_/g, ' ')}
                </span>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Dashboard Tab */}
      {activeTab === 'Dashboard' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="lens-card">
            <Scale className="w-5 h-5 text-neon-purple mb-2" />
            <p className="text-2xl font-bold">{arguments_.length}</p>
            <p className="text-sm text-gray-400">Arguments</p>
          </div>
          <div className="lens-card">
            <Lightbulb className="w-5 h-5 text-neon-cyan mb-2" />
            <p className="text-2xl font-bold">{concepts.length}</p>
            <p className="text-sm text-gray-400">Concepts</p>
          </div>
          <div className="lens-card">
            <MessageSquare className="w-5 h-5 text-blue-400 mb-2" />
            <p className="text-2xl font-bold">{thinkers.length}</p>
            <p className="text-sm text-gray-400">Thinkers</p>
          </div>
          <div className="lens-card">
            <BookOpen className="w-5 h-5 text-green-400 mb-2" />
            <p className="text-2xl font-bold">{traditions.length}</p>
            <p className="text-sm text-gray-400">Traditions</p>
          </div>
          <div className="lens-card">
            <Sparkles className="w-5 h-5 text-pink-400 mb-2" />
            <p className="text-2xl font-bold">{dialogues.length}</p>
            <p className="text-sm text-gray-400">Dialogues</p>
          </div>
        </motion.div>
      )}

      {activeTab !== 'Dashboard' && (
        <>
          {/* Toolbar */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="w-full pl-10 pr-4 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-neon-purple"
              />
            </div>
            <select
              value={branchFilter}
              onChange={e => setBranchFilter(e.target.value as Branch | '')}
              className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-white"
            >
              <option value="">All Branches</option>
              <option value="ethics">Ethics</option>
              <option value="epistemology">Epistemology</option>
              <option value="metaphysics">Metaphysics</option>
              <option value="logic">Logic</option>
              <option value="aesthetics">Aesthetics</option>
              <option value="political">Political</option>
              <option value="philosophy_of_mind">Philosophy of Mind</option>
              <option value="philosophy_of_science">Philosophy of Science</option>
            </select>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="btn-neon purple flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" /> New {currentType}
            </button>
            <span className="text-sm text-gray-500 ml-auto">{filtered.length} item{filtered.length !== 1 ? 's' : ''}</span>
          </div>

          {/* Create Form */}
          {showCreate && (
            <div className="panel p-4 space-y-3">
              <h3 className="font-semibold text-sm">New {currentType}</h3>
              <input
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
                placeholder="Title..."
                className="input-lattice w-full"
              />
              <select
                value={formBranch}
                onChange={e => setFormBranch(e.target.value as Branch)}
                className="input-lattice w-full"
              >
                <option value="ethics">Ethics</option>
                <option value="epistemology">Epistemology</option>
                <option value="metaphysics">Metaphysics</option>
                <option value="logic">Logic</option>
                <option value="aesthetics">Aesthetics</option>
                <option value="political">Political</option>
                <option value="philosophy_of_mind">Philosophy of Mind</option>
                <option value="philosophy_of_science">Philosophy of Science</option>
              </select>
              <textarea
                value={formDescription}
                onChange={e => setFormDescription(e.target.value)}
                placeholder="Description..."
                className="input-lattice w-full h-24 resize-none"
              />
              {currentType === 'Argument' && (
                <>
                  <textarea
                    value={formPremises}
                    onChange={e => setFormPremises(e.target.value)}
                    placeholder="Premises (one per line)..."
                    className="input-lattice w-full h-20 resize-none"
                  />
                  <input
                    value={formConclusion}
                    onChange={e => setFormConclusion(e.target.value)}
                    placeholder="Conclusion..."
                    className="input-lattice w-full"
                  />
                </>
              )}
              <div className="flex gap-2">
                <button onClick={handleCreate} disabled={!formTitle.trim()} className="btn-neon purple">Create</button>
                <button onClick={() => setShowCreate(false)} className="text-sm text-gray-400 hover:text-white">Cancel</button>
              </div>
            </div>
          )}

          {/* Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* List */}
            <div className="lg:col-span-2 space-y-2">
              {isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => <div key={i} className="h-20 bg-lattice-surface animate-pulse rounded-lg" />)}
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-16 text-gray-500">
                  <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p className="text-sm">No {currentType.toLowerCase()}s yet. Create one to get started.</p>
                </div>
              ) : (
                filtered.map((item, idx) => (
                  <motion.button
                    key={item.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.04 }}
                    onClick={() => setSelectedId(item.id)}
                    className={cn(
                      'w-full text-left p-4 rounded-lg border transition-colors',
                      selectedId === item.id
                        ? 'bg-lattice-surface border-neon-purple/50'
                        : 'bg-lattice-surface/50 border-lattice-border hover:border-gray-600'
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-sm font-medium text-white">{item.title}</h3>
                        <p className="text-xs text-gray-400 mt-1 line-clamp-2">{item.data.description}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className={cn('text-xs', BRANCH_COLORS[item.data.branch] || 'text-gray-400')}>
                            {item.data.branch?.replace(/_/g, ' ')}
                          </span>
                          {item.data.status && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-lattice-deep text-gray-300">{item.data.status}</span>
                          )}
                        </div>
                      </div>
                      <Eye className="w-4 h-4 text-gray-600 flex-shrink-0 mt-1" />
                    </div>
                  </motion.button>
                ))
              )}
            </div>

            {/* Detail Panel */}
            <div className="panel p-4 space-y-4 sticky top-4">
              {selected ? (
                <>
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-white">{selected.title}</h2>
                    <button onClick={() => remove(selected.id)} className="text-red-400 hover:text-red-300">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <p className={cn('text-xs font-medium', BRANCH_COLORS[selected.data.branch] || 'text-gray-400')}>
                    {selected.data.branch?.replace(/_/g, ' ')}
                  </p>
                  <p className="text-sm text-gray-300 whitespace-pre-wrap">{selected.data.description}</p>

                  {selected.data.premises && selected.data.premises.length > 0 && (
                    <div>
                      <h3 className="text-xs font-medium text-gray-400 mb-1">Premises</h3>
                      <ul className="space-y-1">
                        {selected.data.premises.map((p, i) => (
                          <li key={i} className="text-xs text-gray-300 pl-3 border-l-2 border-neon-purple/30">{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {selected.data.conclusion && (
                    <div>
                      <h3 className="text-xs font-medium text-gray-400 mb-1">Conclusion</h3>
                      <p className="text-xs text-gray-300">{selected.data.conclusion}</p>
                    </div>
                  )}
                  {selected.data.keyWorks && selected.data.keyWorks.length > 0 && (
                    <div>
                      <h3 className="text-xs font-medium text-gray-400 mb-1">Key Works</h3>
                      <div className="flex flex-wrap gap-1">
                        {selected.data.keyWorks.map((w, i) => (
                          <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-lattice-deep text-gray-300">{w}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {selected.data.relatedConcepts && selected.data.relatedConcepts.length > 0 && (
                    <div>
                      <h3 className="text-xs font-medium text-gray-400 mb-1">Related Concepts</h3>
                      <div className="flex flex-wrap gap-1">
                        {selected.data.relatedConcepts.map((c, i) => (
                          <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-neon-purple/10 text-neon-purple">{c}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="text-xs text-gray-500 pt-2 border-t border-lattice-border">
                    Created {new Date(selected.createdAt).toLocaleDateString()}
                  </div>
                </>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Select an item to view details</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="philosophy"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-400 hover:text-white transition-colors"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="philosophy" />
          </div>
        )}
      </div>
    </div>
  );
}
