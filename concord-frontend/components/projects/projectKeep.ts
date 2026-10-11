/**
 * A project exists because projects.project-create / project-list returned
 * it. This module turns that record into a private DTU and a Thread draft.
 * A figure the backend did not return is omitted. Nothing here publishes.
 */

import {
  dtuRecordId,
  dtuReadBackCall,
  dtuReadBackMatches,
  type ReceiptCall,
} from '@/components/wallet/walletReceipt';

export interface KeptProject {
  id?: string;
  name?: string;
  key?: string;
  status?: string;
  health?: string;
}

function str(v: unknown, max = 160): string {
  return String(v == null ? '' : v).trim().slice(0, max);
}

export function projectSentence(project: KeptProject | null | undefined): string | null {
  if (!project?.id || !project.name) return null;
  const key = str(project.key, 8);
  const name = str(project.name, 80);
  if (!name) return null;
  return key ? `${key} ${name}` : name;
}

export function projectBody(project: KeptProject): string {
  const sentence = projectSentence(project);
  if (!sentence) return '';
  const lines = [
    sentence,
    '',
    `Project ID: ${project.id}`,
    `Name: ${str(project.name, 160)}`,
  ];
  if (project.key) lines.push(`Key: ${str(project.key, 8)}`);
  if (project.status) lines.push(`Status: ${str(project.status, 40)}`);
  if (project.health) lines.push(`Health: ${str(project.health, 40)}`);
  lines.push('');
  lines.push('Every figure here came from the Projects domain in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

export function projectDtuCall(project: KeptProject | null | undefined): ReceiptCall | null {
  if (!project) return null;
  const sentence = projectSentence(project);
  const body = projectBody(project);
  if (!sentence || !body) return null;
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags: ['projects', 'project'],
      source: 'projects-lens:project',
      visibility: 'private',
      skipAutoTag: true,
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine: {
        kind: 'projects_project',
        projectId: project.id,
        name: project.name,
        key: project.key || null,
        status: project.status || null,
        health: project.health || null,
      },
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'projects',
        skipAutoTag: true,
      },
    },
  };
}

export function projectThreadDraftCall(
  project: KeptProject | null | undefined,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = project ? projectSentence(project) : null;
  if (!project || !sentence || !/^[A-Za-z0-9_.:-]{1,80}$/.test(id)) return null;
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: `Project — ${str(project.name, 60)}`.slice(0, 120),
      content: projectBody(project),
      platform,
      citedDtuId: id,
    },
  };
}

export interface ProjectDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

export function projectThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): ProjectDraftResult | null {
  if (!data || data.ok === false) return null;
  const result = data.result && typeof data.result === 'object' ? (data.result as Record<string, unknown>) : null;
  const draft = result?.draft && typeof result.draft === 'object' ? (result.draft as Record<string, unknown>) : null;
  if (!draft) return null;
  const draftId = String(draft.id || '').trim();
  const cited = String(draft.citedDtuId || '').trim();
  const status = String(draft.status || '').trim();
  if (!draftId || cited !== String(dtuId).trim() || status !== 'draft') return null;
  return { draftId, status, citedDtuId: cited };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };
