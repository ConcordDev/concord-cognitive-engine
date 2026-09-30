import type { LucideIcon } from 'lucide-react';
import {
  Building2,
  DollarSign,
  Truck,
  ClipboardList,
  Shield,
  Users,
  FileText,
  Map,
  HardHat,
  BarChart3,
  Wrench,
  AlertTriangle,
} from 'lucide-react';

export type RegistryMode =
  | 'dashboard'
  | 'jobs'
  | 'estimates'
  | 'materials'
  | 'inspections'
  | 'safety'
  | 'crew'
  | 'documents'
  | 'map';

export type ConstrView =
  | RegistryMode
  | 'field'
  | 'osha'
  | 'procore'
  | 'tools';

export type ArtifactType =
  | 'Job'
  | 'Estimate'
  | 'MaterialTakeoff'
  | 'Inspection'
  | 'SafetyReport'
  | 'CrewAssignment'
  | 'Document';

export type Status =
  | 'planned'
  | 'bidding'
  | 'awarded'
  | 'in_progress'
  | 'inspection'
  | 'punch_list'
  | 'completed'
  | 'on_hold';

export interface ConstructionArtifact {
  name: string;
  type: ArtifactType;
  status: Status;
  description: string;
  notes: string;
  jobNumber?: string;
  client?: string;
  address?: string;
  startDate?: string;
  endDate?: string;
  contractValue?: number;
  changeOrders?: number;
  projectType?: string;
  lat?: number;
  lng?: number;
  laborCost?: number;
  materialCost?: number;
  overhead?: number;
  profit?: number;
  totalEstimate?: number;
  material?: string;
  quantity?: number;
  unit?: string;
  unitCost?: number;
  supplier?: string;
  deliveryDate?: string;
  onSite?: boolean;
  inspector?: string;
  inspectionType?: string;
  result?: string;
  deficiencies?: string;
  reinspectionDate?: string;
  codeReference?: string;
  incidentType?: string;
  severity?: string;
  actionTaken?: string;
  followUp?: string;
  foreman?: string;
  crewSize?: number;
  trade?: string;
  shift?: string;
}

export const MODE_TABS: {
  id: Exclude<RegistryMode, 'dashboard'>;
  label: string;
  icon: LucideIcon;
  artifactType: ArtifactType;
}[] = [
  { id: 'jobs', label: 'Jobs', icon: Building2, artifactType: 'Job' },
  { id: 'estimates', label: 'Estimates', icon: DollarSign, artifactType: 'Estimate' },
  { id: 'materials', label: 'Materials', icon: Truck, artifactType: 'MaterialTakeoff' },
  { id: 'inspections', label: 'Inspections', icon: ClipboardList, artifactType: 'Inspection' },
  { id: 'safety', label: 'Safety', icon: Shield, artifactType: 'SafetyReport' },
  { id: 'crew', label: 'Crew', icon: Users, artifactType: 'CrewAssignment' },
  { id: 'documents', label: 'Documents', icon: FileText, artifactType: 'Document' },
  { id: 'map', label: 'Map', icon: Map, artifactType: 'Job' },
];

export const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  planned: { label: 'Planned', color: 'gray-400' },
  bidding: { label: 'Bidding', color: 'blue-400' },
  awarded: { label: 'Awarded', color: 'cyan-400' },
  in_progress: { label: 'In Progress', color: 'green-400' },
  inspection: { label: 'Inspection', color: 'yellow-400' },
  punch_list: { label: 'Punch List', color: 'orange-400' },
  completed: { label: 'Completed', color: 'emerald-400' },
  on_hold: { label: 'On Hold', color: 'red-400' },
};

export const PROJECT_TYPES = [
  'Residential New',
  'Residential Remodel',
  'Commercial',
  'Industrial',
  'Infrastructure',
  'Multi-Family',
  'Mixed-Use',
  'Tenant Improvement',
];

export const INSPECTION_TYPES = [
  'Foundation',
  'Framing',
  'Rough-In',
  'Insulation',
  'Drywall',
  'Final',
  'Fire',
  'Electrical',
  'Plumbing',
  'Mechanical',
];

export const TRADES = [
  'General',
  'Electrical',
  'Plumbing',
  'HVAC',
  'Framing',
  'Concrete',
  'Roofing',
  'Drywall',
  'Painting',
  'Flooring',
  'Masonry',
  'Welding',
  'Excavation',
];

export const SHELL_VIEWS: { id: ConstrView; label: string; keys: string; icon: LucideIcon }[] = [
  { id: 'dashboard', label: 'Dashboard', keys: 'd', icon: BarChart3 },
  { id: 'jobs', label: 'Jobs', keys: 'j', icon: Building2 },
  { id: 'estimates', label: 'Estimates', keys: 'e', icon: DollarSign },
  { id: 'materials', label: 'Materials', keys: 'm', icon: Truck },
  { id: 'inspections', label: 'Inspections', keys: 'i', icon: ClipboardList },
  { id: 'safety', label: 'Safety', keys: 's', icon: Shield },
  { id: 'crew', label: 'Crew', keys: 'c', icon: Users },
  { id: 'documents', label: 'Documents', keys: 'o', icon: FileText },
  { id: 'map', label: 'Map', keys: 'a', icon: Map },
  { id: 'field', label: 'Field', keys: 'f', icon: HardHat },
  { id: 'osha', label: 'OSHA', keys: 'h', icon: AlertTriangle },
  { id: 'procore', label: 'Procore', keys: 'p', icon: Building2 },
  { id: 'tools', label: 'Workbench', keys: 'w', icon: Wrench },
];
