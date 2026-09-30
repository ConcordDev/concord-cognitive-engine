'use client';

/**
 * Shared types/constants for home-improvement panels.
 * Mirrors server/domains/homeimprovement.js — extract, don't invent.
 */

export const DOMAIN = 'home-improvement';

export interface HiTask { id: string; label: string; done: boolean }
export interface HiExpense { id: string; label: string; amount: number; kind: 'materials' | 'labor' | 'permit' | 'tools' | 'other'; date: string }
export interface HiProject {
  id: string;
  name: string;
  room: string;
  budget: number;
  status: 'planning' | 'in_progress' | 'on_hold' | 'complete';
  notes: string;
  tasks: HiTask[];
  expenses: HiExpense[];
  createdAt: string;
  taskCount: number;
  tasksDone: number;
  spent: number;
  budgetRemaining: number;
}
export interface HiDashboard {
  projects: number; activeProjects: number;
  totalBudget: number; totalSpent: number;
  tasks: number; tasksDone: number;
}
export interface ProjectEstimateResult {
  projectType: string;
  squareFootage: number;
  materialsCost: number;
  laborCost: number;
  permits: number;
  total: number;
  diyEstimate: number;
  contractorEstimate: number;
  savings: number;
  timeline: string;
}
export interface RoiResult {
  projects: { project: string; cost: number; valueAdded: number; roi: number; netGain: number; worthIt: boolean }[];
  bestROI: string;
  worstROI: string;
  totalInvested: number;
  totalValueAdded: number;
  avgROI: number;
  message?: string;
}
export interface PermitResult {
  projectType: string;
  requiresPermit: boolean;
  permitType: string;
  estimatedCost: number;
  processingTime: string;
  inspectionsRequired: string[];
  tip: string;
}
export interface ColorPaletteResult {
  room: string;
  style: string;
  palette: string;
  wallColor: string;
  trim: string;
  accent: string;
  furniture: string;
  decor: string;
  coverage: string;
}

export const ROOM_OPTIONS = [
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'bathroom', label: 'Bathroom' },
  { value: 'bedroom', label: 'Bedroom' },
  { value: 'living_room', label: 'Living Room' },
  { value: 'basement', label: 'Basement' },
  { value: 'garage', label: 'Garage' },
  { value: 'exterior', label: 'Exterior' },
  { value: 'whole_house', label: 'Whole House' },
  { value: 'other', label: 'Other' },
];
export const roomLabel = (room: string) => ROOM_OPTIONS.find(r => r.value === room)?.label
  || room.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export const STATUS_OPTIONS: { value: HiProject['status']; label: string }[] = [
  { value: 'planning', label: 'Planning' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'complete', label: 'Complete' },
];
export const STATUS_COLORS: Record<string, string> = {
  planning: 'text-yellow-400 bg-amber-500/10',
  in_progress: 'text-neon-cyan bg-neon-cyan/10',
  on_hold: 'text-orange-400 bg-orange-400/10',
  complete: 'text-neon-green bg-neon-green/10',
};
export const statusLabel = (s: string) => STATUS_OPTIONS.find(o => o.value === s)?.label || s;

export const EXPENSE_KINDS: HiExpense['kind'][] = ['materials', 'labor', 'permit', 'tools', 'other'];

export const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.35, ease: 'easeOut' as const } }),
  exit: { opacity: 0, scale: 0.95, transition: { duration: 0.2 } },
};

export type HiView =
  | 'projects' | 'budget' | 'calculators' | 'timeline' | 'gallery' | 'ideas'
  | 'pros' | 'shopping' | 'inventory' | 'maintenance' | 'discussion';
