'use client';

import React, { useState, useCallback, useEffect } from 'react';
import {
  X, TrendingUp, Award, Star, Coins, ChevronRight,
  Lock, Unlock, Trophy, Users, Building2, Cpu, Zap,
  Compass, GraduationCap, Landmark, Hammer,
} from 'lucide-react';
import { ds } from '@/lib/design-system';
import { lensRun } from '@/lib/api/client';

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

const panel = ds.panelFloating;

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

const EMPTY_PROFILE: ProfileProgression = {
  totalCitations: 0,
  totalRoyalties: 0,
  domains: [],
  badges: [],
};

/* ── Component ─────────────────────────────────────────────────── */

export default function ProgressionPanel({
  profile: profileProp,
  milestones: milestonesProp,
  unlocks: unlocksProp,
  onClose,
}: ProgressionPanelProps) {
  // Real progression from progression.creator_summary (citations/royalties/
  // domains/badges/unlocks/milestones from live data). No mock fallback —
  // before the fetch resolves (or on error / no data) we show an honest
  // empty state, never fabricated numbers.
  const [profile, setProfile] = useState<ProfileProgression>(profileProp ?? EMPTY_PROFILE);
  const [milestones, setMilestones] = useState<Milestone[]>(milestonesProp ?? []);
  const [unlocks, setUnlocks] = useState<UnlockInfo[]>(unlocksProp ?? []);
  useEffect(() => {
    if (profileProp) return; // caller supplied data — respect it
    let cancelled = false;
    (async () => {
      try {
        const r = await lensRun<{ profile?: ProfileProgression; milestones?: Milestone[]; unlocks?: UnlockInfo[] }>(
          'progression', 'creator_summary', {},
        );
        const payload = r.data?.result;
        if (cancelled || !r.data?.ok || !payload?.profile) return;
        setProfile(payload.profile);
        if (Array.isArray(payload.milestones)) setMilestones(payload.milestones);
        if (Array.isArray(payload.unlocks)) setUnlocks(payload.unlocks);
      } catch { /* keep empty state */ }
    })();
    return () => { cancelled = true; };
  }, [profileProp]);

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
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Summary counters */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-white/5">
        <div className="flex-1 text-center">
          <p className="text-2xl font-bold text-cyan-400">{profile.totalCitations}</p>
          <p className="text-[10px] text-gray-400 flex items-center justify-center gap-1">
            <Star className="w-3 h-3" /> Total Citations
          </p>
        </div>
        <div className="w-px h-8 bg-white/10" />
        <div className="flex-1 text-center">
          <p className="text-2xl font-bold text-yellow-400">{profile.totalRoyalties.toLocaleString()}</p>
          <p className="text-[10px] text-gray-400 flex items-center justify-center gap-1">
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
                : 'text-gray-400 hover:text-gray-300'
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
            {profile.domains.length === 0 && (
              <div className="flex flex-col items-center py-8 text-center">
                <TrendingUp className="w-8 h-8 text-gray-700 mb-2" />
                <p className="text-xs text-gray-400">No reputation earned yet.</p>
              </div>
            )}
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
                        <span className="text-[9px] text-gray-400 shrink-0">
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
                        <p className="text-[10px] text-gray-400">
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
                <p className="text-xs text-gray-400">No badges earned yet.</p>
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
                      <p className="text-[8px] text-gray-400 mt-1">Earned {badge.earnedDate}</p>
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
            {unlocks.length === 0 && (
              <div className="flex flex-col items-center py-8 text-center">
                <Lock className="w-8 h-8 text-gray-700 mb-2" />
                <p className="text-xs text-gray-400">No unlocks available yet.</p>
              </div>
            )}
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
                      <span className="text-[9px] text-gray-400">
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
        <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">Recent Milestones</p>
        <div className="space-y-1">
          {milestones.length === 0 && (
            <p className="text-[10px] text-gray-400">No milestones yet.</p>
          )}
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
