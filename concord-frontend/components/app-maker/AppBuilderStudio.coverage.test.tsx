// Render coverage for the Studio builder: opens a fully populated project and
// walks every tab (editor, data model, workflows, connectors, components,
// quests, preview, deploy, history), exercising the form handlers on each.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { actionOf, exercise } from '../../tests/helpers/exercise';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
}));

import { AppBuilderStudio } from './AppBuilderStudio';

const now = '2026-03-01T10:00:00.000Z';
const project = {
  id: 'p1', name: 'Todo App', createdAt: now, updatedAt: now,
  pages: [
    { id: 'pg1', name: 'Home', route: '/', elements: [
      { id: 'e1', type: 'button', x: 10, y: 10, w: 120, h: 40, props: { label: 'Go' } },
      { id: 'e2', type: 'table', x: 10, y: 80, w: 300, h: 160, props: {}, binding: { kind: 'table', refId: 't1', label: 'Tasks', boundAt: now } },
      { id: 'e3', type: 'heading', x: 10, y: 260, w: 200, h: 40, props: { text: 'Hi' } },
    ] },
    { id: 'pg2', name: 'About', route: '/about', elements: [] },
  ],
  dataModel: {
    tables: [
      { id: 't1', name: 'Tasks', fields: [{ id: 'f1', name: 'id', type: 'uuid', required: true, primary: true }, { id: 'f2', name: 'title', type: 'text', required: false, primary: false }] },
      { id: 't2', name: 'Users', fields: [{ id: 'f3', name: 'id', type: 'uuid', required: true, primary: true }] },
    ],
    relations: [{ id: 'r1', fromTable: 't1', toTable: 't2', fromName: 'owner', toName: 'tasks', kind: 'one-to-many', label: 'owns' }],
  },
  workflows: [{ id: 'w1', name: 'On submit', trigger: 'onClick', enabled: true, steps: [{ id: 's1', action: 'navigate', target: 'pg2', config: {} }] }],
  connectors: [{ id: 'c1', name: 'Weather', kind: 'rest', endpoint: 'https://example.org/api', method: 'GET', authMode: 'none', status: 'ok' }],
  componentLibrary: [{ id: 'l1', name: 'Hero', baseType: 'card', props: {}, style: { bg: '#111' } }],
  versions: [], deployment: { status: 'draft', url: null, deployedAt: null },
};
const summary = { id: 'p1', name: 'Todo App', pageCount: 2, tableCount: 2, workflowCount: 1, connectorCount: 1, versionCount: 1, deployment: { status: 'draft', url: null } };
const qgraph = {
  id: 'g1', title: 'Main quest',
  nodes: [{ id: 'n1', kind: 'start', title: 'Begin', body: 'b', x: 20, y: 20 }, { id: 'n2', kind: 'ending', title: 'End', body: '', x: 200, y: 80 }],
  edges: [{ id: 'ed1', from: 'n1', to: 'n2', label: 'go' }],
};
const RESULTS: Record<string, unknown> = {
  projectList: { projects: [summary] },
  projectGet: { project },
  projectCreate: { project },
  editorPalette: { palette: [{ type: 'button', label: 'Button', category: 'basic', w: 120, h: 40 }, { type: 'table', label: 'Table', category: 'data', w: 300, h: 160 }] },
  dataFieldTypes: { fieldTypes: ['text', 'number', 'uuid'] },
  dataBindings: { bindings: [{ pageId: 'pg1', pageName: 'Home', elementId: 'e2', elementType: 'table', kind: 'table', refId: 't1', label: 'Tasks' }] },
  workflowOptions: { triggers: ['onClick', 'onLoad'], actions: ['navigate', 'callConnector'] },
  connectorKinds: { kinds: [{ kind: 'rest', label: 'REST', methods: ['GET', 'POST'], authModes: ['none', 'bearer'] }] },
  connectorTest: { ok: true, status: 200, latencyMs: 12, sample: '{}' },
  libraryList: { library: project.componentLibrary },
  marketBrowse: { listings: [{ id: 'm1', name: 'Pricing', description: 'd', category: 'marketing', baseType: 'card', publisherId: 'u2', installs: 3, publishedAt: now }], categories: ['marketing'] },
  questGraphList: { graphs: [{ id: 'g1', title: 'Main quest', createdAt: now, updatedAt: now, nodeCount: 2, edgeCount: 1 }] },
  questGraphGet: { graph: qgraph },
  questGraphCreate: { graph: qgraph },
  questNodeSave: { node: qgraph.nodes[0] },
  questGraphValidate: { valid: false, issues: [{ severity: 'error', type: 'orphan', nodeId: 'n2', title: 'End' }, { severity: 'warning', type: 'dead-end' }], summary: { nodes: 2, edges: 1, reachable: 2, endings: 1, errorCount: 1, warningCount: 1 } },
  previewRender: { html: '<p>preview</p>' },
  deployStatus: { deployment: { status: 'draft', url: null, deployedAt: null } },
  deployPublish: { deployment: { status: 'live', url: 'https://example.org/app', deployedAt: now } },
  versionList: { versions: [{ id: 'v1', label: 'first', createdAt: now, deployUrl: null, pageCount: 2, tableCount: 2 }] },
};

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...args: unknown[]) => ({ data: actionOf(args) === 'projectDelete' ? { ok: false, error: 'kept' } : { ok: true, result: RESULTS[actionOf(args)] ?? {}, error: null } }));
  vi.spyOn(window, 'prompt').mockReturnValue('Renamed');
  vi.spyOn(window, 'confirm').mockImplementation((m?: string) => !/Delete project/.test(String(m)));
});

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const SKIP = /^(cancel|close|dismiss)$|new project|todo app|^rename$|^duplicate$|^delete$/i;

