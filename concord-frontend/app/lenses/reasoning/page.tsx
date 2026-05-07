'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GitBranch, Plus, CheckCircle2, ArrowRight, Brain,
  Search, ListTree, Workflow, Star, ChevronDown, ChevronRight,
  Shield, AlertTriangle, AlertOctagon, BookOpen, BarChart3,
  ThumbsUp, ThumbsDown, Link2, FileText, Sparkles,
  Target, Scale, Eye, Layers, Zap, RefreshCw,
  Download, X, Trash2, Flag,
  CircleDot, ArrowUpRight, MessageSquare, Hash,
  Loader2, Play
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { ds } from '@/lib/design-system';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { cn } from '@/lib/utils';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ModeTab = 'arguments' | 'premises' | 'evidence' | 'fallacies' | 'templates' | 'analysis';

type ArgumentNodeType = 'claim' | 'premise' | 'objection' | 'rebuttal' | 'qualifier' | 'warrant' | 'backing';
type ArgumentStance = 'pro' | 'con' | 'neutral';
type PremiseCategory = 'empirical' | 'logical' | 'normative' | 'definitional';
type PremiseStrength = 'uncontested' | 'contested' | 'refuted';
type EvidenceType = 'statistical' | 'anecdotal' | 'expert_testimony' | 'empirical_study' | 'logical_proof';
type FallacyType =
  | 'ad_hominem' | 'straw_man' | 'false_dichotomy' | 'appeal_to_authority'
  | 'circular_reasoning' | 'hasty_generalization' | 'red_herring'
  | 'slippery_slope' | 'tu_quoque' | 'equivocation';
type FallacySeverity = 'warning' | 'error';
type ChainType = 'deductive' | 'inductive' | 'abductive' | 'analogical' | 'causal' | 'modal';

interface ArgumentNode {
  id: string;
  text: string;
  type: ArgumentNodeType;
  stance: ArgumentStance;
  strength: number; // 1-5
  author: string;
  children: ArgumentNode[];
  parentId: string | null;
  premiseIds: string[];
  evidenceIds: string[];
  fallacyIds: string[];
  expanded: boolean;
}

interface ArgumentMap {
  id: string;
  title: string;
  rootClaim: string;
  chainType: ChainType;
  nodes: ArgumentNode[];
  createdAt: string;
  status: 'draft' | 'active' | 'concluded' | 'archived';
}

interface Premise {
  id: string;
  text: string;
  category: PremiseCategory;
  strength: PremiseStrength;
  argumentIds: string[];
  evidenceIds: string[];
  notes: string;
}

interface EvidenceItem {
  id: string;
  title: string;
  source: string;
  credibility: number; // 1-5
  relevance: number; // 1-5
  type: EvidenceType;
  premiseIds: string[];
  summary: string;
  url: string;
}

interface FallacyFlag {
  id: string;
  type: FallacyType;
  severity: FallacySeverity;
  nodeId: string;
  chainId: string;
  description: string;
  flaggedBy: 'manual' | 'automated';
  resolved: boolean;
}

interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  structure: { role: string; placeholder: string }[];
  example: string;
}

interface Chain {
  id: string;
  premise: string;
  type?: string;
  steps?: Record<string, unknown>[];
  conclusion?: string;
  status?: string;
  createdAt?: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MODE_TABS: { id: ModeTab; label: string; icon: typeof Brain }[] = [
  { id: 'arguments', label: 'Arguments', icon: GitBranch },
  { id: 'premises', label: 'Premises', icon: Layers },
  { id: 'evidence', label: 'Evidence', icon: FileText },
  { id: 'fallacies', label: 'Fallacies', icon: AlertTriangle },
  { id: 'templates', label: 'Templates', icon: BookOpen },
  { id: 'analysis', label: 'Analysis', icon: BarChart3 },
];

const NODE_TYPE_COLORS: Record<ArgumentNodeType, string> = {
  claim: 'neon-blue',
  premise: 'neon-purple',
  objection: 'red-400',
  rebuttal: 'green-400',
  qualifier: 'yellow-400',
  warrant: 'neon-cyan',
  backing: 'gray-400',
};

const STANCE_CONFIG: Record<ArgumentStance, { color: string; bg: string; border: string; label: string }> = {
  pro: { color: 'text-green-400', bg: 'bg-green-400/10', border: 'border-green-400/30', label: 'Supporting' },
  con: { color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/30', label: 'Opposing' },
  neutral: { color: 'text-gray-400', bg: 'bg-gray-400/10', border: 'border-gray-400/30', label: 'Neutral' },
};

const PREMISE_CATEGORY_COLORS: Record<PremiseCategory, string> = {
  empirical: 'neon-blue',
  logical: 'neon-purple',
  normative: 'yellow-400',
  definitional: 'neon-cyan',
};

const PREMISE_STRENGTH_CONFIG: Record<PremiseStrength, { color: string; label: string }> = {
  uncontested: { color: 'text-green-400', label: 'Uncontested' },
  contested: { color: 'text-yellow-400', label: 'Contested' },
  refuted: { color: 'text-red-400', label: 'Refuted' },
};

const _EVIDENCE_TYPE_ICONS: Record<EvidenceType, string> = {
  statistical: 'bar-chart',
  anecdotal: 'message',
  expert_testimony: 'user-check',
  empirical_study: 'microscope',
  logical_proof: 'check-square',
};

const FALLACY_LABELS: Record<FallacyType, string> = {
  ad_hominem: 'Ad Hominem',
  straw_man: 'Straw Man',
  false_dichotomy: 'False Dichotomy',
  appeal_to_authority: 'Appeal to Authority',
  circular_reasoning: 'Circular Reasoning',
  hasty_generalization: 'Hasty Generalization',
  red_herring: 'Red Herring',
  slippery_slope: 'Slippery Slope',
  tu_quoque: 'Tu Quoque',
  equivocation: 'Equivocation',
};

const FALLACY_DESCRIPTIONS: Record<FallacyType, string> = {
  ad_hominem: 'Attacking the person instead of the argument',
  straw_man: 'Misrepresenting someone\'s argument to make it easier to attack',
  false_dichotomy: 'Presenting only two options when more exist',
  appeal_to_authority: 'Using authority as evidence without proper justification',
  circular_reasoning: 'Using the conclusion as a premise',
  hasty_generalization: 'Drawing broad conclusions from limited examples',
  red_herring: 'Introducing irrelevant information to distract',
  slippery_slope: 'Assuming one event will inevitably lead to extreme consequences',
  tu_quoque: 'Deflecting criticism by pointing to the accuser\'s behavior',
  equivocation: 'Using ambiguous language to mislead',
};

const ARGUMENT_TEMPLATES: TemplateDefinition[] = [
  {
    id: 'toulmin',
    name: 'Toulmin Model',
    description: 'Stephen Toulmin\'s model: Claim, Grounds, Warrant, Backing, Qualifier, Rebuttal. Best for complex real-world arguments.',
    structure: [
      { role: 'Claim', placeholder: 'The main assertion you are making' },
      { role: 'Grounds', placeholder: 'The evidence or facts supporting the claim' },
      { role: 'Warrant', placeholder: 'The logical connection between grounds and claim' },
      { role: 'Backing', placeholder: 'Support for the warrant itself' },
      { role: 'Qualifier', placeholder: 'Limitations on the claim (e.g., probably, usually)' },
      { role: 'Rebuttal', placeholder: 'Conditions under which the claim would not hold' },
    ],
    example: 'Claim: Remote work improves productivity. Grounds: Studies show 13% increase. Warrant: Fewer distractions enable deep work. Qualifier: For knowledge workers. Rebuttal: May not apply to collaborative roles.',
  },
  {
    id: 'rogerian',
    name: 'Rogerian Argument',
    description: 'Carl Rogers\' consensus-building model. Acknowledges opposing views before finding common ground.',
    structure: [
      { role: 'Introduction', placeholder: 'Present the problem in neutral terms' },
      { role: 'Opposing View', placeholder: 'Fairly state the opposing position' },
      { role: 'Shared Concerns', placeholder: 'Identify areas of agreement' },
      { role: 'Your Position', placeholder: 'Present your view as complementary' },
      { role: 'Common Ground', placeholder: 'Proposed compromise or synthesis' },
    ],
    example: 'Both sides agree education matters. Traditional schooling emphasizes structure; alternative methods emphasize autonomy. A hybrid approach could serve both values.',
  },
  {
    id: 'syllogism',
    name: 'Classical Syllogism',
    description: 'Aristotelian deductive reasoning: Major premise, Minor premise, Conclusion. The foundation of formal logic.',
    structure: [
      { role: 'Major Premise', placeholder: 'Universal statement (All A are B)' },
      { role: 'Minor Premise', placeholder: 'Particular statement (C is A)' },
      { role: 'Conclusion', placeholder: 'Logical consequence (Therefore, C is B)' },
    ],
    example: 'Major: All mammals are warm-blooded. Minor: Whales are mammals. Conclusion: Therefore, whales are warm-blooded.',
  },
  {
    id: 'cost-benefit',
    name: 'Cost-Benefit Analysis',
    description: 'Systematic comparison of advantages and disadvantages. Weighted scoring for decision-making.',
    structure: [
      { role: 'Proposal', placeholder: 'The action or policy being evaluated' },
      { role: 'Benefits', placeholder: 'List of positive outcomes with magnitude' },
      { role: 'Costs', placeholder: 'List of negative outcomes with magnitude' },
      { role: 'Risk Assessment', placeholder: 'Probability and severity of uncertainties' },
      { role: 'Recommendation', placeholder: 'Net assessment and decision' },
    ],
    example: 'Proposal: Migrate to cloud. Benefits: Scalability, reduced ops. Costs: Migration effort, vendor lock-in. Risk: Data sovereignty concerns. Recommendation: Proceed with hybrid approach.',
  },
  {
    id: 'policy',
    name: 'Policy Argument',
    description: 'Standard policy debate framework: Problem, Inherency, Plan, Solvency, Advantages/Disadvantages.',
    structure: [
      { role: 'Problem', placeholder: 'The significant issue that must be addressed' },
      { role: 'Inherency', placeholder: 'Why the status quo cannot solve the problem' },
      { role: 'Plan', placeholder: 'Specific policy proposal with details' },
      { role: 'Solvency', placeholder: 'Evidence that the plan will solve the problem' },
      { role: 'Advantages', placeholder: 'Additional benefits beyond solving the problem' },
      { role: 'Disadvantages', placeholder: 'Potential negative consequences of the plan' },
    ],
    example: 'Problem: Rising healthcare costs. Inherency: Market incentives misaligned. Plan: Public option alongside private. Solvency: Other nations show reduced costs. Advantages: Universal coverage. Disadvantages: Implementation cost.',
  },
];

const CHAIN_TYPES: { value: ChainType; label: string; description: string }[] = [
  { value: 'deductive', label: 'Deductive', description: 'Conclusion necessarily follows from premises' },
  { value: 'inductive', label: 'Inductive', description: 'Conclusion is probable given the evidence' },
  { value: 'abductive', label: 'Abductive', description: 'Best explanation for observed facts' },
  { value: 'analogical', label: 'Analogical', description: 'Reasoning by similarity to known cases' },
  { value: 'causal', label: 'Causal', description: 'Establishing cause-and-effect relationships' },
  { value: 'modal', label: 'Modal', description: 'Reasoning about possibility and necessity' },
];

/* ------------------------------------------------------------------ */
/*  Helper: generate IDs                                               */
/* ------------------------------------------------------------------ */
function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/* ------------------------------------------------------------------ */
/*  Helper Components                                                  */
/* ------------------------------------------------------------------ */

function StrengthBar({ value, max = 5, size = 'sm' }: { value: number; max?: number; size?: 'sm' | 'md' }) {
  const w = size === 'sm' ? 'w-3' : 'w-4';
  const h = size === 'sm' ? 'h-1.5' : 'h-2';
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }, (_, i) => (
        <div
          key={i}
          className={cn(w, h, 'rounded-full transition-colors', i < value ? 'bg-neon-cyan' : 'bg-lattice-border')}
        />
      ))}
    </div>
  );
}

