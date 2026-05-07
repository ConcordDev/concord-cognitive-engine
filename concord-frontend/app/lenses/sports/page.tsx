'use client';

import { useState, useMemo, useCallback } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trophy, Plus, Search, Trash2, Calendar, Users,
  Target, Clock, TrendingUp, Layers, ChevronDown, Zap,
  Medal, Swords, MapPin, X, Edit2, BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

type Tab = 'games' | 'stats' | 'training';

interface GameData {
  title: string;
  sport: string;
  team: string;
  opponent: string;
  date: string;
  time: string;
  location: string;
  result: 'win' | 'loss' | 'draw' | 'upcoming';
  scoreHome: number;
  scoreAway: number;
  notes: string;
}

interface TrainingLog {
  name: string;
  type: string;
  duration: number;
  intensity: 'light' | 'moderate' | 'intense';
  date: string;
  notes: string;
}

const RESULT_COLORS: Record<string, string> = {
  win: 'text-neon-green bg-neon-green/10',
  loss: 'text-red-400 bg-red-400/10',
  draw: 'text-yellow-400 bg-yellow-400/10',
  upcoming: 'text-neon-cyan bg-neon-cyan/10',
};

const INTENSITY_COLORS: Record<string, string> = {
  light: 'text-green-400 bg-green-400/10',
  moderate: 'text-yellow-400 bg-yellow-400/10',
  intense: 'text-red-400 bg-red-400/10',
};

