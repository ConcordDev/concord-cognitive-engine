/**
 * Shared types/helpers for the board (personal-task) lens surface.
 * Trello-shape kanban columns + analytics param builders.
 */
import type { LucideIcon } from 'lucide-react';
import {
  Lightbulb,
  ListTodo,
  SlidersHorizontal,
  CheckCircle,
  Rocket,
  Activity,
} from 'lucide-react';
import type { LensItem } from '@/lib/hooks/use-lens-data';

export type ColumnId = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'testing' | 'done';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskType = 'task' | 'feature' | 'bug' | 'design' | 'research' | 'docs';
export type BoardView = 'board' | 'timeline' | 'table' | 'workspace' | 'bgg';
export type TaskView = 'board' | 'timeline' | 'table';

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Comment {
  id: string;
  author: string;
  text: string;
  timestamp: string;
}

export interface ActivityEntry {
  id: string;
  action: string;
  timestamp: string;
}

export interface Task {
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

export const columns: {
  id: ColumnId;
  name: string;
  icon: LucideIcon;
  color: string;
  bg: string;
  border: string;
}[] = [
  { id: 'backlog', name: 'Backlog', icon: Lightbulb, color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
  { id: 'todo', name: 'To Do', icon: ListTodo, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
  { id: 'in_progress', name: 'In Progress', icon: Activity, color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/30' },
  { id: 'in_review', name: 'In Review', icon: SlidersHorizontal, color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30' },
  { id: 'testing', name: 'Testing', icon: CheckCircle, color: 'text-pink-400', bg: 'bg-pink-500/10', border: 'border-pink-500/30' },
  { id: 'done', name: 'Done', icon: Rocket, color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/30' },
];

export const priorityConfig: Record<Priority, { label: string; color: string; dot: string }> = {
  low: { label: 'Low', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30', dot: 'bg-gray-400' },
  medium: { label: 'Med', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', dot: 'bg-blue-400' },
  high: { label: 'High', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30', dot: 'bg-orange-400' },
  urgent: { label: 'Urgent', color: 'bg-red-500/20 text-red-400 border-red-500/30', dot: 'bg-red-400' },
};

export const typeConfig: Record<TaskType, { label: string; color: string }> = {
  task: { label: 'Task', color: 'bg-violet-500/20 text-violet-300' },
  feature: { label: 'Feature', color: 'bg-rose-500/20 text-rose-300' },
  bug: { label: 'Bug', color: 'bg-red-500/20 text-red-300' },
  design: { label: 'Design', color: 'bg-teal-500/20 text-teal-300' },
  research: { label: 'Research', color: 'bg-indigo-500/20 text-indigo-300' },
  docs: { label: 'Docs', color: 'bg-fuchsia-500/20 text-fuchsia-300' },
};

export const labels = [
  'Frontend', 'Backend', 'Design', 'DevOps', 'Research',
  'Marketing', 'Operations', 'Support', 'Strategy',
];
export const assignees = ['Alex', 'Jordan', 'Maya', 'Rio', 'Sam'];
export const projects: string[] = [];

/** Empty seed — tasks come from live lens artifacts (no fabricated rows). */
export const TASKS_FALLBACK: { title: string; data: Record<string, unknown> }[] = [];

export function lensItemToTask(item: LensItem<Record<string, unknown>>): Task {
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

export function isOverdue(dateStr: string): boolean {
  return (
    new Date(dateStr) < new Date() && new Date(dateStr).toDateString() !== new Date().toDateString()
  );
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function avatarColor(name: string): string {
  const colors = [
    'bg-blue-500', 'bg-green-500', 'bg-purple-500',
    'bg-pink-500', 'bg-amber-500', 'bg-cyan-500',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

const PRIORITY_VALUE: Record<Priority, number> = { urgent: 10, high: 8, medium: 5, low: 3 };

/** Map live kanban tasks onto calculator macro shapes — derived only, no fabrications. */
export function buildBoardActionParams(
  action: string,
  tasks: Task[],
): Record<string, unknown> {
  if (action === 'workflowAnalysis') {
    return {
      columns: columns.map((c) => ({ name: c.name })),
      cards: tasks.map((t) => {
        const col = columns.find((c) => c.id === t.status);
        const created =
          t.activity[t.activity.length - 1]?.timestamp || t.dueDate || new Date().toISOString();
        return {
          id: t.id,
          title: t.title,
          column: col?.name ?? t.status,
          createdAt: created,
          completedAt: t.status === 'done' ? t.dueDate || created : undefined,
        };
      }),
    };
  }
  if (action === 'cardPrioritization') {
    return {
      cards: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        businessValue: PRIORITY_VALUE[t.priority],
        timeCriticality: Math.max(1, Math.round((100 - t.progress) / 10)),
        riskReduction: t.type === 'bug' ? 8 : 5,
        effort: t.estimate && /^\d/.test(t.estimate) ? Math.max(1, parseInt(t.estimate, 10)) : 5,
        deadline: t.dueDate || undefined,
      })),
    };
  }
  if (action === 'burndownForecast') {
    const doneByWeek = new Map<string, number>();
    for (const t of tasks) {
      if (t.status !== 'done' || !t.dueDate) continue;
      const d = new Date(t.dueDate);
      if (Number.isNaN(d.getTime())) continue;
      const wk = `${d.getUTCFullYear()}-${Math.floor(d.getTime() / (7 * 86400000))}`;
      doneByWeek.set(wk, (doneByWeek.get(wk) || 0) + PRIORITY_VALUE[t.priority]);
    }
    const sprints = Array.from(doneByWeek.entries()).map(([id, completedPoints], i) => ({
      id,
      completedPoints,
      plannedPoints: completedPoints,
      startDate: '',
      endDate: '',
      index: i,
    }));
    const remainingPoints = tasks
      .filter((t) => t.status !== 'done')
      .reduce((s, t) => s + Math.max(1, Math.round(((100 - t.progress) / 100) * PRIORITY_VALUE[t.priority])), 0);
    return { sprints, remainingPoints };
  }
  return {};
}
