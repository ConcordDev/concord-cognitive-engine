'use client';

import React, { useState, useEffect } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Shield, Heart, MessageSquare, UserPlus,
  UserCheck, Eye, Quote, Coins, Globe,
  Compass, Zap, BookOpen, Hammer,
  FlaskConical, Building2, GraduationCap, Map,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

type ReputationDomain =
  | 'structural' | 'materials' | 'infrastructure' | 'energy'
  | 'architecture' | 'mentorship' | 'governance' | 'exploration';

interface ReputationScore {
  domain: ReputationDomain;
  score: number; // 0-100
}

interface DTUPortfolioItem {
  id: string;
  name: string;
  thumbnail?: string;
  citations: number;
  publishedDate: string;
}

interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  earnedDate: string;
}

interface VisitorLogEntry {
  id: string;
  playerName: string;
  timestamp: string;
  inspected?: string;
}

interface ProfileData {
  id: string;
  displayName: string;
  avatar?: string;
  profession: string;
  firmName?: string;
  firmEmblem?: string;
  bio?: string;
  totalCitations: number;
  totalRoyalties: number;
  worldsOwned: number;
  firmMembership?: string;
  followerCount: number;
  followingCount: number;
  isFollowing?: boolean;
  isFriend?: boolean;
  reputation: ReputationScore[];
  joinDate: string;
}

interface PlayerProfileProps {
  profile?: ProfileData;
  portfolio?: DTUPortfolioItem[];
  badges?: Badge[];
  followers?: { id: string; name: string; online: boolean }[];
  friends?: { id: string; name: string; online: boolean }[];
  visitorLog?: VisitorLogEntry[];
  isOwnProfile?: boolean;
  onFollow?: (playerId: string) => void;
  onMessage?: (playerId: string) => void;
  onTour?: (playerId: string) => void;
  onAddFriend?: (playerId: string) => void;
}

/* ── Constants ─────────────────────────────────────────────────── */

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const DOMAIN_META: Record<ReputationDomain, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  structural:     { label: 'Structural',     icon: Hammer,         color: '#F59E0B' },
  materials:      { label: 'Materials',      icon: FlaskConical,   color: '#22C55E' },
  infrastructure: { label: 'Infrastructure', icon: Building2,      color: '#3B82F6' },
  energy:         { label: 'Energy',         icon: Zap,            color: '#EAB308' },
  architecture:   { label: 'Architecture',   icon: BookOpen,       color: '#EC4899' },
  mentorship:     { label: 'Mentorship',     icon: GraduationCap,  color: '#8B5CF6' },
  governance:     { label: 'Governance',     icon: Shield,         color: '#06B6D4' },
  exploration:    { label: 'Exploration',    icon: Compass,        color: '#F97316' },
};

/* ── Empty defaults ────────────────────────────────────────────── */
// Shown only until the real fetch resolves (or when a caller passes data via
// props). The component fetches REAL data from the `profile.*` macros
// (profile-get / reputation-summary / badges-list / portfolio-list /
// visitors-list — see the effect below) which back the reputation radar, DTU
// portfolio, badges, and visitor log. Empty states are honest, never fabricated.

const EMPTY_PROFILE: ProfileData = {
  id: '',
  displayName: '—',
  profession: '',
  totalCitations: 0,
  totalRoyalties: 0,
  worldsOwned: 0,
  followerCount: 0,
  followingCount: 0,
  joinDate: '',
  reputation: [],
};

/* ── Radar Chart (SVG) ─────────────────────────────────────────── */

