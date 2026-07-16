/// <reference types="@testing-library/jest-dom/vitest" />
// Pins the repos lens's Analysis tab (concord-frontend/components/repos/
// ConcordRepoWorkspace.tsx) against docs/WAVE4_INVENTORY.md's
// "codeComplexity's heuristic is a regex count, not a real AST parse" close-
// out. The tab used to compute branches/loops/conditions itself via regex
// over raw file text and send ONE synthetic pre-counted "function" per file.
// It now sends each analyzable file's REAL source text (`sourceFiles`) and
// lets the server AST-walk it (server/lib/code-ast-complexity.js). This test
// proves the wiring: `repos.codeComplexity` is called with real source text,
// not pre-computed branch/loop/condition counts, and non-JS/TS files (e.g.
// README.md) are excluded before the call.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import { ConcordRepoWorkspace } from '@/components/repos/ConcordRepoWorkspace';

const REPO = {
  id: 'repo_1', name: 'demo', description: '', language: 'JavaScript',
  isPrivate: false, fileCount: 2, branchCount: 1, openIssues: 0, openPulls: 0,
  updatedAt: '2026-07-14T00:00:00.000Z',
};

const SOURCE = 'function alpha(x) {\n  if (x) { return 1; }\n  return 0;\n}\n';

const TREE = [
  { name: 'thing.js', type: 'file' as const, path: 'src/thing.js' },
  { name: 'README.md', type: 'file' as const, path: 'README.md' },
];

function envelope(result: unknown, ok = true) {
  return { data: { ok: true, result: ok ? result : null, ...(ok ? {} : { error: 'boom' }) } };
}

describe('ConcordRepoWorkspace — Analysis tab real-AST wiring', () => {
  beforeEach(() => {
    lensRun.mockReset();
    lensRun.mockImplementation(async (_domain: string, action: string, params: Record<string, unknown>) => {
      switch (action) {
        case 'repo-list':
          return envelope({ repos: [REPO], count: 1 });
        case 'file-tree':
          return envelope({ tree: TREE, fileCount: TREE.length });
        case 'file-read':
          if (params.path === 'src/thing.js') {
            return envelope({ path: 'src/thing.js', content: SOURCE, language: 'JavaScript', lineCount: 4 });
          }
          return envelope(null, false);
        case 'codeComplexity':
          return envelope({
            totalModules: 1, totalFunctions: 1, totalLines: 4, overallAvgComplexity: 2,
            healthScore: 95, maxDependencyDepth: 0,
            riskDistribution: { critical: 0, high: 0, moderate: 0, low: 1 },
            hotspots: [{ name: 'alpha', module: 'src/thing.js', cyclomaticComplexity: 2, risk: 'low' }],
            modules: [],
          });
        case 'commit-graph':
          return envelope({ nodes: [] });
        case 'commitAnalysis':
          return envelope({ message: 'No commits to analyze.' });
        default:
          return envelope({ message: 'unhandled' });
      }
    });
  });

  async function openAnalysisTab() {
    render(<ConcordRepoWorkspace />);
    fireEvent.click(await screen.findByText('demo'));
    fireEvent.click(await screen.findByText('Analysis'));
  }

  it('sends real source text for the analyzable file, not pre-computed branch/loop/condition counts', async () => {
    await openAnalysisTab();
    fireEvent.click(screen.getByText('Run analysis'));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('repos', 'codeComplexity', expect.anything()));

    const call = lensRun.mock.calls.find((c) => c[1] === 'codeComplexity');
    expect(call).toBeTruthy();
    const params = call![2] as { sourceFiles?: Array<{ path: string; content: string }> };

    // Real source text, not a { branches, loops, conditions, nesting } blob.
    expect(params.sourceFiles).toBeTruthy();
    expect(params.sourceFiles).toHaveLength(1);
    expect(params.sourceFiles![0].path).toBe('src/thing.js');
    expect(params.sourceFiles![0].content).toBe(SOURCE);
    expect(params).not.toHaveProperty('modules');
  });

  it('excludes non-JS/TS files (README.md) from the AST analysis payload', async () => {
    await openAnalysisTab();
    fireEvent.click(screen.getByText('Run analysis'));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('repos', 'codeComplexity', expect.anything()));
    const call = lensRun.mock.calls.find((c) => c[1] === 'codeComplexity');
    const params = call![2] as { sourceFiles: Array<{ path: string }> };
    expect(params.sourceFiles.some((f) => f.path === 'README.md')).toBe(false);
  });

  it('renders the server-computed complexity result after a run', async () => {
    await openAnalysisTab();
    fireEvent.click(screen.getByText('Run analysis'));
    // Hotspot row renders `h.module || h.name` — the mocked codeComplexity
    // response's hotspot carries module: 'src/thing.js'.
    expect(await screen.findByText('src/thing.js')).toBeInTheDocument();
  });
});
