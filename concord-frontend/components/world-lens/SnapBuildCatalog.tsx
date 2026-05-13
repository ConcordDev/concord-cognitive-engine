'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  Search, ShieldCheck, Quote, Star, ChevronLeft, ArrowUpRight,
  Home, Store, BookOpen, Zap, Factory, Puzzle, X, SlidersHorizontal,
  Sparkles, Clock, TrendingUp, Package, Ruler, Wrench,
} from 'lucide-react';
import {
  SEED_SNAP_TEMPLATES,
  SNAP_BUILD_CATEGORIES,
  type SnapBuildTemplate,
  type SnapBuildCategory,
  type TemplateSize,
} from '@/lib/world-lens/snap-build-templates';

/* ── Style constants ──────────────────────────────────────────── */

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const SORT_OPTIONS = [
  { value: 'citations', label: 'Most Cited' },
  { value: 'newest', label: 'Newest' },
  { value: 'name', label: 'Name' },
  { value: 'difficulty', label: 'Difficulty' },
] as const;

const SIZE_OPTIONS: { value: TemplateSize | 'all'; label: string }[] = [
  { value: 'all', label: 'Any Size' },
  { value: '1x1', label: 'Small (1x1)' },
  { value: '2x2', label: 'Medium (2x2)' },
  { value: '3x3', label: 'Large (3x3)' },
  { value: '4x4+', label: 'XL (4x4+)' },
];

const CATEGORY_ICONS: Record<SnapBuildCategory, React.ComponentType<{ className?: string }>> = {
  residential: Home,
  commercial: Store,
  public: BookOpen,
  infrastructure: Zap,
  industrial: Factory,
  custom: Puzzle,
};

const CATEGORY_COLORS: Record<SnapBuildCategory, string> = {
  residential: 'text-amber-400',
  commercial: 'text-emerald-400',
  public: 'text-blue-400',
  infrastructure: 'text-yellow-400',
  industrial: 'text-orange-400',
  custom: 'text-purple-400',
};

/* ── Sub-components ───────────────────────────────────────────── */

function DifficultyStars({ level }: { level: number }) {
  return (
    <span className="inline-flex gap-px" title={`Difficulty: ${level}/5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`w-2.5 h-2.5 ${i < level ? 'text-yellow-400 fill-yellow-400' : 'text-gray-700'}`}
        />
      ))}
    </span>
  );
}

function SizeLabel({ size }: { size: TemplateSize }) {
  const colors: Record<TemplateSize, string> = {
    '1x1': 'bg-green-900/40 text-green-400 border-green-400/20',
    '2x2': 'bg-blue-900/40 text-blue-400 border-blue-400/20',
    '3x3': 'bg-orange-900/40 text-orange-400 border-orange-400/20',
    '4x4+': 'bg-red-900/40 text-red-400 border-red-400/20',
  };
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded border ${colors[size]}`}>
      {size}
    </span>
  );
}

function ValidationBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 text-[9px] text-green-400" title="Pre-validated">
      <ShieldCheck className="w-3 h-3" />
    </span>
  );
}

/* ── Template Card ────────────────────────────────────────────── */

