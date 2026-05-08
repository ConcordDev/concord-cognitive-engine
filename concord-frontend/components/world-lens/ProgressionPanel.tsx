'use client';

import React, { useState, useCallback } from 'react';
import {
  X, TrendingUp, Award, Star, Coins, ChevronRight,
  Lock, Unlock, Trophy, Users, Building2, Cpu, Zap,
  Compass, GraduationCap, Landmark, Hammer,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

type ReputationDomain =
  | 'structural'
  | 'materials'
  | 'infrastructure'
  | 'energy'
  | 'architecture'
  | 'mentorship'
  | 'governance'
  | 'exploration';

type TierName = 'Novice' | 'Apprentice' | 'Journeyman' | 'Expert' | 'Master' | 'Grandmaster';

interface DomainReputation {
  domain: ReputationDomain;
  tier: TierName;
  citations: number;
  citationsToNextTier: number;
  percentile?: number;
}

interface Milestone {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  domain?: ReputationDomain;
}

interface UnlockInfo {
  id: string;
  domain: ReputationDomain;
  citationsRequired: number;
  title: string;
  description: string;
  unlocked: boolean;
}

interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  earnedDate?: string;
}

interface ProfileProgression {
  totalCitations: number;
  totalRoyalties: number;
  domains: DomainReputation[];
  badges: Badge[];
}

interface ProgressionPanelProps {
  profile?: ProfileProgression;
  milestones?: Milestone[];
  unlocks?: UnlockInfo[];
  onClose?: () => void;
}

/* ── Constants ─────────────────────────────────────────────────── */

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const TIER_ORDER: TierName[] = ['Novice', 'Apprentice', 'Journeyman', 'Expert', 'Master', 'Grandmaster'];

const TIER_COLORS: Record<TierName, string> = {
  Novice:      'text-gray-400 bg-gray-500/20 border-gray-500/40',
  Apprentice:  'text-green-400 bg-green-500/20 border-green-500/40',
  Journeyman:  'text-blue-400 bg-blue-500/20 border-blue-500/40',
  Expert:      'text-purple-400 bg-purple-500/20 border-purple-500/40',
  Master:      'text-orange-400 bg-orange-500/20 border-orange-500/40',
  Grandmaster: 'text-yellow-400 bg-yellow-500/20 border-yellow-500/40',
};

const DOMAIN_META: Record<ReputationDomain, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  structural:     { label: 'Structural',     icon: Building2,      color: 'text-blue-400' },
  materials:      { label: 'Materials',      icon: Hammer,        color: 'text-orange-400' },
  infrastructure: { label: 'Infrastructure', icon: Cpu,            color: 'text-cyan-400' },
  energy:         { label: 'Energy',         icon: Zap,            color: 'text-yellow-400' },
  architecture:   { label: 'Architecture',   icon: Landmark,       color: 'text-purple-400' },
  mentorship:     { label: 'Mentorship',     icon: GraduationCap,  color: 'text-green-400' },
  governance:     { label: 'Governance',     icon: Users,          color: 'text-pink-400' },
  exploration:    { label: 'Exploration',    icon: Compass,        color: 'text-teal-400' },
};

const DEMO_PROFILE: ProfileProgression = {
  totalCitations: 347,
  totalRoyalties: 1285.50,
  domains: [
    { domain: 'structural',     tier: 'Journeyman', citations: 128, citationsToNextTier: 200, percentile: 5 },
    { domain: 'materials',      tier: 'Apprentice',  citations: 64,  citationsToNextTier: 100 },
    { domain: 'infrastructure', tier: 'Journeyman', citations: 95,  citationsToNextTier: 200, percentile: 12 },
    { domain: 'energy',         tier: 'Novice',      citations: 22,  citationsToNextTier: 50 },
    { domain: 'architecture',   tier: 'Expert',      citations: 210, citationsToNextTier: 500, percentile: 3 },
    { domain: 'mentorship',     tier: 'Apprentice',  citations: 38,  citationsToNextTier: 100 },
    { domain: 'governance',     tier: 'Novice',      citations: 12,  citationsToNextTier: 50 },
    { domain: 'exploration',    tier: 'Novice',      citations: 30,  citationsToNextTier: 50 },
  ],
  badges: [
    { id: 'b1', name: 'First Foundation',   description: 'Placed your first structural foundation.',          icon: '🏗', earnedDate: '2026-03-01' },
    { id: 'b2', name: 'Peer Reviewer',      description: 'Validated 50 structures from other engineers.',     icon: '✅', earnedDate: '2026-03-15' },
    { id: 'b3', name: 'Market Maker',       description: 'Earned 500 royalties from DTU citations.',          icon: '💰', earnedDate: '2026-03-28' },
    { id: 'b4', name: 'Storm Survivor',     description: 'All your structures survived a Category 3 storm.',  icon: '🌪', earnedDate: '2026-04-02' },
    { id: 'b5', name: 'Architect\'s Eye',   description: 'Reached Expert tier in Architecture.',              icon: '👁', earnedDate: '2026-04-04' },
  ],
};

