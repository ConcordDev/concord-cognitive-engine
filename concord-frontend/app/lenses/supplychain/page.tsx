'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData, LensItem } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Truck, Package, Warehouse, Globe, BarChart3, Users,
  Plus, Search, X, Trash2, DollarSign,
  AlertTriangle, CheckCircle2,
  Layers, ChevronDown, Ship, Factory, Route, Zap,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

type ModeTab = 'orders' | 'suppliers' | 'inventory' | 'shipments' | 'warehouses' | 'analytics' | 'procurement';
type ArtifactType = 'PurchaseOrder' | 'Supplier' | 'InventoryItem' | 'Shipment' | 'WarehouseRecord' | 'SupplyAnalytic' | 'ProcurementReq';
type Status = 'pending' | 'approved' | 'in_transit' | 'delivered' | 'active' | 'inactive' | 'low_stock' | 'backordered';

interface SupplyChainArtifact {
  name: string; type: ArtifactType; status: Status; description: string; notes: string;
  supplier?: string; quantity?: number; unitCost?: number; totalCost?: number;
  leadTime?: number; origin?: string; destination?: string;
  trackingNumber?: string; carrier?: string; eta?: string;
  sku?: string; reorderPoint?: number; currentStock?: number;
  warehouseLocation?: string; category?: string;
}

const MODE_TABS: { id: ModeTab; label: string; icon: typeof Truck; artifactType: ArtifactType }[] = [
  { id: 'orders', label: 'Orders', icon: Package, artifactType: 'PurchaseOrder' },
  { id: 'suppliers', label: 'Suppliers', icon: Users, artifactType: 'Supplier' },
  { id: 'inventory', label: 'Inventory', icon: Warehouse, artifactType: 'InventoryItem' },
  { id: 'shipments', label: 'Shipments', icon: Ship, artifactType: 'Shipment' },
  { id: 'warehouses', label: 'Warehouses', icon: Factory, artifactType: 'WarehouseRecord' },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, artifactType: 'SupplyAnalytic' },
  { id: 'procurement', label: 'Procurement', icon: Route, artifactType: 'ProcurementReq' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'yellow-400' }, approved: { label: 'Approved', color: 'green-400' },
  in_transit: { label: 'In Transit', color: 'blue-400' }, delivered: { label: 'Delivered', color: 'emerald-400' },
  active: { label: 'Active', color: 'green-400' }, inactive: { label: 'Inactive', color: 'gray-400' },
  low_stock: { label: 'Low Stock', color: 'red-400' }, backordered: { label: 'Backordered', color: 'orange-400' },
};