function TemplateCard({
  template,
  onSelect,
}: {
  template: SnapBuildTemplate;
  onSelect: (t: SnapBuildTemplate) => void;
}) {
  const CatIcon = CATEGORY_ICONS[template.category];
  const catColor = CATEGORY_COLORS[template.category];

  return (
    <button
      onClick={() => onSelect(template)}
      className="w-full text-left p-3 rounded-lg border border-white/5 hover:border-white/15 hover:bg-white/5 transition-all group"
    >
      {/* Thumbnail placeholder */}
      <div className="w-full aspect-[4/3] rounded bg-gradient-to-br from-white/5 to-white/[0.02] mb-2 flex items-center justify-center overflow-hidden relative">
        <CatIcon className={`w-8 h-8 ${catColor} opacity-40 group-hover:opacity-70 transition-opacity`} />
        {template.featured && (
          <span className="absolute top-1 right-1 text-[8px] bg-yellow-500/20 text-yellow-400 border border-yellow-400/30 rounded px-1 py-px flex items-center gap-0.5">
            <Sparkles className="w-2.5 h-2.5" /> Featured
          </span>
        )}
      </div>

      {/* Name + validation */}
      <div className="flex items-center justify-between gap-1 mb-0.5">
        <span className="text-[11px] text-white font-medium group-hover:text-cyan-300 transition-colors truncate">
          {template.name}
        </span>
        <ValidationBadge />
      </div>

      {/* Description */}
      <p className="text-[9px] text-gray-500 line-clamp-2 mb-1.5">
        {template.description}
      </p>

      {/* Meta row */}
      <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[9px] text-gray-500">
        <span className="text-cyan-500">{template.creator}</span>
        <span className="flex items-center gap-0.5">
          <Quote className="w-2.5 h-2.5" /> {template.citations}
        </span>
        <SizeLabel size={template.size} />
        <DifficultyStars level={template.difficulty} />
      </div>

      {/* Material summary */}
      <p className="text-[8px] text-gray-600 mt-1 truncate">
        {template.materialSummary}
      </p>
    </button>
  );
}

/* ── Preview Panel ────────────────────────────────────────────── */

