'use client';

export type ModeTab =
  | 'jobs'
  | 'estimates'
  | 'codes'
  | 'materials'
  | 'clients'
  | 'invoices'
  | 'inspections'
  | 'certs';

export type ArtifactType =
  | 'Job'
  | 'Estimate'
  | 'CodeRef'
  | 'Material'
  | 'Client'
  | 'Invoice'
  | 'Inspection'
  | 'Certification';

export type Status =
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'invoiced'
  | 'paid'
  | 'pending'
  | 'failed'
  | 'active'
  | 'draft'
  | 'sent'
  | 'accepted'
  | 'declined'
  | 'lead'
  | 'inactive'
  | 'overdue'
  | 'passed'
  | 'cancelled';

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
  material?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  supplier?: string;
  invoiceNumber?: string;
  dueDate?: string;
  paidDate?: string;
  amount?: number;
  inspector?: string;
  result?: string;
  deficiencies?: string;
  certType?: string;
  certNumber?: string;
  expiryDate?: string;
  issuedBy?: string;
}

export type HvacView = ModeTab | 'dashboard' | 'field' | 'feed' | 'manualj' | 'ducts';

export const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  scheduled: { label: 'Scheduled', color: 'blue-400' },
  in_progress: { label: 'In Progress', color: 'cyan-400' },
  completed: { label: 'Completed', color: 'green-400' },
  invoiced: { label: 'Invoiced', color: 'purple-400' },
  paid: { label: 'Paid', color: 'emerald-400' },
  pending: { label: 'Pending', color: 'yellow-400' },
  failed: { label: 'Failed', color: 'red-400' },
  active: { label: 'Active', color: 'green-400' },
  draft: { label: 'Draft', color: 'zinc-400' },
  sent: { label: 'Sent', color: 'sky-400' },
  accepted: { label: 'Accepted', color: 'green-400' },
  declined: { label: 'Declined', color: 'red-400' },
  lead: { label: 'Lead', color: 'amber-400' },
  inactive: { label: 'Inactive', color: 'zinc-400' },
  overdue: { label: 'Overdue', color: 'red-400' },
  passed: { label: 'Passed', color: 'green-400' },
  cancelled: { label: 'Cancelled', color: 'zinc-400' },
};

/**
 * Status language belongs to the object (S2 specialisation): one shared
 * status set worn by every record type put a *client* and an *invoice* at
 * "Scheduled". Each type now offers its own statuses; labels that differ
 * per type (a Material is "In stock", a CodeRef "Current") override via
 * TYPE_STATUS_LABELS. Legacy records carrying a generic status still
 * render through STATUS_CONFIG.
 */
export const STATUS_BY_TYPE: Record<ArtifactType, Status[]> = {
  Job: ['scheduled', 'in_progress', 'completed', 'cancelled'],
  Estimate: ['draft', 'sent', 'accepted', 'declined'],
  CodeRef: ['active', 'inactive'],
  Material: ['active', 'pending', 'completed'],
  Client: ['lead', 'active', 'inactive'],
  Invoice: ['draft', 'sent', 'paid', 'overdue'],
  Inspection: ['scheduled', 'in_progress', 'passed', 'failed'],
  Certification: ['active', 'inactive'],
};

export const TYPE_STATUS_LABELS: Partial<Record<string, string>> = {
  'Material:active': 'In stock',
  'Material:pending': 'On order',
  'Material:completed': 'Used up',
  'CodeRef:active': 'Current',
  'CodeRef:inactive': 'Superseded',
  'Certification:inactive': 'Lapsed',
};

export const DEFAULT_STATUS_BY_TYPE: Record<ArtifactType, Status> = {
  Job: 'scheduled',
  Estimate: 'draft',
  CodeRef: 'active',
  Material: 'active',
  Client: 'lead',
  Invoice: 'draft',
  Inspection: 'scheduled',
  Certification: 'active',
};

export function statusLabel(type: ArtifactType, status: string): string {
  return TYPE_STATUS_LABELS[`${type}:${status}`] || STATUS_CONFIG[status]?.label || status;
}

export const TRADE_MATERIALS = [
  'Ductwork',
  'Refrigerant R-410A',
  'Condenser Unit',
  'Evaporator Coil',
  'Compressor',
  'Thermostat',
  'Air Handler',
  'Furnace',
  'Heat Pump',
  'Mini Split',
  'Filter',
  'Damper',
  'Line Set',
];

export const TRADE_CERTS = [
  'EPA 608 Universal',
  'EPA 608 Type I',
  'EPA 608 Type II',
  'NATE Certification',
  'R-410A Safety',
  'HVAC Excellence',
];

export const ARTIFACT_TABS: { id: ModeTab; label: string; artifactType: ArtifactType }[] = [
  { id: 'jobs', label: 'Jobs', artifactType: 'Job' },
  { id: 'estimates', label: 'Estimates', artifactType: 'Estimate' },
  { id: 'codes', label: 'Codes', artifactType: 'CodeRef' },
  { id: 'materials', label: 'Materials', artifactType: 'Material' },
  { id: 'clients', label: 'CRM', artifactType: 'Client' },
  { id: 'invoices', label: 'Invoices', artifactType: 'Invoice' },
  { id: 'inspections', label: 'Inspections', artifactType: 'Inspection' },
  { id: 'certs', label: 'Certs', artifactType: 'Certification' },
];
