'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Lightbulb,
  ListTodo,
  SlidersHorizontal,
  CheckCircle,
  Rocket,
  Plus,
  GripVertical,
  X,
  ChevronDown,
  Calendar,
  Paperclip,
  MessageSquare,
  Kanban,
  Search,
  Filter,
  LayoutGrid,
  BarChart3,
  Table,
  Clock,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  FileText,
  Check,
  Circle,
  Activity,
  Upload,
  Layers,
  Trash2,
  Tag,
  Loader2,
  XCircle,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { generateId } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ColumnId = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'testing' | 'done';
type Priority = 'low' | 'medium' | 'high' | 'urgent';
type TaskType = 'task' | 'feature' | 'bug' | 'design' | 'research' | 'docs';
type ViewMode = 'board' | 'timeline' | 'table';

interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

interface Comment {
  id: string;
  author: string;
  text: string;
  timestamp: string;
}

interface ActivityEntry {
  id: string;
  action: string;
  timestamp: string;
}

interface Task {
  id: string;
  title: string;
  description: string;
  status: ColumnId;
  priority: Priority;
  type: TaskType;
  assignee: string;
  label: string;
  progress: number;
  dueDate: string;
  estimate?: string;
  tags?: string[];
  attachments: number;
  commentCount: number;
  subtasks: Subtask[];
  comments: Comment[];
  activity: ActivityEntry[];
  files: string[];
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const columns: {
  id: ColumnId;
  name: string;
  icon: typeof Lightbulb;
  color: string;
  bg: string;
  border: string;
}[] = [
  {
    id: 'backlog',
    name: 'Backlog',
    icon: Lightbulb,
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/30',
  },
  {
    id: 'todo',
    name: 'To Do',
    icon: ListTodo,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
  },
  {
    id: 'in_progress',
    name: 'In Progress',
    icon: Activity,
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
  },
  {
    id: 'in_review',
    name: 'In Review',
    icon: SlidersHorizontal,
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
  },
  {
    id: 'testing',
    name: 'Testing',
    icon: CheckCircle,
    color: 'text-pink-400',
    bg: 'bg-pink-500/10',
    border: 'border-pink-500/30',
  },
  {
    id: 'done',
    name: 'Done',
    icon: Rocket,
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    border: 'border-green-500/30',
  },
];

const priorityConfig: Record<Priority, { label: string; color: string; dot: string }> = {
  low: {
    label: 'Low',
    color: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    dot: 'bg-gray-400',
  },
  medium: {
    label: 'Med',
    color: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    dot: 'bg-blue-400',
  },
  high: {
    label: 'High',
    color: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    dot: 'bg-orange-400',
  },
  urgent: {
    label: 'Urgent',
    color: 'bg-red-500/20 text-red-400 border-red-500/30',
    dot: 'bg-red-400',
  },
};

const typeConfig: Record<TaskType, { label: string; color: string }> = {
  task: { label: 'Task', color: 'bg-violet-500/20 text-violet-300' },
  feature: { label: 'Feature', color: 'bg-rose-500/20 text-rose-300' },
  bug: { label: 'Bug', color: 'bg-red-500/20 text-red-300' },
  design: { label: 'Design', color: 'bg-teal-500/20 text-teal-300' },
  research: { label: 'Research', color: 'bg-indigo-500/20 text-indigo-300' },
  docs: { label: 'Docs', color: 'bg-fuchsia-500/20 text-fuchsia-300' },
};

const labels = [
  'Frontend',
  'Backend',
  'Design',
  'DevOps',
  'Research',
  'Marketing',
  'Operations',
  'Support',
  'Strategy',
];
const assignees = ['Alex', 'Jordan', 'Maya', 'Rio', 'Sam'];
const projects: string[] = [];

// ---------------------------------------------------------------------------
// Seed data (auto-created on first use, then persisted via backend)
// ---------------------------------------------------------------------------

const SEED_TASKS: { title: string; data: Record<string, unknown> }[] = [];

/** Convert a LensItem to the local Task type */
function lensItemToTask(item: LensItem<Record<string, unknown>>): Task {
  const d = item.data || {};
  return {
    id: item.id,
    title: item.title || (d.title as string) || 'Untitled',
    description: (d.description as string) || '',
    status: (d.status as ColumnId) || 'backlog',
    priority: (d.priority as Priority) || 'medium',
    type: (d.type as TaskType) || 'task',
    assignee: (d.assignee as string) || '',
    label: (d.label as string) || '',
    progress: (d.progress as number) || 0,
    dueDate: (d.dueDate as string) || new Date().toISOString().split('T')[0],
    estimate: d.estimate as string | undefined,
    tags: d.tags as string[] | undefined,
    attachments: (d.attachments as number) || 0,
    commentCount: (d.commentCount as number) || 0,
    subtasks: (d.subtasks as Subtask[]) || [],
    comments: (d.comments as Comment[]) || [],
    activity: (d.activity as ActivityEntry[]) || [],
    files: (d.files as string[]) || [],
  };
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function isOverdue(dateStr: string): boolean {
  return (
    new Date(dateStr) < new Date() && new Date(dateStr).toDateString() !== new Date().toDateString()
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function avatarColor(name: string): string {
  const colors = [
    'bg-blue-500',
    'bg-green-500',
    'bg-purple-500',
    'bg-pink-500',
    'bg-amber-500',
    'bg-cyan-500',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function BoardLensPage() {
  useLensNav('board');
  const {
    latestData: realtimeData,
    alerts: realtimeAlerts,
    insights: realtimeInsights,
    isLive,
    lastUpdated,
  } = useRealtimeLens('board');

  // Persist tasks via real backend lens artifacts (auto-seeds on first use)
  const {
    items: lensItems,
    isLoading: tasksLoading,
    isError,
    error,
    refetch,
    isSeeding,
    create: createLens,
    update: updateLens,
    remove: removeLens,
  } = useLensData<Record<string, unknown>>('board', 'task', {
    seed: SEED_TASKS,
  });

  const tasks: Task[] = useMemo(() => lensItems.map(lensItemToTask), [lensItems]);

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('board');
  const [activeProject, setActiveProject] = useState(projects[0]);
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const [dragOverColumn, setDragOverColumn] = useState<ColumnId | null>(null);
  const [quickAddInputs, setQuickAddInputs] = useState<Record<ColumnId, string>>(
    Object.fromEntries(columns.map((c) => [c.id, ''])) as Record<ColumnId, string>
  );

  // Filters
  const [filterAssignee, setFilterAssignee] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterLabel, setFilterLabel] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);

  // --- Board AI actions ---
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const runAction = useRunArtifact('board');

  const handleBoardAction = async (action: string) => {
    const targetId = lensItems[0]?.id;
    if (!targetId) return;
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) {
        setActionResult({
          message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}`,
        });
      } else {
        setActionResult(res.result as Record<string, unknown>);
      }
    } catch (e) {
      console.error(`Action ${action} failed:`, e);
      setActionResult({
        message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
      });
    }
    setIsRunning(null);
  };

  // --- Keyboard navigation state ---
  const [focusedCol, setFocusedCol] = useState(0);
  const [focusedCard, setFocusedCard] = useState(0);
  const boardRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // --- filtered tasks ---
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (filterAssignee !== 'all' && t.assignee !== filterAssignee) return false;
      if (filterPriority !== 'all' && t.priority !== filterPriority) return false;
      if (filterType !== 'all' && t.type !== filterType) return false;
      if (filterLabel !== 'all' && t.label !== filterLabel) return false;
      if (searchQuery && !t.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  }, [tasks, filterAssignee, filterPriority, filterType, filterLabel, searchQuery]);

  const getTasksByStatus = useCallback(
    (status: ColumnId) => filteredTasks.filter((t) => t.status === status),
    [filteredTasks]
  );

  // --- stats ---
  const stats = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return {
      total: tasks.length,
      inProgress: tasks.filter((t) => !['backlog', 'done'].includes(t.status)).length,
      overdue: tasks.filter((t) => isOverdue(t.dueDate) && t.status !== 'done').length,
      completedThisWeek: tasks.filter((t) => t.status === 'done' && new Date(t.dueDate) >= weekAgo)
        .length,
    };
  }, [tasks]);

  // --- drag and drop ---
  const handleDragStart = useCallback((e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('taskId', taskId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, colId: ColumnId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(colId);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverColumn(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetCol: ColumnId) => {
      e.preventDefault();
      const taskId = e.dataTransfer.getData('taskId');
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        const newProgress = targetCol === 'done' ? 100 : task.progress;
        updateLens(taskId, {
          data: {
            ...task,
            status: targetCol,
            progress: newProgress,
            id: undefined,
            title: undefined,
          } as unknown as Record<string, unknown>,
        });
      }
      setDragOverColumn(null);
    },
    [tasks, updateLens]
  );

  // --- quick add ---
  const handleQuickAdd = useCallback(
    (colId: ColumnId) => {
      const title = quickAddInputs[colId]?.trim();
      if (!title) return;
      createLens({
        title,
        data: {
          description: '',
          status: colId,
          priority: 'medium',
          type: 'task',
          assignee: assignees[0],
          label: labels[0],
          progress: 0,
          dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          attachments: 0,
          commentCount: 0,
          subtasks: [],
          comments: [],
          activity: [
            { id: generateId(), action: 'Task created', timestamp: new Date().toISOString() },
          ],
          files: [],
        } as unknown as Partial<Record<string, unknown>>,
      });
      setQuickAddInputs((prev) => ({ ...prev, [colId]: '' }));
    },
    [quickAddInputs, createLens]
  );

  // --- task detail updates (persisted via backend) ---
  const updateTask = useCallback(
    (taskId: string, patch: Partial<Task>) => {
      // Optimistically update the selected task panel
      setSelectedTask((prev) => (prev && prev.id === taskId ? { ...prev, ...patch } : prev));
      // Persist to backend
      const { id: _id, ...patchData } = patch as Record<string, unknown>;
      updateLens(taskId, { data: patchData as Record<string, unknown> });
    },
    [updateLens]
  );

  const toggleSubtask = useCallback(
    (taskId: string, subtaskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      const updatedSubs = task.subtasks.map((s) =>
        s.id === subtaskId ? { ...s, done: !s.done } : s
      );
      const doneCount = updatedSubs.filter((s) => s.done).length;
      const progress =
        updatedSubs.length > 0 ? Math.round((doneCount / updatedSubs.length) * 100) : task.progress;
      updateLens(taskId, {
        data: { subtasks: updatedSubs, progress } as unknown as Record<string, unknown>,
      });
      setSelectedTask((prev) => {
        if (!prev || prev.id !== taskId) return prev;
        return { ...prev, subtasks: updatedSubs, progress };
      });
    },
    [tasks, updateLens]
  );

  // --- Keyboard navigation handler for the board ---
  const handleBoardKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Only handle keyboard nav when not typing in an input/select
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      const colTasks = getTasksByStatus(columns[focusedCol].id);

      switch (e.key) {
        case 'ArrowRight': {
          e.preventDefault();
          const nextCol = Math.min(focusedCol + 1, columns.length - 1);
          setFocusedCol(nextCol);
          setFocusedCard(0);
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          const prevCol = Math.max(focusedCol - 1, 0);
          setFocusedCol(prevCol);
          setFocusedCard(0);
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          setFocusedCard((prev) => Math.min(prev + 1, colTasks.length - 1));
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          setFocusedCard((prev) => Math.max(prev - 1, 0));
          break;
        }
        case 'Enter': {
          e.preventDefault();
          if (colTasks.length > 0 && focusedCard < colTasks.length) {
            setSelectedTask(colTasks[focusedCard]);
          }
          break;
        }
        case 'Escape': {
          e.preventDefault();
          setSelectedTask(null);
          break;
        }
        default:
          break;
      }
    },
    [focusedCol, focusedCard, getTasksByStatus, setSelectedTask]
  );

  // Keep focused card in bounds when filtered tasks change
  useEffect(() => {
    const colTasks = getTasksByStatus(columns[focusedCol].id);
    if (focusedCard >= colTasks.length && colTasks.length > 0) {
      setFocusedCard(colTasks.length - 1);
    }
  }, [filteredTasks, focusedCol, focusedCard, getTasksByStatus]);

  // Scroll focused card into view
  useEffect(() => {
    const colTasks = getTasksByStatus(columns[focusedCol].id);
    if (colTasks.length > 0 && focusedCard < colTasks.length) {
      const key = `${columns[focusedCol].id}-${focusedCard}`;
      const el = cardRefs.current.get(key);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focusedCol, focusedCard, getTasksByStatus]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (tasksLoading || isSeeding) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">
            {isSeeding ? 'Setting up board data...' : 'Loading board...'}
          </p>
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
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        {/* Main content area */}
        <div
          className={cn(
            'flex-1 flex flex-col overflow-hidden transition-all',
            selectedTask ? 'mr-0' : ''
          )}
        >
          {/* Header */}
          <header className="flex-shrink-0 px-6 pt-5 pb-3 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Kanban className="w-6 h-6 text-purple-400" />
                  <h1 className="text-xl font-bold text-white">Project Board</h1>
                </div>

                {/* Real-time Enhancement Toolbar */}
                <div className="flex items-center gap-2 flex-wrap">
                  <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                  <DTUExportButton domain="board" data={realtimeData || {}} compact />
                  {realtimeAlerts.length > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                      {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                {/* Project selector */}
                <div className="relative">
                  <button
                    onClick={() => setProjectDropdownOpen(!projectDropdownOpen)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-sm text-gray-300 transition-colors"
                  >
                    {activeProject}
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  {projectDropdownOpen && (
                    <div className="absolute top-full left-0 mt-1 w-56 bg-gray-900 border border-white/10 rounded-lg shadow-xl z-50 py-1">
                      {projects.map((p) => (
                        <button
                          key={p}
                          onClick={() => {
                            setActiveProject(p);
                            setProjectDropdownOpen(false);
                          }}
                          className={cn(
                            'w-full text-left px-3 py-2 text-sm hover:bg-white/5 transition-colors',
                            p === activeProject ? 'text-purple-400' : 'text-gray-300'
                          )}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* View toggle */}
              <div className="flex items-center gap-1 p-1 bg-white/5 rounded-lg border border-white/10">
                {[
                  { mode: 'board' as ViewMode, icon: LayoutGrid, label: 'Board' },
                  { mode: 'timeline' as ViewMode, icon: BarChart3, label: 'Timeline' },
                  { mode: 'table' as ViewMode, icon: Table, label: 'Table' },
                ].map(({ mode, icon: Icon, label }) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                      viewMode === mode
                        ? 'bg-purple-500/20 text-purple-300 shadow-sm'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Stats bar */}
            <div className="flex gap-3">
              {[
                {
                  label: 'Total Tasks',
                  value: stats.total,
                  icon: LayoutGrid,
                  color: 'text-blue-400',
                },
                {
                  label: 'In Progress',
                  value: stats.inProgress,
                  icon: TrendingUp,
                  color: 'text-purple-400',
                },
                {
                  label: 'Overdue',
                  value: stats.overdue,
                  icon: AlertTriangle,
                  color: stats.overdue > 0 ? 'text-red-400' : 'text-gray-500',
                },
                {
                  label: 'Done This Week',
                  value: stats.completedThisWeek,
                  icon: CheckCircle2,
                  color: 'text-green-400',
                },
              ].map((s) => (
                <div
                  key={s.label}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]"
                >
                  <s.icon className={cn('w-4 h-4', s.color)} />
                  <span className="text-lg font-semibold text-white">{s.value}</span>
                  <span className="text-xs text-gray-500">{s.label}</span>
                </div>
              ))}
            </div>

            {/* Search + Filter bar */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search tasks..."
                  className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg bg-white/5 border border-white/10 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500/50"
                />
              </div>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors',
                  showFilters
                    ? 'bg-purple-500/20 border-purple-500/30 text-purple-300'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:text-gray-200'
                )}
              >
                <Filter className="w-3.5 h-3.5" />
                Filters
              </button>
            </div>

            {/* Expandable filters */}
            <AnimatePresence>
              {showFilters && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex gap-3 pb-1">
                    {/* Assignee filter */}
                    <select
                      value={filterAssignee}
                      onChange={(e) => setFilterAssignee(e.target.value)}
                      className="px-3 py-1.5 text-sm rounded-lg bg-white/5 border border-white/10 text-gray-300 focus:outline-none focus:border-purple-500/50"
                    >
                      <option value="all">All Assignees</option>
                      {assignees.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                    {/* Priority filter */}
                    <select
                      value={filterPriority}
                      onChange={(e) => setFilterPriority(e.target.value)}
                      className="px-3 py-1.5 text-sm rounded-lg bg-white/5 border border-white/10 text-gray-300 focus:outline-none focus:border-purple-500/50"
                    >
                      <option value="all">All Priorities</option>
                      {Object.entries(priorityConfig).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                    {/* Type filter */}
                    <select
                      value={filterType}
                      onChange={(e) => setFilterType(e.target.value)}
                      className="px-3 py-1.5 text-sm rounded-lg bg-white/5 border border-white/10 text-gray-300 focus:outline-none focus:border-purple-500/50"
                    >
                      <option value="all">All Types</option>
                      {Object.entries(typeConfig).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                    {/* Label filter */}
                    <select
                      value={filterLabel}
                      onChange={(e) => setFilterLabel(e.target.value)}
                      className="px-3 py-1.5 text-sm rounded-lg bg-white/5 border border-white/10 text-gray-300 focus:outline-none focus:border-purple-500/50"
                    >
                      <option value="all">All Labels</option>
                      {labels.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </header>

          {/* AI Actions */}
          <UniversalActions domain="board" artifactId={lensItems[0]?.id} compact />

          {/* Board AI Action Panel */}
          <div className="flex-shrink-0 px-6 pb-3 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Workflow Analysis */}
              <button
                onClick={() => handleBoardAction('workflowAnalysis')}
                disabled={!lensItems[0] || isRunning !== null}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-medium hover:bg-cyan-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRunning === 'workflowAnalysis' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Activity className="w-3.5 h-3.5" />
                )}
                Workflow Analysis
              </button>

              {/* Card Prioritization */}
              <button
                onClick={() => handleBoardAction('cardPrioritization')}
                disabled={!lensItems[0] || isRunning !== null}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/30 text-purple-300 text-xs font-medium hover:bg-purple-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRunning === 'cardPrioritization' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ListTodo className="w-3.5 h-3.5" />
                )}
                Card Prioritization
              </button>

              {/* Burndown Forecast */}
              <button
                onClick={() => handleBoardAction('burndownForecast')}
                disabled={!lensItems[0] || isRunning !== null}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/30 text-green-300 text-xs font-medium hover:bg-green-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRunning === 'burndownForecast' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <BarChart3 className="w-3.5 h-3.5" />
                )}
                Burndown Forecast
              </button>
            </div>

            {/* Action result panel */}
            {actionResult && (
              <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Zap className="w-4 h-4 text-purple-400" />
                    {actionResult.cycleTime !== undefined
                      ? 'Workflow Analysis'
                      : actionResult.rankedCards !== undefined
                        ? 'Card Prioritization'
                        : actionResult.forecast !== undefined
                          ? 'Burndown Forecast'
                          : 'Action Result'}
                  </h3>
                  <button
                    onClick={() => setActionResult(null)}
                    className="p-1 rounded-md hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>

                {/* Message-only results */}
                {!!actionResult.message &&
                  !actionResult.cycleTime &&
                  !actionResult.rankedCards &&
                  !actionResult.forecast && (
                    <p className="text-sm text-gray-400">{actionResult.message as string}</p>
                  )}

                {/* ---- Workflow Analysis ---- */}
                {actionResult.cycleTime !== undefined && (
                  <div className="space-y-3">
                    {actionResult.message ? (
                      <p className="text-sm text-gray-400">{actionResult.message as string}</p>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <div className="text-center p-2.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
                            <p className="text-[10px] text-gray-500 mb-1">Avg Cycle Time</p>
                            <p className="text-base font-bold text-cyan-300">
                              {(
                                ((actionResult.cycleTime as Record<string, unknown>)
                                  ?.mean as number) || 0
                              ).toFixed(1)}
                              d
                            </p>
                          </div>
                          <div className="text-center p-2.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
                            <p className="text-[10px] text-gray-500 mb-1">Avg Lead Time</p>
                            <p className="text-base font-bold text-blue-300">
                              {(
                                ((actionResult.leadTime as Record<string, unknown>)
                                  ?.mean as number) || 0
                              ).toFixed(1)}
                              d
                            </p>
                          </div>
                          <div className="text-center p-2.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
                            <p className="text-[10px] text-gray-500 mb-1">Weekly Throughput</p>
                            <p className="text-base font-bold text-green-300">
                              {(
                                ((actionResult.throughput as Record<string, unknown>)
                                  ?.weeklyAvg as number) || 0
                              ).toFixed(1)}
                              /wk
                            </p>
                          </div>
                          <div className="text-center p-2.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
                            <p className="text-[10px] text-gray-500 mb-1">Flow Efficiency</p>
                            <p className="text-base font-bold text-purple-300">
                              {actionResult.flowEfficiency != null
                                ? `${actionResult.flowEfficiency as number}%`
                                : '—'}
                            </p>
                          </div>
                        </div>
                        {!!actionResult.bottleneck && (
                          <div className="flex items-center gap-2 text-xs text-gray-400 bg-orange-500/10 border border-orange-500/20 rounded-lg px-3 py-2">
                            <AlertTriangle className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
                            <span>
                              Bottleneck detected in{' '}
                              <span className="text-orange-300 font-semibold">
                                {actionResult.bottleneck as string}
                              </span>
                            </span>
                          </div>
                        )}
                        {Array.isArray(
                          (actionResult.wip as Record<string, unknown>)?.overLimitColumns
                        ) &&
                          (
                            (actionResult.wip as Record<string, unknown>)
                              ?.overLimitColumns as Array<Record<string, unknown>>
                          ).length > 0 && (
                            <div className="text-xs text-gray-400">
                              <span className="text-red-400 font-medium">WIP over limit: </span>
                              {(
                                (actionResult.wip as Record<string, unknown>)
                                  .overLimitColumns as Array<Record<string, unknown>>
                              )
                                .map((c) => `${c.column} (${c.wip}/${c.limit})`)
                                .join(', ')}
                            </div>
                          )}
                      </>
                    )}
                  </div>
                )}

                {/* ---- Card Prioritization ---- */}
                {actionResult.rankedCards !== undefined && (
                  <div className="space-y-3">
                    {actionResult.message ? (
                      <p className="text-sm text-gray-400">{actionResult.message as string}</p>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {(['critical', 'high', 'medium', 'low'] as const).map((tier) => {
                            const tierColors: Record<string, string> = {
                              critical: 'text-red-400 border-red-500/20 bg-red-500/10',
                              high: 'text-orange-400 border-orange-500/20 bg-orange-500/10',
                              medium: 'text-blue-400 border-blue-500/20 bg-blue-500/10',
                              low: 'text-gray-400 border-white/10 bg-white/[0.04]',
                            };
                            const tierData =
                              (actionResult.tiers as Record<string, string[]>)?.[tier] || [];
                            return (
                              <div
                                key={tier}
                                className={`text-center p-2.5 rounded-lg border ${tierColors[tier]}`}
                              >
                                <p className="text-[10px] capitalize mb-1 opacity-80">{tier}</p>
                                <p className="text-base font-bold">{tierData.length}</p>
                              </div>
                            );
                          })}
                        </div>
                        {Array.isArray(actionResult.rankedCards) &&
                          (actionResult.rankedCards as Array<Record<string, unknown>>)
                            .slice(0, 5)
                            .map((card) => (
                              <div
                                key={card.id as string}
                                className="flex items-center gap-3 text-xs text-gray-300 bg-white/[0.03] rounded-lg px-3 py-2 border border-white/[0.06]"
                              >
                                <span className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-300 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                                  {card.rank as number}
                                </span>
                                <span className="flex-1 truncate">{card.title as string}</span>
                                <span className="text-purple-400 font-medium flex-shrink-0">
                                  WSJF {(card.wsjfScore as number).toFixed(1)}
                                </span>
                              </div>
                            ))}
                        <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                          {(
                            ['quick-wins', 'major-projects', 'fill-ins', 'thankless-tasks'] as const
                          ).map((q) => {
                            const qColors: Record<string, string> = {
                              'quick-wins': 'text-green-400',
                              'major-projects': 'text-blue-400',
                              'fill-ins': 'text-yellow-400',
                              'thankless-tasks': 'text-gray-500',
                            };
                            const count = (
                              (actionResult.quadrants as Record<string, unknown[]>)?.[q] || []
                            ).length;
                            return (
                              <span key={q} className={qColors[q]}>
                                {q.replace(/-/g, ' ')}: {count}
                              </span>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* ---- Burndown Forecast ---- */}
                {actionResult.forecast !== undefined && (
                  <div className="space-y-3">
                    {actionResult.message ? (
                      <p className="text-sm text-gray-400">{actionResult.message as string}</p>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <div className="text-center p-2.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
                            <p className="text-[10px] text-gray-500 mb-1">Remaining Pts</p>
                            <p className="text-base font-bold text-white">
                              {actionResult.remainingPoints as number}
                            </p>
                          </div>
                          <div className="text-center p-2.5 rounded-lg bg-green-500/10 border border-green-500/20">
                            <p className="text-[10px] text-gray-500 mb-1">Likely Date</p>
                            <p className="text-sm font-bold text-green-300">
                              {((actionResult.forecast as Record<string, unknown>)
                                ?.mostLikelyDate as string) || '—'}
                            </p>
                          </div>
                          <div className="text-center p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
                            <p className="text-[10px] text-gray-500 mb-1">Avg Velocity</p>
                            <p className="text-base font-bold text-blue-300">
                              {(
                                ((actionResult.velocityStats as Record<string, unknown>)
                                  ?.mean as number) || 0
                              ).toFixed(1)}{' '}
                              pts
                            </p>
                          </div>
                          <div className="text-center p-2.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
                            <p className="text-[10px] text-gray-500 mb-1">Simulations</p>
                            <p className="text-base font-bold text-purple-300">
                              {actionResult.simulations as number}
                            </p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-center">
                          {[
                            {
                              label: 'Optimistic (p25)',
                              key: 'optimistic',
                              color: 'text-green-400',
                            },
                            { label: 'Likely (p50)', key: 'likely', color: 'text-cyan-400' },
                            {
                              label: 'Conservative (p85)',
                              key: 'conservative',
                              color: 'text-orange-400',
                            },
                            { label: 'Worst Case (p95)', key: 'worstCase', color: 'text-red-400' },
                          ].map(({ label, key, color }) => (
                            <div
                              key={key}
                              className="bg-white/[0.03] rounded-lg px-2 py-2 border border-white/[0.06]"
                            >
                              <p className="text-[10px] text-gray-500 mb-0.5">{label}</p>
                              <p className={`font-semibold ${color}`}>
                                {(
                                  (actionResult.forecast as Record<string, unknown>)
                                    ?.confidenceRange as Record<string, string>
                                )?.[key] || '—'}
                              </p>
                            </div>
                          ))}
                        </div>
                        {Array.isArray(actionResult.burndownProjection) &&
                          (actionResult.burndownProjection as Array<Record<string, unknown>>)
                            .length > 0 && (
                            <div>
                              <p className="text-[10px] text-gray-500 uppercase font-semibold mb-1.5">
                                Sprint Projection
                              </p>
                              <div className="space-y-1">
                                {(actionResult.burndownProjection as Array<Record<string, unknown>>)
                                  .slice(0, 6)
                                  .map((sprint) => {
                                    const remaining = sprint.projectedRemaining as number;
                                    const total = actionResult.remainingPoints as number;
                                    const pct =
                                      total > 0
                                        ? Math.round(((total - remaining) / total) * 100)
                                        : 100;
                                    return (
                                      <div
                                        key={sprint.sprint as number}
                                        className="flex items-center gap-2 text-xs text-gray-400"
                                      >
                                        <span className="w-14 flex-shrink-0 text-gray-500">
                                          Sprint {sprint.sprint as number}
                                        </span>
                                        <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                                          <div
                                            className="h-full rounded-full bg-gradient-to-r from-purple-500 to-green-500 transition-all"
                                            style={{ width: `${pct}%` }}
                                          />
                                        </div>
                                        <span className="w-20 text-right flex-shrink-0">
                                          {remaining} pts left
                                        </span>
                                      </div>
                                    );
                                  })}
                              </div>
                            </div>
                          )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Board columns */}
          <div className="flex-1 overflow-x-auto px-6 pb-6">
            <div
              ref={boardRef}
              className="flex gap-4 h-full min-w-max"
              role="grid"
              aria-label="Project board"
              tabIndex={0}
              onKeyDown={handleBoardKeyDown}
            >
              {columns.map((column) => {
                const colTasks = getTasksByStatus(column.id);
                const ColIcon = column.icon;
                const isOver = dragOverColumn === column.id;
                const colIndex = columns.indexOf(column);
                return (
                  <div
                    key={column.id}
                    role="group"
                    aria-label={`${column.name} column, ${colTasks.length} tasks`}
                    className={cn(
                      'flex flex-col w-64 sm:w-72 flex-shrink-0 rounded-xl border transition-all',
                      isOver
                        ? `${column.border} ${column.bg}`
                        : 'border-white/[0.06] bg-white/[0.02]',
                      focusedCol === colIndex && 'ring-1 ring-purple-500/40'
                    )}
                    onDragOver={(e) => handleDragOver(e, column.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, column.id)}
                  >
                    {/* Column header */}
                    <div className="flex items-center justify-between px-3 py-3 border-b border-white/[0.06]">
                      <div className="flex items-center gap-2">
                        <div className={cn('p-1 rounded-md', column.bg)}>
                          <ColIcon className={cn('w-3.5 h-3.5', column.color)} />
                        </div>
                        <span className={cn('text-sm font-semibold', column.color)}>
                          {column.name}
                        </span>
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-white/5 text-gray-500">
                          {colTasks.length}
                        </span>
                      </div>
                    </div>

                    {/* Quick add */}
                    <div className="px-3 pt-2 pb-1">
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          data-col-input={column.id}
                          value={quickAddInputs[column.id]}
                          onChange={(e) =>
                            setQuickAddInputs((prev) => ({ ...prev, [column.id]: e.target.value }))
                          }
                          onKeyDown={(e) => e.key === 'Enter' && handleQuickAdd(column.id)}
                          placeholder="Add task..."
                          className="flex-1 px-2 py-1 text-xs rounded-md bg-white/5 border border-white/10 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/40"
                        />
                        <button
                          onClick={() => handleQuickAdd(column.id)}
                          className={cn(
                            'p-1 rounded-md transition-colors',
                            column.bg,
                            'hover:opacity-80'
                          )}
                        >
                          <Plus className={cn('w-3.5 h-3.5', column.color)} />
                        </button>
                      </div>
                    </div>

                    {/* Tasks */}
                    <div
                      className="flex-1 overflow-y-auto px-3 py-2 space-y-2"
                      role="list"
                      aria-label={`${column.name} tasks`}
                    >
                      {colTasks.map((task, cardIndex) => {
                        const isFocused = focusedCol === colIndex && focusedCard === cardIndex;
                        return (
                          <motion.div
                            key={task.id}
                            ref={(el) => {
                              if (el) cardRefs.current.set(`${column.id}-${cardIndex}`, el);
                            }}
                            layout
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            role="listitem"
                            aria-label={`${task.title}, ${priorityConfig[task.priority].label} priority, ${task.progress}% complete`}
                            tabIndex={isFocused ? 0 : -1}
                            className={cn(
                              'group rounded-lg bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.15] p-3 cursor-grab active:cursor-grabbing transition-colors',
                              isFocused && 'ring-2 ring-purple-500 border-purple-500/50'
                            )}
                            draggable
                            onDragStart={(e) =>
                              handleDragStart(e as unknown as React.DragEvent, task.id)
                            }
                            onClick={() => setSelectedTask(task)}
                            onFocus={() => {
                              setFocusedCol(colIndex);
                              setFocusedCard(cardIndex);
                            }}
                          >
                            {/* Top row: priority dot + title */}
                            <div className="flex items-start gap-2">
                              <GripVertical className="w-3.5 h-3.5 text-gray-600 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-200 truncate">
                                  {task.title}
                                </p>

                                {/* Badges row */}
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                  <span
                                    className={cn(
                                      'text-[10px] px-1.5 py-0.5 rounded-full border',
                                      priorityConfig[task.priority].color
                                    )}
                                  >
                                    {priorityConfig[task.priority].label}
                                  </span>
                                  <span
                                    className={cn(
                                      'text-[10px] px-1.5 py-0.5 rounded-full',
                                      typeConfig[task.type].color
                                    )}
                                  >
                                    {typeConfig[task.type].label}
                                  </span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-gray-400">
                                    {task.label}
                                  </span>
                                </div>

                                {/* Estimate / Tag for tasks */}
                                {(task.estimate || task.tags?.[0]) && (
                                  <div className="flex gap-2 mt-1.5">
                                    {task.estimate && (
                                      <span className="text-[10px] text-gray-500 flex items-center gap-0.5">
                                        <Clock className="w-3 h-3" />
                                        {task.estimate} Est.
                                      </span>
                                    )}
                                    {task.tags?.[0] && (
                                      <span className="text-[10px] text-gray-500 flex items-center gap-0.5">
                                        <Tag className="w-3 h-3" />
                                        Tag: {task.tags[0]}
                                      </span>
                                    )}
                                  </div>
                                )}

                                {/* Progress bar */}
                                <div className="mt-2">
                                  <div className="flex items-center justify-between mb-0.5">
                                    <span className="text-[10px] text-gray-500">
                                      {task.progress}%
                                    </span>
                                  </div>
                                  <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                                    <div
                                      className={cn(
                                        'h-full rounded-full transition-all',
                                        task.progress === 100
                                          ? 'bg-green-500'
                                          : task.progress > 60
                                            ? 'bg-purple-500'
                                            : 'bg-blue-500'
                                      )}
                                      style={{ width: `${task.progress}%` }}
                                    />
                                  </div>
                                </div>

                                {/* Footer: date, attachments, comments, avatar */}
                                <div className="flex items-center justify-between mt-2">
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={cn(
                                        'text-[10px] flex items-center gap-0.5',
                                        isOverdue(task.dueDate) && task.status !== 'done'
                                          ? 'text-red-400 font-medium'
                                          : 'text-gray-500'
                                      )}
                                    >
                                      <Calendar className="w-3 h-3" />
                                      {formatDate(task.dueDate)}
                                    </span>
                                    {task.attachments > 0 && (
                                      <span className="text-[10px] text-gray-500 flex items-center gap-0.5">
                                        <Paperclip className="w-3 h-3" />
                                        {task.attachments}
                                      </span>
                                    )}
                                    {task.commentCount > 0 && (
                                      <span className="text-[10px] text-gray-500 flex items-center gap-0.5">
                                        <MessageSquare className="w-3 h-3" />
                                        {task.commentCount}
                                      </span>
                                    )}
                                  </div>
                                  {/* Avatar */}
                                  <div
                                    className={cn(
                                      'w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white',
                                      avatarColor(task.assignee)
                                    )}
                                    title={task.assignee}
                                  >
                                    {task.assignee[0]}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}

                      {/* Empty state for drop zone */}
                      {colTasks.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-8 text-gray-600">
                          <ColIcon className="w-8 h-8 mb-2 opacity-30" />
                          <p className="text-xs mb-2">Drop tasks here</p>
                          <button
                            onClick={() => {
                              const input = document.querySelector<HTMLInputElement>(
                                `[data-col-input="${column.id}"]`
                              );
                              input?.focus();
                            }}
                            className="text-xs text-gray-500 hover:text-neon-cyan flex items-center gap-1 transition-colors"
                          >
                            <Plus className="w-3 h-3" /> Add task
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Task detail side panel */}
        <AnimatePresence>
          {selectedTask && (
            <motion.aside
              key="detail-panel"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 400, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="flex-shrink-0 border-l border-white/[0.08] bg-gray-950/80 backdrop-blur-sm overflow-y-auto"
            >
              <TaskDetailPanel
                task={selectedTask}
                onClose={() => setSelectedTask(null)}
                onUpdate={updateTask}
                onToggleSubtask={toggleSubtask}
                onDelete={(id) => {
                  removeLens(id);
                  setSelectedTask(null);
                }}
              />
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      <RealtimeDataPanel data={realtimeInsights} />

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
          <ChevronDown
            className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`}
          />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="board" />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task detail panel sub-component
// ---------------------------------------------------------------------------

function TaskDetailPanel({
  task,
  onClose,
  onUpdate,
  onToggleSubtask,
  onDelete,
}: {
  task: Task;
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<Task>) => void;
  onToggleSubtask: (taskId: string, subtaskId: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [newSubtask, setNewSubtask] = useState('');
  const [newComment, setNewComment] = useState('');
  const [activeTab, setActiveTab] = useState<'details' | 'activity' | 'files'>('details');

  const col = columns.find((c) => c.id === task.status);

  return (
    <div data-lens-theme="board" className="p-5 space-y-5 min-h-full">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                onUpdate(task.id, { title: titleDraft });
                setEditingTitle(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onUpdate(task.id, { title: titleDraft });
                  setEditingTitle(false);
                }
              }}
              className="w-full text-lg font-bold bg-transparent border-b border-purple-500/50 text-white focus:outline-none pb-0.5"
            />
          ) : (
            <h2
              className="text-lg font-bold text-white cursor-pointer hover:text-purple-300 transition-colors"
              onClick={() => setEditingTitle(true)}
            >
              {task.title}
            </h2>
          )}
          {col && (
            <div className="flex items-center gap-1.5 mt-1">
              <div className={cn('w-2 h-2 rounded-full', col.color.replace('text-', 'bg-'))} />
              <span className={cn('text-xs', col.color)}>{col.name}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onDelete(task.id)}
            className="p-1 rounded-md hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors"
            title="Delete task"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-gray-400 leading-relaxed">
        {task.description || 'No description.'}
      </p>

      {/* Meta grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Assignee */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-gray-600">Assignee</label>
          <select
            value={task.assignee}
            onChange={(e) => onUpdate(task.id, { assignee: e.target.value })}
            className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded-md text-gray-300 focus:outline-none focus:border-purple-500/50"
          >
            {assignees.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        {/* Priority */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-gray-600">Priority</label>
          <select
            value={task.priority}
            onChange={(e) => onUpdate(task.id, { priority: e.target.value as Priority })}
            className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded-md text-gray-300 focus:outline-none focus:border-purple-500/50"
          >
            {Object.entries(priorityConfig).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        {/* Type */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-gray-600">Type</label>
          <select
            value={task.type}
            onChange={(e) => onUpdate(task.id, { type: e.target.value as TaskType })}
            className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded-md text-gray-300 focus:outline-none focus:border-purple-500/50"
          >
            {Object.entries(typeConfig).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        {/* Label */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-gray-600">Label</label>
          <select
            value={task.label}
            onChange={(e) => onUpdate(task.id, { label: e.target.value })}
            className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded-md text-gray-300 focus:outline-none focus:border-purple-500/50"
          >
            {labels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        {/* Due date */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-gray-600">Due Date</label>
          <input
            type="date"
            value={task.dueDate}
            onChange={(e) => onUpdate(task.id, { dueDate: e.target.value })}
            className={cn(
              'w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded-md focus:outline-none focus:border-purple-500/50',
              isOverdue(task.dueDate) && task.status !== 'done' ? 'text-red-400' : 'text-gray-300'
            )}
          />
        </div>

        {/* Estimate */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-gray-600">Estimate</label>
          <input
            type="text"
            value={task.estimate ?? ''}
            onChange={(e) => onUpdate(task.id, { estimate: e.target.value || undefined })}
            placeholder="e.g. 2h, 1d"
            className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded-md text-gray-300 focus:outline-none focus:border-purple-500/50"
          />
        </div>
      </div>

      {/* Progress */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[10px] uppercase tracking-wider text-gray-600">Progress</label>
          <span className="text-xs text-gray-400">{task.progress}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={task.progress}
          onChange={(e) => onUpdate(task.id, { progress: parseInt(e.target.value) })}
          className="w-full h-1.5 rounded-full appearance-none bg-white/10 accent-purple-500"
        />
      </div>

      {/* Tab switcher */}
      <div className="flex border-b border-white/[0.08]">
        {(['details', 'activity', 'files'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-3 py-2 text-xs font-medium capitalize border-b-2 transition-colors -mb-px',
              activeTab === tab
                ? 'border-purple-500 text-purple-300'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'details' && (
        <div className="space-y-4">
          {/* Subtasks */}
          <div>
            <h4 className="text-xs font-semibold text-gray-400 mb-2 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Subtasks ({task.subtasks.filter((s) => s.done).length}/{task.subtasks.length})
            </h4>
            <div className="space-y-1">
              {task.subtasks.map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => onToggleSubtask(task.id, sub.id)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-white/5 text-left transition-colors"
                >
                  {sub.done ? (
                    <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                  ) : (
                    <Circle className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
                  )}
                  <span
                    className={cn(
                      'text-sm',
                      sub.done ? 'text-gray-500 line-through' : 'text-gray-300'
                    )}
                  >
                    {sub.title}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex gap-1.5 mt-2">
              <input
                type="text"
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newSubtask.trim()) {
                    const updated = [
                      ...task.subtasks,
                      { id: generateId(), title: newSubtask.trim(), done: false },
                    ];
                    onUpdate(task.id, { subtasks: updated });
                    setNewSubtask('');
                  }
                }}
                placeholder="Add subtask..."
                className="flex-1 px-2 py-1 text-xs bg-white/5 border border-white/10 rounded-md text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/40"
              />
              <button
                onClick={() => {
                  if (newSubtask.trim()) {
                    const updated = [
                      ...task.subtasks,
                      { id: generateId(), title: newSubtask.trim(), done: false },
                    ];
                    onUpdate(task.id, { subtasks: updated });
                    setNewSubtask('');
                  }
                }}
                className="p-1 rounded-md bg-white/5 hover:bg-white/10 text-gray-400"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Comments */}
          <div>
            <h4 className="text-xs font-semibold text-gray-400 mb-2 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5" />
              Comments ({task.comments.length})
            </h4>
            <div className="space-y-2">
              {task.comments.map((c) => (
                <div
                  key={c.id}
                  className="p-2 rounded-md bg-white/[0.03] border border-white/[0.06]"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className={cn(
                        'w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white',
                        avatarColor(c.author)
                      )}
                    >
                      {c.author[0]}
                    </div>
                    <span className="text-xs font-medium text-gray-300">{c.author}</span>
                    <span className="text-[10px] text-gray-600">{formatDate(c.timestamp)}</span>
                  </div>
                  <p className="text-xs text-gray-400 pl-6">{c.text}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5 mt-2">
              <input
                type="text"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newComment.trim()) {
                    const updated: Comment[] = [
                      ...task.comments,
                      {
                        id: generateId(),
                        author: 'You',
                        text: newComment.trim(),
                        timestamp: new Date().toISOString(),
                      },
                    ];
                    onUpdate(task.id, { comments: updated, commentCount: updated.length });
                    setNewComment('');
                  }
                }}
                placeholder="Add comment..."
                className="flex-1 px-2 py-1 text-xs bg-white/5 border border-white/10 rounded-md text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/40"
              />
              <button
                onClick={() => {
                  if (newComment.trim()) {
                    const updated: Comment[] = [
                      ...task.comments,
                      {
                        id: generateId(),
                        author: 'You',
                        text: newComment.trim(),
                        timestamp: new Date().toISOString(),
                      },
                    ];
                    onUpdate(task.id, { comments: updated, commentCount: updated.length });
                    setNewComment('');
                  }
                }}
                className="p-1 rounded-md bg-purple-500/20 hover:bg-purple-500/30 text-purple-300"
              >
                <MessageSquare className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'activity' && (
        <div className="space-y-2">
          {task.activity.length === 0 && (
            <p className="text-xs text-gray-600 text-center py-4">No activity yet.</p>
          )}
          {task.activity.map((a) => (
            <div key={a.id} className="flex items-start gap-2 text-xs">
              <Clock className="w-3.5 h-3.5 text-gray-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-gray-400">{a.action}</p>
                <p className="text-gray-600 text-[10px]">{formatDate(a.timestamp)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'files' && (
        <div className="space-y-2">
          {task.files.length === 0 && (
            <p className="text-xs text-gray-600 text-center py-4">No files attached.</p>
          )}
          {task.files.map((file, i) => (
            <div
              key={i}
              className="flex items-center gap-2 p-2 rounded-md bg-white/[0.03] border border-white/[0.06]"
            >
              <FileText className="w-4 h-4 text-gray-500 flex-shrink-0" />
              <span className="text-xs text-gray-300 truncate flex-1">{file}</span>
              <Paperclip className="w-3 h-3 text-gray-600 flex-shrink-0" />
            </div>
          ))}
          <button
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.click();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 w-full rounded-md border border-dashed border-white/10 text-xs text-gray-500 hover:text-gray-300 hover:border-white/20 transition-colors justify-center"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload file
          </button>
        </div>
      )}
    </div>
  );
}
