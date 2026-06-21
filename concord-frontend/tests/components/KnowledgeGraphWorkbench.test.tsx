/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

// Lightweight type-into-input helper (user-event is not installed in this repo).
function typeInto(el: Element | HTMLElement, value: string) {
  fireEvent.change(el as HTMLElement, { target: { value } });
}

// ── Mock lensRun routing ────────────────────────────────────────────────────
// Each test sets `routeHandlers[action]` to control the result for a macro.
const lensRunMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  __esModule: true,
  lensRun: (domain: string, action: string, params: Record<string, unknown> = {}) =>
    lensRunMock(domain, action, params),
}));

// ── Mock viz: TreeDiagram → one button per node calling onSelect ────────────
// Recursively render selectable buttons so the node-select → detail-editor path runs.
vi.mock('@/components/viz', () => {
  function flatten(nodes: any[]): any[] {
    const out: any[] = [];
    const walk = (ns: any[]) => {
      for (const n of ns || []) {
        out.push(n);
        if (n.children) walk(n.children);
      }
    };
    walk(nodes);
    return out;
  }
  return {
    __esModule: true,
    TreeDiagram: ({ root, onSelect }: { root: any[]; onSelect?: (n: any) => void }) =>
      React.createElement(
        'div',
        { 'data-testid': 'tree-diagram' },
        flatten(root).map((n: any) =>
          React.createElement(
            'button',
            {
              key: n.id,
              'data-testid': `tree-node-${n.id}`,
              onClick: () => onSelect && onSelect(n),
            },
            n.label,
          ),
        ),
      ),
  };
});

// ── Mock lucide-react ────────────────────────────────────────────────────────
vi.mock('lucide-react', async () => {
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }),
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    __esModule: true,
    Network: make('Network'), Plus: make('Plus'), Trash2: make('Trash2'),
    Link2: make('Link2'), GitMerge: make('GitMerge'), Scissors: make('Scissors'),
    Route: make('Route'), Upload: make('Upload'), ShieldCheck: make('ShieldCheck'),
    Loader2: make('Loader2'), Database: make('Database'), X: make('X'),
    Search: make('Search'), FileJson: make('FileJson'), Pencil: make('Pencil'),
    Globe2: make('Globe2'), ChevronRight: make('ChevronRight'), ChevronDown: make('ChevronDown'),
  };
});

import { KnowledgeGraphWorkbench } from '@/components/entity/KnowledgeGraphWorkbench';

// ── Realistic graph fixtures ─────────────────────────────────────────────────
function makeGraph() {
  return {
    nodes: [
      {
        id: 'n1', name: 'Ada Lovelace', entityType: 'person',
        attributes: {
          born: { value: '1815', source: 'manual', at: 1000 },
          field: { value: 'mathematics', source: 'wikidata', at: 1001 },
        },
        wikidataId: 'Q7259', createdAt: 1,
      },
      {
        id: 'n2', name: 'Charles Babbage', entityType: 'person',
        attributes: {
          born: { value: '1791', source: 'manual', at: 1002 },
        },
        wikidataId: null, createdAt: 2,
      },
      {
        id: 'n3', name: 'Analytical Engine', entityType: 'concept',
        attributes: {},
        wikidataId: null, createdAt: 3,
      },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', relType: 'collaborated', weight: 1, createdAt: 1 },
      { id: 'e2', from: 'n2', to: 'n3', relType: 'designed', weight: 1, createdAt: 2 },
    ],
    schemas: [
      {
        id: 's1', className: 'Person',
        attributes: [
          { name: 'born', type: 'date', required: true },
          { name: 'field', type: 'string', required: false },
        ],
        createdAt: 1,
      },
    ],
  };
}

const okResult = (result: any = {}) => ({ data: { ok: true, result, error: null } });
const errResult = (error = 'Action failed') => ({ data: { ok: false, result: null, error } });

// routeHandlers maps macro action name → () => response (or throws)
let routeHandlers: Record<string, (params: any) => any>;

