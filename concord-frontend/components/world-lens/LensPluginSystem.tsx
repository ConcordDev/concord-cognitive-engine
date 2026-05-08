'use client';

import React, { useState } from 'react';

type WidgetType = 'data-feed' | 'search-terminal' | 'visualization' | 'control-panel';
type PluginCategory = 'Science' | 'Engineering' | 'Economics' | 'Social' | 'Entertainment' | 'Education';
type PluginStatus = 'draft' | 'in review' | 'published';

interface ActiveWidget {
  id: string;
  type: WidgetType;
  lensId: string;
  lensName: string;
  surface: string;
  refreshInterval: number;
  size: 'small' | 'medium' | 'large';
  previewData?: string;
}

interface MarketplacePlugin {
  id: string;
  name: string;
  creator: string;
  description: string;
  category: PluginCategory;
  citations: number;
  downloads: number;
  rating: number;
  status: PluginStatus;
  royaltyRate?: number;
  installed?: boolean;
}

interface InstalledPlugin {
  id: string;
  name: string;
  creator: string;
  category: PluginCategory;
  version: string;
}

interface LensPluginSystemProps {
  installedPlugins: InstalledPlugin[];
  marketplace: MarketplacePlugin[];
  activeWidgets: ActiveWidget[];
  onInstall?: (pluginId: string) => void;
  onPlaceWidget?: (lensId: string, widgetType: WidgetType, surface: string) => void;
  onCreate?: (schema: Record<string, unknown>) => void;
}

const WIDGET_TYPES: Record<WidgetType, { label: string; icon: string; desc: string }> = {
  'data-feed': { label: 'Data Feed', icon: '📊', desc: 'Live streaming data display' },
  'search-terminal': { label: 'Search Terminal', icon: '🔍', desc: 'In-world search interface' },
  'visualization': { label: 'Visualization', icon: '📈', desc: '3D data visualization' },
  'control-panel': { label: 'Control Panel', icon: '🎛️', desc: 'Interactive controls' },
};

const PLUGIN_CATEGORIES: PluginCategory[] = ['Science', 'Engineering', 'Economics', 'Social', 'Entertainment', 'Education'];

const STATUS_STYLES: Record<PluginStatus, { color: string; bg: string }> = {
  draft: { color: 'text-gray-400', bg: 'bg-gray-500/20' },
  'in review': { color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  published: { color: 'text-green-400', bg: 'bg-green-500/20' },
};

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <span
          key={star}
          className={`text-xs ${star <= Math.round(rating) ? 'text-amber-400' : 'text-white/20'}`}
        >
          ★
        </span>
      ))}
    </div>
  );
}