const DEMO_MILESTONES: Milestone[] = [
  { id: 'm1', title: 'Expert Architect',          description: 'Reached Expert tier in Architecture domain.',       timestamp: '2 days ago', domain: 'architecture' },
  { id: 'm2', title: '300 Citations',             description: 'Your work has been cited 300 times across all domains.', timestamp: '5 days ago' },
  { id: 'm3', title: 'Storm Survivor',            description: 'All structures survived the Category 3 storm event.',   timestamp: '1 week ago' },
  { id: 'm4', title: '1000 Royalties',            description: 'Earned over 1,000 total royalties from citations.',     timestamp: '2 weeks ago' },
];

const DEMO_UNLOCKS: UnlockInfo[] = [
  { id: 'u1', domain: 'structural',     citationsRequired: 200, title: 'Large Foundation Blueprints',  description: 'Unlock 4x4 and 6x6 foundation sizes.',        unlocked: false },
  { id: 'u2', domain: 'materials',      citationsRequired: 100, title: 'Alloy Recipes',               description: 'Access advanced alloy crafting recipes.',       unlocked: false },
  { id: 'u3', domain: 'architecture',   citationsRequired: 500, title: 'Master Architect Tools',      description: 'Unlock freeform design and curved surfaces.',   unlocked: false },
  { id: 'u4', domain: 'infrastructure', citationsRequired: 100, title: 'Smart Grid Access',           description: 'Design automated infrastructure networks.',     unlocked: false },
  { id: 'u5', domain: 'energy',         citationsRequired: 50,  title: 'Solar Panel Blueprints',      description: 'Unlock renewable energy structure designs.',    unlocked: false },
  { id: 'u6', domain: 'exploration',    citationsRequired: 50,  title: 'District Fast Travel',        description: 'Unlock instant travel between discovered hubs.', unlocked: false },
];

/* ── Component ─────────────────────────────────────────────────── */

