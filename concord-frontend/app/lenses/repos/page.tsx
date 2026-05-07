'use client';

import { useState } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import {
  GitBranch,
  GitCommit,
  GitPullRequest,
  Star,
  Eye,
  GitFork,
  Code,
  FileText,
  Folder,
  ChevronRight,
  Plus,
  Search,
  BookOpen,
  AlertCircle,
  CheckCircle,
  MessageSquare,
  Settings,
  Shield,
  BarChart3,
  Play,
  Hash,
  Activity,
  Zap,
  X,
} from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

interface Repository {
  id: string;
  name: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  watchers: number;
  issues: number;
  pullRequests: number;
  updatedAt: string;
  isPrivate: boolean;
  defaultBranch: string;
}

interface Issue {
  id: string;
  number: number;
  title: string;
  state: 'open' | 'closed';
  author: string;
  labels: { name: string; color: string }[];
  comments: number;
  createdAt: string;
}

interface Commit {
  id: string;
  sha: string;
  message: string;
  author: string;
  date: string;
  additions: number;
  deletions: number;
}

type ActiveTab = 'code' | 'issues' | 'pulls' | 'actions' | 'projects' | 'wiki' | 'security' | 'insights' | 'settings';

export default function ReposLensPage() {
  useLensNav('repos');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('repos');

  const { items: repoArtifacts } = useLensData('repos', 'repo', { seed: [] });
  const runReposAction = useRunArtifact('repos');
  const [reposActionResult, setReposActionResult] = useState<Record<string, unknown> | null>(null);
  const [reposActiveAction, setReposActiveAction] = useState<string | null>(null);

  const handleReposAction = async (action: string) => {
    const id = repoArtifacts[0]?.id;
    if (!id) return;
    setReposActiveAction(action);
    try {
      const res = await runReposAction.mutateAsync({ id, action });
      if (res.ok === false) { setReposActionResult({ action, message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setReposActionResult({ action, ...(res.result as Record<string, unknown>) }); }
    } catch (err) { console.error('Repos action failed:', err); }
    finally { setReposActiveAction(null); }
  };

  const [activeTab, setActiveTab] = useState<ActiveTab>('code');
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);

  const { data: repos, isLoading, isError: isError, error: error, refetch: refetch,} = useQuery({
    queryKey: ['repos-list'],
    queryFn: () => apiHelpers.dtus.paginated({ tags: 'repo' }).then(r =>
      r.data?.dtus?.map((dtu: Record<string, unknown>, i: number) => ({
        id: dtu.id as string,
        name: (dtu.title as string) || `project-${i}`,
        description: (dtu.content as string)?.slice(0, 100) || 'A Concord DTU repository',
        language: (dtu.language as string) || ['TypeScript', 'Python', 'Rust', 'Go', 'JavaScript'][i % 5],
        stars: (dtu.stars as number) ?? 0,
        forks: (dtu.forks as number) ?? 0,
        watchers: (dtu.watchers as number) ?? 0,
        issues: (dtu.issues as number) ?? 0,
        pullRequests: (dtu.pullRequests as number) ?? 0,
        updatedAt: (dtu.updatedAt || dtu.createdAt) as string,
        isPrivate: (dtu.isPrivate as boolean) ?? false,
        defaultBranch: (dtu.defaultBranch as string) || 'main'
      })) || []
    ),
  });

  const { data: issues, isError: isError2, error: error2, refetch: refetch2,} = useQuery({
    queryKey: ['repos-issues', selectedRepo],
    queryFn: () => apiHelpers.dtus.paginated({ tags: 'issue' }).then(r =>
      r.data?.dtus?.map((dtu: Record<string, unknown>, i: number) => ({
        id: dtu.id as string,
        number: (dtu.number as number) ?? i + 1,
        title: (dtu.title as string) || (dtu.content as string)?.slice(0, 60),
        state: (dtu.state as 'open' | 'closed') || 'open',
        author: (dtu.author as string) || 'user',
        labels: (dtu.labels as { name: string; color: string }[]) || [],
        comments: (dtu.comments as number) ?? 0,
        createdAt: dtu.createdAt as string
      })) || []
    ),
    enabled: activeTab === 'issues',
  });

  const { data: commits, isError: isError3, error: error3, refetch: refetch3,} = useQuery({
    queryKey: ['repos-commits', selectedRepo],
    queryFn: async () => {
      try {
        const res = await apiHelpers.eventsLog.list({ limit: 20 });
        const events = res.data?.events || [];
        return events.map((e: Record<string, unknown>, i: number) => ({
          id: String(e.id || `c-${i}`),
          sha: String(e.id || '').slice(0, 7) || `abc${i}def`,
          message: String(e.type || e.summary || 'Update'),
          author: 'system',
          date: String(e.createdAt || new Date().toISOString()),
          additions: (e.additions as number) ?? 0,
          deletions: (e.deletions as number) ?? 0,
        })) as Commit[];
      } catch {
        return [] as Commit[];
      }
    },
    enabled: activeTab === 'code',
  });

  const languageColors: Record<string, string> = {
    TypeScript: 'bg-blue-500',
    JavaScript: 'bg-yellow-400',
    Python: 'bg-green-500',
    Rust: 'bg-orange-500',
    Go: 'bg-cyan-400',
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / 86400000);
    if (days < 1) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    return date.toLocaleDateString();
  };

  const tabs: { id: ActiveTab; label: string; icon: React.ElementType; count?: number }[] = [
    { id: 'code', label: 'Code', icon: Code },
    { id: 'issues', label: 'Issues', icon: AlertCircle, count: 12 },
    { id: 'pulls', label: 'Pull requests', icon: GitPullRequest, count: 3 },
    { id: 'actions', label: 'Actions', icon: Play },
    { id: 'projects', label: 'Projects', icon: BarChart3 },
    { id: 'wiki', label: 'Wiki', icon: BookOpen },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'insights', label: 'Insights', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];


  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError || isError2 || isError3) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message || error3?.message} onRetry={() => { refetch(); refetch2(); refetch3(); }} />
      </div>
    );
  }
  return (
    <div data-lens-theme="repos" className="min-h-full bg-[#0d1117]">
      {/* Header */}
      <header className="bg-[#161b22] border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-4">
              <span className="text-3xl">📦</span>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search or jump to..."
                  className="pl-10 pr-4 py-1.5 bg-[#0d1117] border border-gray-700 rounded-md text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 w-72"
                />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Create new repository' })} className="flex items-center gap-1 px-3 py-1 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 transition-colors">
                <Plus className="w-4 h-4" />
                New
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {!selectedRepo ? (
          /* Repository List */
          <div>
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-2xl font-bold text-white">Repositories</h1>
              <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Create new repository' })} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white font-medium rounded-md hover:bg-green-700 transition-colors">
                <Plus className="w-4 h-4" />
                New repository
              </button>
            </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="repos" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

            {/* Quick Stats Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 * 0.05 }} className="p-3 bg-[#161b22] border border-gray-700 rounded-lg flex items-center gap-3">
                <GitBranch className="w-5 h-5 text-blue-400" />
                <div>
                  <p className="text-lg font-bold">{repos?.length || 0}</p>
                  <p className="text-xs text-gray-500">Total Repos</p>
                </div>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 * 0.05 }} className="p-3 bg-[#161b22] border border-gray-700 rounded-lg flex items-center gap-3">
                <Hash className="w-5 h-5 text-yellow-400" />
                <div>
                  <p className="text-lg font-bold">{new Set(repos?.map((r: Repository) => r.language).filter(Boolean)).size}</p>
                  <p className="text-xs text-gray-500">Languages</p>
                </div>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2 * 0.05 }} className="p-3 bg-[#161b22] border border-gray-700 rounded-lg flex items-center gap-3">
                <Activity className="w-5 h-5 text-green-400" />
                <div>
                  <p className="text-lg font-bold">{commits?.length || 0}</p>
                  <p className="text-xs text-gray-500">Total Commits</p>
                </div>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3 * 0.05 }} className="p-3 bg-[#161b22] border border-gray-700 rounded-lg flex items-center gap-3">
                <Star className="w-5 h-5 text-orange-400" />
                <div>
                  <p className="text-lg font-bold">{repos?.reduce((s: number, r: Repository) => s + (r.stars || 0), 0) || 0}</p>
                  <p className="text-xs text-gray-500">Total Stars</p>
                </div>
              </motion.div>
            </div>

            <div className="space-y-4">
              {(!repos || repos.length === 0) && !isLoading && (
                <div className="p-8 bg-[#161b22] border border-gray-700 rounded-lg text-center">
                  <GitBranch className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-400 text-sm">No repositories yet</p>
                </div>
              )}
              {repos?.map((repo: Repository, index: number) => (
                <motion.div
                  key={repo.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="p-4 bg-[#161b22] border border-gray-700 rounded-lg hover:border-gray-500 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setSelectedRepo(repo.id)}
                          className="text-blue-400 font-semibold hover:underline"
                        >
                          {repo.name}
                        </button>
                        <span className={cn(
                          'px-2 py-0.5 text-xs rounded-full border',
                          repo.isPrivate
                            ? 'border-gray-600 text-gray-400'
                            : 'border-gray-600 text-gray-400'
                        )}>
                          {repo.isPrivate ? 'Private' : 'Public'}
                        </span>
                      </div>
                      <p className="text-gray-400 text-sm mt-1">{repo.description}</p>
                      <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
                        {repo.language && (
                          <span className="flex items-center gap-1">
                            <span className={cn('w-3 h-3 rounded-full', languageColors[repo.language] || 'bg-gray-500')} />
                            {repo.language}
                          </span>
                        )}
                        <span className="flex items-center gap-1 hover:text-blue-400 cursor-pointer">
                          <Star className="w-4 h-4" />
                          {repo.stars}
                        </span>
                        <span className="flex items-center gap-1 hover:text-blue-400 cursor-pointer">
                          <GitFork className="w-4 h-4" />
                          {repo.forks}
                        </span>
                        <span>Updated {formatTime(repo.updatedAt)}</span>
                      </div>
                    </div>
                    <button onClick={() => useUIStore.getState().addToast({ type: 'success', message: `Starred ${repo.name}` })} className="flex items-center gap-1 px-3 py-1 border border-gray-600 rounded-md text-sm text-gray-300 hover:bg-gray-800 transition-colors">
                      <Star className="w-4 h-4" />
                      Star
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        ) : (
          /* Repository Detail */
          <div>
            {/* Repo Header */}
            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={() => setSelectedRepo(null)}
                className="text-blue-400 hover:underline"
              >
                ← Back
              </button>
              <ChevronRight className="w-4 h-4 text-gray-500" />
              <span className="text-white font-semibold">
                {repos?.find((r: Repository) => r.id === selectedRepo)?.name}
              </span>
            </div>

            {/* Tabs */}
            <div className="border-b border-gray-700 mb-6">
              <nav className="flex gap-1">
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 text-sm border-b-2 -mb-px transition-colors',
                      activeTab === tab.id
                        ? 'border-orange-500 text-white'
                        : 'border-transparent text-gray-400 hover:text-white'
                    )}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                    {tab.count !== undefined && (
                      <span className="px-2 py-0.5 text-xs bg-gray-700 rounded-full">
                        {tab.count}
                      </span>
                    )}
                  </button>
                ))}
              </nav>
            </div>

            {/* Tab Content */}
            {activeTab === 'code' && (
              <div className="grid grid-cols-4 gap-6">
                {/* File Browser */}
                <div className="col-span-3 bg-[#161b22] border border-gray-700 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
                    <div className="flex items-center gap-2">
                      <GitBranch className="w-4 h-4 text-gray-400" />
                      <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Branch: main' })} className="flex items-center gap-1 px-3 py-1 bg-[#21262d] border border-gray-600 rounded-md text-sm">
                        main
                        <ChevronRight className="w-4 h-4 rotate-90" />
                      </button>
                    </div>
                    <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Clone URL copied to clipboard' })} className="flex items-center gap-2 px-3 py-1 bg-green-600 text-white text-sm rounded-md hover:bg-green-700">
                      <Code className="w-4 h-4" />
                      Code
                    </button>
                  </div>

                  {/* Files */}
                  <div className="divide-y divide-gray-700">
                    {[
                      { name: 'src', type: 'folder' },
                      { name: 'tests', type: 'folder' },
                      { name: '.gitignore', type: 'file' },
                      { name: 'package.json', type: 'file' },
                      { name: 'README.md', type: 'file' },
                      { name: 'tsconfig.json', type: 'file' },
                    ].map(file => (
                      <div
                        key={file.name}
                        className="flex items-center gap-3 px-4 py-2 hover:bg-[#1c2128] cursor-pointer"
                      >
                        {file.type === 'folder' ? (
                          <Folder className="w-4 h-4 text-blue-400" />
                        ) : (
                          <FileText className="w-4 h-4 text-gray-400" />
                        )}
                        <span className="text-sm text-gray-300 hover:text-blue-400 hover:underline">
                          {file.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Sidebar */}
                <div className="space-y-4">
                  <div className="bg-[#161b22] border border-gray-700 rounded-lg p-4">
                    <h3 className="font-semibold text-white mb-2">About</h3>
                    <p className="text-gray-400 text-sm mb-4">
                      {repos?.find((r: Repository) => r.id === selectedRepo)?.description}
                    </p>
                    <div className="flex items-center gap-4 text-sm text-gray-400">
                      <span className="flex items-center gap-1">
                        <Star className="w-4 h-4" />
                        {repos?.find((r: Repository) => r.id === selectedRepo)?.stars} stars
                      </span>
                      <span className="flex items-center gap-1">
                        <Eye className="w-4 h-4" />
                        {repos?.find((r: Repository) => r.id === selectedRepo)?.watchers} watching
                      </span>
                      <span className="flex items-center gap-1">
                        <GitFork className="w-4 h-4" />
                        {repos?.find((r: Repository) => r.id === selectedRepo)?.forks} forks
                      </span>
                    </div>
                  </div>

                  {/* Recent Commits */}
                  <div className="bg-[#161b22] border border-gray-700 rounded-lg p-4">
                    <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
                      <GitCommit className="w-4 h-4" />
                      Recent Commits
                    </h3>
                    <div className="space-y-3">
                      {commits?.slice(0, 5).map((commit: Commit) => (
                        <div key={commit.id} className="text-sm">
                          <p className="text-gray-300 truncate hover:text-blue-400 cursor-pointer">
                            {commit.message}
                          </p>
                          <p className="text-xs text-gray-500">
                            {commit.author} committed {formatTime(commit.date)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'issues' && (
              <div className="bg-[#161b22] border border-gray-700 rounded-lg">
                <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Showing open issues' })} className="flex items-center gap-2 text-white font-medium">
                      <AlertCircle className="w-4 h-4" />
                      Open
                    </button>
                    <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Showing closed issues' })} className="flex items-center gap-2 text-gray-400 hover:text-white">
                      <CheckCircle className="w-4 h-4" />
                      Closed
                    </button>
                  </div>
                  <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Create new issue' })} className="flex items-center gap-2 px-3 py-1 bg-green-600 text-white text-sm rounded-md hover:bg-green-700">
                    <Plus className="w-4 h-4" />
                    New issue
                  </button>
                </div>

                <div className="divide-y divide-gray-700">
                  {issues?.map((issue: Issue) => (
                    <div key={issue.id} className="px-4 py-3 hover:bg-[#1c2128]">
                      <div className="flex items-start gap-3">
                        {issue.state === 'open' ? (
                          <AlertCircle className="w-4 h-4 text-green-500 mt-1" />
                        ) : (
                          <CheckCircle className="w-4 h-4 text-purple-500 mt-1" />
                        )}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-white hover:text-blue-400 cursor-pointer">
                              {issue.title}
                            </span>
                            {issue.labels.map(label => (
                              <span
                                key={label.name}
                                className="px-2 py-0.5 text-xs rounded-full"
                                style={{ backgroundColor: `#${label.color}30`, color: `#${label.color}` }}
                              >
                                {label.name}
                              </span>
                            ))}
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            #{issue.number} opened {formatTime(issue.createdAt)} by {issue.author}
                          </p>
                        </div>
                        {issue.comments > 0 && (
                          <span className="flex items-center gap-1 text-xs text-gray-400">
                            <MessageSquare className="w-4 h-4" />
                            {issue.comments}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'pulls' && (
              <div className="bg-[#161b22] border border-gray-700 rounded-lg p-8 text-center">
                <GitPullRequest className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-white mb-2">Welcome to pull requests!</h3>
                <p className="text-gray-400 mb-4">
                  Pull requests help you collaborate on code with other people.
                </p>
                <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Create new pull request' })} className="px-4 py-2 bg-green-600 text-white font-medium rounded-md hover:bg-green-700">
                  New pull request
                </button>
              </div>
            )}
          </div>
        )}

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="repos"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}

      {/* Repos Domain Actions */}
      <div className="panel p-4 space-y-3">
        <h3 className="text-sm font-semibold text-neon-cyan flex items-center gap-2"><GitBranch className="w-4 h-4" /> Repository Analysis</h3>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'codeComplexity', label: 'Code Complexity' },
            { action: 'commitAnalysis', label: 'Commit Analysis' },
            { action: 'dependencyAudit', label: 'Dependency Audit' },
          ].map(({ action, label }) => (
            <button key={action} onClick={() => handleReposAction(action)} disabled={reposActiveAction === action || !repoArtifacts[0]?.id}
              className="px-3 py-1.5 text-xs bg-neon-cyan/10 border border-neon-cyan/20 rounded-lg hover:bg-neon-cyan/20 disabled:opacity-50 flex items-center gap-1.5">
              {reposActiveAction === action ? <div className="w-3 h-3 border border-neon-cyan border-t-transparent rounded-full animate-spin" /> : <Zap className="w-3 h-3 text-neon-cyan" />}
              {label}
            </button>
          ))}
        </div>
        {reposActionResult && (
          <div className="p-3 bg-black/40 rounded-lg border border-neon-cyan/20 text-xs space-y-2">
            {reposActionResult.action === 'codeComplexity' && (
              <div className="space-y-1">
                <div className="flex gap-4 flex-wrap">
                  <span className="text-gray-400">Modules: <span className="text-white font-mono">{String(reposActionResult.totalModules ?? '')}</span></span>
                  <span className="text-gray-400">Avg complexity: <span className={`font-mono ${(reposActionResult.overallAvgComplexity as number) > 20 ? 'text-red-400' : (reposActionResult.overallAvgComplexity as number) > 10 ? 'text-yellow-400' : 'text-green-400'}`}>{String(reposActionResult.overallAvgComplexity ?? '')}</span></span>
                  <span className="text-gray-400">Critical: <span className="text-red-400 font-mono">{String((reposActionResult.riskDistribution as Record<string,number>)?.critical ?? 0)}</span></span>
                </div>
                {!!reposActionResult.message && <p className="text-gray-400 italic">{String(reposActionResult.message)}</p>}
              </div>
            )}
            {reposActionResult.action === 'commitAnalysis' && (
              <div className="space-y-1">
                <div className="flex gap-4 flex-wrap">
                  <span className="text-gray-400">Commits: <span className="text-white font-mono">{String(reposActionResult.totalCommits ?? '')}</span></span>
                  <span className="text-gray-400">Authors: <span className="text-neon-cyan font-mono">{String(Array.isArray(reposActionResult.authors) ? (reposActionResult.authors as unknown[]).length : '')}</span></span>
                  <span className="text-gray-400">Avg/day: <span className="text-neon-green font-mono">{String((reposActionResult.frequency as Record<string,unknown>)?.commitsPerDay ?? '')}</span></span>
                </div>
                {!!reposActionResult.message && <p className="text-gray-400 italic">{String(reposActionResult.message)}</p>}
              </div>
            )}
            {reposActionResult.action === 'dependencyAudit' && (
              <div className="space-y-1">
                <div className="flex gap-4 flex-wrap">
                  <span className="text-gray-400">Total deps: <span className="text-white font-mono">{String(reposActionResult.totalDependencies ?? '')}</span></span>
                  <span className="text-gray-400">Conflicts: <span className="text-yellow-400 font-mono">{String((reposActionResult.duplicates as Record<string,unknown>)?.versionConflicts ?? 0)}</span></span>
                  <span className="text-gray-400">Vulnerable: <span className="text-red-400 font-mono">{String((reposActionResult.vulnerabilities as Record<string,unknown>)?.affectedDeps ?? 0)}</span></span>
                </div>
                {!!reposActionResult.message && <p className="text-gray-400 italic">{String(reposActionResult.message)}</p>}
              </div>
            )}
            <button onClick={() => setReposActionResult(null)} className="text-gray-600 hover:text-gray-400 text-xs flex items-center gap-1"><X className="w-3 h-3" /> Dismiss</button>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

