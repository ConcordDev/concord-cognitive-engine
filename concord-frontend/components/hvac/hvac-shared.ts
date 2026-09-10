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

export type HvacView = ModeTab | 'dashboard' | 'field' | 'feed' | 'manualj';

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
