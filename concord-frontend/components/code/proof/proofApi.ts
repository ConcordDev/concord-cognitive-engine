/**
 * Typed client for the Code lens macros (server/domains/code.js and the Proof
 * ledger in server/domains/code-proof.js). Every call goes through
 * /api/lens/run. Shapes list only fields the server actually returns.
 */

import { lensRun } from '@/lib/api/client';

export type Envelope<T> = { ok: true; result: T } | { ok: false; error: string; message: string };

export async function code<T>(action: string, input: Record<string, unknown> = {}): Promise<Envelope<T>> {
  return call<T>('code', action, input);
}

export async function call<T>(domain: string, action: string, input: Record<string, unknown> = {}): Promise<Envelope<T>> {
  try {
    const r = await lensRun<T>(domain, action, input);
    const d = r.data;
    if (!d?.ok) {
      const error = String(d?.error || 'failed');
      return { ok: false, error, message: friendly(error, d?.message || null) };
    }
    return { ok: true, result: (d.result ?? ({} as T)) as T };
  } catch (e) {
    return { ok: false, error: 'network', message: (e as Error)?.message || 'The request did not reach the server.' };
  }
}

const FRIENDLY: Record<string, string> = {
  auth_required: 'Sign in to keep projects.',
  no_user: 'Sign in to keep projects.',
  not_connected: 'Connect your GitHub account first.',
  no_token: 'Connect your GitHub account first.',
  stale_fingerprint: 'The code changed while that ran. Run it again on the current code.',
  stale_review: 'The file changed since you opened its diff. Read it again.',
  proof_not_green: 'The proof is not green yet.',
  branch_is_base: 'Proof pushes to a new branch, never to the base branch.',
  invalid_branch_name: 'Branch names use letters, numbers, dots, dashes, underscores and slashes.',
  branch_create_failed: 'GitHub refused to create that branch. Is your account connected, and is the name free?',
  network: 'The request did not reach the server.',
};

export function friendly(error: string, message: string | null): string {
  return message || FRIENDLY[error] || error.replace(/_/g, ' ');
}

// ── shapes ─────────────────────────────────────────────────────────────

export interface Project { id: string; number: string; name: string; description: string; language: string; createdAt: string; lastOpenedAt: string }
export interface TreeEntry { path: string; language: string; size: number; modifiedAt: string }
export interface WorkspaceSummary { projectCount: number; fileCount: number; runningTasks: number; completedTasks: number; dirtyProjects: number }

export type CheckStatus = 'proved' | 'failed' | 'stale' | 'not_run' | 'not_applicable' | 'unavailable';
export type CheckKey = 'types' | 'lint' | 'tests' | 'run' | 'review';
export interface Problem { path: string; line: number | null; severity?: 'error' | 'warning' | 'info'; rule?: string; message: string }

export interface TypesCheck { status: CheckStatus; reason?: string; engine?: string; errors: number; problems: Problem[]; filesChecked?: number; uncheckedPackages?: string[] }
export interface LintCheck { status: CheckStatus; reason?: string; errors: number; warnings: number; info: number; problems: Problem[] }
export interface TestsCheck { status: CheckStatus; reason?: string; testFiles?: string[]; source?: 'browser'; at?: string; total?: number; passed?: number; failed?: number; failures?: { name: string; error: string }[]; files?: string[] }
export interface RunCheck { status: CheckStatus; reason?: string; candidates?: string[]; source?: 'browser'; at?: string; path?: string; exitCode?: number; timedOut?: boolean; durationMs?: number | null; stdoutTail?: string; stderrTail?: string }
export interface ReviewCheck { status: CheckStatus; reason?: string; reviewed?: number; total?: number }

export interface Change { path: string; status: 'added' | 'modified' | 'deleted'; additions: number; deletions: number; hash: string; code: boolean; test: boolean; reviewed: boolean }
export interface PushRecord { proposalId: string; branchName: string; at: string; codeFingerprint: string; checks: Record<CheckKey, CheckStatus>; files: number }
export interface Ledger {
  projectId: string;
  projectName: string;
  base: { kind: 'remote' | 'head' | 'empty'; label: string; ref: string | null };
  codeFingerprint: string;
  changes: Change[];
  checks: { types: TypesCheck; lint: LintCheck; tests: TestsCheck; run: RunCheck; review: ReviewCheck };
  order: CheckKey[];
  open: CheckKey[];
  green: boolean;
  remote: { owner: string; repo: string; defaultBranch: string; url: string | null } | null;
  canPush: boolean;
  pushBlockers: string[];
  pushes: PushRecord[];
}

export interface GitStatus { branch: string; branches: string[]; modified: string[]; staged: string[]; head: string | null; clean: boolean }
export interface Commit { id: string; number: string; message: string; paths: string[]; branch: string; committedAt: string; parent: string | null }
export interface DiffHunk { type: 'context' | 'add' | 'del'; text: string; oldLine?: number; newLine?: number }

export interface Proposal {
  id: string; repo: string; baseRef: string; branchName: string; status: string; fileCount: number;
  edits: { filename: string; reason: string | null }[]; createdAt: string; approvedAt: string | null; rejectedAt: string | null;
  pushResult: { ok: boolean; branch?: string; committed: { filename: string; htmlUrl: string | null }[]; conflicts: { filename: string; reason: string }[]; failed: { filename: string; stage: string; error: string }[]; skipped: string[]; stage?: string; error?: string } | null;
}

export const CHECK_LABEL: Record<CheckKey, string> = { types: 'Types', lint: 'Lint', tests: 'Tests', run: 'Run', review: 'Review' };

export const BLOCKER_TEXT: Record<string, string> = {
  no_changes: 'Nothing has changed yet.',
  proof_open: 'Some checks are still open.',
  no_remote: 'This project is not linked to a GitHub repository.',
  no_remote_base: 'Import the repository again so Proof knows what GitHub has.',
  deletions_not_pushable: 'This change deletes files, and the push path cannot delete yet.',
};

/** Read every file's content the proof depends on (saved server content, not editor buffers). */
export async function readFiles(projectId: string, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(paths.map(async (path) => {
    const r = await code<{ content: string }>('files-read', { projectId, path });
    if (r.ok && typeof r.result.content === 'string') out.set(path, r.result.content);
  }));
  return out;
}

export function languageOf(path: string): string {
  const ext = (path.split('.').pop() || '').toLowerCase();
  const m: Record<string, string> = { ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', py: 'python', json: 'json', md: 'markdown', css: 'css', html: 'html', yml: 'yaml', yaml: 'yaml', sh: 'shell', sql: 'sql', rs: 'rust', go: 'go' };
  return m[ext] || 'plaintext';
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
