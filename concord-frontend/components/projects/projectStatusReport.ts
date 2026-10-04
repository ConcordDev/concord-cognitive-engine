/**
 * A project status update exists because the Projects domain computed it.
 * `report-velocity`, `report-cycle-time`, `report-forecast`, `risk-list` and
 * `milestone-list` return the numbers; this module turns exactly those numbers
 * into a sentence, saves them as a private DTU, reads that DTU back, and hands
 * it to Thread as a draft.
 *
 * Every figure below comes from a macro response. A figure the backend did not
 * return is reported as missing, never invented. Nothing here publishes
 * anything: a Thread draft is a draft until the user posts it themselves.
 */

import { dtuRecordId, dtuReadBackCall, dtuReadBackMatches, type ReceiptCall } from '@/components/wallet/walletReceipt';

export interface ProjectRef {
  id: string;
  name: string;
  key: string;
  status?: string;
  health?: string;
}

export interface Velocity {
  series: { sprint: string; committed: number; completed: number }[];
  avgVelocity: number;
  completedSprints: number;
}

export interface CycleTime {
  completedTasks: number;
  avgCycleDays: number;
  avgLeadDays: number;
}

export interface Forecast {
  remainingPoints: number;
  avgVelocity: number;
  projectedSprints: number | null;
  basis: number;
}

export interface Risk {
  id: string;
  name: string;
  severity?: string;
  score?: number;
  status?: string;
  mitigation?: string | null;
  createdAt?: string;
}

export interface Milestone {
  id: string;
  name: string;
  dueDate?: string | null;
  status?: string;
  progressPct?: number;
}

export interface Dashboard {
  totalTasks: number;
  done: number;
  completionPct: number;
  overdue: number;
  activeSprints: number;
  openMilestones: number;
  members: number;
}

export interface StatusFacts {
  project: ProjectRef | null;
  dashboard: Dashboard | null;
  velocity: Velocity | null;
  cycle: CycleTime | null;
  forecast: Forecast | null;
  risks: Risk[];
  milestones: Milestone[];
}

/** A figure the backend returned, or an honest "not reported". */
function fact(value: unknown, format: (n: number) => string): string | null {
  const n = Number(value);
  return Number.isFinite(n) ? format(n) : null;
}

const pts = (n: number) => `${Math.round(n * 10) / 10} pts`;
const days = (n: number) => `${Math.round(n * 10) / 10}d`;

/**
 * Risks the project still carries. `risk-add` has no close state yet, so every
 * risk the backend returns is open; a `status` field, if one ever appears, is
 * honoured rather than assumed.
 */
export function openRisks(risks: Risk[] | null | undefined): Risk[] {
  return (risks || []).filter((r) => r && (r.status ?? 'open') !== 'closed');
}

export function openMilestones(milestones: Milestone[] | null | undefined): Milestone[] {
  return (milestones || []).filter((m) => m && !['done', 'complete'].includes(String(m.status || 'open')));
}

/**
 * The status sentence, built only from reported numbers. Null when the project
 * itself is unusable — the screen then refuses instead of inventing a summary.
 */
