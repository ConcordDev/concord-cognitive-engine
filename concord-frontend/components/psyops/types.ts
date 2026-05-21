// Shared types for the psyops anomaly-detection console.

export interface PsyopsRule {
  signal: string;
  label: string;
  sigma: number;
  critical: number;
  enabled: boolean;
}

export interface AlertNote {
  by: string;
  action: string;
  text: string;
  at: number;
}

export interface AlertEvidence {
  cohortSize: number;
  ruleSigma: number;
  criticalSigma: number;
  percentile: number;
}

export interface ScanSample {
  entityId: string;
  value: number;
}

export interface ScanResult {
  signal: string;
  scanned: number;
  mean: number;
  stddev: number;
  newAlerts: PsyopsAlert[];
}

export interface AlertDetail {
  alert: PsyopsAlert;
  incident: PsyopsIncident | null;
  related: PsyopsAlert[];
}

export interface PsyopsAlert {
  id: string;
  signal: string;
  entityId: string;
  value: number;
  cohortMean: number;
  cohortStddev: number;
  sigmaAbove: number;
  severity: 'critical' | 'high' | 'medium';
  status: 'open' | 'assigned' | 'investigating' | 'resolved' | 'dismissed';
  assignee: string | null;
  notes: AlertNote[];
  incidentId: string | null;
  quarantined: boolean;
  quarantinedAt?: number;
  releasedAt?: number;
  resolvedAt?: number;
  evidence: AlertEvidence;
  detectedAt: number;
}

export interface AlertCounts {
  open: number;
  assigned: number;
  investigating: number;
  resolved: number;
  dismissed: number;
  critical: number;
}

export interface IncidentTimelineItem {
  id: string;
  label: string;
  time: number;
  tone: 'bad' | 'warn' | 'info';
  detail: string;
}

export interface PsyopsIncident {
  id: string;
  title: string;
  summary: string;
  status: 'active' | 'closed';
  alertIds: string[];
  severity: 'critical' | 'high' | 'medium';
  alertCount?: number;
  timeline?: IncidentTimelineItem[];
  resolution?: string;
  createdAt: number;
  closedAt?: number;
}

export interface PsyopsNotification {
  id: string;
  alertId: string;
  signal: string;
  entityId: string;
  sigmaAbove: number;
  message: string;
  acknowledged: boolean;
  createdAt: number;
}

export interface QuarantineLogEntry {
  id: string;
  alertId: string;
  entityId: string;
  action: 'quarantine' | 'release';
  reason: string;
  by: string;
  at: number;
}

export const SIGNAL_LABELS: Record<string, string> = {
  skill_divergence: 'Skill divergence',
  economy: 'Economy',
  content: 'Content',
  network: 'Network',
};
