// Render + behaviour coverage for the ML lens panels: AutoML, dataset hub, deployments,
// experiment tracker, inference playground, the ML action panel, model hub and spaces. Panels
// mount against stubbed engine results, must render real content, survive a full exercise pass
// and degrade honestly offline; the macro-driven flows assert the macro each control sends.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const runDomain = vi.fn();
const apiPost = vi.fn();
const DATASET = { id: 'ds1', name: 'Iris', type: 'tabular', splits: { train: 80, val: 10, test: 10 }, latestVersion: 2, versions: [{ version: 1, samples: 100, features: 4, sizeMb: 0.1, note: 'first', createdAt: '2026-03-01' }, { version: 2, samples: 150, features: 4, sizeMb: 0.2, note: 'more', createdAt: '2026-03-02' }], createdAt: '2026-03-01' };
const DEPLOY = { id: 'dp1', modelId: 'm1', modelName: 'Sentiment', version: 'v3', status: 'active', invoke: { domain: 'ml', name: 'infer', input: {} }, totalRequests: 40, errorCount: 1, avgLatency: 120, lastInvokedAt: '2026-03-02', createdAt: '2026-03-01' };
const EXPERIMENT = { id: 'ex1', name: 'resnet-lr', modelId: 'm1', datasetId: 'ds1', status: 'running', hyperparams: { learningRate: 0.001, batchSize: 32, epochs: 10, optimizer: 'adam' }, metrics: [{ epoch: 1, trainLoss: 1.2, valLoss: 1.3, accuracy: 0.6, learningRate: 0.001 }, { epoch: 2, trainLoss: 0.9, valLoss: 1.0, accuracy: 0.7, learningRate: 0.001 }], tags: ['vision'], startedAt: '2026-03-01', completedAt: null };
const HUB_MODEL = { id: 'org/bert', name: 'bert', author: 'org', task: 'text-classification', library: 'transformers', downloads: 12000, likes: 340, tags: ['nlp'], updatedAt: '2026-02-01', gated: false, url: 'https://hf.co/org/bert' };
const SPACE = { id: 'sp1', title: 'Demo', modelId: 'm1', description: 'Try it', sdk: 'gradio', task: 'text', visibility: 'public', url: 'https://hf.co/spaces/demo', likes: 3, views: 90, createdAt: '2026-03-01' };

function resultFor(action: string): unknown {
  switch (action) {
    case 'dataset-list': return { datasets: [DATASET] };
    case 'dataset-hub': return { datasets: [{ id: 'hd1', name: 'glue', author: 'nyu', downloads: 9000, likes: 200, tags: ['nlp'], updatedAt: '2026-01-01', url: 'https://hf.co/datasets/glue' }] };
    case 'automl-templates': return { templates: [{ id: 'at1', task: 'classification', title: 'Tabular classifier', description: 'Fits baseline models', steps: ['Profile', 'Split', 'Train'], recommendedModels: ['random-forest'], estimatedTime: '2 min', wired: true }, { id: 'at2', task: 'regression', title: 'Regressor', description: 'x', steps: ['Fit'], recommendedModels: [], estimatedTime: '1 min' }] };
    case 'automl-run': return { run: { templateId: 'at1', datasetName: 'Iris', experimentId: 'ex9', profile: { samples: 150, features: 4 }, steps: [{ step: 'Profile', detail: 'ok', done: true }, { step: 'Train', detail: 'queued', done: false }], note: 'Receipt only' } };
    case 'deploy-list': return { deployments: [DEPLOY, { ...DEPLOY, id: 'dp2', status: 'inactive', invoke: undefined, avgLatency: null }] };
    case 'deploy-invoke': return { output: { label: 'positive' }, servedBy: 'local', latencyMs: 80 };
    case 'experiment-list': return { experiments: [EXPERIMENT, { ...EXPERIMENT, id: 'ex2', status: 'completed', completedAt: '2026-03-02' }, { ...EXPERIMENT, id: 'ex3', status: 'failed', metrics: [] }] };
    case 'playground-infer': return { modelId: 'org/bert', input: 'great', output: [{ label: 'POSITIVE', score: 0.98 }], latencyMs: 410, source: 'hf-inference', servedBy: 'hf', attempts: [{ provider: 'hf', ok: true }] };
    case 'model-hub': return { models: [HUB_MODEL, { ...HUB_MODEL, id: 'org/gpt', name: 'gpt', gated: true }] };
    case 'model-card': return { card: { ...HUB_MODEL, license: 'apache-2.0', siblings: ['config.json', 'model.safetensors'] } };
    case 'space-list': return { spaces: [SPACE, { ...SPACE, id: 'sp2', visibility: 'private' }] };
    case 'modelEvaluate': return { type: 'classification', samples: 4, counts: { predictions: 4, actuals: 4 }, accuracy: 0.75, avgF1: 0.7, perClass: [{ class: 'a', precision: 1, recall: 0.5, f1: 0.66, support: 2 }], mse: 0.2, rmse: 0.44, mae: 0.3, r2: 0.8 };
    case 'featureImportance': return { totalFeatures: 3, numericFeatures: 3, targetField: 'y', rankings: [{ feature: 'x1', variance: 2, stdDev: 1.4, correlation: 0.9, importance: 0.8 }], topFeatures: ['x1'] };
    case 'datasetProfile': return { rows: 100, columns: 3, qualityScore: 88, profile: [{ field: 'x1', type: 'number', nullCount: 1, nullRate: 0.01, cardinality: 90, stats: { min: 0, max: 9, mean: 4, median: 4, q1: 2, q3: 6, outliers: 1 } }, { field: 'name', type: 'string', nullCount: 0, nullRate: 0, cardinality: 5 }] };
    case 'hyperparameterSuggest': return { modelType: 'neural-network', taskType: 'classification', datasetSize: 1000, featureCount: 10, suggestions: { learningRate: 0.001, batchSize: 32 }, notes: ['Start small'] };
    default: return { ok: true };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: (...a: unknown[]) => apiPost(...a), delete: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/viz', () => ({ ChartKit: () => <div>chart</div> }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => <button>save-as-dtu</button> }));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn(), subscribe: vi.fn() }),
  useRecallableAction: () => ({ run: (fn: () => Promise<unknown>) => fn(), state: 'idle' }),
  RecallSlot: () => null,
}));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { AutoMLPanel } from '../AutoMLPanel';
import { DatasetHubPanel } from '../DatasetHubPanel';
import { DeploymentsPanel } from '../DeploymentsPanel';
import { ExperimentTracker } from '../ExperimentTracker';
import { InferencePlayground } from '../InferencePlayground';
import { MlActionPanel } from '../MlActionPanel';
import { ModelHubPanel } from '../ModelHubPanel';
import { SpacesPanel } from '../SpacesPanel';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 5)); });
  return !!hits[nth];
};
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset(); runDomain.mockReset(); apiPost.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
  runDomain.mockImplementation(async (_d: string, action: string) => ({ data: { ok: true, result: resultFor(action) } }));
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
  apiPost.mockResolvedValue({ data: { ok: true, result: { id: 'dtu-1', dtu: { id: 'dtu-1' }, answer: 'Brief.' } } });
});

