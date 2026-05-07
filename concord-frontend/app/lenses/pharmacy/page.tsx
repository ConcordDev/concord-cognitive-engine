'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Pill, AlertTriangle, Plus, Trash2, Clock, ShieldCheck, Layers, ChevronDown, AlertCircle, Package, Search, Loader2, Activity, CheckCircle2 } from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

interface Medication {
  name: string;
  dosage: string;
  frequency: string;
  route: string;
  rxcui: string;
  prescriber: string;
  startDate: string;
  refillsLeft: number;
  status: 'active' | 'discontinued' | 'pending';
}

interface InteractionCheck {
  drugs: string[];
  severity: string;
  description: string;
}

export default function PharmacyLensPage() {
  useLensNav('pharmacy');

  const [activeTab, setActiveTab] = useState<'medications' | 'interactions' | 'refills'>('medications');
  const [showFeatures, setShowFeatures] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('pharmacy');

  const { items: medItems, isLoading, isError, error, refetch, create, update, remove } = useLensData<Record<string, unknown>>('pharmacy', 'medication', { seed: [] });
  const { items: interactionItems, create: createInteraction } = useLensData<Record<string, unknown>>('pharmacy', 'interaction', { seed: [] });
  const runAction = useRunArtifact('pharmacy');

  const allMedications = medItems.map(i => ({ id: i.id, title: i.title, ...(i.data || {}) })) as unknown as (Medication & { id: string; title: string })[];
  const medications = searchQuery.trim()
    ? allMedications.filter(m => (m.name || m.title || '').toLowerCase().includes(searchQuery.toLowerCase()))
    : allMedications;
  const interactions = interactionItems.map(i => ({ id: i.id, ...(i.data || {}) })) as unknown as (InteractionCheck & { id: string })[];

  const [newMed, setNewMed] = useState({ name: '', dosage: '', frequency: 'daily', route: 'oral' });

  // --- Domain action state ---
  const [pharmActionRunning, setPharmActionRunning] = useState<string | null>(null);
  const [interactionResult, setInteractionResult] = useState<Record<string, unknown> | null>(null);
  const [dosageResult, setDosageResult] = useState<Record<string, unknown> | null>(null);
  const [inventoryResult, setInventoryResult] = useState<Record<string, unknown> | null>(null);
  const [formularyResult, setFormularyResult] = useState<Record<string, unknown> | null>(null);

  const handlePharmAction = async (
    action: string,
    setter: (val: Record<string, unknown> | null) => void
  ) => {
    setPharmActionRunning(action);
    try {
      const artifactId = medItems[0]?.id || 'pharmacy';
      const res = await runAction.mutateAsync({ id: artifactId, action });
      if (res.ok === false) { setter({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` } as Record<string, unknown>); } else { setter((res.result as Record<string, unknown>) || null); }
    } catch (e) {
      console.error(`Pharmacy action ${action} failed:`, e);
    }
    setPharmActionRunning(null);
  };

  const addMedication = () => {
    if (!newMed.name.trim()) return;
    create({
      title: newMed.name,
      data: {
        ...newMed,
        rxcui: '',
        prescriber: '',
        startDate: new Date().toISOString(),
        refillsLeft: 3,
        status: 'active',
      },
    });
    setNewMed({ name: '', dosage: '', frequency: 'daily', route: 'oral' });
  };

  const checkInteractions = async () => {
    const activeNames = medications.filter(m => m.status === 'active').map(m => m.name || m.title);
    if (activeNames.length < 2) return;
    try {
      await runAction.mutateAsync({ id: medItems[0]?.id || 'pharmacy-default', action: 'drugInteractionCheck', params: { medications: activeNames } });
      refetch();
    } catch (e) { console.error('Drug interaction check failed:', e); }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-green border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div data-lens-theme="pharmacy" className="p-6 space-y-6">
      {/* Disclaimer */}
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-sm text-red-200">
            Not medical or pharmaceutical advice. Always consult a licensed healthcare provider or pharmacist before starting, stopping, or changing any medication. Do not rely on this tool for drug interaction or dosage decisions.
          </p>
          <div className="flex items-center gap-3 mt-1">
            <span className="flex items-center gap-1 text-xs text-red-400/70"><ShieldCheck className="w-3 h-3" />Informational Only</span>
          </div>
        </div>
      </div>

      <motion.header initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Pill className="w-8 h-8 text-neon-green" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">Pharmacy Lens</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className="text-sm text-gray-400">Medication tracking, interaction checks, and refill management</p>
          </div>
        </div>
      </motion.header>

      {/* Stat Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(() => {
          const activeMeds = medications.filter(m => m.status === 'active').length;
          const needsRefill = medications.filter(m => (m.refillsLeft || 0) <= 1 && m.status === 'active').length;
          const interactionCount = interactions.length;
          const totalMeds = medications.length;
          return [
            { icon: Pill, label: 'Active Meds', value: activeMeds, color: 'text-green-400', bg: 'bg-green-400/10' },
            { icon: Package, label: 'Total Tracked', value: totalMeds, color: 'text-blue-400', bg: 'bg-blue-400/10' },
            { icon: AlertCircle, label: 'Refill Needed', value: needsRefill, color: 'text-red-400', bg: 'bg-red-400/10' },
            { icon: AlertTriangle, label: 'Interactions', value: interactionCount, color: 'text-amber-400', bg: 'bg-amber-400/10' },
          ].map((stat, i) => (
            <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08, duration: 0.35 }}
              className="panel p-3 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${stat.bg}`}>
                <stat.icon className={`w-5 h-5 ${stat.color}`} />
              </div>
              <div>
                <p className="text-xl font-bold text-white">{stat.value}</p>
                <p className="text-xs text-gray-400">{stat.label}</p>
              </div>
            </motion.div>
          ));
        })()}
      </div>

      {/* Prescription Status Badges & Drug Interaction Warning */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-gray-500 uppercase tracking-wide">Rx Status:</span>
        {[
          { label: 'Ready', count: medications.filter(m => m.status === 'active' && (m.refillsLeft || 0) > 1).length, cls: 'bg-green-500/20 text-green-400 border-green-500/30' },
          { label: 'Processing', count: medications.filter(m => m.status === 'pending').length, cls: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
          { label: 'Refill Needed', count: medications.filter(m => (m.refillsLeft || 0) <= 1 && m.status === 'active').length, cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
        ].map(s => (
          <span key={s.label} className={`text-xs px-3 py-1 rounded-full border font-medium ${s.cls}`}>
            {s.label}: {s.count}
          </span>
        ))}
        {interactions.some(ix => ix.severity === 'critical' || ix.severity === 'major') && (
          <span className="ml-auto text-xs px-3 py-1 rounded-full border bg-red-500/20 text-red-400 border-red-500/30 flex items-center gap-1 animate-pulse">
            <AlertCircle className="w-3 h-3" /> Drug Interaction Warning
          </span>
        )}
      </motion.div>

      {/* Inventory Level Indicator */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="panel p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-400 flex items-center gap-1"><Package className="w-3 h-3" /> Inventory Overview</span>
        </div>
        <div className="flex gap-1 h-3 rounded-full overflow-hidden bg-zinc-800">
          {(() => {
            const total = Math.max(1, medications.length);
            const ready = medications.filter(m => m.status === 'active' && (m.refillsLeft || 0) > 1).length;
            const low = medications.filter(m => (m.refillsLeft || 0) === 1).length;
            const out = medications.filter(m => (m.refillsLeft || 0) <= 0 || m.status === 'discontinued').length;
            return (
              <>
                <div className="bg-green-500 transition-all" style={{ width: `${(ready / total) * 100}%` }} />
                <div className="bg-amber-500 transition-all" style={{ width: `${(low / total) * 100}%` }} />
                <div className="bg-red-500 transition-all" style={{ width: `${(out / total) * 100}%` }} />
              </>
            );
          })()}
        </div>
        <div className="flex items-center gap-4 mt-1">
          <span className="text-[10px] text-green-400 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> In Stock</span>
          <span className="text-[10px] text-amber-400 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Low</span>
          <span className="text-[10px] text-red-400 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Out</span>
        </div>
      </motion.div>

      <RealtimeDataPanel domain="pharmacy" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

      {/* ── Pharmacy Domain Action Panel ── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="panel space-y-4 p-4">
        <div className="flex items-center gap-2 mb-1">
          <Pill className="w-4 h-4 text-neon-green" />
          <h2 className="font-semibold text-sm">Pharmacy Analysis Engine</h2>
          <span className="text-xs text-gray-500 ml-auto">Interactions · Dosage · Inventory · Formulary</span>
        </div>
        <div className="bg-amber-500/10 border border-amber-500/20 rounded p-2 flex items-center gap-2 text-xs text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Informational only — always verify with a licensed pharmacist or physician.
        </div>

        {/* Buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { action: 'drugInteractionCheck', label: 'Interaction Check', setter: setInteractionResult, icon: AlertCircle, color: 'text-red-400' },
            { action: 'dosageCalculator', label: 'Dosage Calc', setter: setDosageResult, icon: Activity, color: 'text-neon-cyan' },
            { action: 'inventoryAlert', label: 'Inventory Alert', setter: setInventoryResult, icon: Package, color: 'text-yellow-400' },
            { action: 'formularySearch', label: 'Formulary Search', setter: setFormularyResult, icon: Search, color: 'text-neon-green' },
          ].map(({ action, label, setter, icon: Icon, color }) => (
            <button
              key={action}
              onClick={() => handlePharmAction(action, setter)}
              disabled={pharmActionRunning !== null}
              className={`px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs flex items-center gap-1.5 justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {pharmActionRunning === action
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Icon className={`w-3.5 h-3.5 ${color}`} />}
              {pharmActionRunning === action ? 'Running…' : label}
            </button>
          ))}
        </div>

        {/* Results */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Drug Interaction Result */}
          {interactionResult && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-red-400 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" /> Drug Interactions
                </span>
                {'severity' in interactionResult && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    String(interactionResult.severity) === 'critical' ? 'bg-red-600/30 text-red-300' :
                    String(interactionResult.severity) === 'high' ? 'bg-orange-500/20 text-orange-400' :
                    String(interactionResult.severity) === 'moderate' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-green-500/20 text-green-400'
                  }`}>
                    {String(interactionResult.severity)}
                  </span>
                )}
              </div>
              {'message' in interactionResult ? (
                <p className="text-xs text-gray-400">{String(interactionResult.message)}</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="lens-card text-center">
                      <p className="text-xs text-gray-500">Checked</p>
                      <p className="text-sm font-bold text-white">{String(interactionResult.medicationsChecked ?? 0)}</p>
                    </div>
                    <div className="lens-card text-center">
                      <p className="text-xs text-gray-500">Interactions</p>
                      <p className={`text-sm font-bold ${Number(interactionResult.interactionsFound) > 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {String(interactionResult.interactionsFound ?? 0)}
                      </p>
                    </div>
                  </div>
                  {Array.isArray(interactionResult.interactions) && (interactionResult.interactions as Array<Record<string, unknown>>).length > 0 && (
                    <div className="space-y-2">
                      {(interactionResult.interactions as Array<Record<string, unknown>>).map((ix, i) => (
                        <div key={i} className="rounded bg-white/5 p-2 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-red-300">{String(ix.drug1)}</span>
                            <span className="text-gray-600">+</span>
                            <span className="text-xs font-mono text-red-300">{String(ix.drug2)}</span>
                            <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${
                              String(ix.severity) === 'critical' ? 'bg-red-600/30 text-red-300' :
                              String(ix.severity) === 'high' ? 'bg-orange-500/20 text-orange-400' :
                              'bg-yellow-500/20 text-yellow-400'
                            }`}>{String(ix.severity)}</span>
                          </div>
                          <p className="text-xs text-gray-400">{String(ix.effect)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {Number(interactionResult.interactionsFound) === 0 && (
                    <div className="flex items-center gap-2 text-xs text-green-400">
                      <CheckCircle2 className="w-4 h-4" /> No known interactions found
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* Dosage Calculator Result */}
          {dosageResult && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-3">
              <span className="text-xs font-semibold text-neon-cyan uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" /> Dosage Calculator
              </span>
              {'message' in dosageResult ? (
                <p className="text-xs text-gray-400">{String(dosageResult.message)}</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Weight', value: `${String(dosageResult.weightKg)} kg` },
                      { label: 'Dose/kg', value: `${String(dosageResult.dosePerKg)} mg/kg` },
                      { label: 'Single Dose', value: String(dosageResult.singleDose) },
                      { label: 'Frequency', value: String(dosageResult.frequency) },
                    ].map(({ label, value }) => (
                      <div key={label} className="lens-card">
                        <p className="text-xs text-gray-500">{label}</p>
                        <p className="text-sm font-mono font-bold text-white">{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className={`rounded-lg p-3 flex items-center justify-between ${dosageResult.capped ? 'bg-orange-500/15 border border-orange-500/20' : 'bg-neon-cyan/10 border border-neon-cyan/20'}`}>
                    <span className="text-xs text-gray-400">Daily Total</span>
                    <span className={`text-base font-bold font-mono ${dosageResult.capped ? 'text-orange-400' : 'text-neon-cyan'}`}>
                      {String(dosageResult.dailyDose)}
                      {!!dosageResult.capped && <span className="text-xs ml-1 text-orange-300">(capped)</span>}
                    </span>
                  </div>
                  {'disclaimer' in dosageResult && (
                    <p className="text-[10px] text-gray-500 italic">{String(dosageResult.disclaimer)}</p>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* Inventory Alert Result */}
          {inventoryResult && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-yellow-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5" /> Inventory Alerts
                </span>
                {'allClear' in inventoryResult && (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${inventoryResult.allClear ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {inventoryResult.allClear ? 'All Clear' : 'Action Needed'}
                  </span>
                )}
              </div>
              {'message' in inventoryResult ? (
                <p className="text-xs text-gray-400">{String(inventoryResult.message)}</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Low Stock', value: String(inventoryResult.lowStock ?? 0), color: 'text-amber-400' },
                      { label: 'Expired', value: String(inventoryResult.expired ?? 0), color: 'text-red-400' },
                      { label: 'Near Expiry', value: String(inventoryResult.nearExpiry ?? 0), color: 'text-orange-400' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="lens-card text-center">
                        <p className="text-xs text-gray-500">{label}</p>
                        <p className={`text-sm font-bold ${color}`}>{value}</p>
                      </div>
                    ))}
                  </div>
                  {Array.isArray(inventoryResult.alerts) && (inventoryResult.alerts as Array<Record<string, unknown>>).length > 0 && (
                    <div className="space-y-1.5">
                      {(inventoryResult.alerts as Array<Record<string, unknown>>).map((alert, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs bg-white/5 rounded p-2">
                          <Package className="w-3 h-3 text-yellow-400 shrink-0" />
                          <span className="flex-1 text-gray-300">{String(alert.name)}</span>
                          {!!alert.expired && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400">Expired</span>}
                          {!!alert.nearExpiry && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400">{String(alert.daysToExpiry)}d</span>}
                          {!!alert.lowStock && !alert.expired && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">Low ({String(alert.quantity)})</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* Formulary Search Result */}
          {formularyResult && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-green-500/20 bg-green-500/5 p-4 space-y-3">
              <span className="text-xs font-semibold text-neon-green uppercase tracking-wider flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5" /> Formulary Search
              </span>
              {'message' in formularyResult ? (
                <p className="text-xs text-gray-400">{String(formularyResult.message)}</p>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>Query: <span className="text-white font-mono">{String(formularyResult.query)}</span></span>
                    <span className="ml-auto">{String(formularyResult.found)} / {String(formularyResult.formularySize)} found</span>
                  </div>
                  {Array.isArray(formularyResult.matches) && (formularyResult.matches as Array<Record<string, unknown>>).length > 0 ? (
                    <div className="space-y-1.5">
                      {(formularyResult.matches as Array<Record<string, unknown>>).slice(0, 10).map((m, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs bg-white/5 rounded p-2">
                          <ShieldCheck className={`w-3 h-3 shrink-0 ${m.covered ? 'text-green-400' : 'text-red-400'}`} />
                          <span className="flex-1 text-gray-300">{String(m.generic)}{m.brand ? ` (${String(m.brand)})` : ''}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-500/20 text-gray-400">Tier {String(m.tier)}</span>
                          {!!m.priorAuth && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400">PA</span>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500">No formulary matches found.</p>
                  )}
                </>
              )}
            </motion.div>
          )}
        </div>
      </motion.div>

      <UniversalActions domain="pharmacy" artifactId={undefined} compact />
      <DTUExportButton domain="pharmacy" data={{}} compact />

      {/* Search */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search medications..." className="w-full bg-black/30 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm" />
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-white/10 pb-2">
        {(['medications', 'interactions', 'refills'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
              activeTab === tab ? 'bg-neon-green/20 text-neon-green border-b-2 border-neon-green' : 'text-gray-400 hover:text-white'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Medications Tab */}
      {activeTab === 'medications' && (
        <div className="space-y-4">
          <div className="panel p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2"><Plus className="w-4 h-4" /> Add Medication</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <input value={newMed.name} onChange={e => setNewMed({ ...newMed, name: e.target.value })} placeholder="Medication name" className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm" />
              <input value={newMed.dosage} onChange={e => setNewMed({ ...newMed, dosage: e.target.value })} placeholder="Dosage (e.g., 10mg)" className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm" />
              <select value={newMed.frequency} onChange={e => setNewMed({ ...newMed, frequency: e.target.value })} className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm">
                <option value="daily">Daily</option>
                <option value="twice-daily">Twice Daily</option>
                <option value="weekly">Weekly</option>
                <option value="as-needed">As Needed</option>
              </select>
              <button onClick={addMedication} className="px-4 py-2 bg-neon-green/20 text-neon-green rounded-lg text-sm hover:bg-neon-green/30">Add</button>
            </div>
          </div>

          <div className="space-y-2">
            {medications.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-4">No medications tracked yet.</p>
            ) : (
              <AnimatePresence mode="popLayout">
              {medications.map((med, idx) => (
                <motion.div key={med.id} layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: idx * 0.04, duration: 0.3 }} className="panel p-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Pill className="w-4 h-4 text-neon-green" />
                      <span className="font-medium">{med.name || med.title}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${med.status === 'active' ? 'bg-green-500/20 text-green-400' : med.status === 'pending' ? 'bg-amber-500/20 text-amber-400' : 'bg-gray-500/20 text-gray-400'}`}>
                        {med.status === 'active' ? 'Ready' : med.status === 'pending' ? 'Processing' : med.status || 'active'}
                      </span>
                      {(med.refillsLeft || 0) <= 1 && med.status === 'active' && (
                        <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> Refill Needed
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{med.dosage} - {med.frequency} - {med.route}</p>
                  </div>
                  <button onClick={() => update(med.id, { data: { status: med.status === 'active' ? 'discontinued' : 'active' } })} className="text-xs px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-gray-400 mr-2">{med.status === 'active' ? 'Discontinue' : 'Reactivate'}</button>
                  <button onClick={() => remove(med.id)} className="text-gray-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                </motion.div>
              ))}
              </AnimatePresence>
            )}
          </div>
        </div>
      )}

      {/* Interactions Tab */}
      {activeTab === 'interactions' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <button onClick={checkInteractions} className="px-4 py-2 bg-amber-500/20 text-amber-400 rounded-lg text-sm hover:bg-amber-500/30">
              <AlertTriangle className="w-4 h-4 inline mr-1" /> Check Interactions
            </button>
            <button onClick={() => {
              const activeNames = medications.filter(m => m.status === 'active').map(m => m.name || m.title);
              if (activeNames.length >= 2) {
                createInteraction({ title: activeNames.join(' + '), data: { drugs: activeNames, severity: 'unknown', description: 'Manual interaction note - please verify with pharmacist' } });
              }
            }} className="px-4 py-2 bg-white/5 text-gray-400 rounded-lg text-sm hover:bg-white/10">
              <Plus className="w-4 h-4 inline mr-1" /> Add Note
            </button>
          </div>
          <div className="panel p-4">
            <h3 className="font-semibold mb-3">Known Interactions</h3>
            {interactions.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-4">No interaction checks performed yet.</p>
            ) : (
              interactions.map(ix => (
                <div key={ix.id} className="p-3 rounded-lg bg-white/5 mb-2">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className={`w-4 h-4 ${ix.severity === 'critical' ? 'text-red-400' : ix.severity === 'major' ? 'text-orange-400' : 'text-yellow-400'}`} />
                    <span className="text-sm font-medium">{ix.drugs?.join(' + ')}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400">{ix.severity}</span>
                  </div>
                  <p className="text-xs text-gray-400">{ix.description}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Refills Tab */}
      {activeTab === 'refills' && (
        <div className="panel p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Clock className="w-4 h-4 text-neon-cyan" /> Refill Tracker</h3>
          {medications.filter(m => m.status === 'active').length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">Add active medications to track refills.</p>
          ) : (
            <div className="space-y-2">
              {medications.filter(m => m.status === 'active').map(med => (
                <div key={med.id} className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                  <div>
                    <span className="text-sm font-medium">{med.name || med.title}</span>
                    <p className="text-xs text-gray-400">{med.dosage}</p>
                  </div>
                  <span className={`text-sm ${(med.refillsLeft || 0) <= 1 ? 'text-red-400' : 'text-green-400'}`}>
                    {med.refillsLeft ?? '?'} refills left
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" /> Lens Features & Capabilities</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="pharmacy" /></div>}
      </div>
    </div>
  );
}
