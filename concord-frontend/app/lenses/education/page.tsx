'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { DraftedTextarea } from '@/components/lens/DraftedTextarea';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import { Users as MobileTabUsers, BookOpen as MobileTabBook, ClipboardList as MobileTabList, Award as MobileTabAward, Calendar as MobileTabCal, Brain as MobileTabBrain } from 'lucide-react';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { GutenbergCurriculum } from '@/components/education/GutenbergCurriculum';
import { OpenLibraryPanel } from '@/components/paper/OpenLibraryPanel';
import { DictionaryPanel } from '@/components/linguistics/DictionaryPanel';
import { EducationActionPanel } from '@/components/education/EducationActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import CoursesCatalog, { type Course as EduCourse } from '@/components/education/CoursesCatalog';
import EnrollmentsPanel from '@/components/education/EnrollmentsPanel';
import LessonPlayer from '@/components/education/LessonPlayer';
import SkillTree from '@/components/education/SkillTree';
import StreakDashboard from '@/components/education/StreakDashboard';
import CertificatesPanel from '@/components/education/CertificatesPanel';
import AssignmentsBoard from '@/components/education/AssignmentsBoard';
import LessonNotes from '@/components/education/LessonNotes';
import CourseDiscussions from '@/components/education/CourseDiscussions';
import { ShellPreview } from '@/components/lens/ShellPreview';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  GraduationCap,
  Users,
  BookOpen,
  ClipboardList,
  BarChart2,
  FileText,
  Award,
  Plus,
  Search,
  X,
  Trash2,
  Calendar,
  Star,
  Target,
  TrendingUp,
  Percent,
  User,
  Layers,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Edit3,
  Eye,
  ArrowLeft,
  ToggleLeft,
  ToggleRight,
  Link,
  FileCheck,
  Shield,
  UserCheck,
  AlertOctagon,
  Calculator,
  Printer,
  CalendarCheck,
  Shuffle,
  Hash,
  MinusCircle,
  PlusCircle,
  Activity,
  BarChart3,
  BookMarked,
  ListChecks,
  Library,
  HelpCircle,
  FileQuestion,
  Video,
  FileType,
  ExternalLink,
  Flame,
  Timer,
  Zap,
  Dna,
  Route,
  ClipboardCheck,
  Coins,
  Send,
  Brain,
  MessageSquare,
  UserPlus,
  Trophy,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { GenomeGraph, type GenomeNode, type GenomeEdge } from '@/components/education/GenomeGraph';
import { PathStepCard, type PathStep } from '@/components/education/PathStepCard';
import { FlashcardDeck } from '@/components/education/FlashcardDeck';
import { SocraticTutor } from '@/components/education/SocraticTutor';
import { QuizGenerator } from '@/components/education/QuizGenerator';
import { LessonPlanBuilder } from '@/components/education/LessonPlanBuilder';
import { VideoLessonPlayer } from '@/components/education/VideoLessonPlayer';
import { InteractiveExercises } from '@/components/education/InteractiveExercises';
import { LearningPaths } from '@/components/education/LearningPaths';
import { LiveCohorts } from '@/components/education/LiveCohorts';
import { MasteryDashboard } from '@/components/education/MasteryDashboard';
import { LessonQA } from '@/components/education/LessonQA';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { VisionAnalyzeButton } from '@/components/common/VisionAnalyzeButton';
import LiveFeed from '@/components/lens/LiveFeed';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ModeTab =
  | 'Students'
  | 'Courses'
  | 'Assignments'
  | 'Grades'
  | 'Plans'
  | 'Certifications'
  | 'Resources'
  | 'Quizzes'
  | 'Study'
  // Concord Educational Engine — constraint-navigation learning surface
  | 'Genome'
  | 'Path'
  | 'Proof'
  | 'Tutor'
  | 'Cohort'
  | 'Assessment'
  | 'Credentials'
  | 'Earnings'
  | 'Flashcards'
  | 'Socratic'
  | 'QuizGen'
  | 'LessonPlan'
  // Parity backlog — video lessons, interactive exercises, paths, cohorts, mastery, lesson Q&A
  | 'Video'
  | 'Exercises'
  | 'Paths'
  | 'Cohorts'
  | 'Mastery'
  | 'LessonQA';
type ArtifactType = 'Student' | 'Course' | 'Assignment' | 'Grade' | 'LessonPlan' | 'Certification' | 'Resource' | 'Quiz';
type Status = 'enrolled' | 'active' | 'completed' | 'withdrawn' | 'graduated';
type AttendanceStatus = 'present' | 'absent' | 'tardy' | 'excused';
type SubmissionStatus = 'submitted' | 'late' | 'missing' | 'graded';
type GradeCategory = 'homework' | 'exams' | 'projects' | 'participation';
type ResourceType = 'textbook' | 'article' | 'video' | 'worksheet' | 'presentation' | 'link' | 'file' | 'other';
type QuestionType = 'multiple_choice' | 'true_false' | 'short_answer';

interface QuizQuestion {
  id: string;
  type: QuestionType;
  question: string;
  options?: string[];
  correctAnswer: string;
  points: number;
  explanation?: string;
}

interface RubricCriterion {
  name: string;
  description: string;
  maxPoints: number;
}

interface CurriculumWeek {
  weekNumber: number;
  topic: string;
  objectives: string[];
  standards: string[];
  resources: string[];
  duration: string;
  materials: string;
}

interface AttendanceRecord {
  studentId: string;
  studentName: string;
  date: string;
  status: AttendanceStatus;
}

interface GradeBookEntry {
  studentId: string;
  studentName: string;
  assignmentId: string;
  assignmentName: string;
  category: GradeCategory;
  score: number | null;
  maxScore: number;
}

interface EducationArtifact {
  artifactType: ArtifactType;
  status: Status;
  description: string;
  instructor?: string;
  subject?: string;
  dueDate?: string;
  grade?: string;
  score?: number;
  semester?: string;
  credits?: number;
  notes?: string;
  email?: string;
  enrollmentDate?: string;
  gpa?: number;
  totalCredits?: number;
  requiredCredits?: number;
  attendance?: AttendanceRecord[];
  rubric?: RubricCriterion[];
  latePolicy?: string;
  latePenalty?: number;
  peerReview?: boolean;
  plagiarismCheck?: boolean;
  submissionStatus?: SubmissionStatus;
  maxScore?: number;
  categoryWeights?: Record<GradeCategory, number>;
  dropLowest?: boolean;
  gradeBook?: GradeBookEntry[];
  curriculum?: CurriculumWeek[];
  enrolledStudents?: string[];
  syllabus?: string;
  expirationDate?: string;
  issuedBy?: string;
  resourceType?: ResourceType;
  resourceUrl?: string;
  resourceCourse?: string;
  resourceTopic?: string;
  quizQuestions?: QuizQuestion[];
  quizTimeLimit?: number;
  quizShuffleQuestions?: boolean;
  quizPassingScore?: number;
  quizAttempts?: number;
  [key: string]: unknown;
}

const MODE_TABS: { id: ModeTab; icon: LucideIcon; defaultType: ArtifactType }[] = [
  // Constraint-navigation learning surface (Concord Educational Engine)
  { id: 'Genome', icon: Dna, defaultType: 'Student' },
  { id: 'Path', icon: Route, defaultType: 'Student' },
  { id: 'Proof', icon: FileCheck, defaultType: 'Assignment' },
  { id: 'Tutor', icon: GraduationCap, defaultType: 'Student' },
  { id: 'Cohort', icon: Users, defaultType: 'Student' },
  { id: 'Assessment', icon: ClipboardCheck, defaultType: 'Quiz' },
  { id: 'Credentials', icon: Award, defaultType: 'Certification' },
  { id: 'Earnings', icon: Coins, defaultType: 'Student' },
  // Classic CRUD lens
  { id: 'Students', icon: Users, defaultType: 'Student' },
  { id: 'Courses', icon: BookOpen, defaultType: 'Course' },
  { id: 'Assignments', icon: ClipboardList, defaultType: 'Assignment' },
  { id: 'Grades', icon: BarChart2, defaultType: 'Grade' },
  { id: 'Plans', icon: FileText, defaultType: 'LessonPlan' },
  { id: 'Resources', icon: Library, defaultType: 'Resource' },
  { id: 'Quizzes', icon: HelpCircle, defaultType: 'Quiz' },
  { id: 'Certifications', icon: Award, defaultType: 'Certification' },
  { id: 'Study', icon: BookMarked, defaultType: 'Student' },
  // Parity-sprint surfaces (Anki / Khanmigo / Quizlet / Chalkie)
  { id: 'Flashcards', icon: BookMarked, defaultType: 'Student' },
  { id: 'Socratic', icon: GraduationCap, defaultType: 'Student' },
  { id: 'QuizGen', icon: HelpCircle, defaultType: 'Quiz' },
  { id: 'LessonPlan', icon: FileText, defaultType: 'LessonPlan' },
  // Parity backlog surfaces (Khan Academy + Coursera 2026)
  { id: 'Video', icon: Video, defaultType: 'Course' },
  { id: 'Exercises', icon: Target, defaultType: 'Quiz' },
  { id: 'Paths', icon: Route, defaultType: 'Course' },
  { id: 'Cohorts', icon: Users, defaultType: 'Student' },
  { id: 'Mastery', icon: Brain, defaultType: 'Student' },
  { id: 'LessonQA', icon: MessageSquare, defaultType: 'Course' },
];

const ALL_STATUSES: Status[] = ['enrolled', 'active', 'completed', 'withdrawn', 'graduated'];

const STATUS_COLORS: Record<Status, string> = {
  enrolled: 'neon-blue',
  active: 'neon-green',
  completed: 'neon-cyan',
  withdrawn: 'red-400',
  graduated: 'amber-400',
};

const ATTENDANCE_COLORS: Record<AttendanceStatus, string> = {
  present: 'text-green-400',
  absent: 'text-red-400',
  tardy: 'text-amber-400',
  excused: 'text-blue-400',
};

const ATTENDANCE_ICONS: Record<AttendanceStatus, LucideIcon> = {
  present: CheckCircle,
  absent: XCircle,
  tardy: Clock,
  excused: AlertTriangle,
};

const GRADE_COLORS: Record<string, string> = {
  A: 'text-green-400 bg-green-400/10',
  B: 'text-cyan-400 bg-cyan-400/10',
  C: 'text-yellow-400 bg-yellow-400/10',
  D: 'text-orange-400 bg-orange-400/10',
  F: 'text-red-400 bg-red-400/10',
};

const DEFAULT_CATEGORY_WEIGHTS: Record<GradeCategory, number> = {
  homework: 25,
  exams: 35,
  projects: 30,
  participation: 10,
};

const seedItems: { title: string; data: EducationArtifact }[] = [];

/* ------------------------------------------------------------------ */
/*  Helper Functions                                                    */
/* ------------------------------------------------------------------ */

function scoreToLetter(score: number): string {
  if (score >= 93) return 'A';
  if (score >= 90) return 'A-';
  if (score >= 87) return 'B+';
  if (score >= 83) return 'B';
  if (score >= 80) return 'B-';
  if (score >= 77) return 'C+';
  if (score >= 73) return 'C';
  if (score >= 70) return 'C-';
  if (score >= 67) return 'D+';
  if (score >= 63) return 'D';
  if (score >= 60) return 'D-';
  return 'F';
}

function letterToGpa(letter: string): number {
  const map: Record<string, number> = {
    'A': 4.0, 'A-': 3.7, 'B+': 3.3, 'B': 3.0, 'B-': 2.7,
    'C+': 2.3, 'C': 2.0, 'C-': 1.7, 'D+': 1.3, 'D': 1.0, 'D-': 0.7, 'F': 0.0,
  };
  return map[letter] ?? 0.0;
}

