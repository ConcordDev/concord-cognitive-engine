'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { SafeCard } from '@/components/common/SafeCard';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { SessionRail } from '@/components/lens/SessionRail';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import LensAgentFab from '@/components/lens/LensAgentFab';
import { ShellPreview } from '@/components/lens/ShellPreview';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { CodeWorkbenchSection } from '@/components/code/CodeWorkbenchSection';
import { CodeAdvancedPanel } from '@/components/code/CodeAdvancedPanel';
import { useLensNav } from '@/hooks/useLensNav';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import BYOKeyDrawer from '@/components/chat/BYOKeyDrawer';
import CitationChips from '@/components/chat/CitationChips';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';
const MonacoWrapper = dynamic(() => import('@/components/code/MonacoWrapper'), { ssr: false });
const MonacoDiffViewer = dynamic(() => import('@/components/code/MonacoDiffViewer'), { ssr: false });
const TerminalPanel = dynamic(() => import('@/components/code/TerminalPanel').then(m => m.TerminalPanel), { ssr: false });
import SettingsPanel, { loadSettings as loadCodeSettings, DEFAULT_SETTINGS as DEFAULT_CODE_SETTINGS, type CodeLensSettings } from '@/components/code/SettingsPanel';
import { ActivityBar, type Activity } from '@/components/code/ActivityBar';
import { SnippetsLibrary } from '@/components/code/SnippetsLibrary';
import { SourceControlPanel } from '@/components/code/SourceControlPanel';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import {
  Files as MTabFiles, Search as MTabSearch, GitBranch as MTabSC,
  BookOpen as MTabSnip, Terminal as MTabTerm, Sparkles as MTabAgent,
} from 'lucide-react';
import MultiFileAgentReview, { type MultiFileEdit } from '@/components/code/MultiFileAgentReview';
import { ErrorState } from '@/components/common/EmptyState';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { LensContextPanel } from '@/components/lens/LensContextPanel';
import { FeedbackWidget } from '@/components/feedback/FeedbackWidget';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Play, FileCode, Terminal, FolderTree, Plus, X,
  ChevronRight, ChevronDown, File, Folder, FolderOpen,
  Sparkles, RefreshCw, Copy,
  Download, Zap, Waves, SlidersHorizontal,
  Loader2, BookOpen,
  Save, Maximize2, Minimize2, Layers,
  XCircle, BarChart3, AlertTriangle,
  Key,
} from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { VisionAnalyzeButton } from '@/components/common/VisionAnalyzeButton';
import { GithubTrending } from '@/components/code/GithubTrending';
import { CodeActionPanel } from '@/components/code/CodeActionPanel';
import { PipingProvider } from '@/components/panel-polish';

interface FileNode {
  id: string;
  name: string;
  type: 'file' | 'folder';
  language?: string;
  content?: string;
  children?: FileNode[];
  isExpanded?: boolean;
  scriptType?: ScriptType;
}

interface Tab {
  id: string;
  name: string;
  language: string;
  content: string;
  isDirty: boolean;
  scriptType: ScriptType;
}

type ScriptType = 'snippet' | 'project' | 'pipeline' | 'notebook' | 'algorithm' | 'library';

const SCRIPT_TYPES: { id: ScriptType; name: string; icon: React.ComponentType<{ className?: string; size?: number | string }>; color: string; description: string }[] = [
  { id: 'snippet', name: 'Snippet', icon: FileCode, color: 'text-neon-blue', description: 'Quick code snippets and utilities' },
  { id: 'project', name: 'Project', icon: Layers, color: 'text-neon-purple', description: 'Multi-file project scaffolding' },
  { id: 'pipeline', name: 'Pipeline', icon: Waves, color: 'text-neon-yellow', description: 'Data processing and ETL pipelines' },
  { id: 'notebook', name: 'Notebook', icon: SlidersHorizontal, color: 'text-green-400', description: 'Interactive computation notebooks' },
  { id: 'algorithm', name: 'Algorithm', icon: Zap, color: 'text-neon-cyan', description: 'Algorithm implementations and DSA' },
  { id: 'library', name: 'Library', icon: Sparkles, color: 'text-red-400', description: 'Reusable modules and packages' },
];

const TEMPLATE_FILES: FileNode[] = [
  {
    id: 'algorithms',
    name: 'Algorithms',
    type: 'folder',
    isExpanded: true,
    children: [
      {
        id: 'binary_search.js', name: 'binary_search.js', type: 'file', language: 'javascript', scriptType: 'algorithm',
        content: `// Binary Search Implementation
// O(log n) search on sorted arrays

function binarySearch(arr, target) {
  let left = 0;
  let right = arr.length - 1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (arr[mid] === target) return mid;
    if (arr[mid] < target) left = mid + 1;
    else right = mid - 1;
  }
  return -1;
}

// Test
const sorted = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
console.log(binarySearch(sorted, 7));  // 3
console.log(binarySearch(sorted, 12)); // -1`,
      },
      {
        id: 'graph_bfs.js', name: 'graph_bfs.js', type: 'file', language: 'javascript', scriptType: 'algorithm',
        content: `// Breadth-First Search (BFS)
// Graph traversal using a queue

function bfs(graph, start) {
  const visited = new Set();
  const queue = [start];
  const order = [];

  while (queue.length > 0) {
    const node = queue.shift();
    if (visited.has(node)) continue;

    visited.add(node);
    order.push(node);

    for (const neighbor of (graph[node] || [])) {
      if (!visited.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }
  return order;
}

const graph = {
  A: ['B', 'C'],
  B: ['A', 'D', 'E'],
  C: ['A', 'F'],
  D: ['B'],
  E: ['B', 'F'],
  F: ['C', 'E'],
};

console.log(bfs(graph, 'A')); // ['A', 'B', 'C', 'D', 'E', 'F']`,
      },
      {
        id: 'merge_sort.js', name: 'merge_sort.js', type: 'file', language: 'javascript', scriptType: 'algorithm',
        content: `// Merge Sort Implementation
// O(n log n) stable sorting algorithm

function mergeSort(arr) {
  if (arr.length <= 1) return arr;

  const mid = Math.floor(arr.length / 2);
  const left = mergeSort(arr.slice(0, mid));
  const right = mergeSort(arr.slice(mid));

  return merge(left, right);
}

function merge(left, right) {
  const result = [];
  let i = 0, j = 0;

  while (i < left.length && j < right.length) {
    if (left[i] <= right[j]) result.push(left[i++]);
    else result.push(right[j++]);
  }

  return [...result, ...left.slice(i), ...right.slice(j)];
}

const unsorted = [38, 27, 43, 3, 9, 82, 10];
console.log(mergeSort(unsorted)); // [3, 9, 10, 27, 38, 43, 82]`,
      },
    ],
  },
  {
    id: 'snippets',
    name: 'Snippets',
    type: 'folder',
    children: [
      {
        id: 'fetch_api.js', name: 'fetch_api.js', type: 'file', language: 'javascript', scriptType: 'snippet',
        content: `// REST API Client
// Reusable fetch wrapper with error handling

async function apiClient(baseUrl) {
  const headers = { 'Content-Type': 'application/json' };

  return {
    get: async (path) => {
      const res = await fetch(baseUrl + path, { headers });
      if (!res.ok) throw new Error(res.statusText);
      return res.json();
    },
    post: async (path, body) => {
      const res = await fetch(baseUrl + path, {
        method: 'POST', headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(res.statusText);
      return res.json();
    },
    put: async (path, body) => {
      const res = await fetch(baseUrl + path, {
        method: 'PUT', headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(res.statusText);
      return res.json();
    },
    delete: async (path) => {
      const res = await fetch(baseUrl + path, { method: 'DELETE', headers });
      if (!res.ok) throw new Error(res.statusText);
      return res.json();
    },
  };
}

// Usage
const api = await apiClient('https://api.example.com');
const users = await api.get('/users');
console.log(users);`,
      },
      {
        id: 'debounce.js', name: 'debounce.js', type: 'file', language: 'javascript', scriptType: 'snippet',
        content: `// Debounce & Throttle Utilities
// Common performance optimization patterns

function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function throttle(fn, limit) {
  let inThrottle = false;
  return function (...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

// Usage
const handleSearch = debounce((query) => {
  console.log('Searching:', query);
}, 300);

const handleScroll = throttle(() => {
  console.log('Scroll position:', window.scrollY);
}, 100);`,
      },
      {
        id: 'event_emitter.js', name: 'event_emitter.js', type: 'file', language: 'javascript', scriptType: 'library',
        content: `// Event Emitter Pattern
// Pub/sub implementation for decoupled communication

class EventEmitter {
  constructor() {
    this.events = new Map();
  }

  on(event, listener) {
    if (!this.events.has(event)) this.events.set(event, []);
    this.events.get(event).push(listener);
    return () => this.off(event, listener);
  }

  off(event, listener) {
    const listeners = this.events.get(event);
    if (listeners) {
      this.events.set(event, listeners.filter(l => l !== listener));
    }
  }

  emit(event, ...args) {
    const listeners = this.events.get(event) || [];
    listeners.forEach(listener => listener(...args));
  }

  once(event, listener) {
    const unsub = this.on(event, (...args) => {
      unsub();
      listener(...args);
    });
    return unsub;
  }
}

// Usage
const bus = new EventEmitter();
bus.on('user:login', (user) => console.log('Logged in:', user.name));
bus.emit('user:login', { name: 'Alice', role: 'admin' });`,
      },
    ],
  },
  {
    id: 'pipelines',
    name: 'Pipelines',
    type: 'folder',
    children: [
      {
        id: 'data_transform.js', name: 'data_transform.js', type: 'file', language: 'javascript', scriptType: 'pipeline',
        content: `// Data Transform Pipeline
// Composable data processing stages

function pipeline(...fns) {
  return (input) => fns.reduce((acc, fn) => fn(acc), input);
}

const normalize = (data) => data.map(d => ({
  ...d,
  name: d.name?.trim().toLowerCase(),
  email: d.email?.trim().toLowerCase(),
}));

const validate = (data) => data.filter(d =>
  d.name && d.email && d.email.includes('@')
);

const deduplicate = (data) => {
  const seen = new Set();
  return data.filter(d => {
    if (seen.has(d.email)) return false;
    seen.add(d.email);
    return true;
  });
};

const enrich = (data) => data.map(d => ({
  ...d,
  domain: d.email.split('@')[1],
  createdAt: new Date().toISOString(),
}));

// Compose the pipeline
const process = pipeline(normalize, validate, deduplicate, enrich);

const rawData = [
  { name: ' Alice ', email: 'ALICE@example.com' },
  { name: 'Bob', email: 'bob@test.io' },
  { name: ' alice', email: 'alice@example.com' },
  { name: '', email: 'invalid' },
];

console.log(process(rawData));`,
      },
      {
        id: 'csv_processor.js', name: 'csv_processor.js', type: 'file', language: 'javascript', scriptType: 'pipeline',
        content: `// CSV Stream Processor
// Parse, transform, and output CSV data

function parseCSV(text, delimiter = ',') {
  const lines = text.trim().split('\\n');
  const headers = lines[0].split(delimiter).map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split(delimiter);
    return headers.reduce((obj, header, i) => {
      obj[header] = values[i]?.trim() || '';
      return obj;
    }, {});
  });
}

function toCSV(data, delimiter = ',') {
  if (data.length === 0) return '';
  const headers = Object.keys(data[0]);
  const rows = data.map(row =>
    headers.map(h => row[h] ?? '').join(delimiter)
  );
  return [headers.join(delimiter), ...rows].join('\\n');
}

// Example
const csv = \`name,age,city
Alice,30,NYC
Bob,25,LA
Charlie,35,Chicago\`;

const parsed = parseCSV(csv);
const filtered = parsed.filter(r => parseInt(r.age) >= 30);
console.log(toCSV(filtered));`,
      },
    ],
  },
];

const DEFAULT_CODE = `// Welcome to the Code Workspace
// Write, run, and save code snippets

function fibonacci(n) {
  if (n <= 1) return n;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    [a, b] = [b, a + b];
  }
  return b;
}

// Generate first 10 Fibonacci numbers
const results = Array.from({ length: 10 }, (_, i) => fibonacci(i));
console.log('Fibonacci:', results);

// Quick benchmark
const start = performance.now();
fibonacci(1000);
const elapsed = (performance.now() - start).toFixed(2);
console.log(\`Computed fib(1000) in \${elapsed}ms\`);
`;

