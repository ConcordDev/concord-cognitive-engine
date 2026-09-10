'use client';

/**
 * ElectricalDeskPanel — Jobs / NEC notes / CRM / Certs CRUD + dashboard.
 * Extracted from electrical/page.tsx consolidation. Trade tools live as
 * sibling panels mounted by the thin page shell.
 */

import { useState, useMemo, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  Zap, Wrench, ClipboardList, DollarSign, Users, Plus, Search, X, Trash2,
  BarChart3, CheckCircle2, FileText, Award, ShieldCheck, Bolt, Receipt,
} from 'lucide-react';
import { Icon as SvgIcon } from '@/components/icons/Icon';
import { ErrorState } from '@/components/common/EmptyState';
import {
  type ArtifactType, type Status, type TradeArtifact,
  STATUS_CONFIG, ELECTRICAL_CERTS, ARTIFACT_TABS,
} from '@/components/electrical/electrical-shared';

const MODE_TABS = ARTIFACT_TABS.map((t) => ({
  ...t,
  icon: t.id === 'jobs' ? Wrench : t.id === 'codes' ? FileText : t.id === 'clients' ? Users : Award,
}));

export function ElectricalDeskPanel({ mode }: { mode: 'dashboard' | 'jobs' | 'codes' | 'clients' | 'certs' }) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<TradeArtifact> | null>(null);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStatus, setFormStatus] = useState<Status>('scheduled');
  const [formNotes, setFormNotes] = useState('');
  const [formClient, setFormClient] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formScheduledDate, setFormScheduledDate] = useState('');
  const [formLaborHours, setFormLaborHours] = useState('');
  const [formLaborRate, setFormLaborRate] = useState('');
  const [formMaterialCost, setFormMaterialCost] = useState('');
  const [formCertType, setFormCertType] = useState('Master Electrician');
  const [formCertNumber, setFormCertNumber] = useState('');
  const [formExpiryDate, setFormExpiryDate] = useState('');
  const [formIssuedBy, setFormIssuedBy] = useState('');
  const [formCodeReference, setFormCodeReference] = useState('');
  const [formCodeSection, setFormCodeSection] = useState('');
  const [formJurisdiction, setFormJurisdiction] = useState('');

  const activeArtifactType = MODE_TABS.find((t) => t.id === (mode === 'dashboard' ? 'jobs' : mode))?.artifactType || 'Job';
  const { items, isLoading, isError, error, refetch, create, update, remove } =
    useLensData<TradeArtifact>('electrical', activeArtifactType, { seed: [] });
  const runAction = useRunArtifact('electrical');

  const filtered = useMemo(() => {
    let result = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.data as unknown as TradeArtifact).description?.toLowerCase().includes(q)
      );
    }
    if (filterStatus !== 'all')
      result = result.filter((i) => (i.data as unknown as TradeArtifact).status === filterStatus);
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

  const openCreate = () => {
    setEditingItem(null);
    setFormName('');
    setFormDescription('');
    setFormStatus('scheduled');
    setFormNotes('');
    setFormClient('');
    setFormAddress('');
    setFormPhone('');
    setFormEmail('');
    setFormScheduledDate('');
    setFormLaborHours('');
    setFormLaborRate('');
    setFormMaterialCost('');
    setFormCertType('Master Electrician');
    setFormCertNumber('');
    setFormExpiryDate('');
    setFormIssuedBy('');
    setFormCodeReference('');
    setFormCodeSection('');
    setFormJurisdiction('');
    setEditorOpen(true);
  };
  const openEdit = (item: LensItem<TradeArtifact>) => {
    const d = item.data as unknown as TradeArtifact;
    setEditingItem(item);
    setFormName(d.name || '');
    setFormDescription(d.description || '');
    setFormStatus(d.status || 'scheduled');
    setFormNotes(d.notes || '');
    setFormClient(d.client || '');
    setFormAddress(d.address || '');
    setFormPhone(d.phone || '');
    setFormEmail(d.email || '');
    setFormScheduledDate(d.scheduledDate || '');
    setFormLaborHours(d.laborHours?.toString() || '');
    setFormLaborRate(d.laborRate?.toString() || '');
    setFormMaterialCost(d.materialCost?.toString() || '');
    setFormCertType(d.certType || 'Master Electrician');
    setFormCertNumber(d.certNumber || '');
    setFormExpiryDate(d.expiryDate || '');
    setFormIssuedBy(d.issuedBy || '');
    setFormCodeReference(d.codeReference || '');
    setFormCodeSection(d.codeSection || '');
    setFormJurisdiction(d.jurisdiction || '');
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const laborH = formLaborHours ? parseFloat(formLaborHours) : undefined;
    const laborR = formLaborRate ? parseFloat(formLaborRate) : undefined;
    const matC = formMaterialCost ? parseFloat(formMaterialCost) : undefined;
    const data: Record<string, unknown> = {
      name: formName,
      type: activeArtifactType,
      status: formStatus,
      description: formDescription,
      notes: formNotes,
      client: formClient,
      address: formAddress,
      phone: formPhone,
      email: formEmail,
      scheduledDate: formScheduledDate,
      laborHours: laborH,
      laborRate: laborR,
      materialCost: matC,
      totalCost: (laborH && laborR ? laborH * laborR : 0) + (matC || 0) || undefined,
      certType: formCertType,
      certNumber: formCertNumber,
      expiryDate: formExpiryDate,
      issuedBy: formIssuedBy,
      codeReference: formCodeReference,
      codeSection: formCodeSection,
      jurisdiction: formJurisdiction,
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
    const all = items.map((i) => i.data as unknown as TradeArtifact);
    const totalRevenue = all.reduce((s, j) => s + (j.totalCost || 0), 0);
    return (
      <div data-lens-theme="electrical" className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={ds.panel}>
          <Wrench className="w-5 h-5 text-blue-400 mb-2" />
          <p className={ds.textMuted}>Active Jobs</p>
          <p className="text-xl font-bold text-white">
            {all.filter((j) => j.status === 'in_progress' || j.status === 'scheduled').length}
          </p>
        </div>
        <div className={ds.panel}>
          <DollarSign className="w-5 h-5 text-green-400 mb-2" />
          <p className={ds.textMuted}>Revenue</p>
          <p className="text-xl font-bold text-white">${totalRevenue.toLocaleString()}</p>
        </div>
        <div className={ds.panel}>
          <CheckCircle2 className="w-5 h-5 text-emerald-400 mb-2" />
          <p className={ds.textMuted}>Completed</p>
          <p className="text-xl font-bold text-white">
            {all.filter((j) => j.status === 'completed' || j.status === 'paid').length}
          </p>
        </div>
        <div className={ds.panel}>
          <Receipt className="w-5 h-5 text-purple-400 mb-2" />
          <p className={ds.textMuted}>Outstanding</p>
          <p className="text-xl font-bold text-white">
            {all.filter((j) => j.status === 'invoiced').length}
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
        onClick={() => setEditorOpen(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        <div
          className={cn(ds.panel, 'w-full max-w-lg max-h-[85vh] overflow-y-auto')}
          onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
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
            {(activeArtifactType === 'Job' || activeArtifactType === 'Client') && (
              <>
                <div>
                  <label className={ds.label}>Client</label>
                  <input
                    className={ds.input}
                    value={formClient}
                    onChange={(e) => setFormClient(e.target.value)}
                  />
                </div>
                <div>
                  <label className={ds.label}>Address</label>
                  <input
                    className={ds.input}
                    value={formAddress}
                    onChange={(e) => setFormAddress(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={ds.label}>Phone</label>
                    <input
                      className={ds.input}
                      value={formPhone}
                      onChange={(e) => setFormPhone(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Email</label>
                    <input
                      type="email"
                      className={ds.input}
                      value={formEmail}
                      onChange={(e) => setFormEmail(e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}
            {activeArtifactType === 'Job' && (
              <>
                <div>
                  <label className={ds.label}>Scheduled Date</label>
                  <input
                    type="date"
                    className={ds.input}
                    value={formScheduledDate}
                    onChange={(e) => setFormScheduledDate(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={ds.label}>Labor Hours</label>
                    <input
                      type="number"
                      className={ds.input}
                      value={formLaborHours}
                      onChange={(e) => setFormLaborHours(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Labor Rate</label>
                    <input
                      type="number"
                      className={ds.input}
                      value={formLaborRate}
                      onChange={(e) => setFormLaborRate(e.target.value)}
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
                <p className={cn(ds.textMuted, 'text-[10px]')}>
                  For a real line-itemized bid with materials pulled from your price list, use the
                  Estimate&rarr;Invoice trade tool below instead of a flat labor/material total here.
                </p>
              </>
            )}
            {activeArtifactType === 'CodeRef' && (
              <>
                <div>
                  <label className={ds.label}>NEC Code Section</label>
                  <input
                    className={ds.input}
                    placeholder="e.g. 210.8(A)"
                    value={formCodeReference}
                    onChange={(e) => setFormCodeReference(e.target.value)}
                  />
                </div>
                <div>
                  <label className={ds.label}>Article / Chapter</label>
                  <input
                    className={ds.input}
                    placeholder="e.g. Article 210 — Branch Circuits"
                    value={formCodeSection}
                    onChange={(e) => setFormCodeSection(e.target.value)}
                  />
                </div>
                <div>
                  <label className={ds.label}>Jurisdiction (AHJ)</label>
                  <input
                    className={ds.input}
                    placeholder="e.g. City of Austin — 2023 NEC w/ local amendments"
                    value={formJurisdiction}
                    onChange={(e) => setFormJurisdiction(e.target.value)}
                  />
                </div>
              </>
            )}
            {activeArtifactType === 'Certification' && (
              <>
                <div>
                  <label className={ds.label}>Certification</label>
                  <select
                    className={ds.select}
                    value={formCertType}
                    onChange={(e) => setFormCertType(e.target.value)}
                  >
                    {ELECTRICAL_CERTS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={ds.label}>License / Cert Number</label>
                    <input
                      className={ds.input}
                      value={formCertNumber}
                      onChange={(e) => setFormCertNumber(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Expiry Date</label>
                    <input
                      type="date"
                      className={ds.input}
                      value={formExpiryDate}
                      onChange={(e) => setFormExpiryDate(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className={ds.label}>Issued By</label>
                  <input
                    className={ds.input}
                    placeholder="e.g. State Board of Electrical Examiners"
                    value={formIssuedBy}
                    onChange={(e) => setFormIssuedBy(e.target.value)}
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
          <option value="all">All</option>
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
          <div className="w-6 h-6 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className={cn(ds.panel, 'text-center py-12')}>
          <SvgIcon name="circuit-panel" size={48} className="text-gray-600 mx-auto mb-3" />
          <p className={ds.textMuted}>No {activeArtifactType} items yet</p>
          <button onClick={openCreate} className={cn(ds.btnPrimary, 'mt-3')}>
            <Plus className="w-4 h-4" /> Create First
          </button>
        </div>
      ) : (
        filtered.map((item, index) => {
          const d = item.data as unknown as TradeArtifact;
          const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.pending;
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
                  <Zap className="w-5 h-5 text-yellow-400" />
                  <div>
                    <p className="text-white font-medium">{d.name || item.title}</p>
                    <p className={ds.textMuted}>
                      {d.client || ''} {d.address ? `- ${d.address}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!!d.totalCost && (
                    <span className="text-xs text-green-400">
                      ${d.totalCost.toLocaleString()}
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
                      handleAction('analyze', item.id);
                    }}
                    className={ds.btnGhost}
                  aria-label="Activate">
                    <Zap className="w-4 h-4 text-neon-cyan" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(item.id);
                    }}
                    className={ds.btnGhost}
                  aria-label="Delete">
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

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={(error as Error)?.message} onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {(() => {
        const allItems = items.map((i) => i.data as unknown as TradeArtifact);
        const activeJobs = allItems.filter(
          (j) => j.status === 'in_progress' || j.status === 'scheduled'
        ).length;
        const certifiedCount = allItems.filter(
          (j) => j.type === 'Certification' && j.status === 'active'
        ).length;
        const completedCount = allItems.filter(
          (j) => j.status === 'completed' || j.status === 'paid'
        ).length;
        const safetyScore =
          allItems.length > 0 ? ((completedCount / allItems.length) * 100).toFixed(0) : '100';
        return (
          <div className="grid grid-cols-3 gap-4">
            <div className="p-3 bg-lattice-elevated rounded-lg border border-lattice-border flex items-center gap-3">
              <Bolt className="w-5 h-5 text-yellow-400" />
              <div>
                <p className="text-lg font-bold text-white">{activeJobs}</p>
                <p className="text-xs text-gray-400">Active Jobs</p>
              </div>
            </div>
            <div className="p-3 bg-lattice-elevated rounded-lg border border-lattice-border flex items-center gap-3">
              <Award className="w-5 h-5 text-cyan-400" />
              <div>
                <p className="text-lg font-bold text-white">{certifiedCount}</p>
                <p className="text-xs text-gray-400">Certified</p>
              </div>
            </div>
            <div className="p-3 bg-lattice-elevated rounded-lg border border-lattice-border flex items-center gap-3">
              <ShieldCheck className="w-5 h-5 text-green-400" />
              <div>
                <p className="text-lg font-bold text-white">{safetyScore}%</p>
                <p className="text-xs text-gray-400">Safety Score</p>
              </div>
            </div>
          </div>
        );
      })()}
      {runAction.isPending && (
        <span className="text-xs text-neon-cyan animate-pulse">AI processing...</span>
      )}
      {mode === 'dashboard' ? renderDashboard() : renderLibrary()}
      {renderEditor()}
    </div>
  );
}
