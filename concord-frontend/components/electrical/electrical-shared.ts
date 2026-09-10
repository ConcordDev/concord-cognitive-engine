'use client';

export type ModeTab =
  | 'dashboard'
  | 'jobs'
  | 'codes'
  | 'clients'
  | 'certs'
  | 'panels'
  | 'calculators'
  | 'estimating'
  | 'diagrams'
  | 'checklists'
  | 'pricelist'
  | 'hardware'
  | 'neccalc';

export type ArtifactType = 'Job' | 'CodeRef' | 'Client' | 'Certification';
export type Status =
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'invoiced'
  | 'paid'
  | 'pending'
  | 'failed'
  | 'active';

export interface TradeArtifact {
  name: string;
  type: ArtifactType;
  status: Status;
  description: string;
  notes: string;
  client?: string;
  address?: string;
  phone?: string;
  email?: string;
  scheduledDate?: string;
  completedDate?: string;
  laborHours?: number;
  laborRate?: number;
  materialCost?: number;
  totalCost?: number;
  codeReference?: string;
  codeSection?: string;
  jurisdiction?: string;
  certType?: string;
  certNumber?: string;
  expiryDate?: string;
  issuedBy?: string;
}

export const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  scheduled: { label: 'Scheduled', color: 'blue-400' },
  in_progress: { label: 'In Progress', color: 'cyan-400' },
  completed: { label: 'Completed', color: 'green-400' },
  invoiced: { label: 'Invoiced', color: 'purple-400' },
  paid: { label: 'Paid', color: 'emerald-400' },
  pending: { label: 'Pending', color: 'yellow-400' },
  failed: { label: 'Failed', color: 'red-400' },
  active: { label: 'Active', color: 'green-400' },
};

export const ELECTRICAL_CERTS = [
  'Master Electrician',
  'Journeyman Electrician',
  'Apprentice Electrician',
  'Low Voltage License',
  'Fire Alarm Certification',
  'Solar PV Installer',
];

export const ARTIFACT_TABS: { id: 'jobs' | 'codes' | 'clients' | 'certs'; label: string; artifactType: ArtifactType }[] = [
  { id: 'jobs', label: 'Jobs', artifactType: 'Job' },
  { id: 'codes', label: 'NEC Code Notes', artifactType: 'CodeRef' },
  { id: 'clients', label: 'CRM', artifactType: 'Client' },
  { id: 'certs', label: 'Certs', artifactType: 'Certification' },
];

export const TOOL_TAB_IDS: ModeTab[] = [
  'panels', 'calculators', 'neccalc', 'estimating', 'diagrams', 'checklists', 'pricelist', 'hardware',
];
