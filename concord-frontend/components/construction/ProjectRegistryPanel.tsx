'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { StickyDeleteConfirm } from '@/components/common/StickyDeleteConfirm';
import { cn } from '@/lib/utils';
import {
  HardHat,
  DollarSign,
  Plus,
  Search,
  X,
  Trash2,
  AlertTriangle,
  Building2,
  Map,
  Percent,
  Hammer,
  Zap,
  ClipboardList,
} from 'lucide-react';
import {
  MODE_TABS,
  STATUS_CONFIG,
  PROJECT_TYPES,
  INSPECTION_TYPES,
  TRADES,
  type ArtifactType,
  type ConstructionArtifact,
  type RegistryMode,
  type Status,
} from './construction-types';
import { activateOnEnterOrSpace } from '@/lib/a11y/editable-target';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });

function modeToArtifact(mode: RegistryMode): ArtifactType {
  if (mode === 'dashboard' || mode === 'map') return 'Job';
  return MODE_TABS.find((t) => t.id === mode)?.artifactType || 'Job';
}

/**
 * Project registry — jobs/estimates/materials/inspections/safety/crew/documents/map/dashboard.
 * Extracted from construction page.tsx (useLensData + analyze via useRunArtifact).
 */
export function ProjectRegistryPanel({ mode }: { mode: RegistryMode }) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  useLensCommand(
    [
      {
        id: 'focus-search',
        keys: '/',
        description: 'Focus search',
        category: 'navigation',
        action: () => searchInputRef.current?.focus(),
      },
    ],
    { lensId: 'construction' },
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<ConstructionArtifact> | null>(null);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStatus, setFormStatus] = useState<Status>('planned');
  const [formNotes, setFormNotes] = useState('');
  const [formClient, setFormClient] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formContractValue, setFormContractValue] = useState('');
  const [formProjectType, setFormProjectType] = useState('Residential New');
  const [formLaborCost, setFormLaborCost] = useState('');
  const [formMaterialCost, setFormMaterialCost] = useState('');
  const [formQuantity, setFormQuantity] = useState('');
  const [formUnit, setFormUnit] = useState('cy');
  const [formUnitCost, setFormUnitCost] = useState('');
  const [formWastePercent, setFormWastePercent] = useState('10');
  const [formTrade, setFormTrade] = useState('General');
  const [formInspectionType, setFormInspectionType] = useState('Foundation');
  const [formForeman, setFormForeman] = useState('');
  const [formCrewSize, setFormCrewSize] = useState('');
  const [jobNotice, setJobNotice] = useState<{ itemId: string; title: string } | null>(null);
  const [jobError, setJobError] = useState('');

  const activeArtifactType = modeToArtifact(mode);
  const { items, isLoading, isError, error, refetch, create, update, remove } =
    useLensData<ConstructionArtifact>('construction', activeArtifactType, { seed: [] });
  const runAction = useRunArtifact('construction');

  const filtered = useMemo(() => {
    let result = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.data as unknown as ConstructionArtifact).description?.toLowerCase().includes(q),
      );
    }
    if (filterStatus !== 'all')
      result = result.filter(
        (i) => (i.data as unknown as ConstructionArtifact).status === filterStatus,
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
    [filtered, runAction],
  );

  // F6: the job card's Activate control performs the activation — a
  // planned job moves to in_progress through the same update path the
  // Edit modal uses (data.status and meta.status written together). It
  // previously ran the generic 'analyze' action, which showed
  // "AI processing…" and never touched the job's status.
  const activateJob = useCallback(
    async (item: LensItem<ConstructionArtifact>) => {
      const d = item.data as unknown as ConstructionArtifact;
      if (d.status !== 'planned') return;
      try {
        await update(item.id, {
          title: item.title,
          data: { ...(d as unknown as Record<string, unknown>), status: 'in_progress' },
          meta: { tags: [], status: 'in_progress', visibility: 'private' },
        });
        // The quick action says what it did, with a way back — a status
        // change is never silent.
        setJobError('');
        setJobNotice({ itemId: item.id, title: item.title || d.name || 'Job' });
      } catch {
        setJobNotice(null);
        setJobError('Couldn\'t start that job — try again.');
      }
    },
    [update],
  );

  const undoStartJob = useCallback(async () => {
    if (!jobNotice) return;
    const item = items.find((i) => i.id === jobNotice.itemId);
    setJobNotice(null);
    if (!item) return;
    const d = item.data as unknown as ConstructionArtifact;
    try {
      await update(item.id, {
        title: item.title,
        data: { ...(d as unknown as Record<string, unknown>), status: 'planned' },
        meta: { tags: [], status: 'planned', visibility: 'private' },
      });
    } catch {
      setJobError('Couldn\'t undo the start — the job is still In Progress.');
    }
  }, [jobNotice, items, update]);

  const openCreate = () => {
    setEditingItem(null);
    setFormName('');
    setFormDescription('');
    setFormStatus('planned');
    setFormNotes('');
    setFormClient('');
    setFormAddress('');
    setFormStartDate('');
    setFormEndDate('');
    setFormContractValue('');
    setFormProjectType('Residential New');
    setFormLaborCost('');
    setFormMaterialCost('');
    setFormQuantity('');
    setFormUnit('cy');
    setFormUnitCost('');
    setFormWastePercent('10');
    setFormTrade('General');
    setFormInspectionType('Foundation');
    setFormForeman('');
    setFormCrewSize('');
    setEditorOpen(true);
  };

  const openEdit = (item: LensItem<ConstructionArtifact>) => {
    const d = item.data as unknown as ConstructionArtifact;
    setEditingItem(item);
    setFormName(d.name || '');
    setFormDescription(d.description || '');
    setFormStatus(d.status || 'planned');
    setFormNotes(d.notes || '');
    setFormClient(d.client || '');
    setFormAddress(d.address || '');
    setFormStartDate(d.startDate || '');
    setFormEndDate(d.endDate || '');
    setFormContractValue(d.contractValue?.toString() || '');
    setFormProjectType(d.projectType || 'Residential New');
    setFormLaborCost(d.laborCost?.toString() || '');
    setFormMaterialCost(d.materialCost?.toString() || '');
    setFormQuantity((d as { quantity?: number }).quantity?.toString() || '');
    setFormUnit((d as { unit?: string }).unit || 'cy');
    setFormUnitCost((d as { unitCost?: number }).unitCost?.toString() || '');
    setFormWastePercent((d as { wastePercent?: number }).wastePercent?.toString() || '10');
    setFormTrade(d.trade || 'General');
    setFormInspectionType(d.inspectionType || 'Foundation');
    setFormForeman(d.foreman || '');
    setFormCrewSize(d.crewSize?.toString() || '');
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const data: Record<string, unknown> = {
      name: formName,
      type: activeArtifactType,
      status: formStatus,
      description: formDescription,
      notes: formNotes,
      client: formClient,
      address: formAddress,
      startDate: formStartDate,
      endDate: formEndDate,
      contractValue: formContractValue ? parseFloat(formContractValue) : undefined,
      projectType: formProjectType,
      laborCost: formLaborCost ? parseFloat(formLaborCost) : undefined,
      materialCost: formMaterialCost ? parseFloat(formMaterialCost) : undefined,
      trade: formTrade,
      inspectionType: formInspectionType,
      foreman: formForeman,
      crewSize: formCrewSize ? parseInt(formCrewSize) : undefined,
    };
    if (activeArtifactType === 'Estimate') {
      // F8: an estimate carries the takeoff's own line fields, and its
      // total is computed with the takeoff's arithmetic — quantity ×
      // unit cost, waste shown as its own percent — so the Estimates tab
      // and the takeoff bench speak the same numbers.
      const qty = formQuantity ? parseFloat(formQuantity) : undefined;
      const unitCost = formUnitCost ? parseFloat(formUnitCost) : undefined;
      const waste = formWastePercent ? parseFloat(formWastePercent) : 10;
      data.quantity = qty;
      data.unit = formUnit;
      data.unitCost = unitCost;
      data.wastePercent = waste;
      data.lineTotal = qty != null && unitCost != null
        ? Math.round(qty * (1 + waste / 100) * unitCost * 100) / 100
        : undefined;
    }
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
    const all = items.map((i) => i.data as unknown as ConstructionArtifact);
    const totalContract = all.reduce((s, j) => s + (j.contractValue || 0), 0);
    return (
      <div data-lens-theme="construction" className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={ds.panel}>
          <Building2 className="w-5 h-5 text-blue-400 mb-2" />
          <p className={ds.textMuted}>Active Jobs</p>
          <p className="text-xl font-bold text-white">
            {all.filter((j) => j.status === 'in_progress').length}
          </p>
        </div>
        <div className={ds.panel}>
          <DollarSign className="w-5 h-5 text-green-400 mb-2" />
          <p className={ds.textMuted}>Contract Value</p>
          <p className="text-xl font-bold text-white">${totalContract.toLocaleString()}</p>
        </div>
        <div className={ds.panel}>
          <ClipboardList className="w-5 h-5 text-yellow-400 mb-2" />
          <p className={ds.textMuted}>Pending Inspections</p>
          <p className="text-xl font-bold text-white">
            {all.filter((j) => j.status === 'inspection').length}
          </p>
        </div>
        <div className={ds.panel}>
          <AlertTriangle className="w-5 h-5 text-red-400 mb-2" />
          <p className={ds.textMuted}>Safety Issues</p>
          <p className="text-xl font-bold text-white">
            {all.filter((j) => j.status === 'on_hold').length}
          </p>
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
        role="button"
        tabIndex={0}
        onKeyDown={activateOnEnterOrSpace}
      >
        <div
          className={cn(ds.panel, 'w-full max-w-lg max-h-[85vh] overflow-y-auto')}
          onClick={(e) => e.stopPropagation()}
          role="button"
          tabIndex={0}
          onKeyDown={activateOnEnterOrSpace}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className={ds.heading3}>
              {editingItem ? 'Edit' : 'New'} {activeArtifactType}
            </h3>
            <button onClick={() => setEditorOpen(false)} className={ds.btnGhost} aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <label className={ds.label}>Name</label>
              <input className={ds.input} value={formName} onChange={(e) => setFormName(e.target.value)} />
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
            {activeArtifactType === 'Job' && (
              <>
                <div>
                  <label className={ds.label}>Client</label>
                  <input className={ds.input} value={formClient} onChange={(e) => setFormClient(e.target.value)} />
                </div>
                <div>
                  <label className={ds.label}>Address</label>
                  <input className={ds.input} value={formAddress} onChange={(e) => setFormAddress(e.target.value)} />
                </div>
                <div>
                  <label className={ds.label}>Project Type</label>
                  <select
                    className={ds.select}
                    value={formProjectType}
                    onChange={(e) => setFormProjectType(e.target.value)}
                  >
                    {PROJECT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={ds.label}>Contract Value</label>
                  <input
                    type="number"
                    className={ds.input}
                    value={formContractValue}
                    onChange={(e) => setFormContractValue(e.target.value)}
                  />
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
            {activeArtifactType === 'Estimate' && (
              <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={ds.label}>Labor Cost</label>
                  <input
                    type="number"
                    className={ds.input}
                    value={formLaborCost}
                    onChange={(e) => setFormLaborCost(e.target.value)}
                  />
                </div>
                <div>
                  <label className={ds.label}>Material Cost</label>
                  <input
                    type="number"
                    className={ds.input}
                    value={formMaterialCost}
                    onChange={(e) => setFormMaterialCost(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className={ds.label}>Quantity</label>
                  <input
                    type="number"
                    step="0.01"
                    className={ds.input}
                    value={formQuantity}
                    onChange={(e) => setFormQuantity(e.target.value)}
                  />
                </div>
                <div>
                  <label className={ds.label}>Unit</label>
                  <select className={ds.select} value={formUnit} onChange={(e) => setFormUnit(e.target.value)}>
                    {['each', 'lf', 'sf', 'cy', 'lb', 'bag'].map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={ds.label}>Unit Cost</label>
                  <input
                    type="number"
                    step="0.01"
                    className={ds.input}
                    value={formUnitCost}
                    onChange={(e) => setFormUnitCost(e.target.value)}
                  />
                </div>
                <div>
                  <label className={ds.label}>Waste %</label>
                  <input
                    type="number"
                    className={ds.input}
                    value={formWastePercent}
                    onChange={(e) => setFormWastePercent(e.target.value)}
                  />
                </div>
              </div>
              {formQuantity && formUnitCost && (
                <p className="text-xs text-gray-400">
                  Line total (quantity × unit cost, waste shown): $
                  {(Math.round(parseFloat(formQuantity) * (1 + (parseFloat(formWastePercent) || 0) / 100) * parseFloat(formUnitCost) * 100) / 100).toLocaleString()}
                </p>
              )}
              </>
            )}
            {activeArtifactType === 'Inspection' && (
              <div>
                <label className={ds.label}>Inspection Type</label>
                <select
                  className={ds.select}
                  value={formInspectionType}
                  onChange={(e) => setFormInspectionType(e.target.value)}
                >
                  {INSPECTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {activeArtifactType === 'CrewAssignment' && (
              <>
                <div>
                  <label className={ds.label}>Trade</label>
                  <select className={ds.select} value={formTrade} onChange={(e) => setFormTrade(e.target.value)}>
                    {TRADES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={ds.label}>Foreman</label>
                  <input className={ds.input} value={formForeman} onChange={(e) => setFormForeman(e.target.value)} />
                </div>
                <div>
                  <label className={ds.label}>Crew Size</label>
                  <input
                    type="number"
                    className={ds.input}
                    value={formCrewSize}
                    onChange={(e) => setFormCrewSize(e.target.value)}
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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            ref={searchInputRef}
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
        <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
          <div className="w-6 h-6 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
          <span className="sr-only">Loading construction data…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className={cn(ds.panel, 'text-center py-12')}>
          <HardHat className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className={ds.textMuted}>No {activeArtifactType.replace(/([a-z])([A-Z])/g, '$1 $2')} items yet</p>
          <button onClick={openCreate} className={cn(ds.btnPrimary, 'mt-3')}>
            <Plus className="w-4 h-4" /> Create First
          </button>
        </div>
      ) : (
        filtered.map((item, index) => {
          const d = item.data as unknown as ConstructionArtifact;
          const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.planned;
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
                  <HardHat className="w-5 h-5 text-neon-cyan" />
                  <div>
                    <p className="text-white font-medium">{item.title || d.name || 'Untitled'}</p>
                    <p className={ds.textMuted}>
                      {[d.client, d.address, d.trade && d.trade !== 'General' ? d.trade : ''].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {d.contractValue && (
                    <span className="text-xs text-green-400">${d.contractValue.toLocaleString()}</span>
                  )}
                  {activeArtifactType === 'Estimate' && (d as { lineTotal?: number }).lineTotal != null && (
                    <span className="text-xs text-green-400">${(d as { lineTotal?: number }).lineTotal!.toLocaleString()}</span>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full bg-${sc.color}/20 text-${sc.color}`}>
                    {sc.label}
                  </span>
                  {activeArtifactType === 'Job' && d.status === 'planned' ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void activateJob(item);
                      }}
                      className={ds.btnGhost}
                      aria-label="Start job"
                      title="Start job"
                    >
                      <Zap className="w-4 h-4 text-neon-cyan" />
                      <span className="text-xs">Start job</span>
                    </button>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAction('analyze', item.id);
                      }}
                      className={ds.btnGhost}
                      aria-label="Analyze"
                    >
                      <Zap className="w-4 h-4 text-neon-cyan" />
                    </button>
                  )}
                  <span onClick={(e) => e.stopPropagation()}>
                    <StickyDeleteConfirm onConfirm={() => remove(item.id)} armLabel={<Trash2 className="w-4 h-4 text-red-400" />} className={ds.btnGhost} />
                  </span>
                </div>
              </div>
            </motion.div>
          );
        })
      )}
    </div>
  );

  if (isError) {
    return (
      <div role="alert" className={cn(ds.panel, 'mx-auto mt-6 max-w-md border-red-500/40 text-center')}>
        <X className="w-10 h-10 text-red-400 mx-auto mb-3" />
        <p className="text-red-300 font-medium">Couldn&apos;t load construction data</p>
        {error?.message && <p className="mt-1 text-xs text-red-400/80">{error.message}</p>}
        <button onClick={() => refetch()} className={cn(ds.btnPrimary, 'mt-4')}>
          Retry
        </button>
      </div>
    );
  }

  const allJobs = items.map((i) => i.data as unknown as ConstructionArtifact);
  const activeCount = allJobs.filter((j) => j.status === 'in_progress').length;
  const budgetTotal = allJobs.reduce((s, j) => s + (j.contractValue || 0), 0);
  const completedCount = allJobs.filter((j) => j.status === 'completed').length;
  const completionRate =
    allJobs.length > 0 ? ((completedCount / allJobs.length) * 100).toFixed(0) : '0';
  // F8: in Estimates mode the header figures are computed from the
  // estimate items' OWN costs (line total where the takeoff fields are
  // filled, else labor + material) — they previously summed contractValue,
  // a field estimate items never carry, so the headers never moved.
  const isEstimates = mode === 'estimates';
  const estimateTotal = allJobs.reduce((s, j) => {
    const e = j as unknown as { lineTotal?: number; laborCost?: number; materialCost?: number };
    return s + (e.lineTotal ?? ((e.laborCost || 0) + (e.materialCost || 0)));
  }, 0);
  const estimateAvg = allJobs.length > 0 ? estimateTotal / allJobs.length : 0;

  return (
    <div className="space-y-4">
      {runAction.isPending && (
        <span className="text-xs text-neon-cyan animate-pulse">AI processing...</span>
      )}
      {jobNotice && (
        <div role="status" className="flex items-center justify-between gap-3 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          <span>&lsquo;{jobNotice.title}&rsquo; started — status is now In Progress.</span>
          <button type="button" onClick={() => void undoStartJob()} className="shrink-0 rounded border border-emerald-400/40 px-2 py-0.5 text-emerald-100 hover:bg-emerald-500/20">
            Undo
          </button>
        </div>
      )}
      {jobError && (
        <div role="alert" className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {jobError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-3 bg-lattice-elevated rounded-lg border border-lattice-border flex items-center gap-3">
          <Hammer className="w-5 h-5 text-orange-400" />
          <div>
            <p className="text-lg font-bold text-white">{isEstimates ? allJobs.length : activeCount}</p>
            <p className="text-xs text-gray-400">{isEstimates ? 'Estimates' : 'Active Projects'}</p>
          </div>
        </div>
        <div className="p-3 bg-lattice-elevated rounded-lg border border-lattice-border flex items-center gap-3">
          <DollarSign className="w-5 h-5 text-green-400" />
          <div>
            <p className="text-lg font-bold text-white">${(isEstimates ? estimateTotal : budgetTotal).toLocaleString()}</p>
            <p className="text-xs text-gray-400">{isEstimates ? 'Total Estimated' : 'Budget Total'}</p>
          </div>
        </div>
        <div className="p-3 bg-lattice-elevated rounded-lg border border-lattice-border flex items-center gap-3">
          <Percent className="w-5 h-5 text-cyan-400" />
          <div>
            <p className="text-lg font-bold text-white">{isEstimates ? `$${Math.round(estimateAvg).toLocaleString()}` : `${completionRate}%`}</p>
            <p className="text-xs text-gray-400">{isEstimates ? 'Average Estimate' : 'Completion Rate'}</p>
          </div>
        </div>
      </div>

      {mode === 'map' ? (
        <div className={cn(ds.panel, 'p-4')}>
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Map className="w-4 h-4 text-neon-cyan" /> Job Site Locations
          </h3>
          <MapView
            markers={items
              .filter((i) => {
                const d = i.data as unknown as ConstructionArtifact;
                return d.lat && d.lng;
              })
              .map((i) => {
                const d = i.data as unknown as ConstructionArtifact;
                return {
                  lat: d.lat!,
                  lng: d.lng!,
                  label: d.name || i.title,
                  popup: `${d.address || ''} - ${d.status || ''}`,
                };
              })}
            className="h-[500px]"
          />
        </div>
      ) : mode === 'dashboard' ? (
        renderDashboard()
      ) : (
        renderLibrary()
      )}
      {renderEditor()}
    </div>
  );
}
