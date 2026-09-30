'use client';

/* Shared science lab types + constants — extracted from the fat page shell. */

export type ArtifactType = 'Experiment' | 'Sample' | 'Equipment' | 'Analysis' | 'Protocol' | 'Publication';

export type ExperimentStatus =
  | 'planned'
  | 'active'
  | 'paused'
  | 'analyzing'
  | 'peer_review'
  | 'published'
  | 'archived';

export type SampleCondition = 'excellent' | 'good' | 'degraded' | 'compromised' | 'disposed';
export type HazardClass = 'none' | 'biohazard' | 'chemical' | 'radioactive' | 'flammable' | 'corrosive';
export type EquipmentCondition =
  | 'operational'
  | 'needs_calibration'
  | 'maintenance'
  | 'out_of_service'
  | 'decommissioned';
export type ProtocolApproval = 'draft' | 'under_review' | 'approved' | 'superseded' | 'retired';
export type PubStatus =
  | 'draft'
  | 'submitted'
  | 'in_review'
  | 'revision'
  | 'accepted'
  | 'published'
  | 'rejected';
export type VisualizationType = 'bar' | 'line' | 'scatter' | 'heatmap' | 'histogram' | 'box' | 'pie';

export interface Experiment {
  hypothesis: string;
  protocol: string;
  observations: string;
  results: string;
  conclusions: string;
  reproducibility: 'confirmed' | 'partial' | 'not_tested' | 'failed';
  pi: string;
  startDate: string;
  endDate: string;
  fundingSource: string;
  tags: string[];
}

export interface SampleData {
  sampleId: string;
  type: string;
  storageLocation: string;
  chainOfCustody: string[];
  condition: SampleCondition;
  hazardClass: HazardClass;
  collectionDate: string;
  collector: string;
  quantity: number;
  unit: string;
  expirationDate: string;
  notes: string;
}

export interface EquipmentData {
  model: string;
  serialNumber: string;
  calibrationDate: string;
  nextCalibration: string;
  location: string;
  condition: EquipmentCondition;
  assignedTo: string;
  usageLog: { date: string; user: string; hours: number }[];
  maintenanceSchedule: string;
  bookings: { date: string; user: string; timeSlot: string }[];
  purchaseDate: string;
  warrantyExpiry: string;
}

export interface AnalysisData {
  datasetName: string;
  datasetSize: string;
  mean: number;
  median: number;
  stdDev: number;
  sampleN: number;
  pipelineSteps: string[];
  vizType: VisualizationType;
  software: string;
  author: string;
  startDate: string;
  pValue: string;
  conclusion: string;
  confidenceInterval: string;
}

export interface ProtocolData {
  version: string;
  approvalStatus: ProtocolApproval;
  approvedBy: string;
  reviewDate: string;
  nextReviewDate: string;
  safetyLevel: string;
  equipment: string[];
  duration: string;
  author: string;
  steps: string[];
  references: string[];
  changeLog: string[];
}

export interface PublicationData {
  journal: string;
  status: PubStatus;
  coAuthors: string[];
  doi: string;
  submissionDate: string;
  acceptanceDate: string;
  impactFactor: number;
  abstract: string;
  keywords: string[];
  correspondingAuthor: string;
  fundingAck: string;
}

export type ArtifactDataUnion =
  | Experiment
  | SampleData
  | EquipmentData
  | AnalysisData
  | ProtocolData
  | PublicationData;

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

export const ALL_STATUSES: ExperimentStatus[] = [
  'planned',
  'active',
  'paused',
  'analyzing',
  'peer_review',
  'published',
  'archived',
];

export const STATUS_COLORS: Record<string, string> = {
  planned: 'neon-blue',
  active: 'green-400',
  paused: 'orange-400',
  analyzing: 'yellow-400',
  peer_review: 'neon-purple',
  published: 'neon-cyan',
  archived: 'gray-400',
  excellent: 'green-400',
  good: 'blue-400',
  degraded: 'yellow-400',
  compromised: 'red-400',
  disposed: 'gray-400',
  operational: 'green-400',
  needs_calibration: 'yellow-400',
  maintenance: 'orange-400',
  out_of_service: 'red-400',
  decommissioned: 'gray-400',
  draft: 'gray-400',
  under_review: 'yellow-400',
  approved: 'green-400',
  superseded: 'blue-400',
  retired: 'gray-500',
  submitted: 'blue-400',
  in_review: 'yellow-400',
  revision: 'orange-400',
  accepted: 'green-400',
  rejected: 'red-400',
  confirmed: 'green-400',
  partial: 'yellow-400',
  not_tested: 'gray-400',
  failed: 'red-400',
  none: 'gray-400',
  biohazard: 'red-400',
  chemical: 'orange-400',
  radioactive: 'yellow-400',
  flammable: 'red-500',
  corrosive: 'purple-400',
};

export const SAMPLE_TYPES = [
  'Biological',
  'Soil',
  'Water',
  'Rock',
  'Air',
  'Tissue',
  'Blood',
  'Chemical',
  'Metal',
  'Polymer',
];
export const HAZARD_CLASSES: HazardClass[] = [
  'none',
  'biohazard',
  'chemical',
  'radioactive',
  'flammable',
  'corrosive',
];
export const SAMPLE_CONDITIONS: SampleCondition[] = [
  'excellent',
  'good',
  'degraded',
  'compromised',
  'disposed',
];
export const EQUIPMENT_CONDITIONS: EquipmentCondition[] = [
  'operational',
  'needs_calibration',
  'maintenance',
  'out_of_service',
  'decommissioned',
];
export const PROTOCOL_APPROVALS: ProtocolApproval[] = [
  'draft',
  'under_review',
  'approved',
  'superseded',
  'retired',
];
export const PUB_STATUSES: PubStatus[] = [
  'draft',
  'submitted',
  'in_review',
  'revision',
  'accepted',
  'published',
  'rejected',
];
export const VIZ_TYPES: VisualizationType[] = [
  'bar',
  'line',
  'scatter',
  'heatmap',
  'histogram',
  'box',
  'pie',
];
export const SAFETY_LEVELS = ['BSL-1', 'BSL-2', 'BSL-3', 'BSL-4'];
export const REPRODUCIBILITY = ['confirmed', 'partial', 'not_tested', 'failed'];

export function getStatusesForArtifact(type: ArtifactType): string[] {
  switch (type) {
    case 'Experiment':
      return ALL_STATUSES;
    case 'Sample':
      return SAMPLE_CONDITIONS;
    case 'Equipment':
      return EQUIPMENT_CONDITIONS;
    case 'Analysis':
      return ['planned', 'active', 'analyzing', 'peer_review', 'published'];
    case 'Protocol':
      return PROTOCOL_APPROVALS;
    case 'Publication':
      return PUB_STATUSES;
    default:
      return ALL_STATUSES;
  }
}

