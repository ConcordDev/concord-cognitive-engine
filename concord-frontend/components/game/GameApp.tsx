'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { createSimplexNoise2D } from '@/lib/world-lens/simplex-noise';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { TriviaPanel } from '@/components/game/TriviaPanel';
import { GameFeed } from '@/components/game/GameFeed';
import { HabitHub } from '@/components/game/HabitHub';
import { XpActivityFeed } from '@/components/game/XpActivityFeed';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trophy, Star, Zap, Target, Users, Swords, Crown,
  Flame, TrendingUp, Plus, X, Check, Clock,
  BarChart3, Sparkles, Gamepad2, MessageSquare, FlaskConical,
  ArrowUp, ChevronDown, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { showToast } from '@/components/common/Toasts';
import { GameDesignLab } from '@/components/game/GameDesignLab';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MainTab = 'dashboard' | 'habits' | 'design' | 'quests' | 'achievements' | 'leaderboard' | 'history' | 'minigame' | 'trivia' | 'feed';
type LeaderboardPeriod = 'weekly' | 'monthly' | 'alltime';
type QuestStatus = 'available' | 'accepted' | 'completed';

interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  unlocked: boolean;
  progress: number;
  maxProgress: number;
  xpReward: number;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
}

interface Quest {
  id: string;
  name: string;
  description: string;
  icon: string;
  xpReward: number;
  // Difficulty is a real, user-chosen field only for locally-authored custom
  // challenges. The /api/game/challenges daily-challenge feed has no
  // difficulty concept server-side, so it's optional — never fabricated.
  difficulty?: 'easy' | 'medium' | 'hard';
  type: 'daily' | 'weekly' | 'challenge';
  status: QuestStatus;
  timeLeft?: string;
  // Real progress/target from /api/game/challenges (server-computed from
  // actual DTU/vote activity) — undefined for locally-authored quests until
  // the server round-trips them.
  progress?: number;
  target?: number;
}

// Matches the real /api/game/leaderboard response shape exactly — the
// backend has no per-user display-name/title join, so this intentionally
// does NOT invent `name`/`title` fields; the UI renders the real `userId`.
interface LeaderboardPlayer {
  userId: string;
  level: number;
  xp: number;
  badges: number;
  badgeList: string[];
}

interface XpHistoryEntry {
  day: string;
  xp: number;
  label: string;
}

interface GameProfile {
  // `name`/`title`/`joinDate`/`rank`/`completionRate`/`challengesWon` are
  // deliberately NOT modeled here — /api/game/profile never returns them
  // server-side. Rendering them would mean either literal "undefined" text
  // or a permanently-fake zero. Rank is instead derived client-side from the
  // real /api/game/leaderboard list (see `myRank` below).
  level: number;
  xp: number;
  nextLevelXp: number;
  totalXpEarned: number;
  achievements: number;
  totalAchievements: number;
  streak: number;
  longestStreak: number;
  questsCompleted: number;
  xpHistory: XpHistoryEntry[];
}

// ---------------------------------------------------------------------------
// Initial state — empty; all data comes from the backend API
// ---------------------------------------------------------------------------

const INITIAL_PROFILE = {
  level: 1,
  xp: 0,
  nextLevelXp: 1000,
  totalXpEarned: 0,
  achievements: 0,
  totalAchievements: 0,
  streak: 0,
  longestStreak: 0,
  questsCompleted: 0,
};

const INITIAL_XP_HISTORY: { day: string; xp: number; label: string }[] = [];

const INITIAL_ACHIEVEMENTS: Achievement[] = [];

const INITIAL_QUESTS: Quest[] = [];

