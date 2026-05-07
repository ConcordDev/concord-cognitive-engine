'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Clock,
  Calendar,
  Timer,
  GitBranch,
  Play,
  Plus,
  Search,
  Trash2,
  X,
  BarChart3,
  Zap,
  ScanLine,
  History,
} from 'lucide-react';
import { LensPageShell } from '@/components/lens/LensPageShell';

type ModeTab = 'frames' | 'events' | 'simulations' | 'timelines' | 'patterns' | 'snapshots';
type ArtifactType = 'TimeFrame' | 'Event' | 'Simulation' | 'Timeline' | 'Pattern' | 'Snapshot';
type Status = 'active' | 'completed' | 'pending' | 'running' | 'archived' | 'scheduled';

interface TemporalArtifact {
  name: string;
  type: ArtifactType;
  status: Status;
  description: string;
  notes: string;
  startDate?: string;
  endDate?: string;
  duration?: string;
  timespan?: string;
  scenario?: string;
  result?: string;
  confidence?: number;
  eventDate?: string;
  eventType?: string;
  impact?: string;
  recurrence?: string;
  timelineName?: string;
  branch?: string;
  divergencePoint?: string;
  patternName?: string;
  frequency?: string;
  lastOccurrence?: string;
  nextPredicted?: string;
  snapshotDate?: string;
  snapshotData?: string;
  version?: number;
  priority?: string;
  category?: string;
}

const MODE_TABS: { id: ModeTab; label: string; icon: typeof Clock; artifactType: ArtifactType }[] =
  [
    { id: 'frames', label: 'Time Frames', icon: Clock, artifactType: 'TimeFrame' },
    { id: 'events', label: 'Events', icon: Calendar, artifactType: 'Event' },
    { id: 'simulations', label: 'Simulations', icon: Play, artifactType: 'Simulation' },
    { id: 'timelines', label: 'Timelines', icon: GitBranch, artifactType: 'Timeline' },
    { id: 'patterns', label: 'Patterns', icon: ScanLine, artifactType: 'Pattern' },
    { id: 'snapshots', label: 'Snapshots', icon: History, artifactType: 'Snapshot' },
  ];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active: { label: 'Active', color: 'green-400' },
  completed: { label: 'Completed', color: 'emerald-400' },
  pending: { label: 'Pending', color: 'yellow-400' },
  running: { label: 'Running', color: 'blue-400' },
  archived: { label: 'Archived', color: 'gray-400' },
  scheduled: { label: 'Scheduled', color: 'purple-400' },
};

const EVENT_TYPES = [
  'Milestone',
  'Deadline',
  'Trigger',
  'Observation',
  'Anomaly',
  'Transition',
  'Checkpoint',
  'Other',
];
const TIMESPAN_OPTIONS = [
  '1 Hour',
  '1 Day',
  '1 Week',
  '1 Month',
  '3 Months',
  '6 Months',
  '1 Year',
  '5 Years',
  '10 Years',
];
const IMPACT_LEVELS = ['Negligible', 'Low', 'Medium', 'High', 'Critical'];
const RECURRENCE_OPTIONS = ['None', 'Daily', 'Weekly', 'Monthly', 'Quarterly', 'Yearly', 'Custom'];

