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
  Megaphone, Target, BarChart3, Users, Mail, Share2,
  Plus, Search, X, Trash2, TrendingUp, DollarSign, Eye, MousePointerClick, Globe,
  Layers, ChevronDown,
  PenTool, Zap,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ModeTab = 'campaigns' | 'content' | 'analytics' | 'audiences' | 'email' | 'social' | 'seo';
type ArtifactType = 'Campaign' | 'Content' | 'Analytic' | 'Audience' | 'EmailTemplate' | 'SocialPost' | 'SEOAudit';
type Status = 'draft' | 'active' | 'paused' | 'completed' | 'scheduled' | 'archived';

interface MarketingArtifact {
  name: string;
  type: ArtifactType;
  status: Status;
  description: string;
  notes: string;
  // Campaign
  budget?: number;
  spent?: number;
  startDate?: string;
  endDate?: string;
  channel?: string;
  impressions?: number;
  clicks?: number;
  conversions?: number;
  roi?: number;
  targetAudience?: string;
  // Content
  contentType?: string;
  author?: string;
  publishDate?: string;
  platform?: string;
  engagementRate?: number;
  // Analytics
  metric?: string;
  value?: number;
  period?: string;
  trend?: 'up' | 'down' | 'flat';
  // Audience
  segmentName?: string;
  segmentSize?: number;
  demographics?: string;
  // Email
  subject?: string;
  openRate?: number;
  clickRate?: number;
  listSize?: number;
  // Social
  socialPlatform?: string;
  likes?: number;
  shares?: number;
  comments?: number;
  // SEO
  keyword?: string;
  ranking?: number;
  searchVolume?: number;
  difficulty?: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MODE_TABS: { id: ModeTab; label: string; icon: typeof Megaphone; artifactType: ArtifactType }[] = [
  { id: 'campaigns', label: 'Campaigns', icon: Megaphone, artifactType: 'Campaign' },
  { id: 'content', label: 'Content', icon: PenTool, artifactType: 'Content' },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, artifactType: 'Analytic' },
  { id: 'audiences', label: 'Audiences', icon: Users, artifactType: 'Audience' },
  { id: 'email', label: 'Email', icon: Mail, artifactType: 'EmailTemplate' },
  { id: 'social', label: 'Social', icon: Share2, artifactType: 'SocialPost' },
  { id: 'seo', label: 'SEO', icon: Globe, artifactType: 'SEOAudit' },
];

const STATUS_CONFIG: Record<Status, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'gray-400' },
  active: { label: 'Active', color: 'green-400' },
  paused: { label: 'Paused', color: 'yellow-400' },
  completed: { label: 'Completed', color: 'blue-400' },
  scheduled: { label: 'Scheduled', color: 'purple-400' },
  archived: { label: 'Archived', color: 'gray-500' },
};

