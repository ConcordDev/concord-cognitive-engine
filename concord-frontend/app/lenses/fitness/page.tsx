'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Dumbbell, Users, ListChecks, CalendarDays, Shield, Medal,
  Plus, Search, X, Trash2, Target, Timer, Zap, User, Calendar,
  TrendingUp, Award, Activity,
  ChevronRight, DollarSign, Calculator,
  MapPin, Phone, Mail,
  Brain, Layers, ArrowUpRight, ArrowDownRight, Minus,
  ClipboardList, UserPlus, Eye, FileText, ChevronDown, AlertTriangle,
  Flame, Footprints, Clock,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ModeTab = 'Clients' | 'Programs' | 'Workouts' | 'Classes' | 'Teams' | 'Recruiting';
type ArtifactType = 'Client' | 'Program' | 'Workout' | 'Class' | 'Team' | 'Athlete';
type Status = 'active' | 'paused' | 'completed' | 'deferred' | 'graduated';

type ExerciseCategory = 'Upper' | 'Lower' | 'Core' | 'Cardio' | 'Flexibility';
type TrainingPhase = 'Hypertrophy' | 'Strength' | 'Power' | 'Deload';
type RecruitStage = 'prospect' | 'contacted' | 'visited' | 'offered' | 'committed';

interface Exercise {
  id: string;
  name: string;
  category: ExerciseCategory;
  sets: number;
  reps: number;
  weight: number;
  restSeconds: number;
  rpe: number;
  isSuperset: boolean;
  supersetGroup: string;
  notes: string;
}

interface BodyMetric {
  date: string;
  weight: number;
  bodyFat: number;
  chest: number;
  waist: number;
  hips: number;
  arms: number;
  thighs: number;
}

interface PersonalRecord {
  exercise: string;
  weight: number;
  reps: number;
  date: string;
}

interface ProgressPhoto {
  date: string;
  label: string;
}

interface TrainingBlock {
  id: string;
  name: string;
  phase: TrainingPhase;
  weeks: number;
  weeklyVolume: number;
  overloadPercent: number;
  notes: string;
}

interface ClassSlot {
  id: string;
  day: string;
  time: string;
  name: string;
  instructor: string;
  capacity: number;
  enrolled: number;
  waitlist: number;
  pricePerHead: number;
  attended: number;
  cancellations: number;
}

interface RosterEntry {
  name: string;
  position: string;
  number: string;
  stats: string;
  status: 'active' | 'injured' | 'reserve';
}

interface SeasonGame {
  date: string;
  opponent: string;
  location: string;
  result: string;
}

interface FitnessArtifact {
  artifactType: ArtifactType;
  status: Status;
  description: string;
  coach?: string;
  category?: string;
  duration?: number;
  intensity?: 'low' | 'moderate' | 'high' | 'extreme';
  schedule?: string;
  goal?: string;
  startDate?: string;
  notes?: string;
  exercises?: Exercise[];
  bodyMetrics?: BodyMetric[];
  personalRecords?: PersonalRecord[];
  progressPhotos?: ProgressPhoto[];
  complianceRate?: number;
  goals?: { label: string; current: number; target: number }[];
  trainingBlocks?: TrainingBlock[];
  macroCycle?: string;
  mesoCycle?: string;
  microCycle?: string;
  autoProgressionRules?: string;
  classSlots?: ClassSlot[];
  roster?: RosterEntry[];
  seasonSchedule?: SeasonGame[];
  practicePlans?: string[];
  recruitStage?: RecruitStage;
  email?: string;
  phone?: string;
  location?: string;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MODE_TABS: { id: ModeTab; icon: React.ElementType; defaultType: ArtifactType }[] = [
  { id: 'Clients', icon: Users, defaultType: 'Client' },
  { id: 'Programs', icon: ListChecks, defaultType: 'Program' },
  { id: 'Workouts', icon: Dumbbell, defaultType: 'Workout' },
  { id: 'Classes', icon: CalendarDays, defaultType: 'Class' },
  { id: 'Teams', icon: Shield, defaultType: 'Team' },
  { id: 'Recruiting', icon: Medal, defaultType: 'Athlete' },
];

const ALL_STATUSES: Status[] = ['active', 'paused', 'completed', 'deferred', 'graduated'];

const STATUS_COLORS: Record<Status, string> = {
  active: 'red-400',
  paused: 'amber-400',
  completed: 'neon-cyan',
  deferred: 'gray-400',
  graduated: 'red-300',
};

const EXERCISE_LIBRARY: { name: string; category: ExerciseCategory }[] = [
  { name: 'Bench Press', category: 'Upper' },
  { name: 'Overhead Press', category: 'Upper' },
  { name: 'Barbell Row', category: 'Upper' },
  { name: 'Pull-ups', category: 'Upper' },
  { name: 'Dumbbell Curl', category: 'Upper' },
  { name: 'Tricep Dip', category: 'Upper' },
  { name: 'Lateral Raise', category: 'Upper' },
  { name: 'Back Squat', category: 'Lower' },
  { name: 'Front Squat', category: 'Lower' },
  { name: 'Deadlift', category: 'Lower' },
  { name: 'Romanian Deadlift', category: 'Lower' },
  { name: 'Leg Press', category: 'Lower' },
  { name: 'Lunges', category: 'Lower' },
  { name: 'Calf Raise', category: 'Lower' },
  { name: 'Plank', category: 'Core' },
  { name: 'Russian Twist', category: 'Core' },
  { name: 'Hanging Leg Raise', category: 'Core' },
  { name: 'Ab Wheel Rollout', category: 'Core' },
  { name: 'Cable Crunch', category: 'Core' },
  { name: 'Running', category: 'Cardio' },
  { name: 'Rowing', category: 'Cardio' },
  { name: 'Cycling', category: 'Cardio' },
  { name: 'Jump Rope', category: 'Cardio' },
  { name: 'Burpees', category: 'Cardio' },
  { name: 'Yoga Flow', category: 'Flexibility' },
  { name: 'Static Stretching', category: 'Flexibility' },
  { name: 'Foam Rolling', category: 'Flexibility' },
  { name: 'Hip Opener Series', category: 'Flexibility' },
];

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const CLASS_TIMES = ['6:00 AM', '7:00 AM', '8:00 AM', '9:00 AM', '10:00 AM', '12:00 PM', '4:00 PM', '5:00 PM', '6:00 PM', '7:00 PM'];

const RECRUIT_STAGES: RecruitStage[] = ['prospect', 'contacted', 'visited', 'offered', 'committed'];
const RECRUIT_STAGE_COLORS: Record<RecruitStage, string> = {
  prospect: 'gray-400',
  contacted: 'amber-400',
  visited: 'red-500',
  offered: 'red-300',
  committed: 'red-400',
};

const seedItems: { title: string; data: FitnessArtifact }[] = [];

/* ------------------------------------------------------------------ */
/*  Utility functions                                                  */
/* ------------------------------------------------------------------ */

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

function calcTotalVolume(exercises: Exercise[]): number {
  return exercises.reduce((sum, ex) => sum + ex.sets * ex.reps * ex.weight, 0);
}

function calcEstimatedDuration(exercises: Exercise[]): number {
  return exercises.reduce((sum, ex) => {
    const setTime = ex.sets * (30 + ex.restSeconds);
    return sum + setTime;
  }, 0) / 60;
}

function calcBMI(weightKg: number, heightCm: number): number {
  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
}

function calcBodyFatNavy(waist: number, neck: number, height: number, isMale: boolean, hip?: number): number {
  if (isMale) {
    return 495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(height)) - 450;
  }
  return 495 / (1.29579 - 0.35004 * Math.log10(waist + (hip || 0) - neck) + 0.22100 * Math.log10(height)) - 450;
}

function calcTDEE(weightKg: number, heightCm: number, age: number, isMale: boolean, activityLevel: number): number {
  const bmr = isMale
    ? 10 * weightKg + 6.25 * heightCm - 5 * age + 5
    : 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
  return Math.round(bmr * activityLevel);
}

function calcMacros(tdee: number, goal: 'cut' | 'maintain' | 'bulk', weightKg: number) {
  const cals = goal === 'cut' ? tdee - 500 : goal === 'bulk' ? tdee + 300 : tdee;
  const protein = Math.round(weightKg * 2.2);
  const fat = Math.round((cals * 0.25) / 9);
  const carbs = Math.round((cals - protein * 4 - fat * 9) / 4);
  return { calories: cals, protein, carbs, fat };
}