function StarRating({ value, onChange, readonly = false }: { value: number; onChange?: (v: number) => void; readonly?: boolean }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(s)}
          className={cn('transition-colors', readonly ? 'cursor-default' : 'cursor-pointer hover:text-yellow-300')}
        >
          <Star className={cn('w-3.5 h-3.5', s <= value ? 'fill-yellow-400 text-yellow-400' : 'text-gray-600')} />
        </button>
      ))}
    </div>
  );
}

function StatCard({ icon: Icon, value, label, color }: { icon: typeof Brain; value: number | string; label: string; color: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={ds.panel}
    >
      <Icon className={cn('w-5 h-5 mb-2', `text-${color}`)} />
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className={ds.textMuted}>{label}</p>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Argument Tree Node Component                                       */
/* ------------------------------------------------------------------ */

function ArgumentTreeNode({
  node,
  depth,
  onToggle,
  onAddChild,
  onSelect,
  selectedId,
}: {
  node: ArgumentNode;
  depth: number;
  onToggle: (id: string) => void;
  onAddChild: (parentId: string, stance: ArgumentStance) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  const stanceCfg = STANCE_CONFIG[node.stance];
  const typeColor = NODE_TYPE_COLORS[node.type];
  const isSelected = node.id === selectedId;

  return (
    <div className="select-none">
      <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: depth * 0.03 }}
        style={{ marginLeft: `${depth * 24}px` }}
        className={cn(
          'flex items-start gap-2 p-2.5 rounded-lg border transition-all cursor-pointer group',
          stanceCfg.bg, stanceCfg.border,
          isSelected && 'ring-1 ring-neon-cyan shadow-lg shadow-neon-cyan/10',
          !isSelected && 'hover:border-opacity-60'
        )}
        onClick={() => onSelect(node.id)}
      >
        {/* Expand/collapse toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
          className="mt-0.5 shrink-0"
        >
          {node.children.length > 0 ? (
            node.expanded ? (
              <ChevronDown className={cn('w-4 h-4', stanceCfg.color)} />
            ) : (
              <ChevronRight className={cn('w-4 h-4', stanceCfg.color)} />
            )
          ) : (
            <CircleDot className="w-4 h-4 text-gray-600" />
          )}
        </button>

        {/* Stance indicator bar */}
        <div className={cn('w-1 self-stretch rounded-full shrink-0', node.stance === 'pro' ? 'bg-green-400' : node.stance === 'con' ? 'bg-red-400' : 'bg-gray-500')} />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={cn('text-xs font-semibold uppercase px-1.5 py-0.5 rounded', `bg-${typeColor}/20 text-${typeColor}`)}>
              {node.type}
            </span>
            <StrengthBar value={node.strength} />
            {node.fallacyIds.length > 0 && (
              <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
            )}
          </div>
          <p className="text-sm text-white leading-snug">{node.text}</p>
          {node.author && (
            <p className="text-xs text-gray-500 mt-1">{node.author}</p>
          )}
        </div>

        {/* Quick action buttons */}
        <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onAddChild(node.id, 'pro'); }}
            className="p-1 rounded hover:bg-green-400/20 text-green-400"
            title="Add supporting argument"
          >
            <ThumbsUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onAddChild(node.id, 'con'); }}
            className="p-1 rounded hover:bg-red-400/20 text-red-400"
            title="Add opposing argument"
          >
            <ThumbsDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </motion.div>

      {/* Render children recursively */}
      <AnimatePresence>
        {node.expanded && node.children.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-1 mt-1"
          >
            {node.children.map((child) => (
              <ArgumentTreeNode
                key={child.id}
                node={child}
                depth={depth + 1}
                onToggle={onToggle}
                onAddChild={onAddChild}
                onSelect={onSelect}
                selectedId={selectedId}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page Component                                                */
/* ------------------------------------------------------------------ */

export default function ReasoningLensPage() {
  useLensNav('reasoning');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('reasoning');

  const queryClient = useQueryClient();

  // ----- Mode / Tab state -----
  const [mode, setMode] = useState<ModeTab>('arguments');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFeatures, setShowFeatures] = useState(true);

  // ----- Argument Map state -----
  const [argumentMaps, setArgumentMaps] = useState<ArgumentMap[]>([]);
  const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showNewMapModal, setShowNewMapModal] = useState(false);
  const [newMapTitle, setNewMapTitle] = useState('');
  const [newMapClaim, setNewMapClaim] = useState('');
  const [newMapChainType, setNewMapChainType] = useState<ChainType>('deductive');
  const [showAddNodeModal, setShowAddNodeModal] = useState(false);
  const [addNodeParentId, setAddNodeParentId] = useState<string | null>(null);
  const [addNodeStance, setAddNodeStance] = useState<ArgumentStance>('pro');
  const [addNodeText, setAddNodeText] = useState('');
  const [addNodeType, setAddNodeType] = useState<ArgumentNodeType>('premise');
  const [addNodeStrength, setAddNodeStrength] = useState(3);

  // ----- Premise state -----
  const [premises, setPremises] = useState<Premise[]>([]);
  const [showNewPremiseModal, setShowNewPremiseModal] = useState(false);
  const [newPremiseText, setNewPremiseText] = useState('');
  const [newPremiseCategory, setNewPremiseCategory] = useState<PremiseCategory>('empirical');
  const [premiseCategoryFilter, setPremiseCategoryFilter] = useState<string>('all');
  const [premiseStrengthFilter, setPremiseStrengthFilter] = useState<string>('all');

  // ----- Evidence state -----
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([]);
  const [showNewEvidenceModal, setShowNewEvidenceModal] = useState(false);
  const [newEvidenceTitle, setNewEvidenceTitle] = useState('');
  const [newEvidenceSource, setNewEvidenceSource] = useState('');
  const [newEvidenceType, setNewEvidenceType] = useState<EvidenceType>('empirical_study');
  const [newEvidenceCredibility, setNewEvidenceCredibility] = useState(3);
  const [newEvidenceRelevance, setNewEvidenceRelevance] = useState(3);
  const [newEvidenceSummary, setNewEvidenceSummary] = useState('');
  const [newEvidenceUrl, setNewEvidenceUrl] = useState('');

  // ----- Fallacy state -----
  const [fallacyFlags, setFallacyFlags] = useState<FallacyFlag[]>([]);
  const [showFlagFallacyModal, setShowFlagFallacyModal] = useState(false);
  const [flagFallacyType, setFlagFallacyType] = useState<FallacyType>('ad_hominem');
  const [flagFallacySeverity, setFlagFallacySeverity] = useState<FallacySeverity>('warning');
  const [flagFallacyDescription, setFlagFallacyDescription] = useState('');
  const [fallacyFilter, setFallacyFilter] = useState<string>('all');

  // ----- Chain Builder state -----
  const [newPremise, setNewPremise] = useState('');
  const [chainType, setChainType] = useState<ChainType>('deductive');
  const [selectedChain, setSelectedChain] = useState<string | null>(null);
  const [newStep, setNewStep] = useState('');

  // ----- Detail panel state -----
  const [showDetailPanel, setShowDetailPanel] = useState(false);

  // ----- Template state -----
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [templateFormValues, setTemplateFormValues] = useState<Record<string, string>>({});

  // ----- Analysis action state -----
  const [analysisResult, setAnalysisResult] = useState<Record<string, unknown> | null>(null);
  const [analysisRunning, setAnalysisRunning] = useState<string | null>(null);

  // ----- API queries -----
  const { data: chainsData, isError: isError2, error: error2, refetch: refetch2 } = useQuery({
    queryKey: ['reasoning-chains'],
    queryFn: () => apiHelpers.reasoning.list().then((r) => r.data),
    refetchInterval: 10000,
  });

  const { data: statusData, isError: isError3, error: error3, refetch: refetch3 } = useQuery({
    queryKey: ['reasoning-status'],
    queryFn: () => apiHelpers.reasoning.status().then((r) => r.data),
  });

  const { data: traceData, isError: isError4, error: error4, refetch: refetch4 } = useQuery({
    queryKey: ['reasoning-trace', selectedChain],
    queryFn: () => selectedChain ? apiHelpers.reasoning.trace(selectedChain).then((r) => r.data) : null,
    enabled: !!selectedChain,
  });

  // ----- API mutations -----
  const createChain = useMutation({
    mutationFn: () => apiHelpers.reasoning.create({ premise: newPremise, type: chainType }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['reasoning-chains'] });
      setNewPremise('');
      const id = res.data?.chain?.id || res.data?.id;
      if (id) setSelectedChain(id);
    },
    onError: (err) => console.error('createChain failed:', err instanceof Error ? err.message : err),
  });

  const addStep = useMutation({
    mutationFn: () => {
      if (!selectedChain) return Promise.reject('No chain selected');
      return apiHelpers.reasoning.addStep(selectedChain, { content: newStep });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reasoning-chains'] });
      queryClient.invalidateQueries({ queryKey: ['reasoning-trace', selectedChain] });
      setNewStep('');
    },
    onError: (err) => console.error('addStep failed:', err instanceof Error ? err.message : err),
  });

  const concludeChain = useMutation({
    mutationFn: () => {
      if (!selectedChain) return Promise.reject('No chain selected');
      return apiHelpers.reasoning.conclude(selectedChain);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reasoning-chains'] });
      queryClient.invalidateQueries({ queryKey: ['reasoning-trace', selectedChain] });
    },
    onError: (err) => console.error('concludeChain failed:', err instanceof Error ? err.message : err),
  });

  // ----- Lens artifact persistence -----
  const { isLoading, isError, error, refetch, items: chainArtifacts, create: createChainArtifact } = useLensData('reasoning', 'chain', { noSeed: true });

  // ----- Domain actions via useRunArtifact -----
  const runAction = useRunArtifact('reasoning');

  // ----- Auto-seed artifact from backend chains (ensures action buttons have a target) -----
  const chainSeeded = useRef(false);
  useEffect(() => {
    if (chainSeeded.current || chainArtifacts.length > 0 || !chainsData) return;
    const allChains: Chain[] = chainsData?.chains || chainsData || [];
    if (allChains.length > 0) {
      chainSeeded.current = true;
      const first = allChains[0];
      createChainArtifact({
        title: first.premise || 'Reasoning Chain',
        data: { chainId: first.id, type: first.type, premise: first.premise },
        meta: { status: first.status || 'active', tags: ['auto-synced'] },
      });
    }
  }, [chainsData, chainArtifacts.length, createChainArtifact]);

  // ----- Derived data -----
  const chains: Chain[] = chainsData?.chains || chainsData || [];
  const status: Record<string, unknown> = statusData?.status || statusData || {};
  const trace: Record<string, unknown> = traceData?.trace || traceData || {};
  const selectedMap = argumentMaps.find((m) => m.id === selectedMapId) || null;

  // ----- Computed stats -----
  const totalArguments = argumentMaps.length;
  const openChains = chains.filter((c) => !c.conclusion).length;
  const validatedChains = (status.validated as number) || 0;
  const totalFallacies = fallacyFlags.filter((f) => !f.resolved).length;
  const premisesWithEvidence = premises.filter((p) => p.evidenceIds.length > 0).length;
  const premiseCoverage = premises.length > 0 ? Math.round((premisesWithEvidence / premises.length) * 100) : 0;
  const counterArgumentCount = argumentMaps.reduce((acc, map) => {
    const countCons = (nodes: ArgumentNode[]): number =>
      nodes.reduce((sum, n) => sum + (n.stance === 'con' ? 1 : 0) + countCons(n.children), 0);
    return acc + countCons(map.nodes);
  }, 0);

  // ----- Argument Map helpers -----
  const createArgumentMap = useCallback(() => {
    if (!newMapTitle.trim() || !newMapClaim.trim()) return;
    const rootNode: ArgumentNode = {
      id: genId(),
      text: newMapClaim,
      type: 'claim',
      stance: 'neutral',
      strength: 3,
      author: 'You',
      children: [],
      parentId: null,
      premiseIds: [],
      evidenceIds: [],
      fallacyIds: [],
      expanded: true,
    };
    const newMap: ArgumentMap = {
      id: genId(),
      title: newMapTitle,
      rootClaim: newMapClaim,
      chainType: newMapChainType,
      nodes: [rootNode],
      createdAt: new Date().toISOString(),
      status: 'draft',
    };
    setArgumentMaps((prev) => [...prev, newMap]);
    setSelectedMapId(newMap.id);
    setShowNewMapModal(false);
    setNewMapTitle('');
    setNewMapClaim('');

    // Persist via artifact layer
    createChainArtifact({
      title: newMapTitle,
      data: { rootClaim: newMapClaim, chainType: newMapChainType },
      meta: { status: 'draft', tags: ['argument-map'] },
    });
  }, [newMapTitle, newMapClaim, newMapChainType, createChainArtifact]);

  const toggleNodeExpanded = useCallback((nodeId: string) => {
    setArgumentMaps((prev) =>
      prev.map((map) => {
        if (map.id !== selectedMapId) return map;
        const toggleInTree = (nodes: ArgumentNode[]): ArgumentNode[] =>
          nodes.map((n) => ({
            ...n,
            expanded: n.id === nodeId ? !n.expanded : n.expanded,
            children: toggleInTree(n.children),
          }));
        return { ...map, nodes: toggleInTree(map.nodes) };
      })
    );
  }, [selectedMapId]);

  const addChildNode = useCallback((parentId: string, stance: ArgumentStance) => {
    setAddNodeParentId(parentId);
    setAddNodeStance(stance);
    setAddNodeText('');
    setAddNodeType(stance === 'con' ? 'objection' : 'premise');
    setAddNodeStrength(3);
    setShowAddNodeModal(true);
  }, []);

  const confirmAddChildNode = useCallback(() => {
    if (!addNodeText.trim() || !addNodeParentId) return;
    const newNode: ArgumentNode = {
      id: genId(),
      text: addNodeText,
      type: addNodeType,
      stance: addNodeStance,
      strength: addNodeStrength,
      author: 'You',
      children: [],
      parentId: addNodeParentId,
      premiseIds: [],
      evidenceIds: [],
      fallacyIds: [],
      expanded: true,
    };
    setArgumentMaps((prev) =>
      prev.map((map) => {
        if (map.id !== selectedMapId) return map;
        const insertInTree = (nodes: ArgumentNode[]): ArgumentNode[] =>
          nodes.map((n) => ({
            ...n,
            children: n.id === addNodeParentId
              ? [...n.children, newNode]
              : insertInTree(n.children),
          }));
        return { ...map, nodes: insertInTree(map.nodes) };
      })
    );
    setShowAddNodeModal(false);
  }, [addNodeText, addNodeType, addNodeStance, addNodeStrength, addNodeParentId, selectedMapId]);

  // ----- Premise helpers -----
  const addPremise = useCallback(() => {
    if (!newPremiseText.trim()) return;
    const premise: Premise = {
      id: genId(),
      text: newPremiseText,
      category: newPremiseCategory,
      strength: 'uncontested',
      argumentIds: [],
      evidenceIds: [],
      notes: '',
    };
    setPremises((prev) => [...prev, premise]);
    setShowNewPremiseModal(false);
    setNewPremiseText('');
  }, [newPremiseText, newPremiseCategory]);

  const filteredPremises = useMemo(() => {
    let list = premises;
    if (premiseCategoryFilter !== 'all') list = list.filter((p) => p.category === premiseCategoryFilter);
    if (premiseStrengthFilter !== 'all') list = list.filter((p) => p.strength === premiseStrengthFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((p) => p.text.toLowerCase().includes(q));
    }
    return list;
  }, [premises, premiseCategoryFilter, premiseStrengthFilter, searchQuery]);

  // ----- Evidence helpers -----
  const addEvidence = useCallback(() => {
    if (!newEvidenceTitle.trim()) return;
    const evidence: EvidenceItem = {
      id: genId(),
      title: newEvidenceTitle,
      source: newEvidenceSource,
      credibility: newEvidenceCredibility,
      relevance: newEvidenceRelevance,
      type: newEvidenceType,
      premiseIds: [],
      summary: newEvidenceSummary,
      url: newEvidenceUrl,
    };
    setEvidenceItems((prev) => [...prev, evidence]);
    setShowNewEvidenceModal(false);
    setNewEvidenceTitle('');
    setNewEvidenceSource('');
    setNewEvidenceSummary('');
    setNewEvidenceUrl('');
  }, [newEvidenceTitle, newEvidenceSource, newEvidenceType, newEvidenceCredibility, newEvidenceRelevance, newEvidenceSummary, newEvidenceUrl]);

  const evidenceGaps = useMemo(() => {
    return premises.filter((p) => p.evidenceIds.length === 0);
  }, [premises]);

  // ----- Fallacy helpers -----
  const flagFallacy = useCallback(() => {
    if (!flagFallacyDescription.trim() || !selectedNodeId) return;
    const flag: FallacyFlag = {
      id: genId(),
      type: flagFallacyType,
      severity: flagFallacySeverity,
      nodeId: selectedNodeId,
      chainId: selectedMapId || '',
      description: flagFallacyDescription,
      flaggedBy: 'manual',
      resolved: false,
    };
    setFallacyFlags((prev) => [...prev, flag]);
    setShowFlagFallacyModal(false);
    setFlagFallacyDescription('');
  }, [flagFallacyType, flagFallacySeverity, flagFallacyDescription, selectedNodeId, selectedMapId]);

  const filteredFallacies = useMemo(() => {
    let list = fallacyFlags;
    if (fallacyFilter === 'unresolved') list = list.filter((f) => !f.resolved);
    if (fallacyFilter === 'resolved') list = list.filter((f) => f.resolved);
    if (fallacyFilter === 'warning') list = list.filter((f) => f.severity === 'warning');
    if (fallacyFilter === 'error') list = list.filter((f) => f.severity === 'error');
    return list;
  }, [fallacyFlags, fallacyFilter]);

  // ----- Template helpers -----
  const createFromTemplate = useCallback((templateId: string) => {
    const template = ARGUMENT_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;
    const mapTitle = `${template.name} - ${new Date().toLocaleDateString()}`;
    const rootNode: ArgumentNode = {
      id: genId(),
      text: templateFormValues[template.structure[0].role] || template.structure[0].placeholder,
      type: 'claim',
      stance: 'neutral',
      strength: 3,
      author: 'You',
      children: template.structure.slice(1).map((step) => ({
        id: genId(),
        text: templateFormValues[step.role] || step.placeholder,
        type: step.role.toLowerCase().includes('rebuttal') ? 'rebuttal' as ArgumentNodeType
          : step.role.toLowerCase().includes('objection') || step.role.toLowerCase().includes('opposing') || step.role.toLowerCase().includes('disadvantage') ? 'objection' as ArgumentNodeType
          : step.role.toLowerCase().includes('warrant') ? 'warrant' as ArgumentNodeType
          : step.role.toLowerCase().includes('backing') || step.role.toLowerCase().includes('ground') ? 'backing' as ArgumentNodeType
          : step.role.toLowerCase().includes('qualifier') ? 'qualifier' as ArgumentNodeType
          : 'premise' as ArgumentNodeType,
        stance: step.role.toLowerCase().includes('rebuttal') || step.role.toLowerCase().includes('opposing') || step.role.toLowerCase().includes('disadvantage') || step.role.toLowerCase().includes('cost') ? 'con' as ArgumentStance
          : step.role.toLowerCase().includes('qualifier') || step.role.toLowerCase().includes('risk') ? 'neutral' as ArgumentStance
          : 'pro' as ArgumentStance,
        strength: 3,
        author: 'You',
        children: [],
        parentId: '',
        premiseIds: [],
        evidenceIds: [],
        fallacyIds: [],
        expanded: true,
      })),
      parentId: null,
      premiseIds: [],
      evidenceIds: [],
      fallacyIds: [],
      expanded: true,
    };
    const newMap: ArgumentMap = {
      id: genId(),
      title: mapTitle,
      rootClaim: rootNode.text,
      chainType: 'deductive',
      nodes: [rootNode],
      createdAt: new Date().toISOString(),
      status: 'draft',
    };
    setArgumentMaps((prev) => [...prev, newMap]);
    setSelectedMapId(newMap.id);
    setSelectedTemplate(null);
    setTemplateFormValues({});
    setMode('arguments');
  }, [templateFormValues]);

  // ----- Domain action handlers -----
  const handleValidateLogic = useCallback(() => {
    if (!selectedChain) return;
    const artifactId = chainArtifacts[0]?.id;
    if (!artifactId) return;
    runAction.mutate(
      { id: artifactId, action: 'validate_logic', params: { chainId: selectedChain } },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reasoning-chains'] }),
        onError: (e) => {
          console.error('Action failed:', e);
        },
      }
    );
  }, [selectedChain, chainArtifacts, runAction, queryClient]);

  const handleCheckFallacies = useCallback(() => {
    if (!selectedChain) return;
    const artifactId = chainArtifacts[0]?.id;
    if (!artifactId) return;
    runAction.mutate(
      { id: artifactId, action: 'check_fallacies', params: { chainId: selectedChain } },
      {
        onSuccess: (res) => {
          const detected = (res as Record<string, unknown>).result as { fallacies?: FallacyFlag[] } | undefined;
          if (detected?.fallacies) {
            setFallacyFlags((prev) => [...prev, ...detected.fallacies!]);
          }
        },
        onError: (e) => {
          console.error('Action failed:', e);
        },
      }
    );
  }, [selectedChain, chainArtifacts, runAction]);

  const handleAssessStrength = useCallback(() => {
    if (!selectedChain) return;
    const artifactId = chainArtifacts[0]?.id;
    if (!artifactId) return;
    runAction.mutate(
      { id: artifactId, action: 'assess_strength', params: { chainId: selectedChain } },
      {
        onError: (e) => {
          console.error('Action failed:', e);
        },
      }
    );
  }, [selectedChain, chainArtifacts, runAction]);

  const handleExportMap = useCallback(() => {
    if (!selectedMap) return;
    const exportData = JSON.stringify(selectedMap, null, 2);
    const blob = new Blob([exportData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `argument-map-${selectedMap.title.replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [selectedMap]);

  // ----- Analysis tab backend action handler -----
  const handleAnalysisAction = useCallback(async (action: string) => {
    const artifactId = chainArtifacts[0]?.id;
    if (!artifactId) {
      setAnalysisResult({ message: 'No reasoning artifacts synced yet. Create a chain or argument map first.' });
      return;
    }
    setAnalysisRunning(action);
    setAnalysisResult(null);
    try {
      const res = await runAction.mutateAsync({ id: artifactId, action, params: { chainId: selectedChain } });
      if (res.ok === false) {
        setAnalysisResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` });
      } else {
        setAnalysisResult((res.result as Record<string, unknown>) || { message: 'Analysis complete' });
      }
      queryClient.invalidateQueries({ queryKey: ['reasoning-chains'] });
    } catch (e) {
      console.error(`Analysis action ${action} failed:`, e);
      setAnalysisResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` });
    } finally {
      setAnalysisRunning(null);
    }
  }, [chainArtifacts, runAction, selectedChain, queryClient]);

  // ----- Error state -----
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

  if (isError || isError2 || isError3 || isError4) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState
          error={error?.message || error2?.message || error3?.message || error4?.message}
          onRetry={() => { refetch(); refetch2(); refetch3(); refetch4(); }}
        />
      </div>
    );
  }

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div data-lens-theme="reasoning" className={ds.pageContainer}>
      {/* ---- Header ---- */}
      <header className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <Brain className="w-7 h-7 text-neon-purple" />
          <div>
            <h1 className={ds.heading1}>Reasoning Engine</h1>
            <p className={ds.textMuted}>
              Argument mapping, premise analysis, evidence linking, and fallacy detection
            </p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="reasoning" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className={cn(ds.input, 'pl-9 w-64')}
            />
          </div>
        </div>
      </header>

      {/* ---- Dashboard Stats ---- */}
      <div className={ds.grid4}>
        <StatCard icon={GitBranch} value={totalArguments + chains.length} label="Total Arguments" color="neon-blue" />
        <StatCard icon={ListTree} value={openChains} label="Open Chains" color="neon-purple" />
        <StatCard icon={CheckCircle2} value={validatedChains} label="Validated" color="green-400" />
        <StatCard icon={AlertTriangle} value={totalFallacies} label="Fallacies Found" color="red-400" />
      </div>

      {/* ---- Mode Tabs ---- */}
      <div className="flex items-center gap-1 border-b border-lattice-border pb-0">
        {MODE_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = mode === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setMode(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2',
                isActive
                  ? 'text-neon-cyan border-neon-cyan bg-neon-cyan/5'
                  : 'text-gray-400 border-transparent hover:text-white hover:bg-lattice-elevated/50'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
              {tab.id === 'fallacies' && totalFallacies > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs bg-red-400/20 text-red-400">
                  {totalFallacies}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ---- Domain Actions Bar ---- */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={handleValidateLogic}
          disabled={!selectedChain || runAction.isPending}
          className={cn(ds.btnSmall, 'bg-green-400/10 text-green-400 border border-green-400/30 hover:bg-green-400/20')}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          Validate Logic
        </button>
        <button
          onClick={handleCheckFallacies}
          disabled={!selectedChain || runAction.isPending}
          className={cn(ds.btnSmall, 'bg-red-400/10 text-red-400 border border-red-400/30 hover:bg-red-400/20')}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          Check Fallacies
        </button>
        <button
          onClick={handleAssessStrength}
          disabled={!selectedChain || runAction.isPending}
          className={cn(ds.btnSmall, 'bg-neon-purple/10 text-neon-purple border border-neon-purple/30 hover:bg-neon-purple/20')}
        >
          <Zap className="w-3.5 h-3.5" />
          Assess Strength
        </button>
        <button
          onClick={handleExportMap}
          disabled={!selectedMap}
          className={cn(ds.btnSmall, 'bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/20')}
        >
          <Download className="w-3.5 h-3.5" />
          Export Map
        </button>
        {runAction.isPending && (
          <span className={cn(ds.textMuted, 'flex items-center gap-1')}>
            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Running...
          </span>
        )}
      </div>

      {/* ================================================================ */}
      {/*  TAB: ARGUMENTS                                                  */}
      {/* ================================================================ */}
      {mode === 'arguments' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Map List + Chain Builder */}
          <div className="space-y-4">
            {/* New Argument Map */}
            <div className={ds.panel}>
              <div className={ds.sectionHeader}>
                <h2 className={cn(ds.heading3, 'flex items-center gap-2')}>
                  <Target className="w-4 h-4 text-neon-purple" />
                  Argument Maps
                </h2>
                <button onClick={() => setShowNewMapModal(true)} className={ds.btnPrimary}>
                  <Plus className="w-4 h-4" />
                  New Map
                </button>
              </div>
              <div className="space-y-2 mt-4 max-h-48 overflow-y-auto">
                {argumentMaps.map((map) => (
                  <button
                    key={map.id}
                    onClick={() => { setSelectedMapId(map.id); setSelectedNodeId(null); }}
                    className={cn(
                      ds.panelHover, 'w-full text-left',
                      selectedMapId === map.id && 'ring-1 ring-neon-cyan'
                    )}
                  >
                    <p className="text-sm font-medium text-white truncate">{map.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={cn('text-xs px-1.5 py-0.5 rounded bg-neon-purple/20 text-neon-purple')}>{map.chainType}</span>
                      <span className={cn(
                        'text-xs px-1.5 py-0.5 rounded',
                        map.status === 'concluded' ? 'bg-green-400/20 text-green-400' : 'bg-neon-blue/20 text-neon-blue'
                      )}>{map.status}</span>
                    </div>
                  </button>
                ))}
                {argumentMaps.length === 0 && (
                  <p className={cn(ds.textMuted, 'text-center py-3')}>No argument maps yet. Create one above.</p>
                )}
              </div>
            </div>

            {/* Chain Builder */}
            <div className={ds.panel}>
              <h2 className={cn(ds.heading3, 'flex items-center gap-2 mb-3')}>
                <Workflow className="w-4 h-4 text-neon-cyan" />
                Chain Builder
              </h2>
              <div className="space-y-3">
                <input
                  type="text"
                  value={newPremise}
                  onChange={(e) => setNewPremise(e.target.value)}
                  placeholder="Starting premise..."
                  className={ds.input}
                />
                <select
                  value={chainType}
                  onChange={(e) => setChainType(e.target.value as ChainType)}
                  className={ds.select}
                >
                  {CHAIN_TYPES.map((ct) => (
                    <option key={ct.value} value={ct.value}>{ct.label} - {ct.description}</option>
                  ))}
                </select>
                <button
                  onClick={() => createChain.mutate()}
                  disabled={!newPremise || createChain.isPending}
                  className={cn(ds.btnPrimary, 'w-full')}
                >
                  {createChain.isPending ? 'Creating...' : 'Create Chain'}
                </button>
              </div>

              {/* Chain List */}
              <div className="space-y-2 mt-4 max-h-48 overflow-y-auto">
                {chains.map((chain) => (
                  <button
                    key={chain.id}
                    onClick={() => { setSelectedChain(chain.id); setShowDetailPanel(true); }}
                    className={cn(
                      ds.panelHover, 'w-full text-left',
                      selectedChain === chain.id && 'ring-1 ring-neon-cyan'
                    )}
                  >
                    <p className="text-sm font-medium truncate text-white">{chain.premise}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={ds.textMuted}>{chain.type || 'deductive'}</span>
                      <span className={cn(
                        'text-xs px-1.5 py-0.5 rounded',
                        chain.conclusion ? 'bg-green-400/20 text-green-400' : 'bg-neon-blue/20 text-neon-blue'
                      )}>
                        {chain.conclusion ? 'concluded' : 'open'}
                      </span>
                    </div>
                  </button>
                ))}
                {chains.length === 0 && (
                  <p className={cn(ds.textMuted, 'text-center py-3')}>No chains yet</p>
                )}
              </div>
            </div>
          </div>

          {/* Right: Argument Map Viewer / Chain Trace */}
          <div className="lg:col-span-2 space-y-4">
            {/* Argument Map Tree */}
            {selectedMap ? (
              <div className={ds.panel}>
                <div className={ds.sectionHeader}>
                  <h2 className={cn(ds.heading3, 'flex items-center gap-2')}>
                    <GitBranch className="w-4 h-4 text-neon-blue" />
                    {selectedMap.title}
                  </h2>
                  <div className="flex items-center gap-2">
                    <span className={cn('text-xs px-2 py-1 rounded bg-neon-purple/20 text-neon-purple font-medium')}>
                      {selectedMap.chainType}
                    </span>
                    <button onClick={() => setShowDetailPanel(!showDetailPanel)} className={ds.btnGhost}>
                      <Eye className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Tree legend */}
                <div className="flex items-center gap-4 mt-3 mb-4">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-green-400" />
                    <span className="text-xs text-gray-400">Supporting</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-red-400" />
                    <span className="text-xs text-gray-400">Opposing</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-gray-500" />
                    <span className="text-xs text-gray-400">Neutral</span>
                  </div>
                  <div className="flex items-center gap-3 ml-auto">
                    <span className="text-xs text-gray-500">Strength:</span>
                    <StrengthBar value={3} />
                  </div>
                </div>

                {/* Tree nodes */}
                <div className="space-y-1 max-h-[500px] overflow-y-auto pr-1">
                  {selectedMap.nodes.map((node) => (
                    <ArgumentTreeNode
                      key={node.id}
                      node={node}
                      depth={0}
                      onToggle={toggleNodeExpanded}
                      onAddChild={addChildNode}
                      onSelect={setSelectedNodeId}
                      selectedId={selectedNodeId}
                    />
                  ))}
                </div>

                {/* Selected node details */}
                {selectedNodeId && (() => {
                  const findNode = (nodes: ArgumentNode[], id: string): ArgumentNode | null => {
                    for (const n of nodes) {
                      if (n.id === id) return n;
                      const found = findNode(n.children, id);
                      if (found) return found;
                    }
                    return null;
                  };
                  const node = findNode(selectedMap.nodes, selectedNodeId);
                  if (!node) return null;
                  return (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(ds.panel, 'mt-4 border-neon-cyan/30')}
                    >
                      <div className={ds.sectionHeader}>
                        <h3 className={cn(ds.heading3, 'text-sm')}>Node Detail</h3>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { setShowFlagFallacyModal(true); }}
                            className={cn(ds.btnSmall, 'bg-red-400/10 text-red-400 border border-red-400/30')}
                          >
                            <Flag className="w-3 h-3" />
                            Flag Fallacy
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 mt-3">
                        <div>
                          <span className={ds.label}>Type</span>
                          <span className={cn('text-xs font-semibold px-2 py-0.5 rounded', `bg-${NODE_TYPE_COLORS[node.type]}/20 text-${NODE_TYPE_COLORS[node.type]}`)}>{node.type}</span>
                        </div>
                        <div>
                          <span className={ds.label}>Stance</span>
                          <span className={cn('text-xs font-semibold', STANCE_CONFIG[node.stance].color)}>{STANCE_CONFIG[node.stance].label}</span>
                        </div>
                        <div>
                          <span className={ds.label}>Strength</span>
                          <StarRating value={node.strength} readonly />
                        </div>
                        <div>
                          <span className={ds.label}>Children</span>
                          <span className="text-sm text-white">{node.children.length}</span>
                        </div>
                      </div>
                      <div className="mt-3">
                        <span className={ds.label}>Text</span>
                        <p className="text-sm text-white">{node.text}</p>
                      </div>
                    </motion.div>
                  );
                })()}
              </div>
            ) : selectedChain ? (
              /* Chain Trace View */
              <div className={ds.panel}>
                <h2 className={cn(ds.heading3, 'flex items-center gap-2 mb-4')}>
                  <Search className="w-4 h-4 text-neon-green" />
                  Chain Trace
                </h2>
                <div className="space-y-3">
                  {(trace?.steps as Record<string, unknown>[] | undefined)?.map?.((step: Record<string, unknown>, i: number) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className="flex items-start gap-3"
                    >
                      <div className="flex flex-col items-center">
                        <div className={cn(
                          'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold',
                          step.validated ? 'bg-green-400/20 text-green-400' : 'bg-lattice-surface text-gray-400 border border-lattice-border'
                        )}>
                          {i + 1}
                        </div>
                        {i < ((trace.steps as unknown[] | undefined)?.length || 0) - 1 && (
                          <div className="w-0.5 h-6 bg-lattice-border mt-1" />
                        )}
                      </div>
                      <div className={cn(ds.panel, 'flex-1')}>
                        <p className="text-sm text-white">{step.content as string}</p>
                        {Boolean(step.type) && (
                          <span className={ds.textMuted}>{step.type as string}</span>
                        )}
                      </div>
                    </motion.div>
                  )) || (
                    <p className={ds.textMuted}>Loading trace...</p>
                  )}

                  {Boolean(trace?.conclusion) && (
                    <div className="p-3 rounded-lg bg-green-400/10 border border-green-400/30">
                      <p className="text-sm font-semibold text-green-400 flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4" /> Conclusion
                      </p>
                      <p className="text-sm mt-1 text-white">{trace.conclusion as string}</p>
                    </div>
                  )}
                </div>

                {/* Add Step */}
                {!trace?.conclusion && (
                  <div className="flex gap-2 mt-4">
                    <input
                      type="text"
                      value={newStep}
                      onChange={(e) => setNewStep(e.target.value)}
                      placeholder="Add reasoning step..."
                      className={cn(ds.input, 'flex-1')}
                    />
                    <button
                      onClick={() => addStep.mutate()}
                      disabled={!newStep || addStep.isPending}
                      className={ds.btnPrimary}
                    >
                      <ArrowRight className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => concludeChain.mutate()}
                      disabled={concludeChain.isPending}
                      className={cn(ds.btnSecondary)}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Conclude
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className={ds.panel}>
                <div className="text-center py-16">
                  <Brain className="w-16 h-16 mx-auto mb-4 text-gray-600" />
                  <p className="text-gray-400 text-lg font-medium">No argument map or chain selected</p>
                  <p className={ds.textMuted}>Create a new argument map or reasoning chain to begin mapping your logic.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/*  TAB: PREMISES                                                   */}
      {/* ================================================================ */}
      {mode === 'premises' && (
        <div className="space-y-4">
          <div className={ds.sectionHeader}>
            <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
              <Layers className="w-5 h-5 text-neon-purple" />
              Premise Manager
            </h2>
            <div className="flex items-center gap-2">
              <select
                value={premiseCategoryFilter}
                onChange={(e) => setPremiseCategoryFilter(e.target.value)}
                className={cn(ds.select, 'w-40')}
              >
                <option value="all">All Categories</option>
                <option value="empirical">Empirical</option>
                <option value="logical">Logical</option>
                <option value="normative">Normative</option>
                <option value="definitional">Definitional</option>
              </select>
              <select
                value={premiseStrengthFilter}
                onChange={(e) => setPremiseStrengthFilter(e.target.value)}
                className={cn(ds.select, 'w-40')}
              >
                <option value="all">All Strengths</option>
                <option value="uncontested">Uncontested</option>
                <option value="contested">Contested</option>
                <option value="refuted">Refuted</option>
              </select>
              <button onClick={() => setShowNewPremiseModal(true)} className={ds.btnPrimary}>
                <Plus className="w-4 h-4" />
                Add Premise
              </button>
            </div>
          </div>

          {/* Premise summary bar */}
          <div className={ds.grid4}>
            <div className={ds.panel}>
              <p className="text-2xl font-bold text-white">{premises.length}</p>
              <p className={ds.textMuted}>Total Premises</p>
            </div>
            <div className={ds.panel}>
              <p className="text-2xl font-bold text-green-400">{premises.filter((p) => p.strength === 'uncontested').length}</p>
              <p className={ds.textMuted}>Uncontested</p>
            </div>
            <div className={ds.panel}>
              <p className="text-2xl font-bold text-yellow-400">{premises.filter((p) => p.strength === 'contested').length}</p>
              <p className={ds.textMuted}>Contested</p>
            </div>
            <div className={ds.panel}>
              <p className="text-2xl font-bold text-red-400">{premises.filter((p) => p.strength === 'refuted').length}</p>
              <p className={ds.textMuted}>Refuted</p>
            </div>
          </div>

          {/* Premise List */}
          <div className="space-y-2">
            {filteredPremises.map((premise) => (
              <motion.div
                key={premise.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(ds.panel, 'flex items-start gap-4')}
              >
                <div className="flex-1">
                  <p className="text-sm text-white font-medium">{premise.text}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded font-medium',
                      `bg-${PREMISE_CATEGORY_COLORS[premise.category]}/20 text-${PREMISE_CATEGORY_COLORS[premise.category]}`
                    )}>
                      {premise.category}
                    </span>
                    <span className={cn('text-xs font-medium', PREMISE_STRENGTH_CONFIG[premise.strength].color)}>
                      {PREMISE_STRENGTH_CONFIG[premise.strength].label}
                    </span>
                    {premise.evidenceIds.length > 0 ? (
                      <span className="text-xs text-green-400 flex items-center gap-1">
                        <Link2 className="w-3 h-3" />
                        {premise.evidenceIds.length} evidence linked
                      </span>
                    ) : (
                      <span className="text-xs text-yellow-400 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        No evidence
                      </span>
                    )}
                    {premise.argumentIds.length > 0 && (
                      <span className={cn(ds.textMuted, 'flex items-center gap-1')}>
                        <Hash className="w-3 h-3" />
                        Used in {premise.argumentIds.length} argument(s)
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setPremises((prev) => prev.map((p) => p.id === premise.id ? { ...p, strength: p.strength === 'uncontested' ? 'contested' : p.strength === 'contested' ? 'refuted' : 'uncontested' } : p))}
                    className={ds.btnGhost}
                    title="Toggle strength"
                  >
                    <Scale className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setPremises((prev) => prev.filter((p) => p.id !== premise.id))}
                    className={cn(ds.btnGhost, 'text-red-400 hover:text-red-300')}
                    title="Remove premise"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            ))}
            {filteredPremises.length === 0 && (
              <div className={cn(ds.panel, 'text-center py-8')}>
                <Layers className="w-10 h-10 mx-auto mb-3 text-gray-600" />
                <p className="text-gray-400">No premises found</p>
                <p className={ds.textMuted}>Add premises to track the foundations of your arguments.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/*  TAB: EVIDENCE                                                   */}
      {/* ================================================================ */}
      {mode === 'evidence' && (
        <div className="space-y-4">
          <div className={ds.sectionHeader}>
            <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
              <FileText className="w-5 h-5 text-neon-cyan" />
              Evidence Linker
            </h2>
            <button onClick={() => setShowNewEvidenceModal(true)} className={ds.btnPrimary}>
              <Plus className="w-4 h-4" />
              Add Evidence
            </button>
          </div>

          <div className={ds.grid2}>
            {/* Evidence List */}
            <div className="space-y-2">
              <h3 className={cn(ds.heading3, 'mb-2')}>Evidence Library</h3>
              {evidenceItems.map((ev) => (
                <motion.div
                  key={ev.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={ds.panel}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white">{ev.title}</p>
                      <p className={cn(ds.textMuted, 'mt-0.5 truncate')}>{ev.source}</p>
                    </div>
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded font-medium shrink-0 ml-2',
                      'bg-neon-cyan/20 text-neon-cyan'
                    )}>
                      {ev.type.replace('_', ' ')}
                    </span>
                  </div>
                  {ev.summary && (
                    <p className="text-xs text-gray-400 mt-2 line-clamp-2">{ev.summary}</p>
                  )}
                  <div className="flex items-center gap-4 mt-2">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-500">Credibility:</span>
                      <StrengthBar value={ev.credibility} />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-500">Relevance:</span>
                      <StrengthBar value={ev.relevance} />
                    </div>
                    <div className="flex items-center gap-1 ml-auto">
                      <span className="text-xs text-gray-500">{ev.premiseIds.length} premise(s) linked</span>
                    </div>
                  </div>
                  {ev.url && (
                    <a href={ev.url} target="_blank" rel="noreferrer" className="text-xs text-neon-blue hover:underline mt-1 flex items-center gap-1">
                      <ArrowUpRight className="w-3 h-3" />
                      Source link
                    </a>
                  )}
                </motion.div>
              ))}
              {evidenceItems.length === 0 && (
                <div className={cn(ds.panel, 'text-center py-8')}>
                  <FileText className="w-10 h-10 mx-auto mb-3 text-gray-600" />
                  <p className="text-gray-400">No evidence items yet</p>
                </div>
              )}
            </div>

            {/* Evidence Gap Analysis */}
            <div className="space-y-2">
              <h3 className={cn(ds.heading3, 'mb-2 flex items-center gap-2')}>
                <AlertTriangle className="w-4 h-4 text-yellow-400" />
                Evidence Gap Analysis
              </h3>
              <div className={ds.panel}>
                <div className="flex items-center justify-between mb-3">
                  <span className={ds.textMuted}>Premise coverage</span>
                  <span className="text-sm font-bold text-white">{premiseCoverage}%</span>
                </div>
                <div className="w-full h-2 bg-lattice-border rounded-full overflow-hidden">
                  <div
                    className="h-full bg-neon-cyan rounded-full transition-all"
                    style={{ width: `${premiseCoverage}%` }}
                  />
                </div>
              </div>

              {evidenceGaps.length > 0 ? (
                <>
                  <p className={cn(ds.textMuted, 'mt-2')}>Premises without evidence ({evidenceGaps.length}):</p>
                  {evidenceGaps.map((premise) => (
                    <div key={premise.id} className={cn(ds.panel, 'border-yellow-400/30')}>
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm text-white">{premise.text}</p>
                          <span className={cn('text-xs mt-1', `text-${PREMISE_CATEGORY_COLORS[premise.category]}`)}>{premise.category}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              ) : premises.length > 0 ? (
                <div className={cn(ds.panel, 'text-center py-6 border-green-400/30')}>
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-400" />
                  <p className="text-green-400 font-medium">All premises have evidence</p>
                </div>
              ) : (
                <div className={cn(ds.panel, 'text-center py-6')}>
                  <p className={ds.textMuted}>Add premises to see gap analysis</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/*  TAB: FALLACIES                                                  */}
      {/* ================================================================ */}
      {mode === 'fallacies' && (
        <div className="space-y-4">
          <div className={ds.sectionHeader}>
            <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
              <AlertOctagon className="w-5 h-5 text-red-400" />
              Fallacy Detector
            </h2>
            <div className="flex items-center gap-2">
              <select
                value={fallacyFilter}
                onChange={(e) => setFallacyFilter(e.target.value)}
                className={cn(ds.select, 'w-40')}
              >
                <option value="all">All Flags</option>
                <option value="unresolved">Unresolved</option>
                <option value="resolved">Resolved</option>
                <option value="warning">Warnings</option>
                <option value="error">Errors</option>
              </select>
              <button
                onClick={handleCheckFallacies}
                disabled={!selectedChain || runAction.isPending}
                className={cn(ds.btnDanger)}
              >
                <Sparkles className="w-4 h-4" />
                Auto-Detect
              </button>
            </div>
          </div>

          {/* Fallacy reference grid */}
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-3')}>Fallacy Reference</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2">
              {(Object.entries(FALLACY_LABELS) as [FallacyType, string][]).map(([key, label]) => (
                <div
                  key={key}
                  className={cn(
                    'p-2 rounded-lg border border-lattice-border hover:border-red-400/30 transition-colors cursor-help',
                    'bg-lattice-surface'
                  )}
                  title={FALLACY_DESCRIPTIONS[key]}
                >
                  <p className="text-xs font-medium text-white">{label}</p>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{FALLACY_DESCRIPTIONS[key]}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Flagged fallacies list */}
          <div className="space-y-2">
            {filteredFallacies.map((flag) => (
              <motion.div
                key={flag.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                className={cn(
                  ds.panel,
                  'flex items-start gap-3',
                  flag.severity === 'error' ? 'border-red-400/40' : 'border-yellow-400/40'
                )}
              >
                {flag.severity === 'error' ? (
                  <AlertOctagon className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn(
                      'text-xs font-semibold px-2 py-0.5 rounded',
                      flag.severity === 'error' ? 'bg-red-400/20 text-red-400' : 'bg-yellow-400/20 text-yellow-400'
                    )}>
                      {FALLACY_LABELS[flag.type]}
                    </span>
                    <span className={cn(
                      'text-xs px-1.5 py-0.5 rounded',
                      flag.severity === 'error' ? 'bg-red-400/10 text-red-400' : 'bg-yellow-400/10 text-yellow-400'
                    )}>
                      {flag.severity}
                    </span>
                    <span className="text-xs text-gray-500">{flag.flaggedBy === 'automated' ? 'Auto-detected' : 'Manually flagged'}</span>
                    {flag.resolved && (
                      <span className="text-xs bg-green-400/20 text-green-400 px-1.5 py-0.5 rounded">Resolved</span>
                    )}
                  </div>
                  <p className="text-sm text-white">{flag.description}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!flag.resolved && (
                    <button
                      onClick={() => setFallacyFlags((prev) => prev.map((f) => f.id === flag.id ? { ...f, resolved: true } : f))}
                      className={cn(ds.btnGhost, 'text-green-400 hover:text-green-300')}
                      title="Mark resolved"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => setFallacyFlags((prev) => prev.filter((f) => f.id !== flag.id))}
                    className={cn(ds.btnGhost, 'text-red-400 hover:text-red-300')}
                    title="Remove flag"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            ))}
            {filteredFallacies.length === 0 && (
              <div className={cn(ds.panel, 'text-center py-12')}>
                <Shield className="w-12 h-12 mx-auto mb-3 text-gray-600" />
                <p className="text-gray-400 font-medium">No fallacies detected</p>
                <p className={ds.textMuted}>Select a chain and run auto-detection, or manually flag fallacies from the argument map.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/*  TAB: TEMPLATES                                                  */}
      {/* ================================================================ */}
      {mode === 'templates' && (
        <div className="space-y-4">
          <div className={ds.sectionHeader}>
            <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
              <BookOpen className="w-5 h-5 text-neon-green" />
              Argument Templates
            </h2>
          </div>

          <div className={ds.grid2}>
            {/* Template list */}
            <div className="space-y-3">
              {ARGUMENT_TEMPLATES.map((template) => (
                <motion.div
                  key={template.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    ds.panelHover,
                    selectedTemplate === template.id && 'ring-1 ring-neon-cyan'
                  )}
                  onClick={() => {
                    setSelectedTemplate(template.id);
                    setTemplateFormValues({});
                  }}
                >
                  <h3 className="text-sm font-semibold text-white">{template.name}</h3>
                  <p className="text-xs text-gray-400 mt-1">{template.description}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-neon-purple font-medium">{template.structure.length} steps</span>
                    <span className="text-xs text-gray-600">|</span>
                    {template.structure.map((s, i) => (
                      <span key={i} className="text-xs text-gray-500">{s.role}{i < template.structure.length - 1 ? ' \u2192' : ''}</span>
                    ))}
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Template detail + form */}
            <div>
              {selectedTemplate ? (() => {
                const template = ARGUMENT_TEMPLATES.find((t) => t.id === selectedTemplate);
                if (!template) return null;
                return (
                  <div className={ds.panel}>
                    <h3 className={cn(ds.heading3, 'mb-1')}>{template.name}</h3>
                    <p className={ds.textMuted}>{template.description}</p>

                    <div className={cn(ds.panel, 'mt-3 bg-neon-green/5 border-neon-green/20')}>
                      <p className="text-xs font-medium text-neon-green mb-1">Example</p>
                      <p className="text-xs text-gray-300">{template.example}</p>
                    </div>

                    <div className="space-y-3 mt-4">
                      <p className="text-sm font-medium text-white">Fill in the template:</p>
                      {template.structure.map((step) => (
                        <div key={step.role}>
                          <label className={ds.label}>{step.role}</label>
                          <textarea
                            value={templateFormValues[step.role] || ''}
                            onChange={(e) => setTemplateFormValues((prev) => ({ ...prev, [step.role]: e.target.value }))}
                            placeholder={step.placeholder}
                            className={cn(ds.textarea, 'h-20')}
                          />
                        </div>
                      ))}
                      <button
                        onClick={() => createFromTemplate(template.id)}
                        className={cn(ds.btnPrimary, 'w-full')}
                      >
                        <Sparkles className="w-4 h-4" />
                        Create Argument from Template
                      </button>
                    </div>
                  </div>
                );
              })() : (
                <div className={cn(ds.panel, 'text-center py-16')}>
                  <BookOpen className="w-12 h-12 mx-auto mb-3 text-gray-600" />
                  <p className="text-gray-400">Select a template to get started</p>
                  <p className={ds.textMuted}>Templates provide structured frameworks for building rigorous arguments.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/*  TAB: ANALYSIS                                                   */}
      {/* ================================================================ */}
      {mode === 'analysis' && (
        <div className="space-y-4">
          <div className={ds.sectionHeader}>
            <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
              <BarChart3 className="w-5 h-5 text-neon-cyan" />
              Analysis Dashboard
            </h2>
          </div>

          {/* Summary metrics */}
          <div className={ds.grid3}>
            <div className={ds.panel}>
              <h3 className={cn(ds.heading3, 'text-sm mb-3')}>Argument Strength</h3>
              <div className="space-y-3">
                {argumentMaps.length > 0 ? argumentMaps.map((map) => {
                  const avgStrength = (() => {
                    const allNodes: ArgumentNode[] = [];
                    const collect = (nodes: ArgumentNode[]) => { nodes.forEach((n) => { allNodes.push(n); collect(n.children); }); };
                    collect(map.nodes);
                    if (allNodes.length === 0) return 0;
                    return Number((allNodes.reduce((s, n) => s + n.strength, 0) / allNodes.length).toFixed(1));
                  })();
                  return (
                    <div key={map.id} className="flex items-center justify-between">
                      <span className="text-sm text-white truncate max-w-[60%]">{map.title}</span>
                      <div className="flex items-center gap-2">
                        <StrengthBar value={Math.round(avgStrength)} size="md" />
                        <span className="text-xs text-gray-400 w-8 text-right">{avgStrength}/5</span>
                      </div>
                    </div>
                  );
                }) : (
                  <p className={ds.textMuted}>No arguments to analyze</p>
                )}
              </div>
            </div>

            <div className={ds.panel}>
              <h3 className={cn(ds.heading3, 'text-sm mb-3')}>Coverage Metrics</h3>
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className={ds.textMuted}>Premise Coverage</span>
                    <span className="text-sm font-bold text-white">{premiseCoverage}%</span>
                  </div>
                  <div className="w-full h-2 bg-lattice-border rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', premiseCoverage >= 80 ? 'bg-green-400' : premiseCoverage >= 50 ? 'bg-yellow-400' : 'bg-red-400')}
                      style={{ width: `${premiseCoverage}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className={ds.textMuted}>Counter-arguments</span>
                  <span className="text-sm font-bold text-white">{counterArgumentCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={ds.textMuted}>Total premises</span>
                  <span className="text-sm font-bold text-white">{premises.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={ds.textMuted}>Evidence items</span>
                  <span className="text-sm font-bold text-white">{evidenceItems.length}</span>
                </div>
              </div>
            </div>

            <div className={ds.panel}>
              <h3 className={cn(ds.heading3, 'text-sm mb-3')}>Validity & Soundness</h3>
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className={ds.textMuted}>Validity</span>
                    <span className={cn('text-xs font-medium px-2 py-0.5 rounded', totalFallacies === 0 ? 'bg-green-400/20 text-green-400' : 'bg-red-400/20 text-red-400')}>
                      {totalFallacies === 0 ? 'No fallacies' : `${totalFallacies} fallacy issue(s)`}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">An argument is valid if the conclusion follows logically from the premises, regardless of whether the premises are true.</p>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className={ds.textMuted}>Soundness</span>
                    <span className={cn(
                      'text-xs font-medium px-2 py-0.5 rounded',
                      totalFallacies === 0 && premiseCoverage >= 80
                        ? 'bg-green-400/20 text-green-400'
                        : totalFallacies === 0 && premiseCoverage >= 50
                          ? 'bg-yellow-400/20 text-yellow-400'
                          : 'bg-red-400/20 text-red-400'
                    )}>
                      {totalFallacies === 0 && premiseCoverage >= 80 ? 'Strong' : totalFallacies === 0 && premiseCoverage >= 50 ? 'Moderate' : 'Weak'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">An argument is sound if it is valid and all its premises are true (supported by evidence).</p>
                </div>
                <div className="flex items-center justify-between">
                  <span className={ds.textMuted}>Fallacy count</span>
                  <span className={cn('text-sm font-bold', totalFallacies > 0 ? 'text-red-400' : 'text-green-400')}>{totalFallacies}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Chain-level analysis */}
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'text-sm mb-3')}>Chain Analysis</h3>
            {chains.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-lattice-border">
                      <th className="text-left py-2 px-3 text-gray-400 font-medium">Premise</th>
                      <th className="text-left py-2 px-3 text-gray-400 font-medium">Type</th>
                      <th className="text-left py-2 px-3 text-gray-400 font-medium">Steps</th>
                      <th className="text-left py-2 px-3 text-gray-400 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chains.map((chain) => (
                      <tr key={chain.id} className="border-b border-lattice-border/50 hover:bg-lattice-elevated/30">
                        <td className="py-2 px-3 text-white max-w-xs truncate">{chain.premise}</td>
                        <td className="py-2 px-3">
                          <span className="text-xs px-2 py-0.5 rounded bg-neon-purple/20 text-neon-purple">{chain.type || 'deductive'}</span>
                        </td>
                        <td className="py-2 px-3 text-gray-400">{chain.steps?.length || 0}</td>
                        <td className="py-2 px-3">
                          <span className={cn(
                            'text-xs px-2 py-0.5 rounded',
                            chain.conclusion ? 'bg-green-400/20 text-green-400' : 'bg-neon-blue/20 text-neon-blue'
                          )}>
                            {chain.conclusion ? 'Concluded' : 'Open'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={ds.textMuted}>No chains to analyze. Create chains in the Arguments tab.</p>
            )}
          </div>

          {/* Backend Reasoning Analysis Actions */}
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'text-sm mb-3 flex items-center gap-2')}>
              <Brain className="w-4 h-4 text-neon-purple" />
              AI-Powered Analysis
            </h3>
            <p className={cn(ds.textMuted, 'mb-3')}>
              Run backend reasoning analysis engines against your arguments and chains.
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { action: 'deepAnalysis', label: 'Deep Analysis' },
                { action: 'counterArgumentGen', label: 'Generate Counter-Arguments' },
                { action: 'strengthAssessment', label: 'Full Strength Assessment' },
              ].map(({ action, label }) => (
                <button
                  key={action}
                  onClick={() => handleAnalysisAction(action)}
                  disabled={!!analysisRunning || chainArtifacts.length === 0}
                  className={cn(ds.btnSmall, 'bg-neon-purple/10 text-neon-purple border border-neon-purple/30 hover:bg-neon-purple/20 disabled:opacity-50 disabled:cursor-not-allowed')}
                >
                  {analysisRunning === action ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  {label}
                </button>
              ))}
            </div>
            {analysisResult && (
              <div className="mt-3 bg-lattice-deep rounded-lg p-4 text-sm">
                {'message' in analysisResult ? (
                  <p className={ds.textMuted}>{String(analysisResult.message)}</p>
                ) : (
                  <pre className="whitespace-pre-wrap text-xs text-gray-300 font-mono max-h-48 overflow-y-auto">
                    {JSON.stringify(analysisResult, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/*  MODALS                                                          */}
      {/* ================================================================ */}

      {/* New Argument Map Modal */}
      <AnimatePresence>
        {showNewMapModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={ds.modalBackdrop}
              onClick={() => setShowNewMapModal(false)}
            />
            <div className={ds.modalContainer}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={cn(ds.modalPanel, 'max-w-lg p-6')}
              >
                <div className={ds.sectionHeader}>
                  <h2 className={ds.heading2}>New Argument Map</h2>
                  <button onClick={() => setShowNewMapModal(false)} className={ds.btnGhost}>
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="space-y-4 mt-4">
                  <div>
                    <label className={ds.label}>Title</label>
                    <input
                      type="text"
                      value={newMapTitle}
                      onChange={(e) => setNewMapTitle(e.target.value)}
                      placeholder="e.g., Should we adopt remote work?"
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Root Claim</label>
                    <textarea
                      value={newMapClaim}
                      onChange={(e) => setNewMapClaim(e.target.value)}
                      placeholder="The central thesis or claim to argue"
                      className={cn(ds.textarea, 'h-24')}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Reasoning Type</label>
                    <select
                      value={newMapChainType}
                      onChange={(e) => setNewMapChainType(e.target.value as ChainType)}
                      className={ds.select}
                    >
                      {CHAIN_TYPES.map((ct) => (
                        <option key={ct.value} value={ct.value}>{ct.label} - {ct.description}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={createArgumentMap}
                      disabled={!newMapTitle.trim() || !newMapClaim.trim()}
                      className={cn(ds.btnPrimary, 'flex-1')}
                    >
                      <Plus className="w-4 h-4" />
                      Create Map
                    </button>
                    <button onClick={() => setShowNewMapModal(false)} className={ds.btnSecondary}>
                      Cancel
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      {/* Add Child Node Modal */}
      <AnimatePresence>
        {showAddNodeModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={ds.modalBackdrop}
              onClick={() => setShowAddNodeModal(false)}
            />
            <div className={ds.modalContainer}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={cn(ds.modalPanel, 'max-w-lg p-6')}
              >
                <div className={ds.sectionHeader}>
                  <h2 className={ds.heading2}>
                    Add {addNodeStance === 'pro' ? 'Supporting' : addNodeStance === 'con' ? 'Opposing' : 'Qualifying'} Argument
                  </h2>
                  <button onClick={() => setShowAddNodeModal(false)} className={ds.btnGhost}>
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="space-y-4 mt-4">
                  <div>
                    <label className={ds.label}>Argument Text</label>
                    <textarea
                      value={addNodeText}
                      onChange={(e) => setAddNodeText(e.target.value)}
                      placeholder="State your argument clearly..."
                      className={cn(ds.textarea, 'h-24')}
                      autoFocus
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={ds.label}>Node Type</label>
                      <select
                        value={addNodeType}
                        onChange={(e) => setAddNodeType(e.target.value as ArgumentNodeType)}
                        className={ds.select}
                      >
                        <option value="claim">Claim</option>
                        <option value="premise">Premise</option>
                        <option value="objection">Objection</option>
                        <option value="rebuttal">Rebuttal</option>
                        <option value="qualifier">Qualifier</option>
                        <option value="warrant">Warrant</option>
                        <option value="backing">Backing</option>
                      </select>
                    </div>
                    <div>
                      <label className={ds.label}>Stance</label>
                      <select
                        value={addNodeStance}
                        onChange={(e) => setAddNodeStance(e.target.value as ArgumentStance)}
                        className={ds.select}
                      >
                        <option value="pro">Supporting (Pro)</option>
                        <option value="con">Opposing (Con)</option>
                        <option value="neutral">Neutral / Qualifying</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className={ds.label}>Strength (1-5)</label>
                    <div className="flex items-center gap-4">
                      <StarRating value={addNodeStrength} onChange={setAddNodeStrength} />
                      <span className={ds.textMuted}>{addNodeStrength}/5</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={confirmAddChildNode}
                      disabled={!addNodeText.trim()}
                      className={cn(
                        ds.btnPrimary, 'flex-1',
                        addNodeStance === 'pro' && 'bg-green-500 hover:bg-green-600',
                        addNodeStance === 'con' && 'bg-red-500 hover:bg-red-600'
                      )}
                    >
                      {addNodeStance === 'pro' ? <ThumbsUp className="w-4 h-4" /> : addNodeStance === 'con' ? <ThumbsDown className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
                      Add {addNodeStance === 'pro' ? 'Support' : addNodeStance === 'con' ? 'Objection' : 'Qualifier'}
                    </button>
                    <button onClick={() => setShowAddNodeModal(false)} className={ds.btnSecondary}>
                      Cancel
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      {/* New Premise Modal */}
      <AnimatePresence>
        {showNewPremiseModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={ds.modalBackdrop}
              onClick={() => setShowNewPremiseModal(false)}
            />
            <div className={ds.modalContainer}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={cn(ds.modalPanel, 'max-w-lg p-6')}
              >
                <div className={ds.sectionHeader}>
                  <h2 className={ds.heading2}>Add Premise</h2>
                  <button onClick={() => setShowNewPremiseModal(false)} className={ds.btnGhost}>
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="space-y-4 mt-4">
                  <div>
                    <label className={ds.label}>Premise Statement</label>
                    <textarea
                      value={newPremiseText}
                      onChange={(e) => setNewPremiseText(e.target.value)}
                      placeholder="State the premise clearly..."
                      className={cn(ds.textarea, 'h-24')}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Category</label>
                    <select
                      value={newPremiseCategory}
                      onChange={(e) => setNewPremiseCategory(e.target.value as PremiseCategory)}
                      className={ds.select}
                    >
                      <option value="empirical">Empirical - Based on observation or experience</option>
                      <option value="logical">Logical - Based on formal reasoning</option>
                      <option value="normative">Normative - Based on values or standards</option>
                      <option value="definitional">Definitional - Based on definitions of terms</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={addPremise}
                      disabled={!newPremiseText.trim()}
                      className={cn(ds.btnPrimary, 'flex-1')}
                    >
                      <Plus className="w-4 h-4" />
                      Add Premise
                    </button>
                    <button onClick={() => setShowNewPremiseModal(false)} className={ds.btnSecondary}>
                      Cancel
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      {/* New Evidence Modal */}
      <AnimatePresence>
        {showNewEvidenceModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={ds.modalBackdrop}
              onClick={() => setShowNewEvidenceModal(false)}
            />
            <div className={ds.modalContainer}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={cn(ds.modalPanel, 'max-w-lg p-6')}
              >
                <div className={ds.sectionHeader}>
                  <h2 className={ds.heading2}>Add Evidence</h2>
                  <button onClick={() => setShowNewEvidenceModal(false)} className={ds.btnGhost}>
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="space-y-4 mt-4">
                  <div>
                    <label className={ds.label}>Title</label>
                    <input
                      type="text"
                      value={newEvidenceTitle}
                      onChange={(e) => setNewEvidenceTitle(e.target.value)}
                      placeholder="e.g., Stanford Remote Work Study 2023"
                      className={ds.input}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Source</label>
                    <input
                      type="text"
                      value={newEvidenceSource}
                      onChange={(e) => setNewEvidenceSource(e.target.value)}
                      placeholder="e.g., Stanford University, Journal of Economics"
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Type</label>
                    <select
                      value={newEvidenceType}
                      onChange={(e) => setNewEvidenceType(e.target.value as EvidenceType)}
                      className={ds.select}
                    >
                      <option value="statistical">Statistical</option>
                      <option value="anecdotal">Anecdotal</option>
                      <option value="expert_testimony">Expert Testimony</option>
                      <option value="empirical_study">Empirical Study</option>
                      <option value="logical_proof">Logical Proof</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={ds.label}>Credibility (1-5)</label>
                      <StarRating value={newEvidenceCredibility} onChange={setNewEvidenceCredibility} />
                    </div>
                    <div>
                      <label className={ds.label}>Relevance (1-5)</label>
                      <StarRating value={newEvidenceRelevance} onChange={setNewEvidenceRelevance} />
                    </div>
                  </div>
                  <div>
                    <label className={ds.label}>Summary</label>
                    <textarea
                      value={newEvidenceSummary}
                      onChange={(e) => setNewEvidenceSummary(e.target.value)}
                      placeholder="Brief summary of the evidence..."
                      className={cn(ds.textarea, 'h-20')}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>URL (optional)</label>
                    <input
                      type="url"
                      value={newEvidenceUrl}
                      onChange={(e) => setNewEvidenceUrl(e.target.value)}
                      placeholder="https://..."
                      className={ds.input}
                    />
                  </div>
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={addEvidence}
                      disabled={!newEvidenceTitle.trim()}
                      className={cn(ds.btnPrimary, 'flex-1')}
                    >
                      <Plus className="w-4 h-4" />
                      Add Evidence
                    </button>
                    <button onClick={() => setShowNewEvidenceModal(false)} className={ds.btnSecondary}>
                      Cancel
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      {/* Flag Fallacy Modal */}
      <AnimatePresence>
        {showFlagFallacyModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={ds.modalBackdrop}
              onClick={() => setShowFlagFallacyModal(false)}
            />
            <div className={ds.modalContainer}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={cn(ds.modalPanel, 'max-w-lg p-6')}
              >
                <div className={ds.sectionHeader}>
                  <h2 className={ds.heading2}>Flag Logical Fallacy</h2>
                  <button onClick={() => setShowFlagFallacyModal(false)} className={ds.btnGhost}>
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="space-y-4 mt-4">
                  <div>
                    <label className={ds.label}>Fallacy Type</label>
                    <select
                      value={flagFallacyType}
                      onChange={(e) => setFlagFallacyType(e.target.value as FallacyType)}
                      className={ds.select}
                    >
                      {(Object.entries(FALLACY_LABELS) as [FallacyType, string][]).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">{FALLACY_DESCRIPTIONS[flagFallacyType]}</p>
                  </div>
                  <div>
                    <label className={ds.label}>Severity</label>
                    <select
                      value={flagFallacySeverity}
                      onChange={(e) => setFlagFallacySeverity(e.target.value as FallacySeverity)}
                      className={ds.select}
                    >
                      <option value="warning">Warning - Potential logical issue</option>
                      <option value="error">Error - Clear logical fallacy</option>
                    </select>
                  </div>
                  <div>
                    <label className={ds.label}>Description</label>
                    <textarea
                      value={flagFallacyDescription}
                      onChange={(e) => setFlagFallacyDescription(e.target.value)}
                      placeholder="Explain why this constitutes a logical fallacy..."
                      className={cn(ds.textarea, 'h-24')}
                      autoFocus
                    />
                  </div>
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={flagFallacy}
                      disabled={!flagFallacyDescription.trim()}
                      className={cn(ds.btnDanger, 'flex-1')}
                    >
                      <Flag className="w-4 h-4" />
                      Flag Fallacy
                    </button>
                    <button onClick={() => setShowFlagFallacyModal(false)} className={ds.btnSecondary}>
                      Cancel
                    </button>
                  </div>
                </div>
              </motion.div>

      {/* Real-time Data Panel */}
      {realtimeData && (
        <>
          <UniversalActions domain="reasoning" artifactId={null} compact />
          <RealtimeDataPanel
            domain="reasoning"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        </>
      )}
            </div>
          </>
        )}
      </AnimatePresence>

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
            <LensFeaturePanel lensId="reasoning" />
          </div>
        )}
      </div>
    </div>
  );
}