function getGradeColorKey(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function calculateWeightedAverage(
  entries: GradeBookEntry[],
  weights: Record<GradeCategory, number>,
  dropLowest: boolean
): number {
  const categories: GradeCategory[] = ['homework', 'exams', 'projects', 'participation'];
  let totalWeight = 0;
  let weightedSum = 0;

  for (const cat of categories) {
    let catEntries = entries.filter(e => e.category === cat && e.score !== null);
    if (catEntries.length === 0) continue;

    if (dropLowest && catEntries.length > 1) {
      const sorted = [...catEntries].sort((a, b) => ((a.score ?? 0) / a.maxScore) - ((b.score ?? 0) / b.maxScore));
      catEntries = sorted.slice(1);
    }

    const catAvg = catEntries.reduce((sum, e) => sum + ((e.score ?? 0) / e.maxScore) * 100, 0) / catEntries.length;
    weightedSum += catAvg * (weights[cat] / 100);
    totalWeight += weights[cat] / 100;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

/* ------------------------------------------------------------------ */
/*  Mastery Badge                                                      */
/* ------------------------------------------------------------------ */

const MASTERY_LEVELS = [
  { key: 'beginner',     label: 'Beginner',     color: 'text-gray-400    bg-gray-400/10    border-gray-400/30',    min: 0   },
  { key: 'intermediate', label: 'Intermediate', color: 'text-cyan-400    bg-cyan-400/10    border-cyan-400/30',    min: 40  },
  { key: 'advanced',     label: 'Advanced',     color: 'text-neon-green  bg-neon-green/10  border-neon-green/30',  min: 70  },
  { key: 'expert',       label: 'Expert',       color: 'text-amber-400   bg-amber-400/10   border-amber-400/30',   min: 90  },
] as const;

function getMasteryLevel(score: number) {
  for (let i = MASTERY_LEVELS.length - 1; i >= 0; i--) {
    if (score >= MASTERY_LEVELS[i].min) return MASTERY_LEVELS[i];
  }
  return MASTERY_LEVELS[0];
}

function MasteryBadge({ score }: { score: number }) {
  const lvl = getMasteryLevel(score);
  return (
    <span className={cn('px-2 py-0.5 rounded text-xs font-semibold border', lvl.color)}>
      {lvl.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Learning Streak Indicator                                          */
/* ------------------------------------------------------------------ */

function LearningStreak({ streak = 5, best = 21 }: { streak?: number; best?: number }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
      <Flame className="w-4 h-4 text-amber-400 shrink-0" />
      <div>
        <span className="text-sm font-bold text-amber-400">{streak}-day streak</span>
        <span className="text-xs text-gray-400 ml-2">Best: {best}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Course Progress Bar                                                */
/* ------------------------------------------------------------------ */

function CourseProgressBar({ label, pct, color = 'neon-cyan' }: { label: string; pct: number; color?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-300">{label}</span>
        <span className={`text-${color} font-semibold`}>{Math.round(pct)}%</span>
      </div>
      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
        <motion.div
          className={`h-full bg-${color} rounded-full`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Study Session Timer                                                */
/* ------------------------------------------------------------------ */

function StudySessionTimer() {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [sessions, setSessions] = useState(0);
  const [goal, setGoal] = useState(25 * 60); // 25 min pomodoro
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setElapsed(e => {
          if (e + 1 >= goal) {
            setRunning(false);
            setSessions(s => s + 1);
            return 0;
          }
          return e + 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running, goal]);

  const pct = goal > 0 ? (elapsed / goal) * 100 : 0;
  const mm = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const ss = (elapsed % 60).toString().padStart(2, '0');
  const totalMin = Math.floor(goal / 60);
  const circumference = 2 * Math.PI * 28;
  const dash = (pct / 100) * circumference;

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Timer className="w-4 h-4 text-neon-cyan" /> Study Timer
        </h3>
        <span className="text-xs text-gray-400">{sessions} session{sessions !== 1 ? 's' : ''} today</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="relative w-16 h-16 shrink-0">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="5" />
            <circle cx="32" cy="32" r="28" fill="none"
              stroke={running ? '#06b6d4' : '#6b7280'} strokeWidth="5" strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              style={{ transition: 'stroke-dasharray 0.5s linear' }} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-mono font-bold text-white">{mm}:{ss}</span>
          </div>
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <select value={totalMin} onChange={e => { setGoal(parseInt(e.target.value)*60); setElapsed(0); setRunning(false); }}
              className="text-xs bg-white/5 border border-white/10 rounded px-2 py-1">
              <option value={5}>5 min</option>
              <option value={15}>15 min</option>
              <option value={25}>25 min (Pomodoro)</option>
              <option value={45}>45 min</option>
              <option value={60}>60 min</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setRunning(r => !r)}
              className={cn('px-3 py-1 rounded text-xs font-medium transition-colors',
                running ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                        : 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30')}>
              {running ? 'Pause' : 'Start'}
            </button>
            <button onClick={() => { setElapsed(0); setRunning(false); }}
              className="px-3 py-1 rounded text-xs bg-white/5 border border-white/10 hover:bg-white/10">
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function EducationLensPage() {
  useLensNav('education');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('education');

  /* ---------- core state ---------- */
  const [activeTab, setActiveTab] = useState<ModeTab>('Students');

  // Lens-scoped keyboard commands. LMS idiom (Canvas / Schoology):
  // single-letter section jumps for the teaching workflow.
  const searchInputRef = useRef<HTMLInputElement>(null);
  useLensCommand(
    [
      { id: 'tab-students', keys: 's', description: 'Students', category: 'navigation', action: () => setActiveTab('Students') },
      { id: 'tab-courses', keys: 'c', description: 'Courses', category: 'navigation', action: () => setActiveTab('Courses') },
      { id: 'tab-assignments', keys: 'a', description: 'Assignments', category: 'navigation', action: () => setActiveTab('Assignments') },
      { id: 'tab-grades', keys: 'g', description: 'Grades', category: 'navigation', action: () => setActiveTab('Grades') },
      { id: 'tab-quizzes', keys: 'q', description: 'Quizzes', category: 'navigation', action: () => setActiveTab('Quizzes') },
      { id: 'tab-resources', keys: 'r', description: 'Resources', category: 'navigation', action: () => setActiveTab('Resources') },      { id: "focus-search", keys: "/", description: "Focus search", category: "navigation", action: () => searchInputRef.current?.focus() },

    ],
    { lensId: 'education' }
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<Status | 'all'>('all');
  const [showEditor, setShowEditor] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<EducationArtifact> | null>(null);
  const [showFeatures, setShowFeatures] = useState(true);
  const [showStudyPanel, setShowStudyPanel] = useState(false);

  /* ---------- detail views ---------- */
  const [selectedStudent, setSelectedStudent] = useState<LensItem<EducationArtifact> | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<LensItem<EducationArtifact> | null>(null);
  const [showGradeBook, setShowGradeBook] = useState(false);
  const [showAttendance, setShowAttendance] = useState(false);
  const [showCurriculum, setShowCurriculum] = useState(false);
  const [showAssignmentBuilder, setShowAssignmentBuilder] = useState(false);

  /* ---------- gradebook state ---------- */
  const [categoryWeights, setCategoryWeights] = useState<Record<GradeCategory, number>>(DEFAULT_CATEGORY_WEIGHTS);
  const [dropLowest, setDropLowest] = useState(false);
  const [gradeBookData, setGradeBookData] = useState<GradeBookEntry[]>([]);
  const [editingCell, setEditingCell] = useState<{ studentId: string; assignmentId: string } | null>(null);
  const [cellValue, setCellValue] = useState('');

  /* ---------- attendance state ---------- */
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [attendanceDate, setAttendanceDate] = useState(new Date().toISOString().slice(0, 10));

  /* ---------- curriculum state ---------- */
  const [curriculumWeeks, setCurriculumWeeks] = useState<CurriculumWeek[]>([]);
  const [expandedWeek, setExpandedWeek] = useState<number | null>(null);
  const [editingWeek, setEditingWeek] = useState<CurriculumWeek | null>(null);

  /* ---------- assignment builder state ---------- */
  const [rubricCriteria, setRubricCriteria] = useState<RubricCriterion[]>([]);
  const [latePolicy, setLatePolicy] = useState('10% per day');
  const [latePenalty, setLatePenalty] = useState(10);
  const [peerReview, setPeerReview] = useState(false);
  const [plagiarismCheck, setPlagiarismCheck] = useState(false);

  /* ---------- quiz builder state ---------- */
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [quizTimeLimit, setQuizTimeLimit] = useState(30);
  const [quizShuffleQuestions, setQuizShuffleQuestions] = useState(false);
  const [quizPassingScore, setQuizPassingScore] = useState(70);

  /* ---------- resource form state ---------- */
  const [formResourceType, setFormResourceType] = useState<ResourceType>('textbook');
  const [formResourceUrl, setFormResourceUrl] = useState('');
  const [formResourceCourse, setFormResourceCourse] = useState('');
  const [formResourceTopic, setFormResourceTopic] = useState('');

  /* ---------- editor form state ---------- */
  const [formTitle, setFormTitle] = useState('');
  const [formType, setFormType] = useState<ArtifactType>('Student');
  const [formStatus, setFormStatus] = useState<Status>('enrolled');
  const [formDescription, setFormDescription] = useState('');
  const [formInstructor, setFormInstructor] = useState('');
  const [formSubject, setFormSubject] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formGrade, setFormGrade] = useState('');
  const [formScore, setFormScore] = useState('');
  const [formSemester, setFormSemester] = useState('');
  const [formCredits, setFormCredits] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formMaxScore, setFormMaxScore] = useState('100');
  const [formCategory, setFormCategory] = useState<GradeCategory>('homework');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);

  /* ---------- data hooks ---------- */
  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<EducationArtifact>('education', 'artifact', {
    seed: seedItems.map(s => ({ title: s.title, data: s.data as unknown as Record<string, unknown>, meta: { status: s.data.status, tags: [s.data.artifactType] } })),
  });

  const runAction = useRunArtifact('education');

  /* ---------- derived data ---------- */
  const currentTabType = MODE_TABS.find(t => t.id === activeTab)?.defaultType ?? 'Student';

  const filtered = useMemo(() => {
    let list = items.filter(i => (i.data as unknown as EducationArtifact).artifactType === currentTabType);
    if (filterStatus !== 'all') list = list.filter(i => (i.data as unknown as EducationArtifact).status === filterStatus);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(i => i.title.toLowerCase().includes(q) || (i.data as unknown as EducationArtifact).description?.toLowerCase().includes(q));
    }
    return list;
  }, [items, currentTabType, filterStatus, searchQuery]);

  const students = useMemo(() => items.filter(i => (i.data as unknown as EducationArtifact).artifactType === 'Student'), [items]);
  const courses = useMemo(() => items.filter(i => (i.data as unknown as EducationArtifact).artifactType === 'Course'), [items]);
  const assignments = useMemo(() => items.filter(i => (i.data as unknown as EducationArtifact).artifactType === 'Assignment'), [items]);
  const grades = useMemo(() => items.filter(i => (i.data as unknown as EducationArtifact).artifactType === 'Grade'), [items]);
  const certifications = useMemo(() => items.filter(i => (i.data as unknown as EducationArtifact).artifactType === 'Certification'), [items]);
  const resources = useMemo(() => items.filter(i => (i.data as unknown as EducationArtifact).artifactType === 'Resource'), [items]);
  const quizzes = useMemo(() => items.filter(i => (i.data as unknown as EducationArtifact).artifactType === 'Quiz'), [items]);

  const stats = useMemo(() => {
    const gradeItems = grades.filter(i => (i.data as unknown as EducationArtifact).score != null);
    const avgScore = gradeItems.length > 0 ? gradeItems.reduce((s, i) => s + ((i.data as unknown as EducationArtifact).score ?? 0), 0) / gradeItems.length : 0;

    const atRiskStudents = students.filter(s => {
      const d = s.data as unknown as EducationArtifact;
      const studentGrades = grades.filter(g => (g.data as unknown as EducationArtifact).notes?.includes(s.id));
      const avg = studentGrades.length > 0
        ? studentGrades.reduce((sum, g) => sum + ((g.data as unknown as EducationArtifact).score ?? 0), 0) / studentGrades.length
        : null;
      const studentAttendance = attendanceRecords.filter(a => a.studentId === s.id);
      const absentCount = studentAttendance.filter(a => a.status === 'absent').length;
      const attendanceRate = studentAttendance.length > 0 ? ((studentAttendance.length - absentCount) / studentAttendance.length) * 100 : 100;
      return (avg !== null && avg < 60) || attendanceRate < 80 || d.status === 'withdrawn';
    });

    const upcomingAssignments = assignments
      .filter(i => {
        const d = i.data as unknown as EducationArtifact;
        return d.dueDate && new Date(d.dueDate) > new Date() && d.status === 'active';
      })
      .sort((a, b) => {
        const da = (a.data as unknown as EducationArtifact).dueDate ?? '';
        const db = (b.data as unknown as EducationArtifact).dueDate ?? '';
        return da.localeCompare(db);
      });

    const expiringCerts = certifications.filter(i => {
      const d = i.data as unknown as EducationArtifact;
      if (!d.expirationDate) return false;
      const exp = new Date(d.expirationDate);
      const now = new Date();
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      return exp.getTime() - now.getTime() < thirtyDays && exp > now;
    });

    return {
      students: students.length,
      activeCourses: courses.filter(i => (i.data as unknown as EducationArtifact).status === 'active').length,
      pendingAssignments: assignments.filter(i => (i.data as unknown as EducationArtifact).status === 'active').length,
      avgScore: Math.round(avgScore),
      certificationCount: certifications.filter(i => (i.data as unknown as EducationArtifact).status === 'completed').length,
      atRiskStudents,
      upcomingAssignments: upcomingAssignments.slice(0, 5),
      expiringCerts,
    };
  }, [students, courses, assignments, grades, certifications, attendanceRecords]);

  /* ---------- gradebook computed ---------- */
  const gradeBookStudents = useMemo(() => {
    const uniqueStudents: { id: string; name: string }[] = [];
    const seen = new Set<string>();
    for (const entry of gradeBookData) {
      if (!seen.has(entry.studentId)) {
        seen.add(entry.studentId);
        uniqueStudents.push({ id: entry.studentId, name: entry.studentName });
      }
    }
    return uniqueStudents;
  }, [gradeBookData]);

  const gradeBookAssignments = useMemo(() => {
    const unique: { id: string; name: string; category: GradeCategory }[] = [];
    const seen = new Set<string>();
    for (const entry of gradeBookData) {
      if (!seen.has(entry.assignmentId)) {
        seen.add(entry.assignmentId);
        unique.push({ id: entry.assignmentId, name: entry.assignmentName, category: entry.category });
      }
    }
    return unique;
  }, [gradeBookData]);

  /* ---------- attendance computed ---------- */
  const attendanceSummary = useMemo(() => {
    const summary: Record<string, { present: number; absent: number; tardy: number; excused: number; total: number }> = {};
    for (const record of attendanceRecords) {
      if (!summary[record.studentId]) {
        summary[record.studentId] = { present: 0, absent: 0, tardy: 0, excused: 0, total: 0 };
      }
      summary[record.studentId][record.status]++;
      summary[record.studentId].total++;
    }
    return summary;
  }, [attendanceRecords]);

  /* ---------- editor helpers ---------- */
  const openNewEditor = () => {
    setEditingItem(null);
    setFormTitle('');
    setFormType(currentTabType);
    setFormStatus('enrolled');
    setFormDescription('');
    setFormInstructor('');
    setFormSubject('');
    setFormDueDate('');
    setFormGrade('');
    setFormScore('');
    setFormSemester('');
    setFormCredits('');
    setFormNotes('');
    setFormEmail('');
    setFormMaxScore('100');
    setFormCategory('homework');
    setRubricCriteria([]);
    setPeerReview(false);
    setPlagiarismCheck(false);
    setQuizQuestions([]);
    setQuizTimeLimit(30);
    setQuizShuffleQuestions(false);
    setQuizPassingScore(70);
    setFormResourceType('textbook');
    setFormResourceUrl('');
    setFormResourceCourse('');
    setFormResourceTopic('');
    setShowEditor(true);
  };

  const openEditEditor = (item: LensItem<EducationArtifact>) => {
    const d = item.data as unknown as EducationArtifact;
    setEditingItem(item);
    setFormTitle(item.title);
    setFormType(d.artifactType);
    setFormStatus(d.status);
    setFormDescription(d.description || '');
    setFormInstructor(d.instructor || '');
    setFormSubject(d.subject || '');
    setFormDueDate(d.dueDate || '');
    setFormGrade(d.grade || '');
    setFormScore(d.score != null ? String(d.score) : '');
    setFormSemester(d.semester || '');
    setFormCredits(d.credits != null ? String(d.credits) : '');
    setFormNotes(d.notes || '');
    setFormEmail(d.email || '');
    setFormMaxScore(d.maxScore != null ? String(d.maxScore) : '100');
    setFormCategory((d.categoryWeights ? 'homework' : 'homework') as GradeCategory);
    setRubricCriteria(d.rubric || []);
    setPeerReview(d.peerReview || false);
    setPlagiarismCheck(d.plagiarismCheck || false);
    setQuizQuestions(d.quizQuestions || []);
    setQuizTimeLimit(d.quizTimeLimit ?? 30);
    setQuizShuffleQuestions(d.quizShuffleQuestions || false);
    setQuizPassingScore(d.quizPassingScore ?? 70);
    setFormResourceType(d.resourceType || 'textbook');
    setFormResourceUrl(d.resourceUrl || '');
    setFormResourceCourse(d.resourceCourse || '');
    setFormResourceTopic(d.resourceTopic || '');
    setShowEditor(true);
  };

  const handleSave = async () => {
    const payload = {
      title: formTitle,
      data: {
        artifactType: formType, status: formStatus, description: formDescription,
        instructor: formInstructor, subject: formSubject, dueDate: formDueDate,
        grade: formGrade || undefined, score: formScore ? parseFloat(formScore) : undefined,
        semester: formSemester, credits: formCredits ? parseInt(formCredits) : undefined,
        notes: formNotes, email: formEmail || undefined,
        maxScore: formMaxScore ? parseInt(formMaxScore) : 100,
        rubric: rubricCriteria.length > 0 ? rubricCriteria : undefined,
        peerReview, plagiarismCheck,
        latePolicy: latePolicy || undefined,
        latePenalty: latePenalty || undefined,
        resourceType: formType === 'Resource' ? formResourceType : undefined,
        resourceUrl: formType === 'Resource' ? formResourceUrl : undefined,
        resourceCourse: formType === 'Resource' ? formResourceCourse : undefined,
        resourceTopic: formType === 'Resource' ? formResourceTopic : undefined,
        quizQuestions: formType === 'Quiz' && quizQuestions.length > 0 ? quizQuestions : undefined,
        quizTimeLimit: formType === 'Quiz' ? quizTimeLimit : undefined,
        quizShuffleQuestions: formType === 'Quiz' ? quizShuffleQuestions : undefined,
        quizPassingScore: formType === 'Quiz' ? quizPassingScore : undefined,
      } as unknown as Partial<EducationArtifact>,
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

  const handleDownloadResult = useCallback((content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  /* ---------- gradebook helpers ---------- */
  const handleCellEdit = (studentId: string, assignmentId: string, value: string) => {
    const numVal = value === '' ? null : parseFloat(value);
    setGradeBookData(prev => prev.map(e =>
      e.studentId === studentId && e.assignmentId === assignmentId
        ? { ...e, score: numVal }
        : e
    ));
    setEditingCell(null);
  };

  const addGradeBookStudent = useCallback(() => {
    if (students.length === 0 || gradeBookAssignments.length === 0) return;
    const newStudent = students.find(s => !gradeBookStudents.some(gs => gs.id === s.id));
    if (!newStudent) return;
    const newEntries: GradeBookEntry[] = gradeBookAssignments.map(a => ({
      studentId: newStudent.id,
      studentName: newStudent.title,
      assignmentId: a.id,
      assignmentName: a.name,
      category: a.category,
      score: null,
      maxScore: 100,
    }));
    setGradeBookData(prev => [...prev, ...newEntries]);
  }, [students, gradeBookAssignments, gradeBookStudents]);

  const addGradeBookAssignment = useCallback((name: string, category: GradeCategory, maxScore: number) => {
    const assignmentId = `asgn-${Date.now()}`;
    const newEntries: GradeBookEntry[] = gradeBookStudents.map(s => ({
      studentId: s.id,
      studentName: s.name,
      assignmentId,
      assignmentName: name,
      category,
      score: null,
      maxScore,
    }));
    setGradeBookData(prev => [...prev, ...newEntries]);
  }, [gradeBookStudents]);

  /* ---------- attendance helpers ---------- */
  const markAttendance = (studentId: string, studentName: string, status: AttendanceStatus) => {
    setAttendanceRecords(prev => {
      const existing = prev.findIndex(r => r.studentId === studentId && r.date === attendanceDate);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = { ...updated[existing], status };
        return updated;
      }
      return [...prev, { studentId, studentName, date: attendanceDate, status }];
    });
  };

  /* ---------- curriculum helpers ---------- */
  const addCurriculumWeek = () => {
    const nextWeek = curriculumWeeks.length + 1;
    setCurriculumWeeks(prev => [...prev, {
      weekNumber: nextWeek,
      topic: '',
      objectives: [],
      standards: [],
      resources: [],
      duration: '5 days',
      materials: '',
    }]);
    setExpandedWeek(nextWeek);
    setEditingWeek({
      weekNumber: nextWeek, topic: '', objectives: [], standards: [],
      resources: [], duration: '5 days', materials: '',
    });
  };

  const saveCurriculumWeek = (week: CurriculumWeek) => {
    setCurriculumWeeks(prev => prev.map(w => w.weekNumber === week.weekNumber ? week : w));
    setEditingWeek(null);
  };

  /* ---------- rubric helpers ---------- */
  const addRubricCriterion = () => {
    setRubricCriteria(prev => [...prev, { name: '', description: '', maxPoints: 10 }]);
  };

  const updateRubricCriterion = (index: number, field: keyof RubricCriterion, value: string | number) => {
    setRubricCriteria(prev => prev.map((c, i) => i === index ? { ...c, [field]: value } : c));
  };

  const removeRubricCriterion = (index: number) => {
    setRubricCriteria(prev => prev.filter((_, i) => i !== index));
  };

  /* ---------- quiz helpers ---------- */
  const addQuizQuestion = (type: QuestionType) => {
    const newQ: QuizQuestion = {
      id: `q-${Date.now()}`,
      type,
      question: '',
      options: type === 'multiple_choice' ? ['', '', '', ''] : type === 'true_false' ? ['True', 'False'] : undefined,
      correctAnswer: '',
      points: 10,
      explanation: '',
    };
    setQuizQuestions(prev => [...prev, newQ]);
  };

  const updateQuizQuestion = (id: string, field: keyof QuizQuestion, value: unknown) => {
    setQuizQuestions(prev => prev.map(q => q.id === id ? { ...q, [field]: value } : q));
  };

  const updateQuizOption = (questionId: string, optIndex: number, value: string) => {
    setQuizQuestions(prev => prev.map(q => {
      if (q.id !== questionId || !q.options) return q;
      const newOptions = [...q.options];
      newOptions[optIndex] = value;
      return { ...q, options: newOptions };
    }));
  };

  const addQuizOption = (questionId: string) => {
    setQuizQuestions(prev => prev.map(q => {
      if (q.id !== questionId || !q.options) return q;
      return { ...q, options: [...q.options, ''] };
    }));
  };

  const removeQuizQuestion = (id: string) => {
    setQuizQuestions(prev => prev.filter(q => q.id !== id));
  };

  /* ---------- student progress computed ---------- */
  const studentProgress = useMemo(() => {
    if (!selectedStudent) return null;
    const d = selectedStudent.data as unknown as EducationArtifact;
    const studentGrades = grades.filter(g => {
      const gd = g.data as unknown as EducationArtifact;
      return gd.notes?.includes(selectedStudent.id) || gd.instructor === selectedStudent.title;
    });
    const scores = studentGrades.filter(g => (g.data as unknown as EducationArtifact).score != null)
      .map(g => (g.data as unknown as EducationArtifact).score ?? 0);
    const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const gpa = letterToGpa(scoreToLetter(avgScore));
    const completedAssignments = studentGrades.filter(g => (g.data as unknown as EducationArtifact).status === 'completed').length;
    const totalAssignments = assignments.length;
    const completionRate = totalAssignments > 0 ? (completedAssignments / totalAssignments) * 100 : 0;
    const missingAssignments = assignments.filter(a => {
      const ad = a.data as unknown as EducationArtifact;
      return ad.dueDate && new Date(ad.dueDate) < new Date() &&
        !studentGrades.some(g => (g.data as unknown as EducationArtifact).notes?.includes(a.id));
    });
    const earnedCredits = d.totalCredits ?? 0;
    const requiredCredits = d.requiredCredits ?? 120;

    const studentAttendance = attendanceRecords.filter(r => r.studentId === selectedStudent.id);
    const attendanceRate = studentAttendance.length > 0
      ? (studentAttendance.filter(r => r.status === 'present' || r.status === 'tardy').length / studentAttendance.length) * 100
      : 100;

    return {
      gpa: Math.round(gpa * 100) / 100,
      avgScore: Math.round(avgScore),
      completionRate: Math.round(completionRate),
      missingAssignments,
      earnedCredits,
      requiredCredits,
      creditProgress: requiredCredits > 0 ? (earnedCredits / requiredCredits) * 100 : 0,
      scores,
      attendanceRate: Math.round(attendanceRate),
    };
  }, [selectedStudent, grades, assignments, attendanceRecords]);

  /* ---------- course detail computed ---------- */
  const courseDetail = useMemo(() => {
    if (!selectedCourse) return null;
    const d = selectedCourse.data as unknown as EducationArtifact;
    const enrolledStudentItems = students.filter(s => {
      const sd = s.data as unknown as EducationArtifact;
      return sd.subject === d.subject || d.enrolledStudents?.includes(s.id);
    });
    const courseGrades = grades.filter(g => {
      const gd = g.data as unknown as EducationArtifact;
      return gd.subject === d.subject;
    });
    const courseScores = courseGrades.filter(g => (g.data as unknown as EducationArtifact).score != null)
      .map(g => (g.data as unknown as EducationArtifact).score ?? 0);
    const classAverage = courseScores.length > 0 ? courseScores.reduce((a, b) => a + b, 0) / courseScores.length : 0;
    const distribution = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    courseScores.forEach(s => { distribution[getGradeColorKey(s) as keyof typeof distribution]++; });
    const upcoming = assignments.filter(a => {
      const ad = a.data as unknown as EducationArtifact;
      return ad.subject === d.subject && ad.dueDate && new Date(ad.dueDate) > new Date();
    }).sort((a, b) => {
      const da = (a.data as unknown as EducationArtifact).dueDate ?? '';
      const db = (b.data as unknown as EducationArtifact).dueDate ?? '';
      return da.localeCompare(db);
    });

    return {
      enrolledStudentItems,
      classAverage: Math.round(classAverage),
      distribution,
      upcoming,
      totalStudents: enrolledStudentItems.length,
    };
  }, [selectedCourse, students, grades, assignments]);

  /* ================================================================== */
  /*  RENDER                                                             */
  /* ================================================================== */

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

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  /* ---------- Student Progress Detail View ---------- */
  if (selectedStudent && studentProgress) {
    return (
      <div className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3">
            <button onClick={() => setSelectedStudent(null)} className={ds.btnGhost} aria-label="Back">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <User className="w-7 h-7 text-neon-blue" />
            <div>
              <h1 className={ds.heading1}>{selectedStudent.title}</h1>
              <p className={ds.textMuted}>Student Progress Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => handleAction('generateReportCard', selectedStudent.id)} className={ds.btnSecondary}>
              <Printer className="w-4 h-4" /> Report Card
            </button>
            <button onClick={() => openEditEditor(selectedStudent)} className={ds.btnPrimary}>
              <Edit3 className="w-4 h-4" /> Edit
            </button>
          </div>
        </header>


      {/* AI Actions */}
      <UniversalActions domain="education" artifactId={items[0]?.id} compact />
        {/* Key Metrics */}
        <div className={ds.grid4}>
          <div className={ds.panel}>
            <GraduationCap className="w-5 h-5 text-neon-blue mb-2" />
            <p className="text-3xl font-bold text-white">{studentProgress.gpa.toFixed(2)}</p>
            <p className={ds.textMuted}>GPA (4.0 Scale)</p>
          </div>
          <div className={ds.panel}>
            <Percent className="w-5 h-5 text-neon-green mb-2" />
            <p className="text-3xl font-bold text-white">{studentProgress.avgScore}%</p>
            <p className={ds.textMuted}>Average Score</p>
          </div>
          <div className={ds.panel}>
            <CheckCircle className="w-5 h-5 text-neon-cyan mb-2" />
            <p className="text-3xl font-bold text-white">{studentProgress.completionRate}%</p>
            <p className={ds.textMuted}>Assignment Completion</p>
          </div>
          <div className={ds.panel}>
            <UserCheck className="w-5 h-5 text-amber-400 mb-2" />
            <p className="text-3xl font-bold text-white">{studentProgress.attendanceRate}%</p>
            <p className={ds.textMuted}>Attendance Rate</p>
          </div>
        </div>

        {/* Credits Progress */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3')}>Credits Progress</h3>
          <div className="flex items-center gap-4 mb-2">
            <span className={ds.textMuted}>{studentProgress.earnedCredits} / {studentProgress.requiredCredits} credits</span>
            <span className={cn(ds.textMuted, 'text-xs')}>({Math.round(studentProgress.creditProgress)}%)</span>
          </div>
          <div className="w-full h-4 bg-lattice-elevated rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-neon-blue to-neon-cyan rounded-full transition-all duration-500"
              style={{ width: `${Math.min(studentProgress.creditProgress, 100)}%` }}
            />
          </div>
        </div>

        {/* Grade Trend */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3')}>Grade Trend</h3>
          {studentProgress.scores.length > 0 ? (
            <div className="flex items-end gap-1 h-32">
              {studentProgress.scores.map((score, idx) => (
                <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-gray-400">{score}%</span>
                  <div
                    className={cn(
                      'w-full rounded-t transition-all',
                      GRADE_COLORS[getGradeColorKey(score)]
                    )}
                    style={{ height: `${score}%` }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className={cn(ds.textMuted, 'text-center py-6')}>No grade data available yet</p>
          )}
        </div>

        {/* Missing Assignments Alert */}
        {studentProgress.missingAssignments.length > 0 && (
          <div className={cn(ds.panel, 'border-red-500/30 bg-red-500/5')}>
            <div className="flex items-center gap-2 mb-3">
              <AlertOctagon className="w-5 h-5 text-red-400" />
              <h3 className={cn(ds.heading3, 'text-red-400')}>Missing Assignments ({studentProgress.missingAssignments.length})</h3>
            </div>
            <div className="space-y-2">
              {studentProgress.missingAssignments.map(a => {
                const ad = a.data as unknown as EducationArtifact;
                return (
                  <div key={a.id} className="flex items-center justify-between py-2 border-b border-lattice-border last:border-0">
                    <span className="text-sm text-white">{a.title}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">{ad.subject}</span>
                      <span className="text-xs text-red-400">Due: {ad.dueDate}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ---------- Course Detail View ---------- */
  if (selectedCourse && courseDetail) {
    const cd = selectedCourse.data as unknown as EducationArtifact;
    return (
      <div className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3">
            <button onClick={() => setSelectedCourse(null)} className={ds.btnGhost} aria-label="Back">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <BookOpen className="w-7 h-7 text-neon-green" />
            <div>
              <h1 className={ds.heading1}>{selectedCourse.title}</h1>
              <p className={ds.textMuted}>{cd.instructor ? `Instructor: ${cd.instructor}` : 'Course Details'} {cd.semester ? `| ${cd.semester}` : ''}</p>
            </div>
          </div>
          <button onClick={() => openEditEditor(selectedCourse)} className={ds.btnPrimary}>
            <Edit3 className="w-4 h-4" /> Edit Course
          </button>
        </header>

        {/* Course Metrics */}
        <div className={ds.grid4}>
          <div className={ds.panel}>
            <Users className="w-5 h-5 text-neon-blue mb-2" />
            <p className="text-3xl font-bold text-white">{courseDetail.totalStudents}</p>
            <p className={ds.textMuted}>Enrolled Students</p>
          </div>
          <div className={ds.panel}>
            <BarChart2 className="w-5 h-5 text-neon-green mb-2" />
            <p className="text-3xl font-bold text-white">{courseDetail.classAverage > 0 ? `${courseDetail.classAverage}%` : '--'}</p>
            <p className={ds.textMuted}>Class Average</p>
          </div>
          <div className={ds.panel}>
            <ClipboardList className="w-5 h-5 text-amber-400 mb-2" />
            <p className="text-3xl font-bold text-white">{courseDetail.upcoming.length}</p>
            <p className={ds.textMuted}>Upcoming Assignments</p>
          </div>
          <div className={ds.panel}>
            <Target className="w-5 h-5 text-neon-cyan mb-2" />
            <p className="text-3xl font-bold text-white">{cd.credits ?? '--'}</p>
            <p className={ds.textMuted}>Credit Hours</p>
          </div>
        </div>

        {/* Grade Distribution */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-4')}>Grade Distribution</h3>
          <div className="flex items-end gap-4 h-32">
            {Object.entries(courseDetail.distribution).map(([letter, count]) => {
              const maxCount = Math.max(...Object.values(courseDetail.distribution), 1);
              const heightPct = (count / maxCount) * 100;
              return (
                <div key={letter} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-gray-400">{count}</span>
                  <div
                    className={cn('w-full rounded-t transition-all min-h-[4px]', GRADE_COLORS[letter])}
                    style={{ height: `${Math.max(heightPct, 4)}%` }}
                  />
                  <span className="text-sm font-bold text-white">{letter}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className={ds.grid2}>
          {/* Enrolled Students */}
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-3')}>Enrolled Students</h3>
            {courseDetail.enrolledStudentItems.length === 0 ? (
              <p className={cn(ds.textMuted, 'text-center py-4')}>No students enrolled</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {courseDetail.enrolledStudentItems.map(s => {
                  const sd = s.data as unknown as EducationArtifact;
                  return (
                    <div key={s.id} className="flex items-center justify-between py-2 border-b border-lattice-border last:border-0">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-white">{s.title}</span>
                      </div>
                      <span className={ds.badge(STATUS_COLORS[sd.status])}>{sd.status}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Upcoming Assignments */}
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-3')}>Upcoming Assignments</h3>
            {courseDetail.upcoming.length === 0 ? (
              <p className={cn(ds.textMuted, 'text-center py-4')}>No upcoming assignments</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {courseDetail.upcoming.map(a => {
                  const ad = a.data as unknown as EducationArtifact;
                  return (
                    <div key={a.id} className="flex items-center justify-between py-2 border-b border-lattice-border last:border-0">
                      <span className="text-sm text-white">{a.title}</span>
                      <span className="text-xs text-gray-400">{ad.dueDate}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Syllabus */}
        {cd.syllabus && (
          <div className={ds.panel}>
            <h3 className={cn(ds.heading3, 'mb-3')}>Syllabus</h3>
            <div className={cn(ds.textMuted, 'whitespace-pre-wrap')}>{cd.syllabus}</div>
          </div>
        )}
      </div>
    );
  }

  /* ================================================================== */
  /*  MAIN PAGE RENDER                                                   */
  /* ================================================================== */

  return (
    <LensShell lensId="education" asMain={false}>
      <FirstRunTour lensId="education" />
      <DepthBadge lensId="education" size="sm" className="ml-2" />
    <div data-lens-theme="education" className="p-6 space-y-6 bg-gradient-to-b from-amber-950/10 to-transparent">
      <ShellPreview lensId="education" defaultOpen={true} />
      <KhanCourseraWorkbenchSection />
      {/* Header */}
      <header className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-400/20 flex items-center justify-center">
            <GraduationCap className="w-6 h-6 text-amber-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-amber-50">Education</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className={ds.textMuted}>Student management, courses, assignments, and academic tracking</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DTUExportButton domain="education" data={{}} compact />
          <VisionAnalyzeButton
            domain="education"
            prompt="Analyze this education-related image (whiteboard, diagram, textbook page, student work, etc.). Extract key concepts, suggest lesson content, and provide relevant educational tags."
            onResult={(res) => {
              setFormDescription(res.analysis);
              if (res.suggestedTags?.length) setFormNotes(prev => prev ? `${prev}\nVision tags: ${res.suggestedTags!.join(', ')}` : `Vision tags: ${res.suggestedTags!.join(', ')}`);
            }}
          />
          <button onClick={() => setShowStudyPanel(p => !p)}
            className={cn(ds.btnSecondary, showStudyPanel && 'bg-amber-500/20 border-amber-500/40 text-amber-400')}>
            <Timer className="w-4 h-4" /> Study Mode
          </button>
          <button onClick={openNewEditor} className={ds.btnPrimary}>
            <Plus className="w-4 h-4" /> New Record
          </button>
        </div>
      </header>

      {/* Education Wire — Department of Education + NCES live feed */}
      <LiveFeed
        articles={(realtimeData as { articles?: Array<Record<string, unknown>> } | null)?.articles as React.ComponentProps<typeof LiveFeed>['articles']}
        domain="education"
        isLive={isLive}
        lastUpdated={lastUpdated}
        limit={10}
      />

      <RealtimeDataPanel domain="education" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

      {/* Mode Tabs */}
      <nav className="flex items-center gap-1 border-b border-amber-800/20 pb-3 flex-wrap">
        {MODE_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setFilterStatus('all'); setShowGradeBook(false); setShowAttendance(false); setShowCurriculum(false); setShowAssignmentBuilder(false); }}
            className={cn(ds.btnGhost, 'whitespace-nowrap rounded-lg', activeTab === tab.id && 'bg-amber-500/15 text-amber-400 border-amber-400/20')}
          >
            <tab.icon className="w-4 h-4" />
            {tab.id}
          </button>
        ))}
      </nav>

      {/* Enhanced Dashboard */}
      <div className={ds.grid4}>
        <div className="bg-gradient-to-br from-amber-500/10 to-orange-600/5 rounded-xl border border-amber-400/15 p-4">
          <Users className="w-5 h-5 text-amber-400 mb-2" />
          <p className="text-2xl font-bold text-white">{stats.students}</p>
          <p className="text-sm text-amber-300/50">Students</p>
        </div>
        <div className="bg-gradient-to-br from-orange-500/10 to-amber-600/5 rounded-xl border border-amber-400/15 p-4">
          <BookOpen className="w-5 h-5 text-orange-400 mb-2" />
          <p className="text-2xl font-bold text-white">{stats.activeCourses}</p>
          <p className="text-sm text-amber-300/50">Active Courses</p>
        </div>
        <div className="bg-gradient-to-br from-yellow-500/10 to-amber-600/5 rounded-xl border border-amber-400/15 p-4">
          <ClipboardList className="w-5 h-5 text-yellow-400 mb-2" />
          <p className="text-2xl font-bold text-white">{stats.pendingAssignments}</p>
          <p className="text-sm text-amber-300/50">Pending Assignments</p>
        </div>
        <div className="bg-gradient-to-br from-amber-500/10 to-yellow-600/5 rounded-xl border border-amber-400/15 p-4">
          <TrendingUp className="w-5 h-5 text-amber-300 mb-2" />
          <p className="text-2xl font-bold text-white">{stats.avgScore > 0 ? `${stats.avgScore}%` : '--'}</p>
          <p className="text-sm text-amber-300/50">Avg Score</p>
        </div>
      </div>

      {/* ========== Study Panel ========== */}
      <AnimatePresence>
        {showStudyPanel && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              {/* Streak */}
              <div className="panel p-4 space-y-3">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <Flame className="w-4 h-4 text-amber-400" /> Learning Streak
                </h3>
                <LearningStreak streak={5} best={21} />
                <div className="space-y-2">
                  <CourseProgressBar label="Mathematics" pct={72} color="neon-cyan" />
                  <CourseProgressBar label="Literature" pct={55} color="amber-400" />
                  <CourseProgressBar label="Science" pct={88} color="neon-green" />
                </div>
              </div>
              {/* Mastery Levels */}
              <div className="panel p-4 space-y-3">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <Zap className="w-4 h-4 text-neon-cyan" /> Mastery Levels
                </h3>
                <div className="space-y-3">
                  {[
                    { subject: 'Mathematics', score: 78 },
                    { subject: 'Literature',  score: 55 },
                    { subject: 'Science',     score: 91 },
                    { subject: 'History',     score: 63 },
                  ].map(item => (
                    <div key={item.subject} className="flex items-center justify-between">
                      <span className="text-sm text-gray-300">{item.subject}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">{item.score}%</span>
                        <MasteryBadge score={item.score} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Study Timer */}
              <StudySessionTimer />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dashboard Insights Row */}
      <div className={ds.grid3}>
        {/* At-Risk Students */}
        <div className="bg-gradient-to-br from-red-500/5 to-orange-600/5 rounded-xl border border-red-500/15 p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <h3 className="text-sm font-semibold text-red-300">At-Risk Students</h3>
          </div>
          {stats.atRiskStudents.length === 0 ? (
            <p className={cn(ds.textMuted, 'text-xs')}>No at-risk students detected</p>
          ) : (
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {stats.atRiskStudents.slice(0, 5).map(s => (
                <div key={s.id} className="flex items-center justify-between text-xs">
                  <span className="text-white truncate">{s.title}</span>
                  <span className={ds.badge('red-400')}>{(s.data as unknown as EducationArtifact).status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming Due Dates */}
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="w-4 h-4 text-amber-400" />
            <h3 className={cn(ds.heading3, 'text-sm')}>Upcoming Due Dates</h3>
          </div>
          {stats.upcomingAssignments.length === 0 ? (
            <p className={cn(ds.textMuted, 'text-xs')}>No upcoming assignments</p>
          ) : (
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {stats.upcomingAssignments.map(a => {
                const ad = a.data as unknown as EducationArtifact;
                return (
                  <div key={a.id} className="flex items-center justify-between text-xs">
                    <span className="text-white truncate flex-1 mr-2">{a.title}</span>
                    <span className="text-amber-400 whitespace-nowrap">{ad.dueDate}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Expiring Certifications */}
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-3">
            <Award className="w-4 h-4 text-neon-cyan" />
            <h3 className={cn(ds.heading3, 'text-sm')}>Cert Expirations</h3>
          </div>
          {stats.expiringCerts.length === 0 ? (
            <p className={cn(ds.textMuted, 'text-xs')}>No upcoming expirations</p>
          ) : (
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {stats.expiringCerts.map(c => {
                const cd = c.data as unknown as EducationArtifact;
                return (
                  <div key={c.id} className="flex items-center justify-between text-xs">
                    <span className="text-white truncate">{c.title}</span>
                    <span className="text-red-400">{cd.expirationDate}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Domain Actions */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-3 text-sm')}>Domain Actions</h3>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => handleAction('gradeCalculation')} className={cn(ds.btnSecondary, ds.btnSmall)}>
            <Calculator className="w-3.5 h-3.5" /> Calculate Grades
          </button>
          <button onClick={() => handleAction('generateReportCard')} className={cn(ds.btnSecondary, ds.btnSmall)}>
            <Printer className="w-3.5 h-3.5" /> Generate Report Card
          </button>
          <button onClick={() => handleAction('attendanceReport')} className={cn(ds.btnSecondary, ds.btnSmall)}>
            <CalendarCheck className="w-3.5 h-3.5" /> Attendance Report
          </button>
          <button onClick={() => handleAction('scheduleConflict')} className={cn(ds.btnSecondary, ds.btnSmall)}>
            <Shuffle className="w-3.5 h-3.5" /> Schedule Conflict Check
          </button>
          {runAction.isPending && <span className="text-xs text-neon-blue animate-pulse self-center">Running...</span>}
        </div>
      </div>

      {/* Action Result */}
      {actionResult && (
        <div className={ds.panel}>
          <div className="flex items-center justify-between mb-2">
            <h3 className={ds.heading3}>Action Result</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleDownloadResult(
                  typeof actionResult === 'object' ? JSON.stringify(actionResult, null, 2) : String(actionResult),
                  'education-result.txt'
                )}
                className={cn(ds.btnGhost, 'text-xs')}
              >
                <Activity className="w-3.5 h-3.5 mr-1" /> Download
              </button>
              <button onClick={() => setActionResult(null)} className={ds.btnGhost} aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
          </div>
          {typeof actionResult === 'object' && 'content' in actionResult && actionResult.content ? (
            <div className="prose prose-invert prose-sm max-w-none">
              {actionResult.title ? <h4 className="text-sm font-semibold text-neon-cyan mb-2">{String(actionResult.title)}</h4> : null}
              <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{String(actionResult.content)}</div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* gradeCalculation */}
              {typeof actionResult === 'object' && 'studentsGraded' in actionResult && actionResult.studentsGraded !== undefined && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String(actionResult.studentsGraded)}</p>
                    <p className="text-[10px] text-gray-400">Students Graded</p>
                  </div>
                  {typeof actionResult.classStats === 'object' && actionResult.classStats !== null && (
                    <>
                      <div className="p-2 bg-lattice-surface rounded text-center">
                        <p className="text-sm font-bold text-neon-cyan">{String((actionResult.classStats as {average:number}).average)}%</p>
                        <p className="text-[10px] text-gray-400">Class Average</p>
                      </div>
                      <div className="p-2 bg-lattice-surface rounded text-center">
                        <p className="text-sm font-bold text-green-400">{String((actionResult.classStats as {high:number}).high)}%</p>
                        <p className="text-[10px] text-gray-400">Highest</p>
                      </div>
                      <div className="p-2 bg-lattice-surface rounded text-center">
                        <p className="text-sm font-bold text-amber-400">{String((actionResult.classStats as {low:number}).low)}%</p>
                        <p className="text-[10px] text-gray-400">Lowest</p>
                      </div>
                    </>
                  )}
                </div>
              )}
              {/* attendanceReport */}
              {typeof actionResult === 'object' && 'overallAttendanceRate' in actionResult && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String(actionResult.overallAttendanceRate)}%</p>
                    <p className="text-[10px] text-gray-400">Attendance Rate</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String(actionResult.totalStudents)}</p>
                    <p className="text-[10px] text-gray-400">Total Students</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className={`text-sm font-bold ${Number(actionResult.atRiskCount) > 0 ? 'text-red-400' : 'text-green-400'}`}>{String(actionResult.atRiskCount)}</p>
                    <p className="text-[10px] text-gray-400">At Risk</p>
                  </div>
                </div>
              )}
              {/* progressTrack */}
              {typeof actionResult === 'object' && 'overallCompletionPct' in actionResult && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">Overall Progress</span>
                    <span className="text-sm font-bold text-neon-cyan">{String(actionResult.overallCompletionPct)}%</span>
                  </div>
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-neon-cyan rounded-full" style={{ width: `${Math.min(100, Number(actionResult.overallCompletionPct))}%` }} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 bg-lattice-surface rounded text-center">
                      <p className="text-sm font-bold text-green-400">{String(actionResult.completedRequirements)}</p>
                      <p className="text-[10px] text-gray-400">Completed</p>
                    </div>
                    <div className="p-2 bg-lattice-surface rounded text-center">
                      <p className="text-sm font-bold text-amber-400">{String(actionResult.remainingRequirements)}</p>
                      <p className="text-[10px] text-gray-400">Remaining</p>
                    </div>
                  </div>
                </div>
              )}
              {/* scheduleConflict */}
              {typeof actionResult === 'object' && 'conflictsFound' in actionResult && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className={`text-sm font-bold ${Number(actionResult.conflictsFound) > 0 ? 'text-red-400' : 'text-green-400'}`}>{String(actionResult.conflictsFound)}</p>
                    <p className="text-[10px] text-gray-400">Conflicts</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{String(actionResult.totalEntries)}</p>
                    <p className="text-[10px] text-gray-400">Total Entries</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className={`text-sm font-bold ${actionResult.conflictFree ? 'text-green-400' : 'text-red-400'}`}>{actionResult.conflictFree ? 'Clear' : 'Conflicts'}</p>
                    <p className="text-[10px] text-gray-400">Status</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/*  Concord Educational Engine — constraint-navigation surface  */}
      {/* ============================================================ */}
      <AnimatePresence mode="wait">
        {activeTab === 'Genome' && (
          <motion.div key="genome" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <GenomePanel />
          </motion.div>
        )}
        {activeTab === 'Path' && (
          <motion.div key="path" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <LearningPathPanel />
          </motion.div>
        )}
        {activeTab === 'Proof' && (
          <motion.div key="proof" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <ProofByCitationPanel />
          </motion.div>
        )}
        {activeTab === 'Tutor' && (
          <motion.div key="tutor" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <TutorPanel />
          </motion.div>
        )}
        {activeTab === 'Cohort' && (
          <motion.div key="cohort" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <CohortPanel />
          </motion.div>
        )}
        {activeTab === 'Assessment' && (
          <motion.div key="assessment" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <AssessmentPanel />
          </motion.div>
        )}
        {activeTab === 'Credentials' && (
          <motion.div key="credentials" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <CredentialsPanel />
          </motion.div>
        )}
        {activeTab === 'Earnings' && (
          <motion.div key="earnings" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <EarningsPanel />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============================================================ */}
      {/*  TAB: Students + Attendance Tracker                           */}
      {/* ============================================================ */}
      {activeTab === 'Students' && (
        <section className={ds.panel}>
          <div className={cn(ds.sectionHeader, 'mb-4')}>
            <div className="flex items-center gap-3">
              <h2 className={ds.heading2}>Students</h2>
              <button
                onClick={() => setShowAttendance(!showAttendance)}
                className={cn(ds.btnGhost, ds.btnSmall, showAttendance && 'bg-neon-cyan/20 text-neon-cyan')}
              >
                <CalendarCheck className="w-3.5 h-3.5" /> Attendance
              </button>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input ref={searchInputRef}
              type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search students..." className={cn(ds.input, 'pl-9 w-56')} />
              </div>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as Status | 'all')} className={cn(ds.select, 'w-40')}>
                <option value="all">All statuses</option>
                {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Attendance Tracker Panel */}
          {showAttendance && (
            <div className={cn(ds.panel, 'mb-4 border-neon-cyan/20')}>
              <div className={cn(ds.sectionHeader, 'mb-3')}>
                <h3 className={ds.heading3}>Daily Attendance</h3>
                <input
                  type="date"
                  value={attendanceDate}
                  onChange={e => setAttendanceDate(e.target.value)}
                  className={cn(ds.input, 'w-44')}
                />
              </div>

              {/* Attendance Summary */}
              <div className={cn(ds.grid4, 'mb-4')}>
                {(['present', 'absent', 'tardy', 'excused'] as AttendanceStatus[]).map(status => {
                  const count = attendanceRecords.filter(r => r.date === attendanceDate && r.status === status).length;
                  const Icon = ATTENDANCE_ICONS[status];
                  return (
                    <div key={status} className="flex items-center gap-2 p-2 rounded-lg bg-lattice-elevated">
                      <Icon className={cn('w-4 h-4', ATTENDANCE_COLORS[status])} />
                      <span className="text-sm text-white capitalize">{status}</span>
                      <span className={cn('ml-auto text-lg font-bold', ATTENDANCE_COLORS[status])}>{count}</span>
                    </div>
                  );
                })}
              </div>

              {/* Mark Attendance per Student */}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {students.map(s => {
                  const record = attendanceRecords.find(r => r.studentId === s.id && r.date === attendanceDate);
                  const currentStatus = record?.status;
                  const summary = attendanceSummary[s.id];
                  const attendanceRate = summary ? Math.round(((summary.present + summary.tardy) / summary.total) * 100) : null;

                  return (
                    <div key={s.id} className="flex items-center gap-3 py-2 border-b border-lattice-border last:border-0">
                      <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <span className="text-sm text-white flex-1 truncate">{s.title}</span>
                      {attendanceRate !== null && (
                        <span className={cn('text-xs', attendanceRate >= 90 ? 'text-green-400' : attendanceRate >= 80 ? 'text-amber-400' : 'text-red-400')}>
                          {attendanceRate}%
                        </span>
                      )}
                      <div className="flex items-center gap-1">
                        {(['present', 'absent', 'tardy', 'excused'] as AttendanceStatus[]).map(status => {
                          const Icon = ATTENDANCE_ICONS[status];
                          return (
                            <button
                              key={status}
                              onClick={() => markAttendance(s.id, s.title, status)}
                              className={cn(
                                'p-1.5 rounded transition-colors',
                                currentStatus === status ? `${ATTENDANCE_COLORS[status]} bg-white/10` : 'text-gray-600 hover:text-gray-400'
                              )}
                              title={status}
                            >
                              <Icon className="w-4 h-4" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {students.length === 0 && (
                  <p className={cn(ds.textMuted, 'text-center py-4')}>Add students to track attendance</p>
                )}
              </div>
            </div>
          )}

          {/* Student Cards */}
          {isLoading ? (
            <p className={cn(ds.textMuted, 'text-center py-12')}>Loading records...</p>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className={ds.textMuted}>No students found. Create one to get started.</p>
            </div>
          ) : (
            <div className={ds.grid3}>
              {filtered.map(item => {
                const d = item.data as unknown as EducationArtifact;
                const summary = attendanceSummary[item.id];
                const attendanceRate = summary ? Math.round(((summary.present + summary.tardy) / summary.total) * 100) : null;
                return (
                  <div key={item.id} className={ds.panelHover} onClick={() => setSelectedStudent(item)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                    <div className="flex items-start justify-between mb-2">
                      <h3 className={cn(ds.heading3, 'text-base truncate flex-1')}>{item.title}</h3>
                      <span className={ds.badge(STATUS_COLORS[d.status])}>{d.status}</span>
                    </div>
                    <p className={cn(ds.textMuted, 'line-clamp-2 mb-3')}>{d.description}</p>
                    <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                      {d.email && <span className="flex items-center gap-1"><User className="w-3 h-3" /> {d.email}</span>}
                      {d.subject && <span className="flex items-center gap-1"><Layers className="w-3 h-3" /> {d.subject}</span>}
                      {d.gpa != null && <span className="flex items-center gap-1"><Star className="w-3 h-3" /> GPA: {d.gpa}</span>}
                      {d.credits != null && <span className="flex items-center gap-1"><Target className="w-3 h-3" /> {d.credits} cr</span>}
                      {attendanceRate !== null && (
                        <span className={cn('flex items-center gap-1', attendanceRate >= 90 ? 'text-green-400' : attendanceRate >= 80 ? 'text-amber-400' : 'text-red-400')}>
                          <Activity className="w-3 h-3" /> {attendanceRate}% att.
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-3">
                      <button onClick={(e) => { e.stopPropagation(); setSelectedStudent(item); }} className={cn(ds.btnGhost, 'text-xs px-2 py-1')}>
                        <Eye className="w-3 h-3" /> Progress
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); openEditEditor(item); }} className={cn(ds.btnGhost, 'text-xs px-2 py-1')}>
                        <Edit3 className="w-3 h-3" /> Edit
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ============================================================ */}
      {/*  TAB: Courses                                                 */}
      {/* ============================================================ */}
      {activeTab === 'Courses' && (
        <section className={ds.panel}>
          <div className={cn(ds.sectionHeader, 'mb-4')}>
            <h2 className={ds.heading2}>Courses</h2>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search courses..." className={cn(ds.input, 'pl-9 w-56')} />
              </div>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as Status | 'all')} className={cn(ds.select, 'w-40')}>
                <option value="all">All statuses</option>
                {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {isLoading ? (
            <p className={cn(ds.textMuted, 'text-center py-12')}>Loading records...</p>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <BookOpen className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className={ds.textMuted}>No courses found. Create one to get started.</p>
            </div>
          ) : (
            <div className={ds.grid3}>
              {filtered.map(item => {
                const d = item.data as unknown as EducationArtifact;
                return (
                  <div key={item.id} className={ds.panelHover} onClick={() => setSelectedCourse(item)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                    <div className="flex items-start justify-between mb-2">
                      <h3 className={cn(ds.heading3, 'text-base truncate flex-1')}>{item.title}</h3>
                      <span className={ds.badge(STATUS_COLORS[d.status])}>{d.status}</span>
                    </div>
                    <p className={cn(ds.textMuted, 'line-clamp-2 mb-3')}>{d.description}</p>
                    <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                      {d.instructor && <span className="flex items-center gap-1"><User className="w-3 h-3" /> {d.instructor}</span>}
                      {d.subject && <span className="flex items-center gap-1"><Layers className="w-3 h-3" /> {d.subject}</span>}
                      {d.semester && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {d.semester}</span>}
                      {d.credits != null && <span className="flex items-center gap-1"><Target className="w-3 h-3" /> {d.credits} cr</span>}
                    </div>
                    <div className="flex items-center gap-1 mt-3">
                      <button onClick={(e) => { e.stopPropagation(); setSelectedCourse(item); }} className={cn(ds.btnGhost, 'text-xs px-2 py-1')}>
                        <Eye className="w-3 h-3" /> Details
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); openEditEditor(item); }} className={cn(ds.btnGhost, 'text-xs px-2 py-1')}>
                        <Edit3 className="w-3 h-3" /> Edit
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ============================================================ */}
      {/*  TAB: Assignments + Assignment Builder                        */}
      {/* ============================================================ */}
      {activeTab === 'Assignments' && (
        <section className={ds.panel}>
          <div className={cn(ds.sectionHeader, 'mb-4')}>
            <div className="flex items-center gap-3">
              <h2 className={ds.heading2}>Assignments</h2>
              <button
                onClick={() => setShowAssignmentBuilder(!showAssignmentBuilder)}
                className={cn(ds.btnGhost, ds.btnSmall, showAssignmentBuilder && 'bg-neon-green/20 text-neon-green')}
              >
                <ListChecks className="w-3.5 h-3.5" /> Builder
              </button>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search assignments..." className={cn(ds.input, 'pl-9 w-56')} />
              </div>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as Status | 'all')} className={cn(ds.select, 'w-40')}>
                <option value="all">All statuses</option>
                {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Assignment Builder Panel */}
          {showAssignmentBuilder && (
            <div className={cn(ds.panel, 'mb-4 border-neon-green/20')}>
              <h3 className={cn(ds.heading3, 'mb-4')}>Assignment Builder</h3>

              {/* Rubric Builder */}
              <div className="mb-4">
                <div className={cn(ds.sectionHeader, 'mb-2')}>
                  <label className={cn(ds.label, 'mb-0')}>Rubric Criteria</label>
                  <button onClick={addRubricCriterion} className={cn(ds.btnGhost, ds.btnSmall)}>
                    <PlusCircle className="w-3.5 h-3.5" /> Add Criterion
                  </button>
                </div>
                {rubricCriteria.length === 0 ? (
                  <p className={cn(ds.textMuted, 'text-xs py-2')}>No rubric criteria defined. Add criteria to build a rubric.</p>
                ) : (
                  <div className="space-y-2">
                    {rubricCriteria.map((criterion, idx) => (
                      <div key={idx} className="flex items-start gap-2 p-3 bg-lattice-elevated rounded-lg">
                        <div className="flex-1 space-y-2">
                          <input
                            value={criterion.name}
                            onChange={e => updateRubricCriterion(idx, 'name', e.target.value)}
                            placeholder="Criterion name"
                            className={cn(ds.input, 'text-sm')}
                          />
                          <input
                            value={criterion.description}
                            onChange={e => updateRubricCriterion(idx, 'description', e.target.value)}
                            placeholder="Description"
                            className={cn(ds.input, 'text-sm')}
                          />
                        </div>
                        <div className="w-24">
                          <input
                            type="number"
                            value={criterion.maxPoints}
                            onChange={e => updateRubricCriterion(idx, 'maxPoints', parseInt(e.target.value) || 0)}
                            className={cn(ds.input, 'text-sm text-center')}
                            placeholder="Points"
                          />
                          <p className={cn(ds.textMuted, 'text-center text-xs mt-1')}>points</p>
                        </div>
                        <button onClick={() => removeRubricCriterion(idx)} className={cn(ds.btnGhost, 'text-red-400 p-1')} aria-label="Minus circle">
                          <MinusCircle className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    <div className="text-right">
                      <span className={cn(ds.textMuted, 'text-xs')}>
                        Total: {rubricCriteria.reduce((sum, c) => sum + c.maxPoints, 0)} points
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Late Policy */}
              <div className={cn(ds.grid2, 'mb-4')}>
                <div>
                  <label className={ds.label}>Late Policy</label>
                  <select value={latePolicy} onChange={e => setLatePolicy(e.target.value)} className={ds.select}>
                    <option value="10% per day">10% deduction per day</option>
                    <option value="5% per day">5% deduction per day</option>
                    <option value="50% max">50% maximum after deadline</option>
                    <option value="no late">No late submissions</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                <div>
                  <label className={ds.label}>Penalty % per day</label>
                  <input
                    type="number"
                    value={latePenalty}
                    onChange={e => setLatePenalty(parseInt(e.target.value) || 0)}
                    className={ds.input}
                    min={0}
                    max={100}
                  />
                </div>
              </div>

              {/* Submission Tracking & Options */}
              <div className={cn(ds.grid2, 'mb-4')}>
                <div className="space-y-3">
                  <label className={ds.label}>Submission Tracking</label>
                  <div className="flex flex-wrap gap-2">
                    {(['submitted', 'late', 'missing', 'graded'] as SubmissionStatus[]).map(status => (
                      <span key={status} className={cn(
                        ds.badge(status === 'submitted' ? 'neon-green' : status === 'late' ? 'amber-400' : status === 'missing' ? 'red-400' : 'neon-cyan'),
                        'capitalize'
                      )}>
                        {status}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <label className={ds.label}>Options</label>
                  <div className="space-y-2">
                    <button
                      onClick={() => setPeerReview(!peerReview)}
                      className={cn('flex items-center gap-2 text-sm', peerReview ? 'text-neon-green' : 'text-gray-400')}
                    >
                      {peerReview ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                      Peer Review
                    </button>
                    <button
                      onClick={() => setPlagiarismCheck(!plagiarismCheck)}
                      className={cn('flex items-center gap-2 text-sm', plagiarismCheck ? 'text-neon-green' : 'text-gray-400')}
                    >
                      {plagiarismCheck ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                      Plagiarism Check
                    </button>
                  </div>
                </div>
              </div>

              {plagiarismCheck && (
                <div className={cn(ds.panel, 'bg-lattice-elevated border-amber-400/20 mb-4')}>
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-amber-400" />
                    <span className="text-sm text-amber-400">Plagiarism detection will be run on all submissions</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Assignment Cards */}
          {isLoading ? (
            <p className={cn(ds.textMuted, 'text-center py-12')}>Loading records...</p>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <ClipboardList className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className={ds.textMuted}>No assignments found. Create one to get started.</p>
            </div>
          ) : (
            <div className={ds.grid3}>
              {filtered.map(item => {
                const d = item.data as unknown as EducationArtifact;
                return (
                  <div key={item.id} className={ds.panelHover} onClick={() => openEditEditor(item)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                    <div className="flex items-start justify-between mb-2">
                      <h3 className={cn(ds.heading3, 'text-base truncate flex-1')}>{item.title}</h3>
                      <span className={ds.badge(STATUS_COLORS[d.status])}>{d.status}</span>
                    </div>
                    <p className={cn(ds.textMuted, 'line-clamp-2 mb-3')}>{d.description}</p>
                    <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                      {d.subject && <span className="flex items-center gap-1"><Layers className="w-3 h-3" /> {d.subject}</span>}
                      {d.dueDate && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {d.dueDate}</span>}
                      {d.maxScore != null && <span className="flex items-center gap-1"><Hash className="w-3 h-3" /> {d.maxScore} pts</span>}
                      {d.peerReview && <span className="flex items-center gap-1 text-neon-cyan"><Users className="w-3 h-3" /> Peer Review</span>}
                      {d.plagiarismCheck && <span className="flex items-center gap-1 text-amber-400"><Shield className="w-3 h-3" /> Plagiarism</span>}
                    </div>
                    {d.submissionStatus && (
                      <div className="mt-2">
                        <span className={cn(
                          ds.badge(d.submissionStatus === 'submitted' ? 'neon-green' : d.submissionStatus === 'late' ? 'amber-400' : d.submissionStatus === 'missing' ? 'red-400' : 'neon-cyan'),
                          'capitalize'
                        )}>
                          {d.submissionStatus}
                        </span>
                      </div>
                    )}
                    {d.rubric && d.rubric.length > 0 && (
                      <div className="mt-2 text-xs text-gray-400">
                        <FileCheck className="w-3 h-3 inline mr-1" /> {d.rubric.length} rubric criteria
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ============================================================ */}
      {/*  TAB: Grades + Grade Book View                                */}
      {/* ============================================================ */}
      {activeTab === 'Grades' && (
        <section className={ds.panel}>
          <div className={cn(ds.sectionHeader, 'mb-4')}>
            <div className="flex items-center gap-3">
              <h2 className={ds.heading2}>Grades</h2>
              <button
                onClick={() => setShowGradeBook(!showGradeBook)}
                className={cn(ds.btnGhost, ds.btnSmall, showGradeBook && 'bg-neon-blue/20 text-neon-blue')}
              >
                <BarChart3 className="w-3.5 h-3.5" /> Grade Book
              </button>
            </div>
            <div className="flex items-center gap-2">
              {!showGradeBook && (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search grades..." className={cn(ds.input, 'pl-9 w-56')} />
                  </div>
                  <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as Status | 'all')} className={cn(ds.select, 'w-40')}>
                    <option value="all">All statuses</option>
                    {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </>
              )}
            </div>
          </div>

          {/* Grade Book Spreadsheet View */}
          {showGradeBook && (
            <div className="mb-4 space-y-4">
              {/* Category Weights Configuration */}
              <div className={cn(ds.panel, 'border-neon-blue/20')}>
                <div className={cn(ds.sectionHeader, 'mb-3')}>
                  <h3 className={cn(ds.heading3, 'text-sm')}>Category Weights</h3>
                  <button
                    onClick={() => setDropLowest(!dropLowest)}
                    className={cn('flex items-center gap-2 text-sm', dropLowest ? 'text-neon-green' : 'text-gray-400')}
                  >
                    {dropLowest ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                    Drop Lowest
                  </button>
                </div>
                <div className={ds.grid4}>
                  {(['homework', 'exams', 'projects', 'participation'] as GradeCategory[]).map(cat => (
                    <div key={cat}>
                      <label className={cn(ds.label, 'capitalize')}>{cat}</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={categoryWeights[cat]}
                          onChange={e => setCategoryWeights(prev => ({ ...prev, [cat]: parseInt(e.target.value) || 0 }))}
                          className={cn(ds.input, 'text-center')}
                          min={0}
                          max={100}
                        />
                        <span className="text-sm text-gray-400">%</span>
                      </div>
                    </div>
                  ))}
                </div>
                <p className={cn(ds.textMuted, 'text-xs mt-2')}>
                  Total: {Object.values(categoryWeights).reduce((a, b) => a + b, 0)}%
                  {Object.values(categoryWeights).reduce((a, b) => a + b, 0) !== 100 && (
                    <span className="text-amber-400 ml-2">(Should equal 100%)</span>
                  )}
                </p>
              </div>

              {/* Add Student / Assignment Controls */}
              <div className="flex items-center gap-2">
                <button onClick={addGradeBookStudent} className={cn(ds.btnSecondary, ds.btnSmall)}>
                  <PlusCircle className="w-3.5 h-3.5" /> Add Student Row
                </button>
                <button
                  onClick={() => {
                    const name = `Assignment ${gradeBookAssignments.length + 1}`;
                    addGradeBookAssignment(name, 'homework', 100);
                  }}
                  className={cn(ds.btnSecondary, ds.btnSmall)}
                >
                  <PlusCircle className="w-3.5 h-3.5" /> Add Assignment Column
                </button>
              </div>

              {/* Spreadsheet Grid */}
              {gradeBookStudents.length > 0 && gradeBookAssignments.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-lattice-border">
                        <th className="text-left py-2 px-3 text-gray-400 font-medium sticky left-0 bg-lattice-surface z-10 min-w-[150px]">Student</th>
                        {gradeBookAssignments.map(a => (
                          <th key={a.id} className="text-center py-2 px-3 text-gray-400 font-medium min-w-[100px]">
                            <div className="truncate">{a.name}</div>
                            <span className={cn('text-xs capitalize', a.category === 'exams' ? 'text-red-400' : a.category === 'projects' ? 'text-neon-cyan' : a.category === 'participation' ? 'text-amber-400' : 'text-neon-blue')}>
                              {a.category}
                            </span>
                          </th>
                        ))}
                        <th className="text-center py-2 px-3 text-gray-400 font-medium min-w-[90px]">Average</th>
                        <th className="text-center py-2 px-3 text-gray-400 font-medium min-w-[70px]">Grade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gradeBookStudents.map(student => {
                        const studentEntries = gradeBookData.filter(e => e.studentId === student.id);
                        const avg = calculateWeightedAverage(studentEntries, categoryWeights, dropLowest);
                        const letter = scoreToLetter(avg);
                        const gradeKey = getGradeColorKey(avg);

                        return (
                          <tr key={student.id} className="border-b border-lattice-border hover:bg-lattice-elevated/50">
                            <td className="py-2 px-3 text-white font-medium sticky left-0 bg-lattice-surface z-10">{student.name}</td>
                            {gradeBookAssignments.map(assignment => {
                              const entry = studentEntries.find(e => e.assignmentId === assignment.id);
                              const score = entry?.score;
                              const maxScore = entry?.maxScore ?? 100;
                              const isEditing = editingCell?.studentId === student.id && editingCell?.assignmentId === assignment.id;
                              const pct = score !== null && score !== undefined ? (score / maxScore) * 100 : null;
                              const colorKey = pct !== null ? getGradeColorKey(pct) : '';

                              return (
                                <td key={assignment.id} className="py-2 px-3 text-center">
                                  {isEditing ? (
                                    <input
                                      type="number"
                                      value={cellValue}
                                      onChange={e => setCellValue(e.target.value)}
                                      onBlur={() => handleCellEdit(student.id, assignment.id, cellValue)}
                                      onKeyDown={e => { if (e.key === 'Enter') handleCellEdit(student.id, assignment.id, cellValue); if (e.key === 'Escape') setEditingCell(null); }}
                                      className={cn(ds.input, 'w-20 text-center text-sm py-1')}
                                      autoFocus
                                      min={0}
                                      max={maxScore}
                                    />
                                  ) : (
                                    <button
                                      onClick={() => { setEditingCell({ studentId: student.id, assignmentId: assignment.id }); setCellValue(score != null ? String(score) : ''); }}
                                      className={cn(
                                        'w-full py-1 px-2 rounded text-sm transition-colors hover:bg-white/5',
                                        pct !== null ? GRADE_COLORS[colorKey] : 'text-gray-600'
                                      )}
                                    >
                                      {score !== null && score !== undefined ? `${score}/${maxScore}` : '--'}
                                    </button>
                                  )}
                                </td>
                              );
                            })}
                            <td className={cn('py-2 px-3 text-center font-bold', GRADE_COLORS[gradeKey])}>
                              {avg > 0 ? `${Math.round(avg)}%` : '--'}
                            </td>
                            <td className={cn('py-2 px-3 text-center font-bold', GRADE_COLORS[gradeKey])}>
                              {avg > 0 ? letter : '--'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 bg-lattice-elevated rounded-lg">
                  <BarChart2 className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                  <p className={ds.textMuted}>Add students and assignments to populate the grade book</p>
                  <p className={cn(ds.textMuted, 'text-xs mt-1')}>Use the buttons above, or add student/assignment records first</p>
                </div>
              )}
            </div>
          )}

          {/* Standard Grade Cards (when gradebook is hidden) */}
          {!showGradeBook && (
            <>
              {isLoading ? (
                <p className={cn(ds.textMuted, 'text-center py-12')}>Loading records...</p>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12">
                  <BarChart2 className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                  <p className={ds.textMuted}>No grades found. Create one to get started.</p>
                </div>
              ) : (
                <div className={ds.grid3}>
                  {filtered.map(item => {
                    const d = item.data as unknown as EducationArtifact;
                    const gradeKey = d.score != null ? getGradeColorKey(d.score) : '';
                    return (
                      <div key={item.id} className={ds.panelHover} onClick={() => openEditEditor(item)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                        <div className="flex items-start justify-between mb-2">
                          <h3 className={cn(ds.heading3, 'text-base truncate flex-1')}>{item.title}</h3>
                          <span className={ds.badge(STATUS_COLORS[d.status])}>{d.status}</span>
                        </div>
                        <p className={cn(ds.textMuted, 'line-clamp-2 mb-3')}>{d.description}</p>
                        <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                          {d.instructor && <span className="flex items-center gap-1"><User className="w-3 h-3" /> {d.instructor}</span>}
                          {d.subject && <span className="flex items-center gap-1"><Layers className="w-3 h-3" /> {d.subject}</span>}
                          {d.grade && (
                            <span className={cn('flex items-center gap-1 font-bold', GRADE_COLORS[d.grade.charAt(0)] || '')}>
                              <Star className="w-3 h-3" /> {d.grade}
                            </span>
                          )}
                          {d.score != null && (
                            <span className={cn('flex items-center gap-1 font-bold', GRADE_COLORS[gradeKey])}>
                              <Percent className="w-3 h-3" /> {d.score}%
                            </span>
                          )}
                          {d.credits != null && <span className="flex items-center gap-1"><Target className="w-3 h-3" /> {d.credits} cr</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ============================================================ */}
      {/*  TAB: Plans + Curriculum Planner                              */}
      {/* ============================================================ */}
      {activeTab === 'Plans' && (
        <section className={ds.panel}>
          <div className={cn(ds.sectionHeader, 'mb-4')}>
            <div className="flex items-center gap-3">
              <h2 className={ds.heading2}>Lesson Plans</h2>
              <button
                onClick={() => setShowCurriculum(!showCurriculum)}
                className={cn(ds.btnGhost, ds.btnSmall, showCurriculum && 'bg-amber-400/20 text-amber-400')}
              >
                <BookMarked className="w-3.5 h-3.5" /> Curriculum Planner
              </button>
            </div>
            <div className="flex items-center gap-2">
              {!showCurriculum && (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search plans..." className={cn(ds.input, 'pl-9 w-56')} />
                  </div>
                  <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as Status | 'all')} className={cn(ds.select, 'w-40')}>
                    <option value="all">All statuses</option>
                    {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </>
              )}
            </div>
          </div>

          {/* Curriculum Planner */}
          {showCurriculum && (
            <div className={cn(ds.panel, 'mb-4 border-amber-400/20')}>
              <div className={cn(ds.sectionHeader, 'mb-4')}>
                <h3 className={ds.heading3}>Week-by-Week Curriculum</h3>
                <button onClick={addCurriculumWeek} className={cn(ds.btnSecondary, ds.btnSmall)}>
                  <PlusCircle className="w-3.5 h-3.5" /> Add Week
                </button>
              </div>

              {curriculumWeeks.length === 0 ? (
                <div className="text-center py-8">
                  <BookMarked className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                  <p className={ds.textMuted}>No curriculum weeks defined yet. Add weeks to plan your curriculum.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {curriculumWeeks.map(week => {
                    const isExpanded = expandedWeek === week.weekNumber;
                    const isEditing = editingWeek?.weekNumber === week.weekNumber;

                    return (
                      <div key={week.weekNumber} className={cn('border border-lattice-border rounded-lg overflow-hidden', isExpanded && 'border-amber-400/30')}>
                        {/* Week Header */}
                        <button
                          onClick={() => setExpandedWeek(isExpanded ? null : week.weekNumber)}
                          className="w-full flex items-center gap-3 p-3 hover:bg-lattice-elevated transition-colors"
                        >
                          {isExpanded ? <ChevronDown className="w-4 h-4 text-amber-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                          <span className="text-sm font-semibold text-white">Week {week.weekNumber}</span>
                          <span className={cn(ds.textMuted, 'flex-1 text-left truncate')}>{week.topic || 'No topic set'}</span>
                          <span className="text-xs text-gray-400">{week.duration}</span>
                        </button>

                        {/* Week Details */}
                        {isExpanded && (
                          <div className="p-4 border-t border-lattice-border bg-lattice-elevated/30">
                            {isEditing ? (
                              <div className="space-y-3">
                                <div>
                                  <label className={ds.label}>Topic</label>
                                  <input
                                    value={editingWeek?.topic ?? ''}
                                    onChange={e => setEditingWeek(prev => prev ? { ...prev, topic: e.target.value } : null)}
                                    className={ds.input}
                                    placeholder="Week topic"
                                  />
                                </div>
                                <div className={ds.grid2}>
                                  <div>
                                    <label className={ds.label}>Duration</label>
                                    <input
                                      value={editingWeek?.duration ?? ''}
                                      onChange={e => setEditingWeek(prev => prev ? { ...prev, duration: e.target.value } : null)}
                                      className={ds.input}
                                      placeholder="e.g. 5 days"
                                    />
                                  </div>
                                  <div>
                                    <label className={ds.label}>Materials Needed</label>
                                    <input
                                      value={editingWeek?.materials ?? ''}
                                      onChange={e => setEditingWeek(prev => prev ? { ...prev, materials: e.target.value } : null)}
                                      className={ds.input}
                                      placeholder="Textbook, handouts, etc."
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className={ds.label}>Learning Objectives (one per line)</label>
                                  <textarea
                                    value={editingWeek?.objectives.join('\n') ?? ''}
                                    onChange={e => setEditingWeek(prev => prev ? { ...prev, objectives: e.target.value.split('\n').filter(Boolean) } : null)}
                                    className={ds.textarea}
                                    rows={3}
                                    placeholder="Students will be able to..."
                                  />
                                </div>
                                <div>
                                  <label className={ds.label}>Standards Alignment (one per line)</label>
                                  <textarea
                                    value={editingWeek?.standards.join('\n') ?? ''}
                                    onChange={e => setEditingWeek(prev => prev ? { ...prev, standards: e.target.value.split('\n').filter(Boolean) } : null)}
                                    className={ds.textarea}
                                    rows={2}
                                    placeholder="CCSS.MATH.CONTENT.3.OA.A.1"
                                  />
                                </div>
                                <div>
                                  <label className={ds.label}>Resource Links (one per line)</label>
                                  <textarea
                                    value={editingWeek?.resources.join('\n') ?? ''}
                                    onChange={e => setEditingWeek(prev => prev ? { ...prev, resources: e.target.value.split('\n').filter(Boolean) } : null)}
                                    className={ds.textarea}
                                    rows={2}
                                    placeholder="https://..."
                                  />
                                </div>
                                <div className="flex items-center justify-end gap-2">
                                  <button onClick={() => setEditingWeek(null)} className={cn(ds.btnSecondary, ds.btnSmall)}>Cancel</button>
                                  <button onClick={() => { if (editingWeek) saveCurriculumWeek(editingWeek); }} className={cn(ds.btnPrimary, ds.btnSmall)}>Save Week</button>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3 flex-wrap">
                                    {week.duration && (
                                      <span className={cn(ds.badge('amber-400'))}><Clock className="w-3 h-3 inline mr-1" />{week.duration}</span>
                                    )}
                                    {week.materials && (
                                      <span className={cn(ds.badge('neon-cyan'))}>{week.materials}</span>
                                    )}
                                  </div>
                                  <button onClick={() => setEditingWeek({ ...week })} className={cn(ds.btnGhost, ds.btnSmall)}>
                                    <Edit3 className="w-3.5 h-3.5" /> Edit
                                  </button>
                                </div>

                                {week.objectives.length > 0 && (
                                  <div>
                                    <p className={cn(ds.label, 'mb-1')}>Learning Objectives</p>
                                    <ul className="space-y-1">
                                      {week.objectives.map((obj, i) => (
                                        <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                                          <Target className="w-3 h-3 mt-1 flex-shrink-0 text-neon-green" />
                                          {obj}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}

                                {week.standards.length > 0 && (
                                  <div>
                                    <p className={cn(ds.label, 'mb-1')}>Standards</p>
                                    <div className="flex flex-wrap gap-1">
                                      {week.standards.map((std, i) => (
                                        <span key={i} className={ds.badge('neon-blue')}>{std}</span>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {week.resources.length > 0 && (
                                  <div>
                                    <p className={cn(ds.label, 'mb-1')}>Resources</p>
                                    <ul className="space-y-1">
                                      {week.resources.map((res, i) => (
                                        <li key={i} className="flex items-center gap-2 text-sm text-neon-cyan">
                                          <Link className="w-3 h-3 flex-shrink-0" />
                                          <span className="truncate">{res}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}

                                {week.objectives.length === 0 && week.standards.length === 0 && (
                                  <p className={cn(ds.textMuted, 'text-xs italic')}>Click Edit to add objectives, standards, and resources for this week.</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Standard Plan Cards (when curriculum planner is hidden) */}
          {!showCurriculum && (
            <>
              {isLoading ? (
                <p className={cn(ds.textMuted, 'text-center py-12')}>Loading records...</p>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                  <p className={ds.textMuted}>No lesson plans found. Create one to get started.</p>
                </div>
              ) : (
                <div className={ds.grid3}>
                  {filtered.map(item => {
                    const d = item.data as unknown as EducationArtifact;
                    return (
                      <div key={item.id} className={ds.panelHover} onClick={() => openEditEditor(item)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                        <div className="flex items-start justify-between mb-2">
                          <h3 className={cn(ds.heading3, 'text-base truncate flex-1')}>{item.title}</h3>
                          <span className={ds.badge(STATUS_COLORS[d.status])}>{d.status}</span>
                        </div>
                        <p className={cn(ds.textMuted, 'line-clamp-2 mb-3')}>{d.description}</p>
                        <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                          {d.instructor && <span className="flex items-center gap-1"><User className="w-3 h-3" /> {d.instructor}</span>}
                          {d.subject && <span className="flex items-center gap-1"><Layers className="w-3 h-3" /> {d.subject}</span>}
                          {d.dueDate && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {d.dueDate}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ============================================================ */}
      {/*  TAB: Certifications                                          */}
      {/* ============================================================ */}
      {activeTab === 'Certifications' && (
        <section className={ds.panel}>
          <div className={cn(ds.sectionHeader, 'mb-4')}>
            <h2 className={ds.heading2}>Certifications</h2>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search certifications..." className={cn(ds.input, 'pl-9 w-56')} />
              </div>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as Status | 'all')} className={cn(ds.select, 'w-40')}>
                <option value="all">All statuses</option>
                {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {isLoading ? (
            <p className={cn(ds.textMuted, 'text-center py-12')}>Loading records...</p>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <Award className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className={ds.textMuted}>No certifications found. Create one to get started.</p>
            </div>
          ) : (
            <div className={ds.grid3}>
              {filtered.map(item => {
                const d = item.data as unknown as EducationArtifact;
                const isExpiring = d.expirationDate && new Date(d.expirationDate) > new Date() &&
                  (new Date(d.expirationDate).getTime() - new Date().getTime()) < 30 * 24 * 60 * 60 * 1000;
                return (
                  <div key={item.id} className={cn(ds.panelHover, isExpiring && 'border-amber-400/30')} onClick={() => openEditEditor(item)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                    <div className="flex items-start justify-between mb-2">
                      <h3 className={cn(ds.heading3, 'text-base truncate flex-1')}>{item.title}</h3>
                      <span className={ds.badge(STATUS_COLORS[d.status])}>{d.status}</span>
                    </div>
                    <p className={cn(ds.textMuted, 'line-clamp-2 mb-3')}>{d.description}</p>
                    <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                      {d.issuedBy && <span className="flex items-center gap-1"><Award className="w-3 h-3" /> {d.issuedBy}</span>}
                      {d.subject && <span className="flex items-center gap-1"><Layers className="w-3 h-3" /> {d.subject}</span>}
                      {d.expirationDate && (
                        <span className={cn('flex items-center gap-1', isExpiring ? 'text-amber-400' : '')}>
                          <Calendar className="w-3 h-3" /> Expires: {d.expirationDate}
                        </span>
                      )}
                      {d.credits != null && <span className="flex items-center gap-1"><Target className="w-3 h-3" /> {d.credits} cr</span>}
                    </div>
                    {isExpiring && (
                      <div className="flex items-center gap-1 mt-2 text-xs text-amber-400">
                        <AlertTriangle className="w-3 h-3" /> Expiring soon
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ============================================================ */}
      {/*  TAB: Resources (Resource Library)                            */}
      {/* ============================================================ */}
      {activeTab === 'Resources' && (
        <section className={ds.panel}>
          <div className={cn(ds.sectionHeader, 'mb-4')}>
            <h2 className={ds.heading2}>Resource Library</h2>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search resources..." className={cn(ds.input, 'pl-9 w-56')} />
              </div>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as Status | 'all')} className={cn(ds.select, 'w-40')}>
                <option value="all">All statuses</option>
                {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Resource Stats */}
          <div className={cn(ds.grid4, 'mb-4')}>
            {(['textbook', 'video', 'article', 'worksheet'] as ResourceType[]).map(type => {
              const count = resources.filter(r => (r.data as unknown as EducationArtifact).resourceType === type).length;
              const icons: Record<string, LucideIcon> = { textbook: BookOpen, video: Video, article: FileText, worksheet: FileType };
              const Icon = icons[type] || FileText;
              return (
                <div key={type} className="flex items-center gap-3 p-3 rounded-lg bg-lattice-elevated">
                  <Icon className="w-5 h-5 text-neon-cyan" />
                  <div>
                    <span className="text-lg font-bold text-white">{count}</span>
                    <p className={cn(ds.textMuted, 'capitalize text-xs')}>{type}s</p>
                  </div>
                </div>
              );
            })}
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-12">
              <Library className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className={ds.textMuted}>No resources found. Add textbooks, videos, articles, and more.</p>
            </div>
          ) : (
            <div className={ds.grid3}>
              {filtered.map(item => {
                const d = item.data as unknown as EducationArtifact;
                const typeIcons: Record<string, LucideIcon> = {
                  textbook: BookOpen, article: FileText, video: Video,
                  worksheet: FileType, presentation: Layers, link: ExternalLink,
                  file: FileCheck, other: Library,
                };
                const ResIcon = typeIcons[d.resourceType || 'other'] || Library;
                return (
                  <div key={item.id} className={ds.panelHover} onClick={() => openEditEditor(item)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <ResIcon className="w-5 h-5 text-neon-cyan shrink-0" />
                        <h3 className={cn(ds.heading3, 'text-base truncate')}>{item.title}</h3>
                      </div>
                      <span className={ds.badge(STATUS_COLORS[d.status])}>{d.status}</span>
                    </div>
                    <p className={cn(ds.textMuted, 'line-clamp-2 mb-3')}>{d.description}</p>
                    <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                      {d.resourceType && <span className={ds.badge('neon-cyan')}>{d.resourceType}</span>}
                      {d.resourceCourse && <span className="flex items-center gap-1"><BookOpen className="w-3 h-3" /> {d.resourceCourse}</span>}
                      {d.resourceTopic && <span className="flex items-center gap-1"><Layers className="w-3 h-3" /> {d.resourceTopic}</span>}
                      {d.subject && <span className="flex items-center gap-1"><Target className="w-3 h-3" /> {d.subject}</span>}
                    </div>
                    {d.resourceUrl && (
                      <div className="mt-2 flex items-center gap-1 text-xs text-neon-blue">
                        <ExternalLink className="w-3 h-3" />
                        <span className="truncate">{d.resourceUrl}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1 mt-3">
                      <button onClick={(e) => { e.stopPropagation(); openEditEditor(item); }} className={cn(ds.btnGhost, 'text-xs px-2 py-1')}>
                        <Edit3 className="w-3 h-3" /> Edit
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); remove(item.id); }} className={cn(ds.btnGhost, 'text-xs px-2 py-1 hover:text-red-400')}>
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ============================================================ */}
      {/*  TAB: Quizzes (Quiz Builder)                                  */}
      {/* ============================================================ */}
      {activeTab === 'Flashcards' && (
        <div className="p-6">
          <FlashcardDeck />
        </div>
      )}
      {activeTab === 'Socratic' && (
        <div className="p-6">
          <SocraticTutor subject="general" level="all levels" className="h-[640px]" />
        </div>
      )}
      {activeTab === 'QuizGen' && (
        <div className="p-6">
          <QuizGenerator />
        </div>
      )}
      {activeTab === 'LessonPlan' && (
        <div className="p-6">
          <LessonPlanBuilder />
        </div>
      )}
      {activeTab === 'Video' && (
        <section className={ds.panel}>
          <h2 className={cn(ds.heading2, 'mb-4')}>Video lessons</h2>
          <VideoLessonPlayer />
        </section>
      )}
      {activeTab === 'Exercises' && (
        <section className={ds.panel}>
          <h2 className={cn(ds.heading2, 'mb-4')}>Interactive exercises</h2>
          <InteractiveExercises />
        </section>
      )}
      {activeTab === 'Paths' && (
        <section className={ds.panel}>
          <h2 className={cn(ds.heading2, 'mb-4')}>Learning paths</h2>
          <LearningPaths />
        </section>
      )}
      {activeTab === 'Cohorts' && (
        <section className={ds.panel}>
          <h2 className={cn(ds.heading2, 'mb-4')}>Live cohorts</h2>
          <LiveCohorts />
        </section>
      )}
      {activeTab === 'Mastery' && (
        <section className={ds.panel}>
          <h2 className={cn(ds.heading2, 'mb-4')}>Mastery dashboard</h2>
          <MasteryDashboard />
        </section>
      )}
      {activeTab === 'LessonQA' && (
        <section className={ds.panel}>
          <h2 className={cn(ds.heading2, 'mb-4')}>Lesson Q&amp;A</h2>
          <LessonQA />
        </section>
      )}
      {activeTab === 'Quizzes' && (
        <section className={ds.panel}>
          <div className={cn(ds.sectionHeader, 'mb-4')}>
            <h2 className={ds.heading2}>Quiz Builder</h2>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search quizzes..." className={cn(ds.input, 'pl-9 w-56')} />
              </div>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as Status | 'all')} className={cn(ds.select, 'w-40')}>
                <option value="all">All statuses</option>
                {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Quiz Stats */}
          <div className={cn(ds.grid4, 'mb-4')}>
            <div className={ds.panel}>
              <HelpCircle className="w-5 h-5 text-neon-blue mb-2" />
              <p className="text-2xl font-bold text-white">{quizzes.length}</p>
              <p className={ds.textMuted}>Total Quizzes</p>
            </div>
            <div className={ds.panel}>
              <CheckCircle className="w-5 h-5 text-neon-green mb-2" />
              <p className="text-2xl font-bold text-white">{quizzes.filter(q => (q.data as unknown as EducationArtifact).status === 'completed').length}</p>
              <p className={ds.textMuted}>Published</p>
            </div>
            <div className={ds.panel}>
              <FileQuestion className="w-5 h-5 text-amber-400 mb-2" />
              <p className="text-2xl font-bold text-white">
                {quizzes.reduce((sum, q) => sum + ((q.data as unknown as EducationArtifact).quizQuestions?.length || 0), 0)}
              </p>
              <p className={ds.textMuted}>Total Questions</p>
            </div>
            <div className={ds.panel}>
              <Clock className="w-5 h-5 text-neon-cyan mb-2" />
              <p className="text-2xl font-bold text-white">
                {quizzes.length > 0 ? Math.round(quizzes.reduce((sum, q) => sum + ((q.data as unknown as EducationArtifact).quizTimeLimit || 0), 0) / quizzes.length) : 0}
              </p>
              <p className={ds.textMuted}>Avg Time (min)</p>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-12">
              <HelpCircle className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className={ds.textMuted}>No quizzes found. Create one with multiple choice, true/false, or short answer questions.</p>
            </div>
          ) : (
            <div className={ds.grid3}>
              {filtered.map(item => {
                const d = item.data as unknown as EducationArtifact;
                const qCount = d.quizQuestions?.length || 0;
                const totalPoints = d.quizQuestions?.reduce((sum, q) => sum + q.points, 0) || 0;
                const mcCount = d.quizQuestions?.filter(q => q.type === 'multiple_choice').length || 0;
                const tfCount = d.quizQuestions?.filter(q => q.type === 'true_false').length || 0;
                const saCount = d.quizQuestions?.filter(q => q.type === 'short_answer').length || 0;
                return (
                  <div key={item.id} className={ds.panelHover} onClick={() => openEditEditor(item)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                    <div className="flex items-start justify-between mb-2">
                      <h3 className={cn(ds.heading3, 'text-base truncate flex-1')}>{item.title}</h3>
                      <span className={ds.badge(STATUS_COLORS[d.status])}>{d.status}</span>
                    </div>
                    <p className={cn(ds.textMuted, 'line-clamp-2 mb-3')}>{d.description}</p>
                    <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap mb-2">
                      {d.subject && <span className="flex items-center gap-1"><Layers className="w-3 h-3" /> {d.subject}</span>}
                      {d.dueDate && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {d.dueDate}</span>}
                      <span className="flex items-center gap-1"><FileQuestion className="w-3 h-3" /> {qCount} questions</span>
                      <span className="flex items-center gap-1"><Hash className="w-3 h-3" /> {totalPoints} pts</span>
                    </div>
                    {/* Question type breakdown */}
                    <div className="flex items-center gap-2 mb-2">
                      {mcCount > 0 && <span className={ds.badge('neon-blue')}>{mcCount} MC</span>}
                      {tfCount > 0 && <span className={ds.badge('neon-green')}>{tfCount} T/F</span>}
                      {saCount > 0 && <span className={ds.badge('amber-400')}>{saCount} SA</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      {d.quizTimeLimit && <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {d.quizTimeLimit} min</span>}
                      {d.quizPassingScore && <span className="flex items-center gap-1"><Target className="w-3 h-3" /> {d.quizPassingScore}% to pass</span>}
                      {d.quizShuffleQuestions && <span className="flex items-center gap-1 text-neon-cyan"><Shuffle className="w-3 h-3" /> Shuffled</span>}
                    </div>
                    <div className="flex items-center gap-1 mt-3">
                      <button onClick={(e) => { e.stopPropagation(); openEditEditor(item); }} className={cn(ds.btnGhost, 'text-xs px-2 py-1')}>
                        <Edit3 className="w-3 h-3" /> Edit
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); remove(item.id); }} className={cn(ds.btnGhost, 'text-xs px-2 py-1 hover:text-red-400')}>
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ============================================================ */}
      {/*  Editor Modal                                                 */}
      {/* ============================================================ */}
      {showEditor && (
        <>
          <div className={ds.modalBackdrop} onClick={() => setShowEditor(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }} />
          <div className={ds.modalContainer}>
            <div className={cn(ds.modalPanel, 'max-w-2xl')}>
              <div className="flex items-center justify-between p-4 border-b border-lattice-border">
                <h2 className={ds.heading2}>{editingItem ? 'Edit' : 'New'} {formType}</h2>
                <button onClick={() => setShowEditor(false)} className={ds.btnGhost} aria-label="Close"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
                <div>
                  <label className={ds.label}>Title</label>
                  <input value={formTitle} onChange={e => setFormTitle(e.target.value)} className={ds.input} placeholder="Title" />
                </div>
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Type</label>
                    <select value={formType} onChange={e => setFormType(e.target.value as ArtifactType)} className={ds.select}>
                      <option value="Student">Student</option>
                      <option value="Course">Course</option>
                      <option value="Assignment">Assignment</option>
                      <option value="Grade">Grade</option>
                      <option value="LessonPlan">Lesson Plan</option>
                      <option value="Resource">Resource</option>
                      <option value="Quiz">Quiz</option>
                      <option value="Certification">Certification</option>
                    </select>
                  </div>
                  <div>
                    <label className={ds.label}>Status</label>
                    <select value={formStatus} onChange={e => setFormStatus(e.target.value as Status)} className={ds.select}>
                      {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                {/* Student-specific fields */}
                {formType === 'Student' && (
                  <div>
                    <label className={ds.label}>Email</label>
                    <input value={formEmail} onChange={e => setFormEmail(e.target.value)} className={ds.input} placeholder="student@email.com" />
                  </div>
                )}

                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Instructor</label>
                    <input value={formInstructor} onChange={e => setFormInstructor(e.target.value)} className={ds.input} placeholder="Instructor name" />
                  </div>
                  <div>
                    <label className={ds.label}>Subject</label>
                    <input value={formSubject} onChange={e => setFormSubject(e.target.value)} className={ds.input} placeholder="Subject area" />
                  </div>
                </div>
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Semester</label>
                    <input value={formSemester} onChange={e => setFormSemester(e.target.value)} className={ds.input} placeholder="e.g. Fall 2025" />
                  </div>
                  <div>
                    <label className={ds.label}>Due Date</label>
                    <input type="date" value={formDueDate} onChange={e => setFormDueDate(e.target.value)} className={ds.input} />
                  </div>
                </div>

                {/* Grade/Assignment specific fields */}
                {(formType === 'Grade' || formType === 'Assignment') && (
                  <>
                    <div className={ds.grid2}>
                      <div>
                        <label className={ds.label}>Grade</label>
                        <input value={formGrade} onChange={e => setFormGrade(e.target.value)} className={ds.input} placeholder="e.g. A, B+, Pass" />
                      </div>
                      <div>
                        <label className={ds.label}>Score (%)</label>
                        <input type="number" value={formScore} onChange={e => setFormScore(e.target.value)} className={ds.input} placeholder="0-100" min="0" max="100" />
                      </div>
                    </div>
                    <div className={ds.grid2}>
                      <div>
                        <label className={ds.label}>Max Score</label>
                        <input type="number" value={formMaxScore} onChange={e => setFormMaxScore(e.target.value)} className={ds.input} placeholder="100" min="0" />
                      </div>
                      <div>
                        <label className={ds.label}>Category</label>
                        <select value={formCategory} onChange={e => setFormCategory(e.target.value as GradeCategory)} className={ds.select}>
                          <option value="homework">Homework</option>
                          <option value="exams">Exams</option>
                          <option value="projects">Projects</option>
                          <option value="participation">Participation</option>
                        </select>
                      </div>
                    </div>
                  </>
                )}

                {/* Assignment Builder fields in modal */}
                {formType === 'Assignment' && (
                  <div className="space-y-3 p-3 border border-lattice-border rounded-lg">
                    <h4 className={cn(ds.heading3, 'text-sm')}>Assignment Options</h4>
                    <div className={ds.grid2}>
                      <button
                        onClick={() => setPeerReview(!peerReview)}
                        className={cn('flex items-center gap-2 text-sm text-left', peerReview ? 'text-neon-green' : 'text-gray-400')}
                      >
                        {peerReview ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                        Peer Review
                      </button>
                      <button
                        onClick={() => setPlagiarismCheck(!plagiarismCheck)}
                        className={cn('flex items-center gap-2 text-sm text-left', plagiarismCheck ? 'text-neon-green' : 'text-gray-400')}
                      >
                        {plagiarismCheck ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                        Plagiarism Check
                      </button>
                    </div>

                    {/* Inline Rubric */}
                    <div>
                      <div className={cn(ds.sectionHeader, 'mb-2')}>
                        <label className={cn(ds.label, 'mb-0 text-xs')}>Rubric</label>
                        <button onClick={addRubricCriterion} className={cn(ds.btnGhost, 'text-xs px-2 py-1')}>
                          <PlusCircle className="w-3 h-3" /> Add
                        </button>
                      </div>
                      {rubricCriteria.map((c, idx) => (
                        <div key={idx} className="flex items-center gap-2 mb-2">
                          <input value={c.name} onChange={e => updateRubricCriterion(idx, 'name', e.target.value)} placeholder="Criterion" className={cn(ds.input, 'text-sm flex-1')} />
                          <input type="number" value={c.maxPoints} onChange={e => updateRubricCriterion(idx, 'maxPoints', parseInt(e.target.value) || 0)} className={cn(ds.input, 'text-sm w-20 text-center')} />
                          <button onClick={() => removeRubricCriterion(idx)} className="text-red-400 hover:text-red-300 p-1" aria-label="Minus circle"><MinusCircle className="w-4 h-4" /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Resource-specific fields */}
                {formType === 'Resource' && (
                  <div className="space-y-3 p-3 border border-lattice-border rounded-lg">
                    <h4 className={cn(ds.heading3, 'text-sm')}>Resource Details</h4>
                    <div className={ds.grid2}>
                      <div>
                        <label className={ds.label}>Resource Type</label>
                        <select value={formResourceType} onChange={e => setFormResourceType(e.target.value as ResourceType)} className={ds.select}>
                          {(['textbook', 'article', 'video', 'worksheet', 'presentation', 'link', 'file', 'other'] as ResourceType[]).map(t => (
                            <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={ds.label}>Course</label>
                        <input value={formResourceCourse} onChange={e => setFormResourceCourse(e.target.value)} className={ds.input} placeholder="Associated course" />
                      </div>
                    </div>
                    <div>
                      <label className={ds.label}>Topic</label>
                      <input value={formResourceTopic} onChange={e => setFormResourceTopic(e.target.value)} className={ds.input} placeholder="e.g. Algebra, US History" />
                    </div>
                    <div>
                      <label className={ds.label}>URL / Link</label>
                      <input value={formResourceUrl} onChange={e => setFormResourceUrl(e.target.value)} className={ds.input} placeholder="https://..." />
                    </div>
                  </div>
                )}

                {/* Quiz Builder fields in modal */}
                {formType === 'Quiz' && (
                  <div className="space-y-4 p-3 border border-lattice-border rounded-lg">
                    <h4 className={cn(ds.heading3, 'text-sm')}>Quiz Settings</h4>
                    <div className={ds.grid2}>
                      <div>
                        <label className={ds.label}>Time Limit (min)</label>
                        <input type="number" value={quizTimeLimit} onChange={e => setQuizTimeLimit(parseInt(e.target.value) || 0)} className={ds.input} min={0} />
                      </div>
                      <div>
                        <label className={ds.label}>Passing Score (%)</label>
                        <input type="number" value={quizPassingScore} onChange={e => setQuizPassingScore(parseInt(e.target.value) || 0)} className={ds.input} min={0} max={100} />
                      </div>
                    </div>
                    <button
                      onClick={() => setQuizShuffleQuestions(!quizShuffleQuestions)}
                      className={cn('flex items-center gap-2 text-sm', quizShuffleQuestions ? 'text-neon-green' : 'text-gray-400')}
                    >
                      {quizShuffleQuestions ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                      Shuffle Questions
                    </button>

                    {/* Question List */}
                    <div>
                      <div className={cn(ds.sectionHeader, 'mb-2')}>
                        <label className={cn(ds.label, 'mb-0')}>Questions ({quizQuestions.length})</label>
                        <div className="flex items-center gap-1">
                          <button onClick={() => addQuizQuestion('multiple_choice')} className={cn(ds.btnGhost, 'text-xs px-2 py-1')}>
                            <PlusCircle className="w-3 h-3" /> MC
                          </button>
                          <button onClick={() => addQuizQuestion('true_false')} className={cn(ds.btnGhost, 'text-xs px-2 py-1')}>
                            <PlusCircle className="w-3 h-3" /> T/F
                          </button>
                          <button onClick={() => addQuizQuestion('short_answer')} className={cn(ds.btnGhost, 'text-xs px-2 py-1')}>
                            <PlusCircle className="w-3 h-3" /> Short
                          </button>
                        </div>
                      </div>
                      {quizQuestions.length === 0 ? (
                        <p className={cn(ds.textMuted, 'text-xs py-2')}>No questions yet. Add Multiple Choice, True/False, or Short Answer questions.</p>
                      ) : (
                        <div className="space-y-3 max-h-96 overflow-y-auto">
                          {quizQuestions.map((q, idx) => (
                            <div key={q.id} className="p-3 bg-lattice-elevated rounded-lg space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-gray-400">
                                  Q{idx + 1} - {q.type === 'multiple_choice' ? 'Multiple Choice' : q.type === 'true_false' ? 'True/False' : 'Short Answer'}
                                </span>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="number"
                                    value={q.points}
                                    onChange={e => updateQuizQuestion(q.id, 'points', parseInt(e.target.value) || 0)}
                                    className={cn(ds.input, 'w-16 text-center text-xs py-1')}
                                    min={0}
                                  />
                                  <span className="text-xs text-gray-400">pts</span>
                                  <button onClick={() => removeQuizQuestion(q.id)} className="text-red-400 hover:text-red-300 p-1" aria-label="Minus circle">
                                    <MinusCircle className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                              <input
                                value={q.question}
                                onChange={e => updateQuizQuestion(q.id, 'question', e.target.value)}
                                placeholder="Question text..."
                                className={cn(ds.input, 'text-sm')}
                              />
                              {q.type === 'multiple_choice' && q.options && (
                                <div className="space-y-1">
                                  {q.options.map((opt, oi) => (
                                    <div key={oi} className="flex items-center gap-2">
                                      <input
                                        type="radio"
                                        name={`correct-${q.id}`}
                                        checked={q.correctAnswer === opt && opt !== ''}
                                        onChange={() => updateQuizQuestion(q.id, 'correctAnswer', opt)}
                                        className="text-neon-green"
                                      />
                                      <input
                                        value={opt}
                                        onChange={e => updateQuizOption(q.id, oi, e.target.value)}
                                        placeholder={`Option ${String.fromCharCode(65 + oi)}`}
                                        className={cn(ds.input, 'text-xs flex-1 py-1')}
                                      />
                                    </div>
                                  ))}
                                  <button onClick={() => addQuizOption(q.id)} className={cn(ds.btnGhost, 'text-xs px-2 py-0.5')}>
                                    <PlusCircle className="w-3 h-3" /> Add Option
                                  </button>
                                </div>
                              )}
                              {q.type === 'true_false' && (
                                <div className="flex items-center gap-4">
                                  {['True', 'False'].map(val => (
                                    <label key={val} className="flex items-center gap-2 cursor-pointer">
                                      <input
                                        type="radio"
                                        name={`tf-${q.id}`}
                                        checked={q.correctAnswer === val}
                                        onChange={() => updateQuizQuestion(q.id, 'correctAnswer', val)}
                                        className="text-neon-green"
                                      />
                                      <span className="text-sm text-gray-300">{val}</span>
                                    </label>
                                  ))}
                                </div>
                              )}
                              {q.type === 'short_answer' && (
                                <input
                                  value={q.correctAnswer}
                                  onChange={e => updateQuizQuestion(q.id, 'correctAnswer', e.target.value)}
                                  placeholder="Expected answer..."
                                  className={cn(ds.input, 'text-xs')}
                                />
                              )}
                              <input
                                value={q.explanation || ''}
                                onChange={e => updateQuizQuestion(q.id, 'explanation', e.target.value)}
                                placeholder="Explanation (shown after answering)..."
                                className={cn(ds.input, 'text-xs')}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                      {quizQuestions.length > 0 && (
                        <p className={cn(ds.textMuted, 'text-xs mt-2')}>
                          Total: {quizQuestions.reduce((sum, q) => sum + q.points, 0)} points across {quizQuestions.length} questions
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div>
                  <label className={ds.label}>Credits</label>
                  <input type="number" value={formCredits} onChange={e => setFormCredits(e.target.value)} className={ds.input} placeholder="Credit hours" min="0" />
                </div>
                <div>
                  <label className={ds.label}>Description</label>
                  <DraftedTextarea lensId="education" draftKey="form-description" className={ds.textarea} rows={3} initial={formDescription} onValueChange={setFormDescription} placeholder="Description..." />
                </div>
                <div>
                  <label className={ds.label}>Notes</label>
                  <DraftedTextarea lensId="education" draftKey="form-notes" className={ds.textarea} rows={2} initial={formNotes} onValueChange={setFormNotes} placeholder="Additional notes..." />
                </div>
              </div>
              <div className="flex items-center justify-between p-4 border-t border-lattice-border">
                <div>
                  {editingItem && (
                    <button onClick={() => { remove(editingItem.id); setShowEditor(false); }} className={ds.btnDanger}>
                      <Trash2 className="w-4 h-4" /> Delete
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

      {/* Feature 43: Spaced Repetition Study Mode */}
      {activeTab === 'Study' && (
        <StudyModePanel />
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
            <LensFeaturePanel lensId="education" />
          </div>
        )}
      </div>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <GutenbergCurriculum />
      </section>
      {/* Phase 4 — REAL Open Library book search. */}
      <section className="mt-4">
        <OpenLibraryPanel domain="education" />
      </section>
      {/* Phase 4 (third wave) — REAL Free Dictionary lookup. */}
      <section className="mt-4">
        <DictionaryPanel domain="education" />
      </section>

      <PipingProvider>
        <section className="mt-6">
          <EducationActionPanel />
        </section>
      </PipingProvider>
    </div>
    {/* Phase 11 (Item 5) — mobile thumb-reachable tab bar. */}
    <MobileTabBar
      tabs={[
        { id: 'Students',     label: 'People',  icon: MobileTabUsers },
        { id: 'Courses',      label: 'Courses', icon: MobileTabBook },
        { id: 'Assignments',  label: 'Work',    icon: MobileTabList },
        { id: 'Grades',       label: 'Grades',  icon: MobileTabAward },
        { id: 'Plans',        label: 'Plans',   icon: MobileTabCal },
        { id: 'Study',        label: 'Study',   icon: MobileTabBrain },
      ]}
      active={activeTab}
      onSelect={(id) => setActiveTab(id as ModeTab)}
    />
    </LensShell>
  );
}

/**
 * Feature 43: Spaced Repetition Study Mode Panel
 * Wired to existing SRS endpoints (/api/srs/due, /api/srs/:dtuId/review)
 * Uses the SM-2 algorithm implemented on the server.
 */
function StudyModePanel() {
  const queryClient = useQueryClient();
  const [showAnswer, setShowAnswer] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());

  const { data: srsData, isLoading } = useQuery({
    queryKey: ['srs-due'],
    queryFn: () => apiHelpers.srs.due().then(r => r.data),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ dtuId, quality }: { dtuId: string; quality: number }) =>
      apiHelpers.srs.review(dtuId, { quality }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['srs-due'] }),
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const cards = srsData?.due || srsData?.cards || [];
  const currentCard = cards[currentIndex];
  const remaining = cards.filter((c: { dtu?: { id?: string }; dtuId?: string }) => !reviewed.has(c.dtu?.id || c.dtuId || '')).length;
  const total = cards.length;
  const retentionRate = total > 0 ? Math.round(((total - remaining) / Math.max(total, 1)) * 100) : 0;

  const handleReview = (quality: number) => {
    if (!currentCard) return;
    const dtuId = currentCard.dtu?.id || currentCard.dtuId;
    reviewMutation.mutate({ dtuId, quality });
    setReviewed(prev => new Set([...prev, dtuId]));
    setShowAnswer(false);
    // Advance to next
    const next = cards.findIndex((c: { dtu?: { id?: string }; dtuId?: string }, i: number) =>
      i > currentIndex && !reviewed.has(c.dtu?.id || c.dtuId || '')
    );
    if (next !== -1) setCurrentIndex(next);
  };

  if (isLoading) {
    return (
      <section className="p-6">
        <div className="flex items-center gap-2 text-gray-400">
          <Clock className="w-5 h-5 animate-spin" />
          Loading study cards...
        </div>
      </section>
    );
  }

  return (
    <section className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookMarked className="w-6 h-6 text-neon-cyan" />
          <div>
            <h2 className="text-lg font-bold text-white">Spaced Repetition Study</h2>
            <p className="text-xs text-gray-400">SM-2 algorithm -- review DTUs at optimal intervals</p>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 rounded-lg bg-lattice-surface border border-lattice-border text-center">
          <p className="text-2xl font-bold text-neon-cyan">{total}</p>
          <p className="text-xs text-gray-400">Cards Due</p>
        </div>
        <div className="p-4 rounded-lg bg-lattice-surface border border-lattice-border text-center">
          <p className="text-2xl font-bold text-green-400">{retentionRate}%</p>
          <p className="text-xs text-gray-400">Session Progress</p>
        </div>
        <div className="p-4 rounded-lg bg-lattice-surface border border-lattice-border text-center">
          <p className="text-2xl font-bold text-purple-400">{remaining}</p>
          <p className="text-xs text-gray-400">Remaining</p>
        </div>
      </div>

      {/* Card */}
      {total === 0 ? (
        <div className="text-center py-12">
          <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-white">All caught up!</h3>
          <p className="text-gray-400">No cards due for review. Add DTUs to SRS from other lenses.</p>
        </div>
      ) : remaining === 0 ? (
        <div className="text-center py-12">
          <Award className="w-12 h-12 text-neon-cyan mx-auto mb-3" />
          <h3 className="text-lg font-bold text-white">Session Complete!</h3>
          <p className="text-gray-400">You reviewed {total} cards.</p>
        </div>
      ) : currentCard ? (
        <div className="space-y-4">
          {/* Progress bar */}
          <div className="h-1.5 bg-lattice-surface rounded-full overflow-hidden">
            <div className="h-full bg-neon-cyan transition-all duration-300 rounded-full"
              style={{ width: `${((total - remaining) / total) * 100}%` }} />
          </div>

          {/* Question card */}
          <div className="p-8 bg-lattice-surface border border-lattice-border rounded-xl text-center">
            <h3 className="text-xl font-bold text-white mb-2">
              {currentCard.dtu?.title || currentCard.title || 'Untitled'}
            </h3>
            {(currentCard.dtu?.tags || []).slice(0, 4).map((tag: string) => (
              <span key={tag} className="inline-block px-2 py-0.5 text-xs bg-lattice-bg rounded text-gray-400 mr-1">#{tag}</span>
            ))}
            <p className="text-xs text-gray-400 mt-3">
              Interval: {currentCard.card?.interval || currentCard.interval || 1}d
              {' '} | Ease: {(currentCard.card?.easeFactor || currentCard.easiness || 2.5).toFixed(2)}
              {' '} | Reps: {currentCard.card?.repetitions || currentCard.repetitions || 0}
            </p>
          </div>

          {!showAnswer ? (
            <button onClick={() => setShowAnswer(true)}
              className="w-full py-3 bg-neon-cyan/10 border border-neon-cyan/30 rounded-xl text-neon-cyan font-medium hover:bg-neon-cyan/20 transition-colors">
              Show Answer (Space)
            </button>
          ) : (
            <div className="space-y-3">
              {currentCard.dtu?.content && (
                <div className="p-4 bg-lattice-bg border border-lattice-border rounded-xl text-gray-300 text-sm whitespace-pre-wrap">
                  {currentCard.dtu.content}
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { q: 1, label: 'Again', color: 'text-red-400' },
                  { q: 3, label: 'Good', color: 'text-green-400' },
                  { q: 5, label: 'Easy', color: 'text-neon-cyan' },
                ].map(opt => (
                  <button key={opt.q} onClick={() => handleReview(opt.q)}
                    className="p-3 bg-lattice-surface border border-lattice-border rounded-lg hover:border-gray-500 transition-colors">
                    <span className={`text-sm font-medium ${opt.color}`}>{opt.label}</span>
                    <span className="block text-xs text-gray-400 mt-1">({opt.q})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Concord Educational Engine — Panel Components
// Each panel calls the /api/learning/* endpoints for real data.
// ═══════════════════════════════════════════════════════════════════

function PanelShell({ title, subtitle, icon: Icon, accent = 'neon-cyan', children }: {
  title: string; subtitle?: string; icon: React.ComponentType<{ className?: string; size?: number | string }>; accent?: string; children: React.ReactNode;
}) {
  return (
    <section className="bg-lattice-surface border border-lattice-border rounded-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <Icon className={`w-5 h-5 text-${accent}`} />
        <div>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

interface GenomeSummary {
  totalKnown?: number;
  totalMastered?: number;
  gapCount?: number;
  strongestDomain?: string;
  velocity?: number;
}

interface GenomeApiResponse {
  ok?: boolean;
  summary?: GenomeSummary;
  nodes?: Array<{ id: string; title?: string; domain?: string; mastery?: number; gap?: boolean; tier?: string }>;
  dtus?: Array<{ id: string; title?: string; domain?: string; mastery?: number }>;
}

interface GenomeGraphApiResponse {
  ok?: boolean;
  nodes?: Array<{ id: string; title?: string; domain?: string; mastery?: number; gap?: boolean }>;
  edges?: Array<{ source: string; target: string }>;
}

function GenomePanel() {
  const [selectedNode, setSelectedNode] = useState<GenomeNode | null>(null);

  const genomeQuery = useQuery<GenomeApiResponse | null>({
    queryKey: ['learning', 'genome'],
    queryFn: async () => {
      try {
        const r = await api.get('/api/learning/genome');
        return r.data as GenomeApiResponse;
      } catch {
        return null;
      }
    },
  });

  const graphQuery = useQuery<GenomeGraphApiResponse | null>({
    queryKey: ['learning', 'genome', 'graph'],
    queryFn: async () => {
      try {
        const r = await api.get('/api/learning/genome/graph');
        return r.data as GenomeGraphApiResponse;
      } catch {
        return null;
      }
    },
  });

  const summary: GenomeSummary = genomeQuery.data?.summary ?? {};

  const { nodes, edges } = useMemo<{ nodes: GenomeNode[]; edges: GenomeEdge[] }>(() => {
    const graph = graphQuery.data;
    if (graph?.nodes && graph.nodes.length > 0) {
      return {
        nodes: graph.nodes.map(n => ({
          id: n.id,
          title: n.title ?? n.id,
          domain: n.domain,
          mastery: n.mastery ?? 0,
          gap: !!n.gap,
        })),
        edges: graph.edges ?? [],
      };
    }
    // fall back to genome nodes list if graph not available
    const raw = genomeQuery.data?.nodes ?? genomeQuery.data?.dtus ?? [];
    return {
      nodes: raw.map(n => ({
        id: n.id,
        title: n.title ?? n.id,
        domain: n.domain,
        mastery: (n as { mastery?: number }).mastery ?? 0,
        gap: !!(n as { gap?: boolean }).gap,
      })),
      edges: [],
    };
  }, [genomeQuery.data, graphQuery.data]);

  const isLoading = genomeQuery.isLoading || graphQuery.isLoading;

  return (
    <PanelShell title="Knowledge Genome" subtitle="Your intellectual DNA, rendered as a living graph" icon={Dna} accent="neon-cyan">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <StatCard label="Known" value={summary.totalKnown ?? nodes.length} />
        <StatCard label="Mastered" value={summary.totalMastered ?? 0} />
        <StatCard label="Gaps" value={summary.gapCount ?? nodes.filter(n => n.gap).length} />
        <StatCard label="Strongest" value={summary.strongestDomain ?? '—'} />
        <StatCard label="Velocity" value={summary.velocity != null ? `${summary.velocity}/wk` : '—'} />
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading genome…</p>}

      <GenomeGraph
        nodes={nodes}
        edges={edges}
        height={440}
        selectedId={selectedNode?.id ?? null}
        onSelect={(n) => setSelectedNode(n)}
      />

      {selectedNode && (
        <div className="mt-3 p-3 bg-lattice-bg border border-neon-cyan/30 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-xs text-gray-400 uppercase">Selected DTU</p>
              <p className="text-sm text-white font-medium truncate">{selectedNode.title}</p>
              <p className="text-xs text-gray-400">
                {selectedNode.domain ?? 'unknown domain'}
                {' · '}
                mastery {Math.round((selectedNode.mastery ?? 0) * 100)}%
                {selectedNode.gap && ' · GAP'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedNode(null)}
              className="text-xs text-gray-400 hover:text-white"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-4">
        Mastery updates every time you read, cite, create, test, or teach a DTU. Gaps (red) are inferred by the feasibility manifold as pre-requisites for unreachable frontier nodes.
      </p>
    </PanelShell>
  );
}

interface FrontierApiResponse {
  ok?: boolean;
  frontier?: Array<{
    id?: string;
    dtuId?: string;
    title?: string;
    kind?: string;
    domain?: string;
    readiness?: number;
    estimatedMinutes?: number;
    summary?: string;
  }>;
}

interface PathApiResponse {
  ok?: boolean;
  path?: Array<{
    id?: string;
    dtuId?: string;
    title?: string;
    kind?: string;
    domain?: string;
    readiness?: number;
    estimatedMinutes?: number;
    summary?: string;
    order?: number;
  }>;
}

function LearningPathPanel() {
  const queryClient = useQueryClient();
  const [goal, setGoal] = useState('');
  const [startingId, setStartingId] = useState<string | null>(null);

  const frontierQuery = useQuery<FrontierApiResponse | null>({
    queryKey: ['learning', 'frontier'],
    queryFn: async () => {
      try {
        const r = await api.get('/api/learning/frontier');
        return r.data as FrontierApiResponse;
      } catch {
        return null;
      }
    },
  });

  const pathMutation = useMutation<PathApiResponse, Error, string>({
    mutationFn: async (targetGoal: string) => {
      const r = await api.post('/api/learning/path', { goal: targetGoal });
      return r.data as PathApiResponse;
    },
  });

  const startMutation = useMutation({
    mutationFn: async (step: PathStep) => {
      const dtuId = step.dtuId ?? step.id;
      if (!dtuId) throw new Error('No DTU id on step');
      const r = await api.post('/api/learning/interaction', { dtuId, kind: 'start' });
      return r.data;
    },
    onMutate: (step) => {
      setStartingId(step.dtuId ?? step.id ?? null);
    },
    onSettled: () => {
      setStartingId(null);
      queryClient.invalidateQueries({ queryKey: ['learning', 'genome'] });
    },
  });

  const frontierSteps = useMemo<PathStep[]>(() => {
    const f = frontierQuery.data?.frontier ?? [];
    return f.slice(0, 12).map((s, i) => ({
      id: s.id ?? s.dtuId,
      dtuId: s.dtuId ?? s.id,
      order: i + 1,
      title: s.title ?? (s.id ?? 'Untitled'),
      kind: s.kind ?? 'study',
      domain: s.domain,
      readiness: s.readiness,
      estimatedMinutes: s.estimatedMinutes,
      summary: s.summary,
    }));
  }, [frontierQuery.data]);

  const pathSteps = useMemo<PathStep[]>(() => {
    const p = pathMutation.data?.path ?? [];
    return p.map((s, i) => ({
      id: s.id ?? s.dtuId,
      dtuId: s.dtuId ?? s.id,
      order: s.order ?? i + 1,
      title: s.title ?? (s.id ?? 'Untitled'),
      kind: s.kind ?? 'study',
      domain: s.domain,
      readiness: s.readiness,
      estimatedMinutes: s.estimatedMinutes,
      summary: s.summary,
    }));
  }, [pathMutation.data]);

  return (
    <PanelShell
      title="Learning Path"
      subtitle="Navigate the feasibility manifold — reachable frontier first, full path on demand"
      icon={Route}
      accent="neon-purple"
    >
      <div className="flex flex-col md:flex-row gap-2 mb-4">
        <input
          value={goal}
          onChange={e => setGoal(e.target.value)}
          placeholder="Learning goal (e.g. 'understand general relativity')"
          className="flex-1 p-2 bg-lattice-deep border border-lattice-border rounded-lg text-sm text-white"
        />
        <button
          type="button"
          onClick={() => goal && pathMutation.mutate(goal)}
          disabled={!goal || pathMutation.isPending}
          className="px-4 py-2 bg-neon-purple/20 text-neon-purple border border-neon-purple/30 rounded-lg hover:bg-neon-purple/30 text-sm disabled:opacity-50"
        >
          {pathMutation.isPending ? 'Computing…' : 'Plan Path'}
        </button>
      </div>

      {pathSteps.length > 0 && (
        <div className="mb-6">
          <h4 className="text-xs uppercase tracking-wider text-neon-purple mb-2">Current Path</h4>
          <div className="space-y-2">
            {pathSteps.map(step => (
              <PathStepCard
                key={`${step.order}-${step.id ?? step.title}`}
                step={step}
                starting={startingId === (step.dtuId ?? step.id)}
                onStart={() => startMutation.mutate(step)}
              />
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-xs uppercase tracking-wider text-neon-cyan mb-2">Reachable Frontier</h4>
        {frontierQuery.isLoading && <p className="text-sm text-gray-400">Computing frontier…</p>}
        {!frontierQuery.isLoading && frontierSteps.length === 0 && (
          <p className="text-sm text-gray-400">No reachable frontier yet. Start with a core DTU from the Path Planner above.</p>
        )}
        <div className="space-y-2">
          {frontierSteps.map(step => (
            <PathStepCard
              key={`frontier-${step.order}-${step.id ?? step.title}`}
              step={step}
              starting={startingId === (step.dtuId ?? step.id)}
              onStart={() => startMutation.mutate(step)}
            />
          ))}
        </div>
      </div>
    </PanelShell>
  );
}

interface CitationDTU {
  id: string;
  title: string;
  domain?: string;
  tier?: string;
}

interface SubmissionResponse {
  ok?: boolean;
  published?: boolean;
  submission?: {
    id?: string;
    claim?: string;
    grade?: number;
    createdAt?: string;
  };
  evaluation?: {
    grade?: number;
    citationIntegrity?: number;
    coherence?: number;
    novelty?: number;
    depth?: number;
    c2Pass?: boolean;
    feedback?: string;
  };
  newDtu?: { id: string };
}

function ProofByCitationPanel() {
  const queryClient = useQueryClient();
  const [claim, setClaim] = useState('');
  const [selectedCitations, setSelectedCitations] = useState<CitationDTU[]>([]);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<CitationDTU[]>([]);
  const [searching, setSearching] = useState(false);

  const pastQuery = useQuery<{ submissions?: SubmissionResponse['submission'][] } | null>({
    queryKey: ['learning', 'submissions', 'mine'],
    queryFn: async () => {
      try {
        const r = await api.get('/api/learning/submissions/mine');
        return r.data as { submissions?: SubmissionResponse['submission'][] };
      } catch {
        return null;
      }
    },
  });

  const searchCitations = useCallback(async (q: string) => {
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const r = await api.get('/api/learning/dtus/search', { params: { q } });
      const payload = r.data as { dtus?: CitationDTU[]; results?: CitationDTU[] };
      setSearchResults(payload.dtus ?? payload.results ?? []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => searchCitations(search), 280);
    return () => clearTimeout(t);
  }, [search, searchCitations]);

  const submit = useMutation<SubmissionResponse, Error, void>({
    mutationFn: async () => {
      const r = await api.post('/api/learning/submit', {
        claim,
        citations: selectedCitations.map(c => c.id),
      });
      return r.data as SubmissionResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learning', 'submissions', 'mine'] });
      queryClient.invalidateQueries({ queryKey: ['learning', 'genome'] });
    },
  });

  const addCitation = (c: CitationDTU) => {
    if (!selectedCitations.some(s => s.id === c.id)) {
      setSelectedCitations([...selectedCitations, c]);
    }
    setSearch('');
    setSearchResults([]);
  };

  const removeCitation = (id: string) => {
    setSelectedCitations(selectedCitations.filter(c => c.id !== id));
  };

  const evaluation = submit.data?.evaluation;

  return (
    <PanelShell title="Proof by Citation" subtitle="Prove understanding by citing DTU evidence — passing submissions become new DTUs" icon={FileCheck} accent="neon-pink">
      <div className="space-y-4">
        <div>
          <label className="text-xs uppercase text-gray-400 mb-1 block">Your Claim</label>
          <textarea
            value={claim}
            onChange={e => setClaim(e.target.value)}
            placeholder="Articulate a non-trivial synthesis or argument…"
            className="w-full p-3 bg-lattice-deep border border-lattice-border rounded-lg text-sm text-white"
            rows={4}
          />
        </div>

        <div>
          <label className="text-xs uppercase text-gray-400 mb-1 block">Citations</label>
          <div className="flex flex-wrap gap-1 mb-2">
            {selectedCitations.map(c => (
              <span
                key={c.id}
                className="flex items-center gap-1 px-2 py-1 bg-neon-pink/10 border border-neon-pink/30 text-neon-pink rounded-full text-xs"
              >
                {c.title}
                <button type="button" onClick={() => removeCitation(c.id)} className="hover:text-white" aria-label="Close">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {selectedCitations.length === 0 && (
              <span className="text-xs text-gray-400">No citations yet. Search to add DTUs.</span>
            )}
          </div>
          <div className="relative">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search DTUs to cite…"
              className="w-full p-2 pl-8 bg-lattice-deep border border-lattice-border rounded-lg text-sm text-white"
            />
            <Search className="w-4 h-4 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
            {searching && <Loader2 className="w-4 h-4 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 animate-spin" />}
            {searchResults.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-lattice-deep border border-lattice-border rounded-lg max-h-48 overflow-auto">
                {searchResults.map(r => (
                  <button
                    type="button"
                    key={r.id}
                    onClick={() => addCitation(r)}
                    className="w-full text-left px-3 py-2 hover:bg-lattice-surface text-sm text-white border-b border-lattice-border last:border-0"
                  >
                    <div className="truncate">{r.title}</div>
                    <div className="text-xs text-gray-400">{r.domain ?? 'unknown'}{r.tier ? ` · ${r.tier}` : ''}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => submit.mutate()}
          disabled={!claim || selectedCitations.length === 0 || submit.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-neon-pink/20 text-neon-pink border border-neon-pink/30 rounded-lg hover:bg-neon-pink/30 text-sm disabled:opacity-50"
        >
          {submit.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {submit.isPending ? 'Evaluating…' : 'Submit for Evaluation'}
        </button>

        {evaluation && (
          <div className="p-4 bg-lattice-deep border border-lattice-border rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase text-gray-400">Evaluation</span>
              <span className={cn(
                'text-xs font-semibold px-2 py-0.5 rounded',
                evaluation.c2Pass ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400',
              )}>
                {evaluation.c2Pass ? 'C2 PASS' : 'C2 FAIL'}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <MetricBar label="Integrity" value={evaluation.citationIntegrity ?? 0} color="text-neon-cyan" />
              <MetricBar label="Coherence" value={evaluation.coherence ?? 0} color="text-neon-purple" />
              <MetricBar label="Novelty" value={evaluation.novelty ?? 0} color="text-neon-pink" />
              <MetricBar label="Depth" value={evaluation.depth ?? 0} color="text-amber-400" />
            </div>
            <div className="text-lg font-semibold text-white">
              Grade: {Math.round((evaluation.grade ?? 0) * 100)}%
            </div>
            {submit.data?.published && (
              <div className="text-xs text-emerald-400">Published as new DTU {submit.data.newDtu?.id ?? ''}</div>
            )}
            {evaluation.feedback && (
              <div className="text-xs text-gray-400 whitespace-pre-wrap border-t border-lattice-border pt-2">{evaluation.feedback}</div>
            )}
          </div>
        )}

        <div>
          <h4 className="text-xs uppercase tracking-wider text-gray-400 mb-2">Past Submissions</h4>
          {pastQuery.isLoading && <p className="text-sm text-gray-400">Loading…</p>}
          {pastQuery.data?.submissions && pastQuery.data.submissions.length > 0 ? (
            <div className="space-y-2">
              {pastQuery.data.submissions.slice(0, 8).map((s, i) => (
                <div key={s?.id ?? i} className="p-3 bg-lattice-deep border border-lattice-border rounded-lg text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-white truncate">{s?.claim ?? 'Untitled submission'}</p>
                    <span className="text-xs text-gray-400 shrink-0">
                      {Math.round((s?.grade ?? 0) * 100)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400">No submissions yet.</p>
          )}
        </div>
      </div>
    </PanelShell>
  );
}

function MetricBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-gray-400 uppercase text-[10px]">{label}</span>
        <span className={cn('text-[10px]', color)}>{pct}%</span>
      </div>
      <div className="h-1.5 bg-lattice-bg rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', color.replace('text-', 'bg-'))} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

interface TutorMessage {
  role: 'user' | 'tutor';
  text: string;
  citations?: Array<{ id: string; title?: string }>;
  socratic?: boolean;
}

interface TutorApiResponse {
  response?: string;
  answer?: string;
  citations?: Array<{ id: string; title?: string }>;
}

function TutorPanel() {
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState('general');
  const [socratic, setSocratic] = useState(false);
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const ask = useMutation<TutorApiResponse, Error, string>({
    mutationFn: async (q: string) => {
      const url = socratic ? '/api/learning/tutor/socratic' : '/api/learning/tutor/ask';
      const r = await api.post(url, { query: q, domain });
      return r.data as TutorApiResponse;
    },
    onSuccess: (res) => {
      setMessages(prev => [
        ...prev,
        {
          role: 'tutor',
          text: res.response ?? res.answer ?? '(no response)',
          citations: res.citations ?? [],
          socratic,
        },
      ]);
    },
    onError: (err) => {
      setMessages(prev => [
        ...prev,
        { role: 'tutor', text: `Tutor unavailable: ${err.message}` },
      ]);
    },
  });

  const submit = () => {
    if (!query.trim()) return;
    const q = query.trim();
    setMessages(prev => [...prev, { role: 'user', text: q }]);
    setQuery('');
    ask.mutate(q);
  };

  return (
    <PanelShell
      title="Entity Tutor"
      subtitle="AI mentors per domain — every answer is cited to DTU evidence"
      icon={GraduationCap}
      accent="neon-cyan"
    >
      <div className="flex flex-wrap gap-2 mb-3">
        <select
          value={domain}
          onChange={e => setDomain(e.target.value)}
          className="p-2 bg-lattice-deep border border-lattice-border rounded-lg text-sm text-white"
        >
          <option value="general">General</option>
          <option value="math">Math</option>
          <option value="physics">Physics</option>
          <option value="code">Code</option>
          <option value="philosophy">Philosophy</option>
          <option value="history">History</option>
          <option value="biology">Biology</option>
          <option value="art">Art</option>
        </select>
        <button
          type="button"
          onClick={() => setSocratic(!socratic)}
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors',
            socratic
              ? 'bg-neon-purple/20 text-neon-purple border-neon-purple/30'
              : 'bg-lattice-deep text-gray-400 border-lattice-border',
          )}
        >
          <Brain className="w-4 h-4" />
          Socratic Mode {socratic ? 'ON' : 'OFF'}
        </button>
      </div>

      <div
        ref={scrollRef}
        className="h-72 overflow-y-auto bg-lattice-deep border border-lattice-border rounded-lg p-3 space-y-3 mb-3"
      >
        {messages.length === 0 && (
          <p className="text-sm text-gray-400">Ask your domain tutor anything. In Socratic mode, the tutor asks back instead of telling.</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              'rounded-lg p-3 text-sm',
              m.role === 'user'
                ? 'bg-neon-cyan/10 border border-neon-cyan/30 text-white ml-8'
                : 'bg-lattice-surface border border-lattice-border text-gray-200 mr-8',
            )}
          >
            <div className="flex items-center gap-1 mb-1 text-[10px] uppercase tracking-wider text-gray-400">
              {m.role === 'user' ? <User className="w-3 h-3" /> : <GraduationCap className="w-3 h-3" />}
              {m.role}
              {m.socratic && <span className="text-neon-purple">· socratic</span>}
            </div>
            <p className="whitespace-pre-wrap">{m.text}</p>
            {m.citations && m.citations.length > 0 && (
              <div className="mt-2 pt-2 border-t border-lattice-border">
                <p className="text-[10px] uppercase text-gray-400 mb-1">Cited DTUs</p>
                <div className="flex flex-wrap gap-1">
                  {m.citations.map(c => (
                    <span key={c.id} className="text-[10px] px-1.5 py-0.5 bg-neon-cyan/10 text-neon-cyan rounded">
                      {c.title ?? c.id}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        {ask.isPending && (
          <div className="text-xs text-gray-400 flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> tutor thinking…
          </div>
        )}
      </div>

      <form
        onSubmit={e => { e.preventDefault(); submit(); }}
        className="flex gap-2"
      >
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Ask your tutor…"
          className="flex-1 p-2 bg-lattice-deep border border-lattice-border rounded-lg text-sm text-white"
        />
        <button
          type="submit"
          disabled={!query || ask.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30 rounded-lg text-sm disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          <Send className="w-4 h-4" />
          Ask
        </button>
      </form>
    </PanelShell>
  );
}

interface CohortMember {
  id: string;
  name?: string;
  mastery?: number;
}

interface Cohort {
  id: string;
  name?: string;
  domain?: string;
  members?: CohortMember[];
}

interface CohortApiResponse {
  ok?: boolean;
  cohorts?: Cohort[];
}

function CohortPanel() {
  const queryClient = useQueryClient();
  const [newCohortDomain, setNewCohortDomain] = useState('');
  const [newCohortName, setNewCohortName] = useState('');

  const mineQuery = useQuery<CohortApiResponse | null>({
    queryKey: ['learning', 'cohort', 'mine'],
    queryFn: async () => {
      try {
        const r = await api.get('/api/learning/cohort/mine');
        return r.data as CohortApiResponse;
      } catch {
        return null;
      }
    },
  });

  const matchQuery = useQuery<CohortApiResponse | null>({
    queryKey: ['learning', 'cohort', 'match'],
    queryFn: async () => {
      try {
        const r = await api.get('/api/learning/cohort/match');
        return r.data as CohortApiResponse;
      } catch {
        return null;
      }
    },
  });

  const formCohort = useMutation({
    mutationFn: async () => {
      const r = await api.post('/api/learning/cohort/form', {
        name: newCohortName,
        domain: newCohortDomain,
      });
      return r.data;
    },
    onSuccess: () => {
      setNewCohortDomain('');
      setNewCohortName('');
      queryClient.invalidateQueries({ queryKey: ['learning', 'cohort'] });
    },
  });

  const peerTeach = useMutation({
    mutationFn: async (payload: { cohortId: string; peerId: string }) => {
      const r = await api.post('/api/learning/cohort/teach', payload);
      return r.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learning', 'earnings'] });
    },
  });

  const myCohorts = mineQuery.data?.cohorts ?? [];
  const matches = matchQuery.data?.cohorts ?? [];

  return (
    <PanelShell title="Learning Cohorts" subtitle="Peer-matched learning groups — teach to earn" icon={Users} accent="neon-purple">
      <div className="p-3 bg-lattice-deep border border-lattice-border rounded-lg mb-4">
        <h4 className="text-xs uppercase text-neon-purple mb-2">Form a Cohort</h4>
        <div className="flex flex-col md:flex-row gap-2">
          <input
            value={newCohortName}
            onChange={e => setNewCohortName(e.target.value)}
            placeholder="Cohort name"
            className="flex-1 p-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-white"
          />
          <input
            value={newCohortDomain}
            onChange={e => setNewCohortDomain(e.target.value)}
            placeholder="Domain"
            className="flex-1 p-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-white"
          />
          <button
            type="button"
            onClick={() => formCohort.mutate()}
            disabled={!newCohortName || !newCohortDomain || formCohort.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-neon-purple/20 text-neon-purple border border-neon-purple/30 rounded-lg text-sm disabled:opacity-50"
          >
            <UserPlus className="w-4 h-4" /> Form
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h4 className="text-xs uppercase text-neon-cyan mb-2">My Cohorts</h4>
          {mineQuery.isLoading && <p className="text-sm text-gray-400">Loading…</p>}
          {!mineQuery.isLoading && myCohorts.length === 0 && (
            <p className="text-sm text-gray-400">No cohorts yet. Form one above.</p>
          )}
          <div className="space-y-2">
            {myCohorts.map(c => (
              <div key={c.id} className="p-3 bg-lattice-deep border border-lattice-border rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm text-white">{c.name ?? `Cohort ${c.id}`}</p>
                    <p className="text-xs text-gray-400">{c.domain ?? 'mixed'} · {(c.members ?? []).length} members</p>
                  </div>
                </div>
                {(c.members ?? []).slice(0, 5).map(m => (
                  <div key={m.id} className="flex items-center justify-between py-1 text-xs">
                    <span className="text-gray-300 truncate">{m.name ?? m.id}</span>
                    <button
                      type="button"
                      onClick={() => peerTeach.mutate({ cohortId: c.id, peerId: m.id })}
                      disabled={peerTeach.isPending}
                      className="px-2 py-0.5 bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 rounded text-[10px] hover:bg-neon-cyan/20 disabled:opacity-50"
                    >
                      <MessageSquare className="w-3 h-3 inline mr-0.5" /> Teach
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="text-xs uppercase text-neon-pink mb-2">Matching Your Genome</h4>
          {matchQuery.isLoading && <p className="text-sm text-gray-400">Finding matches…</p>}
          {!matchQuery.isLoading && matches.length === 0 && (
            <p className="text-sm text-gray-400">No match suggestions yet.</p>
          )}
          <div className="space-y-2">
            {matches.map(c => (
              <div key={c.id} className="p-3 bg-lattice-deep border border-lattice-border rounded-lg">
                <p className="text-sm text-white">{c.name ?? `Cohort ${c.id}`}</p>
                <p className="text-xs text-gray-400">{c.domain ?? 'mixed'} · {(c.members ?? []).length} members</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PanelShell>
  );
}

type AssessmentQuestionType = 'synthesis' | 'application' | 'contradiction' | 'gap';

interface AssessmentQuestion {
  id: string;
  type: AssessmentQuestionType | string;
  prompt: string;
}

interface AssessmentApiResponse {
  ok?: boolean;
  assessmentId?: string;
  questions?: AssessmentQuestion[];
}

interface AssessmentGradeResponse {
  ok?: boolean;
  grades?: Array<{ questionId: string; score: number; feedback?: string }>;
  overall?: number;
}

const QUESTION_TYPE_META: Record<string, { color: string; label: string }> = {
  synthesis: { color: 'text-neon-cyan', label: 'Synthesis' },
  application: { color: 'text-neon-purple', label: 'Application' },
  contradiction: { color: 'text-neon-pink', label: 'Contradiction' },
  gap: { color: 'text-amber-400', label: 'Gap' },
};

function AssessmentPanel() {
  const [domain, setDomain] = useState('general');
  const [responses, setResponses] = useState<Record<string, string>>({});

  const gen = useMutation<AssessmentApiResponse, Error, void>({
    mutationFn: async () => {
      const r = await api.post('/api/learning/assessment/generate', { domain });
      return r.data as AssessmentApiResponse;
    },
    onSuccess: () => setResponses({}),
  });

  const grade = useMutation<AssessmentGradeResponse, Error, void>({
    mutationFn: async () => {
      const r = await api.post('/api/learning/assessment/grade', {
        assessmentId: gen.data?.assessmentId,
        responses: Object.entries(responses).map(([questionId, answer]) => ({ questionId, answer })),
      });
      return r.data as AssessmentGradeResponse;
    },
  });

  const questions = gen.data?.questions ?? [];

  return (
    <PanelShell title="STSVK Assessment" subtitle="Ungameable tests — synthesis, not recall" icon={ClipboardCheck} accent="neon-pink">
      <div className="flex gap-2 mb-4">
        <input
          value={domain}
          onChange={e => setDomain(e.target.value)}
          placeholder="Domain (e.g. math, code, philosophy)"
          className="flex-1 p-2 bg-lattice-deep border border-lattice-border rounded-lg text-sm text-white"
        />
        <button
          type="button"
          onClick={() => gen.mutate()}
          disabled={gen.isPending || !domain}
          className="px-4 py-2 bg-neon-pink/20 text-neon-pink border border-neon-pink/30 rounded-lg text-sm disabled:opacity-50"
        >
          {gen.isPending ? 'Generating…' : 'Generate Assessment'}
        </button>
      </div>

      {questions.length > 0 && (
        <div className="space-y-3">
          {questions.map((q, i) => {
            const meta = QUESTION_TYPE_META[q.type as string] ?? { color: 'text-gray-400', label: String(q.type) };
            const gradeItem = grade.data?.grades?.find(g => g.questionId === q.id);
            return (
              <div key={q.id ?? i} className="p-4 bg-lattice-deep border border-lattice-border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] uppercase text-gray-400">Q{i + 1}</span>
                  <span className={cn('text-[10px] uppercase font-semibold', meta.color)}>{meta.label}</span>
                </div>
                <p className="text-sm text-white mb-3">{q.prompt}</p>
                <textarea
                  value={responses[q.id] ?? ''}
                  onChange={e => setResponses({ ...responses, [q.id]: e.target.value })}
                  placeholder="Your response…"
                  rows={3}
                  className="w-full p-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-white"
                  disabled={!!grade.data}
                />
                {gradeItem && (
                  <div className="mt-2 p-2 bg-lattice-surface border border-lattice-border rounded text-xs">
                    <span className="text-neon-cyan">Score: {Math.round(gradeItem.score * 100)}%</span>
                    {gradeItem.feedback && <p className="text-gray-400 mt-1">{gradeItem.feedback}</p>}
                  </div>
                )}
              </div>
            );
          })}

          {!grade.data && (
            <button
              type="button"
              onClick={() => grade.mutate()}
              disabled={grade.isPending || Object.keys(responses).length === 0}
              className="px-4 py-2 bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30 rounded-lg text-sm disabled:opacity-50"
            >
              {grade.isPending ? 'Grading…' : 'Submit Responses'}
            </button>
          )}

          {grade.data?.overall != null && (
            <div className="p-3 bg-neon-pink/10 border border-neon-pink/30 rounded-lg text-center">
              <p className="text-xs text-gray-400 uppercase">Overall</p>
              <p className="text-2xl font-bold text-neon-pink">{Math.round((grade.data.overall ?? 0) * 100)}%</p>
            </div>
          )}
        </div>
      )}

      {!gen.data && (
        <p className="text-xs text-gray-400">Generate an assessment to see 4 question types — synthesis, application, contradiction, and gap.</p>
      )}
    </PanelShell>
  );
}

interface CredentialMetrics {
  dtusStudied?: number;
  dtusMastered?: number;
  dtusCreated?: number;
  timesTaught?: number;
  averageMastery?: number;
  citationsReceived?: number;
}

interface CredentialApiResponse {
  ok?: boolean;
  credential?: {
    credentialId?: string;
    studentId?: string;
    domain?: string;
    issuedAt?: string;
    hash?: string;
    verifyUrl?: string;
    metrics?: CredentialMetrics;
  };
}

const METRIC_LABELS: Record<keyof CredentialMetrics, string> = {
  dtusStudied: 'DTUs Studied',
  dtusMastered: 'DTUs Mastered',
  dtusCreated: 'DTUs Created',
  timesTaught: 'Times Taught',
  averageMastery: 'Avg Mastery',
  citationsReceived: 'Citations Recv.',
};

function CredentialsPanel() {
  const [domain, setDomain] = useState('general');

  const issue = useMutation<CredentialApiResponse, Error, void>({
    mutationFn: async () => {
      const r = await api.get(`/api/learning/credential/me/${encodeURIComponent(domain)}`);
      return r.data as CredentialApiResponse;
    },
  });

  const credential = issue.data?.credential;
  const metrics = credential?.metrics ?? {};

  return (
    <PanelShell title="Credential Genome" subtitle="Living, verifiable proof of understanding" icon={Award} accent="neon-cyan">
      <div className="flex gap-2 mb-4">
        <input
          value={domain}
          onChange={e => setDomain(e.target.value)}
          placeholder="Domain"
          className="flex-1 p-2 bg-lattice-deep border border-lattice-border rounded-lg text-sm text-white"
        />
        <button
          type="button"
          onClick={() => issue.mutate()}
          disabled={issue.isPending || !domain}
          className="flex items-center gap-2 px-4 py-2 bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30 rounded-lg text-sm disabled:opacity-50"
        >
          <Award className="w-4 h-4" />
          {issue.isPending ? 'Generating…' : 'Generate Credential'}
        </button>
      </div>

      {issue.isError && (
        <p className="text-sm text-amber-400">Credential unavailable for this domain yet.</p>
      )}

      {credential && (
        <div className="p-4 bg-gradient-to-br from-cyan-500/10 to-purple-500/5 border border-neon-cyan/30 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-neon-cyan">Verifiable Credential</p>
              <p className="text-sm text-white font-mono">{credential.credentialId ?? '—'}</p>
            </div>
            <Award className="w-8 h-8 text-neon-cyan" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {(Object.keys(METRIC_LABELS) as Array<keyof CredentialMetrics>).map(key => {
              const raw = metrics[key];
              const display = raw == null ? '—' : key === 'averageMastery' ? `${Math.round((raw as number) * 100)}%` : String(raw);
              return (
                <div key={key} className="p-2 bg-lattice-deep border border-lattice-border rounded-lg">
                  <p className="text-[10px] uppercase text-gray-400">{METRIC_LABELS[key]}</p>
                  <p className="text-sm text-white font-semibold">{display}</p>
                </div>
              );
            })}
          </div>
          {credential.hash && (
            <div className="pt-2 border-t border-lattice-border text-xs">
              <p className="text-gray-400 uppercase text-[10px]">Hash</p>
              <p className="text-neon-purple font-mono truncate">{credential.hash}</p>
            </div>
          )}
          {credential.verifyUrl && (
            <a
              href={credential.verifyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-neon-cyan hover:underline"
            >
              <ExternalLink className="w-3 h-3" /> Verify this credential
            </a>
          )}
        </div>
      )}
    </PanelShell>
  );
}

interface EarningsApiResponse {
  ok?: boolean;
  earnings?: {
    total?: number;
    count?: number;
    teachCount?: number;
    citationCount?: number;
    byAction?: Record<string, number>;
  };
}

interface LeaderboardEntry {
  rank?: number;
  userId?: string;
  name?: string;
  total?: number;
}

interface LeaderboardApiResponse {
  ok?: boolean;
  leaderboard?: LeaderboardEntry[];
}

interface RatesApiResponse {
  ok?: boolean;
  rates?: {
    earning?: Record<string, number>;
  };
}

function EarningsPanel() {
  const earningsQuery = useQuery<EarningsApiResponse | null>({
    queryKey: ['learning', 'earnings'],
    queryFn: async () => {
      try {
        const r = await api.get('/api/learning/earnings/me');
        return r.data as EarningsApiResponse;
      } catch {
        return null;
      }
    },
  });

  const leaderboardQuery = useQuery<LeaderboardApiResponse | null>({
    queryKey: ['learning', 'leaderboard'],
    queryFn: async () => {
      try {
        const r = await api.get('/api/learning/leaderboard');
        return r.data as LeaderboardApiResponse;
      } catch {
        return null;
      }
    },
  });

  const ratesQuery = useQuery<RatesApiResponse | null>({
    queryKey: ['learning', 'rates'],
    queryFn: async () => {
      try {
        const r = await api.get('/api/learning/rates');
        return r.data as RatesApiResponse;
      } catch {
        return null;
      }
    },
  });

  const earnings = earningsQuery.data?.earnings;
  const byAction = earnings?.byAction ?? {};

  return (
    <PanelShell title="Education Earnings" subtitle="Learn free. Teaching earns." icon={Coins} accent="neon-purple">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Total CC" value={earnings?.total ?? 0} />
        <StatCard label="Events" value={earnings?.count ?? 0} />
        <StatCard label="Taught" value={earnings?.teachCount ?? 0} />
        <StatCard label="Citations" value={earnings?.citationCount ?? 0} />
      </div>

      {Object.keys(byAction).length > 0 && (
        <div className="p-3 bg-lattice-deep border border-lattice-border rounded-lg mb-4">
          <p className="text-xs text-gray-400 uppercase mb-2">Earnings by Action</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-1 text-xs">
            {Object.entries(byAction).map(([action, value]) => (
              <div key={action} className="flex justify-between bg-lattice-surface rounded px-2 py-1">
                <span className="text-gray-400">{action}</span>
                <span className="text-neon-cyan">{value} CC</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-3 bg-lattice-deep border border-lattice-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Trophy className="w-4 h-4 text-amber-400" />
            <p className="text-xs text-gray-400 uppercase">Leaderboard</p>
          </div>
          {leaderboardQuery.isLoading && <p className="text-xs text-gray-400">Loading…</p>}
          {!leaderboardQuery.isLoading && (leaderboardQuery.data?.leaderboard ?? []).length === 0 && (
            <p className="text-xs text-gray-400">No leaderboard data yet.</p>
          )}
          <div className="space-y-1">
            {(leaderboardQuery.data?.leaderboard ?? []).slice(0, 10).map((entry, i) => (
              <div key={entry.userId ?? i} className="flex items-center justify-between text-xs">
                <span className="text-gray-400">#{entry.rank ?? i + 1}</span>
                <span className="flex-1 mx-2 text-white truncate">{entry.name ?? entry.userId ?? '—'}</span>
                <span className="text-neon-cyan">{entry.total ?? 0} CC</span>
              </div>
            ))}
          </div>
        </div>

        <div className="p-3 bg-lattice-deep border border-lattice-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Coins className="w-4 h-4 text-neon-cyan" />
            <p className="text-xs text-gray-400 uppercase">Rate Card</p>
          </div>
          {ratesQuery.data?.rates?.earning ? (
            <div className="grid grid-cols-1 gap-1 text-xs">
              {Object.entries(ratesQuery.data.rates.earning).map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span className="text-gray-400">{k}</span>
                  <span className="text-neon-cyan">+{v} CC</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400">Rates unavailable.</p>
          )}
        </div>
      </div>
    </PanelShell>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="p-3 bg-lattice-deep border border-lattice-border rounded-lg">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-lg font-semibold text-white mt-1">{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Khan / Coursera-parity workbench section                            */
/* ------------------------------------------------------------------ */

function KhanCourseraWorkbenchSection() {
  const [active, setActive] = useState<'dashboard' | 'catalog' | 'enrolled' | 'player' | 'skills' | 'certs' | 'assignments' | 'notes' | 'discussions'>('dashboard');
  const [activeCourse, setActiveCourse] = useState<EduCourse | null>(null);
  const TABS = [
    { id: 'dashboard', label: 'Progress' },
    { id: 'catalog', label: 'Catalog' },
    { id: 'enrolled', label: 'My courses' },
    { id: 'player', label: 'Player' },
    { id: 'skills', label: 'Skills' },
    { id: 'certs', label: 'Certificates' },
    { id: 'assignments', label: 'Assignments' },
    { id: 'notes', label: 'Notes' },
    { id: 'discussions', label: 'Discussions' },
  ] as const;
  return (
    <section className="mt-6 space-y-3">
      <h2 className="text-sm font-semibold text-amber-300 uppercase tracking-wider">Khan/Coursera-parity workbench</h2>
      <nav className="flex items-center gap-1 border-b border-amber-900/30 pb-2 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={
              'px-3 py-1.5 rounded-md text-xs font-mono whitespace-nowrap transition ' +
              (active === t.id
                ? 'bg-amber-500/15 text-amber-300 border border-amber-500/20'
                : 'text-gray-400 hover:text-amber-300 hover:bg-amber-900/10 border border-transparent')
            }
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div>
        {active === 'dashboard' && <StreakDashboard />}
        {active === 'catalog' && <CoursesCatalog onEnroll={(c) => { setActiveCourse(c); setActive('enrolled'); }} onSelect={setActiveCourse} />}
        {active === 'enrolled' && <EnrollmentsPanel onSelectCourse={(cid) => { setActiveCourse({ id: cid } as EduCourse); setActive('player'); }} />}
        {active === 'player' && <LessonPlayer />}
        {active === 'skills' && <SkillTree />}
        {active === 'certs' && <CertificatesPanel />}
        {active === 'assignments' && <AssignmentsBoard courseId={activeCourse?.id} />}
        {active === 'notes' && <LessonNotes />}
        {active === 'discussions' && <CourseDiscussions courseId={activeCourse?.id} />}
      </div>
      <section className="mt-4"><LensFeedButton domain="education" label="Live quiz feed" /></section>
    </section>
  );
}