const INITIAL_LEADERBOARD: LeaderboardPlayer[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const rarityColor: Record<string, string> = {
  common: 'text-gray-400 border-gray-500/30',
  rare: 'text-neon-blue border-neon-blue/30',
  epic: 'text-neon-purple border-neon-purple/30',
  legendary: 'text-neon-yellow border-neon-yellow/30',
};

const difficultyStyle: Record<string, string> = {
  easy: 'bg-neon-green/20 text-neon-green',
  medium: 'bg-neon-blue/20 text-neon-blue',
  hard: 'bg-neon-pink/20 text-neon-pink',
};

function _xpForLevel(lv: number) {
  return lv * 1000 + (lv > 10 ? (lv - 10) * 500 : 0);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GameApp() {
  useLensNav('game');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('game');

  const [activeTab, setActiveTab] = useState<MainTab>('dashboard');


  // Lens-scoped keyboard commands (auto-wired by codemod).

  useLensCommand(

    [

      { id: 'tab-dashboard', keys: 'd', description: 'Dashboard', category: 'navigation', action: () => setActiveTab('dashboard') },

      { id: 'tab-habits', keys: 'b', description: 'Habit Hub', category: 'navigation', action: () => setActiveTab('habits') },

      { id: 'tab-design', keys: 'g', description: 'Design Lab', category: 'navigation', action: () => setActiveTab('design') },

      { id: 'tab-quests', keys: 'q', description: 'Quests', category: 'navigation', action: () => setActiveTab('quests') },

      { id: 'tab-achievements', keys: 'a', description: 'Achievements', category: 'navigation', action: () => setActiveTab('achievements') },

      { id: 'tab-leaderboard', keys: 'l', description: 'Leaderboard', category: 'navigation', action: () => setActiveTab('leaderboard') },

      { id: 'tab-history', keys: 'i', description: 'History', category: 'navigation', action: () => setActiveTab('history') },

      { id: 'tab-minigame', keys: 'm', description: 'Minigame', category: 'navigation', action: () => setActiveTab('minigame') },
      { id: 'tab-trivia', keys: 'v', description: 'Trivia', category: 'navigation', action: () => setActiveTab('trivia') },
      { id: 'tab-feed', keys: 'f', description: 'Feed', category: 'navigation', action: () => setActiveTab('feed') },

    ],

    { lensId: 'game' }

  );
  const [lbPeriod, setLbPeriod] = useState<LeaderboardPeriod>('alltime');
  const { user: authUser } = useAuth();
  const [playerXp, setPlayerXp] = useState(0);
  const [showCreateChallenge, setShowCreateChallenge] = useState(false);
  const [newChallenge, setNewChallenge] = useState({ name: '', description: '', difficulty: 'medium' as Quest['difficulty'], xpReward: 300 });
  const [unlockAnim, setUnlockAnim] = useState<string | null>(null);
  const [questFilter, setQuestFilter] = useState<'all' | 'daily' | 'weekly' | 'challenge'>('all');

  // ---------------------------------------------------------------------------
  // Mini-Game Engine State
  // ---------------------------------------------------------------------------
  // All simulation state lives in refs to avoid 60fps re-renders.
  // React state is synced periodically (every ~150ms) for HUD display only.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number>(0);
  const gameLoopRef = useRef<boolean>(false);

  interface MiniGameTarget {
    id: number;
    x: number;
    y: number;
    radius: number;
    life: number;      // frames remaining
    maxLife: number;
    points: number;
    color: string;
    spawned: number;    // frame it appeared
    vx: number;         // horizontal drift velocity
    vy: number;         // vertical drift velocity
  }

  interface HitParticle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    color: string;
    size: number;
  }

  interface FloatingText {
    x: number;
    y: number;
    text: string;
    life: number;
    color: string;
  }

  // React state -- updated periodically from refs, drives HUD display
  const [mgState, setMgState] = useState<'idle' | 'playing' | 'ended'>('idle');
  const [mgScore, setMgScore] = useState(0);
  const [mgTimeLeft, setMgTimeLeft] = useState(30);
  const [mgHits, setMgHits] = useState(0);
  const [mgMisses, setMgMisses] = useState(0);
  const [mgCombo, setMgCombo] = useState(0);
  const [mgBestCombo, setMgBestCombo] = useState(0);
  const [mgXpAwarded, setMgXpAwarded] = useState(0);

  // Simulation refs -- mutated directly inside requestAnimationFrame
  const simRef = useRef({
    score: 0,
    timeLeft: 30,
    hits: 0,
    misses: 0,
    combo: 0,
    bestCombo: 0,
    targets: [] as MiniGameTarget[],
    particles: [] as HitParticle[],
    floatingTexts: [] as FloatingText[],
    screenShake: 0,
    spawnInterval: 900,     // ms, decreases over time for difficulty ramp
    nextId: 1,
  });

  const TARGET_COLORS = ['#a855f7', '#06b6d4', '#22c55e', '#eab308', '#ec4899', '#3b82f6'];

  // Sync simulation refs to React state for HUD (called every ~150ms from game loop)
  const syncStateFromSim = useCallback(() => {
    const s = simRef.current;
    setMgScore(s.score);
    setMgTimeLeft(s.timeLeft);
    setMgHits(s.hits);
    setMgMisses(s.misses);
    setMgCombo(s.combo);
    setMgBestCombo(s.bestCombo);
  }, []);

  const startMiniGame = useCallback(() => {
    // Reset React state
    setMgScore(0);
    setMgTimeLeft(30);
    setMgHits(0);
    setMgMisses(0);
    setMgCombo(0);
    setMgBestCombo(0);
    setMgXpAwarded(0);
    // Reset simulation refs
    simRef.current = {
      score: 0, timeLeft: 30, hits: 0, misses: 0, combo: 0, bestCombo: 0,
      targets: [], particles: [], floatingTexts: [], screenShake: 0,
      spawnInterval: 900, nextId: 1,
    };
    setMgState('playing');
    gameLoopRef.current = true;
  }, []);

  const endMiniGame = useCallback(() => {
    gameLoopRef.current = false;
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    // Final sync
    const s = simRef.current;
    setMgScore(s.score);
    setMgHits(s.hits);
    setMgMisses(s.misses);
    setMgBestCombo(s.bestCombo);
    setMgCombo(0);
    setMgTimeLeft(0);
    setMgState('ended');
    // Practice XP: 1 XP per 10 points scored, minimum 5 if any hits.
    // Deliberately NOT added to `playerXp` (the real header/progress-bar
    // counter sourced from /api/game/profile) — no backend macro persists
    // mini-game score as profile XP, so folding it into playerXp used to
    // make session-only arcade points look like saved account progress.
    const xpEarned = Math.max(s.hits > 0 ? 5 : 0, Math.floor(s.score / 10));
    setMgXpAwarded(xpEarned);
  }, []);

  // Main game loop -- pure canvas rendering, no React setState per frame
  useEffect(() => {
    if (mgState !== 'playing') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frameCount = 0;
    // Track 1 — coherent screenshake. The shake magnitude (s.screenShake) still
    // accumulates + decays as before, but the per-frame OFFSET is now sampled from
    // seeded Simplex noise instead of Math.random(): smooth frame-to-frame (not
    // harsh jitter), deterministic, and survives slow-mo. (Eiserloh trauma model.)
    const shakeNoiseX = createSimplexNoise2D(1013);
    const shakeNoiseY = createSimplexNoise2D(2027);
    let lastTimestamp = performance.now();
    let secondAccumulator = 0;
    let spawnAccumulator = 0;
    let syncAccumulator = 0;
    const SYNC_INTERVAL = 150; // ms between React state syncs

    const spawnTarget = (): MiniGameTarget => {
      const s = simRef.current;
      // Difficulty ramp: targets get smaller and faster over time
      const elapsed = 30 - s.timeLeft;
      const difficultyScale = 1 + elapsed / 30; // 1.0 -> 2.0 over 30s
      const baseRadius = 18 + Math.random() * 18;
      const radius = Math.max(12, baseRadius / (1 + difficultyScale * 0.15));
      const points = Math.round((40 - radius) + 5 * difficultyScale);
      const life = Math.max(40, (80 + Math.floor(Math.random() * 50)) - elapsed);
      const speed = 0.15 + Math.random() * 0.3 * difficultyScale;
      const angle = Math.random() * Math.PI * 2;
      return {
        id: s.nextId++,
        x: radius + Math.random() * (canvas.width - radius * 2),
        y: 40 + radius + Math.random() * (canvas.height - radius * 2 - 40),
        radius,
        life,
        maxLife: life,
        points,
        color: TARGET_COLORS[Math.floor(Math.random() * TARGET_COLORS.length)],
        spawned: frameCount,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
      };
    };

    const spawnParticles = (x: number, y: number, color: string, count: number) => {
      const s = simRef.current;
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
        const speed = 1.5 + Math.random() * 3;
        s.particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 20 + Math.random() * 15,
          color,
          size: 2 + Math.random() * 3,
        });
      }
    };

    const addFloatingText = (x: number, y: number, text: string, color: string) => {
      simRef.current.floatingTexts.push({ x, y, text, life: 40, color });
    };

    const loop = (timestamp: number) => {
      if (!gameLoopRef.current) return;

      const dt = timestamp - lastTimestamp;
      lastTimestamp = timestamp;
      frameCount++;
      const s = simRef.current;

      // Timer countdown
      secondAccumulator += dt;
      if (secondAccumulator >= 1000) {
        secondAccumulator -= 1000;
        s.timeLeft = Math.max(0, s.timeLeft - 1);
        // Ramp difficulty: spawn faster over time
        s.spawnInterval = Math.max(350, 900 - (30 - s.timeLeft) * 20);
        if (s.timeLeft <= 0) {
          setTimeout(() => endMiniGame(), 0);
          return;
        }
      }

      // Spawn targets
      spawnAccumulator += dt;
      if (spawnAccumulator >= s.spawnInterval) {
        spawnAccumulator -= s.spawnInterval;
        s.targets.push(spawnTarget());
      }

      // Age targets, apply drift, remove expired
      const alive: MiniGameTarget[] = [];
      let missed = 0;
      for (const t of s.targets) {
        t.life--;
        // Drift movement -- bounce off walls
        t.x += t.vx;
        t.y += t.vy;
        if (t.x - t.radius < 0 || t.x + t.radius > canvas.width) t.vx *= -1;
        if (t.y - t.radius < 40 || t.y + t.radius > canvas.height) t.vy *= -1;
        t.x = Math.max(t.radius, Math.min(canvas.width - t.radius, t.x));
        t.y = Math.max(40 + t.radius, Math.min(canvas.height - t.radius, t.y));
        if (t.life > 0) {
          alive.push(t);
        } else {
          missed++;
        }
      }
      if (missed > 0) {
        s.misses += missed;
        s.combo = 0;
      }
      s.targets = alive;

      // Update particles
      s.particles = s.particles.filter((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.08; // gravity
        p.life--;
        p.vx *= 0.98;
        return p.life > 0;
      });

      // Update floating texts
      s.floatingTexts = s.floatingTexts.filter((ft) => {
        ft.y -= 0.8;
        ft.life--;
        return ft.life > 0;
      });

      // Decay screen shake
      s.screenShake *= 0.85;
      if (s.screenShake < 0.5) s.screenShake = 0;

      // Sync to React periodically
      syncAccumulator += dt;
      if (syncAccumulator >= SYNC_INTERVAL) {
        syncAccumulator -= SYNC_INTERVAL;
        syncStateFromSim();
      }

      // --- DRAW ---
      ctx.save();
      // Apply screen shake — coherent noise (not random), scaled by trauma² so a
      // big combo hit reads dramatic and a small one stays subtle.
      if (s.screenShake > 0) {
        const t = frameCount * 0.35;
        const mag = (s.screenShake * s.screenShake) / 8; // trauma² feel, normalised to the 0–8 range
        const sx = shakeNoiseX(t, 0.5) * mag;
        const sy = shakeNoiseY(t, 11.5) * mag;
        ctx.translate(sx, sy);
      }

      ctx.clearRect(-5, -5, canvas.width + 10, canvas.height + 10);

      // Background grid with subtle pulse
      const gridAlpha = 0.06 + Math.sin(frameCount * 0.02) * 0.02;
      ctx.strokeStyle = `rgba(139, 92, 246, ${gridAlpha})`;
      ctx.lineWidth = 1;
      for (let x = 0; x < canvas.width; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
      }

      // Draw particles
      for (const p of s.particles) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, p.life / 10);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (p.life / 30), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Draw targets
      for (const t of s.targets) {
        const lifeRatio = t.life / t.maxLife;
        const pulse = 1 + Math.sin(frameCount * 0.15 + t.id) * 0.06;
        const r = t.radius * pulse;

        // Outer glow
        ctx.save();
        ctx.globalAlpha = lifeRatio * 0.25;
        ctx.beginPath();
        ctx.arc(t.x, t.y, r + 10, 0, Math.PI * 2);
        ctx.fillStyle = t.color;
        ctx.fill();
        ctx.restore();

        // Main circle
        ctx.save();
        ctx.globalAlpha = 0.2 + lifeRatio * 0.8;
        ctx.beginPath();
        ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
        ctx.fillStyle = t.color;
        ctx.fill();

        // Life ring (shrinks as life drains)
        ctx.beginPath();
        ctx.arc(t.x, t.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * lifeRatio);
        ctx.strokeStyle = lifeRatio < 0.3 ? '#ef4444' : '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Crosshair lines
        ctx.beginPath();
        ctx.moveTo(t.x - r * 0.4, t.y);
        ctx.lineTo(t.x + r * 0.4, t.y);
        ctx.moveTo(t.x, t.y - r * 0.4);
        ctx.lineTo(t.x, t.y + r * 0.4);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Points label
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.max(9, Math.round(r * 0.55))}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${t.points}`, t.x, t.y);
        ctx.restore();
      }

      // Draw floating texts (score popups)
      for (const ft of s.floatingTexts) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, ft.life / 15);
        ctx.fillStyle = ft.color;
        ctx.font = 'bold 16px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.restore();
      }

      // HUD bar background
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, canvas.width, 36);

      // HUD text
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Score: ${s.score}`, 12, 18);
      ctx.textAlign = 'right';
      // Timer color shifts red when low
      ctx.fillStyle = s.timeLeft <= 5 ? '#ef4444' : s.timeLeft <= 10 ? '#eab308' : 'rgba(255,255,255,0.9)';
      ctx.fillText(`Time: ${s.timeLeft}s`, canvas.width - 12, 18);
      // Combo
      if (s.combo > 1) {
        ctx.fillStyle = '#eab308';
        ctx.font = 'bold 15px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`COMBO x${s.combo}`, canvas.width / 2, 18);
      }
      // Accuracy
      const totalShots = s.hits + s.misses;
      if (totalShots > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`Acc: ${Math.round((s.hits / totalShots) * 100)}%`, 160, 18);
      }
      ctx.restore();

      ctx.restore(); // pop screen shake

      animFrameRef.current = requestAnimationFrame(loop);
    };

    // Handle canvas clicks within the loop scope via a ref-based approach
    const clickHandler = (e: MouseEvent) => {
      if (!gameLoopRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const mx = (e.clientX - rect.left) * scaleX;
      const my = (e.clientY - rect.top) * scaleY;
      const s = simRef.current;

      // Find the topmost target that was clicked
      let hitIndex = -1;
      for (let i = s.targets.length - 1; i >= 0; i--) {
        const t = s.targets[i];
        const dx = mx - t.x;
        const dy = my - t.y;
        if (dx * dx + dy * dy <= t.radius * t.radius) {
          hitIndex = i;
          break;
        }
      }

      if (hitIndex >= 0) {
        const target = s.targets[hitIndex];
        s.combo++;
        s.hits++;
        if (s.combo > s.bestCombo) s.bestCombo = s.combo;
        const comboMultiplier = 1 + (s.combo - 1) * 0.25;
        const points = Math.round(target.points * comboMultiplier);
        s.score += points;
        // Visual effects
        spawnParticles(target.x, target.y, target.color, 10 + s.combo * 2);
        addFloatingText(target.x, target.y - target.radius - 8,
          s.combo > 1 ? `+${points} x${s.combo}` : `+${points}`,
          s.combo > 3 ? '#eab308' : '#ffffff');
        s.screenShake = Math.min(8, 2 + s.combo);
        // Remove the target
        s.targets.splice(hitIndex, 1);
      } else {
        // Clicked empty space -- break combo
        s.combo = 0;
      }
    };

    canvas.addEventListener('click', clickHandler);
    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      canvas.removeEventListener('click', clickHandler);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mgState, endMiniGame, syncStateFromSim]);

  // Canvas click handler -- only used when NOT playing (idle/ended states use React onClick)
  const handleCanvasClick = useCallback((_e: React.MouseEvent<HTMLCanvasElement>) => {
    // Click handling during gameplay is done via native event listener in the game loop effect.
    // This React handler is a no-op; it exists so the onClick prop is always defined.
  }, []);

  // Fetch achievements from /api/game/achievements
  const { data: achievementsResp, isLoading, isError: isError, error: error, refetch: refetch } = useQuery({
    queryKey: ['game', 'achievements'],
    queryFn: () => api.get('/api/game/achievements').then(r => r.data),
  });
  const achievements: Achievement[] = (achievementsResp?.achievements || INITIAL_ACHIEVEMENTS).map((a: Record<string, unknown>) => ({
    id: a.id as string,
    name: a.name as string || a.id as string,
    description: a.description as string || '',
    icon: a.icon as string || '🏆',
    category: a.category as string || 'general',
    unlocked: !!(a.earned || a.unlocked),
    progress: (a.progress as number) || (a.earned ? 1 : 0),
    maxProgress: (a.maxProgress as number) || 1,
    xpReward: (a.xpReward as number) || 50,
    rarity: (a.rarity as Achievement['rarity']) || 'common',
  }));

  // Fetch challenges/quests from /api/game/challenges
  const { data: challengesResp, isError: isError2, error: error2, refetch: refetch2 } = useQuery({
    queryKey: ['game', 'challenges'],
    queryFn: () => api.get('/api/game/challenges').then(r => r.data),
  });
  const { create: createQuest } = useLensData<Quest>('game', 'quest', { noSeed: true });
  // /api/game/challenges has no difficulty/type-cadence concept server-side —
  // only these four fields are real. `progress`/`target` ARE real (computed
  // from live DTU/vote activity), so a challenge whose progress already
  // cleared its target starts 'completed' instead of always 'available'.
  const quests: Quest[] = (challengesResp?.challenges || INITIAL_QUESTS).map((c: Record<string, unknown>) => ({
    id: c.id as string,
    name: c.name as string,
    description: c.description as string,
    icon: '⚡',
    xpReward: (c.reward as number) || 100,
    type: 'challenge' as Quest['type'],
    status: (((c.progress as number) || 0) >= ((c.target as number) || Infinity) ? 'completed' : 'available') as QuestStatus,
    progress: c.progress as number | undefined,
    target: c.target as number | undefined,
  }));

  // Fetch profile from /api/game/profile
  const { data: profileResp, isError: isError3, error: error3, refetch: refetch3 } = useQuery({
    queryKey: ['game', 'profile'],
    queryFn: () => api.get('/api/game/profile').then(r => r.data),
  });
  const profileData = profileResp?.profile || null;

  // Fetch leaderboard from /api/game/leaderboard
  const { data: leaderboardResp, isError: isError4, error: error4, refetch: refetch4 } = useQuery({
    queryKey: ['game', 'leaderboard'],
    queryFn: () => api.get('/api/game/leaderboard').then(r => r.data),
  });
  const leaderboardData = (leaderboardResp?.leaderboard || INITIAL_LEADERBOARD) as Record<string, unknown>[];

  // Sync profile data into local state when available
  useEffect(() => {
    if (profileData?.xp && profileData.xp !== playerXp) {
      setPlayerXp(profileData.xp as number);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileData]);

  const { update: updateQuest } = useLensData<Quest>('game', 'quest', { noSeed: true });
  const completeQuestMutation = useMutation({
    mutationFn: (questId: string) => {
      const quest = quests.find(q => q.id === questId);
      return api.post(`/api/game/quests/${questId}/complete`, { xpReward: quest?.xpReward || 100 }).then(r => r.data);
    },
    onSuccess: () => { refetch2(); refetch3(); },
    onError: (err) => {
      console.error('Failed to complete quest:', err instanceof Error ? err.message : err);
    },
  });

  // Local quest status overrides (optimistic UI)
  const [questStatusOverrides, setQuestStatusOverrides] = useState<Record<string, QuestStatus>>({});
  const effectiveQuests = useMemo(() =>
    quests.map(q => questStatusOverrides[q.id] ? { ...q, status: questStatusOverrides[q.id] } : q),
    [quests, questStatusOverrides]
  );

  // Quest flow
  const acceptQuest = useCallback((id: string) => {
    setQuestStatusOverrides(prev => ({ ...prev, [id]: 'accepted' as QuestStatus }));
    updateQuest(id, { data: { status: 'accepted' } as unknown as Partial<Quest> })
      .catch(err => { console.error('Failed to accept quest:', err instanceof Error ? err.message : err); showToast('error', 'Failed to accept quest'); });
  }, [updateQuest]);

  const completeQuest = useCallback((id: string) => {
    const quest = quests.find((q) => q.id === id);
    if (!quest) return;
    setQuestStatusOverrides(prev => ({ ...prev, [id]: 'completed' as QuestStatus }));
    setPlayerXp((prev) => prev + quest.xpReward);
    completeQuestMutation.mutate(id);
  }, [quests, completeQuestMutation]);

  // Achievement unlock (optimistic UI - will refresh from API on next fetch)
  const [achievementOverrides, setAchievementOverrides] = useState<Record<string, boolean>>({});
  const effectiveAchievements = useMemo(() =>
    achievements.map(a => achievementOverrides[a.id] ? { ...a, unlocked: true, progress: a.maxProgress } : a),
    [achievements, achievementOverrides]
  );
  const triggerUnlock = useCallback((id: string) => {
    setAchievementOverrides(prev => ({ ...prev, [id]: true }));
    setUnlockAnim(id);
    const ach = achievements.find((a) => a.id === id);
    if (ach) setPlayerXp((prev) => prev + ach.xpReward);
    setTimeout(() => setUnlockAnim(null), 2000);
  }, [achievements]);

  // Create custom challenge (local-only, added to local quest list)
  const [localQuests, setLocalQuests] = useState<Quest[]>([]);
  const allQuests = useMemo(() => [...effectiveQuests, ...localQuests], [effectiveQuests, localQuests]);
  const submitChallenge = useCallback(() => {
    if (!newChallenge.name.trim()) return;
    const questData: Quest = { id: `q-custom-${Date.now()}`, name: newChallenge.name, description: newChallenge.description, icon: '🎯', xpReward: newChallenge.xpReward, difficulty: newChallenge.difficulty, type: 'challenge', status: 'available' };
    setLocalQuests((prev) => [...prev, questData]);
    createQuest({ title: questData.name, data: questData as unknown as Record<string, unknown>, meta: { status: 'active', tags: ['challenge', questData.difficulty] } })
      .then(() => { refetch2(); })
      .catch(err => { console.error('Failed to persist challenge:', err instanceof Error ? err.message : err); showToast('error', 'Challenge submission failed'); });
    setNewChallenge({ name: '', description: '', difficulty: 'medium', xpReward: 300 });
    setShowCreateChallenge(false);
  }, [newChallenge, createQuest, refetch2]);

  // Computed
  const filteredQuests = useMemo(() => {
    if (questFilter === 'all') return allQuests;
    return allQuests.filter((q) => q.type === questFilter);
  }, [allQuests, questFilter]);

  const sortedLeaderboard = useMemo(() => {
    const apiPlayers = (leaderboardData || []) as unknown as LeaderboardPlayer[];
    return [...apiPlayers].sort((a: LeaderboardPlayer, b: LeaderboardPlayer) => b.xp - a.xp);
  }, [leaderboardData]);

  // Global rank is derived client-side from the real leaderboard list — the
  // backend never sets a `rank` field on the profile object.
  const myRank = useMemo(() => {
    if (!authUser?.id) return null;
    const idx = sortedLeaderboard.findIndex((p) => p.userId === authUser.id);
    return idx === -1 ? null : idx + 1;
  }, [sortedLeaderboard, authUser?.id]);

  const profile = (profileData || INITIAL_PROFILE) as unknown as GameProfile;
  const xpHistory: XpHistoryEntry[] = (profile.xpHistory || INITIAL_XP_HISTORY) as XpHistoryEntry[];
  const xpMax = Math.max(1, ...xpHistory.map((d: { xp: number }) => d.xp));
  const level = profile.level || 1;
  const progressPct = ((playerXp) / ((profile.nextLevelXp as number) || 1000)) * 100;

  const TABS: { id: MainTab; label: string; icon: typeof Trophy }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { id: 'habits', label: 'Habit Hub', icon: Flame },
    { id: 'design', label: 'Design Lab', icon: FlaskConical },
    { id: 'quests', label: 'Quests', icon: Target },
    { id: 'achievements', label: 'Achievements', icon: Trophy },
    { id: 'leaderboard', label: 'Leaderboard', icon: Users },
    { id: 'history', label: 'XP History', icon: TrendingUp },
    { id: 'minigame', label: 'Mini-Game', icon: Gamepad2 },
    { id: 'trivia', label: 'Trivia', icon: Sparkles },
    { id: 'feed', label: 'Feed', icon: MessageSquare },
  ];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------


  if (isLoading) {
    return (
      <div data-lens-theme="game" className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-violet-400 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading game library...</p>
        </div>
      </div>
    );
  }

  if (isError || isError2 || isError3 || isError4) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message || error3?.message || error4?.message} onRetry={() => { refetch(); refetch2(); refetch3(); refetch4(); }} />
      </div>
    );
  }
  return (
    <LensShell lensId="game" asMain={false}>
      <FirstRunTour lensId="game" />
      <DepthBadge lensId="game" size="sm" className="ml-2" />
    <div className="p-6 space-y-6 min-h-screen">
      {/* Header */}
      <header className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
            <Swords className="w-6 h-6 text-amber-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Game Lens</h1>
            <p className="text-sm text-gray-400">Gamification platform &mdash; level up your skills and track progress</p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="game" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-neon-yellow font-mono text-sm">
            <Zap className="w-4 h-4" />
            {playerXp.toLocaleString()} XP
          </div>
          <div className="flex items-center gap-1 text-neon-pink font-mono text-sm">
            <Flame className="w-4 h-4" />
            {profile.streak || 0}d streak
          </div>
          <div className="flex items-center gap-1 text-neon-cyan font-mono text-sm">
            <Star className="w-4 h-4" />
            Lv {level}
          </div>
        </div>
      </header>

      {/* XP Progress Bar */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-400">Progress to Level {level + 1}</span>
          <span className="text-sm font-mono text-white">{playerXp.toLocaleString()} / {(profile.nextLevelXp || 1000).toLocaleString()} XP</span>
        </div>
        <div className="h-3 bg-lattice-bg rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-neon-blue via-neon-purple to-neon-pink rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(progressPct, 100)}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap pb-2 border-b border-lattice-border scrollbar-thin">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-t-lg transition-colors whitespace-nowrap text-sm',
                activeTab === tab.id ? 'bg-neon-purple/20 text-neon-purple border-b-2 border-neon-purple' : 'text-gray-400 hover:text-white',
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ================================================================= */}
      {/* DASHBOARD TAB                                                      */}
      {/* ================================================================= */}
      {activeTab === 'dashboard' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          {/* Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Level', value: level, icon: Star, color: 'text-neon-purple' },
              { label: 'Total XP', value: (profile.totalXpEarned || playerXp).toLocaleString(), icon: Zap, color: 'text-neon-yellow' },
              { label: 'Achievements', value: `${profile.achievements || effectiveAchievements.filter(a => a.unlocked).length}/${profile.totalAchievements || effectiveAchievements.length}`, icon: Trophy, color: 'text-neon-green' },
              { label: 'Day Streak', value: profile.streak || 0, icon: Flame, color: 'text-neon-pink' },
            ].map((s) => (
              <div key={s.label} className="lens-card text-center">
                <s.icon className={cn('w-8 h-8 mx-auto mb-2', s.color)} />
                <p className="text-2xl font-bold text-white">{s.value}</p>
                <p className="text-sm text-gray-400">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Secondary Stats — only real, server-computed values. `Challenges
              Won`/`Completion Rate` were removed: the backend has no field
              for either, so they used to render a permanent, misleading "0". */}
          <div className="grid grid-cols-2 gap-4 max-w-md">
            {[
              { label: 'Quests Done', value: profile.questsCompleted || quests.filter(q => q.status === 'completed').length, icon: Target, color: 'text-neon-cyan' },
              { label: 'Global Rank', value: myRank ? `#${myRank}` : '—', icon: ArrowUp, color: 'text-neon-blue' },
            ].map((s) => (
              <div key={s.label} className="lens-card text-center">
                <s.icon className={cn('w-6 h-6 mx-auto mb-1', s.color)} />
                <p className="text-xl font-bold text-white">{s.value}</p>
                <p className="text-xs text-gray-400">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Mini XP Chart on Dashboard */}
          <div className="panel p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">This Week&apos;s XP</h3>
            <div className="flex items-end gap-2 h-32">
              {xpHistory.map((d: XpHistoryEntry, dIndex: number) => (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-gray-400 font-mono">{d.xp}</span>
                  <motion.div
                    className="w-full rounded-t bg-gradient-to-t from-neon-purple to-neon-cyan"
                    initial={{ height: 0 }}
                    animate={{ height: `${(d.xp / xpMax) * 100}%` }}
                    transition={{ duration: 0.6, delay: 0.05 * dIndex }}
                  />
                  <span className="text-xs text-gray-400">{d.day}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Active Quests Preview */}
          <div className="panel p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-300">Active Quests</h3>
              <button onClick={() => setActiveTab('quests')} className="text-xs text-neon-cyan hover:underline">View all</button>
            </div>
            <div className="space-y-2">
              {quests.filter((q) => q.status === 'accepted').slice(0, 3).map((q) => (
                <div key={q.id} className="flex items-center justify-between bg-lattice-surface rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span>{q.icon}</span>
                    <span className="text-sm text-white">{q.name}</span>
                  </div>
                  <button onClick={() => completeQuest(q.id)} className="btn-neon text-xs py-1 px-3">Complete</button>
                </div>
              ))}
              {quests.filter((q) => q.status === 'accepted').length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">No active quests. Accept some from the Quests tab!</p>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* ================================================================= */}
      {/* HABIT HUB TAB — dailies, streaks, parties, cosmetics, rewards,     */}
      {/* reminders, cross-user challenges (Habitica behavior-change loop)   */}
      {/* ================================================================= */}
      {activeTab === 'habits' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <HabitHub onXpChange={(xp) => setPlayerXp((prev) => (xp > prev ? xp : prev))} />
        </motion.div>
      )}

      {/* ================================================================= */}
      {/* DESIGN LAB TAB — the 10 previously-dead game-design/balance and    */}
      {/* turn-based playtest macros, given a real, designed home instead   */}
      {/* of a permanently-disabled button wall. See GameDesignLab.tsx.     */}
      {/* ================================================================= */}
      {activeTab === 'design' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <GameDesignLab />
        </motion.div>
      )}

      {/* ================================================================= */}
      {/* QUESTS TAB                                                         */}
      {/* ================================================================= */}
      {activeTab === 'quests' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* Quest filter + create button */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex gap-1">
              {(['all', 'daily', 'weekly', 'challenge'] as const).map((f) => (
                <button key={f} onClick={() => setQuestFilter(f)} className={cn('px-3 py-1.5 rounded text-xs font-medium transition-colors', questFilter === f ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-400 hover:text-white')}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <button onClick={() => setShowCreateChallenge(true)} className="btn-neon text-sm py-1.5 px-4 flex items-center gap-1">
              <Plus className="w-4 h-4" /> Create Challenge
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredQuests.map((quest) => (
              <motion.div
                key={quest.id}
                layout
                className={cn('lens-card', quest.status === 'completed' && 'opacity-50')}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl">{quest.icon}</span>
                  <div className="flex items-center gap-2">
                    {quest.timeLeft && (
                      <span className="text-[10px] text-gray-400 flex items-center gap-1"><Clock className="w-3 h-3" />{quest.timeLeft}</span>
                    )}
                    {quest.difficulty && (
                      <span className={cn('text-xs px-2 py-0.5 rounded', difficultyStyle[quest.difficulty])}>{quest.difficulty}</span>
                    )}
                    <span className={cn('text-xs px-2 py-0.5 rounded', quest.type === 'daily' ? 'bg-neon-cyan/15 text-neon-cyan' : quest.type === 'weekly' ? 'bg-neon-purple/15 text-neon-purple' : 'bg-neon-yellow/15 text-neon-yellow')}>
                      {quest.type}
                    </span>
                  </div>
                </div>
                <h4 className="font-semibold text-white">{quest.name}</h4>
                <p className="text-sm text-gray-400 mt-1">{quest.description}</p>
                {quest.progress != null && quest.target != null && (
                  <div className="mt-2">
                    <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                      <span>Progress</span>
                      <span>{quest.progress}/{quest.target}</span>
                    </div>
                    <div className="h-1.5 bg-lattice-bg rounded-full overflow-hidden">
                      <div className="h-full bg-neon-cyan rounded-full" style={{ width: `${Math.min(100, (quest.progress / Math.max(1, quest.target)) * 100)}%` }} />
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-lattice-border">
                  <span className="text-sm text-neon-yellow flex items-center gap-1"><Zap className="w-4 h-4" />+{quest.xpReward} XP</span>
                  {quest.status === 'available' && (
                    <button onClick={() => acceptQuest(quest.id)} className="btn-neon text-sm py-1 px-4">Accept</button>
                  )}
                  {quest.status === 'accepted' && (
                    <button onClick={() => completeQuest(quest.id)} className="btn-neon text-sm py-1 px-4 flex items-center gap-1"><Check className="w-3 h-3" />Complete</button>
                  )}
                  {quest.status === 'completed' && (
                    <span className="text-sm text-neon-green flex items-center gap-1"><Check className="w-4 h-4" />Done</span>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ================================================================= */}
      {/* ACHIEVEMENTS TAB                                                   */}
      {/* ================================================================= */}
      {activeTab === 'achievements' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <p className="text-sm text-gray-400">
            {effectiveAchievements.filter((a) => a.unlocked).length} of {effectiveAchievements.length} achievements unlocked
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {effectiveAchievements.map((ach) => (
              <motion.div
                key={ach.id}
                layout
                className={cn('lens-card relative overflow-hidden', ach.unlocked ? 'border-neon-green/40' : '')}
              >
                <AnimatePresence>
                  {unlockAnim === ach.id && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 1.5 }}
                      className="absolute inset-0 flex items-center justify-center bg-neon-green/10 backdrop-blur-sm z-10"
                    >
                      <div className="text-center">
                        <motion.div animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.3, 1] }} transition={{ duration: 0.6 }}>
                          <Sparkles className="w-12 h-12 text-neon-yellow mx-auto" />
                        </motion.div>
                        <p className="text-neon-green font-bold mt-2">UNLOCKED!</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="flex items-start gap-3">
                  <span className="text-3xl">{ach.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-white text-sm">{ach.name}</h4>
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded border', rarityColor[ach.rarity])}>{ach.rarity}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{ach.description}</p>
                    <p className="text-[10px] text-gray-400 mt-1">Category: {ach.category}</p>
                    {!ach.unlocked && (
                      <div className="mt-2">
                        <div className="flex justify-between text-[10px] mb-1">
                          <span className="text-gray-400">Progress</span>
                          <span className="text-gray-300">{ach.progress}/{ach.maxProgress}</span>
                        </div>
                        <div className="h-1.5 bg-lattice-bg rounded-full overflow-hidden">
                          <motion.div
                            className="h-full bg-neon-blue rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${(ach.progress / ach.maxProgress) * 100}%` }}
                            transition={{ duration: 0.5 }}
                          />
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] text-neon-yellow flex items-center gap-0.5"><Zap className="w-3 h-3" />+{ach.xpReward} XP</span>
                      {!ach.unlocked && ach.progress >= ach.maxProgress * 0.9 && (
                        <button onClick={() => triggerUnlock(ach.id)} className="text-[10px] text-neon-green hover:underline">Claim</button>
                      )}
                      {ach.unlocked && <Trophy className="w-4 h-4 text-neon-green" />}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ================================================================= */}
      {/* LEADERBOARD TAB                                                    */}
      {/* ================================================================= */}
      {activeTab === 'leaderboard' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="flex gap-2">
            {(['weekly', 'monthly', 'alltime'] as LeaderboardPeriod[]).map((p) => (
              <button key={p} onClick={() => setLbPeriod(p)} className={cn('px-4 py-1.5 rounded text-sm transition-colors', lbPeriod === p ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-400 hover:text-white')}>
                {p === 'alltime' ? 'All Time' : p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
          <div className="panel overflow-hidden">
            {/* Backend note: /api/game/leaderboard has no per-user display-name
                or title join, so the table shows the real userId, not an
                invented display name. Avatar cosmetics + rewards live on the
                Habit Hub tab's real cosmetic shop — there is no separate XP
                shop macro, so one is not fabricated here. */}
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-lattice-border">
                  <th scope="col" className="pb-3 pt-4 px-4 w-16">Rank</th>
                  <th scope="col" className="pb-3 pt-4">Player</th>
                  <th scope="col" className="pb-3 pt-4 text-right">Level</th>
                  <th scope="col" className="pb-3 pt-4 text-right">Badges</th>
                  <th scope="col" className="pb-3 pt-4 text-right pr-4">XP</th>
                </tr>
              </thead>
              <tbody>
                {sortedLeaderboard.length === 0 && (
                  <tr><td colSpan={5} className="py-8 text-center text-gray-400">No players on the leaderboard yet. Start a game to climb the ranks.</td></tr>
                )}
                {sortedLeaderboard.length === 1 && (
                  <tr><td colSpan={5} className="py-4 text-center text-neon-cyan text-xs">🏔️ Pioneer — First on the leaderboard!</td></tr>
                )}
                {sortedLeaderboard.map((player, index) => {
                  const isCurrentUser = !!authUser?.id && player.userId === authUser.id;
                  return (
                    <motion.tr
                      key={player.userId}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.04 }}
                      className={cn('border-b border-lattice-border/30 transition-colors', isCurrentUser ? 'bg-neon-purple/10' : 'hover:bg-lattice-surface/50')}
                    >
                      <td className="py-3 px-4">
                        {sortedLeaderboard.length === 1 ? <Sparkles className="w-5 h-5 text-neon-cyan" /> : index === 0 ? <Crown className="w-5 h-5 text-neon-yellow" /> : index === 1 ? <span className="text-gray-300 font-bold">2</span> : index === 2 ? <span className="text-amber-600 font-bold">3</span> : <span className="text-gray-400">#{index + 1}</span>}
                      </td>
                      <td className="py-3 font-medium text-white text-sm font-mono">
                        {isCurrentUser ? (authUser?.username || player.userId) : player.userId}
                        {isCurrentUser && <span className="ml-2 text-[10px] text-neon-cyan font-sans">(you)</span>}
                      </td>
                      <td className="py-3 text-right text-sm">{player.level}</td>
                      <td className="py-3 text-right text-sm">{player.badges}</td>
                      <td className="py-3 text-right pr-4 font-mono text-neon-blue text-sm">{player.xp.toLocaleString()}</td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* ================================================================= */}
      {/* XP HISTORY TAB                                                     */}
      {/* ================================================================= */}
      {activeTab === 'history' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          {/* Bar Chart — /api/game/profile does not yet return a daily
              breakdown, so this is honestly empty until that field exists
              server-side, rather than a fabricated week of bars. */}
          <div className="panel p-6">
            <h3 className="font-semibold text-white mb-1">XP Earned This Week</h3>
            <p className="text-xs text-gray-400 mb-6">Total: {xpHistory.reduce((s: number, d: { xp: number }) => s + d.xp, 0).toLocaleString()} XP</p>
            {xpHistory.length > 0 ? (
              <div className="flex items-end gap-3 h-48">
                {xpHistory.map((d: { day: string; xp: number }, i: number) => (
                  <div key={d.day} className="flex-1 flex flex-col items-center gap-2">
                    <span className="text-xs text-gray-400 font-mono">{d.xp}</span>
                    <motion.div
                      className="w-full rounded-t-md bg-gradient-to-t from-neon-purple via-neon-blue to-neon-cyan"
                      initial={{ height: 0 }}
                      animate={{ height: `${(d.xp / xpMax) * 100}%` }}
                      transition={{ duration: 0.5, delay: i * 0.08 }}
                    />
                    <span className="text-xs text-gray-300 font-medium">{d.day}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic py-8 text-center">
                Daily XP breakdown isn&apos;t tracked server-side yet — lifetime XP and streak below are real.
              </p>
            )}
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="lens-card text-center">
              <p className="text-2xl font-bold text-neon-yellow">{(profile.totalXpEarned || playerXp).toLocaleString()}</p>
              <p className="text-xs text-gray-400 mt-1">Lifetime XP</p>
            </div>
            <div className="lens-card text-center">
              <p className="text-2xl font-bold text-neon-cyan">{Math.round(xpHistory.reduce((s: number, d: { xp: number }) => s + d.xp, 0) / Math.max(xpHistory.length, 1))}</p>
              <p className="text-xs text-gray-400 mt-1">Avg Daily XP</p>
            </div>
            <div className="lens-card text-center">
              <p className="text-2xl font-bold text-neon-green">{xpHistory.length > 0 ? Math.max(...xpHistory.map((d: { xp: number }) => d.xp)) : 0}</p>
              <p className="text-xs text-gray-400 mt-1">Best Day</p>
            </div>
            <div className="lens-card text-center">
              <p className="text-2xl font-bold text-neon-pink">{profile.longestStreak || 0}d</p>
              <p className="text-xs text-gray-400 mt-1">Longest Streak</p>
            </div>
          </div>

          {/* Recent Activity — real per-event XP/gold log for the Habitica-
              style gamification substrate (Habit Hub tasks / party quests /
              challenge prizes), backed by `game.xpLogList` (server/domains/
              game.js). This used to be a hardcoded fake feed (and one that
              literally referenced a different lens's content — "Compression
              skill", "Daily Mix Session"), then an honest "not tracked yet"
              placeholder. It's a real per-event ledger now — see
              XpActivityFeed. (The DTU-authorship-derived profile XP above
              this tab has no per-event concept of its own — it's a live
              computed snapshot, not an event log — so it still surfaces
              through the Recent panel below rather than this feed.) */}
          <XpActivityFeed />
        </motion.div>
      )}

      {/* ================================================================= */}
      {/* MINI-GAME TAB                                                      */}
      {/* ================================================================= */}
      {activeTab === 'minigame' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Target className="w-5 h-5 text-neon-purple" />
                Target Blitz
              </h3>
              <p className="text-sm text-gray-400">Click targets before they fade! Chain hits for combo multipliers. Earn XP based on your score.</p>
            </div>
            <div className="flex items-center gap-3">
              {mgState === 'idle' && (
                <button onClick={startMiniGame} className="btn-neon py-2 px-6 flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-amber-500">
                  <Gamepad2 className="w-4 h-4" /> Start Game
                </button>
              )}
              {mgState === 'playing' && (
                <button onClick={endMiniGame} className="text-sm text-gray-400 hover:text-white border border-gray-600 rounded px-4 py-2 transition-colors">
                  End Early
                </button>
              )}
              {mgState === 'ended' && (
                <button onClick={startMiniGame} className="btn-neon py-2 px-6 flex items-center gap-2">
                  <Gamepad2 className="w-4 h-4" /> Play Again
                </button>
              )}
            </div>
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {[
              { label: 'Score', value: mgScore, color: 'text-neon-yellow' },
              { label: 'Time', value: mgState === 'playing' ? `${mgTimeLeft}s` : mgState === 'ended' ? '0s' : '30s', color: mgTimeLeft <= 5 && mgState === 'playing' ? 'text-red-400' : 'text-white' },
              { label: 'Hits', value: mgHits, color: 'text-neon-green' },
              { label: 'Misses', value: mgMisses, color: 'text-red-400' },
              { label: 'Combo', value: mgCombo > 1 ? `x${mgCombo}` : '--', color: 'text-neon-cyan' },
              { label: 'Accuracy', value: (mgHits + mgMisses) > 0 ? `${Math.round((mgHits / (mgHits + mgMisses)) * 100)}%` : '--', color: 'text-neon-blue' },
            ].map((s) => (
              <div key={s.label} className="lens-card text-center py-2">
                <p className={cn('text-lg font-bold font-mono', s.color)}>{s.value}</p>
                <p className="text-[10px] text-gray-400">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Canvas */}
          <div className="panel p-2 relative overflow-hidden" style={{ background: 'rgba(0,0,0,0.4)' }}>
            {mgState === 'idle' && (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <div className="text-center space-y-3">
                  <Target className="w-16 h-16 text-neon-purple/50 mx-auto" />
                  <p className="text-gray-400 text-sm">Press <span className="text-white font-semibold">Start Game</span> to begin</p>
                  <p className="text-gray-400 text-xs">30 seconds &middot; Click targets &middot; Build combos &middot; Earn XP</p>
                </div>
              </div>
            )}
            {mgState === 'ended' && (
              <div className="absolute inset-0 flex items-center justify-center z-10 bg-black/60 backdrop-blur-sm">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="text-center space-y-4 p-8"
                >
                  <motion.div
                    animate={{ rotate: [0, -8, 8, -4, 4, 0], scale: [1, 1.15, 1] }}
                    transition={{ duration: 0.8 }}
                  >
                    <Trophy className="w-14 h-14 text-neon-yellow mx-auto" />
                  </motion.div>
                  <h4 className="text-2xl font-bold text-white">Game Over!</h4>
                  <div className="grid grid-cols-4 gap-4 text-center">
                    <div>
                      <p className="text-2xl font-bold font-mono text-neon-yellow">{mgScore}</p>
                      <p className="text-xs text-gray-400">Score</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold font-mono text-neon-green">{mgHits}</p>
                      <p className="text-xs text-gray-400">Hits</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold font-mono text-neon-blue">
                        {(mgHits + mgMisses) > 0 ? `${Math.round((mgHits / (mgHits + mgMisses)) * 100)}%` : '--'}
                      </p>
                      <p className="text-xs text-gray-400">Accuracy</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold font-mono text-neon-purple">{mgBestCombo > 1 ? `x${mgBestCombo}` : '--'}</p>
                      <p className="text-xs text-gray-400">Best Combo</p>
                    </div>
                  </div>
                  {mgXpAwarded > 0 && (
                    <motion.div
                      initial={{ y: 10, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ delay: 0.3 }}
                      className="flex items-center justify-center gap-2 text-neon-yellow bg-neon-yellow/10 border border-neon-yellow/30 rounded-lg py-2 px-4"
                    >
                      <Zap className="w-5 h-5" />
                      <span className="font-bold">+{mgXpAwarded} practice XP!</span>
                    </motion.div>
                  )}
                  <p className="text-xs text-gray-400">Practice score — not saved to your profile XP</p>
                </motion.div>
              </div>
            )}
            <canvas
              ref={canvasRef}
              width={800}
              height={450}
              onClick={handleCanvasClick}
              className={cn(
                'w-full rounded-lg',
                mgState === 'playing' ? 'cursor-crosshair' : 'cursor-default',
              )}
              style={{ aspectRatio: '16/9', imageRendering: 'auto' }}
            />
          </div>

          {/* How to play */}
          <div className="panel p-4">
            <h4 className="text-sm font-semibold text-gray-300 mb-2">How to Play</h4>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs text-gray-400">
              <div className="flex items-start gap-2">
                <Target className="w-4 h-4 text-neon-purple shrink-0 mt-0.5" />
                <span>Targets drift across the canvas. Click them before the ring timer runs out. Smaller targets are worth more points.</span>
              </div>
              <div className="flex items-start gap-2">
                <Flame className="w-4 h-4 text-neon-yellow shrink-0 mt-0.5" />
                <span>Hit consecutive targets to build combos. Each combo level adds +25% to your points. Clicking empty space breaks the chain.</span>
              </div>
              <div className="flex items-start gap-2">
                <TrendingUp className="w-4 h-4 text-neon-pink shrink-0 mt-0.5" />
                <span>Difficulty ramps up over time: targets spawn faster, shrink, and move quicker as the clock ticks down.</span>
              </div>
              <div className="flex items-start gap-2">
                <Zap className="w-4 h-4 text-neon-green shrink-0 mt-0.5" />
                <span>Your final score converts to practice XP (1 XP per 10 points, minimum 5 XP) for this session only — it&apos;s a warm-up, not saved profile progress.</span>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* ================================================================= */}
      {/* CREATE CHALLENGE MODAL                                             */}
      {/* ================================================================= */}
      <AnimatePresence>
        {showCreateChallenge && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowCreateChallenge(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="panel w-full max-w-lg p-6 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Create Challenge</h2>
                <button onClick={() => setShowCreateChallenge(false)} className="text-gray-400 hover:text-white" aria-label="Close"><X className="w-5 h-5" /></button>
              </div>

              <div>
                <label className="text-xs text-gray-400 mb-1 block">Challenge Name</label>
                <input
                  value={newChallenge.name}
                  onChange={(e) => setNewChallenge((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. 808 Bass Marathon"
                  className="input-lattice w-full"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 mb-1 block">Description</label>
                <textarea
                  value={newChallenge.description}
                  onChange={(e) => setNewChallenge((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Describe the challenge rules and goals..."
                  rows={3}
                  className="input-lattice w-full resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Difficulty</label>
                  <select
                    value={newChallenge.difficulty}
                    onChange={(e) => setNewChallenge((p) => ({ ...p, difficulty: e.target.value as Quest['difficulty'] }))}
                    className="input-lattice w-full"
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">XP Reward</label>
                  <input
                    type="number"
                    value={newChallenge.xpReward}
                    onChange={(e) => setNewChallenge((p) => ({ ...p, xpReward: Number(e.target.value) }))}
                    min={50}
                    max={2000}
                    step={50}
                    className="input-lattice w-full"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button onClick={() => setShowCreateChallenge(false)} className="text-sm text-gray-400 hover:text-white transition-colors px-4 py-2">Cancel</button>
                <button onClick={submitChallenge} disabled={!newChallenge.name.trim()} className={cn('btn-neon py-2 px-6', !newChallenge.name.trim() && 'opacity-40 cursor-not-allowed')}>
                  Create
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Small secondary AI-helper strip — no artifactId, per its own
          optional-prop contract. The page around it is bespoke, not the
          generic surface this could otherwise stand in for. */}

      {activeTab === 'trivia' && (
        <div className="mt-2">
          <TriviaPanel />
        </div>
      )}

      {activeTab === 'feed' && (
        <section className="mt-2 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <GameFeed />
        </section>
      )}

      {realtimeData && (
        <RealtimeDataPanel
          domain="game"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}      <CrossLensRecentsPanel lensId="game" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </div>
    </LensShell>
  );
}