function ReputationRadar({ scores }: { scores: ReputationScore[] }) {
  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = 80;
  const n = scores.length;

  const angleStep = (2 * Math.PI) / n;

  const gridLevels = [0.25, 0.5, 0.75, 1.0];

  const pointAt = (index: number, radius: number) => {
    const angle = angleStep * index - Math.PI / 2;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  };

  const dataPoints = scores.map((s, i) => pointAt(i, (s.score / 100) * maxR));
  const polygon = dataPoints.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[200px] mx-auto">
      {/* Grid rings */}
      {gridLevels.map(level => {
        const pts = scores.map((_, i) => pointAt(i, maxR * level));
        return (
          <polygon
            key={level}
            points={pts.map(p => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={0.5}
          />
        );
      })}

      {/* Axis lines */}
      {scores.map((_, i) => {
        const tip = pointAt(i, maxR);
        return <line key={i} x1={cx} y1={cy} x2={tip.x} y2={tip.y} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />;
      })}

      {/* Data polygon */}
      <polygon points={polygon} fill="rgba(34,211,238,0.15)" stroke="rgba(34,211,238,0.6)" strokeWidth={1.5} />

      {/* Data dots & labels */}
      {scores.map((s, i) => {
        const dp = dataPoints[i];
        const lp = pointAt(i, maxR + 18);
        const meta = DOMAIN_META[s.domain];
        return (
          <g key={s.domain}>
            <circle cx={dp.x} cy={dp.y} r={2.5} fill={meta.color} />
            <text x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="central" className="text-[7px] fill-white/50">
              {meta.label.slice(0, 6)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ── Component ─────────────────────────────────────────────────── */

export default function PlayerProfile({
  profile: profileProp,
  portfolio: portfolioProp,
  badges: badgesProp,
  followers: _followers,
  friends = [],
  visitorLog: visitorLogProp,
  isOwnProfile = false,
  onFollow,
  onMessage,
  onTour,
  onAddFriend,
}: PlayerProfileProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'portfolio' | 'badges' | 'friends' | 'visitors'>('overview');

  // Backend-fetched state. A caller-supplied prop always wins (the prop is
  // passed straight through); otherwise we fetch REAL data from the `profile`
  // lens-action domain and keep honest empty states until it resolves.
  const [fetchedProfile, setFetchedProfile] = useState<ProfileData>(EMPTY_PROFILE);
  const [fetchedPortfolio, setFetchedPortfolio] = useState<DTUPortfolioItem[]>([]);
  const [fetchedBadges, setFetchedBadges] = useState<Badge[]>([]);
  const [fetchedVisitors, setFetchedVisitors] = useState<VisitorLogEntry[]>([]);

  useEffect(() => {
    // Skip the fetch entirely if every surface was supplied via props.
    if (profileProp && portfolioProp && badgesProp && (visitorLogProp || !isOwnProfile)) return;
    let cancelled = false;
    (async () => {
      try {
        const calls: Promise<unknown>[] = [
          lensRun('profile', 'profile-get', {}),
          lensRun('profile', 'reputation-summary', {}),
          lensRun('profile', 'badges-list', {}),
          lensRun('profile', 'portfolio-list', {}),
        ];
        if (isOwnProfile) calls.push(lensRun('profile', 'visitors-list', {}));
        const [profRes, repRes, badgeRes, portRes, visRes] = await Promise.all(calls) as Array<{
          data: { ok: boolean; result: Record<string, unknown> | null };
        }>;
        if (cancelled) return;

        // Merge the editable profile + the derived reputation summary into the
        // rich ProfileData shape this panel renders.
        if (!profileProp) {
          const ep = (profRes?.data?.result?.profile ?? {}) as Record<string, unknown>;
          const rep = (repRes?.data?.result ?? {}) as Record<string, unknown>;
          setFetchedProfile({
            id: String(ep.id ?? ''),
            displayName: String(ep.displayName ?? '') || '—',
            avatar: ep.avatar ? String(ep.avatar) : undefined,
            profession: String(ep.profession ?? ''),
            firmName: ep.firmName ? String(ep.firmName) : undefined,
            bio: ep.bio ? String(ep.bio) : undefined,
            totalCitations: Number(rep.totalCitations ?? 0),
            totalRoyalties: Number(rep.totalRoyalties ?? 0),
            worldsOwned: Number(rep.worldsOwned ?? 0),
            followerCount: 0,
            followingCount: 0,
            reputation: Array.isArray(rep.reputation) ? (rep.reputation as ReputationScore[]) : [],
            joinDate: ep.updatedAt ? String(ep.updatedAt).slice(0, 10) : '',
          });
        }
        if (!badgesProp) {
          const list = (badgeRes?.data?.result?.badges ?? []) as Badge[];
          setFetchedBadges(list);
        }
        if (!portfolioProp) {
          const list = (portRes?.data?.result?.portfolio ?? []) as DTUPortfolioItem[];
          setFetchedPortfolio(list);
        }
        if (!visitorLogProp && isOwnProfile && visRes) {
          const list = (visRes?.data?.result?.visitors ?? []) as VisitorLogEntry[];
          setFetchedVisitors(list);
        }
      } catch {
        // Network/parse failure → keep honest empty states (no fabrication).
      }
    })();
    return () => { cancelled = true; };
  }, [profileProp, portfolioProp, badgesProp, visitorLogProp, isOwnProfile]);

  // Caller props win; otherwise use the fetched/real data.
  const profile = profileProp ?? fetchedProfile;
  const portfolio = portfolioProp ?? fetchedPortfolio;
  const badges = badgesProp ?? fetchedBadges;
  const visitorLog = visitorLogProp ?? fetchedVisitors;

  const [following, setFollowing] = useState(profile.isFollowing ?? false);
  const [friend, setFriend] = useState(profile.isFriend ?? false);

  const handleFollow = () => {
    setFollowing(!following);
    onFollow?.(profile.id);
  };

  const handleAddFriend = () => {
    setFriend(!friend);
    onAddFriend?.(profile.id);
  };

  /* ── Overview ──────────────────────────────────────────────── */
  const renderOverview = () => (
    <div className="space-y-4 p-4">
      {/* Reputation radar */}
      <div>
        <h4 className="text-xs text-white/50 uppercase tracking-wider mb-2">Reputation</h4>
        {profile.reputation.length === 0 ? (
          <p className="text-center text-white/30 text-xs py-6">No reputation data yet</p>
        ) : (
          <ReputationRadar scores={profile.reputation} />
        )}
        <div className="grid grid-cols-4 gap-2 mt-3">
          {profile.reputation.map(r => {
            const meta = DOMAIN_META[r.domain];
            return (
              <div key={r.domain} className="flex flex-col items-center gap-0.5">
                <span style={{ color: meta.color }}>{React.createElement(meta.icon, { className: 'w-3.5 h-3.5' })}</span>
                <span className="text-[9px] text-white/40">{meta.label}</span>
                <span className="text-[10px] font-medium text-white/70">{r.score}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Citations', value: profile.totalCitations, icon: Quote },
          { label: 'Royalties', value: profile.totalRoyalties, icon: Coins },
          { label: 'Worlds', value: profile.worldsOwned, icon: Globe },
          { label: 'Firm', value: profile.firmMembership ?? 'None', icon: Building2 },
        ].map(stat => (
          <div key={stat.label} className="bg-white/5 rounded-lg p-2 text-center">
            {React.createElement(stat.icon, { className: 'w-3.5 h-3.5 mx-auto text-white/30 mb-1' })}
            <div className="text-sm text-white font-medium">{typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}</div>
            <div className="text-[9px] text-white/40">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Walk through work */}
      <button
        onClick={() => onTour?.(profile.id)}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-sm transition-colors"
      >
        <Map size={14} /> Walk Through My Work
      </button>

      {/* Bio */}
      {profile.bio && (
        <div className="bg-white/5 rounded-lg p-3">
          <p className="text-xs text-white/60">{profile.bio}</p>
        </div>
      )}

      <div className="text-[10px] text-white/30 text-center">
        Joined {profile.joinDate}
      </div>
    </div>
  );

  /* ── Portfolio ─────────────────────────────────────────────── */
  const renderPortfolio = () => (
    <div className="p-4 space-y-3">
      <h4 className="text-xs text-white/50 uppercase tracking-wider">Published DTUs</h4>
      {portfolio.length === 0 && (
        <p className="text-center text-white/30 text-xs py-6">No published DTUs yet</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {portfolio.map(item => (
          <div key={item.id} className={`${panel} p-3 space-y-2`}>
            {/* Thumbnail placeholder */}
            <div className="w-full aspect-video rounded bg-gradient-to-br from-white/5 to-white/10 flex items-center justify-center">
              <Hammer size={16} className="text-white/15" />
            </div>
            <h5 className="text-xs text-white font-medium leading-tight truncate">{item.name}</h5>
            <div className="flex items-center justify-between text-[10px] text-white/40">
              <span className="flex items-center gap-1"><Quote size={9} /> {item.citations}</span>
              <span>{item.publishedDate}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Creation timeline */}
      <div className="mt-4">
        <h4 className="text-xs text-white/50 uppercase tracking-wider mb-2">Creation Timeline</h4>
        <div className="space-y-2">
          {portfolio.map(item => (
            <div key={item.id} className="flex items-center gap-3 text-xs">
              <span className="text-white/30 w-16 shrink-0">{item.publishedDate}</span>
              <div className="w-2 h-2 rounded-full bg-cyan-400 shrink-0" />
              <span className="text-white/70 truncate">{item.name}</span>
              <span className="text-white/30 ml-auto shrink-0">{item.citations} cites</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  /* ── Badges ────────────────────────────────────────────────── */
  const renderBadges = () => (
    <div className="p-4 space-y-3">
      <h4 className="text-xs text-white/50 uppercase tracking-wider">Achievements & Milestones</h4>
      {badges.length === 0 && (
        <p className="text-center text-white/30 text-xs py-6">No badges earned yet</p>
      )}
      <div className="grid grid-cols-3 gap-2">
        {badges.map(badge => (
          <div key={badge.id} className={`${panel} p-3 flex flex-col items-center text-center space-y-1`}>
            <span className="text-2xl">{badge.icon}</span>
            <h5 className="text-[10px] text-white font-medium leading-tight">{badge.name}</h5>
            <p className="text-[9px] text-white/40">{badge.description}</p>
            <span className="text-[9px] text-white/25">{badge.earnedDate}</span>
          </div>
        ))}
      </div>
    </div>
  );

  /* ── Friends ───────────────────────────────────────────────── */
  const renderFriends = () => (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between text-xs text-white/50">
        <span className="uppercase tracking-wider">Friends</span>
        <span>{friends.length} total</span>
      </div>
      {friends.length === 0 && (
        <p className="text-center text-white/30 text-xs py-6">No friends yet</p>
      )}
      <div className="divide-y divide-white/5">
        {friends.map(f => (
          <div key={f.id} className="flex items-center gap-3 py-2">
            <div className="relative">
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/60">
                {f.name.charAt(0)}
              </div>
              <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-black ${f.online ? 'bg-green-400' : 'bg-gray-500'}`} />
            </div>
            <span className="text-sm text-white/80">{f.name}</span>
            <span className={`text-[10px] ml-auto ${f.online ? 'text-green-400' : 'text-white/30'}`}>
              {f.online ? 'Online' : 'Offline'}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-center gap-6 text-xs text-white/50 pt-2">
        <div className="text-center">
          <span className="block text-white font-medium text-sm">{profile.followerCount}</span>
          Followers
        </div>
        <div className="text-center">
          <span className="block text-white font-medium text-sm">{profile.followingCount}</span>
          Following
        </div>
      </div>
    </div>
  );

  /* ── Visitor Log ───────────────────────────────────────────── */
  const renderVisitors = () => (
    <div className="p-4 space-y-3">
      <h4 className="text-xs text-white/50 uppercase tracking-wider">Visitor Log</h4>
      {visitorLog.length === 0 ? (
        <p className="text-center text-white/30 text-xs py-6">No visitors recorded</p>
      ) : (
        <div className="divide-y divide-white/5">
          {visitorLog.map(v => (
            <div key={v.id} className="flex items-center gap-3 py-2">
              <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/60">
                {v.playerName.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm text-white/80 block">{v.playerName}</span>
                {v.inspected && (
                  <span className="text-[10px] text-white/40 flex items-center gap-1">
                    <Eye size={9} /> Inspected: {v.inspected}
                  </span>
                )}
              </div>
              <span className="text-[10px] text-white/30 shrink-0">{v.timestamp}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  /* ── Main Render ─────────────────────────────────────────────── */
  return (
    <div className="flex flex-col gap-3 w-full max-w-md">
      {/* Profile header */}
      <div className={`${panel} p-4`}>
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center text-2xl font-bold text-white/50 shrink-0">
            {profile.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatar} alt={profile.displayName} className="w-full h-full rounded-full object-cover" />
            ) : (
              profile.displayName.charAt(0)
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-semibold text-lg">{profile.displayName}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-white/60">{profile.profession}</span>
              {profile.firmName && (
                <span className="text-xs text-white/40 flex items-center gap-1">
                  <Shield size={10} /> {profile.firmName}
                </span>
              )}
            </div>

            {/* Follow / friend / message counts */}
            <div className="flex items-center gap-3 mt-2 text-xs text-white/50">
              <span><span className="text-white font-medium">{profile.followerCount}</span> followers</span>
              <span><span className="text-white font-medium">{profile.followingCount}</span> following</span>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        {!isOwnProfile && (
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleFollow}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                following
                  ? 'bg-cyan-600/30 text-cyan-400 border border-cyan-500/30'
                  : 'bg-cyan-600/80 hover:bg-cyan-500 text-white'
              }`}
            >
              {following ? <><UserCheck size={12} /> Following</> : <><Heart size={12} /> Follow</>}
            </button>
            <button
              onClick={() => onMessage?.(profile.id)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-blue-600/80 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
            >
              <MessageSquare size={12} /> Message
            </button>
            <button
              onClick={handleAddFriend}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                friend
                  ? 'bg-green-600/30 text-green-400 border border-green-500/30'
                  : 'bg-white/10 hover:bg-white/20 text-white/70'
              }`}
            >
              {friend ? <UserCheck size={12} /> : <UserPlus size={12} />}
            </button>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className={`${panel} p-1 flex gap-1`}>
        {([
          { key: 'overview', label: 'Overview' },
          { key: 'portfolio', label: 'Portfolio' },
          { key: 'badges', label: 'Badges' },
          { key: 'friends', label: 'Friends' },
          ...(isOwnProfile ? [{ key: 'visitors' as const, label: 'Visitors' }] : []),
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key as typeof activeTab)}
            className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
              activeTab === t.key ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/70'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className={`${panel}`}>
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'portfolio' && renderPortfolio()}
        {activeTab === 'badges' && renderBadges()}
        {activeTab === 'friends' && renderFriends()}
        {activeTab === 'visitors' && renderVisitors()}
      </div>
    </div>
  );
}
