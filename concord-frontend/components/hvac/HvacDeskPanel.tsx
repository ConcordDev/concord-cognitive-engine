'use client';

/**
 * HvacDeskPanel — Jobs/Estimates/Codes/Materials/CRM/Invoices/Inspections/Certs
 * CRUD + dashboard + stats strip. Extracted from hvac/page.tsx consolidation.
 *
 * Full-lens build notes (2026-11-03, against the filed first pass):
 *  - S1: the editor's backdrop and panel no longer carry keydown-to-click
 *    activation. They did, and a Space typed in any field bubbled up to the
 *    backdrop's handler, whose synthetic click closed the dialog and
 *    destroyed the draft. Mouse click-to-close stays; Escape closes.
 *  - S2: each artifact type has its own statuses, its own form fields and
 *    its own row summary (a client is not "Scheduled"; an invoice carries
 *    its number and due date; a certification shows its computed validity).
 *    Codes and Materials additionally mount real reference panels (domain
 *    corpus / priced catalog) above the desk's own records.
 *  - S3: the Dashboard aggregates every desk type, not just Jobs, and its
 *    Outstanding tile sums unpaid invoices; a recent-activity list is
 *    drawn from the records' own timestamps and labelled as such.
 *  - F4: row delete is a two-step confirm. Every save/delete toasts.
 */

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import {
  Thermometer, Wrench, ClipboardList, DollarSign, Users, Plus, Search, X, Trash2,
  BarChart3, CheckCircle2, FileText, Award, Calculator, Receipt, Fan, Gauge,
} from 'lucide-react';
import {
  type ModeTab, type ArtifactType, type Status, type TradeArtifact,
  STATUS_CONFIG, STATUS_BY_TYPE, DEFAULT_STATUS_BY_TYPE, statusLabel,
  TRADE_MATERIALS, TRADE_CERTS, ARTIFACT_TABS,
} from '@/components/hvac/hvac-shared';

const MODE_TABS = ARTIFACT_TABS.map((t) => ({
  ...t,
  icon:
    t.id === 'jobs' ? Wrench
    : t.id === 'estimates' ? Calculator
    : t.id === 'codes' ? FileText
    : t.id === 'materials' ? Thermometer
    : t.id === 'clients' ? Users
    : t.id === 'invoices' ? Receipt
    : t.id === 'inspections' ? ClipboardList
    : Award,
}));

interface CodeEntry { id: string; source: string; section: string; title: string; summary: string }
interface CatalogItem { name: string; category: string; unit: string; referencePriceUsd: number }