export default function SportsLensPage() {
  useLensNav('sports');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('sports');
  const [tab, setTab] = useState<Tab>('games');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showFeatures, setShowFeatures] = useState(false);
  const [newGame, setNewGame] = useState({ title: '', sport: '', team: '', opponent: '', date: '', location: '' });

  // Training state
  const [trainingLogs, setTrainingLogs] = useState<TrainingLog[]>([]);
  const [showAddTraining, setShowAddTraining] = useState(false);
  const [newTraining, setNewTraining] = useState({ name: '', type: '', duration: 60, intensity: 'moderate' as const, date: '', notes: '' });

  const {
    items, isLoading, isError, error, refetch,
    create, createMut, remove, deleteMut,
  } = useLensData<GameData>('sports', 'game', { seed: [] });

  const games = useMemo(() =>
    items.map(item => ({ id: item.id, ...item.data, title: item.title || item.data?.title || 'Untitled Game' }))
      .filter(g => !search || g.title?.toLowerCase().includes(search.toLowerCase()) || g.sport?.toLowerCase().includes(search.toLowerCase()) || g.team?.toLowerCase().includes(search.toLowerCase())),
    [items, search]
  );

  const stats = useMemo(() => {
    const played = games.filter(g => ['win', 'loss', 'draw'].includes(g.result));
    return {
      total: games.length,
      wins: games.filter(g => g.result === 'win').length,
      losses: games.filter(g => g.result === 'loss').length,
      draws: games.filter(g => g.result === 'draw').length,
      upcoming: games.filter(g => g.result === 'upcoming').length,
      winRate: played.length > 0
        ? Math.round(games.filter(g => g.result === 'win').length / played.length * 100)
        : 0,
      totalGoalsFor: played.reduce((s, g) => s + (g.scoreHome || 0), 0),
      totalGoalsAgainst: played.reduce((s, g) => s + (g.scoreAway || 0), 0),
      streak: (() => {
        const recent = [...played].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        if (recent.length === 0) return { type: 'none', count: 0 };
        const streakType = recent[0].result;
        let count = 0;
        for (const g of recent) {
          if (g.result === streakType) count++;
          else break;
        }
        return { type: streakType, count };
      })(),
    };
  }, [games]);

  // Next upcoming game
  const nextGame = useMemo(() => {
    const upcoming = games.filter(g => g.result === 'upcoming' && g.date).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return upcoming[0] || null;
  }, [games]);
  const daysUntilNext = nextGame ? Math.ceil((new Date(nextGame.date).getTime() - Date.now()) / 86400000) : null;

  const handleCreate = useCallback(async () => {
    if (!newGame.title.trim()) return;
    await create({
      title: newGame.title,
      data: {
        title: newGame.title, sport: newGame.sport, team: newGame.team,
        opponent: newGame.opponent, date: newGame.date, time: '', location: newGame.location,
        result: 'upcoming', scoreHome: 0, scoreAway: 0, notes: '',
      },
    });
    setNewGame({ title: '', sport: '', team: '', opponent: '', date: '', location: '' });
    setShowCreate(false);
  }, [newGame, create]);

  const handleAddTraining = useCallback(() => {
    if (!newTraining.name.trim()) return;
    setTrainingLogs(prev => [{ ...newTraining, date: newTraining.date || new Date().toISOString().slice(0, 10) }, ...prev]);
    setNewTraining({ name: '', type: '', duration: 60, intensity: 'moderate', date: '', notes: '' });
    setShowAddTraining(false);
  }, [newTraining]);

  const TABS: { id: Tab; label: string; icon: typeof Trophy }[] = [
    { id: 'games', label: 'Games', icon: Trophy },
    { id: 'stats', label: 'Statistics', icon: BarChart3 },
    { id: 'training', label: 'Training', icon: Target },
  ];

  if (isError) return <div className="flex items-center justify-center h-full p-8"><ErrorState error={error?.message} onRetry={refetch} /></div>;

  return (
    <div data-lens-theme="sports" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-500/30 to-orange-500/30 border border-yellow-500/20 flex items-center justify-center">
            <Trophy className="w-5 h-5 text-yellow-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Sports Lens</h1>
            <p className="text-sm text-gray-400">Games, stats & training</p>
          </div>
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="sports" data={realtimeData || {}} compact />
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-neon">
          <Plus className="w-4 h-4 mr-2 inline" /> Add Game
        </button>
      </header>

      {/* Upcoming game countdown */}
      {nextGame && daysUntilNext !== null && daysUntilNext >= 0 && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="panel p-4 bg-gradient-to-r from-yellow-500/10 via-transparent to-orange-500/10 border-yellow-500/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Swords className="w-5 h-5 text-yellow-400" />
            <div>
              <p className="text-sm font-medium text-white">{nextGame.team} vs <span className="text-yellow-400">{nextGame.opponent}</span></p>
              <p className="text-xs text-gray-400">{nextGame.sport ? `${nextGame.sport} — ` : ''}{nextGame.date}{nextGame.location ? ` @ ${nextGame.location}` : ''}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-yellow-400">{daysUntilNext === 0 ? 'TODAY' : daysUntilNext}</p>
            {daysUntilNext > 0 && <p className="text-[10px] text-gray-500 uppercase tracking-wider">days away</p>}
          </div>
        </motion.div>
      )}

      {/* Streak banner */}
      {stats.streak.count >= 2 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={cn('panel p-3 flex items-center gap-3', stats.streak.type === 'win' ? 'border-neon-green/30 bg-neon-green/5' : stats.streak.type === 'loss' ? 'border-red-400/30 bg-red-400/5' : 'border-yellow-400/30 bg-yellow-400/5')}>
          <Medal className={cn('w-5 h-5', stats.streak.type === 'win' ? 'text-neon-green' : stats.streak.type === 'loss' ? 'text-red-400' : 'text-yellow-400')} />
          <p className="text-sm">
            <span className="font-bold">{stats.streak.count} game {stats.streak.type} streak!</span>
          </p>
        </motion.div>
      )}

      <UniversalActions domain="sports" artifactId={items[0]?.id} compact />

      <AnimatePresence>
        {showCreate && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="panel p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Add Game / Match</h3>
                <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input value={newGame.title} onChange={e => setNewGame(p => ({ ...p, title: e.target.value }))} placeholder="Game title..." className="input-lattice" />
                <input value={newGame.sport} onChange={e => setNewGame(p => ({ ...p, sport: e.target.value }))} placeholder="Sport..." className="input-lattice" />
                <input value={newGame.team} onChange={e => setNewGame(p => ({ ...p, team: e.target.value }))} placeholder="Your team..." className="input-lattice" />
                <input value={newGame.opponent} onChange={e => setNewGame(p => ({ ...p, opponent: e.target.value }))} placeholder="Opponent..." className="input-lattice" />
                <input type="date" value={newGame.date} onChange={e => setNewGame(p => ({ ...p, date: e.target.value }))} className="input-lattice" />
                <input value={newGame.location} onChange={e => setNewGame(p => ({ ...p, location: e.target.value }))} placeholder="Location..." className="input-lattice" />
              </div>
              <button onClick={handleCreate} disabled={createMut.isPending || !newGame.title.trim()} className="btn-neon green w-full">
                {createMut.isPending ? 'Adding...' : 'Add Game'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="lens-card"><Trophy className="w-5 h-5 text-yellow-400 mb-2" /><p className="text-2xl font-bold">{stats.total}</p><p className="text-sm text-gray-400">Total Games</p></div>
        <div className="lens-card"><Zap className="w-5 h-5 text-neon-green mb-2" /><p className="text-2xl font-bold">{stats.wins}</p><p className="text-sm text-gray-400">Wins</p></div>
        <div className="lens-card"><Calendar className="w-5 h-5 text-neon-cyan mb-2" /><p className="text-2xl font-bold">{stats.upcoming}</p><p className="text-sm text-gray-400">Upcoming</p></div>
        <div className="lens-card relative overflow-hidden">
          <TrendingUp className="w-5 h-5 text-neon-purple mb-2" />
          <p className="text-2xl font-bold">{stats.winRate}%</p>
          <p className="text-sm text-gray-400">Win Rate</p>
          {/* Win rate ring */}
          <svg className="absolute right-2 top-2 w-10 h-10" viewBox="0 0 36 36">
            <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="white" strokeOpacity="0.05" strokeWidth="3" />
            <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={`${stats.winRate}, 100`} className="text-neon-purple" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-lattice-surface p-1 rounded-lg border border-lattice-border">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn('flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors', tab === t.id ? 'bg-yellow-500/20 text-yellow-400' : 'text-gray-400 hover:text-white hover:bg-white/5')}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* Games Tab */}
      {tab === 'games' && (
        <>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search games..." className="w-full bg-lattice-void border border-lattice-border rounded-lg pl-9 pr-3 py-2 text-sm" />
          </div>
          <div className="space-y-3">
            {isLoading ? (
              <div className="panel p-6 text-center text-gray-400">Loading games...</div>
            ) : games.length === 0 ? (
              <div className="panel p-8 text-center">
                <Trophy className="w-12 h-12 mx-auto mb-3 text-gray-600" />
                <p className="text-gray-400">No games tracked yet.</p>
                <p className="text-sm text-gray-600 mt-1">Log your first competition to start tracking.</p>
                <button onClick={() => setShowCreate(true)} className="mt-4 btn-neon text-sm"><Plus className="w-4 h-4 inline mr-1" /> Add Game</button>
              </div>
            ) : games.map((g, i) => (
              <motion.div key={g.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className={cn('panel p-4 hover:border-yellow-500/30 transition-all', g.result === 'win' && 'border-l-2 border-l-neon-green', g.result === 'loss' && 'border-l-2 border-l-red-400')}>
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-white truncate">{g.title}</h3>
                      <span className={cn('text-xs px-2 py-0.5 rounded font-medium', RESULT_COLORS[g.result || 'upcoming'])}>{g.result}</span>
                      {g.sport && <span className="text-xs px-2 py-0.5 rounded bg-lattice-elevated text-gray-300">{g.sport}</span>}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-400">
                      {g.team && g.opponent && (
                        <span className="flex items-center gap-1">
                          <Swords className="w-3 h-3" />
                          <span className="text-white">{g.team}</span> vs <span className="text-yellow-400">{g.opponent}</span>
                        </span>
                      )}
                      {g.date && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{g.date}</span>}
                      {g.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{g.location}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {g.result !== 'upcoming' && (
                      <div className="text-right">
                        <p className={cn('text-xl font-bold font-mono', g.result === 'win' ? 'text-neon-green' : g.result === 'loss' ? 'text-red-400' : 'text-yellow-400')}>
                          {g.scoreHome} - {g.scoreAway}
                        </p>
                      </div>
                    )}
                    <button onClick={() => remove(g.id)} className="text-gray-500 hover:text-red-400 p-1"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </>
      )}

      {/* Stats Tab */}
      {tab === 'stats' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="panel p-4 text-center">
              <p className="text-2xl font-bold text-neon-green">{stats.wins}</p>
              <p className="text-xs text-gray-400">Wins</p>
            </div>
            <div className="panel p-4 text-center">
              <p className="text-2xl font-bold text-red-400">{stats.losses}</p>
              <p className="text-xs text-gray-400">Losses</p>
            </div>
            <div className="panel p-4 text-center">
              <p className="text-2xl font-bold text-yellow-400">{stats.draws}</p>
              <p className="text-xs text-gray-400">Draws</p>
            </div>
            <div className="panel p-4 text-center">
              <p className="text-2xl font-bold text-neon-cyan">{stats.totalGoalsFor} - {stats.totalGoalsAgainst}</p>
              <p className="text-xs text-gray-400">Goals For / Against</p>
            </div>
          </div>

          {/* Win/Loss/Draw bar */}
          {stats.total > 0 && (
            <div className="panel p-4">
              <h3 className="text-sm font-semibold mb-3">Record Breakdown</h3>
              <div className="flex rounded-full overflow-hidden h-4">
                {stats.wins > 0 && <div className="bg-neon-green/60 transition-all" style={{ width: `${(stats.wins / (stats.wins + stats.losses + stats.draws)) * 100}%` }} />}
                {stats.draws > 0 && <div className="bg-yellow-400/60 transition-all" style={{ width: `${(stats.draws / (stats.wins + stats.losses + stats.draws)) * 100}%` }} />}
                {stats.losses > 0 && <div className="bg-red-400/60 transition-all" style={{ width: `${(stats.losses / (stats.wins + stats.losses + stats.draws)) * 100}%` }} />}
              </div>
              <div className="flex justify-between mt-2 text-xs text-gray-400">
                <span className="text-neon-green">{stats.wins}W</span>
                <span className="text-yellow-400">{stats.draws}D</span>
                <span className="text-red-400">{stats.losses}L</span>
              </div>
            </div>
          )}

          {/* Recent form */}
          {games.filter(g => g.result !== 'upcoming').length > 0 && (
            <div className="panel p-4">
              <h3 className="text-sm font-semibold mb-3">Recent Form</h3>
              <div className="flex gap-1">
                {[...games].filter(g => g.result !== 'upcoming').sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 10).map((g, i) => (
                  <div key={i} className={cn('w-8 h-8 rounded flex items-center justify-center text-xs font-bold', g.result === 'win' ? 'bg-neon-green/20 text-neon-green' : g.result === 'loss' ? 'bg-red-400/20 text-red-400' : 'bg-yellow-400/20 text-yellow-400')}>
                    {g.result === 'win' ? 'W' : g.result === 'loss' ? 'L' : 'D'}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Training Tab */}
      {tab === 'training' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2"><Target className="w-4 h-4 text-yellow-400" /> Training Log</h3>
            <button onClick={() => setShowAddTraining(!showAddTraining)} className="btn-neon text-sm"><Plus className="w-3 h-3 mr-1 inline" /> Log Session</button>
          </div>

          <AnimatePresence>
            {showAddTraining && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="panel p-4 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <input value={newTraining.name} onChange={e => setNewTraining(p => ({ ...p, name: e.target.value }))} placeholder="Session name..." className="input-lattice" />
                    <input value={newTraining.type} onChange={e => setNewTraining(p => ({ ...p, type: e.target.value }))} placeholder="Type (e.g. cardio, drills)..." className="input-lattice" />
                    <input type="number" value={newTraining.duration} onChange={e => setNewTraining(p => ({ ...p, duration: Number(e.target.value) }))} placeholder="Duration (min)" className="input-lattice" />
                    <select value={newTraining.intensity} onChange={e => setNewTraining(p => ({ ...p, intensity: e.target.value as 'light' | 'moderate' | 'intense' }))} className="input-lattice">
                      <option value="light">Light</option>
                      <option value="moderate">Moderate</option>
                      <option value="intense">Intense</option>
                    </select>
                    <input type="date" value={newTraining.date} onChange={e => setNewTraining(p => ({ ...p, date: e.target.value }))} className="input-lattice" />
                  </div>
                  <button onClick={handleAddTraining} disabled={!newTraining.name.trim()} className="btn-neon green w-full">Log Training</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {trainingLogs.length === 0 ? (
            <div className="panel p-8 text-center">
              <Target className="w-10 h-10 mx-auto mb-3 text-gray-600" />
              <p className="text-gray-400 text-sm">No training sessions logged yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {trainingLogs.map((log, i) => (
                <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="panel p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn('w-2 h-8 rounded-full', log.intensity === 'intense' ? 'bg-red-400' : log.intensity === 'moderate' ? 'bg-yellow-400' : 'bg-green-400')} />
                    <div>
                      <p className="text-sm font-medium text-white">{log.name}</p>
                      <div className="flex items-center gap-3 text-xs text-gray-400">
                        {log.type && <span>{log.type}</span>}
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{log.duration}m</span>
                        <span className={cn('px-1.5 py-0.5 rounded', INTENSITY_COLORS[log.intensity])}>{log.intensity}</span>
                      </div>
                    </div>
                  </div>
                  <span className="text-xs text-gray-500">{log.date}</span>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}

      <RealtimeDataPanel domain="sports" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-400 hover:text-white transition-colors">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" />Lens Features & Capabilities</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', showFeatures && 'rotate-180')} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="sports" /></div>}
      </div>
    </div>
  );
}