function calc1RMEpley(weight: number, reps: number): number {
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

function calc1RMBrzycki(weight: number, reps: number): number {
  if (reps === 1) return weight;
  return Math.round(weight * (36 / (37 - reps)));
}

/* ------------------------------------------------------------------ */
/*  Sub-panel components                                               */
/* ------------------------------------------------------------------ */

function ProgressBar({ value, max, color = 'red-400' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div data-lens-theme="fitness" className="w-full bg-lattice-elevated rounded-full h-2.5 overflow-hidden">
      <div className={cn(`h-full rounded-full bg-${color} transition-all duration-500`)} style={{ width: `${pct}%` }} />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, color = 'red-400' }: { icon: React.ElementType; label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className={ds.panel}>
      <Icon className={cn('w-5 h-5 mb-2', `text-${color}`)} />
      <p className="text-2xl font-bold">{value}</p>
      <p className={ds.textMuted}>{label}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Intensity color helper                                             */
/* ------------------------------------------------------------------ */

const INTENSITY_COLORS: Record<string, { ring: string; text: string; bg: string; label: string }> = {
  low:      { ring: '#22c55e', text: 'text-green-400',  bg: 'bg-green-400/10',  label: 'Light'    },
  moderate: { ring: '#eab308', text: 'text-yellow-400', bg: 'bg-yellow-400/10', label: 'Moderate' },
  high:     { ring: '#f97316', text: 'text-orange-400', bg: 'bg-orange-400/10', label: 'Intense'  },
  extreme:  { ring: '#ef4444', text: 'text-red-400',    bg: 'bg-red-400/10',    label: 'Extreme'  },
};

/* ------------------------------------------------------------------ */
/*  Workout Streak Counter                                             */
/* ------------------------------------------------------------------ */

function WorkoutStreakCounter() {
  const [streak, setStreak] = useState(7);
  const [bestStreak, setBestStreak] = useState(14);
  const days = ['M','T','W','T','F','S','S'];
  const [activeDays, setActiveDays] = useState([true, true, true, true, false, true, true]);

  const toggleDay = (dayIndex: number) => {
    setActiveDays(prev => {
      const next = [...prev];
      next[dayIndex] = !next[dayIndex];
      // Recalculate streak from active days
      const newStreak = next.filter(Boolean).length;
      setStreak(newStreak);
      if (newStreak > bestStreak) setBestStreak(newStreak);
      return next;
    });
  };

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Flame className="w-4 h-4 text-orange-400" /> Workout Streak
        </h3>
        <span className="text-xs text-gray-500">Best: {bestStreak} days</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative w-16 h-16 shrink-0">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 56 56">
            <circle cx="28" cy="28" r="24" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="5" />
            <circle cx="28" cy="28" r="24" fill="none"
              stroke="#f97316" strokeWidth="5" strokeLinecap="round"
              strokeDasharray={`${(streak / bestStreak) * 150.8} 150.8`}
              style={{ transition: 'stroke-dasharray 0.6s ease' }} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-lg font-bold text-orange-400">{streak}</span>
          </div>
        </div>
        <div className="flex-1 space-y-2">
          <p className="text-sm font-medium text-white">{streak}-day streak</p>
          <div className="flex gap-1">
            {days.map((d, i) => (
              <div key={i} className="flex flex-col items-center gap-1">
                <button onClick={() => toggleDay(i)} className={cn('w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors cursor-pointer',
                  activeDays[i] ? 'bg-orange-500 text-white' : 'bg-white/5 text-gray-500 hover:bg-white/10'
                )}>{d}</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Daily Goals Progress Rings                                         */
/* ------------------------------------------------------------------ */

function DailyGoalsRings() {
  const goals = [
    { label: 'Steps',    icon: Footprints, current: 7432,  target: 10000, color: '#22c55e',  unit: 'steps' },
    { label: 'Calories', icon: Flame,      current: 1840,  target: 2500,  color: '#f97316',  unit: 'kcal'  },
    { label: 'Minutes',  icon: Clock,      current: 38,    target: 60,    color: '#06b6d4',  unit: 'min'   },
  ];

  return (
    <div className="panel p-4">
      <h3 className="font-semibold mb-4 text-sm">Daily Goals</h3>
      <div className="grid grid-cols-3 gap-4">
        {goals.map((g) => {
          const pct = Math.min(100, (g.current / g.target) * 100);
          const r = 28;
          const circ = 2 * Math.PI * r;
          const dash = (pct / 100) * circ;
          return (
            <div key={g.label} className="flex flex-col items-center gap-2">
              <div className="relative w-16 h-16">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="5" />
                  <circle cx="32" cy="32" r={r} fill="none"
                    stroke={g.color} strokeWidth="5" strokeLinecap="round"
                    strokeDasharray={`${dash} ${circ}`}
                    style={{ transition: 'stroke-dasharray 0.6s ease' }} />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <g.icon className="w-4 h-4" style={{ color: g.color }} />
                </div>
              </div>
              <div className="text-center">
                <p className="text-xs font-semibold" style={{ color: g.color }}>{Math.round(pct)}%</p>
                <p className="text-xs text-gray-500">{g.label}</p>
                <p className="text-xs text-gray-600">{g.current.toLocaleString()}/{g.target.toLocaleString()}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Exercise Set Tracker                                               */
/* ------------------------------------------------------------------ */

interface SetLog { reps: number; weight: number; done: boolean }

function ExerciseSetTracker() {
  const [sets, setSets] = useState<SetLog[]>([
    { reps: 10, weight: 60, done: false },
    { reps: 10, weight: 60, done: false },
    { reps: 8,  weight: 65, done: false },
  ]);
  const [exerciseName, setExerciseName] = useState('Bench Press');
  const [intensity, setIntensity] = useState<'low'|'moderate'|'high'|'extreme'>('moderate');
  const intConf = INTENSITY_COLORS[intensity];

  const toggleSet = (i: number) =>
    setSets(prev => prev.map((s, idx) => idx === i ? { ...s, done: !s.done } : s));
  const addSet = () =>
    setSets(prev => [...prev, { reps: prev[prev.length-1]?.reps || 10, weight: prev[prev.length-1]?.weight || 0, done: false }]);
  const removeSet = (i: number) =>
    setSets(prev => prev.filter((_, idx) => idx !== i));
  const updateSet = (i: number, field: 'reps'|'weight', val: number) =>
    setSets(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: val } : s));

  const doneSets = sets.filter(s => s.done).length;

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Dumbbell className="w-4 h-4 text-red-400" />
          <input value={exerciseName} onChange={e => setExerciseName(e.target.value)}
            className="bg-transparent border-none focus:outline-none font-semibold text-sm text-white" />
        </div>
        <div className="flex items-center gap-2">
          <select value={intensity} onChange={e => setIntensity(e.target.value as typeof intensity)}
            className={cn('text-xs px-2 py-0.5 rounded border', intConf.text, intConf.bg, 'border-current/30')}>
            <option value="low">Light</option>
            <option value="moderate">Moderate</option>
            <option value="high">Intense</option>
            <option value="extreme">Extreme</option>
          </select>
        </div>
      </div>
      <div className="text-xs text-gray-500 flex items-center gap-2">
        <span className={cn('px-2 py-0.5 rounded font-medium', intConf.text, intConf.bg)}>{intConf.label}</span>
        <span>{doneSets}/{sets.length} sets done</span>
      </div>
      <div className="space-y-1.5">
        {sets.map((s, i) => (
          <motion.div key={i} layout
            className={cn('flex items-center gap-2 rounded-lg px-3 py-2 transition-colors',
              s.done ? 'bg-green-500/10 border border-green-500/20' : 'bg-white/4 border border-white/8'
            )}>
            <button onClick={() => toggleSet(i)}
              className={cn('w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors',
                s.done ? 'bg-green-500 border-green-500' : 'border-gray-500 hover:border-green-400'
              )}>
              {s.done && <span className="text-white text-xs">✓</span>}
            </button>
            <span className="text-xs text-gray-400 w-8">Set {i+1}</span>
            <input type="number" value={s.weight} onChange={e => updateSet(i, 'weight', parseFloat(e.target.value)||0)}
              className="w-14 bg-white/5 border border-white/10 rounded px-2 py-0.5 text-xs text-center" />
            <span className="text-xs text-gray-500">kg ×</span>
            <input type="number" value={s.reps} onChange={e => updateSet(i, 'reps', parseInt(e.target.value)||0)}
              className="w-12 bg-white/5 border border-white/10 rounded px-2 py-0.5 text-xs text-center" />
            <span className="text-xs text-gray-500">reps</span>
            <button onClick={() => removeSet(i)} className="ml-auto text-gray-600 hover:text-red-400">
              <X className="w-3 h-3" />
            </button>
          </motion.div>
        ))}
      </div>
      <button onClick={addSet} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
        <Plus className="w-3 h-3" /> Add Set
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function FitnessLensPage() {
  useLensNav('fitness');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('fitness');

  /* ---------- core state ---------- */
  const [showFeatures, setShowFeatures] = useState(true);
  const [showDailyPanel, setShowDailyPanel] = useState(false);
  const [activeTab, setActiveTab] = useState<ModeTab>('Clients');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<Status | 'all'>('all');
  const [showEditor, setShowEditor] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<FitnessArtifact> | null>(null);
  const [selectedClient, setSelectedClient] = useState<LensItem<FitnessArtifact> | null>(null);
  const [showBodyComp, setShowBodyComp] = useState(false);
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);

  /* ---------- editor form state ---------- */
  const [formTitle, setFormTitle] = useState('');
  const [formType, setFormType] = useState<ArtifactType>('Client');
  const [formStatus, setFormStatus] = useState<Status>('active');
  const [formDescription, setFormDescription] = useState('');
  const [formCoach, setFormCoach] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formDuration, setFormDuration] = useState('');
  const [formIntensity, setFormIntensity] = useState<'low' | 'moderate' | 'high' | 'extreme'>('moderate');
  const [formSchedule, setFormSchedule] = useState('');
  const [formGoal, setFormGoal] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formNotes, setFormNotes] = useState('');

  /* ---------- workout builder state ---------- */
  const [workoutExercises, setWorkoutExercises] = useState<Exercise[]>([]);
  const [exerciseFilter, setExerciseFilter] = useState<ExerciseCategory | 'All'>('All');
  const [showExerciseLibrary, setShowExerciseLibrary] = useState(false);

  /* ---------- program periodization state ---------- */
  const [trainingBlocks, setTrainingBlocks] = useState<TrainingBlock[]>([]);
  const [formMacroCycle, setFormMacroCycle] = useState('');
  const [formMesoCycle, setFormMesoCycle] = useState('');
  const [formMicroCycle, setFormMicroCycle] = useState('');
  const [formAutoProgression, setFormAutoProgression] = useState('');

  /* ---------- class schedule state ---------- */
  const [classSlots, setClassSlots] = useState<ClassSlot[]>([]);
  const [classViewDay, setClassViewDay] = useState<string>('Monday');

  /* ---------- team / recruiting state ---------- */
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [seasonGames, setSeasonGames] = useState<SeasonGame[]>([]);
  const [formRecruitStage, setFormRecruitStage] = useState<RecruitStage>('prospect');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formLocation, setFormLocation] = useState('');

  /* ---------- body comp calculator state ---------- */
  const [bcWeight, setBcWeight] = useState('');
  const [bcHeight, setBcHeight] = useState('');
  const [bcAge, setBcAge] = useState('');
  const [bcIsMale, setBcIsMale] = useState(true);
  const [bcActivity, setBcActivity] = useState('1.55');
  const [bcGoal, setBcGoal] = useState<'cut' | 'maintain' | 'bulk'>('maintain');
  const [bcWaist, setBcWaist] = useState('');
  const [bcNeck, setBcNeck] = useState('');
  const [bcHip, setBcHip] = useState('');
  const [bc1rmWeight, setBc1rmWeight] = useState('');
  const [bc1rmReps, setBc1rmReps] = useState('');

  /* ---------- client progress state ---------- */
  const [clientMetrics, setClientMetrics] = useState<BodyMetric[]>([]);
  const [clientPRs, setClientPRs] = useState<PersonalRecord[]>([]);
  const [clientPhotos, setClientPhotos] = useState<ProgressPhoto[]>([]);
  const [clientGoals, setClientGoals] = useState<{ label: string; current: number; target: number }[]>([]);

  /* ---------- data hooks ---------- */
  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<FitnessArtifact>('fitness', 'artifact', {
    seed: seedItems.map(s => ({ title: s.title, data: s.data as unknown as Record<string, unknown>, meta: { status: s.data.status, tags: [s.data.artifactType] } })),
  });

  const runAction = useRunArtifact('fitness');

  /* ---------- derived ---------- */
  const currentTabType = MODE_TABS.find(t => t.id === activeTab)?.defaultType ?? 'Client';

  const filtered = useMemo(() => {
    let list = items.filter(i => (i.data as unknown as FitnessArtifact).artifactType === currentTabType);
    if (filterStatus !== 'all') list = list.filter(i => (i.data as unknown as FitnessArtifact).status === filterStatus);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(i => i.title.toLowerCase().includes(q) || (i.data as unknown as FitnessArtifact).description?.toLowerCase().includes(q));
    }
    return list;
  }, [items, currentTabType, filterStatus, searchQuery]);

  const stats = useMemo(() => {
    const all = items;
    const clients = all.filter(i => (i.data as unknown as FitnessArtifact).artifactType === 'Client');
    const activeClients = clients.filter(i => (i.data as unknown as FitnessArtifact).status === 'active');
    const classes = all.filter(i => (i.data as unknown as FitnessArtifact).artifactType === 'Class' && (i.data as unknown as FitnessArtifact).status === 'active');
    const totalClassRevenue = classes.reduce((sum, c) => {
      const d = c.data as unknown as FitnessArtifact;
      return sum + (d.classSlots || []).reduce((s, slot) => s + slot.enrolled * slot.pricePerHead, 0);
    }, 0);

    return {
      activeClients: activeClients.length,
      totalClients: clients.length,
      programs: all.filter(i => (i.data as unknown as FitnessArtifact).artifactType === 'Program').length,
      workouts: all.filter(i => (i.data as unknown as FitnessArtifact).artifactType === 'Workout').length,
      weeklyClasses: classes.length,
      teams: all.filter(i => (i.data as unknown as FitnessArtifact).artifactType === 'Team').length,
      prospects: all.filter(i => (i.data as unknown as FitnessArtifact).artifactType === 'Athlete').length,
      retentionRate: clients.length > 0 ? Math.round((activeClients.length / clients.length) * 100) : 0,
      monthlyRevenue: totalClassRevenue,
      sessionsThisWeek: all.filter(i => (i.data as unknown as FitnessArtifact).artifactType === 'Workout' && (i.data as unknown as FitnessArtifact).status === 'active').length,
    };
  }, [items]);

  /* ---------- editor helpers ---------- */

  const resetForm = useCallback(() => {
    setFormTitle('');
    setFormType(currentTabType);
    setFormStatus('active');
    setFormDescription('');
    setFormCoach('');
    setFormCategory('');
    setFormDuration('');
    setFormIntensity('moderate');
    setFormSchedule('');
    setFormGoal('');
    setFormStartDate('');
    setFormNotes('');
    setWorkoutExercises([]);
    setTrainingBlocks([]);
    setFormMacroCycle('');
    setFormMesoCycle('');
    setFormMicroCycle('');
    setFormAutoProgression('');
    setClassSlots([]);
    setRoster([]);
    setSeasonGames([]);
    setFormRecruitStage('prospect');
    setFormEmail('');
    setFormPhone('');
    setFormLocation('');
  }, [currentTabType]);

  const openNewEditor = () => {
    setEditingItem(null);
    resetForm();
    setShowEditor(true);
  };

  const openEditEditor = (item: LensItem<FitnessArtifact>) => {
    const d = item.data as unknown as FitnessArtifact;
    setEditingItem(item);
    setFormTitle(item.title);
    setFormType(d.artifactType);
    setFormStatus(d.status);
    setFormDescription(d.description || '');
    setFormCoach(d.coach || '');
    setFormCategory(d.category || '');
    setFormDuration(d.duration != null ? String(d.duration) : '');
    setFormIntensity(d.intensity || 'moderate');
    setFormSchedule(d.schedule || '');
    setFormGoal(d.goal || '');
    setFormStartDate(d.startDate || '');
    setFormNotes(d.notes || '');
    setWorkoutExercises(d.exercises || []);
    setTrainingBlocks(d.trainingBlocks || []);
    setFormMacroCycle(d.macroCycle || '');
    setFormMesoCycle(d.mesoCycle || '');
    setFormMicroCycle(d.microCycle || '');
    setFormAutoProgression(d.autoProgressionRules || '');
    setClassSlots(d.classSlots || []);
    setRoster(d.roster || []);
    setSeasonGames(d.seasonSchedule || []);
    setFormRecruitStage(d.recruitStage || 'prospect');
    setFormEmail(d.email || '');
    setFormPhone(d.phone || '');
    setFormLocation(d.location || '');
    setShowEditor(true);
  };

  const handleSave = async () => {
    const payload = {
      title: formTitle,
      data: {
        artifactType: formType, status: formStatus, description: formDescription,
        coach: formCoach, category: formCategory,
        duration: formDuration ? parseInt(formDuration) : undefined,
        intensity: formIntensity, schedule: formSchedule, goal: formGoal,
        startDate: formStartDate, notes: formNotes,
        exercises: workoutExercises.length > 0 ? workoutExercises : undefined,
        trainingBlocks: trainingBlocks.length > 0 ? trainingBlocks : undefined,
        macroCycle: formMacroCycle || undefined,
        mesoCycle: formMesoCycle || undefined,
        microCycle: formMicroCycle || undefined,
        autoProgressionRules: formAutoProgression || undefined,
        classSlots: classSlots.length > 0 ? classSlots : undefined,
        roster: roster.length > 0 ? roster : undefined,
        seasonSchedule: seasonGames.length > 0 ? seasonGames : undefined,
        recruitStage: formType === 'Athlete' ? formRecruitStage : undefined,
        email: formEmail || undefined,
        phone: formPhone || undefined,
        location: formLocation || undefined,
      } as unknown as Partial<FitnessArtifact>,
      meta: { status: formStatus, tags: [formType] },
    };
    if (editingItem) await update(editingItem.id, payload);
    else await create(payload);
    setShowEditor(false);
  };

  const handleAction = async (action: string, artifactId?: string) => {
    const targetId = artifactId || editingItem?.id || filtered[0]?.id;
    if (!targetId) return;
    try {
      const result = await runAction.mutateAsync({ id: targetId, action });
      if (result.ok === false) { setActionResult({ message: `Action failed: ${(result as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(result.result as Record<string, unknown>); }
    } catch (err) {
      console.error('Action failed:', err);
    }
  };

  const openClientDashboard = (item: LensItem<FitnessArtifact>) => {
    const d = item.data as unknown as FitnessArtifact;
    setSelectedClient(item);
    setClientMetrics(d.bodyMetrics || []);
    setClientPRs(d.personalRecords || []);
    setClientPhotos(d.progressPhotos || []);
    setClientGoals(d.goals || []);
  };

  const saveClientProgress = async () => {
    if (!selectedClient) return;
    const d = selectedClient.data as unknown as FitnessArtifact;
    await update(selectedClient.id, {
      data: {
        ...d,
        bodyMetrics: clientMetrics,
        personalRecords: clientPRs,
        progressPhotos: clientPhotos,
        goals: clientGoals,
      } as unknown as Partial<FitnessArtifact>,
    });
    // Refresh the selected client reference
    const updated = items.find(i => i.id === selectedClient.id);
    if (updated) setSelectedClient(updated);
  };

  /* ---------- workout builder helpers ---------- */

  const addExercise = (name: string, category: ExerciseCategory) => {
    setWorkoutExercises(prev => [...prev, {
      id: generateId(), name, category, sets: 3, reps: 10, weight: 0,
      restSeconds: 60, rpe: 7, isSuperset: false, supersetGroup: '', notes: '',
    }]);
  };

  const updateExercise = (id: string, field: keyof Exercise, value: string | number | boolean) => {
    setWorkoutExercises(prev => prev.map(ex => ex.id === id ? { ...ex, [field]: value } : ex));
  };

  const removeExercise = (id: string) => {
    setWorkoutExercises(prev => prev.filter(ex => ex.id !== id));
  };

  /* ---------- training block helpers ---------- */

  const addTrainingBlock = () => {
    setTrainingBlocks(prev => [...prev, {
      id: generateId(), name: 'New Block', phase: 'Hypertrophy',
      weeks: 4, weeklyVolume: 0, overloadPercent: 5, notes: '',
    }]);
  };

  const updateBlock = (id: string, field: keyof TrainingBlock, value: string | number) => {
    setTrainingBlocks(prev => prev.map(b => b.id === id ? { ...b, [field]: value } : b));
  };

  const removeBlock = (id: string) => {
    setTrainingBlocks(prev => prev.filter(b => b.id !== id));
  };

  /* ---------- class schedule helpers ---------- */

  const addClassSlot = () => {
    setClassSlots(prev => [...prev, {
      id: generateId(), day: classViewDay, time: '9:00 AM', name: 'New Class',
      instructor: '', capacity: 20, enrolled: 0, waitlist: 0,
      pricePerHead: 25, attended: 0, cancellations: 0,
    }]);
  };

  const updateClassSlot = (id: string, field: keyof ClassSlot, value: string | number) => {
    setClassSlots(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const removeClassSlot = (id: string) => {
    setClassSlots(prev => prev.filter(s => s.id !== id));
  };

  /* ---------- roster helpers ---------- */

  const addRosterEntry = () => {
    setRoster(prev => [...prev, { name: '', position: '', number: '', stats: '', status: 'active' }]);
  };

  const updateRosterEntry = (idx: number, field: keyof RosterEntry, value: string) => {
    setRoster(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const removeRosterEntry = (idx: number) => {
    setRoster(prev => prev.filter((_, i) => i !== idx));
  };

  /* ---------- season schedule helpers ---------- */

  const addSeasonGame = () => {
    setSeasonGames(prev => [...prev, { date: '', opponent: '', location: '', result: '' }]);
  };

  /* ---------- client metric helpers ---------- */

  const addClientMetric = () => {
    setClientMetrics(prev => [...prev, {
      date: new Date().toISOString().split('T')[0], weight: 0, bodyFat: 0,
      chest: 0, waist: 0, hips: 0, arms: 0, thighs: 0,
    }]);
  };

  const addClientPR = () => {
    setClientPRs(prev => [...prev, { exercise: '', weight: 0, reps: 1, date: new Date().toISOString().split('T')[0] }]);
  };

  const addClientPhoto = () => {
    setClientPhotos(prev => [...prev, { date: new Date().toISOString().split('T')[0], label: 'Progress check-in' }]);
  };

  const addClientGoal = () => {
    setClientGoals(prev => [...prev, { label: '', current: 0, target: 100 }]);
  };

  const intensityColor = (level: string) => {
    switch (level) {
      case 'low': return 'red-400';
      case 'moderate': return 'red-500';
      case 'high': return 'amber-400';
      case 'extreme': return 'red-400';
      default: return 'gray-400';
    }
  };

  /* ---------- body comp calculations ---------- */

  const bmi = bcWeight && bcHeight ? calcBMI(parseFloat(bcWeight), parseFloat(bcHeight)) : null;
  const bodyFatEst = bcWaist && bcNeck && bcHeight
    ? calcBodyFatNavy(parseFloat(bcWaist), parseFloat(bcNeck), parseFloat(bcHeight), bcIsMale, bcHip ? parseFloat(bcHip) : undefined)
    : null;
  const tdee = bcWeight && bcHeight && bcAge
    ? calcTDEE(parseFloat(bcWeight), parseFloat(bcHeight), parseInt(bcAge), bcIsMale, parseFloat(bcActivity))
    : null;
  const macros = tdee && bcWeight ? calcMacros(tdee, bcGoal, parseFloat(bcWeight)) : null;
  const oneRMEpley = bc1rmWeight && bc1rmReps ? calc1RMEpley(parseFloat(bc1rmWeight), parseInt(bc1rmReps)) : null;
  const oneRMBrzycki = bc1rmWeight && bc1rmReps ? calc1RMBrzycki(parseFloat(bc1rmWeight), parseInt(bc1rmReps)) : null;

  /* ---------- render ---------- */

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-red-400 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading workout data...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className={ds.pageContainer}>
      {/* Fitness Disclaimer */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-200">
          Not medical advice. Consult a physician before starting any exercise program. This tool is for fitness tracking and programming, not clinical guidance.
        </p>
      </div>
      {/* ========== Header ========== */}
      <header className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <Dumbbell className="w-7 h-7 text-red-400" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className={ds.heading1}>Fitness & Wellness</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className={ds.textMuted}>Client management, programming, scheduling, and recruiting</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowDailyPanel(p => !p)}
            className={cn(ds.btnSecondary, showDailyPanel && 'bg-orange-500/20 border-orange-500/40 text-orange-400')}>
            <Flame className="w-4 h-4" /> Daily Tracker
          </button>
          <button onClick={() => setShowBodyComp(true)} className={ds.btnSecondary}>
            <Calculator className="w-4 h-4" /> Body Comp Tools
          </button>
          <button onClick={openNewEditor} className={ds.btnPrimary}>
            <Plus className="w-4 h-4" /> New Record
          </button>
          {runAction.isPending && <span className="text-xs text-red-500 animate-pulse">Running...</span>}
        </div>
      </header>


      {/* AI Actions */}
      <UniversalActions domain="fitness" artifactId={items[0]?.id} compact />
      <RealtimeDataPanel domain="fitness" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <DTUExportButton domain="fitness" data={{}} compact />
      {/* ========== Mode Tabs ========== */}
      <nav className="flex items-center gap-1 border-b border-lattice-border pb-3 flex-wrap">
        {MODE_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setFilterStatus('all'); setSelectedClient(null); }}
            className={cn(ds.btnGhost, 'whitespace-nowrap', activeTab === tab.id && 'bg-red-400/20 text-red-400')}
          >
            <tab.icon className="w-4 h-4" />
            {tab.id}
          </button>
        ))}
      </nav>

      {/* ========== Enhanced Dashboard ========== */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={Users} label="Active Clients" value={stats.activeClients} sub={`${stats.retentionRate}% retention`} color="red-400" />
        <StatCard icon={Activity} label="Sessions / Week" value={stats.sessionsThisWeek} color="red-500" />
        <StatCard icon={DollarSign} label="Class Revenue" value={`$${stats.monthlyRevenue}`} color="neon-cyan" />
        <StatCard icon={ListChecks} label="Programs" value={stats.programs} color="red-300" />
        <StatCard icon={CalendarDays} label="Active Classes" value={stats.weeklyClasses} color="amber-400" />
        <StatCard icon={Medal} label="Prospects" value={stats.prospects} color="red-400" />
      </div>

      {/* ========== Daily Tracker Panel ========== */}
      <AnimatePresence>
        {showDailyPanel && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <WorkoutStreakCounter />
              <DailyGoalsRings />
              <ExerciseSetTracker />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ========== Domain Actions ========== */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-3')}>Quick Actions</h3>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => handleAction('calculate-progression')} className={cn(ds.btnSmall, 'bg-red-400/20 text-red-400 border border-red-400/30')}>
            <TrendingUp className="w-3.5 h-3.5" /> Calculate Progression
          </button>
          <button onClick={() => handleAction('generate-program')} className={cn(ds.btnSmall, 'bg-red-500/20 text-red-500 border border-red-500/30')}>
            <Brain className="w-3.5 h-3.5" /> Generate Program
          </button>
          <button onClick={() => handleAction('body-comp-report')} className={cn(ds.btnSmall, 'bg-red-300/20 text-red-300 border border-red-300/30')}>
            <FileText className="w-3.5 h-3.5" /> Body Comp Report
          </button>
          <button onClick={() => handleAction('attendance-report')} className={cn(ds.btnSmall, 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30')}>
            <ClipboardList className="w-3.5 h-3.5" /> Attendance Report
          </button>
        </div>
      </div>

      {/* ========== Client Progress Dashboard ========== */}
      {activeTab === 'Clients' && selectedClient && (() => {
        const cd = selectedClient.data as unknown as FitnessArtifact;
        return (
          <section className={ds.panel}>
            <div className={cn(ds.sectionHeader, 'mb-4')}>
              <div className="flex items-center gap-3">
                <User className="w-5 h-5 text-red-400" />
                <h2 className={ds.heading2}>{selectedClient.title} - Progress Dashboard</h2>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={saveClientProgress} className={cn(ds.btnSmall, 'bg-red-400/20 text-red-400 border border-red-400/30')}>
                  Save Progress
                </button>
                <button onClick={() => setSelectedClient(null)} className={ds.btnGhost}><X className="w-4 h-4" /></button>
              </div>
            </div>

            {/* Compliance & overview */}
            <div className={ds.grid4}>
              <div className={ds.panel}>
                <p className={ds.textMuted}>Compliance Rate</p>
                <p className="text-2xl font-bold text-red-400">{cd.complianceRate || 0}%</p>
                <ProgressBar value={cd.complianceRate || 0} max={100} color="red-400" />
              </div>
              <div className={ds.panel}>
                <p className={ds.textMuted}>Personal Records</p>
                <p className="text-2xl font-bold text-amber-400">{clientPRs.length}</p>
              </div>
              <div className={ds.panel}>
                <p className={ds.textMuted}>Progress Photos</p>
                <p className="text-2xl font-bold text-red-500">{clientPhotos.length}</p>
              </div>
              <div className={ds.panel}>
                <p className={ds.textMuted}>Active Goals</p>
                <p className="text-2xl font-bold text-red-300">{clientGoals.length}</p>
              </div>
            </div>

            {/* Goal progress bars */}
            {clientGoals.length > 0 && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className={ds.heading3}>Goals</h3>
                  <button onClick={addClientGoal} className={cn(ds.btnSmall, ds.btnGhost)}><Plus className="w-3.5 h-3.5" /> Add Goal</button>
                </div>
                {clientGoals.map((g, i) => (
                  <div key={i} className={ds.panel}>
                    <div className="flex items-center justify-between mb-1">
                      <input value={g.label} onChange={e => { const ng = [...clientGoals]; ng[i] = { ...g, label: e.target.value }; setClientGoals(ng); }} className={cn(ds.input, 'bg-transparent border-none p-0 text-sm font-medium')} placeholder="Goal name" />
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">{g.current}/{g.target}</span>
                        <button onClick={() => setClientGoals(prev => prev.filter((_, idx) => idx !== i))} className={ds.btnGhost}><Trash2 className="w-3 h-3 text-red-400" /></button>
                      </div>
                    </div>
                    <ProgressBar value={g.current} max={g.target} color="neon-cyan" />
                    <div className="flex gap-2 mt-1">
                      <input type="number" value={g.current} onChange={e => { const ng = [...clientGoals]; ng[i] = { ...g, current: parseFloat(e.target.value) || 0 }; setClientGoals(ng); }} className={cn(ds.input, 'w-20 text-xs')} placeholder="Current" />
                      <input type="number" value={g.target} onChange={e => { const ng = [...clientGoals]; ng[i] = { ...g, target: parseFloat(e.target.value) || 100 }; setClientGoals(ng); }} className={cn(ds.input, 'w-20 text-xs')} placeholder="Target" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {clientGoals.length === 0 && (
              <div className="mt-4">
                <button onClick={addClientGoal} className={cn(ds.btnSmall, ds.btnGhost)}><Plus className="w-3.5 h-3.5" /> Add Goal</button>
              </div>
            )}

            {/* Body Metrics */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className={ds.heading3}>Body Metrics</h3>
                <button onClick={addClientMetric} className={cn(ds.btnSmall, ds.btnGhost)}><Plus className="w-3.5 h-3.5" /> Add Entry</button>
              </div>
              {clientMetrics.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-400 border-b border-lattice-border">
                        <th className="text-left py-2 px-2">Date</th>
                        <th className="text-right py-2 px-2">Weight</th>
                        <th className="text-right py-2 px-2">BF%</th>
                        <th className="text-right py-2 px-2">Chest</th>
                        <th className="text-right py-2 px-2">Waist</th>
                        <th className="text-right py-2 px-2">Hips</th>
                        <th className="text-right py-2 px-2">Arms</th>
                        <th className="text-right py-2 px-2">Thighs</th>
                        <th className="py-2 px-2">Trend</th>
                        <th className="py-2 px-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {clientMetrics.map((m, i) => {
                        const prev = i > 0 ? clientMetrics[i - 1] : null;
                        const weightTrend = prev ? m.weight - prev.weight : 0;
                        return (
                          <tr key={i} className="border-b border-lattice-border/50 hover:bg-lattice-elevated/50">
                            <td className="py-2 px-2">
                              <input type="date" value={m.date} onChange={e => { const nm = [...clientMetrics]; nm[i] = { ...m, date: e.target.value }; setClientMetrics(nm); }} className={cn(ds.input, 'text-xs w-32')} />
                            </td>
                            <td className="py-2 px-2"><input type="number" value={m.weight || ''} onChange={e => { const nm = [...clientMetrics]; nm[i] = { ...m, weight: parseFloat(e.target.value) || 0 }; setClientMetrics(nm); }} className={cn(ds.input, 'text-xs w-16 text-right')} /></td>
                            <td className="py-2 px-2"><input type="number" value={m.bodyFat || ''} onChange={e => { const nm = [...clientMetrics]; nm[i] = { ...m, bodyFat: parseFloat(e.target.value) || 0 }; setClientMetrics(nm); }} className={cn(ds.input, 'text-xs w-16 text-right')} /></td>
                            <td className="py-2 px-2"><input type="number" value={m.chest || ''} onChange={e => { const nm = [...clientMetrics]; nm[i] = { ...m, chest: parseFloat(e.target.value) || 0 }; setClientMetrics(nm); }} className={cn(ds.input, 'text-xs w-16 text-right')} /></td>
                            <td className="py-2 px-2"><input type="number" value={m.waist || ''} onChange={e => { const nm = [...clientMetrics]; nm[i] = { ...m, waist: parseFloat(e.target.value) || 0 }; setClientMetrics(nm); }} className={cn(ds.input, 'text-xs w-16 text-right')} /></td>
                            <td className="py-2 px-2"><input type="number" value={m.hips || ''} onChange={e => { const nm = [...clientMetrics]; nm[i] = { ...m, hips: parseFloat(e.target.value) || 0 }; setClientMetrics(nm); }} className={cn(ds.input, 'text-xs w-16 text-right')} /></td>
                            <td className="py-2 px-2"><input type="number" value={m.arms || ''} onChange={e => { const nm = [...clientMetrics]; nm[i] = { ...m, arms: parseFloat(e.target.value) || 0 }; setClientMetrics(nm); }} className={cn(ds.input, 'text-xs w-16 text-right')} /></td>
                            <td className="py-2 px-2"><input type="number" value={m.thighs || ''} onChange={e => { const nm = [...clientMetrics]; nm[i] = { ...m, thighs: parseFloat(e.target.value) || 0 }; setClientMetrics(nm); }} className={cn(ds.input, 'text-xs w-16 text-right')} /></td>
                            <td className="py-2 px-2">
                              {weightTrend < 0 ? <ArrowDownRight className="w-4 h-4 text-red-400" /> : weightTrend > 0 ? <ArrowUpRight className="w-4 h-4 text-red-400" /> : <Minus className="w-4 h-4 text-gray-500" />}
                            </td>
                            <td className="py-2 px-2">
                              <button onClick={() => setClientMetrics(prev => prev.filter((_, idx) => idx !== i))} className={ds.btnGhost}><Trash2 className="w-3 h-3 text-red-400" /></button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={cn(ds.textMuted, 'text-center py-4')}>No body metrics recorded yet.</p>
              )}

              {/* Strength Progression Text Chart */}
              {clientMetrics.length >= 2 && (
                <div className="mt-3 p-3 bg-lattice-elevated rounded-lg">
                  <h4 className="text-sm font-medium mb-2">Weight Trend</h4>
                  <div className="flex items-end gap-1 h-16">
                    {clientMetrics.map((m, i) => {
                      const maxW = Math.max(...clientMetrics.map(x => x.weight || 1));
                      const minW = Math.min(...clientMetrics.filter(x => x.weight > 0).map(x => x.weight));
                      const range = maxW - minW || 1;
                      const pct = ((m.weight - minW) / range) * 100;
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center justify-end">
                          <div className="w-full bg-neon-cyan/60 rounded-t" style={{ height: `${Math.max(10, pct)}%` }} title={`${m.weight}kg`} />
                          <span className="text-[9px] text-gray-500 mt-0.5">{m.date.slice(5)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Personal Records */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className={ds.heading3}>Personal Records</h3>
                <button onClick={addClientPR} className={cn(ds.btnSmall, ds.btnGhost)}><Plus className="w-3.5 h-3.5" /> Add PR</button>
              </div>
              {clientPRs.length > 0 ? (
                <div className={ds.grid3}>
                  {clientPRs.map((pr, i) => (
                    <div key={i} className={cn(ds.panel, 'flex items-center gap-3')}>
                      <Award className="w-5 h-5 text-amber-400 shrink-0" />
                      <div className="flex-1 space-y-1">
                        <input value={pr.exercise} onChange={e => { const np = [...clientPRs]; np[i] = { ...pr, exercise: e.target.value }; setClientPRs(np); }} className={cn(ds.input, 'text-xs')} placeholder="Exercise" />
                        <div className="flex gap-1">
                          <input type="number" value={pr.weight || ''} onChange={e => { const np = [...clientPRs]; np[i] = { ...pr, weight: parseFloat(e.target.value) || 0 }; setClientPRs(np); }} className={cn(ds.input, 'text-xs w-16')} placeholder="lbs" />
                          <input type="number" value={pr.reps || ''} onChange={e => { const np = [...clientPRs]; np[i] = { ...pr, reps: parseInt(e.target.value) || 1 }; setClientPRs(np); }} className={cn(ds.input, 'text-xs w-12')} placeholder="reps" />
                          <input type="date" value={pr.date} onChange={e => { const np = [...clientPRs]; np[i] = { ...pr, date: e.target.value }; setClientPRs(np); }} className={cn(ds.input, 'text-xs w-28')} />
                        </div>
                      </div>
                      <button onClick={() => setClientPRs(prev => prev.filter((_, idx) => idx !== i))} className={ds.btnGhost}><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={cn(ds.textMuted, 'text-center py-4')}>No personal records logged.</p>
              )}
              {/* Strength Progression Bar Chart */}
              {clientPRs.length >= 2 && (() => {
                // Group PRs by exercise and show max weight
                const exerciseMap = new Map<string, { weight: number; date: string }[]>();
                clientPRs.forEach(pr => {
                  if (!pr.exercise) return;
                  const existing = exerciseMap.get(pr.exercise) || [];
                  existing.push({ weight: pr.weight, date: pr.date });
                  exerciseMap.set(pr.exercise, existing);
                });
                const exercises = Array.from(exerciseMap.entries()).filter(([, vals]) => vals.some(v => v.weight > 0));
                if (exercises.length === 0) return null;
                const maxWeight = Math.max(...exercises.map(([, vals]) => Math.max(...vals.map(v => v.weight))));
                return (
                  <div className="mt-3 p-3 bg-lattice-elevated rounded-lg">
                    <h4 className="text-sm font-medium mb-3">Strength Records (Best Weight)</h4>
                    <div className="space-y-2">
                      {exercises.map(([name, vals]) => {
                        const best = Math.max(...vals.map(v => v.weight));
                        const pct = maxWeight > 0 ? (best / maxWeight) * 100 : 0;
                        return (
                          <div key={name} className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 w-24 truncate">{name}</span>
                            <div className="flex-1 bg-lattice-surface rounded-full h-4 overflow-hidden">
                              <div className="h-full bg-amber-400/60 rounded-full flex items-center justify-end pr-1 transition-all duration-500" style={{ width: `${Math.max(10, pct)}%` }}>
                                <span className="text-[10px] font-bold text-white">{best}lbs</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Progress Photos */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className={ds.heading3}>Progress Photos</h3>
                <button onClick={addClientPhoto} className={cn(ds.btnSmall, ds.btnGhost)}><Plus className="w-3.5 h-3.5" /> Add Entry</button>
              </div>
              {clientPhotos.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {clientPhotos.map((p, i) => (
                    <div key={i} className={cn(ds.panel, 'w-36 text-center')}>
                      <Eye className="w-8 h-8 text-gray-600 mx-auto mb-1" />
                      <input type="date" value={p.date} onChange={e => { const np = [...clientPhotos]; np[i] = { ...p, date: e.target.value }; setClientPhotos(np); }} className={cn(ds.input, 'text-xs')} />
                      <input value={p.label} onChange={e => { const np = [...clientPhotos]; np[i] = { ...p, label: e.target.value }; setClientPhotos(np); }} className={cn(ds.input, 'text-xs mt-1')} placeholder="Label" />
                    </div>
                  ))}
                </div>
              ) : (
                <p className={cn(ds.textMuted, 'text-center py-4')}>No progress photos recorded.</p>
              )}
            </div>
          </section>
        );
      })()}

      {/* ========== Artifact Library ========== */}
      <section className={ds.panel}>
        <div className={cn(ds.sectionHeader, 'mb-4')}>
          <h2 className={ds.heading2}>{activeTab}</h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search..." className={cn(ds.input, 'pl-9 w-56')} />
            </div>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as Status | 'all')} className={cn(ds.select, 'w-40')}>
              <option value="all">All statuses</option>
              {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {isLoading ? (
          <p className={cn(ds.textMuted, 'text-center py-12')}>Loading...</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <Dumbbell className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className={ds.textMuted}>No {activeTab.toLowerCase()} found. Create one to get started.</p>
          </div>
        ) : (
          <div className={ds.grid3}>
            {filtered.map(item => {
              const d = item.data as unknown as FitnessArtifact;
              return (
                <div key={item.id} className={ds.panelHover} onClick={() => {
                  if (activeTab === 'Clients') openClientDashboard(item);
                  else openEditEditor(item);
                }}>
                  <div className="flex items-start justify-between mb-2">
                    <h3 className={cn(ds.heading3, 'text-base truncate flex-1')}>{item.title}</h3>
                    <span className={ds.badge(STATUS_COLORS[d.status])}>{d.status}</span>
                  </div>
                  <p className={cn(ds.textMuted, 'line-clamp-2 mb-3')}>{d.description}</p>

                  {/* Workout-specific summary */}
                  {d.artifactType === 'Workout' && d.exercises && d.exercises.length > 0 && (
                    <div className="flex gap-2 mb-2 flex-wrap">
                      <span className={ds.badge('red-500')}>{d.exercises.length} exercises</span>
                      <span className={ds.badge('neon-cyan')}>Vol: {calcTotalVolume(d.exercises).toLocaleString()}</span>
                      <span className={ds.badge('amber-400')}>{Math.round(calcEstimatedDuration(d.exercises))} min</span>
                    </div>
                  )}

                  {/* Program-specific summary */}
                  {d.artifactType === 'Program' && d.trainingBlocks && d.trainingBlocks.length > 0 && (
                    <div className="flex gap-2 mb-2 flex-wrap">
                      <span className={ds.badge('red-300')}>{d.trainingBlocks.length} blocks</span>
                      <span className={ds.badge('red-400')}>{d.trainingBlocks.reduce((s, b) => s + b.weeks, 0)} weeks</span>
                    </div>
                  )}

                  {/* Class revenue */}
                  {d.artifactType === 'Class' && d.classSlots && d.classSlots.length > 0 && (
                    <div className="flex gap-2 mb-2 flex-wrap">
                      <span className={ds.badge('neon-cyan')}>{d.classSlots.length} slots</span>
                      <span className={ds.badge('red-400')}>${d.classSlots.reduce((s, sl) => s + sl.enrolled * sl.pricePerHead, 0)}/wk</span>
                    </div>
                  )}

                  {/* Recruiting stage */}
                  {d.artifactType === 'Athlete' && d.recruitStage && (
                    <div className="mb-2">
                      <span className={ds.badge(RECRUIT_STAGE_COLORS[d.recruitStage])}>{d.recruitStage}</span>
                    </div>
                  )}

                  {/* Team roster count */}
                  {d.artifactType === 'Team' && d.roster && d.roster.length > 0 && (
                    <div className="flex gap-2 mb-2 flex-wrap">
                      <span className={ds.badge('red-400')}>{d.roster.length} athletes</span>
                      <span className={ds.badge('red-500')}>{d.roster.filter(r => r.status === 'active').length} active</span>
                    </div>
                  )}

                  <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                    {d.coach && <span className="flex items-center gap-1"><User className="w-3 h-3" /> {d.coach}</span>}
                    {d.category && <span className="flex items-center gap-1"><Target className="w-3 h-3" /> {d.category}</span>}
                    {d.duration != null && <span className="flex items-center gap-1"><Timer className="w-3 h-3" /> {d.duration} min</span>}
                    {d.intensity && (
                      <span className={ds.badge(intensityColor(d.intensity))}>
                        <Zap className="w-3 h-3" /> {d.intensity}
                      </span>
                    )}
                    {d.schedule && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {d.schedule}</span>}
                  </div>
                  {d.goal && (
                    <div className="mt-2">
                      <span className="text-xs text-neon-cyan flex items-center gap-1">
                        <Target className="w-3 h-3" /> {d.goal}
                      </span>
                    </div>
                  )}
                  <div className="mt-2 pt-2 border-t border-lattice-border flex items-center gap-2">
                    <button className={cn(ds.btnGhost, ds.btnSmall)} onClick={e => { e.stopPropagation(); openEditEditor(item); }}>
                      <Eye className="w-3.5 h-3.5" /> Edit
                    </button>
                    <button className={cn(ds.btnDanger, ds.btnSmall)} onClick={e => { e.stopPropagation(); remove(item.id); }}>
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ========== Action Result ========== */}
      {actionResult && (
        <div className={ds.panel}>
          <div className="flex items-center justify-between mb-2">
            <h3 className={ds.heading3}>Action Result</h3>
            <button onClick={() => setActionResult(null)} className={ds.btnGhost}><X className="w-4 h-4" /></button>
          </div>
          <div className="space-y-3">
            {/* progressionCalc */}
            {actionResult.recommendations !== undefined && Array.isArray(actionResult.recommendations) && (
              <div className="space-y-2">
                {(actionResult.recommendations as {exercise:string;currentWeight:number;recommendedWeight:number;currentRPE:number;recommendation:string}[]).map((r, i) => (
                  <div key={i} className="p-2 bg-lattice-surface rounded flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-white">{r.exercise}</p>
                      <p className="text-[10px] text-gray-500">RPE {r.currentRPE} &rarr; {r.recommendation.replace(/_/g, ' ')}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400 line-through">{r.currentWeight}kg</p>
                      <p className="text-sm font-bold text-neon-cyan">{r.recommendedWeight}kg</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* classUtilization */}
            {actionResult.utilization !== undefined && actionResult.className !== undefined && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">{String(actionResult.className)}</span>
                  <span className="text-sm font-bold text-neon-cyan">{String(actionResult.utilization)}% Full</span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-neon-cyan rounded-full" style={{ width: `${Math.min(100, Number(actionResult.utilization))}%` }} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String(actionResult.enrolled)}</p>
                    <p className="text-[10px] text-gray-500">Enrolled</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String(actionResult.capacity)}</p>
                    <p className="text-[10px] text-gray-500">Capacity</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String(actionResult.sessions)}</p>
                    <p className="text-[10px] text-gray-500">Sessions</p>
                  </div>
                </div>
              </div>
            )}
            {/* periodization */}
            {actionResult.phases !== undefined && Array.isArray(actionResult.phases) && (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">{String(actionResult.goal)} &bull; {String(actionResult.totalWeeks)} weeks</p>
                {(actionResult.phases as {name:string;weeks:number;sets:string;reps:string;intensity:string}[]).map((p, i) => (
                  <div key={i} className="p-2 bg-lattice-surface rounded flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-neon-cyan">{p.name}</p>
                      <p className="text-[10px] text-gray-500">{p.sets} sets &times; {p.reps} reps @ {p.intensity}</p>
                    </div>
                    <span className="text-xs text-gray-400">{p.weeks}w</span>
                  </div>
                ))}
              </div>
            )}
            {/* recruitProfile */}
            {actionResult.profile !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String((actionResult.profile as {sport:string}).sport)}</p>
                    <p className="text-[10px] text-gray-500">Sport</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String((actionResult.profile as {recruitingStatus:string}).recruitingStatus)}</p>
                    <p className="text-[10px] text-gray-500">Status</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========== Body Composition Calculator Modal ========== */}
      {showBodyComp && (
        <>
          <div className={ds.modalBackdrop} onClick={() => setShowBodyComp(false)} />
          <div className={ds.modalContainer}>
            <div className={cn(ds.modalPanel, 'max-w-4xl')}>
              <div className="flex items-center justify-between p-4 border-b border-lattice-border">
                <h2 className={ds.heading2}>Body Composition & Strength Tools</h2>
                <button onClick={() => setShowBodyComp(false)} className={ds.btnGhost}><X className="w-5 h-5" /></button>
              </div>
              <div className="p-4 space-y-6 max-h-[75vh] overflow-y-auto">

                {/* Basic info inputs */}
                <div>
                  <h3 className={cn(ds.heading3, 'mb-3')}>Basic Information</h3>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div>
                      <label className={ds.label}>Weight (kg)</label>
                      <input type="number" value={bcWeight} onChange={e => setBcWeight(e.target.value)} className={ds.input} placeholder="80" />
                    </div>
                    <div>
                      <label className={ds.label}>Height (cm)</label>
                      <input type="number" value={bcHeight} onChange={e => setBcHeight(e.target.value)} className={ds.input} placeholder="180" />
                    </div>
                    <div>
                      <label className={ds.label}>Age</label>
                      <input type="number" value={bcAge} onChange={e => setBcAge(e.target.value)} className={ds.input} placeholder="30" />
                    </div>
                    <div>
                      <label className={ds.label}>Sex</label>
                      <select value={bcIsMale ? 'male' : 'female'} onChange={e => setBcIsMale(e.target.value === 'male')} className={ds.select}>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                      </select>
                    </div>
                    <div>
                      <label className={ds.label}>Activity</label>
                      <select value={bcActivity} onChange={e => setBcActivity(e.target.value)} className={ds.select}>
                        <option value="1.2">Sedentary</option>
                        <option value="1.375">Light</option>
                        <option value="1.55">Moderate</option>
                        <option value="1.725">Active</option>
                        <option value="1.9">Very Active</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* BMI */}
                <div className={ds.panel}>
                  <h3 className={cn(ds.heading3, 'mb-2')}>BMI Calculator</h3>
                  {bmi !== null ? (
                    <div className="flex items-center gap-4">
                      <p className="text-3xl font-bold text-neon-cyan">{bmi.toFixed(1)}</p>
                      <div>
                        <p className="text-sm font-medium">
                          {bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese'}
                        </p>
                        <p className={ds.textMuted}>Based on {bcWeight}kg, {bcHeight}cm</p>
                      </div>
                    </div>
                  ) : (
                    <p className={ds.textMuted}>Enter weight and height above</p>
                  )}
                </div>

                {/* Body Fat % estimation */}
                <div className={ds.panel}>
                  <h3 className={cn(ds.heading3, 'mb-2')}>Body Fat % (Navy Method)</h3>
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div>
                      <label className={ds.label}>Waist (cm)</label>
                      <input type="number" value={bcWaist} onChange={e => setBcWaist(e.target.value)} className={ds.input} placeholder="85" />
                    </div>
                    <div>
                      <label className={ds.label}>Neck (cm)</label>
                      <input type="number" value={bcNeck} onChange={e => setBcNeck(e.target.value)} className={ds.input} placeholder="38" />
                    </div>
                    {!bcIsMale && (
                      <div>
                        <label className={ds.label}>Hip (cm)</label>
                        <input type="number" value={bcHip} onChange={e => setBcHip(e.target.value)} className={ds.input} placeholder="95" />
                      </div>
                    )}
                  </div>
                  {bodyFatEst !== null ? (
                    <div className="flex items-center gap-4">
                      <p className="text-3xl font-bold text-red-400">{bodyFatEst.toFixed(1)}%</p>
                      <p className={ds.textMuted}>Estimated body fat percentage</p>
                    </div>
                  ) : (
                    <p className={ds.textMuted}>Enter waist, neck{!bcIsMale ? ', hip' : ''} measurements</p>
                  )}
                </div>

                {/* TDEE + Macros */}
                <div className={ds.panel}>
                  <h3 className={cn(ds.heading3, 'mb-2')}>TDEE & Macro Calculator</h3>
                  <div className="mb-3">
                    <label className={ds.label}>Goal</label>
                    <select value={bcGoal} onChange={e => setBcGoal(e.target.value as 'cut' | 'maintain' | 'bulk')} className={cn(ds.select, 'w-40')}>
                      <option value="cut">Cut (-500 cal)</option>
                      <option value="maintain">Maintain</option>
                      <option value="bulk">Bulk (+300 cal)</option>
                    </select>
                  </div>
                  {tdee !== null && macros !== null ? (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <div className={ds.panel}>
                        <p className={ds.textMuted}>TDEE</p>
                        <p className="text-xl font-bold text-red-500">{tdee}</p>
                        <p className="text-xs text-gray-500">cal/day</p>
                      </div>
                      <div className={ds.panel}>
                        <p className={ds.textMuted}>Target</p>
                        <p className="text-xl font-bold text-red-400">{macros.calories}</p>
                        <p className="text-xs text-gray-500">cal/day</p>
                      </div>
                      <div className={ds.panel}>
                        <p className={ds.textMuted}>Protein</p>
                        <p className="text-xl font-bold text-red-400">{macros.protein}g</p>
                        <p className="text-xs text-gray-500">{macros.protein * 4} cal</p>
                      </div>
                      <div className={ds.panel}>
                        <p className={ds.textMuted}>Carbs</p>
                        <p className="text-xl font-bold text-amber-400">{macros.carbs}g</p>
                        <p className="text-xs text-gray-500">{macros.carbs * 4} cal</p>
                      </div>
                      <div className={ds.panel}>
                        <p className={ds.textMuted}>Fat</p>
                        <p className="text-xl font-bold text-red-300">{macros.fat}g</p>
                        <p className="text-xs text-gray-500">{macros.fat * 9} cal</p>
                      </div>
                    </div>
                  ) : (
                    <p className={ds.textMuted}>Enter weight, height, and age above</p>
                  )}
                </div>

                {/* 1RM Calculator */}
                <div className={ds.panel}>
                  <h3 className={cn(ds.heading3, 'mb-2')}>1RM Calculator</h3>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className={ds.label}>Weight Lifted</label>
                      <input type="number" value={bc1rmWeight} onChange={e => setBc1rmWeight(e.target.value)} className={ds.input} placeholder="100" />
                    </div>
                    <div>
                      <label className={ds.label}>Reps Completed</label>
                      <input type="number" value={bc1rmReps} onChange={e => setBc1rmReps(e.target.value)} className={ds.input} placeholder="5" min="1" max="15" />
                    </div>
                  </div>
                  {oneRMEpley !== null && oneRMBrzycki !== null ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div className={ds.panel}>
                        <p className={ds.textMuted}>Epley Formula</p>
                        <p className="text-2xl font-bold text-red-400">{oneRMEpley}</p>
                        <p className="text-xs text-gray-500">estimated 1RM</p>
                      </div>
                      <div className={ds.panel}>
                        <p className={ds.textMuted}>Brzycki Formula</p>
                        <p className="text-2xl font-bold text-neon-cyan">{oneRMBrzycki}</p>
                        <p className="text-xs text-gray-500">estimated 1RM</p>
                      </div>
                    </div>
                  ) : (
                    <p className={ds.textMuted}>Enter weight and reps to calculate</p>
                  )}
                  {oneRMEpley !== null && (
                    <div className="mt-3">
                      <p className="text-sm font-medium mb-2">Percentage Chart (Epley)</p>
                      <div className="grid grid-cols-5 gap-1 text-xs">
                        {[100, 95, 90, 85, 80, 75, 70, 65, 60, 55].map(pct => (
                          <div key={pct} className="bg-lattice-elevated p-1.5 rounded text-center">
                            <span className="text-gray-400">{pct}%</span>
                            <p className="font-bold">{Math.round(oneRMEpley * pct / 100)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ========== Editor Modal ========== */}
      {showEditor && (
        <>
          <div className={ds.modalBackdrop} onClick={() => setShowEditor(false)} />
          <div className={ds.modalContainer}>
            <div className={cn(ds.modalPanel, 'max-w-4xl')}>
              <div className="flex items-center justify-between p-4 border-b border-lattice-border">
                <h2 className={ds.heading2}>{editingItem ? 'Edit' : 'New'} {formType}</h2>
                <button onClick={() => setShowEditor(false)} className={ds.btnGhost}><X className="w-5 h-5" /></button>
              </div>
              <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">

                {/* Base fields */}
                <div>
                  <label className={ds.label}>Title</label>
                  <input value={formTitle} onChange={e => setFormTitle(e.target.value)} className={ds.input} placeholder="Title" />
                </div>
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Type</label>
                    <select value={formType} onChange={e => setFormType(e.target.value as ArtifactType)} className={ds.select}>
                      <option value="Client">Client</option>
                      <option value="Program">Program</option>
                      <option value="Workout">Workout</option>
                      <option value="Class">Class</option>
                      <option value="Team">Team</option>
                      <option value="Athlete">Athlete</option>
                    </select>
                  </div>
                  <div>
                    <label className={ds.label}>Status</label>
                    <select value={formStatus} onChange={e => setFormStatus(e.target.value as Status)} className={ds.select}>
                      {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Coach / Instructor</label>
                    <input value={formCoach} onChange={e => setFormCoach(e.target.value)} className={ds.input} placeholder="Coach name" />
                  </div>
                  <div>
                    <label className={ds.label}>Category</label>
                    <input value={formCategory} onChange={e => setFormCategory(e.target.value)} className={ds.input} placeholder="e.g. HIIT, Yoga, Strength" />
                  </div>
                </div>
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Duration (minutes)</label>
                    <input type="number" value={formDuration} onChange={e => setFormDuration(e.target.value)} className={ds.input} placeholder="45" min="0" />
                  </div>
                  <div>
                    <label className={ds.label}>Intensity</label>
                    <select value={formIntensity} onChange={e => setFormIntensity(e.target.value as 'low' | 'moderate' | 'high' | 'extreme')} className={ds.select}>
                      <option value="low">Low</option>
                      <option value="moderate">Moderate</option>
                      <option value="high">High</option>
                      <option value="extreme">Extreme</option>
                    </select>
                  </div>
                </div>
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Schedule</label>
                    <input value={formSchedule} onChange={e => setFormSchedule(e.target.value)} className={ds.input} placeholder="e.g. Mon/Wed/Fri 6AM" />
                  </div>
                  <div>
                    <label className={ds.label}>Start Date</label>
                    <input type="date" value={formStartDate} onChange={e => setFormStartDate(e.target.value)} className={ds.input} />
                  </div>
                </div>
                <div>
                  <label className={ds.label}>Goal</label>
                  <input value={formGoal} onChange={e => setFormGoal(e.target.value)} className={ds.input} placeholder="Target or goal" />
                </div>
                <div>
                  <label className={ds.label}>Description</label>
                  <textarea value={formDescription} onChange={e => setFormDescription(e.target.value)} className={ds.textarea} rows={3} placeholder="Description..." />
                </div>
                <div>
                  <label className={ds.label}>Notes</label>
                  <textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} className={ds.textarea} rows={2} placeholder="Additional notes..." />
                </div>

                {/* ========== Workout Builder (Workouts tab) ========== */}
                {formType === 'Workout' && (
                  <div className="border border-lattice-border rounded-xl p-4 space-y-4">
                    <div className={ds.sectionHeader}>
                      <h3 className={ds.heading3}>Workout Builder</h3>
                      <button onClick={() => setShowExerciseLibrary(!showExerciseLibrary)} className={ds.btnSecondary}>
                        <Plus className="w-4 h-4" /> Add Exercise
                      </button>
                    </div>

                    {/* Summary stats */}
                    {workoutExercises.length > 0 && (
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-lattice-elevated rounded-lg p-2 text-center">
                          <p className={ds.textMuted}>Total Volume</p>
                          <p className="text-lg font-bold text-red-400">{calcTotalVolume(workoutExercises).toLocaleString()}</p>
                        </div>
                        <div className="bg-lattice-elevated rounded-lg p-2 text-center">
                          <p className={ds.textMuted}>Est. Duration</p>
                          <p className="text-lg font-bold text-red-500">{Math.round(calcEstimatedDuration(workoutExercises))} min</p>
                        </div>
                        <div className="bg-lattice-elevated rounded-lg p-2 text-center">
                          <p className={ds.textMuted}>Exercises</p>
                          <p className="text-lg font-bold text-neon-cyan">{workoutExercises.length}</p>
                        </div>
                      </div>
                    )}

                    {/* Exercise Library dropdown */}
                    {showExerciseLibrary && (
                      <div className="bg-lattice-elevated rounded-lg p-3 space-y-2">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          {(['All', 'Upper', 'Lower', 'Core', 'Cardio', 'Flexibility'] as const).map(cat => (
                            <button key={cat} onClick={() => setExerciseFilter(cat)} className={cn(ds.btnSmall, exerciseFilter === cat ? 'bg-red-400/20 text-red-400' : 'text-gray-400')}>
                              {cat}
                            </button>
                          ))}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-1 max-h-40 overflow-y-auto">
                          {EXERCISE_LIBRARY.filter(e => exerciseFilter === 'All' || e.category === exerciseFilter).map(ex => (
                            <button key={ex.name} onClick={() => { addExercise(ex.name, ex.category); setShowExerciseLibrary(false); }} className={cn(ds.btnGhost, 'text-xs justify-start')}>
                              <Plus className="w-3 h-3" /> {ex.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Exercise list */}
                    {workoutExercises.map((ex, idx) => (
                      <div key={ex.id} className={cn(ds.panel, ex.isSuperset && 'border-l-2 border-l-red-300')}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 font-mono w-5">{idx + 1}.</span>
                            <span className="font-medium text-sm">{ex.name}</span>
                            <span className={ds.badge(ex.category === 'Upper' ? 'red-500' : ex.category === 'Lower' ? 'red-400' : ex.category === 'Core' ? 'amber-400' : ex.category === 'Cardio' ? 'red-400' : 'red-300')}>
                              {ex.category}
                            </span>
                          </div>
                          <button onClick={() => removeExercise(ex.id)} className={ds.btnGhost}><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
                        </div>
                        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                          <div>
                            <label className={ds.label}>Sets</label>
                            <input type="number" value={ex.sets} onChange={e => updateExercise(ex.id, 'sets', parseInt(e.target.value) || 0)} className={cn(ds.input, 'text-xs')} min="0" />
                          </div>
                          <div>
                            <label className={ds.label}>Reps</label>
                            <input type="number" value={ex.reps} onChange={e => updateExercise(ex.id, 'reps', parseInt(e.target.value) || 0)} className={cn(ds.input, 'text-xs')} min="0" />
                          </div>
                          <div>
                            <label className={ds.label}>Weight</label>
                            <input type="number" value={ex.weight} onChange={e => updateExercise(ex.id, 'weight', parseFloat(e.target.value) || 0)} className={cn(ds.input, 'text-xs')} min="0" />
                          </div>
                          <div>
                            <label className={ds.label}>Rest (s)</label>
                            <input type="number" value={ex.restSeconds} onChange={e => updateExercise(ex.id, 'restSeconds', parseInt(e.target.value) || 0)} className={cn(ds.input, 'text-xs')} min="0" />
                          </div>
                          <div>
                            <label className={ds.label}>RPE</label>
                            <input type="number" value={ex.rpe} onChange={e => updateExercise(ex.id, 'rpe', parseInt(e.target.value) || 0)} className={cn(ds.input, 'text-xs')} min="1" max="10" />
                          </div>
                          <div>
                            <label className={ds.label}>Superset</label>
                            <div className="flex items-center gap-1">
                              <input type="checkbox" checked={ex.isSuperset} onChange={e => updateExercise(ex.id, 'isSuperset', e.target.checked)} className="accent-red-300" />
                              {ex.isSuperset && (
                                <input value={ex.supersetGroup} onChange={e => updateExercise(ex.id, 'supersetGroup', e.target.value)} className={cn(ds.input, 'text-xs w-12')} placeholder="Grp" />
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
                          <span>Vol: {(ex.sets * ex.reps * ex.weight).toLocaleString()}</span>
                          <span>RPE: {ex.rpe}/10</span>
                        </div>
                      </div>
                    ))}

                    {workoutExercises.length === 0 && (
                      <p className={cn(ds.textMuted, 'text-center py-6')}>No exercises added. Use the library above to build your workout.</p>
                    )}
                  </div>
                )}

                {/* ========== Program Periodization (Programs tab) ========== */}
                {formType === 'Program' && (
                  <div className="border border-lattice-border rounded-xl p-4 space-y-4">
                    <div className={ds.sectionHeader}>
                      <h3 className={ds.heading3}>Periodization Plan</h3>
                      <button onClick={addTrainingBlock} className={ds.btnSecondary}>
                        <Plus className="w-4 h-4" /> Add Block
                      </button>
                    </div>

                    {/* Cycle planning */}
                    <div className={ds.grid3}>
                      <div>
                        <label className={ds.label}>Macro Cycle</label>
                        <input value={formMacroCycle} onChange={e => setFormMacroCycle(e.target.value)} className={ds.input} placeholder="e.g. Annual Plan 2026" />
                      </div>
                      <div>
                        <label className={ds.label}>Meso Cycle</label>
                        <input value={formMesoCycle} onChange={e => setFormMesoCycle(e.target.value)} className={ds.input} placeholder="e.g. Off-season Phase 1" />
                      </div>
                      <div>
                        <label className={ds.label}>Micro Cycle</label>
                        <input value={formMicroCycle} onChange={e => setFormMicroCycle(e.target.value)} className={ds.input} placeholder="e.g. Week 1 - Base" />
                      </div>
                    </div>

                    <div>
                      <label className={ds.label}>Auto-Progression Rules</label>
                      <textarea value={formAutoProgression} onChange={e => setFormAutoProgression(e.target.value)} className={ds.textarea} rows={2} placeholder="e.g. Increase weight by 2.5% when all sets completed at target RPE for 2 consecutive sessions" />
                    </div>

                    {/* Training blocks */}
                    {trainingBlocks.map((block, idx) => {
                      const phaseColor = block.phase === 'Hypertrophy' ? 'red-500' : block.phase === 'Strength' ? 'red-400' : block.phase === 'Power' ? 'red-400' : 'amber-400';
                      return (
                        <div key={block.id} className={ds.panel}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Layers className="w-4 h-4 text-red-300" />
                              <span className="text-xs text-gray-500">Block {idx + 1}</span>
                              <span className={ds.badge(phaseColor)}>{block.phase}</span>
                            </div>
                            <button onClick={() => removeBlock(block.id)} className={ds.btnGhost}><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                            <div>
                              <label className={ds.label}>Name</label>
                              <input value={block.name} onChange={e => updateBlock(block.id, 'name', e.target.value)} className={cn(ds.input, 'text-xs')} />
                            </div>
                            <div>
                              <label className={ds.label}>Phase</label>
                              <select value={block.phase} onChange={e => updateBlock(block.id, 'phase', e.target.value)} className={cn(ds.select, 'text-xs')}>
                                <option value="Hypertrophy">Hypertrophy</option>
                                <option value="Strength">Strength</option>
                                <option value="Power">Power</option>
                                <option value="Deload">Deload</option>
                              </select>
                            </div>
                            <div>
                              <label className={ds.label}>Weeks</label>
                              <input type="number" value={block.weeks} onChange={e => updateBlock(block.id, 'weeks', parseInt(e.target.value) || 0)} className={cn(ds.input, 'text-xs')} min="1" />
                            </div>
                            <div>
                              <label className={ds.label}>Vol Target</label>
                              <input type="number" value={block.weeklyVolume} onChange={e => updateBlock(block.id, 'weeklyVolume', parseInt(e.target.value) || 0)} className={cn(ds.input, 'text-xs')} placeholder="sets/wk" />
                            </div>
                            <div>
                              <label className={ds.label}>Overload %</label>
                              <input type="number" value={block.overloadPercent} onChange={e => updateBlock(block.id, 'overloadPercent', parseFloat(e.target.value) || 0)} className={cn(ds.input, 'text-xs')} />
                            </div>
                          </div>
                          <div className="mt-2">
                            <input value={block.notes} onChange={e => updateBlock(block.id, 'notes', e.target.value)} className={cn(ds.input, 'text-xs')} placeholder="Block notes..." />
                          </div>
                        </div>
                      );
                    })}

                    {trainingBlocks.length > 0 && (
                      <div className="bg-lattice-elevated rounded-lg p-3">
                        <p className="text-sm font-medium mb-1">Program Summary</p>
                        <div className="flex gap-4 text-xs text-gray-400">
                          <span>Total Duration: {trainingBlocks.reduce((s, b) => s + b.weeks, 0)} weeks</span>
                          <span>Blocks: {trainingBlocks.length}</span>
                          <span>Avg Overload: {(trainingBlocks.reduce((s, b) => s + b.overloadPercent, 0) / trainingBlocks.length).toFixed(1)}%</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ========== Class Schedule Manager (Classes tab) ========== */}
                {formType === 'Class' && (
                  <div className="border border-lattice-border rounded-xl p-4 space-y-4">
                    <div className={ds.sectionHeader}>
                      <h3 className={ds.heading3}>Class Schedule</h3>
                      <button onClick={addClassSlot} className={ds.btnSecondary}>
                        <Plus className="w-4 h-4" /> Add Slot
                      </button>
                    </div>

                    {/* Day selector */}
                    <div className="flex gap-1 flex-wrap">
                      {DAYS_OF_WEEK.map(day => (
                        <button key={day} onClick={() => setClassViewDay(day)} className={cn(ds.btnSmall, classViewDay === day ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-gray-400')}>
                          {day.slice(0, 3)}
                        </button>
                      ))}
                    </div>

                    {/* Calendar grid for selected day */}
                    <div className="space-y-2">
                      {CLASS_TIMES.map(time => {
                        const slotsForTime = classSlots.filter(s => s.day === classViewDay && s.time === time);
                        return (
                          <div key={time} data-lens-theme="fitness" className="flex items-start gap-3">
                            <span className="text-xs text-gray-500 w-16 pt-2 shrink-0">{time}</span>
                            <div className="flex-1">
                              {slotsForTime.length > 0 ? slotsForTime.map(slot => (
                                <div key={slot.id} className={cn(ds.panel, 'mb-1')}>
                                  <div className="flex items-center justify-between mb-2">
                                    <input value={slot.name} onChange={e => updateClassSlot(slot.id, 'name', e.target.value)} className={cn(ds.input, 'text-sm font-medium bg-transparent border-none p-0 w-40')} />
                                    <button onClick={() => removeClassSlot(slot.id)} className={ds.btnGhost}><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
                                  </div>
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                    <div>
                                      <label className={ds.label}>Instructor</label>
                                      <input value={slot.instructor} onChange={e => updateClassSlot(slot.id, 'instructor', e.target.value)} className={cn(ds.input, 'text-xs')} />
                                    </div>
                                    <div>
                                      <label className={ds.label}>Capacity</label>
                                      <input type="number" value={slot.capacity} onChange={e => updateClassSlot(slot.id, 'capacity', parseInt(e.target.value) || 0)} className={cn(ds.input, 'text-xs')} />
                                    </div>
                                    <div>
                                      <label className={ds.label}>Enrolled</label>
                                      <input type="number" value={slot.enrolled} onChange={e => updateClassSlot(slot.id, 'enrolled', parseInt(e.target.value) || 0)} className={cn(ds.input, 'text-xs')} />
                                    </div>
                                    <div>
                                      <label className={ds.label}>Waitlist</label>
                                      <input type="number" value={slot.waitlist} onChange={e => updateClassSlot(slot.id, 'waitlist', parseInt(e.target.value) || 0)} className={cn(ds.input, 'text-xs')} />
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-3 gap-2 mt-2">
                                    <div>
                                      <label className={ds.label}>$/Head</label>
                                      <input type="number" value={slot.pricePerHead} onChange={e => updateClassSlot(slot.id, 'pricePerHead', parseFloat(e.target.value) || 0)} className={cn(ds.input, 'text-xs')} />
                                    </div>
                                    <div>
                                      <label className={ds.label}>Attended</label>
                                      <input type="number" value={slot.attended} onChange={e => updateClassSlot(slot.id, 'attended', parseInt(e.target.value) || 0)} className={cn(ds.input, 'text-xs')} />
                                    </div>
                                    <div>
                                      <label className={ds.label}>Cancellations</label>
                                      <input type="number" value={slot.cancellations} onChange={e => updateClassSlot(slot.id, 'cancellations', parseInt(e.target.value) || 0)} className={cn(ds.input, 'text-xs')} />
                                    </div>
                                  </div>
                                  <div className="mt-2 flex gap-3 text-xs text-gray-400">
                                    <span className="text-red-400">Revenue: ${slot.enrolled * slot.pricePerHead}</span>
                                    <span>Fill: {slot.capacity > 0 ? Math.round((slot.enrolled / slot.capacity) * 100) : 0}%</span>
                                    <span>Attend Rate: {slot.enrolled > 0 ? Math.round((slot.attended / slot.enrolled) * 100) : 0}%</span>
                                  </div>
                                </div>
                              )) : (
                                <div className="text-xs text-gray-600 py-1 border-b border-lattice-border/30">No class</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {classSlots.length > 0 && (
                      <div className="bg-lattice-elevated rounded-lg p-3">
                        <p className="text-sm font-medium mb-1">Weekly Summary</p>
                        <div className="flex gap-4 text-xs text-gray-400">
                          <span>Total Slots: {classSlots.length}</span>
                          <span>Total Enrolled: {classSlots.reduce((s, sl) => s + sl.enrolled, 0)}</span>
                          <span className="text-red-400">Weekly Revenue: ${classSlots.reduce((s, sl) => s + sl.enrolled * sl.pricePerHead, 0)}</span>
                          <span>Avg Attendance: {classSlots.length > 0 ? Math.round(classSlots.reduce((s, sl) => s + (sl.enrolled > 0 ? (sl.attended / sl.enrolled) * 100 : 0), 0) / classSlots.length) : 0}%</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ========== Team Management (Teams tab) ========== */}
                {formType === 'Team' && (
                  <div className="border border-lattice-border rounded-xl p-4 space-y-4">
                    <h3 className={ds.heading3}>Team Management</h3>

                    {/* Roster */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium">Roster</h4>
                        <button onClick={addRosterEntry} className={cn(ds.btnSmall, ds.btnGhost)}><UserPlus className="w-3.5 h-3.5" /> Add Athlete</button>
                      </div>
                      {roster.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-gray-400 border-b border-lattice-border text-xs">
                                <th className="text-left py-2 px-2">Name</th>
                                <th className="text-left py-2 px-2">Position</th>
                                <th className="text-left py-2 px-2">#</th>
                                <th className="text-left py-2 px-2">Stats</th>
                                <th className="text-left py-2 px-2">Status</th>
                                <th className="py-2 px-2"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {roster.map((r, i) => (
                                <tr key={i} className="border-b border-lattice-border/50">
                                  <td className="py-1 px-2"><input value={r.name} onChange={e => updateRosterEntry(i, 'name', e.target.value)} className={cn(ds.input, 'text-xs')} placeholder="Name" /></td>
                                  <td className="py-1 px-2"><input value={r.position} onChange={e => updateRosterEntry(i, 'position', e.target.value)} className={cn(ds.input, 'text-xs w-20')} placeholder="Pos" /></td>
                                  <td className="py-1 px-2"><input value={r.number} onChange={e => updateRosterEntry(i, 'number', e.target.value)} className={cn(ds.input, 'text-xs w-12')} placeholder="#" /></td>
                                  <td className="py-1 px-2"><input value={r.stats} onChange={e => updateRosterEntry(i, 'stats', e.target.value)} className={cn(ds.input, 'text-xs')} placeholder="Key stats" /></td>
                                  <td className="py-1 px-2">
                                    <select value={r.status} onChange={e => updateRosterEntry(i, 'status', e.target.value)} className={cn(ds.select, 'text-xs w-24')}>
                                      <option value="active">Active</option>
                                      <option value="injured">Injured</option>
                                      <option value="reserve">Reserve</option>
                                    </select>
                                  </td>
                                  <td className="py-1 px-2"><button onClick={() => removeRosterEntry(i)} className={ds.btnGhost}><Trash2 className="w-3 h-3 text-red-400" /></button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className={cn(ds.textMuted, 'text-center py-3')}>No athletes on roster.</p>
                      )}
                      {roster.length > 0 && (
                        <div className="mt-2 flex gap-4 text-xs text-gray-400">
                          <span>Total: {roster.length}</span>
                          <span className="text-red-400">Active: {roster.filter(r => r.status === 'active').length}</span>
                          <span className="text-red-400">Injured: {roster.filter(r => r.status === 'injured').length}</span>
                          <span className="text-amber-400">Reserve: {roster.filter(r => r.status === 'reserve').length}</span>
                        </div>
                      )}
                    </div>

                    {/* Season Schedule */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium">Season Schedule</h4>
                        <button onClick={addSeasonGame} className={cn(ds.btnSmall, ds.btnGhost)}><Plus className="w-3.5 h-3.5" /> Add Game</button>
                      </div>
                      {seasonGames.length > 0 ? (
                        <div className="space-y-2">
                          {seasonGames.map((game, i) => (
                            <div key={i} className={cn(ds.panel, 'flex gap-2 items-center')}>
                              <input type="date" value={game.date} onChange={e => { const ng = [...seasonGames]; ng[i] = { ...game, date: e.target.value }; setSeasonGames(ng); }} className={cn(ds.input, 'text-xs w-32')} />
                              <input value={game.opponent} onChange={e => { const ng = [...seasonGames]; ng[i] = { ...game, opponent: e.target.value }; setSeasonGames(ng); }} className={cn(ds.input, 'text-xs flex-1')} placeholder="Opponent" />
                              <input value={game.location} onChange={e => { const ng = [...seasonGames]; ng[i] = { ...game, location: e.target.value }; setSeasonGames(ng); }} className={cn(ds.input, 'text-xs w-24')} placeholder="Location" />
                              <input value={game.result} onChange={e => { const ng = [...seasonGames]; ng[i] = { ...game, result: e.target.value }; setSeasonGames(ng); }} className={cn(ds.input, 'text-xs w-20')} placeholder="Result" />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className={cn(ds.textMuted, 'text-center py-3')}>No games scheduled.</p>
                      )}
                    </div>

                    {/* Practice Plans */}
                    <div>
                      <label className={ds.label}>Practice Plans (one per line)</label>
                      <textarea className={ds.textarea} rows={3} placeholder="Warm-up drills&#10;Skill work&#10;Scrimmage&#10;Cool-down" />
                    </div>
                  </div>
                )}

                {/* ========== Recruiting Fields (Athlete tab) ========== */}
                {formType === 'Athlete' && (
                  <div className="border border-lattice-border rounded-xl p-4 space-y-4">
                    <h3 className={ds.heading3}>Recruiting Pipeline</h3>

                    {/* Pipeline visualization */}
                    <div className="flex items-center gap-1">
                      {RECRUIT_STAGES.map((stage, i) => (
                        <div key={stage} className="flex items-center flex-1">
                          <button
                            onClick={() => setFormRecruitStage(stage)}
                            className={cn(
                              'flex-1 py-2 px-2 rounded text-xs font-medium text-center transition-colors',
                              formRecruitStage === stage ? `bg-${RECRUIT_STAGE_COLORS[stage]}/30 text-${RECRUIT_STAGE_COLORS[stage]} border border-${RECRUIT_STAGE_COLORS[stage]}/50` : 'bg-lattice-elevated text-gray-500'
                            )}
                          >
                            {stage}
                          </button>
                          {i < RECRUIT_STAGES.length - 1 && <ChevronRight className="w-4 h-4 text-gray-600 shrink-0 mx-0.5" />}
                        </div>
                      ))}
                    </div>

                    <div className={ds.grid3}>
                      <div>
                        <label className={ds.label}>Email</label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                          <input value={formEmail} onChange={e => setFormEmail(e.target.value)} className={cn(ds.input, 'pl-9')} placeholder="athlete@email.com" />
                        </div>
                      </div>
                      <div>
                        <label className={ds.label}>Phone</label>
                        <div className="relative">
                          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                          <input value={formPhone} onChange={e => setFormPhone(e.target.value)} className={cn(ds.input, 'pl-9')} placeholder="(555) 000-0000" />
                        </div>
                      </div>
                      <div>
                        <label className={ds.label}>Location</label>
                        <div className="relative">
                          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                          <input value={formLocation} onChange={e => setFormLocation(e.target.value)} className={cn(ds.input, 'pl-9')} placeholder="City, State" />
                        </div>
                      </div>
                    </div>

                    {/* Performance metrics */}
                    <div>
                      <label className={ds.label}>Performance Metrics / Scouting Notes</label>
                      <textarea className={ds.textarea} rows={3} placeholder="40-yard: 4.5s&#10;Vertical: 32&quot;&#10;GPA: 3.8&#10;Highlights: Strong leadership, varsity starter since sophomore year" />
                    </div>
                  </div>
                )}
              </div>

              {/* Modal footer */}
              <div className="flex items-center justify-between p-4 border-t border-lattice-border">
                <div className="flex items-center gap-2">
                  {editingItem && (
                    <button onClick={() => { remove(editingItem.id); setShowEditor(false); }} className={ds.btnDanger}>
                      <Trash2 className="w-4 h-4" /> Delete
                    </button>
                  )}
                  {editingItem && (
                    <button onClick={() => handleAction('calculate-progression', editingItem.id)} className={cn(ds.btnSmall, 'bg-red-400/20 text-red-400 border border-red-400/30')}>
                      <TrendingUp className="w-3.5 h-3.5" /> Calc Progression
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowEditor(false)} className={ds.btnSecondary}>Cancel</button>
                  <button onClick={handleSave} className={ds.btnPrimary}>
                    {editingItem ? 'Update' : 'Create'}
                  </button>
                </div>
              </div>
            </div>

          </div>
        </>
      )}

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
            <LensFeaturePanel lensId="fitness" />
          </div>
        )}
      </div>
    </div>
  );
}
