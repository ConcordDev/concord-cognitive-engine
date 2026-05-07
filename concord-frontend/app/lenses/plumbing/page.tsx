'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Droplets,
  Wrench,
  ClipboardList,
  DollarSign,
  Users,
  Plus,
  Search,
  X,
  Trash2,
  BarChart3,
  CheckCircle2,
  FileText,
  Award,
  Calculator,
  Receipt,
  Map,
  Gauge,
  Siren,
  Zap,
} from 'lucide-react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });
import { LensPageShell } from '@/components/lens/LensPageShell';

type ModeTab =
  | 'jobs'
  | 'estimates'
  | 'codes'
  | 'materials'
  | 'clients'
  | 'invoices'
  | 'inspections'
  | 'certs'
  | 'map';
type ArtifactType =
  | 'Job'
  | 'Estimate'
  | 'CodeRef'
  | 'Material'
  | 'Client'
  | 'Invoice'
  | 'Inspection'
  | 'Certification';
type Status =
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'invoiced'
  | 'paid'
  | 'pending'
  | 'failed'
  | 'active';

interface TradeArtifact {
  name: string;
  type: ArtifactType;
  status: Status;
  description: string;
  notes: string;
  client?: string;
  address?: string;
  phone?: string;
  email?: string;
  lat?: number;
  lng?: number;
  scheduledDate?: string;
  completedDate?: string;
  laborHours?: number;
  laborRate?: number;
  materialCost?: number;
  totalCost?: number;
  codeReference?: string;
  codeSection?: string;
  jurisdiction?: string;
  material?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  supplier?: string;
  invoiceNumber?: string;
  dueDate?: string;
  paidDate?: string;
  amount?: number;
  inspector?: string;
  result?: string;
  deficiencies?: string;
  certType?: string;
  certNumber?: string;
  expiryDate?: string;
  issuedBy?: string;
  photos?: number;
  safetyNotes?: string;
}

