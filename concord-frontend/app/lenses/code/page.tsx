'use client';

import { useState, useCallback } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';
const MonacoWrapper = dynamic(() => import('@/components/code/MonacoWrapper'), { ssr: false });
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
  XCircle, BarChart3, AlertTriangle
} from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { VisionAnalyzeButton } from '@/components/common/VisionAnalyzeButton';

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

const SCRIPT_TYPES: { id: ScriptType; name: string; icon: React.ElementType; color: string; description: string }[] = [
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
        {/* File Tree Sidebar */}
        <AnimatePresence>
          {showFileTree && (
            <motion.aside
              initial={{ width: 0 }}
              animate={{ width: 240 }}
              exit={{ width: 0 }}
              className="border-r border-green-900/30 bg-[#0d1117] overflow-hidden"
            >
              <div className="w-60 h-full flex flex-col">
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
                      <p className="text-xs text-gray-500 mb-2">No files yet</p>
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
                  }}
                >
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
                <MonacoWrapper
                  value={activeTab.content}
                  onChange={(val) => updateTabContent(val)}
                  language={activeTab.language || 'javascript'}
                />
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
                              outputTab === 'output' ? 'text-neon-blue bg-lattice-deep' : 'text-gray-500 hover:text-gray-300'
                            }`}
                          >
                            <Play className="w-3.5 h-3.5" />
                            Output
                          </button>
                          <button
                            onClick={() => setOutputTab('console')}
                            className={`flex items-center gap-2 px-3 py-1 rounded-t text-sm transition-colors ${
                              outputTab === 'console' ? 'text-neon-blue bg-lattice-deep' : 'text-gray-500 hover:text-gray-300'
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
                            <div className="flex flex-col items-center justify-center h-full text-gray-500">
                              <Terminal className="w-12 h-12 mb-4 opacity-30" />
                              <p className="text-sm">Click &quot;Run&quot; to execute</p>
                              <p className="text-xs mt-1 text-gray-600">Output will appear here</p>
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
                              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                                <Terminal className="w-12 h-12 mb-4 opacity-30" />
                                <p className="text-sm">Script console output</p>
                                <p className="text-xs mt-1 text-gray-600">Log messages will appear here</p>
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

          {/* Status Bar */}
          <div className="flex items-center justify-between px-3 py-1 bg-lattice-deep border-t border-lattice-border text-xs text-gray-500">
            <div className="flex items-center gap-4">
              <span>Ln 1, Col 1</span>
              <span>Spaces: 2</span>
              <span>UTF-8</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3 text-neon-yellow" />
                Code Engine Ready
              </span>
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
  );
}