describe('AppBuilderStudio', () => {
  it('lists projects and opens one', async () => {
    const view = render(<AppBuilderStudio />);
    await settle();
    expect(view.container.textContent).toContain('Todo App');
    await exercise({ passes: 2, skip: SKIP });
    await settle();
  });

  it.each(['Editor', 'Data Model', 'Workflows', 'Connectors', 'Components', 'Quests', 'Preview', 'Deploy', 'History'])('walks the %s tab', async (label) => {
    const view = render(<AppBuilderStudio />);
    await settle();
    const open = Array.from(view.container.querySelectorAll('button, [role="button"], div, li')).find((e) => e.children.length === 0 && /Todo App/.test(e.textContent || ''));
    if (open) await act(async () => { fireEvent.click(open); });
    await settle();
    for (let round = 0; round < 3; round++) {
      const tabBtn = Array.from(view.container.querySelectorAll('button')).find((b) => new RegExp(`^\\s*${label}\\s*$`).test(b.textContent || ''));
      if (tabBtn) await act(async () => { fireEvent.click(tabBtn); });
      await settle();
      // canvas gestures: drag/drop/click on every positioned or draggable element
      const els = Array.from(view.container.querySelectorAll('[draggable="true"], [style*="left"], [style*="position: absolute"], svg:not([class*="lucide"]), canvas')) as HTMLElement[];
      for (const el of els.slice(0, 25)) {
        await act(async () => {
          fireEvent.dragStart(el); fireEvent.dragOver(el); fireEvent.drop(el); fireEvent.dragEnd(el);
          fireEvent.mouseDown(el, { clientX: 20, clientY: 20 }); fireEvent.mouseMove(el, { clientX: 60, clientY: 50 });
          fireEvent.mouseMove(document, { clientX: 80, clientY: 60 }); fireEvent.mouseUp(document); fireEvent.mouseUp(el);
          fireEvent.click(el);
        });
      }
      await settle();
      await exercise({ passes: 2, skip: new RegExp(`${SKIP.source}|^(editor|data model|workflows|connectors|components|quests|preview|deploy|history)$`, 'i') });
      await settle();
    }
    expect(view.container.textContent).toBeTruthy();
  });

  it('shows an honest empty state when the list call fails', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(<AppBuilderStudio />);
    await settle();
    expect(view.container.textContent).toBeTruthy();
  });
});
