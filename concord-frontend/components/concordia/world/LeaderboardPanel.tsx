'use client';

import React, { useState, useEffect } from 'react';
import { X, Trophy, Zap, Star, Sword } from 'lucide-react';

type LeaderboardCategory = 'sparks' | 'skills' | 'crafts' | 'nemesis';

interface LeaderboardEntry {
  user_id: string;
  username?: string;
  score: number;
  npc_title?: string;
}

const CATEGORIES: { id: LeaderboardCategory; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'sparks',  label: 'Sparks',  icon: Zap },
  { id: 'skills',  label: 'Skills',  icon: Star },
  { id: 'crafts',  label: 'Crafts',  icon: Trophy },
  { id: 'nemesis', label: 'Nemesis', icon: Sword },
];

interface LeaderboardPanelProps {
  currentUserId?: string;
  onClose?: () => void;
}

export function LeaderboardPanel({ currentUserId, onClose }: LeaderboardPanelProps) {
  const [category, setCategory] = useState<LeaderboardCategory>('sparks');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setEntries([]);
    fetch(`/api/leaderboards/${category}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.entries) setEntries(d.entries); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [category]);

  const formatScore = (score: number, cat: LeaderboardCategory) => {
    if (cat === 'sparks') return `${score.toLocaleString()} ⚡`;
    if (cat === 'skills') return `Lvl ${score.toFixed(1)}`;
    return score.toLocaleString();
  };

  const rankColor = (i: number) => {
    if (i === 0) return 'text-yellow-400';
    if (i === 1) return 'text-gray-300';
    if (i === 2) return 'text-amber-600';
    return 'text-white/40';
  };

  return (
    <div className="fixed right-4 top-20 w-72 bg-black/90 border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[70vh] z-40">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-yellow-400" />
          <h2 className="text-white font-bold text-sm">Leaderboard</h2>
        </div>
        <button onClick={onClose} className="text-white/40 hover:text-white" aria-label="Close"><X className="w-4 h-4" /></button>
      </div>

      {/* Category tabs */}
      <div className="grid grid-cols-4 border-b border-white/10">
        {CATEGORIES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setCategory(id)}
            className={`flex flex-col items-center py-2 gap-0.5 transition-colors ${
              category === id ? 'text-yellow-400 border-b-2 border-yellow-400' : 'text-white/30 hover:text-white/60'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="text-[9px] font-medium">{label}</span>
          </button>
        ))}
      </div>

      {/* Entries */}
      <div className="overflow-y-auto flex-1 p-2 space-y-1">
        {loading ? (
          <div className="text-white/30 text-xs text-center py-8">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="text-white/30 text-xs text-center py-8">No data yet</div>
        ) : (
          entries.map((entry, i) => (
            <div
              key={entry.user_id}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg ${
                entry.user_id === currentUserId ? 'bg-indigo-500/20 border border-indigo-500/30' : 'hover:bg-white/5'
              }`}
            >
              <span className={`text-sm font-bold w-5 text-center ${rankColor(i)}`}>
                {i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-white text-xs font-medium truncate">
                  {entry.username ?? entry.user_id.slice(0, 8)}
                </div>
                {category === 'nemesis' && entry.npc_title && (
                  <div className="text-white/30 text-[10px] truncate">{entry.npc_title}</div>
                )}
              </div>
              <span className="text-white/70 text-xs font-mono shrink-0">
                {formatScore(entry.score, category)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
