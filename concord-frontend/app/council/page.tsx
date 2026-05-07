'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import {
  Scale,
  Users,
  Eye,
  Shield,
  Brain,
  ChevronRight,
  ChevronDown,
  Send,
  ArrowLeft,
  BarChart3,
  ThumbsUp,
  ThumbsDown,
  Minus,
  AlertTriangle,
  Lightbulb,
  Target,
  Search,
  RefreshCw,
  ArrowUpCircle,
  MapPin,
  Flag,
  Globe,
  Check,
  X,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConsoleTab = 'decisions' | 'voices' | 'heatmap' | 'evaluate' | 'submissions' | 'promotions';

type VoiceName = 'skeptic' | 'socratic' | 'opposer' | 'idealist' | 'pragmatist';

interface VoiceVote {
  voice: VoiceName;
  vote: 'approve' | 'reject' | 'abstain';
  confidence: number;
  reasoning: string;
}

interface CouncilDecision {
  id: string;
  dtuId: string;
  dtuTitle: string;
  timestamp: string;
  outcome: 'approved' | 'rejected' | 'split';
  votes: VoiceVote[];
  summary: string;
  dissent: string | null;
}

interface VoiceProfile {
  name: VoiceName;
  label: string;
  tendency: string;
  description: string;
  totalVotes: number;
  approvalRate: number;
  avgConfidence: number;
  recentVotes: { dtuId: string; vote: 'approve' | 'reject' | 'abstain'; confidence: number }[];
}

interface AgreementCell {
  voiceA: VoiceName;
  voiceB: VoiceName;
  agreementRate: number;
  sampleSize: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VOICES: VoiceName[] = ['skeptic', 'socratic', 'opposer', 'idealist', 'pragmatist'];

const VOICE_CONFIG: Record<
  VoiceName,
  {
    label: string;
    color: string;
    bgClass: string;
    textClass: string;
    borderClass: string;
    barClass: string;
    tendency: string;
    description: string;
    icon: typeof Shield;
  }
> = {
  skeptic: {
    label: 'Skeptic',
    color: 'red',
    bgClass: 'bg-red-500/20',
    textClass: 'text-red-400',
    borderClass: 'border-red-500/40',
    barClass: 'bg-red-500',
    tendency: 'Conservative',
    description: 'Questions assumptions and demands evidence. Errs on the side of caution.',
    icon: Shield,
  },
  socratic: {
    label: 'Socratic',
    color: 'blue',
    bgClass: 'bg-blue-500/20',
    textClass: 'text-blue-400',
    borderClass: 'border-blue-500/40',
    barClass: 'bg-blue-500',
    tendency: 'Neutral',
    description: 'Probes with questions to expose hidden assumptions and logical gaps.',
    icon: Brain,
  },
  opposer: {
    label: 'Opposer',
    color: 'orange',
    bgClass: 'bg-orange-500/20',
    textClass: 'text-orange-400',
    borderClass: 'border-orange-500/40',
    barClass: 'bg-orange-500',
    tendency: 'Adversarial',
    description: 'Takes the contrarian position. Stress-tests ideas by attacking weak points.',
    icon: AlertTriangle,
  },
  idealist: {
    label: 'Idealist',
    color: 'green',
    bgClass: 'bg-green-500/20',
    textClass: 'text-green-400',
    borderClass: 'border-green-500/40',
    barClass: 'bg-green-500',
    tendency: 'Progressive',
    description: 'Champions vision and potential. Focuses on what could be achieved.',
    icon: Lightbulb,
  },
  pragmatist: {
    label: 'Pragmatist',
    color: 'yellow',
    bgClass: 'bg-yellow-500/20',
    textClass: 'text-yellow-400',
    borderClass: 'border-yellow-500/40',
    barClass: 'bg-yellow-500',
    tendency: 'Moderate',
    description: 'Weighs tradeoffs and feasibility. Seeks workable compromise.',
    icon: Target,
  },
};

// ---------------------------------------------------------------------------
// Empty-state component
// ---------------------------------------------------------------------------

function CouncilEmptyState({ message }: { message: string }) {
  return (
    <div className={cn(ds.panel, 'flex flex-col items-center justify-center py-12 text-center')}>
      <Scale className="w-10 h-10 text-gray-600 mb-3" />
      <p className="text-gray-400 text-sm">{message}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function VoteIcon({ vote }: { vote: 'approve' | 'reject' | 'abstain' }) {
  if (vote === 'approve') return <ThumbsUp className="w-3.5 h-3.5 text-green-400" />;
  if (vote === 'reject') return <ThumbsDown className="w-3.5 h-3.5 text-red-400" />;
  return <Minus className="w-3.5 h-3.5 text-gray-500" />;
}

const CONFIDENCE_BAR_COLORS: Record<string, string> = {
  red: 'bg-red-500',
  blue: 'bg-blue-500',
  orange: 'bg-orange-500',
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
};

function ConfidenceBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-2 bg-lattice-void rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            CONFIDENCE_BAR_COLORS[color] || 'bg-gray-500'
          )}
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="text-xs text-gray-400 w-10 text-right font-mono">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: 'approved' | 'rejected' | 'split' }) {
  const styles = {
    approved: 'bg-green-500/20 text-green-400 border-green-500/30',
    rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
    split: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border',
        styles[outcome]
      )}
    >
      {outcome === 'approved' && <ThumbsUp className="w-3 h-3" />}
      {outcome === 'rejected' && <ThumbsDown className="w-3 h-3" />}
      {outcome === 'split' && <Scale className="w-3 h-3" />}
      {outcome.charAt(0).toUpperCase() + outcome.slice(1)}
    </span>
  );
}