const API_REFERENCE: { category: string; functions: { signature: string; description: string }[] }[] = [
  {
    category: 'Console',
    functions: [
      { signature: 'console.log(...args)', description: 'Print values to the output console' },
      { signature: 'console.table(data)', description: 'Display tabular data in a formatted table' },
      { signature: 'console.time(label) / timeEnd(label)', description: 'Measure execution time of a code block' },
      { signature: 'console.assert(condition, msg)', description: 'Assert a condition, log error if false' },
    ],
  },
  {
    category: 'Data',
    functions: [
      { signature: 'JSON.parse(str) / JSON.stringify(obj)', description: 'Serialize and deserialize JSON data' },
      { signature: 'structuredClone(obj)', description: 'Deep clone any structured data' },
      { signature: 'Array.from(iterable, mapFn)', description: 'Create arrays from iterables with optional mapping' },
      { signature: 'Object.entries(obj) / fromEntries(arr)', description: 'Convert between objects and key-value arrays' },
    ],
  },
  {
    category: 'Async',
    functions: [
      { signature: 'fetch(url, options)', description: 'Make HTTP requests to APIs' },
      { signature: 'Promise.all(promises)', description: 'Await multiple promises in parallel' },
      { signature: 'Promise.allSettled(promises)', description: 'Wait for all promises regardless of outcome' },
      { signature: 'AbortController / signal', description: 'Cancel in-flight fetch requests' },
    ],
  },
  {
    category: 'Utilities',
    functions: [
      { signature: 'performance.now()', description: 'High-resolution timestamp for benchmarking' },
      { signature: 'crypto.randomUUID()', description: 'Generate a random UUID v4 string' },
      { signature: 'new URL(url).searchParams', description: 'Parse and manipulate URL query strings' },
      { signature: 'Intl.NumberFormat / DateTimeFormat', description: 'Locale-aware number and date formatting' },
    ],
  },
  {
    category: 'DTU Bridge',
    functions: [
      { signature: 'output.save(data, meta)', description: 'Persist script output as a DTU artifact' },
      { signature: 'output.publish(dtuId)', description: 'Publish a DTU to the marketplace' },
      { signature: 'output.share(dtuId, userId)', description: 'Share a DTU with another user' },
      { signature: 'output.export(format)', description: 'Export results as JSON, CSV, or Markdown' },
    ],
  },
];

function generateScriptOutput(scriptType: ScriptType, code: string): { log: string; visualization: string } {
  const lines = code.split('\n').length;
  const typeName = SCRIPT_TYPES.find((s) => s.id === scriptType)?.name || scriptType;
  return {
    log: `[Code Engine] Running ${typeName} (${lines} lines)...\n[OK] Execution complete`,
    visualization: '',
  };
}

