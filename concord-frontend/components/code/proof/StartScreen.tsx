'use client';

/**
 * The start screen: your projects, a new project, import from GitHub (your
 * connected account, or any public repository), and what is trending on
 * GitHub this week as a place to start.
 */

import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, GitBranch, Lock, Plus, Star, Trash2, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ago, call, code, type Project, type WorkspaceSummary } from './proofApi';

interface RepoRow { id: number; fullName: string; name: string; private: boolean; description: string }
interface Trending { full_name: string; description?: string; stargazers_count: number; language?: string; html_url: string }
const NOT_CONNECTED = new Set(['no_token', 'reauth_required', 'auth_expired', 'github_disabled', 'not_connected']);

export function StartScreen({ onOpen }: { onOpen: (projectId: string) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [scaffold, setScaffold] = useState<'none' | 'node-ts'>('node-ts');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([code<{ projects: Project[] }>('projects-list'), code<WorkspaceSummary>('workspace-summary')]);
    if (p.ok) setProjects([...p.result.projects].sort((a, b) => (b.lastOpenedAt || '').localeCompare(a.lastOpenedAt || '')));
    else { setProjects([]); setError(p.message); }
    if (s.ok) setSummary(s.result);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!name.trim()) return;
    setBusy('create'); setError(null);
    const r = await code<{ project: Project }>('projects-create', { name: name.trim(), scaffold: scaffold === 'node-ts' ? 'node-ts' : undefined });
    setBusy(null);
    if (r.ok) onOpen(r.result.project.id); else setError(r.message);
  };

  const remove = async (id: string) => {
    setBusy(`del:${id}`);
    const r = await code('projects-delete', { id });
    setBusy(null); setConfirmDelete(null);
    if (r.ok) setProjects((ps) => (ps || []).filter((p) => p.id !== id)); else setError(r.message);
  };

  return (
    <div className="pf-scroll h-full overflow-y-auto" data-testid="pf-start">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
        <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2.5 text-[22px] font-semibold tracking-tight">
              <span className="pf-state" data-s="proved" aria-hidden><svg viewBox="0 0 10 10" className="h-2 w-2"><path d="M2 5.2 4.1 7.3 8 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
              Proof
            </h1>
            <p className="mt-1 text-[13px] pf-muted">An editor where every change carries its evidence, and GitHub opens only when it&apos;s green.</p>
          </div>
          {summary && (
            <p className="pf-num text-[11px] pf-faint" data-testid="pf-summary">
              {summary.projectCount} project{summary.projectCount === 1 ? '' : 's'} · {summary.fileCount} files · {summary.dirtyProjects} with changes
            </p>
          )}
        </header>

        {error && <p className="mb-4 rounded border pf-rule px-3 py-2 text-[12px] pf-fail" role="alert">{error}</p>}

        <div className="grid gap-8 lg:grid-cols-[1.25fr_1fr]">
          <section aria-labelledby="pf-projects-h">
            <h2 id="pf-projects-h" className="pf-label mb-2">Projects</h2>
            <div className="rounded border pf-rule-2 pf-panel">
              {projects === null && <div className="space-y-px p-1">{[0, 1, 2].map((i) => <div key={i} className="h-11 animate-pulse rounded pf-raised" role="status" aria-label="Loading" />)}</div>}
              {projects?.length === 0 && <p className="px-4 py-8 text-center text-[12.5px] pf-muted">No projects yet. Start one, or bring a repository in from GitHub.</p>}
              <ul data-testid="pf-project-list">
                {projects?.map((p) => (
                  <li key={p.id} className="group flex items-center border-b pf-rule last:border-b-0">
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-[var(--pf-ink-3)]" onClick={() => onOpen(p.id)} data-testid="pf-open-project">
                      <span className="pf-num w-14 text-[11px] pf-faint">{p.number}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{p.name}</span>
                        {p.description && <span className="block truncate text-[11.5px] pf-muted">{p.description}</span>}
                      </span>
                      <span className="text-[11px] pf-faint">{ago(p.lastOpenedAt)}</span>
                      <ArrowRight className="h-3.5 w-3.5 pf-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                    </button>
                    {confirmDelete === p.id ? (
                      <span className="flex items-center gap-1 pr-3">
                        <button type="button" className="pf-btn pf-btn-danger h-6 px-2" onClick={() => remove(p.id)} disabled={busy === `del:${p.id}`}>Delete</button>
                        <button type="button" className="pf-btn pf-btn-ghost h-6 px-2" onClick={() => setConfirmDelete(null)}>Keep</button>
                      </span>
                    ) : (
                      <button type="button" className="mr-2 rounded p-1.5 pf-faint opacity-0 hover:text-[color:var(--pf-fail)] focus:opacity-100 group-hover:opacity-100" onClick={() => setConfirmDelete(p.id)} aria-label={`Delete ${p.name}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <form className="mt-4 rounded border pf-rule-2 p-4" onSubmit={(e) => { e.preventDefault(); void create(); }} data-testid="pf-new-project">
              <h3 className="mb-3 flex items-center gap-1.5 text-[13px] font-medium"><Plus className="h-3.5 w-3.5" />New project</h3>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input className="pf-input" placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Project name" data-testid="pf-new-name" maxLength={80} />
                <div className="flex rounded border pf-rule-2 p-0.5" role="radiogroup" aria-label="Start from">
                  {([['node-ts', 'TypeScript'], ['none', 'Empty']] as const).map(([id, label]) => (
                    <button key={id} type="button" role="radio" aria-checked={scaffold === id} onClick={() => setScaffold(id)} className={cn('rounded px-2.5 text-[12px]', scaffold === id ? 'bg-[var(--pf-ink-4)] text-[color:var(--pf-text)]' : 'pf-muted')}>{label}</button>
                  ))}
                </div>
                <button type="submit" className="pf-btn h-7" disabled={!name.trim() || busy === 'create'} data-testid="pf-create">{busy === 'create' ? 'Creating…' : 'Create'}</button>
              </div>
            </form>
          </section>

          <div className="space-y-8">
            <ImportPanel onOpen={onOpen} />
            <TrendingCard onOpen={onOpen} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportPanel({ onOpen }: { onOpen: (id: string) => void }) {
  const [repos, setRepos] = useState<RepoRow[] | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [filter, setFilter] = useState('');
  const [publicRepo, setPublicRepo] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await call<{ repos: RepoRow[] }>('github', 'repos', {});
      if (r.ok) { setConnected(true); setRepos(r.result.repos || []); }
      else { setConnected(NOT_CONNECTED.has(r.error) ? false : null); setRepos([]); if (!NOT_CONNECTED.has(r.error)) setError(r.message); }
    })();
  }, []);

  const connect = async () => {
    const r = await call<{ authorizeUrl?: string }>('github', 'connect', { redirect: window.location.pathname });
    if (r.ok && r.result.authorizeUrl) window.location.href = r.result.authorizeUrl;
    else setError(r.ok ? 'GitHub sign-in is not configured on this server.' : r.message);
  };

  const importConnected = async (fullName: string) => {
    setBusy(fullName); setError(null);
    const r = await code<{ project: Project }>('github-import', { repo: fullName });
    setBusy(null);
    if (r.ok) onOpen(r.result.project.id); else setError(r.message);
  };

  const importPublic = async () => {
    const m = publicRepo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').match(/^([\w.-]+)\/([\w.-]+)$/);
    if (!m) { setError('Use owner/name, for example vercel/ms.'); return; }
    setBusy('public'); setError(null);
    const opened = await importPublicRepo(m[1], m[2]);
    setBusy(null);
    if (opened.ok) onOpen(opened.id); else setError(opened.message);
  };

  const shown = (repos || []).filter((r) => !filter || r.fullName.toLowerCase().includes(filter.toLowerCase())).slice(0, 8);

  return (
    <section aria-labelledby="pf-import-h" data-testid="pf-import">
      <h2 id="pf-import-h" className="pf-label mb-2">Import from GitHub</h2>
      <div className="rounded border pf-rule-2 pf-panel">
        <div className="border-b pf-rule p-3">
          {connected === false && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] pf-muted">Connect GitHub to import private repositories and to push proved changes.</p>
              <button type="button" className="pf-btn flex-shrink-0" onClick={connect} data-testid="pf-connect-github"><GitBranch className="h-3.5 w-3.5" />Connect</button>
            </div>
          )}
          {connected && (
            <>
              <input className="pf-input mb-2" placeholder="Filter your repositories" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter your repositories" />
              <ul className="space-y-px">
                {shown.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="pf-row rounded py-1.5" onClick={() => importConnected(r.fullName)} disabled={!!busy}>
                      {r.private ? <Lock className="h-3 w-3 pf-faint" aria-label="Private" /> : <GitBranch className="h-3 w-3 pf-faint" aria-hidden />}
                      <span className="pf-mono min-w-0 flex-1 truncate text-[12px]">{r.fullName}</span>
                      <span className="text-[11px] pf-faint">{busy === r.fullName ? 'Importing…' : 'Import'}</span>
                    </button>
                  </li>
                ))}
                {repos && shown.length === 0 && <li className="px-2 py-1 text-[12px] pf-faint">No repositories match.</li>}
              </ul>
            </>
          )}
          {connected === null && repos === null && <div className="h-8 animate-pulse rounded pf-raised" role="status" aria-label="Checking GitHub" />}
        </div>
        <form className="flex gap-2 p-3" onSubmit={(e) => { e.preventDefault(); void importPublic(); }}>
          <input className="pf-input pf-mono" placeholder="Any public repo: owner/name" value={publicRepo} onChange={(e) => setPublicRepo(e.target.value)} aria-label="Public repository" data-testid="pf-public-repo" />
          <button type="submit" className="pf-btn h-7 flex-shrink-0" disabled={!publicRepo.trim() || busy === 'public'}><Download className="h-3.5 w-3.5" />{busy === 'public' ? 'Pulling…' : 'Pull'}</button>
        </form>
        {error && <p className="px-3 pb-3 text-[12px] pf-fail" role="alert">{error}</p>}
      </div>
    </section>
  );
}

/** Create a project and pull a public repository into it. A failed pull removes the empty project. */
async function importPublicRepo(owner: string, repo: string): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const p = await code<{ project: Project }>('projects-create', { name: repo, description: `Pulled from ${owner}/${repo}` });
  if (!p.ok) return p;
  const pull = await code<{ pulledFiles: number }>('github-pull', { projectId: p.result.project.id, owner, repo });
  if (!pull.ok || !pull.result.pulledFiles) {
    await code('projects-delete', { id: p.result.project.id });
    return { ok: false, message: pull.ok ? 'That repository has no readable text files.' : pull.message };
  }
  return { ok: true, id: p.result.project.id };
}

function TrendingCard({ onOpen }: { onOpen: (id: string) => void }) {
  const [items, setItems] = useState<Trending[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const r = await call<{ items?: Trending[] }>('repos', 'github-trending', { sinceDays: 7 });
      if (r.ok) setItems((r.result.items || []).filter((x) => x && typeof x.full_name === 'string').slice(0, 6));
      else { setItems([]); setError('GitHub trending is not reachable from this server right now.'); }
    })();
  }, []);
  const pull = async (full: string) => {
    const [owner, repo] = full.split('/');
    setBusy(full);
    const r = await importPublicRepo(owner, repo);
    setBusy(null);
    if (r.ok) onOpen(r.id); else setError(r.message);
  };
  return (
    <section aria-labelledby="pf-trend-h" data-testid="pf-trending">
      <h2 id="pf-trend-h" className="pf-label mb-2">Trending on GitHub this week</h2>
      <ul className="rounded border pf-rule-2 pf-panel">
        {items === null && [0, 1, 2].map((i) => <li key={i} className="m-1 h-12 animate-pulse rounded pf-raised" role="status" aria-label="Loading" />)}
        {items?.map((t) => (
          <li key={t.full_name} className="flex items-start gap-3 border-b pf-rule px-3 py-2.5 last:border-b-0">
            <div className="min-w-0 flex-1">
              <a href={t.html_url} target="_blank" rel="noreferrer" className="pf-mono block truncate text-[12px] hover:underline">{t.full_name}</a>
              {t.description && <p className="line-clamp-1 text-[11.5px] pf-muted">{t.description}</p>}
              <p className="pf-num mt-0.5 flex items-center gap-2 text-[10.5px] pf-faint"><Star className="h-2.5 w-2.5" />{Number(t.stargazers_count || 0).toLocaleString()}{t.language ? ` · ${t.language}` : ''}</p>
            </div>
            <button type="button" className="pf-btn pf-btn-ghost h-6 flex-shrink-0 px-2" onClick={() => pull(t.full_name)} disabled={!!busy}>{busy === t.full_name ? 'Pulling…' : 'Open'}</button>
          </li>
        ))}
        {items?.length === 0 && <li className="px-3 py-4 text-[12px] pf-faint">{error || 'Nothing trending came back.'}</li>}
      </ul>
    </section>
  );
}