const CHANNELS = ['Email', 'Social Media', 'PPC', 'SEO', 'Content Marketing', 'Influencer', 'Display', 'Video', 'Affiliate'];
const PLATFORMS = ['Instagram', 'Twitter/X', 'LinkedIn', 'Facebook', 'TikTok', 'YouTube', 'Pinterest'];
const CONTENT_TYPES = ['Blog Post', 'Video', 'Infographic', 'Whitepaper', 'Case Study', 'Webinar', 'Podcast', 'Newsletter'];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function MarketingLensPage() {
  useLensNav('marketing');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('marketing');

  const [activeTab, setActiveTab] = useState<ModeTab>('campaigns');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<Status | 'all'>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LensItem<MarketingArtifact> | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStatus, setFormStatus] = useState<Status>('draft');
  const [formNotes, setFormNotes] = useState('');
  const [formBudget, setFormBudget] = useState('');
  const [formChannel, setFormChannel] = useState('Email');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formTargetAudience, setFormTargetAudience] = useState('');
  const [formSubject, setFormSubject] = useState('');
  const [formPlatform, setFormPlatform] = useState('Instagram');
  const [formKeyword, setFormKeyword] = useState('');
  const [formContentType, setFormContentType] = useState('Blog Post');

  const activeArtifactType = MODE_TABS.find(t => t.id === activeTab)?.artifactType || 'Campaign';

  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<MarketingArtifact>('marketing', activeArtifactType, { seed: [] });
  const runAction = useRunArtifact('marketing');

  const filtered = useMemo(() => {
    let result = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(i => i.title.toLowerCase().includes(q) || (i.data as unknown as MarketingArtifact).description?.toLowerCase().includes(q));
    }
    if (filterStatus !== 'all') {
      result = result.filter(i => (i.data as unknown as MarketingArtifact).status === filterStatus);
    }
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

  const openCreate =() => {
    setEditingItem(null);
    setFormName(''); setFormDescription(''); setFormStatus('draft'); setFormNotes('');
    setFormBudget(''); setFormChannel('Email'); setFormStartDate(''); setFormEndDate('');
    setFormTargetAudience(''); setFormSubject(''); setFormPlatform('Instagram');
    setFormKeyword(''); setFormContentType('Blog Post');
    setEditorOpen(true);
  };

  const openEdit = (item: LensItem<MarketingArtifact>) => {
    const d = item.data as unknown as MarketingArtifact;
    setEditingItem(item);
    setFormName(d.name || ''); setFormDescription(d.description || ''); setFormStatus(d.status || 'draft'); setFormNotes(d.notes || '');
    setFormBudget(d.budget?.toString() || ''); setFormChannel(d.channel || 'Email');
    setFormStartDate(d.startDate || ''); setFormEndDate(d.endDate || '');
    setFormTargetAudience(d.targetAudience || ''); setFormSubject(d.subject || '');
    setFormPlatform(d.socialPlatform || d.platform || 'Instagram');
    setFormKeyword(d.keyword || ''); setFormContentType(d.contentType || 'Blog Post');
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const data: Record<string, unknown> = {
      name: formName, type: activeArtifactType, status: formStatus, description: formDescription, notes: formNotes,
      budget: formBudget ? parseFloat(formBudget) : undefined,
      channel: formChannel, startDate: formStartDate, endDate: formEndDate,
      targetAudience: formTargetAudience, subject: formSubject,
      socialPlatform: formPlatform, platform: formPlatform,
      keyword: formKeyword, contentType: formContentType,
    };
    if (editingItem) {
      await update(editingItem.id, { title: formName, data, meta: { tags: [], status: formStatus, visibility: 'private' } });
    } else {
      await create({ title: formName, data, meta: { tags: [], status: formStatus, visibility: 'private' } });
    }
    setEditorOpen(false);
  };

  if (isError) return <ErrorState error={error?.message} onRetry={refetch} />;

  /* ------------------------------------------------------------------ */
  /*  Dashboard                                                          */
  /* ------------------------------------------------------------------ */

  const renderDashboard = () => {
    const campaigns = items.map(i => i.data as unknown as MarketingArtifact);
    const totalBudget = campaigns.reduce((s, c) => s + (c.budget || 0), 0);
    const totalSpent = campaigns.reduce((s, c) => s + (c.spent || 0), 0);
    const totalImpressions = campaigns.reduce((s, c) => s + (c.impressions || 0), 0);
    const totalConversions = campaigns.reduce((s, c) => s + (c.conversions || 0), 0);

    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={ds.panel}>
          <DollarSign className="w-5 h-5 text-green-400 mb-2" />
          <p className={ds.textMuted}>Total Budget</p>
          <p className="text-xl font-bold text-white">${totalBudget.toLocaleString()}</p>
        </div>
        <div className={ds.panel}>
          <TrendingUp className="w-5 h-5 text-blue-400 mb-2" />
          <p className={ds.textMuted}>Spent</p>
          <p className="text-xl font-bold text-white">${totalSpent.toLocaleString()}</p>
        </div>
        <div className={ds.panel}>
          <Eye className="w-5 h-5 text-purple-400 mb-2" />
          <p className={ds.textMuted}>Impressions</p>
          <p className="text-xl font-bold text-white">{totalImpressions.toLocaleString()}</p>
        </div>
        <div className={ds.panel}>
          <MousePointerClick className="w-5 h-5 text-cyan-400 mb-2" />
          <p className={ds.textMuted}>Conversions</p>
          <p className="text-xl font-bold text-white">{totalConversions.toLocaleString()}</p>
        </div>
      </div>
    );
  };

  /* ------------------------------------------------------------------ */
  /*  Editor                                                             */
  /* ------------------------------------------------------------------ */

  const renderEditor = () => {
    if (!editorOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setEditorOpen(false)}>
        <div className={cn(ds.panel, 'w-full max-w-lg max-h-[85vh] overflow-y-auto')} onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <h3 className={ds.heading3}>{editingItem ? 'Edit' : 'New'} {activeArtifactType}</h3>
            <button onClick={() => setEditorOpen(false)} className={ds.btnGhost}><X className="w-4 h-4" /></button>
          </div>
          <div className="space-y-3">
            <div><label className={ds.label}>Name</label><input className={ds.input} value={formName} onChange={e => setFormName(e.target.value)} placeholder="Enter name..." /></div>
            <div><label className={ds.label}>Description</label><textarea className={ds.textarea} rows={2} value={formDescription} onChange={e => setFormDescription(e.target.value)} /></div>
            <div><label className={ds.label}>Status</label>
              <select className={ds.select} value={formStatus} onChange={e => setFormStatus(e.target.value as Status)}>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            {activeArtifactType === 'Campaign' && (
              <>
                <div><label className={ds.label}>Budget</label><input type="number" className={ds.input} value={formBudget} onChange={e => setFormBudget(e.target.value)} /></div>
                <div><label className={ds.label}>Channel</label>
                  <select className={ds.select} value={formChannel} onChange={e => setFormChannel(e.target.value)}>
                    {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={ds.label}>Start Date</label><input type="date" className={ds.input} value={formStartDate} onChange={e => setFormStartDate(e.target.value)} /></div>
                  <div><label className={ds.label}>End Date</label><input type="date" className={ds.input} value={formEndDate} onChange={e => setFormEndDate(e.target.value)} /></div>
                </div>
                <div><label className={ds.label}>Target Audience</label><input className={ds.input} value={formTargetAudience} onChange={e => setFormTargetAudience(e.target.value)} /></div>
              </>
            )}
            {activeArtifactType === 'Content' && (
              <div><label className={ds.label}>Content Type</label>
                <select className={ds.select} value={formContentType} onChange={e => setFormContentType(e.target.value)}>
                  {CONTENT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            {activeArtifactType === 'EmailTemplate' && (
              <div><label className={ds.label}>Subject Line</label><input className={ds.input} value={formSubject} onChange={e => setFormSubject(e.target.value)} /></div>
            )}
            {activeArtifactType === 'SocialPost' && (
              <div><label className={ds.label}>Platform</label>
                <select className={ds.select} value={formPlatform} onChange={e => setFormPlatform(e.target.value)}>
                  {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            )}
            {activeArtifactType === 'SEOAudit' && (
              <div><label className={ds.label}>Target Keyword</label><input className={ds.input} value={formKeyword} onChange={e => setFormKeyword(e.target.value)} /></div>
            )}
            {activeArtifactType === 'Analytic' && (
              <>
                <div><label className={ds.label}>Target Keyword / Metric</label><input className={ds.input} value={formKeyword} onChange={e => setFormKeyword(e.target.value)} placeholder="CTR, ROAS, Conversion Rate..." /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={ds.label}>Start Date</label><input type="date" className={ds.input} value={formStartDate} onChange={e => setFormStartDate(e.target.value)} /></div>
                  <div><label className={ds.label}>End Date</label><input type="date" className={ds.input} value={formEndDate} onChange={e => setFormEndDate(e.target.value)} /></div>
                </div>
                <div><label className={ds.label}>Channel</label>
                  <select className={ds.select} value={formChannel} onChange={e => setFormChannel(e.target.value)}>
                    {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </>
            )}
            {activeArtifactType === 'Audience' && (
              <>
                <div><label className={ds.label}>Audience Segment</label><input className={ds.input} value={formTargetAudience} onChange={e => setFormTargetAudience(e.target.value)} placeholder="Young professionals, Parents 25-40..." /></div>
                <div><label className={ds.label}>Channel</label>
                  <select className={ds.select} value={formChannel} onChange={e => setFormChannel(e.target.value)}>
                    {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </>
            )}
            <div><label className={ds.label}>Notes</label><textarea className={ds.textarea} rows={2} value={formNotes} onChange={e => setFormNotes(e.target.value)} /></div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setEditorOpen(false)} className={ds.btnSecondary}>Cancel</button>
            <button onClick={handleSave} className={ds.btnPrimary} disabled={!formName.trim()}>Save</button>
          </div>
        </div>
      </div>
    );
  };

  /* ------------------------------------------------------------------ */
  /*  Library                                                            */
  /* ------------------------------------------------------------------ */

  const renderLibrary = () => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input className={cn(ds.input, 'pl-10')} placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        </div>
        <select className={cn(ds.select, 'w-auto')} value={filterStatus} onChange={e => setFilterStatus(e.target.value as Status | 'all')}>
          <option value="all">All Status</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button onClick={openCreate} className={ds.btnPrimary}><Plus className="w-4 h-4" /> New</button>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-neon-blue border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className={cn(ds.panel, 'text-center py-12')}>
          <Megaphone className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className={ds.textMuted}>No {activeArtifactType} items yet</p>
          <button onClick={openCreate} className={cn(ds.btnPrimary, 'mt-3')}><Plus className="w-4 h-4" /> Create First</button>
        </div>
      ) : (
        filtered.map((item, idx) => {
          const d = item.data as unknown as MarketingArtifact;
          const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.draft;
          return (
            <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }} className={ds.panelHover} onClick={() => openEdit(item)}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Megaphone className="w-5 h-5 text-neon-cyan" />
                  <div>
                    <p className="text-white font-medium">{d.name || item.title}</p>
                    <p className={ds.textMuted}>{d.description?.slice(0, 80)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {d.budget && <span className="text-xs text-green-400">${d.budget.toLocaleString()}</span>}
                  <span className={`text-xs px-2 py-0.5 rounded-full bg-${sc.color}/20 text-${sc.color}`}>{sc.label}</span>
                  <button onClick={e => { e.stopPropagation(); handleAction('analyze', item.id); }} className={ds.btnGhost}><Zap className="w-4 h-4 text-neon-cyan" /></button>
                  <button onClick={e => { e.stopPropagation(); remove(item.id); }} className={ds.btnGhost}><Trash2 className="w-4 h-4 text-red-400" /></button>
                </div>
              </div>
            </motion.div>
          );
        })
      )}
    </div>
  );

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  return (
    <div data-lens-theme="marketing" className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center">
            <Megaphone className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className={ds.heading1}>Marketing</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className={ds.textMuted}>Campaigns, content, analytics, audiences, email, social, and SEO</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {runAction.isPending && <span className="text-xs text-neon-cyan animate-pulse">AI processing...</span>}
          <DTUExportButton domain="marketing" data={{}} compact />
          <button onClick={() => setShowDashboard(!showDashboard)} className={cn(showDashboard ? ds.btnPrimary : ds.btnSecondary)}>
            <BarChart3 className="w-4 h-4" /> Dashboard
          </button>
        </div>
      </header>

      <RealtimeDataPanel domain="marketing" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <UniversalActions domain="marketing" artifactId={items[0]?.id} compact />

      {/* Stat Cards */}
      {(() => {
        const allCampaigns = items.map(i => i.data as unknown as MarketingArtifact);
        const totalBudget = allCampaigns.reduce((s, c) => s + (c.budget || 0), 0);
        const totalImpressions = allCampaigns.reduce((s, c) => s + (c.impressions || 0), 0);
        const totalClicks = allCampaigns.reduce((s, c) => s + (c.clicks || 0), 0);
        const totalConversions = allCampaigns.reduce((s, c) => s + (c.conversions || 0), 0);
        const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions * 100) : 0;
        const convRate = totalClicks > 0 ? (totalConversions / totalClicks * 100) : 0;
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: DollarSign, label: 'Total Budget', value: `$${totalBudget.toLocaleString()}`, color: 'text-green-400' },
              { icon: Eye, label: 'Impressions', value: totalImpressions.toLocaleString(), color: 'text-purple-400' },
              { icon: MousePointerClick, label: 'CTR', value: `${ctr.toFixed(2)}%`, color: 'text-cyan-400' },
              { icon: Target, label: 'Conv. Rate', value: `${convRate.toFixed(2)}%`, color: 'text-pink-400' },
            ].map((stat, i) => (
              <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className={ds.panel}>
                <stat.icon className={`w-5 h-5 ${stat.color} mb-2`} />
                <p className={ds.textMuted}>{stat.label}</p>
                <p className="text-xl font-bold text-white">{stat.value}</p>
              </motion.div>
            ))}
          </div>
        );
      })()}

      {/* Channel Distribution Bar */}
      {(() => {
        const allCampaigns = items.map(i => i.data as unknown as MarketingArtifact);
        const channelMap = new Map<string, number>();
        allCampaigns.forEach(c => { if (c.channel) channelMap.set(c.channel, (channelMap.get(c.channel) || 0) + 1); });
        const total = allCampaigns.length || 1;
        const channelColors: Record<string, string> = { 'Social Media': 'bg-blue-500', Email: 'bg-green-500', PPC: 'bg-amber-500', SEO: 'bg-purple-500', 'Content Marketing': 'bg-pink-500', Influencer: 'bg-cyan-500', Display: 'bg-orange-500', Video: 'bg-red-500', Affiliate: 'bg-teal-500' };
        if (channelMap.size === 0) return null;
        return (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className={ds.panel}>
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-pink-400" /> Channel Distribution</h3>
            <div className="h-5 rounded-full overflow-hidden flex">
              {Array.from(channelMap.entries()).map(([ch, count]) => (
                <div key={ch} className={`${channelColors[ch] || 'bg-gray-500'} h-full relative group`} style={{ width: `${(count / total) * 100}%` }} title={`${ch}: ${count}`}>
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white/80 opacity-0 group-hover:opacity-100 transition-opacity">{ch}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 mt-2">
              {Array.from(channelMap.entries()).map(([ch, count]) => (
                <span key={ch} className="flex items-center gap-1 text-xs text-gray-400">
                  <span className={`w-2 h-2 rounded-full ${channelColors[ch] || 'bg-gray-500'}`} />{ch} ({count})
                </span>
              ))}
            </div>
          </motion.div>
        );
      })()}

      <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">
        {MODE_TABS.map(tab => (
          <button key={tab.id} onClick={() => { setActiveTab(tab.id); setShowDashboard(false); }}
            className={cn('flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap',
              activeTab === tab.id && !showDashboard ? 'bg-neon-blue/20 text-neon-blue' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated')}>
            <tab.icon className="w-4 h-4" />{tab.label}
          </button>
        ))}
      </nav>

      {showDashboard ? renderDashboard() : renderLibrary()}
      {renderEditor()}

      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" />Lens Features & Capabilities</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="marketing" /></div>}
      </div>
    </div>
  );
}
