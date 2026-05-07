'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Baby, Plus, Search, Trash2, Calendar, Heart, Clock, Layers, ChevronDown, Milestone, NotebookPen, Loader2, BookOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

type Tab = 'milestones' | 'schedules' | 'health' | 'activities';

interface MilestoneData {
  childName: string;
  title: string;
  category: 'physical' | 'cognitive' | 'social' | 'language' | 'health';
  date: string;
  age: string;
  description: string;
  notes: string;
}

const CAT_COLORS: Record<string, string> = {
  physical: 'text-neon-green bg-neon-green/10',
  cognitive: 'text-neon-cyan bg-neon-cyan/10',
  social: 'text-neon-purple bg-neon-purple/10',
  language: 'text-yellow-400 bg-yellow-400/10',
  health: 'text-red-400 bg-red-400/10',
};

export default function ParentingLensPage() {
  useLensNav('parenting');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('parenting');
  const [tab, setTab] = useState<Tab>('milestones');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);
  const [newMilestone, setNewMilestone] = useState({ childName: '', title: '', category: 'physical' as 'physical' | 'cognitive' | 'social' | 'language' | 'health', date: '' });

  const {
    items, isLoading, isError, error, refetch,
    create, createMut, remove, deleteMut,
  } = useLensData<MilestoneData>('parenting', 'milestone', { seed: [] });

  const milestones = useMemo(() =>
    items.map(item => ({ id: item.id, ...item.data, title: item.title || item.data?.title || 'Untitled' }))
      .filter(m => !search || m.title?.toLowerCase().includes(search.toLowerCase()) || m.childName?.toLowerCase().includes(search.toLowerCase())),
    [items, search]
  );

  const stats = useMemo(() => {
    const children = [...new Set(milestones.map(m => m.childName).filter(Boolean))];
    return {
      total: milestones.length,
      children: children.length,
      thisMonth: milestones.filter(m => {
        if (!m.date) return false;
        const d = new Date(m.date);
        const now = new Date();
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      }).length,
      categories: [...new Set(milestones.map(m => m.category).filter(Boolean))].length,
    };
  }, [milestones]);

  const handleCreate = useCallback(async () => {
    if (!newMilestone.title.trim()) return;
    await create({
      title: newMilestone.title,
      data: {
        childName: newMilestone.childName, title: newMilestone.title,
        category: newMilestone.category, date: newMilestone.date || new Date().toISOString().split('T')[0],
        age: '', description: '', notes: '',
      },
    });
    setNewMilestone({ childName: '', title: '', category: 'physical', date: '' });
    setShowCreate(false);
  }, [newMilestone, create]);

  if (isError) return <div className="flex items-center justify-center h-full p-8"><ErrorState error={error?.message} onRetry={refetch} /></div>;

  return (
    <div data-lens-theme="parenting" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Baby className="w-6 h-6 text-pink-400" />
          <div>
            <h1 className="text-xl font-bold">Parenting Lens</h1>
            <p className="text-sm text-gray-400">Milestones, schedules & family</p>
          </div>
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="parenting" data={realtimeData || {}} compact />
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-neon purple">
          <Plus className="w-4 h-4 mr-2 inline" /> Add Milestone
        </button>
      </header>

      <UniversalActions domain="parenting" artifactId={items[0]?.id} compact />

      {showCreate && (
        <div className="panel p-4 space-y-3">
          <h3 className="font-semibold">Record Milestone</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input value={newMilestone.childName} onChange={e => setNewMilestone(p => ({ ...p, childName: e.target.value }))} placeholder="Child's name..." className="input-lattice" />
            <input value={newMilestone.title} onChange={e => setNewMilestone(p => ({ ...p, title: e.target.value }))} placeholder="Milestone (e.g. First steps)..." className="input-lattice" />
            <select value={newMilestone.category} onChange={e => setNewMilestone(p => ({ ...p, category: e.target.value as MilestoneData['category'] }))} className="input-lattice">
              <option value="physical">Physical</option><option value="cognitive">Cognitive</option>
              <option value="social">Social</option><option value="language">Language</option><option value="health">Health</option>
            </select>
            <input type="date" value={newMilestone.date} onChange={e => setNewMilestone(p => ({ ...p, date: e.target.value }))} className="input-lattice" />
          </div>
          <button onClick={handleCreate} disabled={createMut.isPending || !newMilestone.title.trim()} className="btn-neon green w-full">
            {createMut.isPending ? 'Saving...' : 'Save Milestone'}
          </button>
        </div>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="lens-card"><Milestone className="w-5 h-5 text-pink-400 mb-2" /><p className="text-2xl font-bold">{stats.total}</p><p className="text-sm text-gray-400">Milestones Tracked</p></div>
        <div className="lens-card"><Clock className="w-5 h-5 text-neon-cyan mb-2" /><p className="text-2xl font-bold">{stats.thisMonth}</p><p className="text-sm text-gray-400">Routines</p></div>
        <div className="lens-card"><NotebookPen className="w-5 h-5 text-neon-green mb-2" /><p className="text-2xl font-bold">{stats.children}</p><p className="text-sm text-gray-400">Resources Saved</p></div>
        <div className="lens-card"><Heart className="w-5 h-5 text-red-400 mb-2" /><p className="text-2xl font-bold">{stats.categories}</p><p className="text-sm text-gray-400">Categories</p></div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-lattice-surface p-1 rounded-lg border border-lattice-border">
        {([
          { key: 'milestones' as Tab, label: 'Milestones', icon: Milestone },
          { key: 'schedules' as Tab, label: 'Schedules', icon: Clock },
          { key: 'health' as Tab, label: 'Health', icon: Heart },
          { key: 'activities' as Tab, label: 'Activities', icon: BookOpen },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn('flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1 justify-center',
              tab === t.key ? 'bg-pink-500/20 text-pink-400' : 'text-gray-400 hover:text-white hover:bg-white/5')}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search milestones..." className="w-full bg-lattice-void border border-lattice-border rounded-lg pl-9 pr-3 py-2 text-sm" />
      </div>

      <div className="space-y-3">
        {isLoading ? (
          <div className="panel p-6 text-center text-gray-400">Loading milestones...</div>
        ) : milestones.length === 0 ? (
          <div className="panel p-6 text-center text-gray-400">No milestones recorded yet.</div>
        ) : milestones.map((m, index) => (
          <motion.div key={m.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="panel p-4 flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-white truncate">{m.title}</h3>
                <span className={cn('text-xs px-2 py-0.5 rounded', CAT_COLORS[m.category || 'physical'])}>{m.category}</span>
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-400">
                {m.childName && <span className="flex items-center gap-1"><Baby className="w-3 h-3" />{m.childName}</span>}
                {m.date && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{m.date}</span>}
              </div>
            </div>
            <button onClick={() => remove(m.id)} disabled={deleteMut.isPending} className="text-gray-500 hover:text-red-400 p-1">{deleteMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}</button>
          </motion.div>
        ))}
      </div>

      <RealtimeDataPanel domain="parenting" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" />Lens Features & Capabilities</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', showFeatures && 'rotate-180')} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="parenting" /></div>}
      </div>
    </div>
  );
}