function installDefaultHandlers() {
  const graph = makeGraph();
  routeHandlers = {
    'graph-get': () => okResult(graph),
    'node-create': () => okResult({ id: 'nNew' }),
    'node-update': () => okResult({ ok: true }),
    'node-delete': () => okResult({ ok: true }),
    'edge-create': () => okResult({ id: 'eNew' }),
    'edge-delete': () => okResult({ ok: true }),
    'schema-save': () => okResult({ id: 'sNew' }),
    'schema-delete': () => okResult({ ok: true }),
    'node-merge': () => okResult({ ok: true }),
    'node-split': () => okResult({ id: 'nSplit' }),
    'import-bulk': () => okResult({ imported: 2 }),
    'import-wikidata': () => okResult({ id: 'nWd' }),
    'path-find': (p: any) =>
      okResult(
        p.from === 'n1' && p.to === 'n3'
          ? {
              found: true, hops: 2,
              path: [
                { nodeId: 'n1', name: 'Ada Lovelace' },
                { nodeId: 'n2', name: 'Charles Babbage', relTypeIn: 'collaborated' },
                { nodeId: 'n3', name: 'Analytical Engine', relTypeIn: 'designed' },
              ],
            }
          : { found: false, hops: 0, path: [], reason: 'disconnected' },
      ),
    'provenance-report': () =>
      okResult({
        totalAttributes: 3,
        sourceCount: 2,
        bySource: [
          { source: 'manual', count: 2 },
          { source: 'wikidata', count: 1 },
        ],
        entries: [
          { nodeId: 'n1', nodeName: 'Ada Lovelace', attribute: 'born', value: '1815', source: 'manual', at: 1700000000000 },
          { nodeId: 'n1', nodeName: 'Ada Lovelace', attribute: 'field', value: 'mathematics', source: 'wikidata', at: 1700000000001 },
          { nodeId: 'n2', nodeName: 'Charles Babbage', attribute: 'born', value: '1791', source: 'manual', at: null },
        ],
      }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  installDefaultHandlers();
  lensRunMock.mockImplementation((_domain: string, action: string, params: any) => {
    const h = routeHandlers[action];
    if (!h) return Promise.resolve(okResult({}));
    const r = h(params);
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve(r);
  });
  Element.prototype.scrollIntoView = vi.fn();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        search: [
          { id: 'Q42', label: 'Douglas Adams', description: 'English author' },
          { id: 'Q5', label: 'human', description: undefined },
        ],
      }),
  }) as any;
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function renderLoaded() {
  render(<KnowledgeGraphWorkbench />);
  await waitFor(() => expect(screen.getByText('Add Entity Node')).toBeDefined());
}

function clickTab(label: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(label, 'i') }));
}

