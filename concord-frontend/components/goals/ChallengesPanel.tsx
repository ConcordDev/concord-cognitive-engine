'use client';

/**
 * ChallengesPanel — self-tracked challenges (artifact type "challenge").
 * Extracted from lenses/goals/page.tsx.
 */

import { useMemo, useState } from 'react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, CheckCircle2, Clock, Zap, Swords } from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import {
  type Challenge,
  CHALLENGES_FALLBACK,
  difficultyColors,
  daysUntil,
} from '@/components/goals/goals-model';

export function ChallengesPanel() {
  const [showCreateChallenge, setShowCreateChallenge] = useState(false);
  const [newChallengeTitle, setNewChallengeTitle] = useState('');
  const [newChallengeDesc, setNewChallengeDesc] = useState('');
  const [newChallengeType, setNewChallengeType] = useState<Challenge['type']>('daily');
  const [newChallengeDifficulty, setNewChallengeDifficulty] = useState<Challenge['difficulty']>('Easy');
  const [newChallengeTarget, setNewChallengeTarget] = useState(7);
  const [newChallengeDeadline, setNewChallengeDeadline] = useState('');

  const { isLoading, isError, error, refetch, items: challengeItems, create: createChallengeItem, update: updateChallengeItem } = useLensData<Record<string, unknown>>('goals', 'challenge', {
    seed: CHALLENGES_FALLBACK.map(c => ({ title: c.title, data: c as unknown as Record<string, unknown> })),
  });

  const challenges = useMemo(() => challengeItems.map(item => ({ id: item.id, ...item.data } as unknown as Challenge)), [challengeItems]);

  const acceptChallenge = (id: string) => {
    const challenge = challenges.find(c => c.id === id);
    if (challenge) {
      updateChallengeItem(id, { data: { ...challenge, accepted: true } as unknown as Record<string, unknown> }).catch((err) => console.error('Failed to accept challenge:', err instanceof Error ? err.message : err));
    }
  };

  const bumpChallengeProgress = (id: string) => {
    const challenge = challenges.find(c => c.id === id);
    if (challenge) {
      updateChallengeItem(id, { data: { ...challenge, progress: Math.min(challenge.progress + 1, challenge.target) } as unknown as Record<string, unknown> }).catch((err) => console.error('Failed to update challenge progress:', err instanceof Error ? err.message : err));
    }
  };

  const handleCreateChallenge = () => {
    if (!newChallengeTitle.trim()) return;
    createChallengeItem({
      title: newChallengeTitle,
      data: {
        title: newChallengeTitle, description: newChallengeDesc, type: newChallengeType,
        difficulty: newChallengeDifficulty, xp: { Easy: 50, Medium: 150, Hard: 300, Legendary: 750 }[newChallengeDifficulty],
        progress: 0, target: newChallengeTarget, deadline: newChallengeDeadline || undefined, accepted: false,
      } as unknown as Record<string, unknown>,
    }).then(() => {
      setShowCreateChallenge(false); setNewChallengeTitle(''); setNewChallengeDesc(''); setNewChallengeDeadline('');
    }).catch((err) => console.error('Failed to create challenge:', err instanceof Error ? err.message : err));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex items-center justify-center p-8">
        <ErrorState error={error?.message} onRetry={() => { refetch(); }} />
      </div>
    );
  }

  return (
        <div className="space-y-4">
          {/* Challenge type filter summary */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex gap-4 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-yellow-400" /> Daily: {challenges.filter((c) => c.type === 'daily').length}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-400" /> Weekly: {challenges.filter((c) => c.type === 'weekly').length}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-purple-400" /> Community: {challenges.filter((c) => c.type === 'community').length}
              </span>
            </div>
            <button onClick={() => setShowCreateChallenge((v) => !v)} className="btn-neon purple flex items-center gap-1 text-xs">
              <Plus className="w-3.5 h-3.5" /> New Challenge
            </button>
          </div>

          <AnimatePresence>
            {showCreateChallenge && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="panel p-4 space-y-3">
                  <input value={newChallengeTitle} onChange={(e) => setNewChallengeTitle(e.target.value)} placeholder="Challenge title (e.g. 'Meditate every morning')" className="input-lattice w-full" />
                  <input value={newChallengeDesc} onChange={(e) => setNewChallengeDesc(e.target.value)} placeholder="What does success look like?" className="input-lattice w-full" />
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <select value={newChallengeType} onChange={(e) => setNewChallengeType(e.target.value as Challenge['type'])} className="input-lattice">
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="community">Community</option>
                    </select>
                    <select value={newChallengeDifficulty} onChange={(e) => setNewChallengeDifficulty(e.target.value as Challenge['difficulty'])} className="input-lattice">
                      {(['Easy', 'Medium', 'Hard', 'Legendary'] as const).map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <input type="number" min={1} value={newChallengeTarget} onChange={(e) => setNewChallengeTarget(Number(e.target.value))} className="input-lattice" placeholder="Target reps" />
                    <input type="date" value={newChallengeDeadline} onChange={(e) => setNewChallengeDeadline(e.target.value)} className="input-lattice" />
                    <button onClick={handleCreateChallenge} disabled={!newChallengeTitle} className="btn-neon purple disabled:opacity-50">Create</button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {challenges.map((ch, i) => (
            <motion.div
              key={ch.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="panel p-5 space-y-3"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${difficultyColors[ch.difficulty]}`}
                    >
                      {ch.difficulty}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-gray-300 capitalize">
                      {ch.type}
                    </span>
                  </div>
                  <h3 className="font-semibold text-white">{ch.title}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{ch.description}</p>
                </div>
                <div className="text-right flex-shrink-0 ml-4">
                  <div className="flex items-center gap-1 text-yellow-400 text-sm font-bold">
                    <Zap className="w-4 h-4" />
                    {ch.xp} XP
                  </div>
                  {ch.deadline && (
                    <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1 justify-end">
                      <Clock className="w-3 h-3" />
                      {daysUntil(ch.deadline) === 0 ? 'Due today' : `${daysUntil(ch.deadline)}d left`}
                    </p>
                  )}
                </div>
              </div>

              {/* Progress */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Progress</span>
                  <span>
                    {ch.progress} / {ch.target}
                  </span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-orange-500 to-yellow-400"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min((ch.progress / ch.target) * 100, 100)}%` }}
                    transition={{ duration: 0.8 }}
                  />
                </div>
              </div>

              {!ch.accepted ? (
                <button
                  onClick={() => acceptChallenge(ch.id)}
                  className="btn-neon w-full flex items-center justify-center gap-2 text-sm"
                >
                  <Swords className="w-4 h-4" /> Accept Challenge
                </button>
              ) : ch.progress < ch.target ? (
                <button
                  onClick={() => bumpChallengeProgress(ch.id)}
                  className="w-full flex items-center justify-center gap-2 text-sm rounded-lg border border-orange-500/30 bg-orange-500/10 py-1.5 text-orange-400 hover:bg-orange-500/20"
                >
                  <Plus className="w-3.5 h-3.5" /> Log progress
                </button>
              ) : (
                <div className="text-xs text-center text-green-400 flex items-center justify-center gap-1 py-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Challenge Complete
                </div>
              )}
            </motion.div>
          ))}

          {challenges.length === 0 && (
            <div className="panel p-12 text-center text-gray-400">
              <Swords className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>No challenges yet. Create one to start a self-tracked streak.</p>
            </div>
          )}
        </div>
  );
}