function TemplatePreview({
  template,
  onClose,
  onPlace,
  onUpgradeToGuided,
}: {
  template: SnapBuildTemplate;
  onClose: () => void;
  onPlace?: (t: SnapBuildTemplate, customization: TemplateCustomization) => void;
  onUpgradeToGuided?: (t: SnapBuildTemplate) => void;
}) {
  const CatIcon = CATEGORY_ICONS[template.category];
  const catColor = CATEGORY_COLORS[template.category];

  const [customName, setCustomName] = useState(template.name);
  const [customDescription, setCustomDescription] = useState('');
  const [interiorLayout, setInteriorLayout] = useState<string>('default');
  const [colorScheme, setColorScheme] = useState<string>('original');

  const handlePlace = () => {
    onPlace?.(template, {
      name: customName,
      description: customDescription,
      interiorLayout,
      colorScheme,
    });
  };

  return (
    <div className={`${panel} p-4 space-y-4 overflow-y-auto max-h-full`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={onClose}
          className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-white transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Back to Catalog
        </button>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 3D / Isometric preview placeholder */}
      <div className="w-full aspect-[16/10] rounded-lg bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/5 flex flex-col items-center justify-center gap-2">
        <CatIcon className={`w-12 h-12 ${catColor} opacity-50`} />
        <p className="text-[9px] text-gray-600 max-w-[80%] text-center">
          {template.previewDescription}
        </p>
      </div>

      {/* Name + badges */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-sm font-semibold text-white">{template.name}</h2>
          <ValidationBadge />
          {template.featured && (
            <span className="text-[8px] bg-yellow-500/20 text-yellow-400 border border-yellow-400/30 rounded px-1 py-px">
              Featured
            </span>
          )}
        </div>
        <p className="text-[10px] text-gray-400">{template.description}</p>
      </div>

      {/* Specs grid */}
      <div className="grid grid-cols-2 gap-2">
        <div className={`${panel} p-2`}>
          <p className="text-[8px] text-gray-500 uppercase tracking-wider mb-0.5">Size</p>
          <div className="flex items-center gap-1">
            <Ruler className="w-3 h-3 text-gray-500" />
            <SizeLabel size={template.size} />
          </div>
        </div>
        <div className={`${panel} p-2`}>
          <p className="text-[8px] text-gray-500 uppercase tracking-wider mb-0.5">Difficulty</p>
          <DifficultyStars level={template.difficulty} />
        </div>
        <div className={`${panel} p-2`}>
          <p className="text-[8px] text-gray-500 uppercase tracking-wider mb-0.5">Citations</p>
          <span className="text-[10px] text-white flex items-center gap-1">
            <Quote className="w-3 h-3 text-gray-500" /> {template.citations}
          </span>
        </div>
        <div className={`${panel} p-2`}>
          <p className="text-[8px] text-gray-500 uppercase tracking-wider mb-0.5">Category</p>
          <span className={`text-[10px] flex items-center gap-1 ${catColor}`}>
            <CatIcon className="w-3 h-3" />
            {SNAP_BUILD_CATEGORIES.find(c => c.key === template.category)?.label}
          </span>
        </div>
      </div>

      {/* Materials */}
      <div>
        <p className="text-[9px] text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
          <Package className="w-3 h-3" /> Materials
        </p>
        <p className="text-[10px] text-gray-300">{template.materialSummary}</p>
      </div>

      {/* Infrastructure requirements */}
      <div>
        <p className="text-[9px] text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
          <Zap className="w-3 h-3" /> Infrastructure Requirements
        </p>
        <div className="flex flex-wrap gap-1">
          {template.infrastructureRequirements.map(req => (
            <span
              key={req}
              className="text-[9px] bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-gray-400"
            >
              {req}
            </span>
          ))}
        </div>
      </div>

      {/* Creator info + citation chain */}
      <div className={`${panel} p-2`}>
        <p className="text-[9px] text-gray-400 uppercase tracking-wider mb-1">Creator</p>
        <p className="text-[10px] text-cyan-400">{template.creator}</p>
        {template.basedOn && (
          <p className="text-[9px] text-gray-500 mt-1">
            Based on {template.basedOn}&apos;s design
          </p>
        )}
      </div>

      {/* Customization options */}
      <div className="space-y-2">
        <p className="text-[9px] text-gray-400 uppercase tracking-wider flex items-center gap-1">
          <SlidersHorizontal className="w-3 h-3" /> Customization (won&apos;t break validation)
        </p>

        <div>
          <label className="text-[9px] text-gray-500 block mb-0.5">Name</label>
          <input
            value={customName}
            onChange={e => setCustomName(e.target.value)}
            className="w-full bg-black/50 border border-white/10 rounded px-2 py-1 text-[10px] text-white"
          />
        </div>

        <div>
          <label className="text-[9px] text-gray-500 block mb-0.5">Description</label>
          <textarea
            value={customDescription}
            onChange={e => setCustomDescription(e.target.value)}
            placeholder="Add a personal note..."
            rows={2}
            className="w-full bg-black/50 border border-white/10 rounded px-2 py-1 text-[10px] text-white resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[9px] text-gray-500 block mb-0.5">Interior Layout</label>
            <select
              value={interiorLayout}
              onChange={e => setInteriorLayout(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white"
            >
              <option value="default">Default</option>
              <option value="open">Open Plan</option>
              <option value="divided">Divided Rooms</option>
              <option value="studio">Studio</option>
            </select>
          </div>
          <div>
            <label className="text-[9px] text-gray-500 block mb-0.5">Color Scheme</label>
            <select
              value={colorScheme}
              onChange={e => setColorScheme(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white"
            >
              <option value="original">Original</option>
              <option value="warm">Warm Tones</option>
              <option value="cool">Cool Tones</option>
              <option value="earth">Earthy</option>
              <option value="monochrome">Monochrome</option>
            </select>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="space-y-2 pt-1">
        <button
          onClick={handlePlace}
          className="w-full py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
        >
          <Package className="w-3.5 h-3.5" /> Place in District
        </button>
        <button
          onClick={() => onUpgradeToGuided?.(template)}
          className="w-full py-1.5 rounded-lg border border-white/10 hover:border-white/20 hover:bg-white/5 text-gray-400 hover:text-white text-[10px] transition-all flex items-center justify-center gap-1.5"
        >
          <Wrench className="w-3 h-3" /> Upgrade to Guided Build
          <ArrowUpRight className="w-3 h-3" />
        </button>
        <p className="text-[8px] text-gray-600 text-center">
          Guided Build lets you modify the structure but exits snap-build mode
        </p>
      </div>
    </div>
  );
}

/* ── Main Component ───────────────────────────────────────────── */

interface TemplateCustomization {
  name: string;
  description: string;
  interiorLayout: string;
  colorScheme: string;
}

interface SnapBuildCatalogProps {
  onPlaceTemplate?: (template: SnapBuildTemplate, customization: TemplateCustomization) => void;
  onUpgradeToGuided?: (template: SnapBuildTemplate) => void;
  onClose?: () => void;
}

export default function SnapBuildCatalog({
  onPlaceTemplate,
  onUpgradeToGuided,
  onClose,
}: SnapBuildCatalogProps) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<string>('citations');
  const [categoryFilter, setCategoryFilter] = useState<SnapBuildCategory | 'all'>('all');
  const [sizeFilter, setSizeFilter] = useState<TemplateSize | 'all'>('all');
  const [selectedTemplate, setSelectedTemplate] = useState<SnapBuildTemplate | null>(null);
  const [section, setSection] = useState<'all' | 'featured' | 'new'>('all');

  /* ── Derived data ─────────────────────────────────────────── */

  const templates = SEED_SNAP_TEMPLATES;

  const featuredTemplates = useMemo(
    () => templates.filter(t => t.featured),
    [templates],
  );

  const newArrivals = useMemo(
    () => [...templates].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 4),
    [templates],
  );

  const filtered = useMemo(() => {
    let items: SnapBuildTemplate[];

    if (section === 'featured') items = [...featuredTemplates];
    else if (section === 'new') items = [...newArrivals];
    else items = [...templates];

    if (categoryFilter !== 'all') {
      items = items.filter(t => t.category === categoryFilter);
    }
    if (sizeFilter !== 'all') {
      items = items.filter(t => t.size === sizeFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(t =>
        t.name.toLowerCase().includes(q) ||
        t.tags.some(tag => tag.includes(q)) ||
        t.creator.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
      );
    }

    if (sort === 'citations') items.sort((a, b) => b.citations - a.citations);
    else if (sort === 'newest') items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    else if (sort === 'difficulty') items.sort((a, b) => a.difficulty - b.difficulty);
    else items.sort((a, b) => a.name.localeCompare(b.name));

    return items;
  }, [search, sort, categoryFilter, sizeFilter, section, templates, featuredTemplates, newArrivals]);

  const totalCount = templates.length;

  const handleSelect = useCallback((t: SnapBuildTemplate) => {
    setSelectedTemplate(t);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedTemplate(null);
  }, []);

  /* ── Preview mode ─────────────────────────────────────────── */

  if (selectedTemplate) {
    return (
      <TemplatePreview
        template={selectedTemplate}
        onClose={handleBack}
        onPlace={onPlaceTemplate}
        onUpgradeToGuided={onUpgradeToGuided}
      />
    );
  }

  /* ── Catalog view ─────────────────────────────────────────── */

  return (
    <div className={`${panel} p-4 space-y-3 overflow-y-auto max-h-full`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xs font-semibold text-white uppercase tracking-wider">
            Snap-Build Catalog
          </h2>
          <p className="text-[9px] text-gray-500 mt-0.5">
            {totalCount} templates available
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Section tabs */}
      <div className="flex gap-1">
        {([
          { key: 'all', label: 'All', icon: Package },
          { key: 'featured', label: 'Featured This Week', icon: Sparkles },
          { key: 'new', label: 'New Arrivals', icon: Clock },
        ] as const).map(tab => {
          const Icon = tab.icon;
          const active = section === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setSection(tab.key)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] transition-all ${
                active
                  ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-400/30'
                  : 'text-gray-500 hover:text-gray-300 border border-transparent hover:border-white/10'
              }`}
            >
              <Icon className="w-3 h-3" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search templates..."
          className="w-full bg-black/50 border border-white/10 rounded pl-7 pr-2 py-1.5 text-[10px] text-white placeholder-gray-600"
        />
      </div>

      {/* Filters row */}
      <div className="flex gap-1.5">
        {/* Category */}
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value as SnapBuildCategory | 'all')}
          className="flex-1 bg-black/50 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white"
        >
          <option value="all">All Categories</option>
          {SNAP_BUILD_CATEGORIES.map(c => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>

        {/* Size */}
        <select
          value={sizeFilter}
          onChange={e => setSizeFilter(e.target.value as TemplateSize | 'all')}
          className="flex-1 bg-black/50 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white"
        >
          {SIZE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {/* Sort */}
        <select
          value={sort}
          onChange={e => setSort(e.target.value)}
          className="flex-1 bg-black/50 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white"
        >
          {SORT_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Popular section (only in "all" view with no filters) */}
      {section === 'all' && categoryFilter === 'all' && sizeFilter === 'all' && !search && (
        <div>
          <p className="text-[9px] text-gray-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> Popular Templates
          </p>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {[...templates]
              .sort((a, b) => b.citations - a.citations)
              .slice(0, 3)
              .map(t => {
                const CIcon = CATEGORY_ICONS[t.category];
                return (
                  <button
                    key={t.id}
                    onClick={() => handleSelect(t)}
                    className="flex-shrink-0 w-32 p-2 rounded border border-white/5 hover:border-white/15 hover:bg-white/5 transition-all text-left"
                  >
                    <div className="flex items-center gap-1 mb-0.5">
                      <CIcon className={`w-3 h-3 ${CATEGORY_COLORS[t.category]}`} />
                      <span className="text-[10px] text-white truncate">{t.name}</span>
                    </div>
                    <span className="text-[8px] text-gray-500 flex items-center gap-0.5">
                      <Quote className="w-2 h-2" /> {t.citations}
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* Category pills (only when "all categories" is selected) */}
      {categoryFilter === 'all' && (
        <div className="flex flex-wrap gap-1">
          {SNAP_BUILD_CATEGORIES.map(cat => {
            const CIcon = CATEGORY_ICONS[cat.key];
            const count = templates.filter(t => t.category === cat.key).length;
            return (
              <button
                key={cat.key}
                onClick={() => setCategoryFilter(cat.key)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all ${CATEGORY_COLORS[cat.key]}`}
              >
                <CIcon className="w-3 h-3" />
                {cat.label}
                <span className="text-gray-600">({count})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Active filter indicator */}
      {categoryFilter !== 'all' && (
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-gray-500">Filtered:</span>
          <button
            onClick={() => setCategoryFilter('all')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] border border-white/10 ${CATEGORY_COLORS[categoryFilter]}`}
          >
            {SNAP_BUILD_CATEGORIES.find(c => c.key === categoryFilter)?.label}
            <X className="w-2.5 h-2.5" />
          </button>
        </div>
      )}

      {/* Template grid */}
      <div className="grid grid-cols-2 gap-2 max-h-[60vh] overflow-y-auto">
        {filtered.length === 0 && (
          <div className="col-span-2 py-8 text-center">
            <Package className="w-8 h-8 text-gray-700 mx-auto mb-2" />
            <p className="text-[10px] text-gray-600">No templates found in this category</p>
            <p className="text-[9px] text-gray-700 mt-0.5">Try adjusting your filters or search</p>
          </div>
        )}
        {filtered.map(template => (
          <TemplateCard key={template.id} template={template} onSelect={handleSelect} />
        ))}
      </div>

      {/* Footer count */}
      {filtered.length > 0 && (
        <p className="text-[9px] text-gray-600 text-center">
          Showing {filtered.length} of {totalCount} templates
        </p>
      )}
    </div>
  );
}
