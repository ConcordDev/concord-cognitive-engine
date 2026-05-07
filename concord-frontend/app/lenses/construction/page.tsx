'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  HardHat, Ruler, ClipboardList, DollarSign, Calendar, Users,
  Plus, Search, X, Trash2, BarChart3, CheckCircle2,
  AlertTriangle, MapPin, Truck, FileText, Camera,
  Layers, ChevronDown, Shield, Wrench, Building2, Map, Percent, Hammer,
} from 'lucide-react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

type ModeTab = 'jobs' | 'estimates' | 'materials' | 'inspections' | 'safety' | 'crew' | 'documents' | 'map';
type ArtifactType = 'Job' | 'Estimate' | 'MaterialTakeoff' | 'Inspection' | 'SafetyReport' | 'CrewAssignment' | 'Document';
type Status = 'planned' | 'bidding' | 'awarded' | 'in_progress' | 'inspection' | 'punch_list' | 'completed' | 'on_hold';

interface ConstructionArtifact {
  name: string; type: ArtifactType; status: Status; description: string; notes: string;
  // Job
  jobNumber?: string; client?: string; address?: string; startDate?: string; endDate?: string;
  contractValue?: number; changeOrders?: number; projectType?: string;
  lat?: number; lng?: number;
  // Estimate
  laborCost?: number; materialCost?: number; overhead?: number; profit?: number; totalEstimate?: number;
  // Materials
  material?: string; quantity?: number; unit?: string; unitCost?: number; supplier?: string;
  deliveryDate?: string; onSite?: boolean;
  // Inspection
  inspector?: string; inspectionType?: string; result?: string; deficiencies?: string;
  reinspectionDate?: string; codeReference?: string;
  // Safety
  incidentType?: string; severity?: string; actionTaken?: string; followUp?: string;
  // Crew
  foreman?: string; crewSize?: number; trade?: string; shift?: string;
}