export default function LensPluginSystem({
  installedPlugins,
  marketplace,
  activeWidgets,
  onInstall,
  onPlaceWidget,
  onCreate,
}: LensPluginSystemProps) {
  const [activeTab, setActiveTab] = useState<'widgets' | 'marketplace' | 'installed' | 'create'>('widgets');
  const [selectedCategory, setSelectedCategory] = useState<PluginCategory | 'All'>('All');
  const [selectedWidgetType, setSelectedWidgetType] = useState<WidgetType>('data-feed');
  const [placementSurface, setPlacementSurface] = useState('north-wall');
  const [selectedLens, setSelectedLens] = useState('');

  // Widget config
  const [widgetRefreshInterval, setWidgetRefreshInterval] = useState(30);
  const [widgetSize, setWidgetSize] = useState<'small' | 'medium' | 'large'>('medium');

  // Schema builder
  const [schemaName, setSchemaName] = useState('');
  const [schemaDesc, setSchemaDesc] = useState('');
  const [schemaCategory, setSchemaCategory] = useState<PluginCategory>('Science');
  const [schemaFields, setSchemaFields] = useState<{ name: string; type: string }[]>([
    { name: 'dataSource', type: 'string' },
  ]);

  const panelStyle = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

  const filteredMarketplace = selectedCategory === 'All'
    ? marketplace
    : marketplace.filter((p) => p.category === selectedCategory);

  const handleAddSchemaField = () => {
    setSchemaFields([...schemaFields, { name: '', type: 'string' }]);
  };

  const handleUpdateSchemaField = (index: number, key: 'name' | 'type', value: string) => {
    const updated = [...schemaFields];
    updated[index] = { ...updated[index], [key]: value };
    setSchemaFields(updated);
  };

  const handleRemoveSchemaField = (index: number) => {
    setSchemaFields(schemaFields.filter((_, i) => i !== index));
  };

  const handleCreateLens = () => {
    onCreate?.({
      name: schemaName,
      description: schemaDesc,
      category: schemaCategory,
      fields: schemaFields,
    });
  };

  return (
    <div className="flex flex-col gap-4 w-full max-w-5xl">
      {/* Header */}
      <div className={`${panelStyle} p-4`}>
        <h2 className="text-lg font-bold text-white">Lens Plugin System</h2>
        <p className="text-sm text-white/50">Place widgets, browse lenses, and create your own</p>
      </div>

      {/* Tab Navigation */}
      <div className={`${panelStyle} p-1.5 flex gap-1`}>
        {([
          { key: 'widgets', label: 'Widget Placement' },
          { key: 'marketplace', label: 'Marketplace' },
          { key: 'installed', label: 'Installed' },
          { key: 'create', label: 'Create Your Own' },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex-1 px-3 py-2 rounded text-sm font-medium transition-all ${
              activeTab === key
                ? 'bg-cyan-400/15 text-cyan-300 border border-cyan-400/40'
                : 'text-white/50 hover:text-white/70 border border-transparent'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Widget Placement Tab */}
      {activeTab === 'widgets' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Place Widget */}
          <div className={`${panelStyle} p-4 flex flex-col gap-4`}>
            <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Place Widget</h3>

            {/* Select Lens */}
            <div>
              <label className="text-xs text-white/50">Select Lens</label>
              <select
                value={selectedLens}
                onChange={(e) => setSelectedLens(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded bg-white/5 border border-white/10 text-white text-sm"
              >
                <option value="">Choose a lens...</option>
                {installedPlugins.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* Widget Type */}
            <div>
              <label className="text-xs text-white/50">Widget Type</label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {(Object.keys(WIDGET_TYPES) as WidgetType[]).map((wt) => (
                  <button
                    key={wt}
                    onClick={() => setSelectedWidgetType(wt)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      selectedWidgetType === wt
                        ? 'border-cyan-400/60 bg-cyan-400/10'
                        : 'border-white/10 bg-white/5 hover:border-white/20'
                    }`}
                  >
                    <div className="text-lg">{WIDGET_TYPES[wt].icon}</div>
                    <p className="text-xs text-white/80 font-medium mt-1">{WIDGET_TYPES[wt].label}</p>
                    <p className="text-[10px] text-white/40">{WIDGET_TYPES[wt].desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Surface */}
            <div>
              <label className="text-xs text-white/50">Building Surface</label>
              <select
                value={placementSurface}
                onChange={(e) => setPlacementSurface(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded bg-white/5 border border-white/10 text-white text-sm"
              >
                <option value="north-wall">North Wall</option>
                <option value="south-wall">South Wall</option>
                <option value="east-wall">East Wall</option>
                <option value="west-wall">West Wall</option>
                <option value="roof">Roof</option>
                <option value="interior">Interior</option>
              </select>
            </div>

            {/* Widget Config */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-white/50">Refresh (sec)</label>
                <input
                  type="number"
                  value={widgetRefreshInterval}
                  onChange={(e) => setWidgetRefreshInterval(Number(e.target.value))}
                  min={5}
                  className="w-full mt-1 px-3 py-2 rounded bg-white/5 border border-white/10 text-white text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-white/50">Size</label>
                <select
                  value={widgetSize}
                  onChange={(e) => setWidgetSize(e.target.value as 'small' | 'medium' | 'large')}
                  className="w-full mt-1 px-3 py-2 rounded bg-white/5 border border-white/10 text-white text-sm"
                >
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
              </div>
            </div>

            <button
              onClick={() => onPlaceWidget?.(selectedLens, selectedWidgetType, placementSurface)}
              disabled={!selectedLens}
              className="w-full py-2.5 rounded-lg font-semibold text-sm bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-400 hover:to-blue-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Place Widget
            </button>
          </div>

          {/* Active Widgets */}
          <div className={`${panelStyle} p-4 flex flex-col gap-3`}>
            <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">
              Active Widgets ({activeWidgets.length})
            </h3>
            {activeWidgets.length === 0 ? (
              <div className="text-center py-8 text-white/30 text-sm">
                No active widgets. Place one to get started.
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
                {activeWidgets.map((widget) => (
                  <div
                    key={widget.id}
                    className="p-3 rounded-lg bg-white/5 border border-white/10 flex items-start gap-3"
                  >
                    <div className="text-xl">{WIDGET_TYPES[widget.type]?.icon ?? '📦'}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-white/80 font-medium">{WIDGET_TYPES[widget.type]?.label}</p>
                        <span className="text-[10px] text-white/30">{widget.surface}</span>
                      </div>
                      <p className="text-xs text-white/40">Lens: {widget.lensName}</p>
                      <p className="text-xs text-white/30">Refresh: {widget.refreshInterval}s | Size: {widget.size}</p>
                      {widget.previewData && (
                        <div className="mt-2 p-2 rounded bg-black/40 border border-white/5">
                          <p className="text-[10px] text-cyan-300/70 font-mono">{widget.previewData}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Marketplace Tab */}
      {activeTab === 'marketplace' && (
        <div className="flex flex-col gap-4">
          {/* Category Filter */}
          <div className={`${panelStyle} p-2 flex gap-1 overflow-x-auto`}>
            <button
              onClick={() => setSelectedCategory('All')}
              className={`px-3 py-1.5 rounded text-xs whitespace-nowrap transition-all ${
                selectedCategory === 'All'
                  ? 'bg-cyan-400/15 text-cyan-300 border border-cyan-400/40'
                  : 'text-white/50 hover:text-white/70 border border-transparent'
              }`}
            >
              All
            </button>
            {PLUGIN_CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded text-xs whitespace-nowrap transition-all ${
                  selectedCategory === cat
                    ? 'bg-cyan-400/15 text-cyan-300 border border-cyan-400/40'
                    : 'text-white/50 hover:text-white/70 border border-transparent'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Plugin Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredMarketplace.map((plugin) => (
              <div key={plugin.id} className={`${panelStyle} p-4 flex flex-col gap-2`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{plugin.name}</p>
                    <p className="text-xs text-white/40">by {plugin.creator}</p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_STYLES[plugin.status].bg} ${STATUS_STYLES[plugin.status].color}`}>
                    {plugin.status}
                  </span>
                </div>

                <p className="text-xs text-white/50 line-clamp-2">{plugin.description}</p>

                <div className="flex items-center gap-3 text-xs text-white/40">
                  <StarRating rating={plugin.rating} />
                  <span>{plugin.citations} citations</span>
                  <span>{plugin.downloads} downloads</span>
                </div>

                {/* Revenue display for creators */}
                {plugin.royaltyRate !== undefined && (
                  <div className="mt-1 p-2 rounded bg-amber-500/10 border border-amber-500/20">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-amber-400/80">Revenue</span>
                      <span className="text-amber-300 font-medium">
                        {plugin.citations} citations x {(plugin.royaltyRate * 100).toFixed(0)}% royalty
                      </span>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => onInstall?.(plugin.id)}
                  className={`mt-auto w-full py-2 rounded-lg text-xs font-medium transition-all ${
                    plugin.installed
                      ? 'bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25'
                      : 'bg-cyan-400/15 text-cyan-300 border border-cyan-400/30 hover:bg-cyan-400/25'
                  }`}
                >
                  {plugin.installed ? 'Uninstall' : 'Install'}
                </button>
              </div>
            ))}
          </div>

          {filteredMarketplace.length === 0 && (
            <div className={`${panelStyle} p-8 text-center text-white/30 text-sm`}>
              No plugins found in this category.
            </div>
          )}
        </div>
      )}

      {/* Installed Tab */}
      {activeTab === 'installed' && (
        <div className={`${panelStyle} p-4 flex flex-col gap-3`}>
          <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">
            Installed Plugins ({installedPlugins.length})
          </h3>
          {installedPlugins.length === 0 ? (
            <div className="text-center py-8 text-white/30 text-sm">
              No plugins installed. Browse the marketplace to get started.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {installedPlugins.map((plugin) => (
                <div
                  key={plugin.id}
                  className="p-3 rounded-lg bg-white/5 border border-white/10 flex items-center justify-between"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-white/80 font-medium">{plugin.name}</p>
                      <span className="text-[10px] text-white/30">v{plugin.version}</span>
                    </div>
                    <p className="text-xs text-white/40">
                      by {plugin.creator} &middot; {plugin.category}
                    </p>
                  </div>
                  <button
                    onClick={() => onInstall?.(plugin.id)}
                    className="px-3 py-1.5 rounded text-xs bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 transition-all"
                  >
                    Uninstall
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create Your Own Tab */}
      {activeTab === 'create' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Schema Builder */}
          <div className={`${panelStyle} p-4 flex flex-col gap-4`}>
            <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Create Your Own Lens</h3>

            <div>
              <label className="text-xs text-white/50">Lens Name</label>
              <input
                type="text"
                value={schemaName}
                onChange={(e) => setSchemaName(e.target.value)}
                placeholder="My Custom Lens"
                className="w-full mt-1 px-3 py-2 rounded bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/20"
              />
            </div>

            <div>
              <label className="text-xs text-white/50">Description</label>
              <textarea
                value={schemaDesc}
                onChange={(e) => setSchemaDesc(e.target.value)}
                placeholder="Describe what your lens does..."
                rows={3}
                className="w-full mt-1 px-3 py-2 rounded bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/20 resize-none"
              />
            </div>

            <div>
              <label className="text-xs text-white/50">Category</label>
              <select
                value={schemaCategory}
                onChange={(e) => setSchemaCategory(e.target.value as PluginCategory)}
                className="w-full mt-1 px-3 py-2 rounded bg-white/5 border border-white/10 text-white text-sm"
              >
                {PLUGIN_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            {/* Schema Fields */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-white/50">Schema Fields</label>
                <button
                  onClick={handleAddSchemaField}
                  className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  + Add Field
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {schemaFields.map((field, idx) => (
                  <div key={idx} className="flex gap-2">
                    <input
                      type="text"
                      value={field.name}
                      onChange={(e) => handleUpdateSchemaField(idx, 'name', e.target.value)}
                      placeholder="Field name"
                      className="flex-1 px-3 py-1.5 rounded bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/20"
                    />
                    <select
                      value={field.type}
                      onChange={(e) => handleUpdateSchemaField(idx, 'type', e.target.value)}
                      className="px-3 py-1.5 rounded bg-white/5 border border-white/10 text-white text-sm"
                    >
                      <option value="string">String</option>
                      <option value="number">Number</option>
                      <option value="boolean">Boolean</option>
                      <option value="array">Array</option>
                      <option value="object">Object</option>
                    </select>
                    <button
                      onClick={() => handleRemoveSchemaField(idx)}
                      className="px-2 py-1.5 rounded bg-red-500/10 text-red-400/60 hover:text-red-400 border border-red-500/20 text-sm transition-all"
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={handleCreateLens}
              disabled={!schemaName.trim()}
              className="w-full py-2.5 rounded-lg font-semibold text-sm bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-400 hover:to-blue-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Create Lens Plugin
            </button>
          </div>

          {/* Preview */}
          <div className={`${panelStyle} p-4 flex flex-col gap-4`}>
            <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Schema Preview</h3>
            <div className="p-3 rounded-lg bg-black/60 border border-white/5 font-mono text-xs text-green-400/80 whitespace-pre overflow-auto max-h-80">
              {JSON.stringify(
                {
                  name: schemaName || 'My Custom Lens',
                  description: schemaDesc || 'A custom lens plugin',
                  category: schemaCategory,
                  version: '1.0.0',
                  status: 'draft',
                  schema: {
                    type: 'object',
                    properties: Object.fromEntries(
                      schemaFields
                        .filter((f) => f.name)
                        .map((f) => [f.name, { type: f.type }])
                    ),
                  },
                },
                null,
                2
              )}
            </div>

            <div className="p-3 rounded-lg bg-white/5 border border-white/10">
              <p className="text-xs text-white/50 mb-2">Plugin review status flow:</p>
              <div className="flex items-center gap-2">
                <span className="px-2 py-1 rounded text-[10px] bg-gray-500/20 text-gray-400">Draft</span>
                <span className="text-white/20">→</span>
                <span className="px-2 py-1 rounded text-[10px] bg-yellow-500/20 text-yellow-400">In Review</span>
                <span className="text-white/20">→</span>
                <span className="px-2 py-1 rounded text-[10px] bg-green-500/20 text-green-400">Published</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