export default function SupplyChainLensPage() {
  useLensNav('supplychain');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('supplychain');

  const [activeTab, setActiveTab] = useState<ModeTab>('orders');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<SupplyChainArtifact> | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStatus, setFormStatus] = useState<Status>('pending');
  const [formNotes, setFormNotes] = useState('');
  const [formSupplier, setFormSupplier] = useState('');
  const [formQuantity, setFormQuantity] = useState('');
  const [formUnitCost, setFormUnitCost] = useState('');
  const [formOrigin, setFormOrigin] = useState('');
  const [formDestination, setFormDestination] = useState('');
  const [formSku, setFormSku] = useState('');
  const [formTrackingNumber, setFormTrackingNumber] = useState('');

  const activeArtifactType = MODE_TABS.find(t => t.id === activeTab)?.artifactType || 'PurchaseOrder';
  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<SupplyChainArtifact>('supplychain', activeArtifactType, { seed: [] });
  const runAction = useRunArtifact('supplychain');

  const filtered = useMemo(() => {
    let result = items;
    if (searchQuery) { const q = searchQuery.toLowerCase(); result = result.filter(i => i.title.toLowerCase().includes(q) || (i.data as unknown as SupplyChainArtifact).description?.toLowerCase().includes(q)); }
    if (filterStatus !== 'all') result = result.filter(i => (i.data as unknown as SupplyChainArtifact).status === filterStatus);
    return result;
  }, [items, searchQuery, filterStatus]);

  const handleAction = useCallback(async (action: string, artifactId?: string) => {
    const targetId = artifactId || filtered[0]?.id;
    if (!targetId) return;
    try {
      await runAction.mutateAsync({ id: targetId, action });
    } catch (err) {
      console.error('Action failed:', err);
    }
  }, [filtered, runAction]);

  const openCreate = () => { setEditingItem(null); setFormName(''); setFormDescription(''); setFormStatus('pending'); setFormNotes(''); setFormSupplier(''); setFormQuantity(''); setFormUnitCost(''); setFormOrigin(''); setFormDestination(''); setFormSku(''); setFormTrackingNumber(''); setEditorOpen(true); };
  const openEdit = (item: LensItem<SupplyChainArtifact>) => { const d = item.data as unknown as SupplyChainArtifact; setEditingItem(item); setFormName(d.name || ''); setFormDescription(d.description || ''); setFormStatus(d.status || 'pending'); setFormNotes(d.notes || ''); setFormSupplier(d.supplier || ''); setFormQuantity(d.quantity?.toString() || ''); setFormUnitCost(d.unitCost?.toString() || ''); setFormOrigin(d.origin || ''); setFormDestination(d.destination || ''); setFormSku(d.sku || ''); setFormTrackingNumber(d.trackingNumber || ''); setEditorOpen(true); };

  const handleSave = async () => {
    const data: Record<string, unknown> = { name: formName, type: activeArtifactType, status: formStatus, description: formDescription, notes: formNotes, supplier: formSupplier, quantity: formQuantity ? parseInt(formQuantity) : undefined, unitCost: formUnitCost ? parseFloat(formUnitCost) : undefined, totalCost: formQuantity && formUnitCost ? parseInt(formQuantity) * parseFloat(formUnitCost) : undefined, origin: formOrigin, destination: formDestination, sku: formSku, trackingNumber: formTrackingNumber };
    if (editingItem) await update(editingItem.id, { title: formName, data, meta: { tags: [], status: formStatus, visibility: 'private' } });
    else await create({ title: formName, data, meta: { tags: [], status: formStatus, visibility: 'private' } });
    setEditorOpen(false);
  };

  if (isError) return <ErrorState error={error?.message} onRetry={refetch} />;

  const renderDashboard = () => {
    const all = items.map(i => i.data as unknown as SupplyChainArtifact);
    const totalValue = all.reduce((s, e) => s + (e.totalCost || 0), 0);
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={ds.panel}><Package className="w-5 h-5 text-blue-400 mb-2" /><p className={ds.textMuted}>Total Orders</p><p className="text-xl font-bold text-white">{items.length}</p></div>
        <div className={ds.panel}><DollarSign className="w-5 h-5 text-green-400 mb-2" /><p className={ds.textMuted}>Total Value</p><p className="text-xl font-bold text-white">${totalValue.toLocaleString()}</p></div>
        <div className={ds.panel}><Truck className="w-5 h-5 text-cyan-400 mb-2" /><p className={ds.textMuted}>In Transit</p><p className="text-xl font-bold text-white">{all.filter(e => e.status === 'in_transit').length}</p></div>
        <div className={ds.panel}><AlertTriangle className="w-5 h-5 text-red-400 mb-2" /><p className={ds.textMuted}>Low Stock</p><p className="text-xl font-bold text-white">{all.filter(e => e.status === 'low_stock').length}</p></div>
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
            <div><label className={ds.label}>Supplier</label><input className={ds.input} value={formSupplier} onChange={e => setFormSupplier(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={ds.label}>Quantity</label><input type="number" className={ds.input} value={formQuantity} onChange={e => setFormQuantity(e.target.value)} /></div>
              <div><label className={ds.label}>Unit Cost</label><input type="number" className={ds.input} value={formUnitCost} onChange={e => setFormUnitCost(e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={ds.label}>Origin</label><input className={ds.input} value={formOrigin} onChange={e => setFormOrigin(e.target.value)} /></div>
              <div><label className={ds.label}>Destination</label><input className={ds.input} value={formDestination} onChange={e => setFormDestination(e.target.value)} /></div>
            </div>
            <div><label className={ds.label}>SKU</label><input className={ds.input} value={formSku} onChange={e => setFormSku(e.target.value)} /></div>
            <div><label className={ds.label}>Tracking Number</label><input className={ds.input} value={formTrackingNumber} onChange={e => setFormTrackingNumber(e.target.value)} /></div>
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
      {isLoading ? <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-neon-blue border-t-transparent rounded-full animate-spin" /></div>
      : filtered.length === 0 ? <div className={cn(ds.panel, 'text-center py-12')}><Truck className="w-12 h-12 text-gray-600 mx-auto mb-3" /><p className={ds.textMuted}>No {activeArtifactType} items yet</p><button onClick={openCreate} className={cn(ds.btnPrimary, 'mt-3')}><Plus className="w-4 h-4" /> Create First</button></div>
      : filtered.map((item, index) => {
        const d = item.data as unknown as SupplyChainArtifact;
        const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.pending;
        return (
          <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className={ds.panelHover} onClick={() => openEdit(item)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3"><Package className="w-5 h-5 text-neon-cyan" /><div><p className="text-white font-medium">{d.name || item.title}</p><p className={ds.textMuted}>{d.supplier || ''} {d.origin && d.destination ? `${d.origin} -> ${d.destination}` : ''}</p></div></div>
              <div className="flex items-center gap-2">
                {d.totalCost && <span className="text-xs text-green-400">${d.totalCost.toLocaleString()}</span>}
                <span className={`text-xs px-2 py-0.5 rounded-full bg-${sc.color}/20 text-${sc.color}`}>{sc.label}</span>
                <button onClick={e => { e.stopPropagation(); handleAction('analyze', item.id); }} className={ds.btnGhost}><Zap className="w-4 h-4 text-neon-cyan" /></button>
                <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={ds.btnGhost}><Trash2 className="w-4 h-4 text-red-400" /></button>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );

  return (
    <div data-lens-theme="supplychain" className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center"><Truck className="w-5 h-5 text-white" /></div>
          <div><div className="flex items-center gap-2"><h1 className={ds.heading1}>Supply Chain</h1><LiveIndicator isLive={isLive} lastUpdated={lastUpdated} /></div><p className={ds.textMuted}>Orders, suppliers, inventory, shipments, and procurement</p></div>
        </div>
        <div className="flex items-center gap-2">{runAction.isPending && <span className="text-xs text-neon-cyan animate-pulse">AI processing...</span>}<DTUExportButton domain="supplychain" data={{}} compact /><button onClick={() => setShowDashboard(!showDashboard)} className={cn(showDashboard ? ds.btnPrimary : ds.btnSecondary)}><BarChart3 className="w-4 h-4" /> Dashboard</button></div>
      </header>
      <RealtimeDataPanel domain="supplychain" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <UniversalActions domain="supplychain" artifactId={items[0]?.id} compact />

      {/* Stats Row */}
      {(() => { const all = items.map(i => i.data as unknown as SupplyChainArtifact); const inTransit = all.filter(e => e.status === 'in_transit').length; const delivered = all.filter(e => e.status === 'delivered').length; const total = all.length; const onTimeRate = total > 0 ? ((delivered / total) * 100).toFixed(0) : '0'; return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className={ds.panel}><Globe className="w-5 h-5 text-teal-400 mb-2" /><p className={ds.textMuted}>Nodes</p><p className="text-xl font-bold text-white">{[...new Set(all.map(a => a.supplier).filter(Boolean))].length + [...new Set(all.map(a => a.destination).filter(Boolean))].length}</p></div>
          <div className={ds.panel}><Ship className="w-5 h-5 text-blue-400 mb-2" /><p className={ds.textMuted}>Active Shipments</p><p className="text-xl font-bold text-white">{inTransit}</p></div>
          <div className={ds.panel}><CheckCircle2 className="w-5 h-5 text-green-400 mb-2" /><p className={ds.textMuted}>On-Time Rate</p><p className="text-xl font-bold text-white">{onTimeRate}%</p></div>
          <div className={ds.panel}><DollarSign className="w-5 h-5 text-yellow-400 mb-2" /><p className={ds.textMuted}>Total Value</p><p className="text-xl font-bold text-white">${all.reduce((s, e) => s + (e.totalCost || 0), 0).toLocaleString()}</p></div>
        </div>
      ); })()}
      <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">{MODE_TABS.map(tab => (<button key={tab.id} onClick={() => { setActiveTab(tab.id); setShowDashboard(false); }} className={cn('flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap', activeTab === tab.id && !showDashboard ? 'bg-neon-blue/20 text-neon-blue' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated')}><tab.icon className="w-4 h-4" />{tab.label}</button>))}</nav>
      {showDashboard ? renderDashboard() : renderLibrary()}
      {renderEditor()}
      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"><span className="flex items-center gap-2"><Layers className="w-4 h-4" />Lens Features & Capabilities</span><ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} /></button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="supplychain" /></div>}
      </div>
    </div>
  );
}