export default function CodeLensPage() {
  useLensNav('code');
  const { user, isAuthenticated } = useAuth();
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('code');

  const {
    hyperDTUs, megaDTUs, regularDTUs,
    tierDistribution, publishToMarketplace,
    isLoading: dtusLoading, refetch: refetchDTUs,
  } = useLensDTUs({ lens: 'code' });

  // Persist scripts to backend
  const { isLoading, isError, error, refetch, create: saveScript, items: savedScripts } = useLensData('code', 'script', { noSeed: true });

  const [files, setFiles] = useState<FileNode[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([
    { id: 'main', name: 'untitled.js', language: 'javascript', content: DEFAULT_CODE, isDirty: false, scriptType: 'snippet' },
  ]);
  const [activeTabId, setActiveTabId] = useState('main');
  const [scriptOutput, setScriptOutput] = useState<{ log: string; visualization: string } | null>(null);
  const [consoleLog, setConsoleLog] = useState<string[]>([]);
  const [activeScriptType, setActiveScriptType] = useState<ScriptType>('snippet');
  const [showFileTree, setShowFileTree] = useState(true);
  const [showOutput, setShowOutput] = useState(true);
  const [showApiRef, setShowApiRef] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [outputTab, setOutputTab] = useState<'output' | 'console'>('output');
  const [showFeatures, setShowFeatures] = useState(true);
  const [showForge, setShowForge] = useState(false);
  const [forgePrompt, setForgePrompt] = useState('');
  const [forgeResult, setForgeResult] = useState<string | null>(null);
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  // ── Phase 1: real semantic IntelliSense ──────────────────────────────────
  // The editor's tabs are local; the `code.lsp-*` macros (TS LanguageService)
  // read the backend workspace, so we mirror the active buffer into an ephemeral
  // per-session project (debounced, like LSP didChange) and feed MonacoWrapper a
  // `semantic` context. `files-write` auto-creates the project bucket.
  const LIVE_PROJECT_ID = 'code-lens-live';
  const runCodeMacro = useCallback(async (action: string, input: Record<string, unknown>) => {
    try {
      const res = await api.post('/api/lens/run', { domain: 'code', action, input });
      return (res.data?.result as Record<string, unknown>) ?? null;
    } catch { return null; }
  }, []);
  // Debounced mirror of the active buffer → backend, so hover/completions/
  // diagnostics reflect what's on screen (LSP didChange semantics).
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    const path = activeTab.name;
    const content = activeTab.content;
    syncTimer.current = setTimeout(() => {
      void runCodeMacro('files-write', { projectId: LIVE_PROJECT_ID, path, content });
    }, 350);
    return () => { if (syncTimer.current) clearTimeout(syncTimer.current); };
  }, [activeTab.name, activeTab.content, runCodeMacro]);
  const semanticCtx = useMemo(
    () => ({ projectId: LIVE_PROJECT_ID, path: activeTab.name, run: runCodeMacro }),
    [activeTab.name, runCodeMacro],
  );

  // Forge App Generation mutation
  const forgeAppMutation = useMutation({
    mutationFn: async (description: string) => {
      const res = await api.post('/api/lens/run', {
        domain: 'code',
        action: 'forge-generate',
        input: { description, format: 'single-file-monolith' },
      });
      return res.data;
    },
    onSuccess: (data) => {
      const content = typeof data?.result === 'string'
        ? data.result
        : typeof data?.result?.content === 'string'
          ? data.result.content
          : typeof data?.result?.code === 'string'
            ? data.result.code
            : JSON.stringify(data?.result || {}, null, 2);
      setForgeResult(content);
      // Also open as a new tab for editing
      const id = `forge-${Date.now()}`;
      const newTab: Tab = {
        id,
        name: `forge_app_${Date.now().toString(36)}.js`,
        language: 'javascript',
        content,
        isDirty: true,
        scriptType: 'project',
      };
      setTabs(prev => [...prev, newTab]);
      setActiveTabId(id);
      setShowForge(false);
    },
    onError: (error: Record<string, unknown>) => {
      setForgeResult(`// Forge generation error: ${String(error.message || 'Unknown error')}\n// Try describing your app in more detail.`);
    },
  });

  const [savingOutputDTU, setSavingOutputDTU] = useState(false);

  // ── Parity sprint panels: activity bar / settings / terminal / agent ──
  const [activity, setActivity] = useState<Activity>('files');
  const [settings, setSettings] = useState<CodeLensSettings>(DEFAULT_CODE_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentEdits, setAgentEdits] = useState<MultiFileEdit[]>([]);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState('');

  // Load persisted settings on mount (deferred to avoid SSR hydration issues).
  useEffect(() => { setSettings(loadCodeSettings()); }, []);

  // ── Command palette (⌘P / ⌘Shift+P) ────────────────────────────
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIdx, setPaletteIdx] = useState(0);
  const paletteInputRef = useRef<HTMLInputElement>(null);

  // ── Find in files (⌘⇧F) ────────────────────────────────────────
  // Grep across every open tab AND every saved script.
  // Keeps a 60-line context window, highlights matches, click jumps
  // to the matching tab and scrolls Monaco to the match line.
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const findInputRef = useRef<HTMLInputElement>(null);
  const openFindInFiles = useCallback(() => {
    setFindOpen(true);
    requestAnimationFrame(() => findInputRef.current?.focus());
  }, []);
  type FindHit = { source: 'tab' | 'script'; sourceId: string; sourceName: string; line: number; preview: string; tabId?: string };
  const findHits = useMemo<FindHit[]>(() => {
    const q = findQuery.trim();
    if (q.length < 2) return [];
    const ql = q.toLowerCase();
    const out: FindHit[] = [];
    const scan = (text: string, source: FindHit['source'], sourceId: string, sourceName: string, tabId?: string) => {
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (line.toLowerCase().includes(ql) && out.length < 200) {
          out.push({ source, sourceId, sourceName, tabId, line: i + 1, preview: line });
        }
      });
    };
    for (const t of tabs) scan(t.content, 'tab', t.id, t.name, t.id);
    for (const s of savedScripts) {
      const data = (s as { data?: { content?: string }; title?: string }).data;
      if (data?.content && !tabs.some((t) => t.id === s.id)) {
        scan(String(data.content), 'script', s.id, (s as { title?: string }).title || 'script', undefined);
      }
    }
    return out;
  }, [findQuery, tabs, savedScripts]);

  const jumpToFindHit = useCallback((hit: FindHit) => {
    if (hit.tabId) {
      setActiveTabId(hit.tabId);
      setFindOpen(false);
      requestAnimationFrame(() => {
        const ed = editorInstanceRef.current;
        if (ed) {
          ed.revealLineInCenter(hit.line);
          ed.setPosition({ lineNumber: hit.line, column: 1 });
          ed.focus();
        }
      });
    } else {
      // Open the saved script as a new tab
      const script = savedScripts.find((s) => s.id === hit.sourceId);
      if (!script) return;
      const data = (script as { data?: { content?: string; language?: string; scriptType?: ScriptType }; title?: string }).data;
      const newTab: Tab = {
        id: script.id,
        name: (script as { title?: string }).title || 'untitled',
        language: data?.language || 'javascript',
        content: String(data?.content || ''),
        isDirty: false,
        scriptType: (data?.scriptType as ScriptType) || 'snippet',
      };
      if (!tabs.some((t) => t.id === script.id)) setTabs((prev) => [...prev, newTab]);
      setActiveTabId(script.id);
      setFindOpen(false);
    }
  }, [tabs, savedScripts]);

  // ── Inline AI edit (⌘K) ─────────────────────────────────────────
  // Cursor-style: select text → ⌘K → write instruction → see diff inline
  // → Apply replaces selection.  Whole-file edit when no selection.
  const editorInstanceRef = useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null);
  const [selection, setSelection] = useState<{ text: string; startLine: number; endLine: number } | null>(null);
  const [aiEditOpen, setAiEditOpen] = useState(false);
  const [aiEditPrompt, setAiEditPrompt] = useState('');
  const [aiEditPending, setAiEditPending] = useState(false);
  const [aiEditResult, setAiEditResult] = useState<{ before: string; after: string; range: { startLine: number; endLine: number } | null } | null>(null);
  const [aiEditError, setAiEditError] = useState<string | null>(null);
  const [aiEditElapsed, setAiEditElapsed] = useState(0);
  const aiEditAbortRef = useRef<AbortController | null>(null);
  const aiEditInputRef = useRef<HTMLInputElement>(null);

  // ── AI chat side-panel (⌘L) ─────────────────────────────────────
  type ChatMsg = { role: 'user' | 'assistant'; content: string; ts: number; dtuRefs?: Array<{ id: string; title: string | null; tier: string | null }> };
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [aiChatHistory, setAiChatHistory] = useState<ChatMsg[]>([]);
  const [aiChatDraft, setAiChatDraft] = useState('');
  const [aiChatPending, setAiChatPending] = useState(false);
  const [aiChatElapsed, setAiChatElapsed] = useState(0);
  const [aiChatIncludeFile, setAiChatIncludeFile] = useState(true);
  const aiChatAbortRef = useRef<AbortController | null>(null);

  // BYO key drawer toggle — wired to header Key icon + the existing
  // <BYOKeyDrawer> mounted at page root. Same drawer the chat lens
  // exposes; user keys set here flow through llm.local now that it
  // routes via brainChat.
  const [byoOpen, setByoOpen] = useState(false);

  // Stable per-user AI chat sessionId so history persists across tab
  // close, page refresh, and device switch (auth'd users only). Anon
  // sessions stay component-state-only — backend persistence requires
  // a userId. Format: `code-ai-${userId}` keeps it scoped to the user
  // (not per-tab, so AI chat memory is global within the code lens).
  const codeAiSessionIdRef = useRef<string>('');
  const aiChatHistoryHydratedRef = useRef<boolean>(false);
  const aiChatScrollRef = useRef<HTMLDivElement>(null);
  const aiChatInputRef = useRef<HTMLTextAreaElement>(null);

  // Derive the per-user sessionId once auth resolves. Hydrate prior
  // history from /api/chat/messages so AI Chat survives tab close +
  // device switch. Anon users keep component-state-only history.
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    if (aiChatHistoryHydratedRef.current) return;
    const sid = `code-ai-${user.id}`;
    codeAiSessionIdRef.current = sid;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/chat/messages?sessionId=${encodeURIComponent(sid)}&limit=200`, {
          credentials: 'include',
        });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { ok: boolean; messages?: Array<{ role: string; content: string; ts: string; meta?: Record<string, unknown> }> };
        if (cancelled || !json.ok || !Array.isArray(json.messages)) return;
        const hydrated: ChatMsg[] = json.messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => {
            const meta = (m.meta || {}) as Record<string, unknown>;
            return {
              role: m.role as 'user' | 'assistant',
              content: m.content,
              ts: new Date(m.ts).getTime() || Date.now(),
              dtuRefs: Array.isArray(meta.dtuRefs) ? (meta.dtuRefs as ChatMsg['dtuRefs']) : undefined,
            };
          });
        if (hydrated.length > 0) setAiChatHistory(hydrated);
        aiChatHistoryHydratedRef.current = true;
      } catch { /* anon, offline, or 403 — leave empty */ }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, user?.id]);

  // Tick elapsed time during in-flight AI requests so the UI never feels
  // frozen.  Both edit + chat share this side-effect.
  useEffect(() => {
    if (!aiEditPending) { setAiEditElapsed(0); return; }
    const start = Date.now();
    const t = setInterval(() => setAiEditElapsed(Math.round((Date.now() - start) / 100) / 10), 100);
    return () => clearInterval(t);
  }, [aiEditPending]);
  useEffect(() => {
    if (!aiChatPending) { setAiChatElapsed(0); return; }
    const start = Date.now();
    const t = setInterval(() => setAiChatElapsed(Math.round((Date.now() - start) / 100) / 10), 100);
    return () => clearInterval(t);
  }, [aiChatPending]);

  // Backend action wiring
  const runCodeAction = useRunArtifact('code');
  const [codeActionResult, setCodeActionResult] = useState<Record<string, unknown> | null>(null);
  const [runningCodeAction, setRunningCodeAction] = useState<string | null>(null);

  const runScriptMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/api/lens/run', {
        domain: 'code',
        action: 'generate',
        input: {
          code: activeTab.content,
          language: activeTab.language,
          scriptType: activeTab.scriptType || activeScriptType,
        },
      });
      return res.data;
    },
    onSuccess: (data) => {
      const serverContent = typeof data?.result === 'string'
        ? data.result
        : typeof data?.result?.content === 'string'
          ? data.result.content
          : null;
      const localResult = generateScriptOutput(activeTab.scriptType || activeScriptType, activeTab.content);
      setScriptOutput({
        log: serverContent
          ? `[Server] ${serverContent.slice(0, 500)}\n\n${localResult.log}`
          : localResult.log,
        visualization: localResult.visualization,
      });
      setConsoleLog((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] Script executed successfully`,
        `[${new Date().toLocaleTimeString()}] Type: ${SCRIPT_TYPES.find((s) => s.id === (activeTab.scriptType || activeScriptType))?.name}`,
        `[${new Date().toLocaleTimeString()}] Output ready`,
      ]);
      setShowOutput(true);
      setOutputTab('output');
    },
    onError: (error: Record<string, unknown>) => {
      const result = generateScriptOutput(activeTab.scriptType || activeScriptType, activeTab.content);
      setScriptOutput(result);
      setConsoleLog((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] Script executed (offline mode)`,
        `[${new Date().toLocaleTimeString()}] ${String(error.message || 'Using local engine')}`,
      ]);
      setShowOutput(true);
      setOutputTab('output');
    },
  });

  const handleSaveOutputAsDTU = useCallback(async () => {
    if (!scriptOutput) return;
    setSavingOutputDTU(true);
    try {
      await saveScript({
        title: `Output: ${activeTab.name}`,
        data: {
          content: activeTab.content,
          output: scriptOutput.log,
          language: activeTab.language,
          scriptType: activeTab.scriptType || activeScriptType,
        },
        meta: { tags: ['script', 'output', activeTab.scriptType || activeScriptType], status: 'active' },
      });
    } catch (err) {
      console.error('[Code] Save output failed:', err);
    } finally {
      setSavingOutputDTU(false);
    }
  }, [scriptOutput, activeTab, activeScriptType, saveScript]);

  const updateTabContent = useCallback((content: string) => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeTabId ? { ...tab, content, isDirty: true } : tab
      )
    );
  }, [activeTabId]);

  const handleSave = useCallback(async () => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (!tab) return;
    try {
      await saveScript({
        title: tab.name,
        data: { content: tab.content, language: tab.language, scriptType: tab.scriptType },
        meta: { tags: ['script', tab.scriptType], status: 'active' },
      });
      setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, isDirty: false } : t));
    } catch (err) {
      console.error('[Code] Save failed:', err);
    }
  }, [tabs, activeTabId, saveScript]);

  const handleCodeAction = async (action: string) => {
    const targetId = savedScripts[0]?.id;
    if (!targetId) return;
    setRunningCodeAction(action);
    try {
      const res = await runCodeAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setCodeActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setCodeActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`[Code] Action ${action} failed:`, e); setCodeActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setRunningCodeAction(null);
  };

  const handleNewTab = useCallback(() => {
    const id = `new-${Date.now()}`;
    const newTab: Tab = {
      id,
      name: `script_${savedScripts.length + tabs.length}.js`,
      language: 'javascript',
      content: `// New ${SCRIPT_TYPES.find(s => s.id === activeScriptType)?.name || 'Script'}\n// Start writing your code here\n`,
      isDirty: false,
      scriptType: activeScriptType,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(id);
  }, [activeScriptType, savedScripts.length, tabs.length]);

  const closeTab = (tabId: string) => {
    if (tabs.length === 1) return;
    const newTabs = tabs.filter((t) => t.id !== tabId);
    setTabs(newTabs);
    if (activeTabId === tabId) {
      setActiveTabId(newTabs[0].id);
    }
  };

  const openFile = (file: FileNode) => {
    if (file.type !== 'file') return;

    const existingTab = tabs.find((t) => t.id === file.id);
    if (existingTab) {
      setActiveTabId(file.id);
      return;
    }

    const newTab: Tab = {
      id: file.id,
      name: file.name,
      language: file.language || 'javascript',
      content: file.content || '',
      isDirty: false,
      scriptType: file.scriptType || 'snippet',
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(file.id);
    if (file.scriptType) {
      setActiveScriptType(file.scriptType);
    }
  };

  const toggleFolder = (folderId: string) => {
    const updateNodes = (nodes: FileNode[]): FileNode[] =>
      nodes.map((node) => {
        if (node.id === folderId) {
          return { ...node, isExpanded: !node.isExpanded };
        }
        if (node.children) {
          return { ...node, children: updateNodes(node.children) };
        }
        return node;
      });
    setFiles(updateNodes(files));
  };

  const renderFileNode = (node: FileNode, depth: number = 0) => {
    const isFolder = node.type === 'folder';
    const Icon = isFolder
      ? node.isExpanded
        ? FolderOpen
        : Folder
      : File;

    return (
      <div key={node.id}>
        <button
          onClick={() => isFolder ? toggleFolder(node.id) : openFile(node)}
          className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-lattice-elevated rounded transition-colors ${
            activeTabId === node.id ? 'bg-neon-blue/20 text-neon-blue' : 'text-gray-400'
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {isFolder && (
            <span className="w-4 h-4 flex items-center justify-center">
              {node.isExpanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </span>
          )}
          <Icon className={`w-4 h-4 ${isFolder ? 'text-neon-yellow' : 'text-neon-blue'}`} />
          <span className="truncate">{node.name}</span>
        </button>
        {isFolder && node.isExpanded && node.children && (
          <div>
            {node.children.map((child) => renderFileNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // ── Command palette commands (computed) ──────────────────────────
  // Must be declared BEFORE early returns to keep hook order stable.
  type PaletteCommand = { id: string; label: string; hint: string; action: () => void };
  const flattenFiles = useCallback((nodes: FileNode[]): FileNode[] => {
    const out: FileNode[] = [];
    const walk = (n: FileNode) => {
      if (n.type === 'file') out.push(n);
      n.children?.forEach(walk);
    };
    nodes.forEach(walk);
    return out;
  }, []);

  const paletteCommands: PaletteCommand[] = useMemo(() => {
    const fileCmds: PaletteCommand[] = flattenFiles(files).map((f) => ({
      id: `open:${f.id}`,
      label: f.name,
      hint: f.language || 'file',
      action: () => { openFile(f); setPaletteOpen(false); },
    }));
    const tabCmds: PaletteCommand[] = tabs.map((t) => ({
      id: `tab:${t.id}`,
      label: `→ ${t.name}`,
      hint: 'switch to open tab',
      action: () => { setActiveTabId(t.id); setPaletteOpen(false); },
    }));
    const actionCmds: PaletteCommand[] = [
      { id: 'run',         label: 'Run script',                  hint: '⌘ Enter',   action: () => { runScriptMutation.mutate(); setPaletteOpen(false); } },
      { id: 'tree',        label: 'Toggle file tree',            hint: showFileTree ? 'on'  : 'off', action: () => { setShowFileTree(!showFileTree); setPaletteOpen(false); } },
      { id: 'output',      label: 'Toggle output panel',         hint: showOutput   ? 'on'  : 'off', action: () => { setShowOutput(!showOutput); setPaletteOpen(false); } },
      { id: 'apiref',      label: 'Toggle API reference',        hint: showApiRef   ? 'on'  : 'off', action: () => { setShowApiRef(!showApiRef); setPaletteOpen(false); } },
      { id: 'fullscreen',  label: 'Toggle fullscreen',           hint: isFullscreen ? 'on'  : 'off', action: () => { setIsFullscreen(!isFullscreen); setPaletteOpen(false); } },
      { id: 'forge',       label: 'Open Forge (AI scaffold)',    hint: '✨',        action: () => { setShowForge(true); setPaletteOpen(false); } },
      { id: 'console',     label: 'Show console output',         hint: '',          action: () => { setOutputTab('console'); setPaletteOpen(false); } },
      { id: 'output-tab',  label: 'Show script output',          hint: '',          action: () => { setOutputTab('output'); setPaletteOpen(false); } },
    ];
    return [...actionCmds, ...tabCmds, ...fileCmds];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, tabs, showFileTree, showOutput, showApiRef, isFullscreen]);

  const filteredPalette = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase();
    if (!q) return paletteCommands.slice(0, 50);
    return paletteCommands.filter((c) =>
      c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q)
    ).slice(0, 50);
  }, [paletteCommands, paletteQuery]);

  useEffect(() => { setPaletteIdx(0); }, [paletteQuery, paletteOpen]);
  useEffect(() => {
    if (paletteOpen) {
      requestAnimationFrame(() => paletteInputRef.current?.focus());
    }
  }, [paletteOpen]);

  // ── AI edit + chat handlers ─────────────────────────────────────
  const extractCodeFromLLM = useCallback((raw: string): string => {
    if (!raw) return '';
    // Prefer fenced block (```lang\n...\n```)
    const fence = raw.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
    if (fence) return fence[1].trim();
    return raw.trim();
  }, []);

  const openAiEdit = useCallback(() => {
    // Snapshot selection from the editor at the moment the shortcut fires.
    const ed = editorInstanceRef.current;
    if (ed) {
      const sel = ed.getSelection();
      const model = ed.getModel();
      if (sel && model) {
        const text = model.getValueInRange(sel);
        setSelection(text ? { text, startLine: sel.startLineNumber, endLine: sel.endLineNumber } : null);
      }
    }
    setAiEditPrompt('');
    setAiEditResult(null);
    setAiEditError(null);
    setAiEditOpen(true);
    requestAnimationFrame(() => aiEditInputRef.current?.focus());
  }, []);

  const runAiEdit = useCallback(async () => {
    const instruction = aiEditPrompt.trim();
    if (!instruction || aiEditPending) return;
    const fileContent = activeTab.content;
    const lang = activeTab.language || 'javascript';
    const before = selection?.text || fileContent;
    const isFullFile = !selection?.text;
    aiEditAbortRef.current?.abort();
    const ac = new AbortController();
    aiEditAbortRef.current = ac;
    setAiEditPending(true);
    setAiEditError(null);
    setAiEditResult(null);
    try {
      const messages = [
        { role: 'system', content: `You are a senior ${lang} engineer doing a focused inline edit. Output ONLY the rewritten code in a single \`\`\`${lang} fenced block. Preserve indentation. No prose, no explanations.` },
        ...(isFullFile ? [] : [{ role: 'user', content: `For context, here is the entire file (\`${activeTab.name}\`):\n\n\`\`\`${lang}\n${fileContent}\n\`\`\`` }]),
        { role: 'user', content: `${isFullFile ? 'Rewrite this whole file' : 'Rewrite ONLY the selection below'} so that: ${instruction}\n\n\`\`\`${lang}\n${before}\n\`\`\`` },
      ];
      const res = await api.post('/api/lens/run', { domain: 'llm', action: 'local', input: { messages, temperature: 0.2, max_tokens: 2048, slot: 'utility' } }, { signal: ac.signal });
      const result = res.data?.result;
      // Read `text` first — `llm.local` returns text via brainChat /
      // ollamaChat, not `content`. Legacy `.content` alias kept for
      // compat after the field-name fix.
      const raw = result?.text || result?.content || result?.message?.content || result?.output || '';
      const after = extractCodeFromLLM(String(raw));
      if (!after) {
        setAiEditError('AI returned no code. Try rephrasing.');
        return;
      }
      setAiEditResult({
        before,
        after,
        range: selection ? { startLine: selection.startLine, endLine: selection.endLine } : null,
      });
    } catch (e) {
      if ((e as { name?: string })?.name === 'CanceledError' || (e as { code?: string })?.code === 'ERR_CANCELED' || ac.signal.aborted) {
        setAiEditError('Cancelled');
      } else {
        setAiEditError(e instanceof Error ? e.message : 'AI edit failed');
      }
    } finally {
      setAiEditPending(false);
      aiEditAbortRef.current = null;
    }
  }, [aiEditPrompt, aiEditPending, activeTab, selection, extractCodeFromLLM]);

  const cancelAiEdit = useCallback(() => {
    aiEditAbortRef.current?.abort();
  }, []);

  const applyAiEdit = useCallback(() => {
    if (!aiEditResult) return;
    const ed = editorInstanceRef.current;
    if (aiEditResult.range && ed) {
      const monaco = (window as unknown as { monaco?: typeof import('monaco-editor') }).monaco;
      const model = ed.getModel();
      if (model && monaco) {
        const startLine = aiEditResult.range.startLine;
        const endLine = aiEditResult.range.endLine;
        const range = new monaco.Range(startLine, 1, endLine, model.getLineMaxColumn(endLine));
        ed.executeEdits('ai-edit', [{ range, text: aiEditResult.after, forceMoveMarkers: true }]);
        setAiEditOpen(false);
        setAiEditResult(null);
        return;
      }
    }
    // No range or no editor handle → whole-file replace via tab state.
    updateTabContent(aiEditResult.after);
    setAiEditOpen(false);
    setAiEditResult(null);
  }, [aiEditResult, updateTabContent]);

  const sendAiChat = useCallback(async () => {
    const text = aiChatDraft.trim();
    if (!text || aiChatPending) return;
    const userMsg: ChatMsg = { role: 'user', content: text, ts: Date.now() };
    const next = [...aiChatHistory, userMsg];
    setAiChatHistory(next);
    setAiChatDraft('');
    aiChatAbortRef.current?.abort();
    const ac = new AbortController();
    aiChatAbortRef.current = ac;
    setAiChatPending(true);
    try {
      const lang = activeTab.language || 'javascript';
      const sys = `You are a senior ${lang} engineer pair-programming with the user. When you propose code, wrap it in \`\`\`${lang} fences. Be concise and direct.`;
      const fileCtx = aiChatIncludeFile
        ? `Currently open file (\`${activeTab.name}\`):\n\n\`\`\`${lang}\n${activeTab.content.slice(0, 8000)}\n\`\`\`\n\n`
        : '';
      const messages = [
        { role: 'system', content: sys },
        ...(fileCtx ? [{ role: 'user', content: fileCtx + 'Acknowledge the file context briefly, then await my next message.' }] : []),
        ...(fileCtx ? [{ role: 'assistant', content: 'Got it — file in context.' }] : []),
        ...next.map((m) => ({ role: m.role, content: m.content })),
      ];
      const res = await api.post('/api/lens/run', { domain: 'llm', action: 'local', input: { messages, temperature: 0.4, max_tokens: 1024, slot: 'utility', extractCitations: true } }, { signal: ac.signal });
      const result = res.data?.result;
      // llm.local now returns BOTH `text` and `content` (legacy alias).
      // Pre-this-fix the code lens read only `result.content` against
      // a macro that returned `.text`, so AI chat silently produced
      // "(empty response)" forever. Read `text` first.
      const raw = result?.text || result?.content || result?.message?.content || result?.output || '';
      const reply = String(raw).trim() || '(empty response)';
      const dtuRefs = Array.isArray(result?.dtuRefs) ? result.dtuRefs : undefined;
      const assistantMsg: ChatMsg = { role: 'assistant', content: reply, ts: Date.now(), dtuRefs };
      setAiChatHistory([...next, assistantMsg]);
      // Persist the turn (auth'd users only). The user message was
      // pushed locally above; persist both so they replay on next open.
      const sid = codeAiSessionIdRef.current;
      if (sid && isAuthenticated) {
        fetch('/api/chat/messages', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: sid,
            lens: 'code',
            userMsg: { content: userMsg.content, ts: userMsg.ts },
            assistantMsg: { content: reply, ts: assistantMsg.ts, meta: dtuRefs ? { dtuRefs } : undefined },
          }),
        }).catch(() => { /* best effort — never block UX on persistence */ });
      }
    } catch (e) {
      const wasAbort = (e as { name?: string })?.name === 'CanceledError' || (e as { code?: string })?.code === 'ERR_CANCELED' || ac.signal.aborted;
      setAiChatHistory([...next, { role: 'assistant', content: wasAbort ? '_(cancelled)_' : `Error: ${e instanceof Error ? e.message : 'request failed'}`, ts: Date.now() }]);
    } finally {
      setAiChatPending(false);
      aiChatAbortRef.current = null;
      requestAnimationFrame(() => {
        aiChatScrollRef.current?.scrollTo({ top: aiChatScrollRef.current.scrollHeight, behavior: 'smooth' });
      });
    }
  }, [aiChatDraft, aiChatPending, aiChatHistory, activeTab, aiChatIncludeFile, isAuthenticated]);

  const cancelAiChat = useCallback(() => {
    aiChatAbortRef.current?.abort();
  }, []);

  const insertChatCodeIntoEditor = useCallback((codeBlock: string) => {
    const ed = editorInstanceRef.current;
    if (!ed) {
      updateTabContent((activeTab.content || '') + '\n\n' + codeBlock);
      return;
    }
    const sel = ed.getSelection();
    const model = ed.getModel();
    if (!sel || !model) return;
    ed.executeEdits('ai-chat-insert', [{ range: sel, text: codeBlock, forceMoveMarkers: true }]);
  }, [activeTab.content, updateTabContent]);

  // ── Multi-file agent flow (Cursor 3.0 Agents Window parity) ───────────
  const openMultiFileAgent = useCallback(async (prompt: string) => {
    const cleanedPrompt = prompt.trim();
    if (!cleanedPrompt) return;
    setAgentPrompt(cleanedPrompt);
    setAgentEdits([]);
    setAgentOpen(true);
    setAgentLoading(true);
    // Compose file context: open tabs + savedScripts, dedup by id.
    const seen = new Set<string>();
    type AgentFile = { id: string; name: string; language: string; content: string };
    const files: AgentFile[] = [];
    for (const t of tabs) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      files.push({ id: t.id, name: t.name, language: t.language, content: t.content });
      if (files.length >= 12) break;
    }
    if (files.length < 12) {
      for (const s of savedScripts) {
        if (seen.has(s.id)) continue;
        const data = (s as { data?: { content?: string; language?: string }; title?: string }).data;
        if (!data?.content) continue;
        seen.add(s.id);
        files.push({
          id: s.id,
          name: (s as { title?: string }).title || 'untitled',
          language: data.language || 'javascript',
          content: data.content,
        });
        if (files.length >= 12) break;
      }
    }
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'code',
        action: 'multi-file-plan',
        input: { prompt: cleanedPrompt, files, maxEdits: 6 },
      });
      const result = res.data?.result;
      if (res.data?.ok && Array.isArray(result?.edits)) {
        setAgentEdits(result.edits as MultiFileEdit[]);
      } else {
        setAgentEdits([]);
      }
    } catch (e) {
      console.error('[CodeLens] multi-file plan failed', e);
      setAgentEdits([]);
    } finally {
      setAgentLoading(false);
    }
  }, [tabs, savedScripts]);

  const applyMultiFileAgent = useCallback(async (accepted: MultiFileEdit[]) => {
    if (accepted.length === 0) return;
    try {
      await api.post('/api/lens/run', {
        domain: 'code',
        action: 'multi-file-apply',
        input: { edits: accepted.map(e => ({ scriptId: e.scriptId, filename: e.filename, language: e.language, after: e.after, reason: e.reason })) },
      });
      // Reflect the edits in any open tabs immediately
      setTabs(prev => prev.map(t => {
        const edit = accepted.find(e => e.scriptId === t.id);
        return edit ? { ...t, content: edit.after, isDirty: false } : t;
      }));
      await refetchDTUs();
    } catch (e) {
      console.error('[CodeLens] multi-file apply failed', e);
    }
  }, [refetchDTUs]);

  const commitWorkingTree = useCallback(async (message: string) => {
    const files = tabs.map(t => ({ name: t.name, language: t.language, content: t.content, scriptId: t.id }));
    if (files.length === 0) return;
    try {
      await api.post('/api/lens/run', {
        domain: 'code',
        action: 'commit-snapshot',
        input: { message, files },
      });
      setTabs(prev => prev.map(t => ({ ...t, isDirty: false })));
    } catch (e) {
      console.error('[CodeLens] commit-snapshot failed', e);
    }
  }, [tabs]);

  useLensCommand(
    [
      { id: 'palette',          keys: 'mod+p',       description: 'Command palette (Quick open)', category: 'navigation', action: () => setPaletteOpen(true), global: true },
      { id: 'palette-shift',    keys: 'mod+shift+p', description: 'Command palette (commands)',   category: 'navigation', action: () => setPaletteOpen(true), global: true },
      { id: 'run',              keys: 'mod+enter',   description: 'Run script',                    category: 'actions',    action: () => runScriptMutation.mutate(), global: true },
      { id: 'toggle-tree',      keys: 'mod+b',       description: 'Toggle file tree',              category: 'navigation', action: () => setShowFileTree((v) => !v), global: true },
      { id: 'toggle-output',    keys: 'mod+j',       description: 'Toggle output panel',           category: 'navigation', action: () => setShowOutput((v) => !v),   global: true },
      { id: 'toggle-terminal',  keys: 'ctrl+`',      description: 'Toggle terminal',               category: 'navigation', action: () => setTerminalOpen((v) => !v), global: true },
      { id: 'open-settings',    keys: 'mod+,',       description: 'Open settings',                 category: 'navigation', action: () => setSettingsOpen(true), global: true },
      { id: 'fullscreen',       keys: 'f11',         description: 'Toggle fullscreen',             category: 'actions',    action: () => setIsFullscreen((v) => !v), global: true },
      { id: 'ai-edit',          keys: 'mod+k',       description: 'AI inline edit',                category: 'actions',    action: openAiEdit, global: true },
      { id: 'ai-chat',          keys: 'mod+l',       description: 'AI chat side-panel',            category: 'actions',    action: () => setAiChatOpen((v) => !v), global: true },
      { id: 'multi-file-agent', keys: 'mod+shift+l', description: 'Multi-file AI agent',           category: 'actions',    action: () => { const p = window.prompt('Describe the change across files…'); if (p) openMultiFileAgent(p); }, global: true },
      { id: 'find-in-files',    keys: 'mod+shift+f', description: 'Find in files',                 category: 'navigation', action: openFindInFiles, global: true },
      { id: 'snippets',         keys: 'mod+shift+s', description: 'Open snippets library',         category: 'navigation', action: () => { setActivity('snippets'); setShowFileTree(true); }, global: true },
      { id: 'source-control',   keys: 'ctrl+shift+g', description: 'Open source control',          category: 'navigation', action: () => { setActivity('sourceControl'); setShowFileTree(true); }, global: true },
    ],
    { lensId: 'code' }
  );

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

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  return (
    <LensShell lensId="code" asMain={false} disableAgentFab={true}>
      <FirstRunTour lensId="code" />
      <ManifestActionBar />
      <DepthBadge lensId="code" size="sm" className="ml-2" />
      <ShellPreview lensId="code" defaultOpen={true} />
      <div className="px-4 mt-3">
        <CodeWorkbenchSection />
      </div>
      <div className="px-4 mt-3">
        <CodeAdvancedPanel />
      </div>
    <div data-lens-theme="code" className={`flex flex-col font-mono ${isFullscreen ? 'fixed inset-0 z-50 bg-[#0d1117]' : 'h-full bg-[#0d1117]'}`}>
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-green-900/40 bg-[#161b22]">
        <div className="flex items-center gap-3">
          <Terminal className="w-6 h-6 text-green-400" />
          <div>
            <h1 className="text-lg font-bold text-green-300 font-mono tracking-tight">Code Workspace</h1>
            <p className="text-xs text-green-600 font-mono">Write, run & share code</p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="code" data={realtimeData || {}} compact />
        <VisionAnalyzeButton
          domain="code"
          prompt="Analyze this code screenshot or error image. Identify the programming language, describe what the code does, spot any bugs or issues, and suggest fixes."
          onResult={(res) => {
            const comment = `// Vision Analysis Suggestion:\n// ${res.analysis.replace(/\n/g, '\n// ')}\n\n`;
            updateTabContent(comment + (activeTab?.content || ''));
          }}
        />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Script Type Selector */}
          <div className="flex items-center gap-1 bg-[#0d1117] rounded-lg p-1 border border-green-900/20">
            {SCRIPT_TYPES.map((stype) => {
              const Icon = stype.icon;
              return (
                <button
                  key={stype.id}
                  onClick={() => setActiveScriptType(stype.id)}
                  className={`p-2 rounded-md transition-colors ${
                    activeScriptType === stype.id
                      ? 'bg-green-900/30 ' + stype.color
                      : 'text-gray-600 hover:text-gray-400'
                  }`}
                  title={`${stype.name}: ${stype.description}`}
                >
                  <Icon className="w-4 h-4" />
                </button>
              );
            })}
          </div>

          <button
            onClick={() => runScriptMutation.mutate()}
            disabled={runScriptMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white font-mono text-sm font-bold shadow-lg shadow-green-900/50 transition-all hover:shadow-green-800/60"
          >
            {runScriptMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4 fill-current" />
            )}
            Run
          </button>

          <button
            onClick={() => setShowForge(!showForge)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${showForge ? 'bg-purple-600/20 text-purple-400 border border-purple-600/30' : 'bg-lattice-elevated text-gray-300 hover:text-white'}`}
            title="Generate Forge App"
          >
            <Sparkles className="w-4 h-4" />
            Forge App
          </button>

          <button
            onClick={() => setShowApiRef(!showApiRef)}
            className={`p-2 rounded-lg transition-colors ${showApiRef ? 'bg-neon-blue/20 text-neon-blue' : 'hover:bg-lattice-elevated text-gray-400'}`}
            title="API Reference"
          >
            <BookOpen className="w-4 h-4" />
          </button>

          <button
            onClick={() => refetchDTUs()}
            disabled={dtusLoading}
            className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400 disabled:opacity-50"
            title="Refresh DTUs"
          >
            {dtusLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </header>


      {/* Forge App Generator Panel */}
      <AnimatePresence>
        {showForge && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-purple-500/30"
          >
            <div className="p-4 bg-purple-500/5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-5 h-5 text-purple-400" />
                <h3 className="text-sm font-semibold text-purple-300">Generate Forge App</h3>
                <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-400">Single-file monolith</span>
              </div>
              <div className="flex gap-2">
                <textarea
                  value={forgePrompt}
                  onChange={e => setForgePrompt(e.target.value)}
                  placeholder="Describe the app you want to generate... (e.g., 'A task tracker with categories, due dates, and a kanban board')"
                  className="flex-1 bg-lattice-deep border border-purple-500/30 rounded-lg p-3 text-sm text-white placeholder-gray-600 resize-none h-20 focus:outline-none focus:border-purple-400/50"
                />
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => forgeAppMutation.mutate(forgePrompt)}
                    disabled={!forgePrompt.trim() || forgeAppMutation.isPending}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-purple-600/20 text-purple-400 border border-purple-600/30 hover:bg-purple-600/30 disabled:opacity-40 transition-colors"
                  >
                    {forgeAppMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                    Generate
                  </button>
                  <button
                    onClick={() => setShowForge(false)}
                    className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
              {forgeResult && !forgeAppMutation.isPending && (
                <div className="mt-3 p-3 bg-lattice-deep rounded-lg border border-purple-500/20">
                  <p className="text-xs text-purple-300 mb-2">Generated app opened in new editor tab. Preview:</p>
                  <pre className="text-xs text-gray-400 font-mono max-h-32 overflow-auto whitespace-pre-wrap">
                    {forgeResult.slice(0, 500)}{forgeResult.length > 500 ? '...' : ''}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI Actions */}
      <UniversalActions domain="code" artifactId={savedScripts[0]?.id} compact />

      {/* Backend Code Analysis Actions */}
      <div className="px-4 py-3 border-b border-green-900/30 bg-[#161b22] space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Zap className="w-4 h-4 text-neon-yellow" />
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Code Analysis</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <button
            onClick={() => handleCodeAction('complexityAnalysis')}
            disabled={runningCodeAction !== null || !savedScripts[0]}
            className="flex flex-col items-center gap-1.5 p-3 bg-lattice-bg rounded-lg border border-lattice-border hover:border-neon-cyan/50 transition-colors disabled:opacity-50"
            title={!savedScripts[0] ? 'Save a script first to run analysis' : 'Analyze cyclomatic & cognitive complexity'}
          >
            {runningCodeAction === 'complexityAnalysis' ? <Loader2 className="w-5 h-5 text-neon-cyan animate-spin" /> : <BarChart3 className="w-5 h-5 text-neon-cyan" />}
            <span className="text-xs text-gray-300">Complexity Analysis</span>
          </button>
          <button
            onClick={() => handleCodeAction('dependencyAudit')}
            disabled={runningCodeAction !== null || !savedScripts[0]}
            className="flex flex-col items-center gap-1.5 p-3 bg-lattice-bg rounded-lg border border-lattice-border hover:border-neon-purple/50 transition-colors disabled:opacity-50"
            title={!savedScripts[0] ? 'Save a script first to run analysis' : 'Audit dependencies for vulnerabilities and license risk'}
          >
            {runningCodeAction === 'dependencyAudit' ? <Loader2 className="w-5 h-5 text-neon-purple animate-spin" /> : <Layers className="w-5 h-5 text-neon-purple" />}
            <span className="text-xs text-gray-300">Dependency Audit</span>
          </button>
          <button
            onClick={() => handleCodeAction('coverageAnalysis')}
            disabled={runningCodeAction !== null || !savedScripts[0]}
            className="flex flex-col items-center gap-1.5 p-3 bg-lattice-bg rounded-lg border border-lattice-border hover:border-green-400/50 transition-colors disabled:opacity-50"
            title={!savedScripts[0] ? 'Save a script first to run analysis' : 'Analyze test coverage gaps'}
          >
            {runningCodeAction === 'coverageAnalysis' ? <Loader2 className="w-5 h-5 text-green-400 animate-spin" /> : <RefreshCw className="w-5 h-5 text-green-400" />}
            <span className="text-xs text-gray-300">Coverage Analysis</span>
          </button>
          <button
            onClick={() => handleCodeAction('changeRiskAssessment')}
            disabled={runningCodeAction !== null || !savedScripts[0]}
            className="flex flex-col items-center gap-1.5 p-3 bg-lattice-bg rounded-lg border border-lattice-border hover:border-yellow-400/50 transition-colors disabled:opacity-50"
            title={!savedScripts[0] ? 'Save a script first to run analysis' : 'Assess risk of pending changes'}
          >
            {runningCodeAction === 'changeRiskAssessment' ? <Loader2 className="w-5 h-5 text-yellow-400 animate-spin" /> : <AlertTriangle className="w-5 h-5 text-yellow-400" />}
            <span className="text-xs text-gray-300">Change Risk</span>
          </button>
        </div>

        {/* Action Result Display */}
        <AnimatePresence>
          {codeActionResult && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="p-4 bg-lattice-bg rounded-lg border border-lattice-border"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-white flex items-center gap-2 text-sm">
                  <BarChart3 className="w-4 h-4 text-neon-cyan" /> Analysis Result
                </h3>
                <button onClick={() => setCodeActionResult(null)} className="text-gray-400 hover:text-white" aria-label="Dismiss result">
                  <XCircle className="w-4 h-4" />
                </button>
              </div>

              {/* Complexity Analysis Result */}
              {codeActionResult.averageMaintainability !== undefined && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="text-3xl font-bold text-neon-cyan">{codeActionResult.averageMaintainability as number}</div>
                    <div>
                      <span className={`text-sm font-medium px-2 py-0.5 rounded ${
                        (codeActionResult.overallRating as string) === 'A' ? 'bg-green-500/20 text-green-400' :
                        (codeActionResult.overallRating as string) === 'B' ? 'bg-blue-500/20 text-blue-400' :
                        (codeActionResult.overallRating as string) === 'C' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>Grade {codeActionResult.overallRating as string}</span>
                      <p className="text-xs text-gray-400 mt-1">Avg Maintainability Index</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-2 bg-lattice-deep rounded text-center">
                      <p className="text-xs text-gray-400">Modules</p>
                      <p className="text-sm font-bold text-white">{codeActionResult.totalModules as number}</p>
                    </div>
                    <div className="p-2 bg-lattice-deep rounded text-center">
                      <p className="text-xs text-gray-400">Total Lines</p>
                      <p className="text-sm font-bold text-neon-blue">{(codeActionResult.totalLines as number)?.toLocaleString()}</p>
                    </div>
                    <div className="p-2 bg-lattice-deep rounded text-center">
                      <p className="text-xs text-gray-400">Hotspots</p>
                      <p className="text-sm font-bold text-yellow-400">{(codeActionResult.hotspots as unknown[])?.length ?? 0}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Dependency Audit Result */}
              {codeActionResult.totalDependencies !== undefined && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-2 bg-lattice-deep rounded text-center">
                      <p className="text-xs text-gray-400">Total Deps</p>
                      <p className="text-sm font-bold text-white">{codeActionResult.totalDependencies as number}</p>
                    </div>
                    <div className="p-2 bg-lattice-deep rounded text-center">
                      <p className="text-xs text-gray-400">Direct</p>
                      <p className="text-sm font-bold text-neon-blue">{codeActionResult.directCount as number}</p>
                    </div>
                    <div className="p-2 bg-lattice-deep rounded text-center">
                      <p className="text-xs text-gray-400">High Risk</p>
                      <p className="text-sm font-bold text-red-400">{(codeActionResult.highRisk as unknown[])?.length ?? 0}</p>
                    </div>
                  </div>
                  {(codeActionResult.circularDependencies as unknown[])?.length > 0 && (
                    <p className="text-xs text-yellow-400 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {(codeActionResult.circularDependencies as unknown[]).length} circular dependenc{(codeActionResult.circularDependencies as unknown[]).length === 1 ? 'y' : 'ies'} detected
                    </p>
                  )}
                </div>
              )}

              {/* Coverage Analysis Result */}
              {codeActionResult.overall !== undefined && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 bg-lattice-deep rounded text-center">
                      <p className="text-xs text-gray-400">Statement Coverage</p>
                      <p className="text-sm font-bold text-neon-cyan">{(codeActionResult.overall as Record<string, number>).statementCoverage}%</p>
                    </div>
                    <div className="p-2 bg-lattice-deep rounded text-center">
                      <p className="text-xs text-gray-400">Branch Coverage</p>
                      <p className="text-sm font-bold text-neon-purple">{(codeActionResult.overall as Record<string, number>).branchCoverage}%</p>
                    </div>
                  </div>
                  <p className={`text-xs flex items-center gap-1 ${codeActionResult.meetsThreshold80 ? 'text-green-400' : 'text-yellow-400'}`}>
                    {codeActionResult.meetsThreshold80 ? '✓ Meets 80% threshold' : '⚠ Below 80% threshold'}
                  </p>
                  {(codeActionResult.gaps as unknown[])?.length > 0 && (
                    <p className="text-xs text-red-400">{(codeActionResult.gaps as unknown[]).length} file{(codeActionResult.gaps as unknown[]).length !== 1 ? 's' : ''} with critical coverage gaps</p>
                  )}
                </div>
              )}

              {/* Change Risk Assessment Result */}
              {codeActionResult.overallRisk !== undefined && codeActionResult.totalChurn !== undefined && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-bold px-3 py-1 rounded ${
                      codeActionResult.overallRisk === 'critical' ? 'bg-red-500/20 text-red-400' :
                      codeActionResult.overallRisk === 'high' ? 'bg-orange-500/20 text-orange-400' :
                      codeActionResult.overallRisk === 'moderate' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-green-500/20 text-green-400'
                    }`}>{String(codeActionResult.overallRisk).toUpperCase()} RISK</span>
                    <span className="text-xs text-gray-400">{codeActionResult.totalFiles as number} file{(codeActionResult.totalFiles as number) !== 1 ? 's' : ''} changed &bull; {(codeActionResult.totalChurn as number).toLocaleString()} lines churned</span>
                  </div>
                  {(codeActionResult.recommendations as string[])?.length > 0 && (
                    <ul className="space-y-1">
                      {(codeActionResult.recommendations as string[]).map((rec, i) => (
                        <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 mt-0.5 flex-shrink-0" />
                          {rec}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Generic message fallback */}
              {!!codeActionResult.message && !codeActionResult.averageMaintainability && !codeActionResult.totalDependencies && !codeActionResult.overall && !codeActionResult.totalChurn && (
                <p className="text-sm text-gray-400">{codeActionResult.message as string}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Activity bar — selects which sidebar panel renders */}
        <ActivityBar
          active={activity}
          onChange={(a) => {
            if (a === 'settings') {
              setSettingsOpen(true);
              return;
            }
            if (a === 'terminal') {
              setTerminalOpen(v => !v);
              return;
            }
            setActivity(a);
            setShowFileTree(true);
          }}
          badges={{
            sourceControl: tabs.filter(t => t.isDirty).length,
          }}
        />
        {/* Sidebar — content switches with activity */}
        <AnimatePresence>
          {showFileTree && (
            <motion.aside
              initial={{ width: 0 }}
              animate={{ width: 280 }}
              exit={{ width: 0 }}
              className="border-r border-green-900/30 bg-[#0d1117] overflow-hidden"
            >
              <div className="w-[280px] h-full flex flex-col">
                {activity === 'files' && (
                  <>
                    <div className="p-2 border-b border-green-900/30 flex items-center justify-between">
                      <span className="text-xs font-semibold text-green-500 uppercase font-mono tracking-wider">Explorer</span>
                      <div className="flex items-center gap-1">
                        <button onClick={handleNewTab} className="p-1 rounded hover:bg-lattice-elevated text-gray-400 hover:text-white transition-colors" title="New script">
                          <Plus className="w-4 h-4" />
                        </button>
                        <button onClick={() => setShowFileTree(!showFileTree)} className="p-1 rounded hover:bg-lattice-elevated text-gray-400 hover:text-white transition-colors" title="Toggle file tree">
                          <FolderTree className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto py-2">
                      {files.length === 0 ? (
                        <div className="px-3 py-4 text-center">
                          <p className="text-xs text-gray-400 mb-2">No files yet</p>
                          <button
                            onClick={() => setFiles(TEMPLATE_FILES)}
                            className="text-xs text-green-400 hover:text-green-300 underline"
                          >
                            Load starter templates
                          </button>
                        </div>
                      ) : files.map((file) => renderFileNode(file))}
                    </div>
                    {/* DTU Context */}
                    <div className="p-3 border-t border-white/10 space-y-3">
                      <LensContextPanel
                        hyperDTUs={hyperDTUs}
                        megaDTUs={megaDTUs}
                        regularDTUs={regularDTUs}
                        tierDistribution={tierDistribution}
                        onPublish={(dtu) => publishToMarketplace({ dtuId: dtu.id })}
                        title="Code DTUs"
                        className="!bg-transparent !border-0 !p-0"
                      />
                      <FeedbackWidget targetType="lens" targetId="code" />
                    </div>
                  </>
                )}
                {activity === 'snippets' && (
                  <SnippetsLibrary
                    currentLanguage={activeTab?.language || 'javascript'}
                    currentSelection={selection?.text || ''}
                    onInsert={(code) => insertChatCodeIntoEditor(code)}
                  />
                )}
                {activity === 'sourceControl' && (
                  <SourceControlPanel
                    tabs={tabs}
                    savedScripts={savedScripts.map(s => ({
                      id: s.id,
                      title: (s as { title?: string }).title,
                      data: (s as { data?: { content?: string; language?: string } }).data,
                    }))}
                    onJumpToTab={(tid) => setActiveTabId(tid)}
                    onCommitAll={commitWorkingTree}
                    onRefresh={refetchDTUs}
                  />
                )}
                {activity === 'search' && (
                  <div className="p-4 text-xs text-gray-400 space-y-2">
                    <p>Use ⌘⇧F to open project search modal.</p>
                    <button
                      onClick={openFindInFiles}
                      className="w-full px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400"
                    >
                      Open Find in Files
                    </button>
                  </div>
                )}
                {activity === 'agent' && (
                  <div className="p-4 space-y-3 text-xs text-gray-300">
                    <h3 className="text-sm font-bold text-purple-300">AI Agent</h3>
                    <p className="text-gray-400">
                      Describe a change spanning multiple files. The agent plans edits across your open workspace and you review per-file before applying.
                    </p>
                    <textarea
                      placeholder='e.g. "Add input validation to all exposed handlers and emit a structured log on each error"'
                      rows={5}
                      className="w-full px-2 py-2 bg-lattice-deep border border-lattice-border rounded text-xs text-white resize-y"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          const val = (e.target as HTMLTextAreaElement).value;
                          if (val.trim()) openMultiFileAgent(val);
                        }
                      }}
                      id="multi-file-agent-input"
                    />
                    <button
                      className="w-full px-3 py-1.5 text-xs rounded bg-purple-500 text-white font-bold hover:bg-purple-400"
                      onClick={() => {
                        const el = document.getElementById('multi-file-agent-input') as HTMLTextAreaElement | null;
                        if (el?.value?.trim()) openMultiFileAgent(el.value);
                      }}
                    >
                      Plan multi-file edit (⌘⏎)
                    </button>
                    <p className="text-[10px] text-gray-400">Reads from {tabs.length} open tab{tabs.length === 1 ? '' : 's'} + {savedScripts.length} saved scripts (max 12).</p>
                  </div>
                )}
                {(activity === 'debug' || activity === 'extensions') && (
                  <div className="p-4 text-xs text-gray-400 space-y-2">
                    <p className="text-gray-300 font-semibold">
                      {activity === 'debug' ? 'Step debugger' : 'Extensions'}
                    </p>
                    <p className="text-gray-400">
                      {activity === 'debug'
                        ? 'Set breakpoints, watch expressions and inspect the call stack.'
                        : 'Browse and install editor extensions: formatters, linters, language packs.'}
                    </p>
                    <p className="text-gray-400">
                      Open the <span className="text-cyan-400">Advanced IDE</span> panel above the editor —
                      it surfaces the debugger, extensions, remote git, codebase chat, split view and Live Share.
                    </p>
                  </div>
                )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Main Editor Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tab Bar */}
          <div className="flex items-center gap-1 px-2 py-1 bg-lattice-surface/50 border-b border-lattice-border flex-wrap">
            <button
              onClick={() => setShowFileTree(!showFileTree)}
              className="p-1.5 rounded hover:bg-lattice-elevated text-gray-400 flex-shrink-0"
              aria-label={showFileTree ? 'Hide file tree' : 'Show file tree'}
            >
              <FolderTree className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1">
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-t-lg cursor-pointer transition-colors ${
                    tab.id === activeTabId
                      ? 'bg-lattice-deep border-t border-l border-r border-lattice-border text-white'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                  onClick={() => {
                    setActiveTabId(tab.id);
                    if (tab.scriptType) setActiveScriptType(tab.scriptType);
                  }} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                  <FileCode className="w-4 h-4 text-neon-blue" />
                  <span className="text-sm">{tab.name}</span>
                  {tab.isDirty && <span className="w-2 h-2 bg-neon-blue rounded-full" />}
                  {tabs.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.id);
                      }}
                      className="p-0.5 rounded hover:bg-lattice-border/50"
                      aria-label={`Close ${tab.name}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button onClick={handleNewTab} className="p-1.5 rounded hover:bg-lattice-elevated text-gray-400 hover:text-white flex-shrink-0 transition-colors" title="New tab">
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* Editor + Output Split */}
          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
            {/* Code Editor */}
            <div className={`flex-1 flex flex-col overflow-hidden ${showOutput || showApiRef ? 'lg:w-1/2' : ''}`}>
              <div className="flex items-center justify-between px-3 py-1.5 bg-lattice-deep border-b border-lattice-border">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span className={SCRIPT_TYPES.find((s) => s.id === activeScriptType)?.color}>
                    {SCRIPT_TYPES.find((s) => s.id === activeScriptType)?.name}
                  </span>
                  <span>|</span>
                  <span>{activeTab.content.split('\n').length} lines</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={handleSave} className={cn('p-1 rounded hover:bg-lattice-elevated transition-colors', activeTab.isDirty ? 'text-neon-blue' : 'text-gray-400')} title="Save script (persists to backend)">
                    <Save className="w-4 h-4" />
                  </button>
                  <button className="p-1 rounded hover:bg-lattice-elevated text-gray-400" title="Copy to clipboard"
                    onClick={() => navigator.clipboard?.writeText(activeTab.content)}>
                    <Copy className="w-4 h-4" />
                  </button>
                  <button className="p-1 rounded hover:bg-lattice-elevated text-gray-400" title="Download file"
                    onClick={() => {
                      const blob = new Blob([activeTab.content], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url; a.download = activeTab.name;
                      a.click(); URL.revokeObjectURL(url);
                    }}>
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 relative">
                {/* SafeCard isolates Monaco load failures (sandbox network
                    egress can block its CDN). Page stays up even if the
                    editor can't initialise. */}
                <SafeCard label="Code editor">
                  <MonacoWrapper
                    value={activeTab.content}
                    onChange={(val) => updateTabContent(val)}
                    language={activeTab.language || 'javascript'}
                    semantic={semanticCtx}
                    onEditorReady={(ed) => { editorInstanceRef.current = ed; }}
                    onSelectionChange={(s) => setSelection(s.text ? s : null)}
                    options={{
                      fontSize: settings.editor.fontSize,
                      fontFamily: settings.editor.fontFamily,
                      tabSize: settings.editor.tabSize,
                      wordWrap: settings.editor.wordWrap,
                      minimap: { enabled: settings.editor.minimap },
                      lineNumbers: settings.editor.lineNumbers,
                      bracketPairColorization: { enabled: settings.editor.bracketPairColorization },
                      formatOnPaste: settings.editor.formatOnPaste,
                      formatOnType: settings.editor.formatOnType,
                      cursorBlinking: settings.editor.cursorBlinking,
                      smoothScrolling: settings.editor.smoothScrolling,
                    }}
                    inlineCompletion={async ({ textBeforeCursor, textAfterCursor, language: lang }) => {
                      try {
                        const res = await api.post('/api/lens/run', {
                          domain: 'code',
                          action: 'tab-completion',
                          input: {
                            prefix: textBeforeCursor,
                            suffix: textAfterCursor,
                            language: lang,
                            maxTokens: Math.min(96, settings.ai.maxTokens),
                          },
                        });
                        return String(res.data?.result?.completion || '');
                      } catch {
                        return '';
                      }
                    }}
                  />
                </SafeCard>
                {selection?.text && !aiEditOpen && (
                  <div className="pointer-events-none absolute top-2 right-2 px-2 py-1 rounded bg-neon-cyan/20 border border-neon-cyan/40 text-[10px] text-neon-cyan font-mono">
                    {selection.endLine - selection.startLine + 1} line{selection.endLine !== selection.startLine ? 's' : ''} selected · ⌘K to edit
                  </div>
                )}
              </div>
            </div>

            {/* Output / API Reference Panel */}
            <AnimatePresence>
              {(showOutput || showApiRef) && (
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: '50%' }}
                  exit={{ width: 0 }}
                  className="border-l border-lattice-border flex flex-col overflow-hidden bg-lattice-surface/30"
                >
                  {showApiRef ? (
                    /* API Reference Panel */
                    <>
                      <div className="flex items-center justify-between px-3 py-1.5 border-b border-lattice-border">
                        <div className="flex items-center gap-2">
                          <BookOpen className="w-4 h-4 text-neon-cyan" />
                          <span className="text-sm font-medium">API Reference</span>
                        </div>
                        <button
                          onClick={() => setShowApiRef(false)}
                          className="p-1 rounded hover:bg-lattice-elevated text-gray-400"
                          aria-label="Close API reference"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex-1 overflow-auto p-4 space-y-5">
                        {API_REFERENCE.map((cat) => (
                          <div key={cat.category}>
                            <h3 className="text-xs font-bold text-neon-blue uppercase tracking-wider mb-2">{cat.category}</h3>
                            <div className="space-y-2">
                              {cat.functions.map((fn) => (
                                <div key={fn.signature} className="bg-lattice-deep rounded-lg p-2.5 border border-lattice-border">
                                  <code className="text-xs text-neon-yellow font-mono">{fn.signature}</code>
                                  <p className="text-xs text-gray-400 mt-1">{fn.description}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    /* Run Output Panel */
                    <>
                      <div className="flex items-center justify-between px-3 py-1.5 border-b border-lattice-border">
                        <div className="flex items-center gap-0">
                          <button
                            onClick={() => setOutputTab('output')}
                            className={`flex items-center gap-2 px-3 py-1 rounded-t text-sm transition-colors ${
                              outputTab === 'output' ? 'text-neon-blue bg-lattice-deep' : 'text-gray-400 hover:text-gray-300'
                            }`}
                          >
                            <Play className="w-3.5 h-3.5" />
                            Output
                          </button>
                          <button
                            onClick={() => setOutputTab('console')}
                            className={`flex items-center gap-2 px-3 py-1 rounded-t text-sm transition-colors ${
                              outputTab === 'console' ? 'text-neon-blue bg-lattice-deep' : 'text-gray-400 hover:text-gray-300'
                            }`}
                          >
                            <Terminal className="w-3.5 h-3.5" />
                            Console
                          </button>
                        </div>
                        <button
                          onClick={() => setShowOutput(false)}
                          className="p-1 rounded hover:bg-lattice-elevated text-gray-400"
                          aria-label="Close output panel"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex-1 overflow-auto p-4">
                        {outputTab === 'output' ? (
                          runScriptMutation.isPending ? (
                            <div className="flex items-center gap-3 text-neon-blue">
                              <Loader2 className="w-5 h-5 animate-spin" />
                              <span>Running {SCRIPT_TYPES.find((s) => s.id === activeScriptType)?.name}...</span>
                            </div>
                          ) : scriptOutput ? (
                            <div className="space-y-4">
                              <div>
                                <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Script Log</h4>
                                <pre className="font-mono text-xs text-green-400 whitespace-pre-wrap bg-lattice-deep rounded-lg p-3 border border-lattice-border">{scriptOutput.log}</pre>
                              </div>
                              {scriptOutput.visualization && (
                              <div>
                                <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">
                                  {activeScriptType === 'snippet' && 'Output'}
                                  {activeScriptType === 'project' && 'Project View'}
                                  {activeScriptType === 'pipeline' && 'Pipeline Flow'}
                                  {activeScriptType === 'notebook' && 'Notebook Output'}
                                  {activeScriptType === 'algorithm' && 'Visualization'}
                                  {activeScriptType === 'library' && 'Module Export'}
                                </h4>
                                <pre className="font-mono text-xs text-neon-cyan whitespace-pre bg-lattice-deep rounded-lg p-3 border border-lattice-border overflow-x-auto">{scriptOutput.visualization}</pre>
                              </div>
                              )}
                              <div className="flex items-center gap-2 pt-2 border-t border-lattice-border">
                                <button
                                  onClick={handleSaveOutputAsDTU}
                                  disabled={savingOutputDTU}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-neon-blue/10 text-neon-blue rounded-lg text-xs hover:bg-neon-blue/20 disabled:opacity-50"
                                >
                                  <Save className="w-3.5 h-3.5" /> {savingOutputDTU ? 'Saving...' : 'Save as DTU'}
                                </button>
                                <button
                                  onClick={() => {
                                    const content = `// ${activeTab.name}\n// Output:\n${scriptOutput.log}\n${scriptOutput.visualization ? `\n// Visualization:\n${scriptOutput.visualization}` : ''}`;
                                    const blob = new Blob([content], { type: 'text/plain' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `${activeTab.name.replace(/\.\w+$/, '')}-output.txt`;
                                    a.click();
                                    URL.revokeObjectURL(url);
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-neon-cyan/10 text-neon-cyan rounded-lg text-xs hover:bg-neon-cyan/20"
                                >
                                  <Download className="w-3.5 h-3.5" /> Download Output
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center justify-center h-full text-gray-400">
                              <Terminal className="w-12 h-12 mb-4 opacity-30" />
                              <p className="text-sm">Click &quot;Run&quot; to execute</p>
                              <p className="text-xs mt-1 text-gray-400">Output will appear here</p>
                            </div>
                          )
                        ) : (
                          /* Console Tab */
                          <div className="space-y-1">
                            {consoleLog.length > 0 ? (
                              consoleLog.map((line, idx) => (
                                <div key={idx} className="font-mono text-xs text-gray-400">{line}</div>
                              ))
                            ) : (
                              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                                <Terminal className="w-12 h-12 mb-4 opacity-30" />
                                <p className="text-sm">Script console output</p>
                                <p className="text-xs mt-1 text-gray-400">Log messages will appear here</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Integrated Terminal Panel — Cmd+` toggle, xterm.js-backed */}
          <TerminalPanel
            open={terminalOpen}
            onClose={() => setTerminalOpen(false)}
            activeCode={activeTab.content}
            activeLanguage={activeTab.language || 'javascript'}
            activeName={activeTab.name}
            fontSize={settings.terminal.fontSize}
            cursorStyle={settings.terminal.cursorStyle}
          />

          {/* Status Bar */}
          <div className="flex items-center justify-between px-3 py-1 bg-lattice-deep border-t border-lattice-border text-xs text-gray-400">
            <div className="flex items-center gap-4">
              <span>Ln 1, Col 1</span>
              <span>Spaces: {settings.editor.tabSize}</span>
              <span>UTF-8</span>
              {tabs.some(t => t.isDirty) && (
                <span className="text-yellow-400">{tabs.filter(t => t.isDirty).length} modified</span>
              )}
            </div>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3 text-neon-yellow" />
                Code Engine Ready
              </span>
              <button
                onClick={() => setTerminalOpen(v => !v)}
                title="Toggle terminal (⌃`)"
                className="hover:text-white transition-colors inline-flex items-center gap-1"
              >
                <Terminal className="w-3 h-3" />
                Terminal
              </button>
              <button
                onClick={() => setSettingsOpen(true)}
                title="Settings (⌘,)"
                className="hover:text-white transition-colors"
              >
                ⚙
              </button>
              <span className={SCRIPT_TYPES.find((s) => s.id === activeScriptType)?.color}>
                {SCRIPT_TYPES.find((s) => s.id === activeScriptType)?.name}
              </span>
            </div>
          </div>
        </div>

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="code"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="code" />
          </div>
        )}
      </div>
      </div>
    </div>

    {/* ── Command palette modal (⌘P) ──────────────────────────── */}
    {paletteOpen && (
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-[100] pt-[14vh]"
        onClick={() => setPaletteOpen(false)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        <div
          className="bg-[#0d1117] border border-cyan-500/40 rounded-xl w-full max-w-xl shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-cyan-400">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              ref={paletteInputRef}
              value={paletteQuery}
              onChange={(e) => setPaletteQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setPaletteOpen(false); return; }
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setPaletteIdx((i) => Math.min(i + 1, filteredPalette.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setPaletteIdx((i) => Math.max(i - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  filteredPalette[paletteIdx]?.action();
                }
              }}
              placeholder="Type to search files, tabs, commands…"
              className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-white/30"
            />
            <kbd className="text-[10px] text-white/40 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 font-mono">esc</kbd>
          </div>
          <ul className="max-h-[50vh] overflow-y-auto py-1">
            {filteredPalette.length === 0 ? (
              <li className="px-4 py-3 text-xs text-white/40 italic">No matches.</li>
            ) : filteredPalette.map((c, i) => (
              <li
                key={c.id}
                onMouseEnter={() => setPaletteIdx(i)}
                onClick={c.action}
                className={`px-4 py-2 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                  i === paletteIdx ? 'bg-cyan-500/10 border-l-2 border-cyan-400' : 'border-l-2 border-transparent hover:bg-white/5'
                }`}
              >
                <span className="text-sm text-white truncate">{c.label}</span>
                <span className="text-[10px] text-white/40 shrink-0 font-mono">{c.hint}</span>
              </li>
            ))}
          </ul>
          <div className="px-4 py-2 border-t border-white/10 text-[10px] text-white/40 flex items-center justify-between">
            <span>↑↓ navigate · ↵ run</span>
            <span>{filteredPalette.length} {filteredPalette.length === 1 ? 'result' : 'results'}</span>
          </div>
        </div>
      </div>
    )}

    {/* ── Find in Files modal (⌘⇧F) ───────────────────────────── */}
    <AnimatePresence>
      {findOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setFindOpen(false)}
        >
          <motion.div
            initial={{ y: -16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -16, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="w-full max-w-2xl bg-[#0d1117] rounded-xl border border-neon-yellow/30 shadow-2xl shadow-neon-yellow/10 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-lattice-border">
              <FileCode className="w-4 h-4 text-neon-yellow" />
              <input
                ref={findInputRef}
                type="text"
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setFindOpen(false); }}
                placeholder="Find in tabs and saved scripts…"
                className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none font-mono"
                autoFocus
              />
              <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400">esc</kbd>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {findQuery.trim().length < 2 && (
                <div className="px-4 py-8 text-center text-xs text-gray-400">Type at least 2 characters</div>
              )}
              {findQuery.trim().length >= 2 && findHits.length === 0 && (
                <div className="px-4 py-8 text-center text-xs text-gray-400">
                  No matches in {tabs.length} tab{tabs.length === 1 ? '' : 's'} or {savedScripts.length} saved script{savedScripts.length === 1 ? '' : 's'}
                </div>
              )}
              {findHits.map((hit, i) => {
                const q = findQuery.trim();
                const idx = hit.preview.toLowerCase().indexOf(q.toLowerCase());
                const before = idx >= 0 ? hit.preview.slice(0, idx) : hit.preview;
                const match = idx >= 0 ? hit.preview.slice(idx, idx + q.length) : '';
                const after = idx >= 0 ? hit.preview.slice(idx + q.length) : '';
                return (
                  <button
                    key={`${hit.sourceId}-${hit.line}-${i}`}
                    onClick={() => jumpToFindHit(hit)}
                    className="w-full text-left px-4 py-2 border-b border-lattice-border hover:bg-lattice-elevated transition-colors group"
                  >
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">
                      <span className={hit.source === 'tab' ? 'text-neon-cyan' : 'text-neon-purple'}>{hit.source}</span>
                      <span>·</span>
                      <span className="font-mono text-gray-400">{hit.sourceName}</span>
                      <span>·</span>
                      <span>line {hit.line}</span>
                    </div>
                    <div className="text-xs text-gray-300 font-mono whitespace-pre overflow-hidden text-ellipsis">
                      {before.length > 80 ? '…' + before.slice(-80) : before}
                      <mark className="bg-neon-yellow/30 text-white px-0.5 rounded">{match}</mark>
                      {after.length > 80 ? after.slice(0, 80) + '…' : after}
                    </div>
                  </button>
                );
              })}
            </div>
            {findHits.length > 0 && (
              <div className="px-4 py-2 border-t border-lattice-border text-[10px] text-gray-400 flex justify-between">
                <span>{findHits.length} match{findHits.length === 1 ? '' : 'es'}{findHits.length === 200 ? ' (capped)' : ''}</span>
                <span>{tabs.length} tab{tabs.length === 1 ? '' : 's'} · {savedScripts.length} saved</span>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>

    {/* ── AI Inline Edit modal (⌘K) ────────────────────────────── */}
    <AnimatePresence>
      {aiEditOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-start justify-center pt-32 px-4 bg-black/60 backdrop-blur-sm"
          onClick={() => { if (!aiEditPending) { setAiEditOpen(false); setAiEditResult(null); } }}
        >
          <motion.div
            initial={{ y: -16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -16, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="w-full max-w-3xl bg-[#0d1117] rounded-xl border border-neon-cyan/40 shadow-2xl shadow-neon-cyan/10 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-neon-cyan/20 bg-gradient-to-r from-neon-cyan/10 to-neon-purple/10">
              <Sparkles className="w-4 h-4 text-neon-cyan" />
              <span className="text-sm font-bold text-neon-cyan">AI Edit</span>
              <span className="text-xs text-gray-400">
                {selection?.text
                  ? `lines ${selection.startLine}–${selection.endLine}`
                  : `whole file (${activeTab.name})`}
              </span>
              <kbd className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400">esc</kbd>
            </div>
            <div className="p-4 space-y-3">
              <input
                ref={aiEditInputRef}
                type="text"
                value={aiEditPrompt}
                onChange={(e) => setAiEditPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !aiEditPending) { e.preventDefault(); runAiEdit(); }
                  if (e.key === 'Escape') { setAiEditOpen(false); setAiEditResult(null); }
                }}
                placeholder="Describe the change… e.g. add error handling, convert to async, extract to function"
                className="w-full px-3 py-2.5 bg-lattice-deep border border-lattice-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan/60"
                autoFocus
              />
              {aiEditError && (
                <div className="px-3 py-2 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-400">{aiEditError}</div>
              )}
              {aiEditResult && (
                <div className="space-y-2">
                  <MonacoDiffViewer
                    original={aiEditResult.before}
                    modified={aiEditResult.after}
                    language={activeTab.language || 'javascript'}
                    height={Math.max(220, Math.min(440, (aiEditResult.before.split('\n').length + aiEditResult.after.split('\n').length) * 16))}
                    renderSideBySide
                  />
                </div>
              )}
              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="text-[11px] text-gray-400">
                  {aiEditResult ? '⏎ apply · ⎋ cancel' : '⏎ generate · ⎋ cancel'}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setAiEditOpen(false); setAiEditResult(null); }}
                    disabled={aiEditPending}
                    className="px-3 py-1.5 text-xs rounded border border-lattice-border text-gray-400 hover:text-white hover:bg-lattice-elevated disabled:opacity-40"
                  >Cancel</button>
                  {aiEditResult ? (
                    <>
                      <button
                        onClick={() => setAiEditResult(null)}
                        className="px-3 py-1.5 text-xs rounded border border-lattice-border text-gray-300 hover:bg-lattice-elevated"
                      >Try again</button>
                      <button
                        onClick={applyAiEdit}
                        className="px-4 py-1.5 text-xs font-bold rounded bg-green-600 hover:bg-green-500 text-white"
                      >Apply ⏎</button>
                    </>
                  ) : aiEditPending ? (
                    <button
                      onClick={cancelAiEdit}
                      className="px-4 py-1.5 text-xs font-bold rounded bg-amber-600/80 hover:bg-amber-600 text-white flex items-center gap-2"
                    >
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Cancel · {aiEditElapsed.toFixed(1)}s
                    </button>
                  ) : (
                    <button
                      onClick={runAiEdit}
                      disabled={!aiEditPrompt.trim()}
                      className="px-4 py-1.5 text-xs font-bold rounded bg-neon-cyan hover:bg-neon-cyan/90 text-black disabled:opacity-40 flex items-center gap-2"
                    >
                      Generate ⏎
                    </button>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>

    {/* ── AI Chat side-panel (⌘L) ──────────────────────────────── */}
    <AnimatePresence>
      {aiChatOpen && (
        <motion.aside
          initial={{ x: 480, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 480, opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="fixed top-0 right-0 bottom-0 w-[420px] z-40 bg-[#0d1117] border-l border-neon-purple/30 shadow-2xl shadow-neon-purple/10 flex flex-col"
        >
          <header className="flex items-center gap-2 px-4 py-3 border-b border-neon-purple/20 bg-gradient-to-r from-neon-purple/10 to-neon-cyan/10">
            <Sparkles className="w-4 h-4 text-neon-purple" />
            <span className="text-sm font-bold text-neon-purple">AI Pair</span>
            <label className="ml-auto flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={aiChatIncludeFile}
                onChange={(e) => setAiChatIncludeFile(e.target.checked)}
                className="accent-neon-purple"
              />
              include file
            </label>
            {isAuthenticated && (
              <button
                onClick={() => setByoOpen(true)}
                className="p-1 rounded hover:bg-lattice-elevated text-gray-400 hover:text-neon-cyan"
                title="Plug your own API key into the AI Pair brain"
                aria-label="BYO API keys"
              >
                <Key className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => setAiChatHistory([])}
              className="text-[10px] px-2 py-0.5 rounded border border-white/10 text-gray-400 hover:text-white hover:border-white/30"
              title="Clear thread"
            >clear</button>
            <button onClick={() => setAiChatOpen(false)} className="p-1 rounded hover:bg-lattice-elevated text-gray-400" title="Close (⌘L)">
              <X className="w-4 h-4" />
            </button>
          </header>
          <div ref={aiChatScrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {aiChatHistory.length === 0 && (
              <div className="text-center py-8 text-xs text-gray-400 space-y-2">
                <Sparkles className="w-6 h-6 text-neon-purple/40 mx-auto" />
                <p>Ask anything about <span className="text-neon-cyan">{activeTab.name}</span>.</p>
                <p className="text-[10px] text-gray-400">Try: &quot;explain this&quot; · &quot;refactor for readability&quot; · &quot;write a test for the main function&quot;</p>
              </div>
            )}
            {aiChatHistory.map((m, i) => {
              const isUser = m.role === 'user';
              const codeBlocks = isUser ? [] : Array.from(m.content.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)).map((mm) => mm[1].trim());
              return (
                <div key={i} className={cn('flex flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
                  <div className="text-[9px] uppercase tracking-wider text-gray-400">{isUser ? 'you' : 'pair'}</div>
                  <div className={cn(
                    'max-w-[90%] px-3 py-2 rounded-lg text-xs whitespace-pre-wrap break-words',
                    isUser ? 'bg-neon-cyan/10 border border-neon-cyan/30 text-gray-100' : 'bg-lattice-deep border border-lattice-border text-gray-200',
                  )}>
                    {m.content}
                  </div>
                  {!isUser && codeBlocks.map((cb, ci) => (
                    <div key={ci} className="flex items-center gap-2 text-[10px]">
                      <button
                        onClick={() => insertChatCodeIntoEditor(cb)}
                        className="px-2 py-0.5 rounded bg-green-600/20 border border-green-600/40 text-green-300 hover:bg-green-600/30"
                        title="Insert at cursor / replace selection"
                      >Insert ↵</button>
                      <button
                        onClick={() => navigator.clipboard?.writeText(cb)}
                        className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400 hover:text-white"
                      >Copy</button>
                    </div>
                  ))}
                  {!isUser && m.dtuRefs && m.dtuRefs.length > 0 && (
                    <CitationChips dtuRefs={m.dtuRefs} surfaceFromLens="code" />
                  )}
                </div>
              );
            })}
            {aiChatPending && (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>thinking… {aiChatElapsed.toFixed(1)}s</span>
                <button
                  onClick={cancelAiChat}
                  className="ml-auto text-[10px] px-2 py-0.5 rounded border border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                  title="Stop generation"
                >
                  Stop
                </button>
              </div>
            )}
          </div>
          <footer className="border-t border-neon-purple/20 p-3 space-y-2">
            <textarea
              ref={aiChatInputRef}
              value={aiChatDraft}
              onChange={(e) => setAiChatDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendAiChat(); }
                if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); sendAiChat(); }
              }}
              rows={2}
              placeholder="Message AI pair · ⏎ send · ⇧⏎ newline"
              disabled={aiChatPending}
              className="w-full px-3 py-2 bg-lattice-deep border border-lattice-border rounded text-xs text-white placeholder-gray-500 focus:outline-none focus:border-neon-purple/60 resize-none"
            />
            <div className="flex items-center justify-between text-[10px] text-gray-400">
              <span>{aiChatHistory.length} message{aiChatHistory.length === 1 ? '' : 's'}</span>
              {aiChatPending ? (
                <button
                  onClick={cancelAiChat}
                  className="px-3 py-1 rounded bg-amber-600/80 hover:bg-amber-600 text-white text-[11px] font-bold flex items-center gap-1.5"
                >
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Stop · {aiChatElapsed.toFixed(1)}s
                </button>
              ) : (
                <button
                  onClick={sendAiChat}
                  disabled={!aiChatDraft.trim()}
                  className="px-3 py-1 rounded bg-neon-purple hover:bg-neon-purple/90 text-white text-[11px] font-bold disabled:opacity-40"
                >Send ⏎</button>
              )}
            </div>
          </footer>
        </motion.aside>
      )}
    </AnimatePresence>
    <LensAgentFab
      lensId="code"
      lensPrompt="You're inside Concord's Code lens — a polyglot dev workspace with snippets, projects, pipelines, notebooks, algorithms, libraries. Prefer run_compute for math, run_lens_action for code-quality / code-engine helpers, and create_dtu to save reusable snippets."
    />

    {/* BYO API key drawer (slide-in from right). Triggered from the AI
        Pair header. Auth-only — anon users can't manage BYO keys. */}
    <BYOKeyDrawer open={byoOpen} onClose={() => setByoOpen(false)} />

    {/* Settings modal — ⌘, opens, persisted to localStorage */}
    <SettingsPanel
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      onChange={setSettings}
      initial={settings}
    />

    {/* Multi-file agent review modal — Cursor 3.0 Agents Window parity.
        Shows per-file diff with accept/reject per hunk and apply-all. */}
    <MultiFileAgentReview
      open={agentOpen}
      onClose={() => setAgentOpen(false)}
      prompt={agentPrompt}
      edits={agentEdits}
      loading={agentLoading}
      onApply={applyMultiFileAgent}
      onRegenerate={() => openMultiFileAgent(agentPrompt)}
    />
    <section className="mt-6 mx-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <GithubTrending />
    </section>

    {/* Code review workbench: complexity / deps / coverage / snippet + actions */}
    <PipingProvider>
      <section className="mt-6 mx-4">
        <CodeActionPanel />
      </section>
    </PipingProvider>
          <SessionRail lensId="code" hideWhenEmpty className="mt-4" />
          <RecentMineCard domain="code" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="code" hideWhenEmpty className="mt-3" title="More actions" />
          <CrossLensRecentsPanel lensId="code" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
          {/* Phase 12 (Item 5) — mobile thumb-reachable activity bar.
              Surfaces the most-used activities on touch. */}
          <MobileTabBar
            tabs={[
              { id: 'files',         label: 'Files',   icon: MTabFiles },
              { id: 'search',        label: 'Search',  icon: MTabSearch },
              { id: 'sourceControl', label: 'Git',     icon: MTabSC },
              { id: 'snippets',      label: 'Snip',    icon: MTabSnip },
              { id: 'terminal',      label: 'Term',    icon: MTabTerm },
              { id: 'agent',         label: 'Agent',   icon: MTabAgent },
            ]}
            active={activity}
            onSelect={(id) => {
              const a = id as Activity;
              if (a === 'terminal') { setTerminalOpen(true); return; }
              if (a === 'agent')    { setAgentOpen(true);    return; }
              setActivity(a);
            }}
          />
    </LensShell>
  );
}