export function statusSentence(facts: StatusFacts): string | null {
  const id = String(facts.project?.id || '').trim();
  const name = String(facts.project?.name || '').trim();
  if (!id || !name) return null;

  const parts: string[] = [];
  const dash = facts.dashboard;
  if (dash) {
    parts.push(`${dash.done} of ${dash.totalTasks} tasks done (${dash.completionPct}%)`);
    if (dash.overdue > 0) parts.push(`${dash.overdue} overdue`);
  }
  const velocity = fact(facts.velocity?.avgVelocity, pts);
  if (velocity !== null) parts.push(`avg velocity ${velocity} over ${facts.velocity?.completedSprints ?? 0} completed sprint${facts.velocity?.completedSprints === 1 ? '' : 's'}`);
  const cycle = fact(facts.cycle?.avgCycleDays, days);
  if (cycle !== null) parts.push(`avg cycle time ${cycle}`);
  const risks = openRisks(facts.risks);
  if (risks.length > 0) parts.push(`${risks.length} open risk${risks.length === 1 ? '' : 's'}`);
  const milestones = openMilestones(facts.milestones);
  if (milestones.length > 0) parts.push(`${milestones.length} open milestone${milestones.length === 1 ? '' : 's'}`);

  const health = String(facts.project?.health || '').trim();
  const lead = `${name} (${String(facts.project?.key || id).trim()})`;
  return `${lead}: ${parts.length > 0 ? parts.join(', ') : 'no reported figures yet'}${health ? `. Health ${health.replace(/_/g, ' ')}.` : '.'}`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function statusBody(facts: StatusFacts): string {
  const sentence = statusSentence(facts);
  if (!sentence) return '';
  const lines = [sentence];
  const dash = facts.dashboard;
  if (dash) {
    lines.push(`Tasks: ${dash.done}/${dash.totalTasks} done (${dash.completionPct}%), ${dash.overdue} overdue.`);
    lines.push(`Sprints active: ${dash.activeSprints}. Milestones open: ${dash.openMilestones}. Members: ${dash.members}.`);
  }
  const f = facts.forecast;
  if (f && f.basis > 0 && f.projectedSprints != null) {
    lines.push(`Forecast: ${f.remainingPoints} pts remaining at ${pts(f.avgVelocity)}/sprint, about ${f.projectedSprints} sprint(s) to go.`);
  } else if (f && f.basis === 0) {
    lines.push('Forecast: no completed sprint yet, so there is no velocity basis.');
  }
  const risks = openRisks(facts.risks);
  if (risks.length > 0) {
    lines.push(`Open risks: ${risks.map((r) => `${String(r.name || r.id).trim()}${r.severity ? ` (${r.severity})` : ''}`).join('; ')}.`);
  }
  const milestones = openMilestones(facts.milestones);
  if (milestones.length > 0) {
    lines.push(`Open milestones: ${milestones.map((m) => `${String(m.name || m.id).trim()}${m.dueDate ? ` due ${m.dueDate}` : ''}`).join('; ')}.`);
  }
  lines.push('Every figure here came from this project in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same reported numbers, structured. */
export function statusMachine(facts: StatusFacts): Record<string, unknown> | null {
  if (!statusSentence(facts)) return null;
  const dash = facts.dashboard;
  const risks = openRisks(facts.risks);
  const milestones = openMilestones(facts.milestones);
  return {
    kind: 'project_status_report',
    projectId: String(facts.project?.id || ''),
    projectKey: String(facts.project?.key || ''),
    projectName: String(facts.project?.name || ''),
    status: String(facts.project?.status || ''),
    health: String(facts.project?.health || ''),
    tasks: dash ? { total: dash.totalTasks, done: dash.done, completionPct: dash.completionPct, overdue: dash.overdue } : null,
    velocity: facts.velocity ? { avgVelocity: facts.velocity.avgVelocity, completedSprints: facts.velocity.completedSprints } : null,
    cycleTime: facts.cycle ? { completedTasks: facts.cycle.completedTasks, avgCycleDays: facts.cycle.avgCycleDays, avgLeadDays: facts.cycle.avgLeadDays } : null,
    forecast: facts.forecast ? { remainingPoints: facts.forecast.remainingPoints, projectedSprints: facts.forecast.projectedSprints, basis: facts.forecast.basis } : null,
    openRisks: risks.map((r) => ({ id: String(r.id || ''), name: String(r.name || ''), severity: String(r.severity || ''), score: Number(r.score) || 0 })),
    openMilestones: milestones.map((m) => ({ id: String(m.id || ''), name: String(m.name || ''), dueDate: String(m.dueDate || ''), status: String(m.status || 'open'), progressPct: Number(m.progressPct) || 0 })),
  };
}

/** The private DTU that records this status. Null when nothing can be saved. */
export function statusReportDtuCall(facts: StatusFacts): ReceiptCall | null {
  const body = statusBody(facts);
  const sentence = statusSentence(facts);
  const machine = statusMachine(facts);
  if (!body || !sentence || !machine) return null;
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags: ['projects', 'status-report', String(facts.project?.key || 'project').toLowerCase()],
      source: 'projects-lens:status-report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'projects',
        projects: { projectId: String(facts.project?.id || '') },
      },
    },
  };
}

/**
 * The Thread draft carrying that report. Thread stores a draft — it does not
 * publish. Null when there is no real DTU id to cite.
 */
export function statusThreadDraftCall(
  facts: StatusFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = statusSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: String(facts.project?.name || 'Project status').slice(0, 120),
      content: statusBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface StatusDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function statusThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): StatusDraftResult | null {
  if (!data || data.ok === false) return null;
  const result = data.result && typeof data.result === 'object' ? (data.result as Record<string, unknown>) : null;
  const draft = result?.draft && typeof result.draft === 'object' ? (result.draft as Record<string, unknown>) : null;
  if (!draft) return null;
  const draftId = String(draft.id || '').trim();
  const cited = String(draft.citedDtuId || '').trim();
  const status = String(draft.status || '').trim();
  // Only claim a draft when Thread stored the exact DTU we saved and left it
  // unpublished. Anything else is a refusal, not a success.
  if (!draftId || cited !== String(dtuId).trim() || status !== 'draft') return null;
  return { draftId, status, citedDtuId: cited };
}

/**
 * Index the drafts Thread already holds by the DTU they cite, so a reload shows
 * the same "Drafted in Thread" the send reported. `details` is what
 * `draft-detail` returned for each draft — the list endpoint omits the cite,
 * so it has to be read back per draft. Both the macro envelope
 * (`{ result: { draft } }`) and a bare `{ draft }` are accepted.
 */
export function indexStatusDrafts(details: unknown): Record<string, string> {
  const list = Array.isArray(details) ? details : [];
  const out: Record<string, string> = {};
  for (const entry of list) {
    const envelope = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    if (!envelope || envelope.ok === false) continue;
    const result = envelope.result && typeof envelope.result === 'object' ? (envelope.result as Record<string, unknown>) : envelope;
    const draft = result.draft && typeof result.draft === 'object' ? (result.draft as Record<string, unknown>) : null;
    if (!draft) continue;
    const draftId = String(draft.id || '').trim();
    const cited = String(draft.citedDtuId || '').trim();
    if (!draftId || !cited || out[cited]) continue;
    out[cited] = draftId;
  }
  return out;
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };
