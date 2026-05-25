'use client';

/**
 * ForgeStudio — the v0.dev / Bolt.new interaction model for Forge.
 *
 * The base ForgeWorkbench generates a single-file app from the 13-subsystem
 * polyglot generator. ForgeStudio adds the *iterative* layer that defines a
 * modern AI app builder, every panel wired to a real forge.* lens macro:
 *
 *   - Conversational refinement thread        → forge.createProject / forge.refine / forge.thread
 *   - Version history + line-level diff        → forge.versions / forge.diff / forge.restoreVersion
 *   - Multi-file project tree                  → forge.files
 *   - Component-level section regeneration     → forge.regenerateSection
 *   - Live preview sandbox (iframe)            → forge.sandbox
 *   - Shareable hosted link                    → forge.share
 *   - Image / screenshot → app starter config  → forge.fromImage
 *
 * No mock data: the project tree is the actual partitioned generator output,
 * the diff is computed server-side, the sandbox HTML is a real artifact.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Hammer, MessageSquare, History, FolderTree, Eye, Share2,
  Image as ImageIcon, RefreshCw, Loader2, Send, GitBranch,
  RotateCcw, FileCode, Check, Copy, AlertTriangle, Plus,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { TimelineView, type TimelineEvent } from '@/components/viz';

// ── Types ───────────────────────────────────────────────────────────────
interface FileEntry { path: string; lines: number; content?: string }
interface ThreadMsg { role: 'user' | 'forge'; text: string; at: number }
interface VersionMeta {
  versionId: string;
  label: string;
  lines: number;
  files: number;
  derivedFrom: string | null;
  createdAt: number;
}
interface DiffResult {
  addedLines: number;
  removedLines: number;
  added: string[];
  removed: string[];
  oldLineCount: number;
  newLineCount: number;
}
interface ProjectState {
  projectId: string;
  appName: string;
  template: string;
  versionId: string;
  code: string;
  files: FileEntry[];
}

const TEMPLATES = [
  { id: 'blank', label: 'Blank' },
  { id: 'saas', label: 'SaaS' },
  { id: 'ecommerce', label: 'E-commerce' },
  { id: 'social', label: 'Social' },
  { id: 'api_only', label: 'API-only' },
  { id: 'realtime', label: 'Realtime' },
];

const SECTIONS = [
  'dependencies', 'config', 'database', 'auth', 'payments', 'api',
  'frontend', 'websocket', 'jobs', 'threads', 'testing', 'deployment',
];

const REFINE_HINTS = [
  'make the background blue',
  'rename to my-cool-app',
  'change the port to 8080',
  'add a comment header "Production build"',
  'remove the console logs',
];

type TabId = 'chat' | 'files' | 'versions' | 'preview' | 'image';

export function ForgeStudio() {
  // ── Project lifecycle ─────────────────────────────────────────────────
  const [project, setProject] = useState<ProjectState | null>(null);
  const [appName, setAppName] = useState('');
  const [templateId, setTemplateId] = useState('blank');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<TabId>('chat');

  // ── Refinement thread ─────────────────────────────────────────────────
  const [thread, setThread] = useState<ThreadMsg[]>([]);
  const [instruction, setInstruction] = useState('');
  const [refining, setRefining] = useState(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  // ── Versions / diff ───────────────────────────────────────────────────
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [diffFrom, setDiffFrom] = useState<string>('');
  const [diffTo, setDiffTo] = useState<string>('');
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffBusy, setDiffBusy] = useState(false);

  // ── Files ─────────────────────────────────────────────────────────────
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [regenSection, setRegenSection] = useState('database');
  const [regenBusy, setRegenBusy] = useState(false);

  // ── Sandbox ───────────────────────────────────────────────────────────
  const [sandboxHtml, setSandboxHtml] = useState<string | null>(null);
  const [sandboxBusy, setSandboxBusy] = useState(false);

  // ── Share ─────────────────────────────────────────────────────────────
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // ── Image → app ───────────────────────────────────────────────────────
  const [caption, setCaption] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [labelDraft, setLabelDraft] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const [imageResult, setImageResult] = useState<{
    recommendedTemplate: string;
    suggestedAppName: string;
    domainTables: string[];
    matchedConcepts: string[];
  } | null>(null);

  // ── Helpers ───────────────────────────────────────────────────────────
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread]);

  const refreshThread = useCallback(async (projectId: string) => {
    const r = await lensRun('forge', 'thread', { projectId });
    if (r.data.ok && r.data.result) {
      setThread((r.data.result as { thread: ThreadMsg[] }).thread || []);
    }
  }, []);

  const refreshVersions = useCallback(async (projectId: string) => {
    const r = await lensRun('forge', 'versions', { projectId });
    if (r.data.ok && r.data.result) {
      const res = r.data.result as { versions: VersionMeta[]; currentVersion: string };
      setVersions(res.versions || []);
      if (res.versions?.length >= 2) {
        setDiffFrom(res.versions[res.versions.length - 2].versionId);
        setDiffTo(res.versions[res.versions.length - 1].versionId);
      }
    }
  }, []);

  const refreshFiles = useCallback(async (projectId: string) => {
    const r = await lensRun('forge', 'files', { projectId });
    if (r.data.ok && r.data.result) {
      setFiles((r.data.result as { files: FileEntry[] }).files || []);
    }
  }, []);

  // ── createProject ─────────────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    const name = appName.trim();
    if (!name) { setError('Enter an app name to start a project.'); return; }
    setCreating(true);
    setError(null);
    const r = await lensRun('forge', 'createProject', { appName: name, templateId });
    setCreating(false);
    if (!r.data.ok || !r.data.result) {
      setError(r.data.error || 'Project creation failed.');
      return;
    }
    const res = r.data.result as {
      projectId: string; appName: string; template: string;
      versionId: string; code: string; files: FileEntry[];
    };
    const proj: ProjectState = {
      projectId: res.projectId,
      appName: res.appName,
      template: res.template,
      versionId: res.versionId,
      code: res.code,
      files: res.files,
    };
    setProject(proj);
    setFiles(res.files);
    setSandboxHtml(null);
    setShareUrl(null);
    setDiff(null);
    await refreshThread(res.projectId);
    await refreshVersions(res.projectId);
  }, [appName, templateId, refreshThread, refreshVersions]);

  // ── refine ────────────────────────────────────────────────────────────
  const handleRefine = useCallback(async () => {
    if (!project) return;
    const instr = instruction.trim();
    if (!instr) return;
    setRefining(true);
    setError(null);
    setInstruction('');
    const r = await lensRun('forge', 'refine', { projectId: project.projectId, instruction: instr });
    setRefining(false);
    if (!r.data.ok || !r.data.result) {
      setError(r.data.error || 'Refinement failed.');
      return;
    }
    const res = r.data.result as { newVersion: string | null; code?: string; files?: FileEntry[] };
    await refreshThread(project.projectId);
    await refreshVersions(project.projectId);
    if (res.newVersion && res.code) {
      setProject({ ...project, versionId: res.newVersion, code: res.code, files: res.files || project.files });
      if (res.files) setFiles(res.files);
      setSandboxHtml(null);
    }
  }, [project, instruction, refreshThread, refreshVersions]);

  // ── diff ──────────────────────────────────────────────────────────────
  const handleDiff = useCallback(async () => {
    if (!project || !diffFrom || !diffTo) return;
    setDiffBusy(true);
    const r = await lensRun('forge', 'diff', {
      projectId: project.projectId, fromVersion: diffFrom, toVersion: diffTo,
    });
    setDiffBusy(false);
    if (r.data.ok && r.data.result) {
      setDiff((r.data.result as { diff: DiffResult }).diff);
    } else {
      setError(r.data.error || 'Diff failed.');
    }
  }, [project, diffFrom, diffTo]);

  // ── restoreVersion ────────────────────────────────────────────────────
  const handleRestore = useCallback(async (versionId: string) => {
    if (!project) return;
    const r = await lensRun('forge', 'restoreVersion', { projectId: project.projectId, versionId });
    if (r.data.ok && r.data.result) {
      const res = r.data.result as { currentVersion: string; code: string };
      setProject({ ...project, versionId: res.currentVersion, code: res.code });
      await refreshFiles(project.projectId);
      await refreshVersions(project.projectId);
      setSandboxHtml(null);
    } else {
      setError(r.data.error || 'Restore failed.');
    }
  }, [project, refreshFiles, refreshVersions]);

  // ── regenerateSection ─────────────────────────────────────────────────
  const handleRegen = useCallback(async () => {
    if (!project) return;
    setRegenBusy(true);
    setError(null);
    const r = await lensRun('forge', 'regenerateSection', {
      projectId: project.projectId, sectionId: regenSection,
    });
    setRegenBusy(false);
    if (r.data.ok && r.data.result) {
      const res = r.data.result as { newVersion: string; code: string };
      setProject({ ...project, versionId: res.newVersion, code: res.code });
      await refreshFiles(project.projectId);
      await refreshVersions(project.projectId);
      setSandboxHtml(null);
    } else {
      setError(r.data.error || 'Section regeneration failed.');
    }
  }, [project, regenSection, refreshFiles, refreshVersions]);

  // ── sandbox ───────────────────────────────────────────────────────────
  const handleSandbox = useCallback(async () => {
    if (!project) return;
    setSandboxBusy(true);
    const r = await lensRun('forge', 'sandbox', { projectId: project.projectId });
    setSandboxBusy(false);
    if (r.data.ok && r.data.result) {
      setSandboxHtml((r.data.result as { html: string }).html);
    } else {
      setError(r.data.error || 'Sandbox build failed.');
    }
  }, [project]);

  // ── share ─────────────────────────────────────────────────────────────
  const handleShare = useCallback(async () => {
    if (!project) return;
    setShareBusy(true);
    const r = await lensRun('forge', 'share', { projectId: project.projectId });
    setShareBusy(false);
    if (r.data.ok && r.data.result) {
      const res = r.data.result as { shareUrl: string };
      const abs = typeof window !== 'undefined'
        ? `${window.location.origin}${res.shareUrl}`
        : res.shareUrl;
      setShareUrl(abs);
    } else {
      setError(r.data.error || 'Share link failed.');
    }
  }, [project]);

  const handleCopyShare = useCallback(() => {
    if (!shareUrl) return;
    navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }, [shareUrl]);

  // ── fromImage ─────────────────────────────────────────────────────────
  const handleFromImage = useCallback(async () => {
    if (!caption.trim() && labels.length === 0) {
      setError('Add a caption or detected UI labels from your screenshot.');
      return;
    }
    setImageBusy(true);
    setError(null);
    const r = await lensRun('forge', 'fromImage', { caption: caption.trim(), detectedLabels: labels });
    setImageBusy(false);
    if (r.data.ok && r.data.result) {
      setImageResult(r.data.result as typeof imageResult);
    } else {
      setError(r.data.error || 'Image analysis failed.');
    }
  }, [caption, labels]);

  const applyImageResult = useCallback(() => {
    if (!imageResult) return;
    setAppName(imageResult.suggestedAppName);
    setTemplateId(imageResult.recommendedTemplate);
    setTab('chat');
  }, [imageResult]);

  const versionTimeline: TimelineEvent[] = versions.map((v) => ({
    id: v.versionId,
    label: `v${v.versionId}`,
    time: v.createdAt,
    tone: v.versionId === project?.versionId ? 'good' : 'info',
    detail: v.label,
  }));

  const TABS: { id: TabId; label: string; icon: typeof Hammer }[] = [
    { id: 'chat', label: 'Refine', icon: MessageSquare },
    { id: 'files', label: 'Files', icon: FolderTree },
    { id: 'versions', label: 'History', icon: History },
    { id: 'preview', label: 'Preview', icon: Eye },
    { id: 'image', label: 'From Image', icon: ImageIcon },
  ];

  // ── Render: no project yet ────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-amber-500/20 bg-zinc-950/50">
      <div className="flex items-center gap-2 border-b border-amber-500/15 px-4 py-3">
        <Hammer className="h-4 w-4 text-amber-400" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-amber-200">Forge Studio — iterative app builder</h2>
        {project && (
          <span className="ml-auto rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">
            {project.appName} · {project.template} · v{project.versionId}
          </span>
        )}
      </div>

      {error && (
        <div role="alert" className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-red-700/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-xs underline focus:outline-none focus:ring-2 focus:ring-red-400 rounded">
            dismiss
          </button>
        </div>
      )}

      {/* Project creation */}
      {!project && (
        <div className="space-y-4 p-4">
          <p className="text-sm text-slate-400">
            Start a project, then iterate on it conversationally — recolour, rename, regenerate a
            single subsystem, diff versions, preview, and share.
          </p>
          <div>
            <label htmlFor="forge-appname" className="mb-1 block text-xs font-medium text-slate-400">App name</label>
            <input
              id="forge-appname"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="name your app"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-slate-100 focus:border-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            />
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-400">Base template</span>
            <div className="flex flex-wrap gap-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTemplateId(t.id)}
                  className={`rounded-lg border px-3 py-1.5 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                    templateId === t.id
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                      : 'border-zinc-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            className="flex items-center gap-2 rounded-lg bg-amber-500/20 px-4 py-2 text-sm font-medium text-amber-300 hover:bg-amber-500/30 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create project
          </button>
        </div>
      )}

      {/* Active project */}
      {project && (
        <div>
          <div className="flex items-center gap-1 border-b border-zinc-800 px-3 py-1.5">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                    tab === t.id ? 'bg-zinc-800 text-amber-200' : 'text-slate-400 hover:text-slate-300'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setProject(null)}
              className="ml-auto rounded-md px-2 py-1 text-xs text-slate-400 hover:text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              New project
            </button>
          </div>

          {/* CHAT / REFINE */}
          {tab === 'chat' && (
            <div className="flex flex-col p-4">
              <div className="mb-3 max-h-72 space-y-2 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                {thread.length === 0 && (
                  <p className="py-6 text-center text-xs text-slate-400">
                    No refinements yet. Describe a change below — Forge applies a concrete edit and forks a version.
                  </p>
                )}
                {thread.map((m, i) => (
                  <div
                    key={`${m.at}-${i}`}
                    className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-1.5 text-xs ${
                        m.role === 'user'
                          ? 'bg-amber-500/20 text-amber-100'
                          : 'border border-zinc-700 bg-zinc-800 text-slate-300'
                      }`}
                    >
                      {m.text}
                    </div>
                  </div>
                ))}
                <div ref={threadEndRef} />
              </div>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {REFINE_HINTS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setInstruction(h)}
                    className="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] text-slate-400 hover:text-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    {h}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !refining && handleRefine()}
                  placeholder="Describe a change…"
                  className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-slate-100 focus:border-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                />
                <button
                  type="button"
                  onClick={handleRefine}
                  disabled={refining || !instruction.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-500/20 px-3 py-2 text-sm text-amber-300 hover:bg-amber-500/30 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
                >
                  {refining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Refine
                </button>
              </div>
            </div>
          )}

          {/* FILES */}
          {tab === 'files' && (
            <div className="grid gap-4 p-4 md:grid-cols-[220px_1fr]">
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <FolderTree className="h-3.5 w-3.5" /> Project tree ({files.length})
                </div>
                <ul className="space-y-0.5">
                  {files.map((f) => (
                    <li key={f.path}>
                      <button
                        type="button"
                        onClick={() => setOpenFile(openFile === f.path ? null : f.path)}
                        className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                          openFile === f.path ? 'bg-zinc-800 text-amber-200' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <FileCode className="h-3.5 w-3.5 shrink-0 text-amber-400/70" />
                        <span className="truncate font-mono">{f.path}</span>
                        <span className="ml-auto text-[10px] text-slate-400">{f.lines}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
                    <RefreshCw className="h-3 w-3" /> Regenerate one subsystem
                  </div>
                  <select
                    value={regenSection}
                    onChange={(e) => setRegenSection(e.target.value)}
                    className="mb-1.5 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    {SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={handleRegen}
                    disabled={regenBusy}
                    className="flex w-full items-center justify-center gap-1.5 rounded bg-amber-500/15 px-2 py-1 text-xs text-amber-300 hover:bg-amber-500/25 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
                  >
                    {regenBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Regenerate
                  </button>
                </div>
              </div>
              <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950">
                {openFile ? (
                  <pre className="max-h-96 overflow-auto p-3 font-mono text-[11px] leading-5 text-slate-300">
                    {files.find((f) => f.path === openFile)?.content || '(empty)'}
                  </pre>
                ) : (
                  <div className="flex h-40 items-center justify-center text-xs text-slate-400">
                    Select a file to view its contents.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* VERSIONS / HISTORY */}
          {tab === 'versions' && (
            <div className="space-y-4 p-4">
              {versions.length > 0 && (
                <TimelineView events={versionTimeline} height={90} />
              )}
              <div className="space-y-1.5">
                {versions.map((v) => (
                  <div
                    key={v.versionId}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-xs ${
                      v.versionId === project.versionId
                        ? 'border-amber-500/40 bg-amber-500/5'
                        : 'border-zinc-800 bg-zinc-900/40'
                    }`}
                  >
                    <GitBranch className="h-3.5 w-3.5 shrink-0 text-amber-400/70" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-200">
                        v{v.versionId}
                        {v.derivedFrom && <span className="ml-1.5 text-slate-400">← v{v.derivedFrom}</span>}
                      </div>
                      <div className="truncate text-slate-400">{v.label}</div>
                    </div>
                    <span className="shrink-0 text-slate-600">{v.lines} ln · {v.files} files</span>
                    {v.versionId !== project.versionId && (
                      <button
                        type="button"
                        onClick={() => handleRestore(v.versionId)}
                        className="flex shrink-0 items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[11px] text-slate-300 hover:text-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-500"
                      >
                        <RotateCcw className="h-3 w-3" /> Restore
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {versions.length >= 2 && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-slate-400">Diff</span>
                    <select
                      value={diffFrom}
                      onChange={(e) => setDiffFrom(e.target.value)}
                      className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    >
                      {versions.map((v) => <option key={v.versionId} value={v.versionId}>v{v.versionId}</option>)}
                    </select>
                    <span className="text-slate-400">→</span>
                    <select
                      value={diffTo}
                      onChange={(e) => setDiffTo(e.target.value)}
                      className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    >
                      {versions.map((v) => <option key={v.versionId} value={v.versionId}>v{v.versionId}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={handleDiff}
                      disabled={diffBusy}
                      className="rounded bg-amber-500/15 px-2 py-1 text-amber-300 hover:bg-amber-500/25 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
                    >
                      {diffBusy ? 'Diffing…' : 'Compare'}
                    </button>
                  </div>
                  {diff && (
                    <div className="space-y-2">
                      <div className="flex gap-3 text-xs">
                        <span className="text-emerald-400">+{diff.addedLines} added</span>
                        <span className="text-rose-400">-{diff.removedLines} removed</span>
                        <span className="text-slate-400">{diff.oldLineCount} → {diff.newLineCount} lines</span>
                      </div>
                      <pre className="max-h-56 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[11px] leading-5">
                        {diff.removed.map((l, i) => (
                          <div key={`r${i}`} className="text-rose-400">- {l}</div>
                        ))}
                        {diff.added.map((l, i) => (
                          <div key={`a${i}`} className="text-emerald-400">+ {l}</div>
                        ))}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* PREVIEW */}
          {tab === 'preview' && (
            <div className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSandbox}
                  disabled={sandboxBusy}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-500/20 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-500/30 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
                >
                  {sandboxBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                  Build live preview
                </button>
                <button
                  type="button"
                  onClick={handleShare}
                  disabled={shareBusy}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-slate-300 hover:text-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
                >
                  {shareBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                  Get share link
                </button>
              </div>
              {shareUrl && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2">
                  <code className="flex-1 truncate text-xs text-amber-200">{shareUrl}</code>
                  <button
                    type="button"
                    onClick={handleCopyShare}
                    className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[11px] text-slate-300 hover:text-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              )}
              {sandboxHtml ? (
                <iframe
                  title="Forge live preview sandbox"
                  sandbox="allow-same-origin"
                  srcDoc={sandboxHtml}
                  className="h-96 w-full rounded-lg border border-zinc-800 bg-white"
                />
              ) : (
                <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-xs text-slate-400">
                  Build a live preview to render the project manifest in a sandboxed iframe.
                </div>
              )}
            </div>
          )}

          {/* FROM IMAGE */}
          {tab === 'image' && (
            <div className="space-y-3 p-4">
              <p className="text-xs text-slate-400">
                Paste a caption of a screenshot and any UI element labels you can see. Forge maps
                those hints to a starter template + domain tables — no pixels are turned into code,
                you describe the design and Forge builds the scaffold.
              </p>
              <div>
                <label htmlFor="forge-caption" className="mb-1 block text-xs font-medium text-slate-400">Screenshot caption</label>
                <input
                  id="forge-caption"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="describe the screen"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-slate-100 focus:border-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                />
              </div>
              <div>
                <span className="mb-1 block text-xs font-medium text-slate-400">Detected UI labels</span>
                <div className="flex gap-2">
                  <input
                    value={labelDraft}
                    onChange={(e) => setLabelDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && labelDraft.trim()) {
                        setLabels((prev) => [...new Set([...prev, labelDraft.trim().toLowerCase()])]);
                        setLabelDraft('');
                      }
                    }}
                    placeholder="e.g. cart, price, profile"
                    className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-slate-100 focus:border-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                  />
                </div>
                {labels.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {labels.map((l) => (
                      <span key={l} className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-xs text-slate-300">
                        {l}
                        <button
                          type="button"
                          onClick={() => setLabels((prev) => prev.filter((x) => x !== l))}
                          className="text-slate-400 hover:text-rose-400 focus:outline-none"
                          aria-label={`remove ${l}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={handleFromImage}
                disabled={imageBusy}
                className="flex items-center gap-1.5 rounded-lg bg-amber-500/20 px-3 py-2 text-sm text-amber-300 hover:bg-amber-500/30 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
              >
                {imageBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                Analyze hints
              </button>
              {imageResult && (
                <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-slate-300">
                  <div className="mb-1">
                    Recommended template: <span className="font-semibold text-amber-300">{imageResult.recommendedTemplate}</span>
                  </div>
                  <div className="mb-1">
                    Suggested app name: <span className="font-mono text-amber-200">{imageResult.suggestedAppName}</span>
                  </div>
                  {imageResult.domainTables.length > 0 && (
                    <div className="mb-1">Domain tables: {imageResult.domainTables.join(', ')}</div>
                  )}
                  {imageResult.matchedConcepts.length > 0 && (
                    <div className="mb-2 text-slate-400">Matched: {imageResult.matchedConcepts.join(', ')}</div>
                  )}
                  <button
                    type="button"
                    onClick={applyImageResult}
                    className="rounded bg-amber-500/20 px-3 py-1 text-amber-300 hover:bg-amber-500/30 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    Use these as a new project
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ForgeStudio;