const MODE_TABS: { id: ModeTab; label: string; icon: typeof HardHat; artifactType: ArtifactType }[] = [
  { id: 'jobs', label: 'Jobs', icon: Building2, artifactType: 'Job' },
  { id: 'estimates', label: 'Estimates', icon: DollarSign, artifactType: 'Estimate' },
  { id: 'materials', label: 'Materials', icon: Truck, artifactType: 'MaterialTakeoff' },
  { id: 'inspections', label: 'Inspections', icon: ClipboardList, artifactType: 'Inspection' },
  { id: 'safety', label: 'Safety', icon: Shield, artifactType: 'SafetyReport' },
  { id: 'crew', label: 'Crew', icon: Users, artifactType: 'CrewAssignment' },
  { id: 'documents', label: 'Documents', icon: FileText, artifactType: 'Document' },
  { id: 'map', label: 'Map', icon: Map, artifactType: 'Job' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  planned: { label: 'Planned', color: 'gray-400' }, bidding: { label: 'Bidding', color: 'blue-400' },
  awarded: { label: 'Awarded', color: 'cyan-400' }, in_progress: { label: 'In Progress', color: 'green-400' },
  inspection: { label: 'Inspection', color: 'yellow-400' }, punch_list: { label: 'Punch List', color: 'orange-400' },
  completed: { label: 'Completed', color: 'emerald-400' }, on_hold: { label: 'On Hold', color: 'red-400' },
};

const PROJECT_TYPES = ['Residential New', 'Residential Remodel', 'Commercial', 'Industrial', 'Infrastructure', 'Multi-Family', 'Mixed-Use', 'Tenant Improvement'];
const INSPECTION_TYPES = ['Foundation', 'Framing', 'Rough-In', 'Insulation', 'Drywall', 'Final', 'Fire', 'Electrical', 'Plumbing', 'Mechanical'];
const TRADES = ['General', 'Electrical', 'Plumbing', 'HVAC', 'Framing', 'Concrete', 'Roofing', 'Drywall', 'Painting', 'Flooring', 'Masonry', 'Welding', 'Excavation'];

export default function ConstructionLensPage() {
  useLensNav('construction');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('construction');

  const [activeTab, setActiveTab] = useState<ModeTab>('jobs');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<ConstructionArtifact> | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showFeatures, setShowFeatures] = useState(false);

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
  const [formTrade, setFormTrade] = useState('General');
  const [formInspectionType, setFormInspectionType] = useState('Foundation');
  const [formForeman, setFormForeman] = useState('');
  const [formCrewSize, setFormCrewSize] = useState('');

  const activeArtifactType = MODE_TABS.find(t => t.id === activeTab)?.artifactType || 'Job';
  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<ConstructionArtifact>('construction', activeArtifactType, { seed: [] });
  const runAction = useRunArtifact('construction');

  const filtered = useMemo(() => {
    let result = items;
    if (searchQuery) { const q = searchQuery.toLowerCase(); result = result.filter(i => i.title.toLowerCase().includes(q) || (i.data as unknown as ConstructionArtifact).description?.toLowerCase().includes(q)); }
    if (filterStatus !== 'all') result = result.filter(i => (i.data as unknown as ConstructionArtifact).status === filterStatus);
    return result;
  }, [items, searchQuery, filterStatus]);

  const openCreate = () => { setEditingItem(null); setFormName(''); setFormDescription(''); setFormStatus('planned'); setFormNotes(''); setFormClient(''); setFormAddress(''); setFormStartDate(''); setFormEndDate(''); setFormContractValue(''); setFormProjectType('Residential New'); setFormLaborCost(''); setFormMaterialCost(''); setFormTrade('General'); setFormInspectionType('Foundation'); setFormForeman(''); setFormCrewSize(''); setEditorOpen(true); };
  const openEdit = (item: LensItem<ConstructionArtifact>) => { const d = item.data as unknown as ConstructionArtifact; setEditingItem(item); setFormName(d.name || ''); setFormDescription(d.description || ''); setFormStatus(d.status || 'planned'); setFormNotes(d.notes || ''); setFormClient(d.client || ''); setFormAddress(d.address || ''); setFormStartDate(d.startDate || ''); setFormEndDate(d.endDate || ''); setFormContractValue(d.contractValue?.toString() || ''); setFormProjectType(d.projectType || 'Residential New'); setFormLaborCost(d.laborCost?.toString() || ''); setFormMaterialCost(d.materialCost?.toString() || ''); setFormTrade(d.trade || 'General'); setFormInspectionType(d.inspectionType || 'Foundation'); setFormForeman(d.foreman || ''); setFormCrewSize(d.crewSize?.toString() || ''); setEditorOpen(true); };

  const handleSave = async () => {
    const data: Record<string, unknown> = { name: formName, type: activeArtifactType, status: formStatus, description: formDescription, notes: formNotes, client: formClient, address: formAddress, startDate: formStartDate, endDate: formEndDate, contractValue: formContractValue ? parseFloat(formContractValue) : undefined, projectType: formProjectType, laborCost: formLaborCost ? parseFloat(formLaborCost) : undefined, materialCost: formMaterialCost ? parseFloat(formMaterialCost) : undefined, trade: formTrade, inspectionType: formInspectionType, foreman: formForeman, crewSize: formCrewSize ? parseInt(formCrewSize) : undefined };
    if (editingItem) await update(editingItem.id, { title: formName, data, meta: { tags: [], status: formStatus, visibility: 'private' } });
    else await create({ title: formName, data, meta: { tags: [], status: formStatus, visibility: 'private' } });
    setEditorOpen(false);
  };

  if (isError) return <ErrorState error={error?.message} onRetry={refetch} />;

  const renderDashboard = () => {
    const all = items.map(i => i.data as unknown as ConstructionArtifact);
    const totalContract = all.reduce((s, j) => s + (j.contractValue || 0), 0);
    return (
      <div data-lens-theme="construction" className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={ds.panel}><Building2 className="w-5 h-5 text-blue-400 mb-2" /><p className={ds.textMuted}>Active Jobs</p><p className="text-xl font-bold text-white">{all.filter(j => j.status === 'in_progress').length}</p></div>
        <div className={ds.panel}><DollarSign className="w-5 h-5 text-green-400 mb-2" /><p className={ds.textMuted}>Contract Value</p><p className="text-xl font-bold text-white">${totalContract.toLocaleString()}</p></div>
        <div className={ds.panel}><ClipboardList className="w-5 h-5 text-yellow-400 mb-2" /><p className={ds.textMuted}>Pending Inspections</p><p className="text-xl font-bold text-white">{all.filter(j => j.status === 'inspection').length}</p></div>
        <div className={ds.panel}><AlertTriangle className="w-5 h-5 text-red-400 mb-2" /><p className={ds.textMuted}>Safety Issues</p><p className="text-xl font-bold text-white">{all.filter(j => j.status === 'on_hold').length}</p></div>
      </div>
    );
  };

  const renderEditor = () => {
    if (!editorOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setEditorOpen(false)}>
        <div className={cn(ds.panel, 'w-full max-w-lg max-h-[85vh] overflow-y-auto')} onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4"><h3 className={ds.heading3}>{editingItem ? 'Edit' : 'New'} {activeArtifactType}</h3><button onClick={() => setEditorOpen(false)} className={ds.btnGhost}><X className="w-4 h-4" /></button></div>
          <div className="space-y-3">
            <div><label className={ds.label}>Name</label><input className={ds.input} value={formName} onChange={e => setFormName(e.target.value)} /></div>
            <div><label className={ds.label}>Description</label><textarea className={ds.textarea} rows={2} value={formDescription} onChange={e => setFormDescription(e.target.value)} /></div>
            <div><label className={ds.label}>Status</label><select className={ds.select} value={formStatus} onChange={e => setFormStatus(e.target.value as Status)}>{Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
            {activeArtifactType === 'Job' && (
              <>
                <div><label className={ds.label}>Client</label><input className={ds.input} value={formClient} onChange={e => setFormClient(e.target.value)} /></div>
                <div><label className={ds.label}>Address</label><input className={ds.input} value={formAddress} onChange={e => setFormAddress(e.target.value)} /></div>
                <div><label className={ds.label}>Project Type</label><select className={ds.select} value={formProjectType} onChange={e => setFormProjectType(e.target.value)}>{PROJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                <div><label className={ds.label}>Contract Value</label><input type="number" className={ds.input} value={formContractValue} onChange={e => setFormContractValue(e.target.value)} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={ds.label}>Start</label><input type="date" className={ds.input} value={formStartDate} onChange={e => setFormStartDate(e.target.value)} /></div>
                  <div><label className={ds.label}>End</label><input type="date" className={ds.input} value={formEndDate} onChange={e => setFormEndDate(e.target.value)} /></div>
                </div>
              </>
            )}
            {activeArtifactType === 'Estimate' && (
              <div className="grid grid-cols-2 gap-3">
                <div><label className={ds.label}>Labor Cost</label><input type="number" className={ds.input} value={formLaborCost} onChange={e => setFormLaborCost(e.target.value)} /></div>
                <div><label className={ds.label}>Material Cost</label><input type="number" className={ds.input} value={formMaterialCost} onChange={e => setFormMaterialCost(e.target.value)} /></div>
              </div>
            )}
            {activeArtifactType === 'Inspection' && (
              <div><label className={ds.label}>Inspection Type</label><select className={ds.select} value={formInspectionType} onChange={e => setFormInspectionType(e.target.value)}>{INSPECTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            )}
            {activeArtifactType === 'CrewAssignment' && (
              <>
                <div><label className={ds.label}>Trade</label><select className={ds.select} value={formTrade} onChange={e => setFormTrade(e.target.value)}>{TRADES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                <div><label className={ds.label}>Foreman</label><input className={ds.input} value={formForeman} onChange={e => setFormForeman(e.target.value)} /></div>
                <div><label className={ds.label}>Crew Size</label><input type="number" className={ds.input} value={formCrewSize} onChange={e => setFormCrewSize(e.target.value)} /></div>
              </>
            )}
            <div><label className={ds.label}>Notes</label><textarea className={ds.textarea} rows={2} value={formNotes} onChange={e => setFormNotes(e.target.value)} /></div>
          </div>
          <div className="flex justify-end gap-2 mt-4"><button onClick={() => setEditorOpen(false)} className={ds.btnSecondary}>Cancel</button><button onClick={handleSave} className={ds.btnPrimary} disabled={!formName.trim()}>Save</button></div>
        </div>
      </div>
    );
  };

  const renderLibrary = () => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" /><input className={cn(ds.input, 'pl-10')} placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} /></div>
        <select className={cn(ds.select, 'w-auto')} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}><option value="all">All Status</option>{Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <button onClick={openCreate} className={ds.btnPrimary}><Plus className="w-4 h-4" /> New</button>
      </div>
      {isLoading ? <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" /></div>
      : filtered.length === 0 ? <div className={cn(ds.panel, 'text-center py-12')}><HardHat className="w-12 h-12 text-gray-600 mx-auto mb-3" /><p className={ds.textMuted}>No {activeArtifactType} items yet</p><button onClick={openCreate} className={cn(ds.btnPrimary, 'mt-3')}><Plus className="w-4 h-4" /> Create First</button></div>
      : filtered.map((item, index) => {
        const d = item.data as unknown as ConstructionArtifact;
        const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.planned;
        return (
          <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className={ds.panelHover} onClick={() => openEdit(item)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3"><HardHat className="w-5 h-5 text-neon-cyan" /><div><p className="text-white font-medium">{d.name || item.title}</p><p className={ds.textMuted}>{d.client || ''} {d.address ? `- ${d.address}` : ''} {d.trade ? `[${d.trade}]` : ''}</p></div></div>
              <div className="flex items-center gap-2">
                {d.contractValue && <span className="text-xs text-green-400">${d.contractValue.toLocaleString()}</span>}
                <span className={`text-xs px-2 py-0.5 rounded-full bg-${sc.color}/20 text-${sc.color}`}>{sc.label}</span>
                <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={ds.btnGhost}><Trash2 className="w-4 h-4 text-red-400" /></button>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );

  return (
    <div data-lens-theme="construction" className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center"><HardHat className="w-5 h-5 text-white" /></div>
          <div><div className="flex items-center gap-2"><h1 className={ds.heading1}>Construction</h1><LiveIndicator isLive={isLive} lastUpdated={lastUpdated} /></div><p className={ds.textMuted}>Jobs, estimates, materials, inspections, safety, and crew management</p></div>
        </div>
        <div className="flex items-center gap-2"><DTUExportButton domain="construction" data={{}} compact /><button onClick={() => setShowDashboard(!showDashboard)} className={cn(showDashboard ? ds.btnPrimary : ds.btnSecondary)}><BarChart3 className="w-4 h-4" /> Dashboard</button></div>
      </header>
      <RealtimeDataPanel domain="construction" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

      {/* Stats Row */}
      {(() => {
        const allJobs = items.map(i => i.data as unknown as ConstructionArtifact);
        const activeCount = allJobs.filter(j => j.status === 'in_progress').length;
        const budgetTotal = allJobs.reduce((s, j) => s + (j.contractValue || 0), 0);
        const completedCount = allJobs.filter(j => j.status === 'completed').length;
        const completionRate = allJobs.length > 0 ? ((completedCount / allJobs.length) * 100).toFixed(0) : '0';
        return (
          <div className="grid grid-cols-3 gap-4">
            <div className="p-3 bg-lattice-elevated rounded-lg border border-lattice-border flex items-center gap-3">
              <Hammer className="w-5 h-5 text-orange-400" />
              <div><p className="text-lg font-bold text-white">{activeCount}</p><p className="text-xs text-gray-400">Active Projects</p></div>
            </div>
            <div className="p-3 bg-lattice-elevated rounded-lg border border-lattice-border flex items-center gap-3">
              <DollarSign className="w-5 h-5 text-green-400" />
              <div><p className="text-lg font-bold text-white">${budgetTotal.toLocaleString()}</p><p className="text-xs text-gray-400">Budget Total</p></div>
            </div>
            <div className="p-3 bg-lattice-elevated rounded-lg border border-lattice-border flex items-center gap-3">
              <Percent className="w-5 h-5 text-cyan-400" />
              <div><p className="text-lg font-bold text-white">{completionRate}%</p><p className="text-xs text-gray-400">Completion Rate</p></div>
            </div>
          </div>
        );
      })()}

      <UniversalActions domain="construction" artifactId={items[0]?.id} compact />
      <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 overflow-x-auto">{MODE_TABS.map(tab => (<button key={tab.id} onClick={() => { setActiveTab(tab.id); setShowDashboard(false); }} className={cn('flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap', activeTab === tab.id && !showDashboard ? 'bg-neon-blue/20 text-neon-blue' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated')}><tab.icon className="w-4 h-4" />{tab.label}</button>))}</nav>
      {activeTab === 'map' ? (
        <div className={cn(ds.panel, 'p-4')}>
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><Map className="w-4 h-4 text-neon-cyan" /> Job Site Locations</h3>
          <MapView
            markers={items.filter(i => { const d = i.data as unknown as ConstructionArtifact; return d.lat && d.lng; }).map(i => { const d = i.data as unknown as ConstructionArtifact; return { lat: d.lat!, lng: d.lng!, label: d.name || i.title, popup: `${d.address || ''} - ${d.status || ''}` }; })}
            className="h-[500px]"
          />
        </div>
      ) : showDashboard ? renderDashboard() : renderLibrary()}
      {renderEditor()}
      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-400 hover:text-white transition-colors"><span className="flex items-center gap-2"><Layers className="w-4 h-4" />Lens Features & Capabilities</span><ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} /></button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="trades" /></div>}
      </div>
    </div>
  );
}