export default function TemporalLensPage() {
  const [activeTab, setActiveTab] = useState<ModeTab>('frames');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<TemporalArtifact> | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStatus, setFormStatus] = useState<Status>('active');
  const [formNotes, setFormNotes] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formDuration, setFormDuration] = useState('');
  const [formTimespan, setFormTimespan] = useState(TIMESPAN_OPTIONS[3]);
  const [formScenario, setFormScenario] = useState('');
  const [formResult, setFormResult] = useState('');
  const [formConfidence, setFormConfidence] = useState('');
  const [formEventDate, setFormEventDate] = useState('');
  const [formEventType, setFormEventType] = useState(EVENT_TYPES[0]);
  const [formImpact, setFormImpact] = useState(IMPACT_LEVELS[2]);
  const [formRecurrence, setFormRecurrence] = useState(RECURRENCE_OPTIONS[0]);
  const [formBranch, setFormBranch] = useState('');
  const [formDivergencePoint, setFormDivergencePoint] = useState('');
  const [formFrequency, setFormFrequency] = useState('');
  const [formLastOccurrence, setFormLastOccurrence] = useState('');
  const [formNextPredicted, setFormNextPredicted] = useState('');
  const [formCategory, setFormCategory] = useState('');

  const activeArtifactType = MODE_TABS.find((t) => t.id === activeTab)?.artifactType || 'TimeFrame';
  const { items, isLoading, isError, error, refetch, create, update, remove } =
    useLensData<TemporalArtifact>('temporal', activeArtifactType, { seed: [] });
  const runAction = useRunArtifact('temporal');

  const filtered = useMemo(() => {
    let result = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.data as unknown as TemporalArtifact).description?.toLowerCase().includes(q)
      );
    }
    if (filterStatus !== 'all')
      result = result.filter(
        (i) => (i.data as unknown as TemporalArtifact).status === filterStatus
      );
    return result;
  }, [items, searchQuery, filterStatus]);

  const handleAction = useCallback(
    async (action: string, artifactId?: string) => {
      const targetId = artifactId || filtered[0]?.id;
      if (!targetId) return;
      try {
        await runAction.mutateAsync({ id: targetId, action });
      } catch (err) {
        console.error('Action failed:', err);
      }
    },
    [filtered, runAction]
  );

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormStatus('active');
    setFormNotes('');
    setFormStartDate('');
    setFormEndDate('');
    setFormDuration('');
    setFormTimespan(TIMESPAN_OPTIONS[3]);
    setFormScenario('');
    setFormResult('');
    setFormConfidence('');
    setFormEventDate('');
    setFormEventType(EVENT_TYPES[0]);
    setFormImpact(IMPACT_LEVELS[2]);
    setFormRecurrence(RECURRENCE_OPTIONS[0]);
    setFormBranch('');
    setFormDivergencePoint('');
    setFormFrequency('');
    setFormLastOccurrence('');
    setFormNextPredicted('');
    setFormCategory('');
  };

  const openCreate = () => {
    setEditingItem(null);
    resetForm();
    setEditorOpen(true);
  };
  const openEdit = (item: LensItem<TemporalArtifact>) => {
    const d = item.data as unknown as TemporalArtifact;
    setEditingItem(item);
    setFormName(d.name || '');
    setFormDescription(d.description || '');
    setFormStatus(d.status || 'active');
    setFormNotes(d.notes || '');
    setFormStartDate(d.startDate || '');
    setFormEndDate(d.endDate || '');
    setFormDuration(d.duration || '');
    setFormTimespan(d.timespan || TIMESPAN_OPTIONS[3]);
    setFormScenario(d.scenario || '');
    setFormResult(d.result || '');
    setFormConfidence(d.confidence?.toString() || '');
    setFormEventDate(d.eventDate || '');
    setFormEventType(d.eventType || EVENT_TYPES[0]);
    setFormImpact(d.impact || IMPACT_LEVELS[2]);
    setFormRecurrence(d.recurrence || RECURRENCE_OPTIONS[0]);
    setFormBranch(d.branch || '');
    setFormDivergencePoint(d.divergencePoint || '');
    setFormFrequency(d.frequency || '');
    setFormLastOccurrence(d.lastOccurrence || '');
    setFormNextPredicted(d.nextPredicted || '');
    setFormCategory(d.category || '');
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const data: Record<string, unknown> = {
      name: formName,
      type: activeArtifactType,
      status: formStatus,
      description: formDescription,
      notes: formNotes,
      category: formCategory,
      startDate: formStartDate,
      endDate: formEndDate,
      duration: formDuration,
      timespan: formTimespan,
      scenario: formScenario,
      result: formResult,
      confidence: formConfidence ? parseFloat(formConfidence) : undefined,
      eventDate: formEventDate,
      eventType: formEventType,
      impact: formImpact,
      recurrence: formRecurrence,
      branch: formBranch,
      divergencePoint: formDivergencePoint,
      frequency: formFrequency,
      lastOccurrence: formLastOccurrence,
      nextPredicted: formNextPredicted,
    };
    if (editingItem)
      await update(editingItem.id, {
        title: formName,
        data,
        meta: { tags: [], status: formStatus, visibility: 'private' },
      });
    else
      await create({
        title: formName,
        data,
        meta: { tags: [], status: formStatus, visibility: 'private' },
      });
    setEditorOpen(false);
  };

  const renderDashboard = () => {
    const all = items.map((i) => i.data as unknown as TemporalArtifact);
    const activeFrames = all.filter((a) => a.status === 'active').length;
    const runningSimulations = all.filter((a) => a.status === 'running').length;
    const patterns = all.filter((a) => a.frequency).length;
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={ds.panel}>
          <Clock className="w-5 h-5 text-neon-cyan mb-2" />
          <p className={ds.textMuted}>Active Frames</p>
          <p className="text-xl font-bold text-white">{activeFrames}</p>
        </div>
        <div className={ds.panel}>
          <Play className="w-5 h-5 text-neon-purple mb-2" />
          <p className={ds.textMuted}>Simulations</p>
          <p className="text-xl font-bold text-white">{runningSimulations}</p>
        </div>
        <div className={ds.panel}>
          <ScanLine className="w-5 h-5 text-neon-green mb-2" />
          <p className={ds.textMuted}>Patterns</p>
          <p className="text-xl font-bold text-white">{patterns}</p>
        </div>
        <div className={ds.panel}>
          <GitBranch className="w-5 h-5 text-neon-blue mb-2" />
          <p className={ds.textMuted}>Timelines</p>
          <p className="text-xl font-bold text-white">{all.filter((a) => a.branch).length}</p>
        </div>
      </div>
    );
  };

  const renderEditor = () => {
    if (!editorOpen) return null;
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={() => setEditorOpen(false)}
      >
        <div
          className={cn(ds.panel, 'w-full max-w-lg max-h-[85vh] overflow-y-auto')}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className={ds.heading3}>
              {editingItem ? 'Edit' : 'New'} {activeArtifactType.replace(/([A-Z])/g, ' $1').trim()}
            </h3>
            <button onClick={() => setEditorOpen(false)} className={ds.btnGhost}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <label className={ds.label}>Name</label>
              <input
                className={ds.input}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div>
              <label className={ds.label}>Description</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={ds.label}>Status</label>
                <select
                  className={ds.select}
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value as Status)}
                >
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={ds.label}>Category</label>
                <input
                  className={ds.input}
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                />
              </div>
            </div>

            {activeArtifactType === 'TimeFrame' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={ds.label}>Start</label>
                    <input
                      type="date"
                      className={ds.input}
                      value={formStartDate}
                      onChange={(e) => setFormStartDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>End</label>
                    <input
                      type="date"
                      className={ds.input}
                      value={formEndDate}
                      onChange={(e) => setFormEndDate(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className={ds.label}>Duration</label>
                  <input
                    className={ds.input}
                    value={formDuration}
                    onChange={(e) => setFormDuration(e.target.value)}
                    placeholder="e.g. 3 months"
                  />
                </div>
              </>
            )}

            {activeArtifactType === 'Event' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={ds.label}>Event Date</label>
                    <input
                      type="date"
                      className={ds.input}
                      value={formEventDate}
                      onChange={(e) => setFormEventDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Type</label>
                    <select
                      className={ds.select}
                      value={formEventType}
                      onChange={(e) => setFormEventType(e.target.value)}
                    >
                      {EVENT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={ds.label}>Impact</label>
                    <select
                      className={ds.select}
                      value={formImpact}
                      onChange={(e) => setFormImpact(e.target.value)}
                    >
                      {IMPACT_LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={ds.label}>Recurrence</label>
                    <select
                      className={ds.select}
                      value={formRecurrence}
                      onChange={(e) => setFormRecurrence(e.target.value)}
                    >
                      {RECURRENCE_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}

            {activeArtifactType === 'Simulation' && (
              <>
                <div>
                  <label className={ds.label}>Scenario</label>
                  <textarea
                    className={ds.textarea}
                    rows={3}
                    value={formScenario}
                    onChange={(e) => setFormScenario(e.target.value)}
                    placeholder="Describe the scenario to simulate..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={ds.label}>Timespan</label>
                    <select
                      className={ds.select}
                      value={formTimespan}
                      onChange={(e) => setFormTimespan(e.target.value)}
                    >
                      {TIMESPAN_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={ds.label}>Confidence</label>
                    <input
                      type="number"
                      step="0.01"
                      className={ds.input}
                      value={formConfidence}
                      onChange={(e) => setFormConfidence(e.target.value)}
                      placeholder="0.0 - 1.0"
                    />
                  </div>
                </div>
                <div>
                  <label className={ds.label}>Result</label>
                  <textarea
                    className={ds.textarea}
                    rows={2}
                    value={formResult}
                    onChange={(e) => setFormResult(e.target.value)}
                  />
                </div>
              </>
            )}

            {activeArtifactType === 'Timeline' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={ds.label}>Branch Name</label>
                    <input
                      className={ds.input}
                      value={formBranch}
                      onChange={(e) => setFormBranch(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Divergence Point</label>
                    <input
                      type="date"
                      className={ds.input}
                      value={formDivergencePoint}
                      onChange={(e) => setFormDivergencePoint(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={ds.label}>Start</label>
                    <input
                      type="date"
                      className={ds.input}
                      value={formStartDate}
                      onChange={(e) => setFormStartDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>End</label>
                    <input
                      type="date"
                      className={ds.input}
                      value={formEndDate}
                      onChange={(e) => setFormEndDate(e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}

            {activeArtifactType === 'Pattern' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={ds.label}>Frequency</label>
                    <input
                      className={ds.input}
                      value={formFrequency}
                      onChange={(e) => setFormFrequency(e.target.value)}
                      placeholder="e.g. every 3 days"
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Confidence</label>
                    <input
                      type="number"
                      step="0.01"
                      className={ds.input}
                      value={formConfidence}
                      onChange={(e) => setFormConfidence(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={ds.label}>Last Seen</label>
                    <input
                      type="date"
                      className={ds.input}
                      value={formLastOccurrence}
                      onChange={(e) => setFormLastOccurrence(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Next Predicted</label>
                    <input
                      type="date"
                      className={ds.input}
                      value={formNextPredicted}
                      onChange={(e) => setFormNextPredicted(e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}

            {activeArtifactType === 'Snapshot' && (
              <>
                <div>
                  <label className={ds.label}>Snapshot Date</label>
                  <input
                    type="date"
                    className={ds.input}
                    value={formStartDate}
                    onChange={(e) => setFormStartDate(e.target.value)}
                  />
                </div>
              </>
            )}

            <div>
              <label className={ds.label}>Notes</label>
              <textarea
                className={ds.textarea}
                rows={2}
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setEditorOpen(false)} className={ds.btnSecondary}>
              Cancel
            </button>
            <button onClick={handleSave} className={ds.btnPrimary} disabled={!formName.trim()}>
              Save
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderLibrary = () => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            className={cn(ds.input, 'pl-10')}
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <select
          className={cn(ds.select, 'w-auto')}
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="all">All Status</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <button onClick={openCreate} className={ds.btnPrimary}>
          <Plus className="w-4 h-4" /> New
        </button>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className={cn(ds.panel, 'text-center py-12')}>
          <Clock className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className={ds.textMuted}>
            No {activeArtifactType.replace(/([A-Z])/g, ' $1').trim()} items yet
          </p>
          <button onClick={openCreate} className={cn(ds.btnPrimary, 'mt-3')}>
            <Plus className="w-4 h-4" /> Create First
          </button>
        </div>
      ) : (
        filtered.map((item, index) => {
          const d = item.data as unknown as TemporalArtifact;
          const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.active;
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className={ds.panelHover}
              onClick={() => openEdit(item)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5 text-neon-cyan" />
                  <div>
                    <p className="text-white font-medium">{d.name || item.title}</p>
                    <p className={ds.textMuted}>
                      {d.startDate && d.endDate && (
                        <span>
                          {d.startDate} &rarr; {d.endDate}{' '}
                        </span>
                      )}
                      {d.eventDate && <span>{d.eventDate} </span>}
                      {d.eventType && <span>&middot; {d.eventType} </span>}
                      {d.impact && <span>({d.impact}) </span>}
                      {d.branch && <span>Branch: {d.branch} </span>}
                      {d.frequency && <span>&middot; {d.frequency} </span>}
                      {d.scenario && <span>{d.scenario.slice(0, 60)}... </span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {d.confidence !== undefined && (
                    <span className="text-xs text-neon-green">
                      {(d.confidence * 100).toFixed(0)}%
                    </span>
                  )}
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full bg-${sc.color}/20 text-${sc.color}`}
                  >
                    {sc.label}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAction('simulate', item.id);
                    }}
                    className={ds.btnGhost}
                  >
                    <Zap className="w-4 h-4 text-neon-cyan" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(item.id);
                    }}
                    className={ds.btnGhost}
                  >
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })
      )}
    </div>
  );

  return (
    <LensPageShell
      domain="temporal"
      title="Temporal"
      description="Time frames, events, simulations, timelines, patterns, and snapshots"
      headerIcon={<Clock className="w-5 h-5 text-white" />}
      isLoading={isLoading}
      isError={isError}
      error={error}
      onRetry={refetch}
      actions={
        <>
          {runAction.isPending && (
            <span className="text-xs text-neon-cyan animate-pulse">AI processing...</span>
          )}
          <button
            onClick={() => setShowDashboard(!showDashboard)}
            className={cn(showDashboard ? ds.btnPrimary : ds.btnSecondary)}
          >
            <BarChart3 className="w-4 h-4" /> Dashboard
          </button>
        </>
      }
    >
      <UniversalActions domain="temporal" artifactId={items[0]?.id} compact />

      {(() => {
        const all = items.map((i) => i.data as unknown as TemporalArtifact);
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className={ds.panel}>
              <Timer className="w-5 h-5 text-neon-cyan mb-2" />
              <p className={ds.textMuted}>Total Items</p>
              <p className="text-xl font-bold text-white">{items.length}</p>
            </div>
            <div className={ds.panel}>
              <GitBranch className="w-5 h-5 text-neon-blue mb-2" />
              <p className={ds.textMuted}>Timelines</p>
              <p className="text-xl font-bold text-white">{all.filter((a) => a.branch).length}</p>
            </div>
            <div className={ds.panel}>
              <ScanLine className="w-5 h-5 text-neon-purple mb-2" />
              <p className={ds.textMuted}>Patterns</p>
              <p className="text-xl font-bold text-white">
                {all.filter((a) => a.frequency).length}
              </p>
            </div>
            <div className={ds.panel}>
              <Play className="w-5 h-5 text-neon-green mb-2" />
              <p className={ds.textMuted}>Running</p>
              <p className="text-xl font-bold text-white">
                {all.filter((a) => a.status === 'running').length}
              </p>
            </div>
          </div>
        );
      })()}

      <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">
        {MODE_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setShowDashboard(false);
            }}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap',
              activeTab === tab.id && !showDashboard
                ? 'bg-neon-cyan/20 text-neon-cyan'
                : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </nav>
      {showDashboard ? renderDashboard() : renderLibrary()}
      {renderEditor()}
    </LensPageShell>
  );
}