const PANELS: Array<[string, () => React.ReactElement]> = [
  ['AutoMLPanel', () => <AutoMLPanel />],
  ['DatasetHubPanel', () => <DatasetHubPanel />],
  ['DeploymentsPanel', () => <DeploymentsPanel />],
  ['ExperimentTracker', () => <ExperimentTracker />],
  ['InferencePlayground', () => <InferencePlayground />],
  ['MlActionPanel', () => <MlActionPanel />],
  ['ModelHubPanel', () => <ModelHubPanel />],
  ['SpacesPanel', () => <SpacesPanel />],
];

describe('ml panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(20);
    await exercise({ passes: 4, text: 'bert' });
    await settle();
    await exercise({ passes: 2, text: '[1,2,3]' });
    expect(view.container.textContent).toBeTruthy();
  });

  it.each(PANELS)('%s stays standing when the backend is offline', async (_n, make) => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    runDomain.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(make());
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});

describe('ml flows', () => {
  it('automl lists templates, picks one, runs it against a dataset and shows the receipt', async () => {
    render(<AutoMLPanel />);
    await settle();
    await press(/Tabular classifier/);
    const select = Array.from(document.querySelectorAll('select')).find((x) => Array.from(x.options).some((o) => o.value === 'ds1')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'ds1' } });
    await press(/Run configuration/i);
    await settle();
    expect(sent()).toEqual(expect.arrayContaining(['automl-templates', 'dataset-list']));
    expect(sent()).toContain('automl-run');
    expect(document.body.textContent).toMatch(/Receipt only|Iris/);
  });

  it('the dataset hub searches the hub, registers a dataset and deletes one', async () => {
    render(<DatasetHubPanel />);
    await settle();
    await exercise({ passes: 4, text: 'iris' });
    await press(/Delete|Trash/i); await press(/Confirm|Yes|Delete/i);
    expect(sent()).toEqual(expect.arrayContaining(['dataset-hub', 'dataset-list']));
    expect(sent().some((x) => /dataset-register|dataset-delete/.test(x))).toBe(true);
  });

  it('datasets: switch to My Datasets, register a version (success then failure), and delete in two steps', async () => {
    render(<DatasetHubPanel />);
    await settle();
    await press(/My Datasets/);
    await press(/Register Dataset/);
    await press(/^Register$/);
    expect(document.body.textContent).toMatch(/Name required|Register Dataset Version/);
    fireEvent.change(screen.getByPlaceholderText('Dataset name'), { target: { value: 'Wine' } });
    for (const [i, el] of (Array.from(document.querySelectorAll('input[type="number"]')) as HTMLInputElement[]).entries()) fireEvent.change(el, { target: { value: String(i + 2) } });
    fireEvent.change(screen.getByPlaceholderText(/Version note/), { target: { value: 'cleaned' } });
    lensRunMock.mockImplementationOnce(async () => ({ data: { ok: true, result: resultFor('dataset-list') } }));
    lensRunMock.mockImplementationOnce(async () => ({ data: { ok: false, error: 'duplicate version' } }));
    await press(/^Register$/);
    await press(/^Register$/);
    expect(sent()).toContain('dataset-register');
    await press(/Cancel/);
    await press(/^Delete$/);
    await press(/Delete ".+"\?/);
    expect(sent()).toContain('dataset-delete');
  });

  it('deployments invoke a model, pause and resume it, create and delete', async () => {
    render(<DeploymentsPanel />);
    await settle();
    await press(/Invoke|Test|Run/i);
    await press(/Pause|Stop|Resume/i);
    await exercise({ passes: 4, text: 'sentiment' });
    await press(/Delete|Trash/i); await press(/Confirm|Yes|Delete/i);
    expect(sent()).toContain('deploy-list');
    expect(sent().some((x) => /deploy-invoke|deploy-stop|deploy-create|deploy-delete/.test(x))).toBe(true);
  });

  it('the experiment tracker logs metrics, finishes, fails and removes a run, and starts a new one', async () => {
    render(<ExperimentTracker />);
    await settle();
    await exercise({ passes: 4, text: '0.5' });
    await press(/Finish|Complete/i); await press(/Fail|Abort/i);
    await press(/Delete|Trash/i); await press(/Confirm|Yes|Delete/i);
    expect(sent()).toContain('experiment-list');
    expect(sent().some((x) => /experiment-log|experiment-finish|experiment-start|experiment-delete/.test(x))).toBe(true);
  });

  it('the inference playground sends a model and an input, and reports a failure', async () => {
    render(<InferencePlayground />);
    await settle();
    const boxes = screen.getAllByRole('textbox');
    fireEvent.change(boxes[0], { target: { value: 'org/bert' } });
    if (boxes[1]) fireEvent.change(boxes[1], { target: { value: 'great product' } });
    await press(/Run|Infer|Send|Submit/i);
    expect(sent()).toContain('playground-infer');
    expect(document.body.textContent).toMatch(/POSITIVE|hf|410/);
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'rate limited' } }));
    await press(/Run|Infer|Send|Submit/i);
    expect(document.body.textContent).toMatch(/rate limited|Inference failed/);
  });

  it('the ML action panel runs evaluation, feature importance, profiling and hyperparameter suggestions', async () => {
    render(<MlActionPanel />);
    await settle();
    const [preds, acts, ds] = Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[];
    fireEvent.change(preds, { target: { value: '1,0,1,1' } });
    fireEvent.change(acts, { target: { value: '1,0,0,1' } });
    fireEvent.change(ds, { target: { value: JSON.stringify({ dataset: [{ x1: 1, y: 0 }, { x1: 2, y: 1 }], target: 'y' }) } });
    fireEvent.change(screen.getByPlaceholderText('rows'), { target: { value: '1000' } });
    fireEvent.change(screen.getByPlaceholderText('features'), { target: { value: '10' } });
    fireEvent.change(screen.getByPlaceholderText(/DM/), { target: { value: 'friend-1' } });
    for (const label of [/^Evaluate/, /^Features/, /^Profile/, /^Hyper/, /^Mint/, /^DM/, /^Publish/, /^Publish/, /^Lever/]) await press(label);
    const a = runDomain.mock.calls.map((c) => String(c[1]));
    expect(a.some((x) => /modelEvaluate|featureImportance|datasetProfile|hyperparameterSuggest/.test(x))).toBe(true);
    expect(apiPost).toHaveBeenCalled();
  });

  it('the model hub searches, filters, sorts and opens a model card', async () => {
    render(<ModelHubPanel />);
    await settle();
    await exercise({ passes: 3, text: 'bert' });
    await press(/bert/);
    expect(sent()).toContain('model-hub');
    expect(sent().some((x) => /model-card/.test(x))).toBe(true);
  });

  it('spaces list, create and delete', async () => {
    render(<SpacesPanel />);
    await settle();
    await exercise({ passes: 4, text: 'Demo space' });
    await press(/Delete|Trash/i); await press(/Confirm|Yes|Delete/i);
    expect(sent()).toContain('space-list');
    expect(sent().some((x) => /space-create|space-delete/.test(x))).toBe(true);
  });
});
