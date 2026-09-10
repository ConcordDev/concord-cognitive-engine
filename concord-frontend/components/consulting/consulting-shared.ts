'use client';

export type ModeTab =
  | 'engagements'
  | 'proposals'
  | 'deliverables'
  | 'clients'
  | 'timesheets'
  | 'frameworks'
  | 'pipeline';

export type ArtifactType =
  | 'Engagement'
  | 'Proposal'
  | 'Deliverable'
  | 'Client'
  | 'Timesheet'
  | 'Framework'
  | 'PipelineItem';

export type Status = 'draft' | 'active' | 'pending' | 'completed' | 'on_hold' | 'cancelled';

export interface ConsultingArtifact {
  name: string;
  type: ArtifactType;
  status: Status;
  description: string;
  notes: string;
  client?: string;
  engagementType?: string;
  startDate?: string;
  endDate?: string;
  totalFee?: number;
  billedHours?: number;
  hourlyRate?: number;
  scope?: string;
  proposalValue?: number;
  winProbability?: number;
  contactName?: string;
  deliverableType?: string;
  dueDate?: string;
  methodology?: string;
}

export type ConsultingView = ModeTab | 'dashboard' | 'firm' | 'tracker' | 'workbench';

export const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'gray-400' },
  active: { label: 'Active', color: 'green-400' },
  pending: { label: 'Pending', color: 'yellow-400' },
  completed: { label: 'Completed', color: 'blue-400' },
  on_hold: { label: 'On Hold', color: 'orange-400' },
  cancelled: { label: 'Cancelled', color: 'red-400' },
};

export const ENGAGEMENT_TYPES = [
  'Strategy',
  'Operations',
  'Technology',
  'Financial Advisory',
  'HR Consulting',
  'Risk Management',
  'Digital Transformation',
  'M&A',
];

export const ARTIFACT_TABS: {
  id: ModeTab;
  label: string;
  artifactType: ArtifactType;
  tooltip?: string;
}[] = [
  {
    id: 'engagements',
    label: 'Engagement Records',
    artifactType: 'Engagement',
    tooltip:
      'Freeform engagement briefs, scope notes, and fee terms — for live engagement status and time tracking, see the Engagement Tracker tab.',
  },
  { id: 'proposals', label: 'Proposals', artifactType: 'Proposal' },
  { id: 'deliverables', label: 'Deliverables', artifactType: 'Deliverable' },
  { id: 'clients', label: 'Clients', artifactType: 'Client' },
  { id: 'timesheets', label: 'Timesheets', artifactType: 'Timesheet' },
  { id: 'frameworks', label: 'Frameworks', artifactType: 'Framework' },
  { id: 'pipeline', label: 'Pipeline', artifactType: 'PipelineItem' },
];