function CodesPanel() {
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ entries: CodeEntry[]; count: number; total: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async (query: string) => {
    const r = await lensRun<{ entries: CodeEntry[]; count: number; total: number }>('hvac', 'code-search', { q: query });
    if (r.data?.ok && r.data.result) { setData(r.data.result); setFailed(false); }
    else setFailed(true);
  }, []);
  useEffect(() => { void load(q); }, [load, q]);
  const res = { data, isLoading: !data && !failed, isError: failed };
  const entries = data?.entries || [];
  return (
    <div className={cn(ds.panel, 'space-y-3')}>
      <div className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-sky-300" />
        <p className="text-sm font-semibold text-white">Code library</p>
        <span className="text-xs text-gray-500">{res.data ? `${res.data.count} of ${res.data.total} references` : ''}</span>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className={cn(ds.input, 'pl-10')}
            placeholder="Search the library — try EPA, condensate, disconnect…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search code library"
          />
        </div>
      </div>
      {res.isLoading ? (
        <p className={ds.textMuted}>Loading the library…</p>
      ) : res.isError ? (
        <p className="text-xs text-rose-400" role="alert">The code library could not be loaded. Your saved references below are unaffected.</p>
      ) : entries.length === 0 ? (
        <p className={ds.textMuted}>No code references match “{q}”. Try a broader term — a source (EPA, IMC, NEC), a section number, or a topic (ventilation, leak, condensate).</p>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => (
            <div key={e.id} className="rounded-lg border border-white/5 bg-black/20 p-3">
              <p className="text-xs text-sky-300">{e.source} · {e.section}</p>
              <p className="text-sm text-white font-medium">{e.title}</p>
              <p className="text-xs text-gray-400 mt-1">{e.summary}</p>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-gray-500">Reference summaries in plain language — the adopted edition of each code and your local amendments govern.</p>
    </div>
  );
}

function MaterialsCatalogPanel() {
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ items: CatalogItem[]; count: number; priceNote: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async (query: string) => {
    const r = await lensRun<{ items: CatalogItem[]; count: number; priceNote: string }>('hvac', 'materials-catalog', { q: query });
    if (r.data?.ok && r.data.result) { setData(r.data.result); setFailed(false); }
    else setFailed(true);
  }, []);
  useEffect(() => { void load(q); }, [load, q]);
  const res = { data, isLoading: !data && !failed, isError: failed };
  const items = data?.items || [];
  return (
    <div className={cn(ds.panel, 'space-y-3')}>
      <div className="flex items-center gap-2">
        <Thermometer className="w-4 h-4 text-sky-300" />
        <p className="text-sm font-semibold text-white">Materials catalog</p>
        <span className="text-xs text-gray-500">{res.data ? `${res.data.count} items` : ''}</span>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className={cn(ds.input, 'pl-10')}
            placeholder="Search the catalog — try refrigerant, filter, copper…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search materials catalog"
          />
        </div>
      </div>
      {res.isLoading ? (
        <p className={ds.textMuted}>Loading the catalog…</p>
      ) : res.isError ? (
        <p className="text-xs text-rose-400" role="alert">The catalog could not be loaded. Your own materials below are unaffected.</p>
      ) : items.length === 0 ? (
        <p className={ds.textMuted}>No catalog items match “{q}”.</p>
      ) : (
        <div className="divide-y divide-white/5">
          {items.map((m) => (
            <div key={m.name} className="flex items-center justify-between py-1.5">
              <div>
                <p className="text-sm text-zinc-200">{m.name}</p>
                <p className="text-[11px] text-gray-500">{m.category}</p>
              </div>
              <p className="text-sm text-emerald-300 font-mono">${m.referencePriceUsd.toLocaleString()} <span className="text-[11px] text-gray-500">{m.unit}</span></p>
            </div>
          ))}
        </div>
      )}
      {res.data?.priceNote && <p className="text-[11px] text-gray-500">{res.data.priceNote}</p>}
    </div>
  );
}

type TaggedItem = LensItem<TradeArtifact> & { _type: ArtifactType };

function HvacDashboard({ jobItems }: { jobItems: LensItem<TradeArtifact>[] }) {
  const estimates = useLensData<TradeArtifact>('hvac', 'Estimate', { seed: [] });
  const clients = useLensData<TradeArtifact>('hvac', 'Client', { seed: [] });
  const invoices = useLensData<TradeArtifact>('hvac', 'Invoice', { seed: [] });
  const inspections = useLensData<TradeArtifact>('hvac', 'Inspection', { seed: [] });
  const certs = useLensData<TradeArtifact>('hvac', 'Certification', { seed: [] });
  const materials = useLensData<TradeArtifact>('hvac', 'Material', { seed: [] });
  const coderefs = useLensData<TradeArtifact>('hvac', 'CodeRef', { seed: [] });

  const groups: { type: ArtifactType; items: LensItem<TradeArtifact>[] }[] = [
    { type: 'Job', items: jobItems },
    { type: 'Estimate', items: estimates.items },
    { type: 'Client', items: clients.items },
    { type: 'Invoice', items: invoices.items },
    { type: 'Inspection', items: inspections.items },
    { type: 'Certification', items: certs.items },
    { type: 'Material', items: materials.items },
    { type: 'CodeRef', items: coderefs.items },
  ];
  const seen = new Set<string>();
  const all: TaggedItem[] = [];
  for (const g of groups) {
    for (const i of g.items) {
      if (seen.has(i.id)) continue;
      seen.add(i.id);
      all.push({ ...i, _type: (i.data as TradeArtifact)?.type || g.type });
    }
  }
  const ofType = (t: ArtifactType) => all.filter((i) => i._type === t);
  const jobs = ofType('Job');
  const invs = ofType('Invoice');
  const totalRevenue = all.reduce((s, i) => s + ((i.data as TradeArtifact).totalCost || (i.data as TradeArtifact).amount || 0), 0);
  const outstanding = invs
    .filter((i) => (i.data as TradeArtifact).status !== 'paid')
    .reduce((s, i) => s + ((i.data as TradeArtifact).amount || 0), 0);
  const openInvoices = invs.filter((i) => (i.data as TradeArtifact).status !== 'paid').length;
  const completedCount = all.filter((i) => ['completed', 'paid', 'accepted', 'passed'].includes((i.data as TradeArtifact).status)).length;
  const recent = all
    .slice()
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, 8);

  return (
    <div className="space-y-4">
      <div data-lens-theme="hvac" className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={ds.panel}>
          <Wrench className="w-5 h-5 text-blue-400 mb-2" />
          <p className={ds.textMuted}>Active Jobs</p>
          <p className="text-xl font-bold text-white">
            {jobs.filter((j) => ['in_progress', 'scheduled'].includes((j.data as TradeArtifact).status)).length}
          </p>
        </div>
        <div className={ds.panel}>
          <DollarSign className="w-5 h-5 text-green-400 mb-2" />
          <p className={ds.textMuted}>Revenue</p>
          <p className="text-xl font-bold text-white">${totalRevenue.toLocaleString()}</p>
          <p className="text-[11px] text-gray-500">Job totals + invoice amounts across the desk</p>
        </div>
        <div className={ds.panel}>
          <CheckCircle2 className="w-5 h-5 text-emerald-400 mb-2" />
          <p className={ds.textMuted}>Completed</p>
          <p className="text-xl font-bold text-white">{completedCount}</p>
        </div>
        <div className={ds.panel}>
          <Receipt className="w-5 h-5 text-purple-400 mb-2" />
          <p className={ds.textMuted}>Outstanding</p>
          <p className="text-xl font-bold text-white">${outstanding.toLocaleString()}</p>
          <p className="text-[11px] text-gray-500">{openInvoices} invoice{openInvoices === 1 ? '' : 's'} not marked paid</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => (
          <span key={g.type} className="text-xs px-2 py-1 rounded-full bg-white/5 text-gray-300">
            {g.type === 'CodeRef' ? 'Code refs' : `${g.type}s`}: {ofType(g.type).length}
          </span>
        ))}
      </div>
      <div className={cn(ds.panel, 'space-y-2')}>
        <p className="text-sm font-semibold text-white flex items-center gap-2"><BarChart3 className="w-4 h-4 text-sky-300" /> Recent activity on this desk</p>
        {recent.length === 0 ? (
          <p className={ds.textMuted}>No records yet — activity appears here as you create and update records.</p>
        ) : (
          recent.map((i) => {
            const d = i.data as TradeArtifact;
            return (
              <p key={i.id} className="text-xs text-gray-300">
                <span className="text-sky-300">{i._type}</span> “{d.name || i.title}” {i.version > 1 ? 'updated' : 'created'}
                <span className="text-gray-500"> · {String(i.updatedAt || '').slice(0, 10)}</span>
              </p>
            );
          })
        )}
        <p className="text-[11px] text-gray-500">Drawn from your records' own timestamps, newest first. Deletions leave no trace here — the shell's Activity timeline carries the platform event record.</p>
      </div>
    </div>
  );
}