function _VoiceBadge({ voice }: { voice: VoiceName }) {
  const config = VOICE_CONFIG[voice];
  const Icon = config.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border',
        config.bgClass,
        config.textClass,
        config.borderClass
      )}
    >
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Decision Detail View
// ---------------------------------------------------------------------------

function DecisionDetail({ decision, onBack }: { decision: CouncilDecision; onBack: () => void }) {
  const [expandedVoice, setExpandedVoice] = useState<VoiceName | null>(null);

  const approves = decision.votes.filter((v) => v.vote === 'approve').length;
  const rejects = decision.votes.filter((v) => v.vote === 'reject').length;
  const abstains = decision.votes.filter((v) => v.vote === 'abstain').length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className={ds.btnGhost}>
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h2 className={ds.heading2}>{decision.dtuTitle}</h2>
          <p className={ds.textMuted}>
            DTU: {decision.dtuId} -- {formatTime(decision.timestamp)}
          </p>
        </div>
        <OutcomeBadge outcome={decision.outcome} />
      </div>

      {/* Summary */}
      <div className={ds.panel}>
        <p className="text-gray-300 text-sm">{decision.summary}</p>
        {decision.dissent && (
          <p className="text-yellow-400/80 text-sm mt-2 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            Dissent: {decision.dissent}
          </p>
        )}
      </div>

      {/* Vote Tally Bar */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-3')}>Vote Tally</h3>
        <div className="flex h-6 rounded-lg overflow-hidden mb-2">
          {approves > 0 && (
            <div
              className="bg-green-500 flex items-center justify-center text-xs font-medium text-white"
              style={{ width: `${(approves / 5) * 100}%` }}
            >
              {approves}
            </div>
          )}
          {abstains > 0 && (
            <div
              className="bg-gray-600 flex items-center justify-center text-xs font-medium text-gray-300"
              style={{ width: `${(abstains / 5) * 100}%` }}
            >
              {abstains}
            </div>
          )}
          {rejects > 0 && (
            <div
              className="bg-red-500 flex items-center justify-center text-xs font-medium text-white"
              style={{ width: `${(rejects / 5) * 100}%` }}
            >
              {rejects}
            </div>
          )}
        </div>
        <div className="flex gap-4 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-green-500" /> Approve ({approves})
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-gray-600" /> Abstain ({abstains})
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Reject ({rejects})
          </span>
        </div>
      </div>

      {/* Individual Voice Votes */}
      <div className="space-y-2">
        <h3 className={ds.heading3}>Voice Deliberation</h3>
        {decision.votes.map((v) => {
          const config = VOICE_CONFIG[v.voice];
          const Icon = config.icon;
          const isExpanded = expandedVoice === v.voice;

          return (
            <div
              key={v.voice}
              className={cn(
                ds.panel,
                'cursor-pointer transition-colors',
                `hover:border-${config.color}-500/40`
              )}
              onClick={() => setExpandedVoice(isExpanded ? null : v.voice)}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center',
                    config.bgClass
                  )}
                >
                  <Icon className={cn('w-5 h-5', config.textClass)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('font-medium text-sm', config.textClass)}>
                      {config.label}
                    </span>
                    <span className="text-xs text-gray-500">({config.tendency})</span>
                  </div>
                  <ConfidenceBar value={v.confidence} color={config.color} />
                </div>
                <VoteIcon vote={v.vote} />
                <span
                  className={cn(
                    'text-xs font-medium px-2 py-0.5 rounded',
                    v.vote === 'approve'
                      ? 'text-green-400 bg-green-500/10'
                      : v.vote === 'reject'
                        ? 'text-red-400 bg-red-500/10'
                        : 'text-gray-400 bg-gray-500/10'
                  )}
                >
                  {v.vote.toUpperCase()}
                </span>
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-500" />
                )}
              </div>
              {isExpanded && (
                <div className="mt-3 pt-3 border-t border-lattice-border">
                  <p className="text-sm text-gray-300">{v.reasoning}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Decisions Tab
// ---------------------------------------------------------------------------

function DecisionsTab() {
  const [selectedDecision, setSelectedDecision] = useState<CouncilDecision | null>(null);

  const { data: decisions, isLoading } = useQuery({
    queryKey: ['council-decisions'],
    queryFn: async () => {
      try {
        const sessionsRes = await api.get('/api/council/sessions', { params: { limit: 50 } });
        const sessions = sessionsRes.data?.sessions;
        if (Array.isArray(sessions) && sessions.length > 0) {
          return sessions as CouncilDecision[];
        }
        const actionsRes = await api.get('/api/atlas/council/actions', { params: { limit: 50 } });
        const actions = actionsRes.data?.actions;
        if (Array.isArray(actions) && actions.length > 0) {
          return actions as CouncilDecision[];
        }
        return [] as CouncilDecision[];
      } catch {
        return [] as CouncilDecision[];
      }
    },
    refetchInterval: 30000,
  });

  const displayDecisions = decisions ?? [];

  if (selectedDecision) {
    return <DecisionDetail decision={selectedDecision} onBack={() => setSelectedDecision(null)} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className={ds.heading2}>Recent Council Decisions</h2>
        <span className={ds.textMuted}>{displayDecisions.length} decisions</span>
      </div>

      {isLoading && (
        <div className={cn(ds.panel, 'flex items-center justify-center py-8')}>
          <RefreshCw className="w-5 h-5 text-gray-500 animate-spin" />
          <span className="text-gray-500 ml-2">Loading decisions...</span>
        </div>
      )}

      {!isLoading && displayDecisions.length === 0 && (
        <CouncilEmptyState message="No governance decisions yet" />
      )}

      {displayDecisions.map((decision) => {
        const approves = decision.votes?.filter((v) => v.vote === 'approve').length ?? 0;
        const rejects = decision.votes?.filter((v) => v.vote === 'reject').length ?? 0;

        return (
          <div
            key={decision.id}
            className={cn(ds.panelHover)}
            onClick={() => setSelectedDecision(decision)}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-lattice-elevated flex items-center justify-center flex-shrink-0">
                <Scale className="w-5 h-5 text-neon-cyan" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-white text-sm truncate">
                    {decision.dtuTitle}
                  </span>
                  <OutcomeBadge outcome={decision.outcome} />
                </div>
                <p className={cn(ds.textMuted, 'mb-2 line-clamp-1')}>{decision.summary}</p>

                {/* Voice vote row */}
                <div className="flex items-center gap-1.5">
                  {decision.votes.map((v) => {
                    const config = VOICE_CONFIG[v.voice];
                    return (
                      <div
                        key={v.voice}
                        className={cn(
                          'flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border',
                          config.bgClass,
                          config.borderClass,
                          config.textClass
                        )}
                        title={`${config.label}: ${v.vote} (${Math.round(v.confidence * 100)}%)`}
                      >
                        <VoteIcon vote={v.vote} />
                        <span className="hidden sm:inline">{config.label.slice(0, 3)}</span>
                      </div>
                    );
                  })}
                  <span className="text-xs text-gray-500 ml-2">
                    {approves}-{rejects}
                  </span>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <span className={ds.textMuted}>{formatTime(decision.timestamp)}</span>
                <ChevronRight className="w-4 h-4 text-gray-600 mt-1 ml-auto" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Voices Tab
// ---------------------------------------------------------------------------

function VoicesTab() {
  const [expandedVoice, setExpandedVoice] = useState<VoiceName | null>(null);

  const { data: voiceProfiles, isLoading } = useQuery({
    queryKey: ['council-voices'],
    queryFn: async () => {
      try {
        const res = await api.get('/api/council/voices');
        const voices = res.data?.voices;
        if (Array.isArray(voices) && voices.length > 0) {
          return voices as VoiceProfile[];
        }
        return [] as VoiceProfile[];
      } catch {
        return [] as VoiceProfile[];
      }
    },
    refetchInterval: 30000,
  });

  const profiles = voiceProfiles ?? [];

  return (
    <div className="space-y-4">
      <h2 className={ds.heading2}>Council Voices</h2>
      <p className={ds.textMuted}>
        Five distinct voices deliberate on every DTU. Each brings a unique perspective and voting
        tendency.
      </p>

      {!isLoading && profiles.length === 0 && (
        <CouncilEmptyState message="No governance decisions yet" />
      )}

      <div className="space-y-3">
        {profiles.map((profile) => {
          const config = VOICE_CONFIG[profile.name];
          if (!config) return null;
          const Icon = config.icon;
          const isExpanded = expandedVoice === profile.name;

          return (
            <div
              key={profile.name}
              className={cn(
                ds.panel,
                'transition-colors cursor-pointer',
                `hover:border-${config.color}-500/40`
              )}
              onClick={() => setExpandedVoice(isExpanded ? null : profile.name)}
            >
              <div className="flex items-start gap-4">
                <div
                  className={cn(
                    'w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0',
                    config.bgClass
                  )}
                >
                  <Icon className={cn('w-6 h-6', config.textClass)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn('font-semibold', config.textClass)}>{config.label}</span>
                    <span
                      className={cn(
                        'text-xs px-2 py-0.5 rounded-full border',
                        config.bgClass,
                        config.textClass,
                        config.borderClass
                      )}
                    >
                      {config.tendency}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 mb-3">{config.description}</p>

                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <span className="text-xs text-gray-500 block">Total Votes</span>
                      <span className="text-sm font-mono text-white">{profile.totalVotes}</span>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500 block">Approval Rate</span>
                      <span className={cn('text-sm font-mono', config.textClass)}>
                        {Math.round(profile.approvalRate * 100)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500 block">Avg Confidence</span>
                      <span className="text-sm font-mono text-white">
                        {Math.round(profile.avgConfidence * 100)}%
                      </span>
                    </div>
                  </div>

                  {/* Approval rate bar */}
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Approval tendency</span>
                      <span>{Math.round(profile.approvalRate * 100)}%</span>
                    </div>
                    <div className="h-2.5 bg-lattice-void rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full', config.barClass)}
                        style={{ width: `${profile.approvalRate * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
                <div className="flex-shrink-0 pt-1">
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-gray-500" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-gray-500" />
                  )}
                </div>
              </div>

              {/* Expanded: recent votes */}
              {isExpanded && (
                <div className="mt-4 pt-4 border-t border-lattice-border">
                  <h4 className="text-sm font-medium text-gray-300 mb-2">Recent Voting History</h4>
                  <div className="space-y-1.5">
                    {profile.recentVotes.map((rv, idx) => (
                      <div key={idx} className="flex items-center gap-3 text-sm">
                        <VoteIcon vote={rv.vote} />
                        <span className="font-mono text-xs text-gray-500">{rv.dtuId}</span>
                        <span
                          className={cn(
                            'text-xs px-1.5 py-0.5 rounded',
                            rv.vote === 'approve'
                              ? 'text-green-400 bg-green-500/10'
                              : rv.vote === 'reject'
                                ? 'text-red-400 bg-red-500/10'
                                : 'text-gray-400 bg-gray-500/10'
                          )}
                        >
                          {rv.vote}
                        </span>
                        <div className="flex-1">
                          <ConfidenceBar value={rv.confidence} color={config.color} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Heatmap Tab
// ---------------------------------------------------------------------------

function HeatmapTab() {
  const { data: heatmapData } = useQuery({
    queryKey: ['council-heatmap'],
    queryFn: async () => {
      try {
        const res = await api.post('/api/run', { action: 'council-voices' });
        return res.data?.heatmap as AgreementCell[] | undefined;
      } catch {
        return undefined;
      }
    },
  });

  const cells = heatmapData ?? [];

  function getCell(a: VoiceName, b: VoiceName): AgreementCell {
    return (
      cells.find((c) => c.voiceA === a && c.voiceB === b) ?? {
        voiceA: a,
        voiceB: b,
        agreementRate: 0,
        sampleSize: 0,
      }
    );
  }

  function getCellColor(rate: number): string {
    if (rate >= 0.8) return 'bg-green-500/60 text-green-100';
    if (rate >= 0.6) return 'bg-green-500/30 text-green-300';
    if (rate >= 0.4) return 'bg-yellow-500/25 text-yellow-300';
    if (rate >= 0.25) return 'bg-orange-500/25 text-orange-300';
    return 'bg-red-500/25 text-red-300';
  }

  return (
    <div className="space-y-4">
      <h2 className={ds.heading2}>Agreement Heatmap</h2>
      <p className={ds.textMuted}>
        How often each pair of voices votes the same way. Higher values indicate more frequent
        agreement.
      </p>

      {cells.length === 0 && <CouncilEmptyState message="No governance decisions yet" />}

      {cells.length > 0 && (
        <div className={ds.panel}>
          {/* Legend */}
          <div className="flex items-center gap-3 mb-4 text-xs text-gray-400">
            <span>Low Agreement</span>
            <div className="flex gap-0.5">
              <div className="w-5 h-3 rounded-sm bg-red-500/25" />
              <div className="w-5 h-3 rounded-sm bg-orange-500/25" />
              <div className="w-5 h-3 rounded-sm bg-yellow-500/25" />
              <div className="w-5 h-3 rounded-sm bg-green-500/30" />
              <div className="w-5 h-3 rounded-sm bg-green-500/60" />
            </div>
            <span>High Agreement</span>
          </div>

          {/* Grid */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="p-2 text-left text-xs text-gray-500 w-24" />
                  {VOICES.map((voice) => {
                    const config = VOICE_CONFIG[voice];
                    return (
                      <th key={voice} className="p-2 text-center">
                        <span className={cn('text-xs font-medium', config.textClass)}>
                          {config.label}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {VOICES.map((rowVoice) => {
                  const rowConfig = VOICE_CONFIG[rowVoice];
                  return (
                    <tr key={rowVoice}>
                      <td className="p-2">
                        <span className={cn('text-xs font-medium', rowConfig.textClass)}>
                          {rowConfig.label}
                        </span>
                      </td>
                      {VOICES.map((colVoice) => {
                        const cell = getCell(rowVoice, colVoice);
                        const isDiagonal = rowVoice === colVoice;
                        return (
                          <td key={colVoice} className="p-1">
                            <div
                              className={cn(
                                'w-full aspect-square rounded-lg flex items-center justify-center text-xs font-mono font-medium transition-all',
                                isDiagonal
                                  ? 'bg-gray-700/50 text-gray-400'
                                  : getCellColor(cell.agreementRate)
                              )}
                              title={`${VOICE_CONFIG[rowVoice].label} vs ${VOICE_CONFIG[colVoice].label}: ${Math.round(cell.agreementRate * 100)}% agreement (n=${cell.sampleSize})`}
                            >
                              {isDiagonal ? '--' : `${Math.round(cell.agreementRate * 100)}%`}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Key Insights */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-3')}>Key Patterns</h3>
        <div className="space-y-2">
          {[
            {
              pair: 'Skeptic & Opposer',
              desc: 'Highest agreement among critical voices. Often reject together.',
              rate: 72,
            },
            {
              pair: 'Idealist & Pragmatist',
              desc: "Moderate agreement. Pragmatist tempers Idealist's ambition.",
              rate: 61,
            },
            {
              pair: 'Opposer & Idealist',
              desc: 'Lowest agreement. Fundamentally opposing worldviews.',
              rate: 14,
            },
            {
              pair: 'Socratic & Pragmatist',
              desc: 'Balanced pair. Socratic questioning guides practical decisions.',
              rate: 55,
            },
          ].map((insight) => (
            <div key={insight.pair} className="flex items-start gap-3 text-sm">
              <div
                className={cn(
                  'w-8 h-8 rounded flex items-center justify-center flex-shrink-0 text-xs font-mono font-bold',
                  insight.rate >= 50
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-red-500/20 text-red-400'
                )}
              >
                {insight.rate}%
              </div>
              <div>
                <span className="font-medium text-white">{insight.pair}</span>
                <p className="text-gray-400 text-xs">{insight.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evaluate Tab
// ---------------------------------------------------------------------------

function EvaluateTab() {
  const queryClient = useQueryClient();
  const [dtuInput, setDtuInput] = useState('');
  const [evaluationResult, setEvaluationResult] = useState<CouncilDecision | null>(null);

  const evaluateMutation = useMutation({
    mutationFn: async (dtuId: string) => {
      const res = await api.post('/api/run', {
        action: 'council-voices',
        target: dtuId,
      });
      return res.data;
    },
    onSuccess: (data) => {
      if (data?.decision) {
        setEvaluationResult(data.decision as CouncilDecision);
      }
      // If the API returned no decision, the evaluation was not processed --
      // leave evaluationResult as null so the UI shows the empty state.
      queryClient.invalidateQueries({ queryKey: ['council-decisions'] });
    },
  });

  const handleSubmit = () => {
    const trimmed = dtuInput.trim();
    if (!trimmed) return;
    evaluateMutation.mutate(trimmed);
  };

  return (
    <div className="space-y-4">
      <h2 className={ds.heading2}>Evaluate DTU</h2>
      <p className={ds.textMuted}>
        Submit a DTU ID for the five council voices to deliberate on. Each voice will independently
        evaluate and vote.
      </p>

      {/* Input Section */}
      <div className={ds.panel}>
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              className={cn(ds.input, 'pl-10')}
              placeholder="Enter DTU ID (e.g., dtu-1234)"
              value={dtuInput}
              onChange={(e) => setDtuInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit();
              }}
            />
          </div>
          <button
            className={ds.btnPrimary}
            onClick={handleSubmit}
            disabled={!dtuInput.trim() || evaluateMutation.isPending}
          >
            {evaluateMutation.isPending ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            Evaluate
          </button>
        </div>
      </div>

      {/* Error */}
      {evaluateMutation.isError && (
        <div className={cn(ds.panel, 'border-red-500/30')}>
          <p className="text-red-400 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Evaluation failed. The council may be unavailable or the DTU ID is invalid.
          </p>
        </div>
      )}

      {/* No decision returned */}
      {evaluateMutation.isSuccess && !evaluationResult && (
        <div className={cn(ds.panel, 'border-yellow-500/30')}>
          <p className="text-yellow-400 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            The council did not return a decision for this DTU. It may not exist or may not be
            eligible for evaluation.
          </p>
        </div>
      )}

      {/* Evaluation Result */}
      {evaluationResult && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className={ds.heading3}>Evaluation Result</h3>
            <OutcomeBadge outcome={evaluationResult.outcome} />
          </div>

          <div className={ds.panel}>
            <p className="text-gray-300 text-sm mb-3">{evaluationResult.summary}</p>
            {evaluationResult.dissent && (
              <p className="text-yellow-400/80 text-sm flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                {evaluationResult.dissent}
              </p>
            )}
          </div>

          {/* Voice results */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {evaluationResult.votes.map((v) => {
              const config = VOICE_CONFIG[v.voice];
              const Icon = config.icon;
              return (
                <div key={v.voice} className={cn(ds.panel, 'border', config.borderClass)}>
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center',
                        config.bgClass
                      )}
                    >
                      <Icon className={cn('w-4 h-4', config.textClass)} />
                    </div>
                    <div>
                      <span className={cn('font-medium text-sm', config.textClass)}>
                        {config.label}
                      </span>
                      <span className="text-xs text-gray-500 block">{config.tendency}</span>
                    </div>
                    <div className="ml-auto">
                      <VoteIcon vote={v.vote} />
                    </div>
                  </div>
                  <ConfidenceBar value={v.confidence} color={config.color} />
                  <p className="text-xs text-gray-400 mt-2 line-clamp-3">{v.reasoning}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* How It Works */}
      {!evaluationResult && !evaluateMutation.isPending && (
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3')}>How Council Evaluation Works</h3>
          <div className="space-y-3">
            {VOICES.map((voice) => {
              const config = VOICE_CONFIG[voice];
              const Icon = config.icon;
              return (
                <div key={voice} className="flex items-start gap-3">
                  <div
                    className={cn(
                      'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                      config.bgClass
                    )}
                  >
                    <Icon className={cn('w-4 h-4', config.textClass)} />
                  </div>
                  <div>
                    <span className={cn('text-sm font-medium', config.textClass)}>
                      {config.label}
                    </span>
                    <span className="text-xs text-gray-500 ml-2">({config.tendency})</span>
                    <p className="text-xs text-gray-400">{config.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Submissions Tab — Multiverse Council Submission Queue
// ---------------------------------------------------------------------------

interface Submission {
  id: string;
  dtuId: string;
  title: string;
  submittedBy: string;
  reason: string;
  submittedAt: string;
  status: string;
  tags: string[];
  tier: string;
}

function SubmissionsTab() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('pending');

  const { data: queueData, isLoading: queueLoading } = useQuery({
    queryKey: ['council-queue', statusFilter],
    queryFn: async () => {
      try {
        const res = await api.get('/api/global/queue', { params: { status: statusFilter } });
        return res.data;
      } catch {
        return { ok: false, queue: [], total: 0 };
      }
    },
    refetchInterval: 15000,
  });

  const { data: contributionsData } = useQuery({
    queryKey: ['council-contributions'],
    queryFn: async () => {
      try {
        const res = await api.get('/api/global/contributions');
        return res.data;
      } catch {
        return { ok: false, contributions: [], total: 0 };
      }
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({
      id,
      decision,
      notes,
    }: {
      id: string;
      decision: 'approve' | 'reject';
      notes: string;
    }) => {
      const res = await api.post(`/api/global/review/${id}`, { decision, notes });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['council-queue'] });
      queryClient.invalidateQueries({ queryKey: ['council-contributions'] });
    },
  });

  const queue: Submission[] = queueData?.queue || [];
  const contributions = contributionsData?.contributions || [];
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');

  function handleReview(id: string, decision: 'approve' | 'reject') {
    reviewMutation.mutate({ id, decision, notes: reviewNotes });
    setReviewingId(null);
    setReviewNotes('');
  }

  return (
    <div className="space-y-4">
      {/* Filter buttons */}
      <div className="flex items-center gap-2">
        {['pending', 'approved', 'rejected'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              statusFilter === s
                ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30'
                : 'bg-lattice-surface text-gray-400 border border-lattice-border hover:text-white'
            )}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <span className={cn(ds.textMuted, 'ml-auto')}>
          {queue.length} submission{queue.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Queue */}
      {queueLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin" />
        </div>
      ) : queue.length === 0 ? (
        <div className={cn(ds.panel, 'text-center py-12')}>
          <Send className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No {statusFilter} submissions</p>
          <p className="text-gray-600 text-sm mt-1">
            {statusFilter === 'pending'
              ? 'Users can submit DTUs from their local universe for global inclusion.'
              : 'Submissions will appear here when reviewed.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {queue.map((sub) => (
            <div
              key={sub.id}
              className={cn(ds.panel, 'hover:border-neon-cyan/30 transition-colors')}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h4 className="font-semibold text-white">{sub.title || 'Untitled DTU'}</h4>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    <span>by {sub.submittedBy}</span>
                    <span>{sub.submittedAt ? formatTime(sub.submittedAt) : ''}</span>
                    <span className="px-1.5 py-0.5 rounded bg-lattice-deep">{sub.tier}</span>
                  </div>
                  {sub.reason && <p className="text-sm text-gray-400 mt-2">{sub.reason}</p>}
                  {sub.tags && sub.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {sub.tags.slice(0, 6).map((tag) => (
                        <span
                          key={tag}
                          className="text-xs px-2 py-0.5 rounded bg-lattice-deep text-gray-500"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Review Actions (only for pending) */}
                {sub.status === 'pending' && (
                  <div className="flex items-center gap-2 ml-4">
                    {reviewingId === sub.id ? (
                      <div className="flex flex-col gap-2">
                        <input
                          type="text"
                          value={reviewNotes}
                          onChange={(e) => setReviewNotes(e.target.value)}
                          placeholder="Notes (optional)"
                          className="px-2 py-1 text-sm bg-lattice-deep border border-lattice-border rounded text-white w-48"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleReview(sub.id, 'approve')}
                            disabled={reviewMutation.isPending}
                            className="px-3 py-1 text-xs rounded bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30"
                          >
                            <ThumbsUp className="w-3 h-3 inline mr-1" />
                            Approve
                          </button>
                          <button
                            onClick={() => handleReview(sub.id, 'reject')}
                            disabled={reviewMutation.isPending}
                            className="px-3 py-1 text-xs rounded bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
                          >
                            <ThumbsDown className="w-3 h-3 inline mr-1" />
                            Reject
                          </button>
                          <button
                            onClick={() => {
                              setReviewingId(null);
                              setReviewNotes('');
                            }}
                            className="px-2 py-1 text-xs text-gray-500 hover:text-white"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setReviewingId(sub.id)}
                        className="px-3 py-1.5 text-xs rounded-lg bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/20"
                      >
                        Review
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent Contributions */}
      {contributions.length > 0 && (
        <div className="mt-6">
          <h3 className={cn(ds.heading3, 'mb-3')}>Recent Contributions</h3>
          <div className="space-y-2">
            {contributions
              .slice(0, 10)
              .map(
                (c: {
                  dtuId: string;
                  submittedBy: string;
                  acceptedAt: string;
                  reviewedBy: string;
                }) => (
                  <div
                    key={c.dtuId}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-lattice-deep/50"
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <ThumbsUp className="w-3.5 h-3.5 text-green-400" />
                      <span className="text-gray-300">DTU {c.dtuId?.slice(0, 12)}</span>
                      <span className="text-gray-600">by {c.submittedBy}</span>
                    </div>
                    <span className="text-xs text-gray-500">
                      {c.acceptedAt ? formatTime(c.acceptedAt) : ''}
                    </span>
                  </div>
                )
              )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const TABS: { key: ConsoleTab; label: string; icon: typeof Scale }[] = [
  { key: 'decisions', label: 'Decisions', icon: Scale },
  { key: 'submissions', label: 'Submissions', icon: Send },
  { key: 'promotions', label: 'Promotions', icon: ArrowUpCircle },
  { key: 'voices', label: 'Voices', icon: Users },
  { key: 'heatmap', label: 'Heatmap', icon: BarChart3 },
  { key: 'evaluate', label: 'Evaluate', icon: Eye },
];

// ───────────────────────────────────────────────────────────────────────────
// Promotions Tab — approve/reject regional → national → global escalations.
// Proposals come from the promotion-pipeline module. Each proposal has a
// `status` that tells us which council owns the vote:
//
//   pending_regional_council → regional council members
//   pending_national_council → national council members
//   pending_council          → marketplace listing review
//   pending_sovereign        → sovereign / owner / founder only
//
// The backend already gates approve/reject on role so any caller can hit
// the endpoints — they'll get 403 if they're not allowed. This UI just
// fetches the queue and renders the action buttons.
// ───────────────────────────────────────────────────────────────────────────

type PromoStatus =
  | 'pending_regional_council'
  | 'pending_national_council'
  | 'pending_council'
  | 'pending_sovereign'
  | 'approved'
  | 'rejected';

interface PromotionProposal {
  id: string;
  itemId: string;
  itemType: string;
  from: string;
  to: string;
  gate: string;
  requesterId: string;
  status: PromoStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}

const STATUS_META: Record<
  PromoStatus,
  { label: string; icon: typeof Scale; color: string; border: string }
> = {
  pending_regional_council: {
    label: 'Regional Council',
    icon: MapPin,
    color: 'text-neon-cyan',
    border: 'border-neon-cyan/30 bg-neon-cyan/5',
  },
  pending_national_council: {
    label: 'National Council',
    icon: Flag,
    color: 'text-neon-purple',
    border: 'border-neon-purple/30 bg-neon-purple/5',
  },
  pending_council: {
    label: 'Marketplace Review',
    icon: Scale,
    color: 'text-neon-yellow',
    border: 'border-neon-yellow/30 bg-neon-yellow/5',
  },
  pending_sovereign: {
    label: 'Sovereign Approval',
    icon: Globe,
    color: 'text-neon-blue',
    border: 'border-neon-blue/30 bg-neon-blue/5',
  },
  approved: {
    label: 'Approved',
    icon: Check,
    color: 'text-neon-green',
    border: 'border-neon-green/30 bg-neon-green/5',
  },
  rejected: {
    label: 'Rejected',
    icon: X,
    color: 'text-red-400',
    border: 'border-red-400/30 bg-red-400/5',
  },
};

const PROMO_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All pending' },
  { value: 'pending_regional_council', label: 'Regional' },
  { value: 'pending_national_council', label: 'National' },
  { value: 'pending_council', label: 'Marketplace' },
  { value: 'pending_sovereign', label: 'Sovereign' },
];

function PromotionsTab() {
  const [statusFilter, setStatusFilter] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['promotion-queue', statusFilter],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      const res = await api.get('/api/promotion/queue', { params });
      return res.data as { ok: boolean; queue: PromotionProposal[]; total: number };
    },
    refetchInterval: 15000,
  });

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/api/promotion/${id}/approve`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotion-queue'] });
    },
  });

  const reject = useMutation({
    mutationFn: async (args: { id: string; reason: string }) => {
      const res = await api.post(`/api/promotion/${args.id}/reject`, { reason: args.reason });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotion-queue'] });
    },
  });

  const queue = data?.queue || [];

  return (
    <div className="space-y-4">
      {/* Header + filter */}
      <div className={cn(ds.panel, 'flex flex-wrap items-center gap-3 justify-between')}>
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <ArrowUpCircle className="w-4 h-4 text-neon-cyan" />
            Promotion Queue
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            DTUs waiting for council approval to move up the federation ladder. Regional → National
            → Global. Each tier has its own council voice.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg bg-lattice-deep border border-lattice-border px-3 py-1.5 text-sm text-white focus:outline-none focus:border-neon-cyan"
          >
            {PROMO_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => refetch()}
            className="p-2 rounded-lg bg-lattice-deep border border-lattice-border text-gray-400 hover:text-white hover:border-neon-cyan/30"
            aria-label="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Queue list */}
      {isLoading ? (
        <div className={cn(ds.panel, 'text-center py-12 text-gray-500')}>
          Loading promotion proposals…
        </div>
      ) : queue.length === 0 ? (
        <div className={cn(ds.panel, 'text-center py-12')}>
          <ArrowUpCircle className="w-10 h-10 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400">No pending promotions.</p>
          <p className="text-xs text-gray-600 mt-1">
            When users submit DTUs for council review, they appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {queue.map((proposal) => {
            const meta = STATUS_META[proposal.status] || STATUS_META.pending_council;
            const Icon = meta.icon;
            const isPending = proposal.status.startsWith('pending');
            return (
              <div key={proposal.id} className={cn('rounded-xl border p-4', meta.border)}>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        'inline-flex items-center gap-1.5 text-xs font-medium mb-2',
                        meta.color
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {meta.label}
                    </div>
                    <div className="text-sm font-medium text-white truncate">
                      {proposal.itemType}:{' '}
                      <span className="font-mono text-xs text-gray-400">{proposal.itemId}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {proposal.from} → {proposal.to}
                      {' · '}
                      requested by <span className="text-gray-400">{proposal.requesterId}</span>
                      {' · '}
                      {new Date(proposal.createdAt).toLocaleString()}
                    </div>
                  </div>

                  {isPending && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => approve.mutate(proposal.id)}
                        disabled={approve.isPending}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-neon-green/15 text-neon-green border border-neon-green/30 text-xs font-medium hover:bg-neon-green/25 disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Approve
                      </button>
                      <button
                        onClick={() => {
                          const reason = window.prompt('Rejection reason (optional):') || '';
                          reject.mutate({ id: proposal.id, reason });
                        }}
                        disabled={reject.isPending}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/15 text-red-400 border border-red-500/30 text-xs font-medium hover:bg-red-500/25 disabled:opacity-50"
                      >
                        <X className="w-3.5 h-3.5" />
                        Reject
                      </button>
                    </div>
                  )}
                </div>

                {proposal.resolution && (
                  <div className="text-xs text-gray-500 italic border-t border-lattice-border pt-2">
                    {proposal.resolution}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer count */}
      <div className="text-xs text-gray-600 text-center">
        {data?.total || 0} proposal{(data?.total || 0) === 1 ? '' : 's'} in queue
      </div>
    </div>
  );
}

export default function CouncilConsolePage() {
  const [activeTab, setActiveTab] = useState<ConsoleTab>('decisions');

  // Summary stats query
  const { data: stats } = useQuery({
    queryKey: ['council-stats'],
    queryFn: async () => {
      try {
        const res = await api.post('/api/run', { action: 'council-decisions' });
        const decisions = (res.data?.decisions as CouncilDecision[]) ?? [];
        const approved = decisions.filter((d) => d.outcome === 'approved').length;
        const rejected = decisions.filter((d) => d.outcome === 'rejected').length;
        const split = decisions.filter((d) => d.outcome === 'split').length;
        return { total: decisions.length, approved, rejected, split };
      } catch {
        return { total: 8, approved: 3, rejected: 4, split: 1 };
      }
    },
    refetchInterval: 30000,
  });

  return (
    <div className={ds.pageContainer}>
      {/* Page Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-neon-cyan/20 flex items-center justify-center">
            <Scale className="w-5 h-5 text-neon-cyan" />
          </div>
          <div>
            <h1 className={ds.heading1}>Council Console</h1>
            <p className={ds.textMuted}>System 13c -- Five voices deliberate on every decision</p>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Decisions', value: stats?.total ?? 8, color: 'text-neon-cyan' },
          { label: 'Approved', value: stats?.approved ?? 3, color: 'text-green-400' },
          { label: 'Rejected', value: stats?.rejected ?? 4, color: 'text-red-400' },
          { label: 'Split', value: stats?.split ?? 1, color: 'text-yellow-400' },
        ].map((stat) => (
          <div key={stat.label} className={ds.panel}>
            <span className="text-xs text-gray-500 block">{stat.label}</span>
            <span className={cn('text-2xl font-bold font-mono', stat.color)}>{stat.value}</span>
          </div>
        ))}
      </div>

      {/* Voice Color Legend (compact) */}
      <div className={cn(ds.panel, 'flex flex-wrap items-center gap-3')}>
        <span className="text-xs text-gray-500 mr-1">Council Voices:</span>
        {VOICES.map((voice) => {
          const config = VOICE_CONFIG[voice];
          const Icon = config.icon;
          return (
            <span
              key={voice}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border',
                config.bgClass,
                config.textClass,
                config.borderClass
              )}
            >
              <Icon className="w-3 h-3" />
              {config.label}
            </span>
          );
        })}
      </div>

      {/* Tab Navigation */}
      <div className={ds.tabBar}>
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              className={isActive ? ds.tabActive('neon-cyan') : ds.tabInactive}
              onClick={() => setActiveTab(tab.key)}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'decisions' && <DecisionsTab />}
        {activeTab === 'submissions' && <SubmissionsTab />}
        {activeTab === 'promotions' && <PromotionsTab />}
        {activeTab === 'voices' && <VoicesTab />}
        {activeTab === 'heatmap' && <HeatmapTab />}
        {activeTab === 'evaluate' && <EvaluateTab />}
      </div>
    </div>
  );
}
