'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  BadgeCheck, Plus, Search, Users, MessageSquare,
  Star, Calendar, Target, Clock, Layers, ChevronDown, Send, Trash2, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

interface MentorshipData {
  mentorName: string;
  menteeName: string;
  topic: string;
  status: 'seeking' | 'matched' | 'active' | 'completed' | 'paused';
  goals: string[];
  meetingFrequency: string;
  nextMeeting: string;
  sessionsCompleted: number;
  notes: string;
  skills: string[];
  rating: number;
}

const STATUS_COLORS: Record<string, string> = {
  seeking: 'text-yellow-400 bg-yellow-400/10',
  matched: 'text-neon-cyan bg-neon-cyan/10',
  active: 'text-neon-green bg-neon-green/10',
  completed: 'text-neon-purple bg-neon-purple/10',
  paused: 'text-gray-400 bg-gray-400/10',
};

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.35, ease: 'easeOut' } }),
  exit: { opacity: 0, y: -10, transition: { duration: 0.2 } },
};

export default function MentorshipLensPage() {
  useLensNav('mentorship');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('mentorship');
  const [search, setSearch] = useState('');
  const [selectedRelation, setSelectedRelation] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);
  const [activeTab, setActiveTab] = useState<'mentors' | 'sessions' | 'goals'>('mentors');
  const [newMentorship, setNewMentorship] = useState({ mentorName: '', menteeName: '', topic: '', meetingFrequency: 'weekly' });
  const [newNote, setNewNote] = useState('');

  // Wire to social profiles for matching
  const { data: profiles } = useQuery({
    queryKey: ['social-profiles-mentorship'],
    queryFn: async () => {
      const { data } = await api.get('/api/social/profiles?limit=50');
      return data;
    },
    staleTime: 60000,
    retry: 1,
  });

  const {
    items, isLoading, isError, error, refetch,
    create, createMut, update, remove, deleteMut,
  } = useLensData<MentorshipData>('mentorship', 'relation', { seed: [] });

  const relations = useMemo(() =>
    items.map(item => ({ id: item.id, ...item.data, topic: item.title || item.data?.topic || 'Untitled' }))
      .filter(r => !search || r.topic?.toLowerCase().includes(search.toLowerCase()) || r.mentorName?.toLowerCase().includes(search.toLowerCase()) || r.menteeName?.toLowerCase().includes(search.toLowerCase())),
    [items, search]
  );

  const selectedData = useMemo(() => relations.find(r => r.id === selectedRelation), [relations, selectedRelation]);

  const stats = useMemo(() => ({
    total: relations.length,
    active: relations.filter(r => r.status === 'active').length,
    totalSessions: relations.reduce((s, r) => s + (r.sessionsCompleted || 0), 0),
    seeking: relations.filter(r => r.status === 'seeking').length,
    avgRating: relations.length > 0 ? (relations.reduce((s, r) => s + (r.rating || 0), 0) / relations.length) : 0,
  }), [relations]);

  const handleCreate = useCallback(async () => {
    if (!newMentorship.topic.trim()) return;
    await create({
      title: newMentorship.topic,
      data: {
        mentorName: newMentorship.mentorName, menteeName: newMentorship.menteeName,
        topic: newMentorship.topic, status: newMentorship.mentorName && newMentorship.menteeName ? 'matched' : 'seeking',
        goals: [], meetingFrequency: newMentorship.meetingFrequency,
        nextMeeting: '', sessionsCompleted: 0, notes: '', skills: [], rating: 0,
      },
    });
    setNewMentorship({ mentorName: '', menteeName: '', topic: '', meetingFrequency: 'weekly' });
    setShowCreate(false);
  }, [newMentorship, create]);

  const handleAddNote = useCallback(async () => {
    if (!newNote.trim() || !selectedRelation) return;
    const item = items.find(i => i.id === selectedRelation);
    if (!item) return;
    const existing = item.data?.notes || '';
    const timestamp = new Date().toLocaleString();
    const updated = existing ? `${existing}\n\n[${timestamp}] ${newNote}` : `[${timestamp}] ${newNote}`;
    await update(selectedRelation, { data: { ...item.data, notes: updated } as Partial<MentorshipData> });
    setNewNote('');
  }, [newNote, selectedRelation, items, update]);

  // Compute mentor match scores (simple heuristic)
  const matchScores = useMemo(() => {
    return relations.map(r => {
      let score = 50;
      if (r.status === 'active') score += 20;
      if (r.sessionsCompleted > 5) score += 15;
      if (r.rating > 3) score += 10;
      if (r.goals && r.goals.length > 0) score += 5;
      return { id: r.id, score: Math.min(score, 100) };
    });
  }, [relations]);

  const getMatchScore = (id: string) => matchScores.find(m => m.id === id)?.score || 0;

  // Session history timeline
  const sessionTimeline = useMemo(() => {
    return relations
      .filter(r => r.sessionsCompleted > 0)
      .sort((a, b) => (b.sessionsCompleted || 0) - (a.sessionsCompleted || 0))
      .slice(0, 8);
  }, [relations]);

  // Goal progress
  const goalProgress = useMemo(() => {
    return relations
      .filter(r => r.goals && r.goals.length > 0)
      .flatMap(r => r.goals.map((g, i) => ({
        goal: g,
        topic: r.topic,
        progress: Math.min(100, ((r.sessionsCompleted || 0) * 15) + (i * 10)),
      })))
      .slice(0, 6);
  }, [relations]);

  if (isError) return <div className="flex items-center justify-center h-full p-8"><ErrorState error={error?.message} onRetry={refetch} /></div>;

  const tabs = [
    { key: 'mentors' as const, label: 'Mentors', icon: Users },
    { key: 'sessions' as const, label: 'Sessions', icon: Calendar },
    { key: 'goals' as const, label: 'Goals', icon: Target },
  ];

  return (
    <div data-lens-theme="mentorship" className="p-6 space-y-6">
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <BadgeCheck className="w-6 h-6 text-neon-blue" />
          <div>
            <h1 className="text-xl font-bold">Mentorship Lens</h1>
            <p className="text-sm text-gray-400">Mentor matching, tracking & guidance</p>
          </div>
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="mentorship" data={realtimeData || {}} compact />
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-neon">
          <Plus className="w-4 h-4 mr-2 inline" /> New Mentorship
        </button>
      </motion.header>

      <UniversalActions domain="mentorship" artifactId={items[0]?.id} compact />

      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="panel p-4 space-y-3 overflow-hidden"
          >
            <h3 className="font-semibold">Create Mentorship</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input value={newMentorship.topic} onChange={e => setNewMentorship(p => ({ ...p, topic: e.target.value }))} placeholder="Topic / skill area..." className="input-lattice" />
              <select value={newMentorship.meetingFrequency} onChange={e => setNewMentorship(p => ({ ...p, meetingFrequency: e.target.value }))} className="input-lattice">
                <option value="weekly">Weekly</option><option value="biweekly">Biweekly</option>
                <option value="monthly">Monthly</option><option value="as-needed">As Needed</option>
              </select>
              <input value={newMentorship.mentorName} onChange={e => setNewMentorship(p => ({ ...p, mentorName: e.target.value }))} placeholder="Mentor name (optional)..." className="input-lattice" />
              <input value={newMentorship.menteeName} onChange={e => setNewMentorship(p => ({ ...p, menteeName: e.target.value }))} placeholder="Mentee name (optional)..." className="input-lattice" />
            </div>
            <button onClick={handleCreate} disabled={createMut.isPending || !newMentorship.topic.trim()} className="btn-neon green w-full">
              {createMut.isPending ? 'Creating...' : 'Create Mentorship'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Available Mentors from Profiles */}
      {Array.isArray(profiles) && profiles.length > 0 && (
        <div className="panel p-4">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><Users className="w-4 h-4 text-neon-cyan" /> Available Profiles ({profiles.length})</h3>
          <div className="flex gap-2 flex-wrap">
            {profiles.slice(0, 6).map((p: { id?: string; name?: string; displayName?: string }, i: number) => (
              <span key={p.id || i} className="px-3 py-1 text-xs rounded-full bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20">
                {p.displayName || p.name || String(p)}
              </span>
            ))}
            {profiles.length > 6 && <span className="px-3 py-1 text-xs text-gray-500">+{profiles.length - 6} more</span>}
          </div>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: BadgeCheck, color: 'text-neon-blue', value: stats.total, label: 'Mentorships' },
          { icon: Users, color: 'text-neon-green', value: stats.active, label: 'Active' },
          { icon: Target, color: 'text-neon-cyan', value: stats.totalSessions, label: 'Sessions' },
          { icon: Star, color: 'text-yellow-400', value: stats.avgRating > 0 ? `${stats.avgRating.toFixed(1)}/5` : '--', label: 'Avg Rating' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.08, duration: 0.3 }}
            className="lens-card"
          >
            <stat.icon className={`w-5 h-5 ${stat.color} mb-2`} />
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-sm text-gray-400">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-lattice-void border border-lattice-border rounded-lg p-1">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all flex-1 justify-center',
              activeTab === tab.key
                ? 'bg-neon-blue/20 text-neon-blue border border-neon-blue/30'
                : 'text-gray-400 hover:text-white hover:bg-lattice-surface'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search mentorships..." className="w-full bg-lattice-void border border-lattice-border rounded-lg pl-9 pr-3 py-2 text-sm" />
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'mentors' && (
          <motion.div
            key="mentors"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.25 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-6"
          >
            {/* Relations list */}
            <div className="panel p-4">
              <h2 className="font-semibold mb-4 flex items-center gap-2"><BadgeCheck className="w-4 h-4 text-neon-blue" />Mentorships</h2>
              <div className="space-y-3">
                {isLoading ? (
                  <p className="text-gray-400 text-center py-4">Loading...</p>
                ) : relations.length === 0 ? (
                  <p className="text-gray-400 text-center py-4">No mentorships yet.</p>
                ) : relations.map((r, i) => (
                  <motion.button
                    key={r.id}
                    custom={i}
                    variants={cardVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    onClick={() => setSelectedRelation(r.id)}
                    className={cn('w-full text-left lens-card transition-all', selectedRelation === r.id && 'border-neon-blue ring-1 ring-neon-blue')}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-semibold text-sm truncate">{r.topic}</h3>
                      <span className={cn('text-xs px-2 py-0.5 rounded', STATUS_COLORS[r.status || 'seeking'])}>{r.status}</span>
                    </div>
                    <div className="text-xs text-gray-400">
                      {r.mentorName && <span>Mentor: {r.mentorName}</span>}
                      {r.mentorName && r.menteeName && <span> | </span>}
                      {r.menteeName && <span>Mentee: {r.menteeName}</span>}
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500 mt-1">
                      <span>{r.sessionsCompleted || 0} sessions | {r.meetingFrequency}</span>
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 text-neon-cyan">
                          <Star className="w-3 h-3" /> {getMatchScore(r.id)}%
                        </span>
                        <button onClick={(e) => { e.stopPropagation(); remove(r.id); }} disabled={deleteMut.isPending} className="text-gray-500 hover:text-red-400">
                          {deleteMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                        </button>
                      </div>
                    </div>
                  </motion.button>
                ))}
              </div>
            </div>

            {/* Detail */}
            <div className="lg:col-span-2 space-y-4">
              {selectedData ? (
                <>
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="panel p-4"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h2 className="font-semibold text-lg">{selectedData.topic}</h2>
                      <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-neon-cyan/10 border border-neon-cyan/20">
                        <Star className="w-4 h-4 text-neon-cyan" />
                        <span className="text-sm font-bold text-neon-cyan">Match: {getMatchScore(selectedData.id)}%</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="lens-card">
                        <p className="text-xs text-gray-400">Mentor</p>
                        <p className="font-semibold">{selectedData.mentorName || 'Unassigned'}</p>
                      </div>
                      <div className="lens-card">
                        <p className="text-xs text-gray-400">Mentee</p>
                        <p className="font-semibold">{selectedData.menteeName || 'Unassigned'}</p>
                      </div>
                      <div className="lens-card">
                        <p className="text-xs text-gray-400">Sessions Completed</p>
                        <p className="text-xl font-bold text-neon-cyan">{selectedData.sessionsCompleted || 0}</p>
                      </div>
                      <div className="lens-card">
                        <p className="text-xs text-gray-400">Frequency</p>
                        <p className="capitalize">{selectedData.meetingFrequency}</p>
                      </div>
                    </div>
                    {selectedData.goals?.length > 0 && (
                      <div className="mb-4">
                        <p className="text-xs text-gray-400 mb-2">Goals</p>
                        <div className="flex flex-wrap gap-2">
                          {selectedData.goals.map((g, i) => (
                            <span key={i} className="px-2 py-1 bg-lattice-elevated rounded text-sm">{g}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {selectedData.notes && (
                      <div>
                        <p className="text-xs text-gray-400 mb-2">Session Notes</p>
                        <pre className="text-sm text-gray-300 whitespace-pre-wrap bg-lattice-deep p-3 rounded-lg max-h-48 overflow-auto">{selectedData.notes}</pre>
                      </div>
                    )}
                  </motion.div>

                  {/* Add note */}
                  <div className="panel p-4">
                    <h3 className="font-semibold mb-3 flex items-center gap-2"><MessageSquare className="w-4 h-4 text-neon-blue" />Add Session Note</h3>
                    <div className="flex gap-2">
                      <input value={newNote} onChange={e => setNewNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddNote(); }} placeholder="Session notes..." className="input-lattice flex-1" />
                      <button onClick={handleAddNote} disabled={!newNote.trim()} className="btn-neon"><Send className="w-4 h-4" /></button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="panel p-4 h-full flex items-center justify-center">
                  <div className="text-center text-gray-500">
                    <BadgeCheck className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>Select a mentorship to view details</p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {activeTab === 'sessions' && (
          <motion.div
            key="sessions"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.25 }}
            className="panel p-6"
          >
            <h2 className="font-semibold mb-4 flex items-center gap-2"><Clock className="w-4 h-4 text-neon-cyan" />Session History Timeline</h2>
            {sessionTimeline.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No sessions recorded yet. Complete some mentorship sessions to see the timeline.</p>
            ) : (
              <div className="relative">
                <div className="absolute left-4 top-0 bottom-0 w-px bg-lattice-border" />
                <div className="space-y-4">
                  {sessionTimeline.map((r, i) => (
                    <motion.div
                      key={r.id}
                      custom={i}
                      variants={cardVariants}
                      initial="hidden"
                      animate="visible"
                      className="relative pl-10"
                    >
                      <div className="absolute left-2.5 top-3 w-3 h-3 rounded-full bg-neon-cyan border-2 border-lattice-void" />
                      <div className="lens-card">
                        <div className="flex items-center justify-between mb-1">
                          <h3 className="font-semibold text-sm">{r.topic}</h3>
                          <span className="text-xs text-neon-cyan font-mono">{r.sessionsCompleted} sessions</span>
                        </div>
                        <div className="text-xs text-gray-400">
                          {r.mentorName && <span>{r.mentorName}</span>}
                          {r.mentorName && r.menteeName && <span> with </span>}
                          {r.menteeName && <span>{r.menteeName}</span>}
                          <span className="ml-2">{r.meetingFrequency}</span>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {activeTab === 'goals' && (
          <motion.div
            key="goals"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.25 }}
            className="panel p-6"
          >
            <h2 className="font-semibold mb-4 flex items-center gap-2"><Target className="w-4 h-4 text-neon-green" />Goal Progress</h2>
            {goalProgress.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No goals set yet. Add goals to your mentorship relationships to track progress.</p>
            ) : (
              <div className="space-y-4">
                {goalProgress.map((g, i) => (
                  <motion.div
                    key={i}
                    custom={i}
                    variants={cardVariants}
                    initial="hidden"
                    animate="visible"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-white">{g.goal}</span>
                      <span className="text-xs text-gray-400">{g.topic}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-3 bg-lattice-deep rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${g.progress}%` }}
                          transition={{ duration: 0.8, delay: i * 0.1 }}
                          className={cn(
                            'h-full rounded-full',
                            g.progress >= 80 ? 'bg-neon-green' : g.progress >= 40 ? 'bg-neon-cyan' : 'bg-yellow-400'
                          )}
                        />
                      </div>
                      <span className="text-xs font-mono text-gray-300 w-10 text-right">{g.progress}%</span>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <RealtimeDataPanel domain="mentorship" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" />Lens Features & Capabilities</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', showFeatures && 'rotate-180')} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="mentorship" /></div>}
      </div>
    </div>
  );
}