const MODE_TABS: {
  id: ModeTab;
  label: string;
  icon: typeof Droplets;
  artifactType: ArtifactType;
}[] = [
  { id: 'jobs', label: 'Jobs', icon: Wrench, artifactType: 'Job' },
  { id: 'estimates', label: 'Estimates', icon: Calculator, artifactType: 'Estimate' },
  { id: 'codes', label: 'Codes', icon: FileText, artifactType: 'CodeRef' },
  { id: 'materials', label: 'Materials', icon: Droplets, artifactType: 'Material' },
  { id: 'clients', label: 'CRM', icon: Users, artifactType: 'Client' },
  { id: 'invoices', label: 'Invoices', icon: Receipt, artifactType: 'Invoice' },
  { id: 'inspections', label: 'Inspections', icon: ClipboardList, artifactType: 'Inspection' },
  { id: 'certs', label: 'Certs', icon: Award, artifactType: 'Certification' },
  { id: 'map', label: 'Map', icon: Map, artifactType: 'Job' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  scheduled: { label: 'Scheduled', color: 'blue-400' },
  in_progress: { label: 'In Progress', color: 'cyan-400' },
  completed: { label: 'Completed', color: 'green-400' },
  invoiced: { label: 'Invoiced', color: 'purple-400' },
  paid: { label: 'Paid', color: 'emerald-400' },
  pending: { label: 'Pending', color: 'yellow-400' },
  failed: { label: 'Failed', color: 'red-400' },
  active: { label: 'Active', color: 'green-400' },
};

const PLUMBING_MATERIALS = [
  'PVC Pipe',
  'Copper Pipe',
  'PEX Tubing',
  'Cast Iron Pipe',
  'Fittings',
  'Valves',
  'Fixtures',
  'Water Heater',
  'Sump Pump',
  'Drain Assembly',
  'Backflow Preventer',
  'Expansion Tank',
];
const PLUMBING_CERTS = [
  'Master Plumber',
  'Journeyman Plumber',
  'Apprentice Plumber',
  'Backflow Certification',
  'Medical Gas Certification',
  'Green Plumber',
];

export default function PlumbingLensPage() {
  const [activeTab, setActiveTab] = useState<ModeTab>('jobs');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<TradeArtifact> | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStatus, setFormStatus] = useState<Status>('scheduled');
  const [formNotes, setFormNotes] = useState('');
  const [formClient, setFormClient] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formScheduledDate, setFormScheduledDate] = useState('');
  const [formLaborHours, setFormLaborHours] = useState('');
  const [formLaborRate, setFormLaborRate] = useState('');
  const [formMaterialCost, setFormMaterialCost] = useState('');
  const [formMaterial, setFormMaterial] = useState('PVC Pipe');
  const [formQuantity, setFormQuantity] = useState('');
  const [formCertType, setFormCertType] = useState('Master Plumber');
  const [formAmount, setFormAmount] = useState('');

  const activeArtifactType = MODE_TABS.find((t) => t.id === activeTab)?.artifactType || 'Job';
  const { items, isLoading, isError, error, refetch, create, update, remove } =
    useLensData<TradeArtifact>('plumbing', activeArtifactType, { seed: [] });
  const runAction = useRunArtifact('plumbing');

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
    setFormScheduledDate('');
    setFormLaborHours('');
    setFormLaborRate('');
    setFormMaterialCost('');
    setFormMaterial('PVC Pipe');
    setFormQuantity('');
    setFormCertType('Master Plumber');
    setFormAmount('');
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
    setFormScheduledDate(d.scheduledDate || '');
    setFormLaborHours(d.laborHours?.toString() || '');
    setFormLaborRate(d.laborRate?.toString() || '');
    setFormMaterialCost(d.materialCost?.toString() || '');
    setFormMaterial(d.material || 'PVC Pipe');
    setFormQuantity(d.quantity?.toString() || '');
    setFormCertType(d.certType || 'Master Plumber');
    setFormAmount(d.amount?.toString() || '');
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
      scheduledDate: formScheduledDate,
      laborHours: laborH,
      laborRate: laborR,
      materialCost: matC,
      totalCost: (laborH && laborR ? laborH * laborR : 0) + (matC || 0) || undefined,
      material: formMaterial,
      quantity: formQuantity ? parseFloat(formQuantity) : undefined,
      certType: formCertType,
      amount: formAmount ? parseFloat(formAmount) : undefined,
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
    const totalRevenue = all.reduce((s, j) => s + (j.totalCost || j.amount || 0), 0);
    return (
      <div data-lens-theme="plumbing" className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
        onClick={() => setEditorOpen(false)}
      >
        <div
          className={cn(ds.panel, 'w-full max-w-lg max-h-[85vh] overflow-y-auto')}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className={ds.heading3}>
              {editingItem ? 'Edit' : 'New'} {activeArtifactType}
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
            {(activeArtifactType === 'Job' ||
              activeArtifactType === 'Estimate' ||
              activeArtifactType === 'Client') && (
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
                <div>
                  <label className={ds.label}>Phone</label>
                  <input
                    className={ds.input}
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                  />
                </div>
              </>
            )}
            {(activeArtifactType === 'Job' || activeArtifactType === 'Estimate') && (
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
              </>
            )}
            {activeArtifactType === 'Material' && (
              <>
                <div>
                  <label className={ds.label}>Material</label>
                  <select
                    className={ds.select}
                    value={formMaterial}
                    onChange={(e) => setFormMaterial(e.target.value)}
                  >
                    {PLUMBING_MATERIALS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={ds.label}>Quantity</label>
                  <input
                    type="number"
                    className={ds.input}
                    value={formQuantity}
                    onChange={(e) => setFormQuantity(e.target.value)}
                  />
                </div>
              </>
            )}
            {activeArtifactType === 'Invoice' && (
              <div>
                <label className={ds.label}>Amount</label>
                <input
                  type="number"
                  className={ds.input}
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                />
              </div>
            )}
            {activeArtifactType === 'Certification' && (
              <div>
                <label className={ds.label}>Certification Type</label>
                <select
                  className={ds.select}
                  value={formCertType}
                  onChange={(e) => setFormCertType(e.target.value)}
                >
                  {PLUMBING_CERTS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
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
          <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className={cn(ds.panel, 'text-center py-12')}>
          <Droplets className="w-12 h-12 text-gray-600 mx-auto mb-3" />
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
                  <Droplets className="w-5 h-5 text-neon-cyan" />
                  <div>
                    <p className="text-white font-medium">{d.name || item.title}</p>
                    <p className={ds.textMuted}>
                      {d.client || ''} {d.address ? `- ${d.address}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(d.totalCost || d.amount) && (
                    <span className="text-xs text-green-400">
                      ${(d.totalCost || d.amount || 0).toLocaleString()}
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
      domain="plumbing"
      title="Plumbing"
      description="Jobs, estimates, codes, materials, CRM, invoicing, inspections, and certifications"
      headerIcon={<Droplets className="w-6 h-6" />}
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
      <UniversalActions domain="plumbing" artifactId={items[0]?.id} compact />

      {/* Stats Row */}
      {(() => {
        const all = items.map((i) => i.data as unknown as TradeArtifact);
        const activeJobs = all.filter(
          (j) => j.status === 'in_progress' || j.status === 'scheduled'
        ).length;
        const emergencyCount = all.filter(
          (j) =>
            j.notes?.toLowerCase().includes('emergency') ||
            j.description?.toLowerCase().includes('emergency')
        ).length;
        const completed = all.filter((j) => j.status === 'completed' || j.status === 'paid').length;
        const total = all.length;
        const completionRate = total > 0 ? ((completed / total) * 100).toFixed(0) : '0';
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className={ds.panel}>
              <Wrench className="w-5 h-5 text-blue-400 mb-2" />
              <p className={ds.textMuted}>Active Jobs</p>
              <p className="text-xl font-bold text-white">{activeJobs}</p>
            </div>
            <div className={ds.panel}>
              <Siren className="w-5 h-5 text-red-400 mb-2" />
              <p className={ds.textMuted}>Emergency Count</p>
              <p className="text-xl font-bold text-white">{emergencyCount}</p>
            </div>
            <div className={ds.panel}>
              <Gauge className="w-5 h-5 text-green-400 mb-2" />
              <p className={ds.textMuted}>Completion Rate</p>
              <p className="text-xl font-bold text-white">{completionRate}%</p>
            </div>
            <div className={ds.panel}>
              <DollarSign className="w-5 h-5 text-yellow-400 mb-2" />
              <p className={ds.textMuted}>Revenue</p>
              <p className="text-xl font-bold text-white">
                ${all.reduce((s, j) => s + (j.totalCost || j.amount || 0), 0).toLocaleString()}
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
                ? 'bg-neon-blue/20 text-neon-blue'
                : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </nav>
      {activeTab === 'map' ? (
        <div className={cn(ds.panel, 'p-4')}>
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Map className="w-4 h-4 text-neon-cyan" /> Job Site Locations
          </h3>
          <MapView
            markers={items
              .filter((i) => {
                const d = i.data as unknown as TradeArtifact;
                return d.lat && d.lng;
              })
              .map((i) => {
                const d = i.data as unknown as TradeArtifact;
                return {
                  lat: d.lat!,
                  lng: d.lng!,
                  label: d.name || i.title,
                  popup: `${d.address || ''} - ${d.client || ''}`,
                };
              })}
            className="h-[500px]"
          />
        </div>
      ) : showDashboard ? (
        renderDashboard()
      ) : (
        renderLibrary()
      )}
      {renderEditor()}
    </LensPageShell>
  );
}