export default function ProgressionPanel({
  profile = DEMO_PROFILE,
  milestones = DEMO_MILESTONES,
  unlocks = DEMO_UNLOCKS,
  onClose,
}: ProgressionPanelProps) {
  const [activeTab, setActiveTab] = useState<'domains' | 'badges' | 'unlocks'>('domains');
  const [expandedDomain, setExpandedDomain] = useState<ReputationDomain | null>(null);

  const toggleDomain = useCallback((domain: ReputationDomain) => {
    setExpandedDomain((prev) => (prev === domain ? null : domain));
  }, []);

  return (
    <div className={`w-96 flex flex-col max-h-[calc(100vh-4rem)] ${panel} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-semibold">Progression</h2>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Summary counters */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-white/5">
        <div className="flex-1 text-center">
          <p className="text-2xl font-bold text-cyan-400">{profile.totalCitations}</p>
          <p className="text-[10px] text-gray-500 flex items-center justify-center gap-1">
            <Star className="w-3 h-3" /> Total Citations
          </p>
        </div>
        <div className="w-px h-8 bg-white/10" />
        <div className="flex-1 text-center">
          <p className="text-2xl font-bold text-yellow-400">{profile.totalRoyalties.toLocaleString()}</p>
          <p className="text-[10px] text-gray-500 flex items-center justify-center gap-1">
            <Coins className="w-3 h-3" /> Royalties Earned
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-white/5">
        {(['domains', 'badges', 'unlocks'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1 text-[10px] rounded capitalize transition-colors ${
              activeTab === tab
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Domains tab */}
        {activeTab === 'domains' && (
          <div className="p-3 space-y-1.5">
            {profile.domains.map((dr) => {
              const meta = DOMAIN_META[dr.domain];
              const Icon = meta.icon;
              const tierColor = TIER_COLORS[dr.tier];
              const pct = Math.round((dr.citations / dr.citationsToNextTier) * 100);
              const nextTierIdx = TIER_ORDER.indexOf(dr.tier) + 1;
              const nextTier = nextTierIdx < TIER_ORDER.length ? TIER_ORDER[nextTierIdx] : null;
              const isExpanded = expandedDomain === dr.domain;

              return (
                <div key={dr.domain} className="rounded bg-white/5 border border-white/5 overflow-hidden">
                  <button
                    onClick={() => toggleDomain(dr.domain)}
                    className="w-full flex items-center gap-2 p-2.5 text-left hover:bg-white/5 transition-colors"
                  >
                    <Icon className={`w-4 h-4 ${meta.color} shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-white">{meta.label}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border ${tierColor}`}>
                          {dr.tier}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-cyan-500/60 transition-all duration-500"
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <span className="text-[9px] text-gray-500 shrink-0">
                          {dr.citations}/{dr.citationsToNextTier}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className={`w-3 h-3 text-gray-600 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  </button>

                  {isExpanded && (
                    <div className="px-3 pb-2.5 pt-0.5 border-t border-white/5 space-y-1.5">
                      <p className="text-[10px] text-gray-400">
                        {dr.citations} citation{dr.citations !== 1 ? 's' : ''} earned in {meta.label}.
                      </p>
                      {nextTier && (
                        <p className="text-[10px] text-gray-500">
                          {dr.citationsToNextTier - dr.citations} more citations to reach{' '}
                          <span className={TIER_COLORS[nextTier].split(' ')[0]}>{nextTier}</span>.
                        </p>
                      )}
                      {dr.percentile && (
                        <p className="text-[10px] text-cyan-400 flex items-center gap-1">
                          <Award className="w-3 h-3" />
                          You are in the top {dr.percentile}% of {meta.label.toLowerCase()} engineers.
                        </p>
                      )}
                      {/* Unlock hint */}
                      {unlocks
                        .filter((u) => u.domain === dr.domain && !u.unlocked)
                        .slice(0, 1)
                        .map((u) => (
                          <p key={u.id} className="text-[10px] text-yellow-400/80 flex items-center gap-1">
                            <Lock className="w-3 h-3" />
                            At {u.citationsRequired} citations: {u.title}
                          </p>
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Badges tab */}
        {activeTab === 'badges' && (
          <div className="p-3">
            {profile.badges.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <Trophy className="w-8 h-8 text-gray-700 mb-2" />
                <p className="text-xs text-gray-500">No badges earned yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {profile.badges.map((badge) => (
                  <div key={badge.id} className="p-2.5 rounded bg-white/5 border border-white/10 hover:border-cyan-500/30 transition-colors">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{badge.icon}</span>
                      <span className="text-[11px] font-semibold text-white">{badge.name}</span>
                    </div>
                    <p className="text-[9px] text-gray-400">{badge.description}</p>
                    {badge.earnedDate && (
                      <p className="text-[8px] text-gray-600 mt-1">Earned {badge.earnedDate}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Unlocks tab */}
        {activeTab === 'unlocks' && (
          <div className="p-3 space-y-1.5">
            {unlocks.map((u) => {
              const domainRep = profile.domains.find((d) => d.domain === u.domain);
              const currentCitations = domainRep?.citations ?? 0;
              const pct = Math.min(100, Math.round((currentCitations / u.citationsRequired) * 100));
              const meta = DOMAIN_META[u.domain];
              const Icon = meta.icon;

              return (
                <div
                  key={u.id}
                  className={`p-2.5 rounded border transition-colors ${
                    u.unlocked
                      ? 'bg-cyan-500/10 border-cyan-500/30'
                      : 'bg-white/5 border-white/5'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {u.unlocked ? (
                      <Unlock className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    ) : (
                      <Lock className="w-3.5 h-3.5 text-gray-600 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-white">{u.title}</span>
                        <Icon className={`w-3 h-3 ${meta.color}`} />
                      </div>
                      <p className="text-[9px] text-gray-400">{u.description}</p>
                    </div>
                  </div>
                  {!u.unlocked && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-yellow-500/50 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[9px] text-gray-500">
                        {currentCitations}/{u.citationsRequired}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent milestones */}
      <div className="border-t border-white/5 px-3 py-2">
        <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1.5">Recent Milestones</p>
        <div className="space-y-1">
          {milestones.slice(0, 3).map((m) => (
            <div key={m.id} className="flex items-center gap-2 text-[10px]">
              <Award className="w-3 h-3 text-yellow-400 shrink-0" />
              <span className="text-gray-300 flex-1 truncate">{m.title}</span>
              <span className="text-gray-600 shrink-0">{m.timestamp}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