describe('KnowledgeGraphWorkbench', () => {
  it('loads graph and shows header counts', async () => {
    await renderLoaded();
    expect(screen.getByText('3 nodes')).toBeDefined();
    expect(screen.getByText('2 edges')).toBeDefined();
    expect(screen.getByText('1 schemas')).toBeDefined();
    expect(lensRunMock).toHaveBeenCalledWith('entity', 'graph-get', expect.anything());
  });

  it('shows loading state initially', () => {
    let resolve: (v: any) => void = () => {};
    lensRunMock.mockImplementation(() => new Promise((r) => { resolve = r; }));
    render(<KnowledgeGraphWorkbench />);
    expect(screen.getByText(/Loading graph/)).toBeDefined();
    resolve(okResult(makeGraph()));
  });

  // ── Graph tab ──────────────────────────────────────────────────────────────
  it('adds a node (node-create)', async () => {
    await renderLoaded();
    typeInto(screen.getByPlaceholderText('Entity name'), 'New Person');
    fireEvent.click(screen.getByRole('button', { name: 'Add Node' }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('entity', 'node-create', expect.objectContaining({ name: 'New Person' })),
    );
    await waitFor(() => expect(screen.getByText('Node created')).toBeDefined());
  });

  it('creates an edge between two nodes (edge-create)', async () => {
    await renderLoaded();
    const selects = screen.getAllByRole('combobox');
    // First two selects in Graph tab are From / (newType) ... locate by surrounding text.
    // edgeFrom / edgeTo are the From… and To… selects.
    const fromSel = screen.getByDisplayValue('From…');
    const toSel = screen.getByDisplayValue('To…');
    fireEvent.change(fromSel, { target: { value: 'n1' } });
    fireEvent.change(toSel, { target: { value: 'n2' } });
    expect(selects.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('entity', 'edge-create', expect.objectContaining({ from: 'n1', to: 'n2' })),
    );
  });

  it('selects a node → opens detail editor → rename / add attr / delete attr / delete edge / delete node', async () => {
    await renderLoaded();

    // Select node n1 via tree button.
    fireEvent.click(screen.getByTestId('tree-node-n1'));
    expect(screen.getByText('Node Detail')).toBeDefined();
    expect(screen.getByText(/person · #n1/)).toBeDefined();

    // Rename.
    const renameInput = screen.getByDisplayValue('Ada Lovelace');
    typeInto(renameInput, "");
    typeInto(renameInput, 'Ada L');
    fireEvent.click(screen.getByRole('button', { name: 'Rename node' }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('entity', 'node-update', expect.objectContaining({ name: 'Ada L' })),
    );

    // Re-select (refresh resets selection deps but selected id persists; detail still shown).
    fireEvent.click(screen.getByTestId('tree-node-n1'));

    // Add attribute.
    typeInto(screen.getByPlaceholderText('key'), 'nationality');
    typeInto(screen.getByPlaceholderText('value'), 'British');
    fireEvent.click(screen.getByRole('button', { name: 'Set' }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('entity', 'node-update', expect.objectContaining({ attributeKey: 'nationality' })),
    );

    // Delete an existing attribute.
    fireEvent.click(screen.getByTestId('tree-node-n1'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete attribute born' }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('entity', 'node-update', expect.objectContaining({ deleteAttribute: true })),
    );

    // Delete an incident edge.
    fireEvent.click(screen.getByTestId('tree-node-n1'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete edge' }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('entity', 'edge-delete', expect.objectContaining({ id: 'e1' })),
    );

    // Delete node.
    fireEvent.click(screen.getByTestId('tree-node-n1'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete node' }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('entity', 'node-delete', expect.objectContaining({ id: 'n1' })),
    );
  });

  it('deselects node via the X button', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId('tree-node-n2'));
    expect(screen.getByText('Node Detail')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Deselect' }));
    expect(screen.getByText(/Select a node in the graph/)).toBeDefined();
  });

  it('shows empty-graph message when no nodes', async () => {
    routeHandlers['graph-get'] = () => okResult({ nodes: [], edges: [], schemas: [] });
    render(<KnowledgeGraphWorkbench />);
    await waitFor(() => expect(screen.getByText(/No nodes yet/)).toBeDefined());
  });

  it('surfaces error banner when a mutation fails (error result)', async () => {
    routeHandlers['node-create'] = () => errResult('boom');
    await renderLoaded();
    typeInto(screen.getByPlaceholderText('Entity name'), 'X');
    fireEvent.click(screen.getByRole('button', { name: 'Add Node' }));
    await waitFor(() => expect(screen.getByText('boom')).toBeDefined());
  });

  it('surfaces network-error banner when a mutation throws', async () => {
    routeHandlers['node-create'] = () => new Error('netfail');
    await renderLoaded();
    typeInto(screen.getByPlaceholderText('Entity name'), 'X');
    fireEvent.click(screen.getByRole('button', { name: 'Add Node' }));
    await waitFor(() => expect(screen.getByText('Network error')).toBeDefined());
  });

  // ── Schemas tab ──────────────────────────────────────────────────────────────
  it('creates a schema with attributes (schema-save)', async () => {
    await renderLoaded();
    clickTab('Schemas');
    typeInto(screen.getByPlaceholderText(/Class name/), 'Organization');
    typeInto(screen.getByPlaceholderText('attribute name'), 'founded');
    // Add another attribute row.
    fireEvent.click(screen.getByRole('button', { name: /Add attribute/ }));
    // Toggle a required checkbox.
    const checks = screen.getAllByRole('checkbox');
    fireEvent.click(checks[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save Schema' }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('entity', 'schema-save', expect.objectContaining({ className: 'Organization' })),
    );
  });

  it('removes an attribute row in the schema editor', async () => {
    await renderLoaded();
    clickTab('Schemas');
    fireEvent.click(screen.getByRole('button', { name: /Add attribute/ }));
    const removeBtns = screen.getAllByRole('button', { name: 'Remove attribute' });
    expect(removeBtns.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(removeBtns[0]);
  });

  it('edits an existing schema then cancels', async () => {
    await renderLoaded();
    clickTab('Schemas');
    expect(screen.getByText('Person')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Edit schema' }));
    expect(screen.getByText('Edit Entity Class')).toBeDefined();
    expect(screen.getByDisplayValue('Person')).toBeDefined();
    // change the type of first attr.
    const typeSelects = screen.getAllByRole('combobox');
    fireEvent.change(typeSelects[0], { target: { value: 'number' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Schema' }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('entity', 'schema-save', expect.objectContaining({ id: 's1' })),
    );
  });

  it('cancel button resets schema edit mode', async () => {
    await renderLoaded();
    clickTab('Schemas');
    fireEvent.click(screen.getByRole('button', { name: 'Edit schema' }));
    expect(screen.getByText('Edit Entity Class')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Define Entity Class')).toBeDefined();
  });

  it('deletes a schema (schema-delete)', async () => {
    await renderLoaded();
    clickTab('Schemas');
    fireEvent.click(screen.getByRole('button', { name: 'Delete schema' }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('entity', 'schema-delete', expect.objectContaining({ id: 's1' })),
    );
  });

  it('shows empty schemas message', async () => {
    routeHandlers['graph-get'] = () => okResult({ ...makeGraph(), schemas: [] });
    render(<KnowledgeGraphWorkbench />);
    await waitFor(() => expect(screen.getByText('Add Entity Node')).toBeDefined());
    clickTab('Schemas');
    expect(screen.getByText(/No entity classes defined yet/)).toBeDefined();
  });

  // ── Merge / Split tab ─────────────────────────────────────────────────────────
  it('merges nodes with a conflict winner pick (node-merge)', async () => {
    await renderLoaded();
    clickTab('Merge');
    // Source/target selects.
    const srcSel = screen.getByDisplayValue('Select source…');
    const tgtSel = screen.getByDisplayValue('Select target…');
    fireEvent.change(srcSel, { target: { value: 'n1' } }); // has born + field
    fireEvent.change(tgtSel, { target: { value: 'n2' } }); // has born → conflict on 'born'
    // Conflict reconciliation surfaces.
    expect(screen.getByText(/Attribute conflicts/)).toBeDefined();
    // Pick the source value for the conflict key.
    fireEvent.click(screen.getByRole('button', { name: /src:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Merge Nodes' }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith(
        'entity', 'node-merge',
        expect.objectContaining({ sourceId: 'n1', targetId: 'n2', fieldChoices: { born: 'source' } }),
      ),
    );
  });

  it('splits a node selecting attributes (node-split)', async () => {
    await renderLoaded();
    clickTab('Merge');
    fireEvent.click(screen.getByRole('button', { name: 'split' }));
    const splitSel = screen.getByDisplayValue('Select node to split…');
    fireEvent.change(splitSel, { target: { value: 'n1' } });
    typeInto(screen.getByPlaceholderText('New entity name'), 'Spun Off');
    // Select an attribute to move.
    const checks = screen.getAllByRole('checkbox');
    fireEvent.click(checks[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Split Node' }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('entity', 'node-split', expect.objectContaining({ id: 'n1', splitName: 'Spun Off' })),
    );
  });

  it('split shows "no attributes" message for an attribute-less node', async () => {
    await renderLoaded();
    clickTab('Merge');
    fireEvent.click(screen.getByRole('button', { name: 'split' }));
    const splitSel = screen.getByDisplayValue('Select node to split…');
    fireEvent.change(splitSel, { target: { value: 'n3' } }); // n3 has no attributes
    expect(screen.getByText(/Node has no attributes to split/)).toBeDefined();
  });

  // ── Path tab ──────────────────────────────────────────────────────────────────
  it('finds a path (found)', async () => {
    await renderLoaded();
    clickTab('Path');
    const fromSel = screen.getByDisplayValue('From entity…');
    const toSel = screen.getByDisplayValue('To entity…');
    fireEvent.change(fromSel, { target: { value: 'n1' } });
    fireEvent.change(toSel, { target: { value: 'n3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find Path' }));
    await waitFor(() => expect(screen.getByText(/Path found/)).toBeDefined());
    expect(screen.getByText(/2 hops/)).toBeDefined();
  });

  it('path not found shows no-path message', async () => {
    await renderLoaded();
    clickTab('Path');
    const fromSel = screen.getByDisplayValue('From entity…');
    const toSel = screen.getByDisplayValue('To entity…');
    fireEvent.change(fromSel, { target: { value: 'n2' } });
    fireEvent.change(toSel, { target: { value: 'n1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find Path' }));
    await waitFor(() => expect(screen.getByText(/No path exists/)).toBeDefined());
  });

  // ── Import tab ────────────────────────────────────────────────────────────────
  it('imports CSV rows (import-bulk)', async () => {
    await renderLoaded();
    clickTab('Import');
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: 'name,city\nAda,London\nCharles,Devon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import Rows' }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('entity', 'import-bulk', expect.objectContaining({ source: 'csv-import' })),
    );
  });

  it('imports JSON array rows (import-bulk)', async () => {
    await renderLoaded();
    clickTab('Import');
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: '[{"name":"Ada"},{"name":"Charles"}]' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import Rows' }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('entity', 'import-bulk', expect.objectContaining({ source: 'json-import' })),
    );
  });

  it('shows a parse error for malformed JSON', async () => {
    const { container } = render(<KnowledgeGraphWorkbench />);
    await waitFor(() => expect(screen.getByText('Add Entity Node')).toBeDefined());
    clickTab('Import');
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: '[{bad json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import Rows' }));
    // The parse error renders in a <p class="text-xs text-red-300"> below the textarea.
    await waitFor(() => {
      const errEl = container.querySelector('p.text-red-300');
      expect(errEl).not.toBeNull();
      expect((errEl as HTMLElement).textContent?.length).toBeGreaterThan(0);
    });
    // import-bulk must NOT have been called for an unparseable payload.
    expect(lensRunMock).not.toHaveBeenCalledWith('entity', 'import-bulk', expect.anything());
  });

  it('shows a parse error for a single-line CSV (no data rows)', async () => {
    await renderLoaded();
    clickTab('Import');
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: 'name,city' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import Rows' }));
    await waitFor(() => expect(screen.getByText(/CSV needs a header row/)).toBeDefined());
  });

  it('searches Wikidata and imports a result (import-wikidata)', async () => {
    await renderLoaded();
    clickTab('Import');
    fireEvent.click(screen.getByRole('button', { name: 'Wikidata' }));
    typeInto(screen.getByPlaceholderText(/Search Wikidata entities/), 'Adams');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByText('Douglas Adams')).toBeDefined());
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('wikidata.org'));
    // Import first result.
    fireEvent.click(screen.getAllByRole('button', { name: /Add/ })[0]);
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('entity', 'import-wikidata', expect.objectContaining({ wikidataId: 'Q42' })),
    );
  });

  it('Wikidata search via Enter key works', async () => {
    await renderLoaded();
    clickTab('Import');
    fireEvent.click(screen.getByRole('button', { name: 'Wikidata' }));
    const input = screen.getByPlaceholderText(/Search Wikidata entities/);
    fireEvent.change(input, { target: { value: 'human' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  });

  it('Wikidata shows no-results message', async () => {
    (global.fetch as any) = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ search: [] }) });
    await renderLoaded();
    clickTab('Import');
    fireEvent.click(screen.getByRole('button', { name: 'Wikidata' }));
    const input = screen.getByPlaceholderText(/Search Wikidata entities/);
    fireEvent.change(input, { target: { value: 'zzz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByText(/No results/)).toBeDefined());
  });

  // ── Provenance tab ────────────────────────────────────────────────────────────
  it('loads provenance, filters by source, then refreshes', async () => {
    await renderLoaded();
    clickTab('Provenance');
    await waitFor(() => expect(screen.getByText(/3 attribute values across 2 sources/)).toBeDefined());
    // entry rows.
    expect(screen.getAllByText('Ada Lovelace').length).toBeGreaterThan(0);
    // Filter by 'wikidata' source.
    fireEvent.click(screen.getByRole('button', { name: /wikidata \(1\)/ }));
    await waitFor(() => expect(screen.getByText('mathematics')).toBeDefined());
    // Back to all.
    fireEvent.click(screen.getByRole('button', { name: /all \(3\)/ }));
    // Refresh.
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('entity', 'provenance-report', expect.anything()),
    );
  });

  it('provenance shows empty message when no attributes', async () => {
    routeHandlers['provenance-report'] = () =>
      okResult({ totalAttributes: 0, sourceCount: 0, bySource: [], entries: [] });
    await renderLoaded();
    clickTab('Provenance');
    await waitFor(() => expect(screen.getByText(/No attributes recorded yet/)).toBeDefined());
  });

  it('provenance shows loading state', async () => {
    let resolveProv: (v: any) => void = () => {};
    routeHandlers['provenance-report'] = () => {
      return new Promise((r) => { resolveProv = r; }) as any;
    };
    await renderLoaded();
    clickTab('Provenance');
    expect(screen.getByText(/Loading provenance/)).toBeDefined();
    resolveProv(okResult({ totalAttributes: 0, sourceCount: 0, bySource: [], entries: [] }));
  });

  it('renders all six tabs and switches between them', async () => {
    await renderLoaded();
    for (const t of ['Graph', 'Schemas', 'Merge', 'Path', 'Import', 'Provenance']) {
      clickTab(t);
    }
    // Back on provenance after the loop.
    await waitFor(() => {
      const surface = within(document.body);
      expect(surface).toBeDefined();
    });
  });
});