function certExpiryChip(d: TradeArtifact): { text: string; cls: string } | null {
  if (!d.expiryDate) return null;
  const today = new Date().toISOString().slice(0, 10);
  const days = Math.round((new Date(d.expiryDate).getTime() - new Date(today).getTime()) / 86400000);
  if (Number.isNaN(days)) return null;
  if (days < 0) return { text: `Expired ${d.expiryDate}`, cls: 'bg-red-400/20 text-red-300' };
  if (days <= 30) return { text: `Expires ${d.expiryDate} (${days}d)`, cls: 'bg-amber-400/20 text-amber-300' };
  return { text: `Valid to ${d.expiryDate}`, cls: 'bg-emerald-400/20 text-emerald-300' };
}

export function HvacDeskPanel({ mode }: { mode: ModeTab | 'dashboard' }) {
  const addToast = useUIStore((s) => s.addToast);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<TradeArtifact> | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
  const [formMaterial, setFormMaterial] = useState(TRADE_MATERIALS[0] || '');
  const [formQuantity, setFormQuantity] = useState('');
  const [formUnit, setFormUnit] = useState('');
  const [formUnitPrice, setFormUnitPrice] = useState('');
  const [formSupplier, setFormSupplier] = useState('');
  const [formCertType, setFormCertType] = useState(TRADE_CERTS[0] || '');
  const [formCertNumber, setFormCertNumber] = useState('');
  const [formIssuedBy, setFormIssuedBy] = useState('');
  const [formExpiryDate, setFormExpiryDate] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formInvoiceNumber, setFormInvoiceNumber] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formPaidDate, setFormPaidDate] = useState('');
  const [formInspector, setFormInspector] = useState('');
  const [formResult, setFormResult] = useState('');
  const [formDeficiencies, setFormDeficiencies] = useState('');
  const [formCodeReference, setFormCodeReference] = useState('');
  const [formCodeSection, setFormCodeSection] = useState('');
  const [formJurisdiction, setFormJurisdiction] = useState('');

  const deskMode = mode === 'dashboard' ? 'jobs' : mode;
  const activeArtifactType = MODE_TABS.find((t) => t.id === deskMode)?.artifactType || 'Job';
  const { items, isLoading, isError, error, refetch, create, update, remove } =
    useLensData<TradeArtifact>('hvac', activeArtifactType, { seed: [] });

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

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormStatus(DEFAULT_STATUS_BY_TYPE[activeArtifactType]);
    setFormNotes('');
    setFormClient('');
    setFormAddress('');
    setFormPhone('');
    setFormEmail('');
    setFormScheduledDate('');
    setFormLaborHours('');
    setFormLaborRate('');
    setFormMaterialCost('');
    setFormMaterial(TRADE_MATERIALS[0] || '');
    setFormQuantity('');
    setFormUnit('');
    setFormUnitPrice('');
    setFormSupplier('');
    setFormCertType(TRADE_CERTS[0] || '');
    setFormCertNumber('');
    setFormIssuedBy('');
    setFormExpiryDate('');
    setFormAmount('');
    setFormInvoiceNumber('');
    setFormDueDate('');
    setFormPaidDate('');
    setFormInspector('');
    setFormResult('');
    setFormDeficiencies('');
    setFormCodeReference('');
    setFormCodeSection('');
    setFormJurisdiction('');
  };

  const openCreate = () => {
    setEditingItem(null);
    resetForm();
    setEditorOpen(true);
  };

  const openEdit = (item: LensItem<TradeArtifact>) => {
    const d = item.data as unknown as TradeArtifact;
    setEditingItem(item);
    resetForm();
    setFormName(d.name || '');
    setFormDescription(d.description || '');
    setFormStatus(d.status || DEFAULT_STATUS_BY_TYPE[activeArtifactType]);
    setFormNotes(d.notes || '');
    setFormClient(d.client || '');
    setFormAddress(d.address || '');
    setFormPhone(d.phone || '');
    setFormEmail(d.email || '');
    setFormScheduledDate(d.scheduledDate || '');
    setFormLaborHours(d.laborHours?.toString() || '');
    setFormLaborRate(d.laborRate?.toString() || '');
    setFormMaterialCost(d.materialCost?.toString() || '');
    setFormMaterial(d.material || TRADE_MATERIALS[0] || '');
    setFormQuantity(d.quantity?.toString() || '');
    setFormUnit(d.unit || '');
    setFormUnitPrice(d.unitPrice?.toString() || '');
    setFormSupplier(d.supplier || '');
    setFormCertType(d.certType || TRADE_CERTS[0] || '');
    setFormCertNumber(d.certNumber || '');
    setFormIssuedBy(d.issuedBy || '');
    setFormExpiryDate(d.expiryDate || '');
    setFormAmount(d.amount?.toString() || '');
    setFormInvoiceNumber(d.invoiceNumber || '');
    setFormDueDate(d.dueDate || '');
    setFormPaidDate(d.paidDate || '');
    setFormInspector(d.inspector || '');
    setFormResult(d.result || '');
    setFormDeficiencies(d.deficiencies || '');
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
      material: formMaterial,
      quantity: formQuantity ? parseFloat(formQuantity) : undefined,
      unit: formUnit,
      unitPrice: formUnitPrice ? parseFloat(formUnitPrice) : undefined,
      supplier: formSupplier,
      certType: formCertType,
      certNumber: formCertNumber,
      issuedBy: formIssuedBy,
      expiryDate: formExpiryDate,
      amount: formAmount ? parseFloat(formAmount) : undefined,
      invoiceNumber: formInvoiceNumber,
      dueDate: formDueDate,
      paidDate: formPaidDate,
      inspector: formInspector,
      result: formResult,
      deficiencies: formDeficiencies,
      codeReference: formCodeReference,
      codeSection: formCodeSection,
      jurisdiction: formJurisdiction,
    };
    try {
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
      addToast({ type: 'success', message: `${activeArtifactType} ${editingItem ? 'updated' : 'created'} — ${formName}` });
      setEditorOpen(false);
    } catch (e) {
      addToast({ type: 'error', message: `Could not save the ${activeArtifactType.toLowerCase()}${e instanceof Error ? `: ${e.message}` : ''}` });
    }
  };

  const handleDelete = async (item: LensItem<TradeArtifact>) => {
    if (confirmDeleteId !== item.id) {
      setConfirmDeleteId(item.id);
      window.setTimeout(() => setConfirmDeleteId((cur) => (cur === item.id ? null : cur)), 4000);
      return;
    }
    setConfirmDeleteId(null);
    try {
      await remove(item.id);
      const d = item.data as unknown as TradeArtifact;
      addToast({ type: 'success', message: `${activeArtifactType} deleted — ${d.name || item.title}` });
    } catch (e) {
      addToast({ type: 'error', message: `Could not delete the ${activeArtifactType.toLowerCase()}${e instanceof Error ? `: ${e.message}` : ''}` });
    }
  };

  const allItems = items.map((i) => i.data as unknown as TradeArtifact);
  const recordCount = allItems.length;
  const openCount = allItems.filter((j) => !['completed', 'paid', 'accepted', 'passed', 'cancelled', 'declined', 'failed', 'inactive'].includes(j.status)).length;
  const completedCount = allItems.filter((j) => ['completed', 'paid', 'accepted', 'passed'].includes(j.status)).length;
  const completedPct = recordCount > 0 ? ((completedCount / recordCount) * 100).toFixed(0) : '0';

  const statusOptions = STATUS_BY_TYPE[activeArtifactType];
  const statusSelectOptions: Status[] = statusOptions.includes(formStatus) ? statusOptions : [formStatus, ...statusOptions];

  const renderEditor = () => {
    if (!editorOpen) return null;
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={() => setEditorOpen(false)}
        onKeyDown={(e) => { if (e.key === 'Escape') setEditorOpen(false); }}
      >
        <div
          className={cn(ds.panel, 'w-full max-w-lg max-h-[85vh] overflow-y-auto')}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={`${editingItem ? 'Edit' : 'New'} ${activeArtifactType}`}
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
              <textarea className={ds.textarea} rows={2} value={formDescription} onChange={(e) => setFormDescription(e.target.value)} />
            </div>
            <div>
              <label className={ds.label}>Status</label>
              <select className={ds.select} value={formStatus} onChange={(e) => setFormStatus(e.target.value as Status)}>
                {statusSelectOptions.map((k) => (
                  <option key={k} value={k}>{statusLabel(activeArtifactType, k)}</option>
                ))}
              </select>
            </div>
            {(activeArtifactType === 'Job' || activeArtifactType === 'Estimate' || activeArtifactType === 'Client') && (
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
                  <label className={ds.label}>Phone</label>
                  <input className={ds.input} value={formPhone} onChange={(e) => setFormPhone(e.target.value)} />
                </div>
              </>
            )}
            {activeArtifactType === 'Client' && (
              <div>
                <label className={ds.label}>Email</label>
                <input className={ds.input} value={formEmail} onChange={(e) => setFormEmail(e.target.value)} />
              </div>
            )}
            {(activeArtifactType === 'Job' || activeArtifactType === 'Estimate') && (
              <>
                <div>
                  <label className={ds.label}>Scheduled Date</label>
                  <input type="date" className={ds.input} value={formScheduledDate} onChange={(e) => setFormScheduledDate(e.target.value)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className={ds.label}>Labor Hrs</label>
                    <input type="number" className={ds.input} value={formLaborHours} onChange={(e) => setFormLaborHours(e.target.value)} />
                  </div>
                  <div>
                    <label className={ds.label}>Rate</label>
                    <input type="number" className={ds.input} value={formLaborRate} onChange={(e) => setFormLaborRate(e.target.value)} />
                  </div>
                  <div>
                    <label className={ds.label}>Material $</label>
                    <input type="number" className={ds.input} value={formMaterialCost} onChange={(e) => setFormMaterialCost(e.target.value)} />
                  </div>
                </div>
              </>
            )}
            {activeArtifactType === 'Material' && (
              <>
                <div>
                  <label className={ds.label}>Material</label>
                  <select className={ds.select} value={formMaterial} onChange={(e) => setFormMaterial(e.target.value)}>
                    {TRADE_MATERIALS.map((m) => (<option key={m} value={m}>{m}</option>))}
                  </select>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className={ds.label}>Quantity</label>
                    <input type="number" className={ds.input} value={formQuantity} onChange={(e) => setFormQuantity(e.target.value)} />
                  </div>
                  <div>
                    <label className={ds.label}>Unit</label>
                    <input className={ds.input} value={formUnit} onChange={(e) => setFormUnit(e.target.value)} placeholder="each, lb, ft…" />
                  </div>
                  <div>
                    <label className={ds.label}>Unit Price</label>
                    <input type="number" className={ds.input} value={formUnitPrice} onChange={(e) => setFormUnitPrice(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className={ds.label}>Supplier</label>
                  <input className={ds.input} value={formSupplier} onChange={(e) => setFormSupplier(e.target.value)} />
                </div>
              </>
            )}
            {activeArtifactType === 'Invoice' && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className={ds.label}>Invoice #</label>
                    <input className={ds.input} value={formInvoiceNumber} onChange={(e) => setFormInvoiceNumber(e.target.value)} />
                  </div>
                  <div>
                    <label className={ds.label}>Amount</label>
                    <input type="number" className={ds.input} value={formAmount} onChange={(e) => setFormAmount(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className={ds.label}>Due Date</label>
                    <input type="date" className={ds.input} value={formDueDate} onChange={(e) => setFormDueDate(e.target.value)} />
                  </div>
                  {formStatus === 'paid' && (
                    <div>
                      <label className={ds.label}>Paid Date</label>
                      <input type="date" className={ds.input} value={formPaidDate} onChange={(e) => setFormPaidDate(e.target.value)} />
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-gray-500">An invoice here is a record. Marking it Paid records that the client paid — nothing is charged from this desk.</p>
              </>
            )}
            {activeArtifactType === 'Inspection' && (
              <>
                <div>
                  <label className={ds.label}>Inspector</label>
                  <input className={ds.input} value={formInspector} onChange={(e) => setFormInspector(e.target.value)} />
                </div>
                <div>
                  <label className={ds.label}>Result</label>
                  <select className={ds.select} value={formResult} onChange={(e) => setFormResult(e.target.value)}>
                    <option value="">—</option>
                    <option value="Pass">Pass</option>
                    <option value="Pass with deficiencies">Pass with deficiencies</option>
                    <option value="Fail">Fail</option>
                  </select>
                </div>
                <div>
                  <label className={ds.label}>Deficiencies</label>
                  <textarea className={ds.textarea} rows={2} value={formDeficiencies} onChange={(e) => setFormDeficiencies(e.target.value)} />
                </div>
              </>
            )}
            {activeArtifactType === 'Certification' && (
              <>
                <div>
                  <label className={ds.label}>Certification</label>
                  <select className={ds.select} value={formCertType} onChange={(e) => setFormCertType(e.target.value)}>
                    {TRADE_CERTS.map((c) => (<option key={c} value={c}>{c}</option>))}
                  </select>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className={ds.label}>Cert Number</label>
                    <input className={ds.input} value={formCertNumber} onChange={(e) => setFormCertNumber(e.target.value)} />
                  </div>
                  <div>
                    <label className={ds.label}>Issued By</label>
                    <input className={ds.input} value={formIssuedBy} onChange={(e) => setFormIssuedBy(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className={ds.label}>Expiry Date</label>
                  <input type="date" className={ds.input} value={formExpiryDate} onChange={(e) => setFormExpiryDate(e.target.value)} />
                </div>
              </>
            )}
            {activeArtifactType === 'CodeRef' && (
              <>
                <div>
                  <label className={ds.label}>Code Reference</label>
                  <input className={ds.input} value={formCodeReference} onChange={(e) => setFormCodeReference(e.target.value)} placeholder="e.g. EPA 40 CFR 82 Subpart F" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className={ds.label}>Section</label>
                    <input className={ds.input} value={formCodeSection} onChange={(e) => setFormCodeSection(e.target.value)} placeholder="e.g. §82.154" />
                  </div>
                  <div>
                    <label className={ds.label}>Jurisdiction</label>
                    <input className={ds.input} value={formJurisdiction} onChange={(e) => setFormJurisdiction(e.target.value)} placeholder="e.g. Federal, NY State" />
                  </div>
                </div>
              </>
            )}
            <div>
              <label className={ds.label}>Notes</label>
              <textarea className={ds.textarea} rows={2} value={formNotes} onChange={(e) => setFormNotes(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setEditorOpen(false)} className={ds.btnSecondary}>Cancel</button>
            <button onClick={handleSave} className={ds.btnPrimary} disabled={!formName.trim()}>Save</button>
          </div>
        </div>
      </div>
    );
  };

  const rowSummary = (d: TradeArtifact): string => {
    switch (activeArtifactType) {
      case 'Invoice': {
        const bits = [d.invoiceNumber ? `#${d.invoiceNumber}` : '', d.client || '', d.dueDate ? `due ${d.dueDate}` : ''].filter(Boolean);
        return bits.join(' · ');
      }
      case 'Certification':
        return [d.certType || '', d.certNumber ? `#${d.certNumber}` : '', d.issuedBy || ''].filter(Boolean).join(' · ');
      case 'Material':
        return [d.material || '', d.quantity ? `× ${d.quantity}${d.unit ? ` ${d.unit}` : ''}` : '', d.supplier || ''].filter(Boolean).join(' · ');
      case 'CodeRef':
        return [d.codeReference || '', d.codeSection || '', d.jurisdiction || ''].filter(Boolean).join(' · ');
      case 'Inspection':
        return [d.inspector || '', d.result || ''].filter(Boolean).join(' · ');
      default:
        return `${d.client || ''} ${d.address ? `- ${d.address}` : ''}`.trim();
    }
  };

  const renderLibrary = () => (
    <div className="space-y-3">
      {mode === 'codes' && <CodesPanel />}
      {mode === 'codes' && <p className={cn(ds.textMuted, 'text-xs')}>Your own saved references live below — pin the ones your jurisdiction amends.</p>}
      {mode === 'materials' && <MaterialsCatalogPanel />}
      {mode === 'materials' && <p className={cn(ds.textMuted, 'text-xs')}>Your own stock and purchases live below.</p>}
      {mode === 'estimates' && (
        <p className={cn(ds.textMuted, 'text-xs')}>
          Looking for approval signatures? Estimate e-sign requests live in Field Service → E-Sign — request a signature there and track it to signed or declined.
        </p>
      )}
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
        <select className={cn(ds.select, 'w-auto')} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="all">All</option>
          {statusOptions.map((k) => (
            <option key={k} value={k}>{statusLabel(activeArtifactType, k)}</option>
          ))}
        </select>
        <button onClick={openCreate} className={ds.btnPrimary}>
          <Plus className="w-4 h-4" /> New
        </button>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
          <div className="w-6 h-6 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
          <span className="sr-only">Loading…</span>
        </div>
      ) : isError ? (
        <ErrorState error={(error as Error)?.message} onRetry={() => refetch()} />
      ) : filtered.length === 0 ? (
        <div className={cn(ds.panel, 'text-center py-12')}>
          <Thermometer className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className={ds.textMuted}>No {activeArtifactType} items yet</p>
          <button onClick={openCreate} className={cn(ds.btnPrimary, 'mt-3')}>
            <Plus className="w-4 h-4" /> Create First
          </button>
        </div>
      ) : (
        filtered.map((item, index) => {
          const d = item.data as unknown as TradeArtifact;
          const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.pending;
          const expiry = activeArtifactType === 'Certification' ? certExpiryChip(d) : null;
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
                  <Thermometer className="w-5 h-5 text-neon-cyan" />
                  <div>
                    <p className="text-white font-medium">{d.name || item.title}</p>
                    <p className={ds.textMuted}>{rowSummary(d)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(d.totalCost || d.amount) && (
                    <span className="text-xs text-green-400">
                      ${(d.totalCost || d.amount || 0).toLocaleString()}
                    </span>
                  )}
                  {expiry && (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${expiry.cls}`}>{expiry.text}</span>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full bg-${sc.color}/20 text-${sc.color}`}>
                    {statusLabel(activeArtifactType, d.status)}
                  </span>
                  {confirmDeleteId === item.id ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleDelete(item); }}
                      className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-300"
                      aria-label="Confirm delete"
                    >
                      Confirm delete?
                    </button>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleDelete(item); }}
                      className={ds.btnGhost}
                      aria-label="Delete"
                    >
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-3 bg-lattice-elevated rounded-lg border border-lattice-border flex items-center gap-3">
          <Fan className="w-5 h-5 text-cyan-400" />
          <div>
            <p className="text-lg font-bold text-white">{recordCount}</p>
            <p className="text-xs text-gray-400">{activeArtifactType} records</p>
          </div>
        </div>
        <div className="p-3 bg-lattice-elevated rounded-lg border border-lattice-border flex items-center gap-3">
          <Wrench className="w-5 h-5 text-yellow-400" />
          <div>
            <p className="text-lg font-bold text-white">{openCount}</p>
            <p className="text-xs text-gray-400">Open</p>
          </div>
        </div>
        <div className="p-3 bg-lattice-elevated rounded-lg border border-lattice-border flex items-center gap-3">
          <Gauge className="w-5 h-5 text-green-400" />
          <div>
            <p className="text-lg font-bold text-white">{completedPct}%</p>
            <p className="text-xs text-gray-400">Completed or paid</p>
          </div>
        </div>
      </div>
      {mode === 'dashboard' ? <HvacDashboard jobItems={items} /> : renderLibrary()}
      {renderEditor()}
    </div>
  );
}
