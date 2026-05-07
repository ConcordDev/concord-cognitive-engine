'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState, useMemo } from 'react';
import { useUIStore } from '@/store/ui';
import { motion, AnimatePresence } from 'framer-motion';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import {
  Brain, Share2, Edit3, Plus, Play, Sparkles, Compass,
  Palette, Trophy, Star, TrendingUp, Users, Heart,
  Clock, Target, Zap, Award, ShoppingBag, Calendar,
  MapPin, ExternalLink, Filter, GripVertical,
  Lightbulb, BarChart3, Flame, ChevronRight, Layers, ChevronDown, Eye,
  Map, Gauge, ClipboardCheck, UserCircle, Loader2, AlertTriangle,
  CheckCircle2, XCircle, Activity, Smile, Frown, Meh
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

// --- Types ---

type TabId = 'portfolio' | 'skills' | 'history' | 'insights';
type PortfolioFilter = 'all' | 'projects' | 'releases' | 'art' | 'collaborations';
type PortfolioItemType = 'project' | 'release' | 'art' | 'collaboration';

interface PortfolioItem {
  id: string;
  type: PortfolioItemType;
  title: string;
  subtitle: string;
  coverGradient: string;
  playCount?: number;
  itemCount?: number;
  medium?: string;
  genre: string;
  date: string;
  featured: boolean;
}

interface SkillData {
  id: string;
  name: string;
  category: 'technical' | 'creative' | 'business';
  level: number;
  maxLevel: number;
  xp: number;
  xpToNext: number;
  endorsements: number;
  linkedLens: string;
}

interface HistoryItem {
  id: string;
  type: 'project_created' | 'session_joined' | 'goal_completed' | 'skill_leveled' | 'item_sold';
  title: string;
  description: string;
  timestamp: string;
  group: 'today' | 'this_week' | 'this_month' | 'earlier';
}

interface InsightData {
  mostProductiveDay: string;
  favoriteGenre: string;
  collaborationScore: number;
  recommendations: string[];
  weeklyHeatmap: number[][];
}

// --- Initial state — populated from backend ---

const PROFILE = {
  name: '',
  bio: '',
  location: '',
  genres: [] as string[],
  stats: { projects: 0, collaborations: 0, sales: 0, followers: 0 },
  socials: [] as { label: string; url: string }[],
};

const INITIAL_PORTFOLIO: PortfolioItem[] = [];

const SEED_SKILLS: SkillData[] = [];

const INITIAL_HISTORY: HistoryItem[] = [];

// InsightData is now computed reactively — see computedInsights in the component

// --- Radar Chart Helper ---

function radarPoints(skills: SkillData[], radius: number, cx: number, cy: number): string {
  const count = skills.length;
  if (count === 0) return '';
  return skills
    .map((s, i) => {
      const angle = (Math.PI * 2 * i) / count - Math.PI / 2;
      const r = (s.level / s.maxLevel) * radius;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function radarGridPoints(level: number, maxLevel: number, count: number, radius: number, cx: number, cy: number): string {
  return Array.from({ length: count })
    .map((_, i) => {
      const angle = (Math.PI * 2 * i) / count - Math.PI / 2;
      const r = (level / maxLevel) * radius;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function radarLabelPos(index: number, count: number, radius: number, cx: number, cy: number): { x: number; y: number } {
  const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
  return {
    x: cx + (radius + 18) * Math.cos(angle),
    y: cy + (radius + 18) * Math.sin(angle),
  };
}

// --- Heatmap helpers ---

const HEAT_COLORS = [
  'bg-gray-800',
  'bg-emerald-900/60',
  'bg-emerald-700/60',
  'bg-emerald-500/70',
  'bg-emerald-400/80',
  'bg-emerald-300',
];

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// --- History icon mapping ---

function historyIcon(type: HistoryItem['type']) {
  switch (type) {
    case 'project_created': return <Sparkles className="w-4 h-4 text-neon-purple" />;
    case 'session_joined': return <Users className="w-4 h-4 text-neon-cyan" />;
    case 'goal_completed': return <Target className="w-4 h-4 text-neon-green" />;
    case 'skill_leveled': return <TrendingUp className="w-4 h-4 text-neon-yellow" />;
    case 'item_sold': return <ShoppingBag className="w-4 h-4 text-pink-400" />;
  }
}

function groupLabel(group: HistoryItem['group']): string {
  switch (group) {
    case 'today': return 'Today';
    case 'this_week': return 'This Week';
    case 'this_month': return 'This Month';
    case 'earlier': return 'Earlier';
  }
}

// --- Category color ---

function categoryColor(cat: SkillData['category']): string {
  switch (cat) {
    case 'technical': return 'text-neon-cyan';
    case 'creative': return 'text-neon-purple';
    case 'business': return 'text-neon-yellow';
  }
}

function categoryBg(cat: SkillData['category']): string {
  switch (cat) {
    case 'technical': return 'bg-neon-cyan/20 text-neon-cyan';
    case 'creative': return 'bg-neon-purple/20 text-neon-purple';
    case 'business': return 'bg-neon-yellow/20 text-neon-yellow';
  }
}

// --- Portfolio type badge ---

function typeBadge(type: PortfolioItemType): { label: string; color: string } {
  switch (type) {
    case 'project': return { label: 'Project', color: 'bg-blue-500/20 text-blue-400' };
    case 'release': return { label: 'Release', color: 'bg-purple-500/20 text-purple-400' };
    case 'art': return { label: 'Art', color: 'bg-pink-500/20 text-pink-400' };
    case 'collaboration': return { label: 'Collab', color: 'bg-green-500/20 text-green-400' };
  }
}

// --- Animations ---

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
};

const staggerParent = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.08 } },
};

const staggerChild = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

// =====================================================================
// Main Component
// =====================================================================

export default function ExperienceLensPage() {
  useLensNav('experience');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('experience');

  const [activeTab, setActiveTab] = useState<TabId>('portfolio');
  const [portfolioFilter, setPortfolioFilter] = useState<PortfolioFilter>('all');
  const [showFeatures, setShowFeatures] = useState(true);
  const [expActionResult, setExpActionResult] = useState<Record<string, unknown> | null>(null);
  const [expRunning, setExpRunning] = useState<string | null>(null);
  const [activeExpAction, setActiveExpAction] = useState<string | null>(null);

  // Backend action runner
  const runExpAction = useRunArtifact('experience');
  const { items: expArtifacts } = useLensData<Record<string, unknown>>('experience', 'experience', { seed: [] });

  const handleExpAction = async (action: string) => {
    const targetId = expArtifacts[0]?.id;
    if (!targetId) return;
    setExpRunning(action);
    setActiveExpAction(action);
    setExpActionResult(null);
    try {
      const res = await runExpAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setExpActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setExpActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Experience action ${action} failed:`, e); setExpActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setExpRunning(null);
  };

  const { isLoading, isError: isError, error: error, refetch: refetch, items: portfolioItems } = useLensData('experience', 'portfolio', {
    seed: INITIAL_PORTFOLIO.map(p => ({ title: p.title, data: p as unknown as Record<string, unknown> })),
  });
  const { isError: isError2, error: error2, refetch: refetch2, items: skillItems } = useLensData('experience', 'skill', {
    seed: SEED_SKILLS.map(s => ({ title: s.name, data: s as unknown as Record<string, unknown> })),
  });
  const { isError: isError3, error: error3, refetch: refetch3, items: historyItems } = useLensData('experience', 'history', {
    seed: INITIAL_HISTORY.map(h => ({ title: h.title, data: h as unknown as Record<string, unknown> })),
  });

  // Derive live data from backend items
  const portfolio: PortfolioItem[] = useMemo(() =>
    portfolioItems.map(i => i.data as unknown as PortfolioItem),
    [portfolioItems]
  );
  const skills: SkillData[] = useMemo(() =>
    skillItems.map(i => i.data as unknown as SkillData),
    [skillItems]
  );
  const history: HistoryItem[] = useMemo(() =>
    historyItems.map(i => i.data as unknown as HistoryItem),
    [historyItems]
  );

  // Fetch real data in background for future use
  useQuery({
    queryKey: ['experience-status'],
    queryFn: () => apiHelpers.experience.status().then((r) => r.data),
    refetchInterval: 15000,
  });

  // --- Derived data ---

  const filteredPortfolio = useMemo(() => {
    if (portfolioFilter === 'all') return portfolio;
    if (portfolioFilter === 'collaborations') return portfolio.filter((p) => p.type === 'collaboration');
    return portfolio.filter((p) => p.type === portfolioFilter.slice(0, -1) as PortfolioItemType);
  }, [portfolioFilter, portfolio]);

  const groupedHistory = useMemo(() => {
    const groups: Record<string, HistoryItem[]> = {};
    for (const item of history) {
      if (!groups[item.group]) groups[item.group] = [];
      groups[item.group].push(item);
    }
    return groups;
  }, [history]);

  const skillsByCategory = useMemo(() => {
    const cats: Record<string, SkillData[]> = { technical: [], creative: [], business: [] };
    for (const s of skills) {
      cats[s.category].push(s);
    }
    return cats;
  }, [skills]);

  // --- Computed insights derived from portfolio + history ---
  const computedInsights = useMemo((): InsightData => {
    // mostProductiveDay: count history items per day-of-week using their timestamp
    const dayCounts: Record<string, number> = {};
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (const item of history) {
      if (item.timestamp) {
        const parsed = new Date(item.timestamp);
        if (!isNaN(parsed.getTime())) {
          const dayName = dayNames[parsed.getDay()];
          dayCounts[dayName] = (dayCounts[dayName] || 0) + 1;
        }
      }
    }
    // If timestamps aren't parseable dates, fall back to group-based counting
    if (Object.keys(dayCounts).length === 0) {
      for (const item of history) {
        // Use the group as a rough proxy
        const group = item.group || 'unknown';
        dayCounts[group] = (dayCounts[group] || 0) + 1;
      }
    }
    let mostProductiveDay = '';
    if (Object.keys(dayCounts).length > 0) {
      mostProductiveDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0][0];
    }

    // favoriteGenre: count genres from portfolio items
    const genreCounts: Record<string, number> = {};
    for (const item of portfolio) {
      if (item.genre) {
        genreCounts[item.genre] = (genreCounts[item.genre] || 0) + 1;
      }
    }
    let favoriteGenre = '';
    if (Object.keys(genreCounts).length > 0) {
      favoriteGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0][0];
    }

    // collaborationScore: percentage of portfolio items that are collaborations
    const collaborationScore = portfolio.length > 0
      ? Math.round((portfolio.filter(p => p.type === 'collaboration').length / portfolio.length) * 100)
      : 0;

    // weeklyHeatmap: 7 days x variable weeks, derived from history timestamps
    // Build a grid of day-of-week (0-6) x week-index
    const weeklyHeatmap: number[][] = [];
    if (history.length > 0) {
      const dated: { day: number; weekOffset: number }[] = [];
      const now = new Date();
      for (const item of history) {
        if (item.timestamp) {
          const parsed = new Date(item.timestamp);
          if (!isNaN(parsed.getTime())) {
            const dayOfWeek = parsed.getDay(); // 0=Sun, 6=Sat -> remap to Mon=0
            const mondayDay = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
            const diffDays = Math.floor((now.getTime() - parsed.getTime()) / (1000 * 60 * 60 * 24));
            const weekOffset = Math.floor(diffDays / 7);
            dated.push({ day: mondayDay, weekOffset });
          }
        }
      }
      if (dated.length > 0) {
        const maxWeeks = Math.min(Math.max(...dated.map(d => d.weekOffset)) + 1, 8);
        for (let day = 0; day < 7; day++) {
          const row: number[] = [];
          for (let week = 0; week < maxWeeks; week++) {
            const count = dated.filter(d => d.day === day && d.weekOffset === week).length;
            // Normalize to heatmap index 0-5
            row.push(Math.min(count, 5));
          }
          weeklyHeatmap.push(row);
        }
      }
    }

    // recommendations: derive from data patterns
    const recommendations: string[] = [];
    if (portfolio.length === 0 && history.length === 0) {
      recommendations.push('Add your first portfolio item to start tracking your creative journey.');
    } else {
      if (portfolio.length > 0 && portfolio.filter(p => p.type === 'collaboration').length === 0) {
        recommendations.push('Try collaborating with another creator to diversify your portfolio.');
      }
      if (portfolio.length > 0 && Object.keys(genreCounts).length === 1) {
        recommendations.push('Experiment with a new genre to broaden your creative range.');
      }
      if (portfolio.length > 0 && Object.keys(genreCounts).length > 2) {
        recommendations.push(`You work across ${Object.keys(genreCounts).length} genres — consider deepening your ${favoriteGenre} skills.`);
      }
      if (skills.length > 0) {
        const lowest = [...skills].sort((a, b) => a.level - b.level)[0];
        if (lowest && lowest.level < 5) {
          recommendations.push(`Level up your ${lowest.name} skill — it's your biggest growth opportunity.`);
        }
      }
      if (history.length < 5) {
        recommendations.push('Keep building! Add more work to unlock deeper activity insights.');
      }
      // Always cap at 4 recommendations
      if (recommendations.length === 0) {
        recommendations.push('Great progress! Keep creating to unlock new insights.');
      }
    }

    return {
      mostProductiveDay,
      favoriteGenre,
      collaborationScore,
      weeklyHeatmap,
      recommendations: recommendations.slice(0, 4),
    };
  }, [portfolio, history, skills]);

  const TABS: { id: TabId; label: string }[] = [
    { id: 'portfolio', label: 'Portfolio' },
    { id: 'skills', label: 'Skills' },
    { id: 'history', label: 'History' },
    { id: 'insights', label: 'Insights' },
  ];

  const FILTERS: { id: PortfolioFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'projects', label: 'Projects' },
    { id: 'releases', label: 'Releases' },
    { id: 'art', label: 'Art' },
    { id: 'collaborations', label: 'Collaborations' },
  ];

  // --- Radar chart config ---
  const radarCx = 140;
  const radarCy = 140;
  const radarR = 100;
  const gridLevels = [2, 4, 6, 8, 10];


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

  if (isError || isError2 || isError3) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message || error3?.message} onRetry={() => { refetch(); refetch2(); refetch3(); }} />
      </div>
    );
  }
  return (
    <div data-lens-theme="experience" className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* ========== Header ========== */}
      <motion.header
        className="flex items-center justify-between"
        initial="hidden"
        animate="visible"
        variants={fadeUp}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-cyan-400 flex items-center justify-center">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Creative Portfolio</h1>
            <p className="text-sm text-gray-400">Showcase your work, measure your growth</p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="experience" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <button onClick={() => { navigator.clipboard.writeText(window.location.href); useUIStore.getState().addToast({ type: 'success', message: 'Portfolio link copied!' }); }} className="btn-neon purple flex items-center gap-2 text-sm">
          <Share2 className="w-4 h-4" />
          Share Portfolio
        </button>
      </motion.header>

      {/* ========== Profile Section ========== */}
      <motion.section
        className="panel p-6"
        initial="hidden"
        animate="visible"
        variants={fadeUp}
      >
        <div className="flex flex-col md:flex-row gap-6">
          {/* Avatar */}
          <div className="flex-shrink-0 flex flex-col items-center gap-3">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-purple-500 via-cyan-400 to-pink-500 p-0.5">
              <div className="w-full h-full rounded-full bg-lattice-deep flex items-center justify-center text-3xl font-bold text-white">
                AR
              </div>
            </div>
            <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Profile editor opening...' })} className="btn-neon text-xs flex items-center gap-1 px-3 py-1.5">
              <Edit3 className="w-3 h-3" />
              Edit Profile
            </button>
          </div>

          {/* Info */}
          <div className="flex-1 space-y-3">
            <div>
              <h2 className="text-lg font-bold">{PROFILE.name}</h2>
              <p className="text-sm text-gray-400">{PROFILE.bio}</p>
              <p className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                <MapPin className="w-3 h-3" />
                {PROFILE.location}
              </p>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Projects Created', value: PROFILE.stats.projects, icon: Sparkles },
                { label: 'Collaborations', value: PROFILE.stats.collaborations, icon: Users },
                { label: 'Sales', value: PROFILE.stats.sales, icon: ShoppingBag },
                { label: 'Followers', value: PROFILE.stats.followers.toLocaleString(), icon: Heart },
              ].map((stat) => (
                <div key={stat.label} className="lens-card text-center py-2">
                  <stat.icon className="w-4 h-4 mx-auto mb-1 text-gray-400" />
                  <p className="text-lg font-bold">{stat.value}</p>
                  <p className="text-xs text-gray-500">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Genre tags */}
            <div className="flex flex-wrap gap-2">
              {PROFILE.genres.map((g) => (
                <span key={g} className="px-2.5 py-1 rounded-full text-xs bg-neon-purple/15 text-neon-purple border border-neon-purple/20">
                  {g}
                </span>
              ))}
            </div>

            {/* Social links */}
            <div className="flex gap-3">
              {PROFILE.socials.map((s) => (
                <a key={s.label} href={s.url} className="text-xs text-gray-400 hover:text-white flex items-center gap-1 transition-colors">
                  <ExternalLink className="w-3 h-3" />
                  {s.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </motion.section>

      {/* ========== Tab Navigation ========== */}
      <div className="flex gap-1 border-b border-lattice-border">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
              activeTab === tab.id
                ? 'text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <motion.div
                layoutId="activeTab"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-purple-500 to-cyan-400"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
          </button>
        ))}
      </div>

      {/* ========== Tab Content ========== */}
      <AnimatePresence mode="wait">
        {/* ---------- Portfolio Tab ---------- */}
        {activeTab === 'portfolio' && (
          <motion.div
            key="portfolio"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={fadeUp}
            className="space-y-4"
          >
            {/* Filter row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-400" />
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setPortfolioFilter(f.id)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      portfolioFilter === f.id
                        ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/30'
                        : 'text-gray-400 hover:text-gray-200 border border-transparent'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Add new portfolio item via the creative lens' })} className="btn-neon purple text-xs flex items-center gap-1">
                <Plus className="w-3 h-3" />
                Add to Portfolio
              </button>
            </div>

            {/* Portfolio grid */}
            <motion.div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
              variants={staggerParent}
              initial="hidden"
              animate="visible"
            >
              {filteredPortfolio.map((item) => {
                const badge = typeBadge(item.type);
                return (
                  <motion.div
                    key={item.id}
                    variants={staggerChild}
                    whileHover={{ y: -4, transition: { duration: 0.2 } }}
                    className="lens-card group cursor-pointer overflow-hidden"
                  >
                    {/* Cover art gradient */}
                    <div className={`relative h-36 rounded-lg mb-3 bg-gradient-to-br ${item.coverGradient} flex items-center justify-center overflow-hidden`}>
                      <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors" />
                      {item.type === 'project' || item.type === 'collaboration' ? (
                        <Play className="w-10 h-10 text-white/80 drop-shadow-lg group-hover:scale-110 transition-transform" />
                      ) : item.type === 'release' ? (
                        <Compass className="w-10 h-10 text-white/80 drop-shadow-lg group-hover:rotate-90 transition-transform duration-500" />
                      ) : (
                        <Palette className="w-10 h-10 text-white/80 drop-shadow-lg" />
                      )}
                      {item.featured && (
                        <div className="absolute top-2 right-2">
                          <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                        </div>
                      )}
                      <div className="absolute top-2 left-2">
                        <GripVertical className="w-4 h-4 text-white/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold truncate">{item.title}</h3>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${badge.color}`}>
                          {badge.label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400">{item.subtitle}</p>
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span>{item.genre}</span>
                        {item.playCount !== undefined && (
                          <span className="flex items-center gap-1">
                            <Play className="w-3 h-3" />
                            {item.playCount.toLocaleString()}
                          </span>
                        )}
                        {item.itemCount !== undefined && (
                          <span>{item.itemCount} items</span>
                        )}
                        {item.medium !== undefined && (
                          <span>{item.medium}</span>
                        )}
                      </div>
                      <p className="text-[10px] text-gray-600">{item.date}</p>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          </motion.div>
        )}

        {/* ---------- Skills Tab ---------- */}
        {activeTab === 'skills' && (
          <motion.div
            key="skills"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={fadeUp}
            className="space-y-6"
          >
            {/* Radar Chart + Skill bars side by side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* SVG Radar Chart */}
              <div className="panel p-4 flex flex-col items-center">
                <h3 className="text-sm font-semibold mb-3 self-start">Skill Radar</h3>
                <svg width="280" height="280" viewBox="0 0 280 280" className="overflow-visible">
                  {/* Grid rings */}
                  {gridLevels.map((lv) => (
                    <polygon
                      key={lv}
                      points={radarGridPoints(lv, 10, skills.length, radarR, radarCx, radarCy)}
                      fill="none"
                      stroke="rgba(255,255,255,0.08)"
                      strokeWidth="1"
                    />
                  ))}
                  {/* Axis lines */}
                  {skills.map((_, i) => {
                    const angle = (Math.PI * 2 * i) / skills.length - Math.PI / 2;
                    const ex = radarCx + radarR * Math.cos(angle);
                    const ey = radarCy + radarR * Math.sin(angle);
                    return (
                      <line
                        key={i}
                        x1={radarCx}
                        y1={radarCy}
                        x2={ex}
                        y2={ey}
                        stroke="rgba(255,255,255,0.06)"
                        strokeWidth="1"
                      />
                    );
                  })}
                  {/* Filled area */}
                  <motion.polygon
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                    style={{ transformOrigin: `${radarCx}px ${radarCy}px` }}
                    points={radarPoints(skills, radarR, radarCx, radarCy)}
                    fill="rgba(168, 85, 247, 0.25)"
                    stroke="rgba(168, 85, 247, 0.8)"
                    strokeWidth="2"
                  />
                  {/* Dots at vertices */}
                  {skills.map((s, i) => {
                    const angle = (Math.PI * 2 * i) / skills.length - Math.PI / 2;
                    const r = (s.level / s.maxLevel) * radarR;
                    const dx = radarCx + r * Math.cos(angle);
                    const dy = radarCy + r * Math.sin(angle);
                    return (
                      <circle key={s.id} cx={dx} cy={dy} r="4" fill="#a855f7" stroke="white" strokeWidth="1.5" />
                    );
                  })}
                  {/* Labels */}
                  {skills.map((s, i) => {
                    const pos = radarLabelPos(i, skills.length, radarR, radarCx, radarCy);
                    return (
                      <text
                        key={s.id}
                        x={pos.x}
                        y={pos.y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="text-[10px] fill-gray-400"
                      >
                        {s.name}
                      </text>
                    );
                  })}
                </svg>
              </div>

              {/* Individual skill bars */}
              <div className="panel p-4 space-y-4">
                <h3 className="text-sm font-semibold">Skill Levels</h3>
                <motion.div className="space-y-3" variants={staggerParent} initial="hidden" animate="visible">
                  {skills.map((skill) => (
                    <motion.div key={skill.id} variants={staggerChild} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{skill.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${categoryBg(skill.category)}`}>
                            {skill.category}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-400">
                          <span className="flex items-center gap-1">
                            <Award className="w-3 h-3" />
                            {skill.endorsements}
                          </span>
                          <span className="font-medium text-white">Lv {skill.level}</span>
                        </div>
                      </div>
                      <div className="h-2 bg-lattice-deep rounded-full overflow-hidden">
                        <motion.div
                          className="h-full rounded-full bg-gradient-to-r from-purple-500 to-cyan-400"
                          initial={{ width: 0 }}
                          animate={{ width: `${(skill.level / skill.maxLevel) * 100}%` }}
                          transition={{ duration: 0.6, delay: 0.1, ease: 'easeOut' }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-gray-500">
                        <span>{skill.xp} / {skill.xpToNext} XP to next level</span>
                        <a href={`/lenses/${skill.linkedLens}`} className="flex items-center gap-0.5 text-neon-cyan hover:underline">
                          Practice <ChevronRight className="w-3 h-3" />
                        </a>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              </div>
            </div>

            {/* Skill categories */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(['technical', 'creative', 'business'] as const).map((cat) => (
                <div key={cat} className="panel p-4">
                  <h4 className={`text-sm font-semibold capitalize mb-3 ${categoryColor(cat)}`}>
                    {cat === 'technical' ? 'Technical' : cat === 'creative' ? 'Creative' : 'Business'}
                  </h4>
                  <div className="space-y-2">
                    {(cat === 'technical'
                      ? ['DAW Proficiency', 'Mixing', 'Mastering']
                      : cat === 'creative'
                      ? ['Composition', 'Arrangement', 'Sound Design']
                      : ['Marketing', 'Networking', 'Branding']
                    ).map((subSkill) => {
                      const matched = skillsByCategory[cat].find(
                        (s) => s.name.toLowerCase() === subSkill.toLowerCase()
                      );
                      const level = matched ? matched.level : 1;
                      return (
                        <div key={subSkill} className="flex items-center justify-between text-xs">
                          <span className="text-gray-300">{subSkill}</span>
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-1.5 bg-lattice-deep rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  cat === 'technical'
                                    ? 'bg-neon-cyan'
                                    : cat === 'creative'
                                    ? 'bg-neon-purple'
                                    : 'bg-neon-yellow'
                                }`}
                                style={{ width: `${(level / 10) * 100}%` }}
                              />
                            </div>
                            <span className="text-gray-500 w-4 text-right">{level}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* ---------- History Tab ---------- */}
        {activeTab === 'history' && (
          <motion.div
            key="history"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={fadeUp}
            className="space-y-6"
          >
            {(['today', 'this_week', 'this_month', 'earlier'] as const).map((group) => {
              const items = groupedHistory[group];
              if (!items || items.length === 0) return null;
              return (
                <div key={group}>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-2">
                    <Calendar className="w-3 h-3" />
                    {groupLabel(group)}
                  </h3>
                  <motion.div
                    className="relative ml-4 border-l border-lattice-border pl-6 space-y-4"
                    variants={staggerParent}
                    initial="hidden"
                    animate="visible"
                  >
                    {items.map((item) => (
                      <motion.div
                        key={item.id}
                        variants={staggerChild}
                        className="relative"
                      >
                        {/* Timeline dot */}
                        <div className="absolute -left-[33px] top-1 w-6 h-6 rounded-full bg-lattice-deep border border-lattice-border flex items-center justify-center">
                          {historyIcon(item.type)}
                        </div>
                        <div className="lens-card">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="text-sm font-medium">{item.title}</p>
                              <p className="text-xs text-gray-400 mt-0.5">{item.description}</p>
                            </div>
                            <span className="text-[10px] text-gray-500 flex-shrink-0 ml-4 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {item.timestamp}
                            </span>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </motion.div>
                </div>
              );
            })}
          </motion.div>
        )}

        {/* ---------- Insights Tab ---------- */}
        {activeTab === 'insights' && (
          <motion.div
            key="insights"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={fadeUp}
            className="space-y-6"
          >
            {/* Top stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="lens-card text-center py-4">
                <Flame className="w-6 h-6 mx-auto mb-2 text-orange-400" />
                <p className="text-lg font-bold">
                  {computedInsights.mostProductiveDay || <span className="text-gray-500 text-sm font-normal">Add history to see</span>}
                </p>
                <p className="text-xs text-gray-400">Most Productive Day</p>
              </div>
              <div className="lens-card text-center py-4">
                <Eye className="w-6 h-6 mx-auto mb-2 text-neon-purple" />
                <p className="text-lg font-bold">
                  {computedInsights.favoriteGenre || <span className="text-gray-500 text-sm font-normal">Add items to see</span>}
                </p>
                <p className="text-xs text-gray-400">Favorite Genre</p>
              </div>
              <div className="lens-card text-center py-4">
                <Users className="w-6 h-6 mx-auto mb-2 text-neon-cyan" />
                <p className="text-lg font-bold">
                  {portfolio.length > 0
                    ? `${computedInsights.collaborationScore}%`
                    : <span className="text-gray-500 text-sm font-normal">Add items to see</span>}
                </p>
                <p className="text-xs text-gray-400">Collaboration Score</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Weekly Activity Heatmap */}
              <div className="panel p-4">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-neon-green" />
                  Weekly Activity Heatmap
                </h3>
                {computedInsights.weeklyHeatmap.length > 0 ? (
                  <div className="space-y-1.5">
                    {computedInsights.weeklyHeatmap.map((row, dayIdx) => (
                      <div key={dayIdx} className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500 w-7">{DAY_LABELS[dayIdx]}</span>
                        <div className="flex gap-1.5">
                          {row.map((val, weekIdx) => (
                            <motion.div
                              key={weekIdx}
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              transition={{ delay: dayIdx * 0.04 + weekIdx * 0.06, duration: 0.2 }}
                              className={`w-8 h-8 rounded-md ${HEAT_COLORS[val]} border border-white/5`}
                              title={`Week ${weekIdx + 1}: ${val} sessions`}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 mt-3 ml-9">
                      <span className="text-[10px] text-gray-500">Less</span>
                      {HEAT_COLORS.map((c, i) => (
                        <div key={i} className={`w-4 h-4 rounded-sm ${c} border border-white/5`} />
                      ))}
                      <span className="text-[10px] text-gray-500">More</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <Calendar className="w-8 h-8 text-gray-600 mb-2" />
                    <p className="text-sm text-gray-400">Add more history items to see your activity heatmap</p>
                  </div>
                )}
              </div>

              {/* Recommendations */}
              <div className="panel p-4">
                <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-neon-yellow" />
                  Learning Recommendations
                </h3>
                <motion.div
                  className="space-y-3"
                  variants={staggerParent}
                  initial="hidden"
                  animate="visible"
                >
                  {computedInsights.recommendations.map((rec, i) => (
                    <motion.div
                      key={i}
                      variants={staggerChild}
                      className="flex items-start gap-3 lens-card"
                    >
                      <div className="w-6 h-6 rounded-full bg-neon-yellow/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Zap className="w-3 h-3 text-neon-yellow" />
                      </div>
                      <p className="text-sm text-gray-300 leading-relaxed">{rec}</p>
                    </motion.div>
                  ))}
                </motion.div>
              </div>
            </div>

            {/* Additional insight cards — derived from real data */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="lens-card">
                <Trophy className="w-5 h-5 text-neon-yellow mb-2" />
                <p className="text-sm font-semibold">
                  {skills.length > 0
                    ? `${Math.max(...skills.map(s => s.level))} / ${Math.max(...skills.map(s => s.maxLevel))}`
                    : 'No skills yet'}
                </p>
                <p className="text-xs text-gray-400">
                  {skills.length > 0 ? 'Highest skill level' : 'Add skills to track progress'}
                </p>
              </div>
              <div className="lens-card">
                <TrendingUp className="w-5 h-5 text-neon-green mb-2" />
                <p className="text-sm font-semibold">
                  {portfolio.length > 0 ? `${portfolio.length} items` : 'No items yet'}
                </p>
                <p className="text-xs text-gray-400">
                  {portfolio.length > 0 ? 'Total portfolio pieces' : 'Add work to your portfolio'}
                </p>
              </div>
              <div className="lens-card">
                <Target className="w-5 h-5 text-neon-cyan mb-2" />
                <p className="text-sm font-semibold">
                  {history.length > 0 ? `${history.length} events` : 'No activity yet'}
                </p>
                <p className="text-xs text-gray-400">
                  {history.length > 0 ? 'Total history events' : 'Activity will appear here'}
                </p>
              </div>
              <div className="lens-card">
                <Star className="w-5 h-5 text-pink-400 mb-2" />
                <p className="text-sm font-semibold">
                  {skills.length > 0
                    ? `${skills.reduce((sum, s) => sum + s.endorsements, 0)} endorsements`
                    : 'No endorsements yet'}
                </p>
                <p className="text-xs text-gray-400">
                  {skills.length > 0 ? 'Total skill endorsements' : 'Endorsements will appear here'}
                </p>
              </div>

      {/* Real-time Data Panel */}
      <UniversalActions domain="experience" artifactId={null} compact />
      {realtimeData && (
        <RealtimeDataPanel
          domain="experience"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Experience Domain Actions ────────────────────────────────────── */}
      <div className="panel p-4 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Activity className="w-4 h-4 text-neon-purple" />
          Experience Domain Actions
        </h2>
        <p className="text-xs text-gray-400">
          Run UX analysis actions on the first experience artifact in this lens.
        </p>
        <div className="flex flex-wrap gap-3">
          {[
            { action: 'journeyMap', label: 'Journey Map', icon: Map, color: 'cyan' },
            { action: 'usabilityScore', label: 'Usability Score', icon: Gauge, color: 'purple' },
            { action: 'heuristicEval', label: 'Heuristic Eval', icon: ClipboardCheck, color: 'green' },
            { action: 'personaBuilder', label: 'Persona Builder', icon: UserCircle, color: 'pink' },
          ].map(({ action, label, icon: Icon, color }) => (
            <button
              key={action}
              onClick={() => handleExpAction(action)}
              disabled={!!expRunning || expArtifacts.length === 0}
              className={`btn-neon ${color} flex items-center gap-2 text-sm`}
            >
              {expRunning === action ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Icon className="w-4 h-4" />
              )}
              {label}
            </button>
          ))}
        </div>
        {expArtifacts.length === 0 && (
          <p className="text-xs text-yellow-400/70 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            No artifacts found. Create an experience artifact first.
          </p>
        )}

        {/* ── Action Results ─────────────────────────────────────────────── */}
        {expActionResult && activeExpAction === 'journeyMap' && (
          <JourneyMapResult result={expActionResult} />
        )}
        {expActionResult && activeExpAction === 'usabilityScore' && (
          <UsabilityScoreResult result={expActionResult} />
        )}
        {expActionResult && activeExpAction === 'heuristicEval' && (
          <HeuristicEvalResult result={expActionResult} />
        )}
        {expActionResult && activeExpAction === 'personaBuilder' && (
          <PersonaBuilderResult result={expActionResult} />
        )}
      </div>

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
            <LensFeaturePanel lensId="experience" />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Journey Map Result ────────────────────────────────────────────────────

function JourneyMapResult({ result }: { result: Record<string, unknown> }) {
  if (result.message) {
    return (
      <div className="mt-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-sm text-yellow-300">
        {result.message as string}
      </div>
    );
  }

  const stages = result.stages as Array<{
    stage: string;
    touchpoints: string[];
    emotion: string;
    painPoints: string[];
    opportunities: string[];
    satisfactionScore: number;
  }>;
  const totalStages = result.totalStages as number;
  const avgSatisfaction = result.avgSatisfaction as number;
  const lowestPoint = result.lowestPoint as string;
  const totalPainPoints = result.totalPainPoints as number;
  const totalOpportunities = result.totalOpportunities as number;

  const emotionIcon = (e: string) => {
    if (e === 'happy' || e === 'excited' || e === 'delighted') return <Smile className="w-3 h-3 text-neon-green" />;
    if (e === 'frustrated' || e === 'angry' || e === 'sad') return <Frown className="w-3 h-3 text-red-400" />;
    return <Meh className="w-3 h-3 text-yellow-400" />;
  };

  const satisfactionColor = (score: number) =>
    score >= 75 ? 'bg-neon-green' : score >= 50 ? 'bg-yellow-400' : 'bg-red-400';

  const satisfactionText = (score: number) =>
    score >= 75 ? 'text-neon-green' : score >= 50 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center gap-2">
        <Map className="w-4 h-4 text-neon-cyan" />
        <h3 className="font-semibold text-sm">Journey Map</h3>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Stages', value: totalStages, color: 'text-white' },
          { label: 'Avg Satisfaction', value: `${avgSatisfaction}%`, color: avgSatisfaction >= 70 ? 'text-neon-green' : avgSatisfaction >= 50 ? 'text-yellow-400' : 'text-red-400' },
          { label: 'Pain Points', value: totalPainPoints, color: totalPainPoints > 0 ? 'text-red-400' : 'text-neon-green' },
          { label: 'Opportunities', value: totalOpportunities, color: 'text-neon-cyan' },
          { label: 'Lowest Point', value: lowestPoint || '—', color: 'text-yellow-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-zinc-900 rounded-lg p-3 border border-zinc-800 text-center">
            <p className={`text-sm font-bold truncate ${color}`}>{value}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Journey stages */}
      {stages?.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase text-gray-400">Journey Stages</h4>
          <div className="space-y-3">
            {stages.map((s, i) => (
              <div key={i} className="bg-zinc-900 rounded-lg p-3 border border-zinc-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 font-mono w-5">{i + 1}</span>
                    <span className="text-sm font-medium text-white">{s.stage}</span>
                    {emotionIcon(s.emotion)}
                    <span className="text-[10px] text-gray-500 capitalize">{s.emotion}</span>
                  </div>
                  <span className={`text-sm font-bold ${satisfactionText(s.satisfactionScore)}`}>
                    {s.satisfactionScore}%
                  </span>
                </div>
                {/* Satisfaction bar */}
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${satisfactionColor(s.satisfactionScore)}`}
                    style={{ width: `${s.satisfactionScore}%` }}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2 text-[10px]">
                  {s.touchpoints.length > 0 && (
                    <div>
                      <p className="text-gray-500 mb-1">Touchpoints</p>
                      {s.touchpoints.map((t, j) => (
                        <p key={j} className="text-gray-300">• {t}</p>
                      ))}
                    </div>
                  )}
                  {s.painPoints.length > 0 && (
                    <div>
                      <p className="text-red-400 mb-1">Pain Points</p>
                      {s.painPoints.map((p, j) => (
                        <p key={j} className="text-red-300">• {p}</p>
                      ))}
                    </div>
                  )}
                  {s.opportunities.length > 0 && (
                    <div>
                      <p className="text-neon-green mb-1">Opportunities</p>
                      {s.opportunities.map((o, j) => (
                        <p key={j} className="text-green-300">• {o}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Usability Score Result ────────────────────────────────────────────────

function UsabilityScoreResult({ result }: { result: Record<string, unknown> }) {
  const susScore = result.susScore as number;
  const grade = result.grade as string;
  const taskSuccessRate = result.taskSuccessRate as number;
  const avgTimeSeconds = result.avgTimeSeconds as number;
  const errorCount = result.errorCount as number;
  const satisfactionScore = result.satisfactionScore as number;
  const benchmark = result.benchmark as string;

  const gradeColor = grade === 'A' ? 'text-neon-green' : grade === 'B' ? 'text-cyan-400' : grade === 'C' ? 'text-yellow-400' : 'text-red-400';
  const gradeBg = grade === 'A' ? 'bg-neon-green/10 border-neon-green/20' : grade === 'B' ? 'bg-cyan-400/10 border-cyan-400/20' : grade === 'C' ? 'bg-yellow-400/10 border-yellow-400/20' : 'bg-red-400/10 border-red-400/20';
  const scoreBarColor = susScore >= 80 ? 'bg-neon-green' : susScore >= 68 ? 'bg-cyan-400' : susScore >= 50 ? 'bg-yellow-400' : 'bg-red-400';

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center gap-2">
        <Gauge className="w-4 h-4 text-neon-purple" />
        <h3 className="font-semibold text-sm">Usability Score</h3>
      </div>

      {/* SUS score hero */}
      <div className={`rounded-xl p-5 border ${gradeBg} flex items-center justify-between`}>
        <div>
          <p className="text-xs text-gray-400 mb-1">SUS Score</p>
          <p className={`text-4xl font-bold ${gradeColor}`}>{susScore}</p>
          <p className="text-xs text-gray-500 mt-1">{benchmark}</p>
        </div>
        <div className="text-center">
          <p className={`text-6xl font-bold ${gradeColor}`}>{grade}</p>
          <p className="text-xs text-gray-400 mt-1">Grade</p>
        </div>
      </div>

      {/* SUS bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-gray-500">
          <span>0</span>
          <span className="text-yellow-400">Poor (50)</span>
          <span className="text-cyan-400">Good (68)</span>
          <span className="text-neon-green">Excellent (80+)</span>
          <span>100</span>
        </div>
        <div className="relative h-3 bg-zinc-800 rounded-full overflow-hidden">
          {/* Benchmark marker */}
          <div className="absolute top-0 bottom-0 w-0.5 bg-gray-500/50" style={{ left: '68%' }} />
          <div
            className={`h-full rounded-full ${scoreBarColor} transition-all`}
            style={{ width: `${susScore}%` }}
          />
        </div>
      </div>

      {/* Input metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Task Success', value: `${taskSuccessRate}%`, icon: CheckCircle2, color: taskSuccessRate >= 80 ? 'text-neon-green' : 'text-yellow-400' },
          { label: 'Avg Time (s)', value: avgTimeSeconds, icon: Clock, color: 'text-neon-cyan' },
          { label: 'Errors', value: errorCount, icon: XCircle, color: errorCount === 0 ? 'text-neon-green' : errorCount > 5 ? 'text-red-400' : 'text-yellow-400' },
          { label: 'Satisfaction', value: `${satisfactionScore}%`, icon: Star, color: satisfactionScore >= 70 ? 'text-neon-green' : 'text-yellow-400' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-zinc-900 rounded-lg p-3 border border-zinc-800 flex items-center gap-2">
            <Icon className={`w-4 h-4 shrink-0 ${color}`} />
            <div>
              <p className={`text-sm font-bold ${color}`}>{value}</p>
              <p className="text-[10px] text-gray-500">{label}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Heuristic Eval Result ─────────────────────────────────────────────────

function HeuristicEvalResult({ result }: { result: Record<string, unknown> }) {
  const heuristics = result.heuristics as Array<{
    heuristic: string;
    score: number;
    severity: number;
    notes: string;
    finding: string;
  }>;
  const avgScore = result.avgScore as number;
  const criticalIssues = result.criticalIssues as number;
  const evaluated = result.evaluated as number;
  const total = result.total as number;

  const scoreColor = (s: number) => s >= 7 ? 'text-neon-green' : s >= 4 ? 'text-yellow-400' : 'text-red-400';
  const scoreBar = (s: number) => s >= 7 ? 'bg-neon-green' : s >= 4 ? 'bg-yellow-400' : 'bg-red-400';
  const severityBadge = (sev: number) => {
    if (sev >= 4) return 'bg-red-500/20 text-red-400 border-red-500/30';
    if (sev >= 3) return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    if (sev >= 2) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    if (sev >= 1) return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    return 'bg-zinc-700 text-gray-500 border-zinc-600';
  };
  const severityLabel = (sev: number) => {
    if (sev >= 4) return 'Critical';
    if (sev >= 3) return 'Major';
    if (sev >= 2) return 'Minor';
    if (sev >= 1) return 'Cosmetic';
    return 'None';
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="w-4 h-4 text-neon-green" />
        <h3 className="font-semibold text-sm">Heuristic Evaluation</h3>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800 text-center">
          <p className={`text-2xl font-bold ${avgScore >= 7 ? 'text-neon-green' : avgScore >= 4 ? 'text-yellow-400' : 'text-red-400'}`}>
            {avgScore}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">Avg Score / 10</p>
        </div>
        <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800 text-center">
          <p className={`text-2xl font-bold ${criticalIssues === 0 ? 'text-neon-green' : 'text-red-400'}`}>
            {criticalIssues}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">Critical Issues</p>
        </div>
        <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800 text-center">
          <p className="text-2xl font-bold text-neon-cyan">{evaluated}/{total}</p>
          <p className="text-xs text-gray-400 mt-0.5">Evaluated</p>
        </div>
      </div>

      {/* Heuristics list */}
      {heuristics?.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase text-gray-400">10 Nielsen Heuristics</h4>
          <div className="space-y-2">
            {heuristics.map((h, i) => (
              <div key={i} className={`bg-zinc-900 rounded-lg p-3 border space-y-2 ${h.severity >= 4 ? 'border-red-500/30' : 'border-zinc-800'}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-xs text-gray-500 font-mono w-4 shrink-0">{i + 1}</span>
                    <span className="text-xs font-medium text-white truncate">{h.heuristic}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {h.severity > 0 && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${severityBadge(h.severity)}`}>
                        {severityLabel(h.severity)}
                      </span>
                    )}
                    <span className={`text-sm font-bold ${scoreColor(h.score)}`}>{h.score}/10</span>
                  </div>
                </div>
                {/* Score bar */}
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${scoreBar(h.score)}`}
                    style={{ width: `${(h.score / 10) * 100}%` }}
                  />
                </div>
                {h.finding && (
                  <p className="text-[10px] text-gray-400 leading-relaxed">{h.finding}</p>
                )}
                {h.notes && (
                  <p className="text-[10px] text-gray-500 italic">{h.notes}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Persona Builder Result ────────────────────────────────────────────────

function PersonaBuilderResult({ result }: { result: Record<string, unknown> }) {
  const persona = result.persona as {
    name: string;
    age: string;
    occupation: string;
    goals: string[];
    frustrations: string[];
    behaviors: string[];
    techSavvy: string;
    quote: string;
  };
  const completeness = result.completeness as number;

  const techSavvyColor = (level: string) => {
    switch (level?.toLowerCase()) {
      case 'high': case 'expert': case 'advanced': return 'text-neon-green';
      case 'moderate': case 'medium': return 'text-yellow-400';
      default: return 'text-red-400';
    }
  };

  const completenessBar = completeness >= 80 ? 'bg-neon-green' : completeness >= 50 ? 'bg-yellow-400' : 'bg-red-400';

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center gap-2">
        <UserCircle className="w-4 h-4 text-pink-400" />
        <h3 className="font-semibold text-sm">Persona</h3>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-400">Completeness:</span>
          <span className={`text-xs font-bold ${completeness >= 80 ? 'text-neon-green' : completeness >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
            {completeness}%
          </span>
        </div>
      </div>

      {/* Completeness bar */}
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${completenessBar}`} style={{ width: `${completeness}%` }} />
      </div>

      {persona && (
        <div className="space-y-4">
          {/* Identity card */}
          <div className="bg-zinc-900 rounded-xl p-4 border border-pink-500/20 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center text-white font-bold text-lg">
                {persona.name ? persona.name[0].toUpperCase() : '?'}
              </div>
              <div>
                <h4 className="text-base font-bold text-white">{persona.name || 'Unnamed Persona'}</h4>
                <p className="text-sm text-gray-400">{persona.occupation} · Age {persona.age}</p>
              </div>
              <div className="ml-auto text-right">
                <p className={`text-sm font-bold ${techSavvyColor(persona.techSavvy)}`}>
                  {persona.techSavvy}
                </p>
                <p className="text-[10px] text-gray-500">Tech Savvy</p>
              </div>
            </div>
            {persona.quote && (
              <blockquote className="text-sm text-gray-300 italic border-l-2 border-pink-500/40 pl-3">
                &ldquo;{persona.quote}&rdquo;
              </blockquote>
            )}
          </div>

          {/* Goals / Frustrations / Behaviors */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {persona.goals?.length > 0 && (
              <div className="bg-zinc-900 rounded-lg p-3 border border-neon-green/20 space-y-2">
                <p className="text-xs font-semibold text-neon-green flex items-center gap-1">
                  <Target className="w-3 h-3" />
                  Goals
                </p>
                <ul className="space-y-1">
                  {persona.goals.map((g, i) => (
                    <li key={i} className="text-[11px] text-gray-300 flex gap-1">
                      <span className="text-neon-green shrink-0">•</span>
                      <span>{g}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {persona.frustrations?.length > 0 && (
              <div className="bg-zinc-900 rounded-lg p-3 border border-red-400/20 space-y-2">
                <p className="text-xs font-semibold text-red-400 flex items-center gap-1">
                  <Frown className="w-3 h-3" />
                  Frustrations
                </p>
                <ul className="space-y-1">
                  {persona.frustrations.map((f, i) => (
                    <li key={i} className="text-[11px] text-gray-300 flex gap-1">
                      <span className="text-red-400 shrink-0">•</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {persona.behaviors?.length > 0 && (
              <div className="bg-zinc-900 rounded-lg p-3 border border-neon-cyan/20 space-y-2">
                <p className="text-xs font-semibold text-neon-cyan flex items-center gap-1">
                  <Activity className="w-3 h-3" />
                  Behaviors
                </p>
                <ul className="space-y-1">
                  {persona.behaviors.map((b, i) => (
                    <li key={i} className="text-[11px] text-gray-300 flex gap-1">
                      <span className="text-neon-cyan shrink-0">•</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {persona.goals?.length === 0 && persona.frustrations?.length === 0 && persona.behaviors?.length === 0 && (
            <div className="text-sm text-gray-400 text-center py-3">
              Persona created. Add goals, frustrations, and behaviors to the artifact data to enrich this profile.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
