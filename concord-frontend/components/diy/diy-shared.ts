'use client';

export type ModeTab = 'projects' | 'tools' | 'materials' | 'instructions' | 'ideas' | 'gallery';
export type ArtifactType = 'Project' | 'Tool' | 'Material' | 'Instruction' | 'Idea' | 'GalleryItem';
export type Status =
  | 'idea'
  | 'gathering'
  | 'in_progress'
  | 'completed'
  | 'on_hold'
  | 'available'
  | 'in_use'
  | 'low_stock';

export interface DIYArtifact {
  name: string;
  type: ArtifactType;
  status: Status;
  description: string;
  notes: string;
  category?: string;
  difficulty?: string;
  estimatedHours?: number;
  hoursSpent?: number;
  cost?: number;
  budget?: number;
  toolName?: string;
  brand?: string;
  condition?: string;
  location?: string;
  materialName?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  supplier?: string;
  step?: number;
  instruction?: string;
  safetyNotes?: string;
  tags?: string;
  imageUrl?: string;
}

export type DiyView = ModeTab | 'dashboard' | 'workshop' | 'showcase';

export const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  idea: { label: 'Idea', color: 'gray-400' },
  gathering: { label: 'Gathering', color: 'yellow-400' },
  in_progress: { label: 'In Progress', color: 'cyan-400' },
  completed: { label: 'Completed', color: 'green-400' },
  on_hold: { label: 'On Hold', color: 'orange-400' },
  available: { label: 'Available', color: 'green-400' },
  in_use: { label: 'In Use', color: 'blue-400' },
  low_stock: { label: 'Low Stock', color: 'red-400' },
};

export const CATEGORIES = [
  'Woodworking', 'Electronics', 'Sewing', 'Metalwork', 'Painting', 'Pottery',
  'Leatherwork', '3D Printing', 'Jewelry', 'Plumbing', 'Automotive', 'Garden', 'Other',
];
export const DIFFICULTIES = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];
export const TOOL_CONDITIONS = ['New', 'Good', 'Fair', 'Needs Repair', 'Out of Service'];
export const MATERIAL_UNITS = [
  'pcs', 'ft', 'in', 'm', 'kg', 'lbs', 'oz', 'ml', 'L', 'rolls', 'sheets', 'boards',
];
