'use client';

/**
 * Sidebar — Consolidated for Core 5 model with category-grouped extensions.
 *
 * Shows: Dashboard, 5 core lenses (with absorbed lens sub-items),
 * Hub link, system pages, and a collapsible Extensions section grouped
 * by category with search/filter and sovereign role gating.
 */

import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUIStore } from '@/store/ui';
import {
  CORE_LENSES,
  getAbsorbedLenses,
  getExtensionsByCategory,
  getLensById,
  getSubLensTree,
  type CoreLensConfig,
  type LensEntry,
  type SubLensTreeNode,
} from '@/lib/lens-registry';
import {
  Home, ChevronLeft, ChevronRight, ChevronDown, X, Compass,
  Puzzle, FlaskConical, Search, Users, Cpu, Building2, Download,
  Globe, Brain, Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export function Sidebar() {
  const pathname = usePathname();
  const {
    sidebarCollapsed, setSidebarCollapsed,
    sidebarOpen, setSidebarOpen,
    userRole,
  } = useUIStore();
  const [expandedCore, setExpandedCore] = useState<string | null>(null);
  const [showExtensions, setShowExtensions] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => new Set());

  // Close mobile sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname, setSidebarOpen]);

  // Auto-expand the category of the currently active lens
  useEffect(() => {
    if (!pathname) return;
    const match = pathname.match(/^\/lenses\/([^/]+)/);
    const activeLensId = match?.[1];
    if (activeLensId) {
      const categories = getExtensionsByCategory(userRole);
      for (const group of categories) {
        if (group.lenses.some((l) => l.id === activeLensId)) {
          setExpandedCategories((prev) => {
            if (prev.has(group.category)) return prev;
            const next = new Set(prev);
            next.add(group.category);
            return next;
          });
          break;
        }
      }
    }
  }, [pathname, userRole]);

  // Close mobile sidebar on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sidebarOpen) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [sidebarOpen, setSidebarOpen]);

  const toggleCategory = useCallback((category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const showLabel = !sidebarCollapsed || sidebarOpen;

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        role="navigation"
        aria-label="Main navigation"
        className={`
          fixed left-0 top-0 h-screen bg-lattice-surface border-r border-lattice-border z-50
          transition-all duration-300 flex flex-col
          ${sidebarCollapsed ? 'lg:w-16' : 'lg:w-64'}
          ${sidebarOpen ? 'w-72 translate-x-0' : 'w-72 -translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-transparent bg-gradient-to-r from-neon-blue/20 via-neon-purple/10 to-transparent bg-[length:100%_1px] bg-bottom bg-no-repeat">
          <Link href="/" className="flex items-center gap-2" aria-label="Go to dashboard">
            <span className="text-2xl" aria-hidden="true">&#x1f9e0;</span>
            {showLabel && (
              <span className="font-bold text-gradient-neon">Concord</span>
            )}
          </Link>

          {/* Desktop collapse button */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="hidden lg:block p-1.5 rounded-lg hover:bg-lattice-elevated text-gray-400 hover:text-white transition-colors"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </button>

          {/* Mobile close button */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1.5 rounded-lg hover:bg-lattice-elevated text-gray-400 hover:text-white transition-colors"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-2 no-scrollbar" aria-label="Lens navigation">
          {/* Dashboard link */}
          <div className="mb-4">
            <Link
              href="/"
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all',
                pathname === '/'
                  ? 'bg-neon-blue/20 text-neon-blue'
                  : 'text-gray-400 hover:bg-lattice-elevated hover:text-white',
                !showLabel && 'justify-center'
              )}
              title={!showLabel ? 'Dashboard' : undefined}
            >
              <Home className="w-5 h-5 flex-shrink-0" />
              {showLabel && (
                <span className="text-sm font-medium truncate">Dashboard</span>
              )}
            </Link>
          </div>

          {/* Core 5 Section Label */}
          {showLabel && (
            <p className="px-3 py-1 text-xs uppercase tracking-widest text-gray-500 font-medium mb-1">
              Workspaces
            </p>
          )}

          {/* Core 5 Lenses */}
          <div className="space-y-0.5 mb-4">
            {CORE_LENSES.map((core) => (
              <CoreLensNavItem
                key={core.id}
                core={core}
                pathname={pathname}
                showLabel={showLabel}
                isExpanded={expandedCore === core.id}
                onToggleExpand={() => setExpandedCore(expandedCore === core.id ? null : core.id)}
              />
            ))}
          </div>

          {/* Sub-Lens Tree — 234 sub-lenses under 15 roots */}
          {showLabel && (
            <>
              <p className="px-3 py-1 text-xs uppercase tracking-widest text-gray-500 font-medium mb-1">
                Sub-Lenses
              </p>
              <SubLensTreeSection pathname={pathname} />
            </>
          )}

          {/* Hub Link */}
          <div className="mb-4">
            <Link
              href="/hub"
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg transition-all',
                pathname === '/hub'
                  ? 'bg-neon-blue/20 text-neon-blue'
                  : 'text-gray-400 hover:bg-lattice-elevated hover:text-white',
                !showLabel && 'justify-center'
              )}
              title={!showLabel ? 'Lens Hub' : undefined}
            >
              <Compass className="w-5 h-5 flex-shrink-0" />
              {showLabel && (
                <span className="text-sm font-medium truncate">Lens Hub</span>
              )}
            </Link>
          </div>

          {/* System Pages */}
          {showLabel && (
            <p className="px-3 py-1 text-xs uppercase tracking-widest text-gray-500 font-medium mb-1">
              Systems
            </p>
          )}
          <div className="space-y-0.5 mb-4">
            {[
              { href: '/global', label: 'Global Library', Icon: Globe },
              { href: '/profile', label: 'Profile', Icon: Brain },
              { href: '/hypothesis-lab', label: 'Hypothesis Lab', Icon: FlaskConical },
              { href: '/research', label: 'Research', Icon: Search },
              { href: '/council', label: 'Council', Icon: Users },
              { href: '/agents', label: 'Agents', Icon: Cpu },
              { href: '/cri', label: 'CRI', Icon: Building2 },
              { href: '/ingest', label: 'Ingest', Icon: Download },
            ].map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg transition-all',
                  pathname === href
                    ? 'bg-neon-blue/20 text-neon-blue'
                    : 'text-gray-400 hover:bg-lattice-elevated hover:text-white',
                  !showLabel && 'justify-center'
                )}
                title={!showLabel ? label : undefined}
              >
                <Icon className="w-4.5 h-4.5 flex-shrink-0" />
                {showLabel && (
                  <span className="text-sm font-medium truncate">{label}</span>
                )}
              </Link>
            ))}
          </div>

          {/* Extensions Toggle */}
          {showLabel && (
            <button
              onClick={() => setShowExtensions(!showExtensions)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs uppercase tracking-wider text-gray-500 hover:text-gray-300 transition-colors"
              aria-expanded={showExtensions}
            >
              <Puzzle className="w-3.5 h-3.5" />
              <span>Extensions</span>
              <ChevronDown className={cn('w-3 h-3 ml-auto transition-transform', showExtensions && 'rotate-180')} />
            </button>
          )}

          {/* Extension Links — category-grouped with search */}
          {showExtensions && showLabel && (
            <CategoryGroupedExtensions
              pathname={pathname}
              userRole={userRole}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              expandedCategories={expandedCategories}
              onToggleCategory={toggleCategory}
            />
          )}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-lattice-border">
          {showLabel ? (
            <div className="text-xs text-gray-500">
              <p>Concord OS v5.0</p>
              <p className="text-neon-green">70% Sovereign</p>
            </div>
          ) : (
            <div className="text-center">
              <span className="text-xs text-neon-green">70%</span>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

/** Core lens nav item with expandable absorbed sub-lenses */
const CoreLensNavItem = memo(function CoreLensNavItem({
  core,
  pathname,
  showLabel,
  isExpanded,
  onToggleExpand,
}: {
  core: CoreLensConfig;
  pathname: string;
  showLabel: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const Icon = core.icon;
  const isActive = pathname === core.path;
  const absorbed = getAbsorbedLenses(core.id);
  const isAbsorbedActive = absorbed.some((l) => pathname === l.path);
  const isHighlighted = isActive || isAbsorbedActive;

  return (
    <div>
      <div className="flex items-center">
        <Link
          href={core.path}
          className={cn(
            'flex-1 flex items-center gap-3 px-3 py-2 rounded-lg transition-all',
            isHighlighted
              ? `bg-${core.color}/20 text-${core.color}`
              : 'text-gray-400 hover:bg-lattice-elevated hover:text-white',
            !showLabel && 'justify-center'
          )}
          title={!showLabel ? core.name : undefined}
          aria-current={isActive ? 'page' : undefined}
        >
          <Icon className="w-5 h-5 flex-shrink-0" />
          {showLabel && (
            <span className="text-sm font-medium truncate">{core.name}</span>
          )}
        </Link>

        {/* Expand toggle for absorbed lenses */}
        {showLabel && absorbed.length > 0 && (
          <button
            onClick={onToggleExpand}
            className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors rounded"
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${core.name} sub-lenses`}
            aria-expanded={isExpanded}
          >
            <ChevronRight className={cn('w-3.5 h-3.5 transition-transform', isExpanded && 'rotate-90')} />
          </button>
        )}
      </div>

      {/* Absorbed sub-lenses */}
      {isExpanded && showLabel && absorbed.length > 0 && (
        <div className="ml-6 mt-0.5 space-y-0.5 border-l border-lattice-border pl-3">
          {absorbed.map((lens) => {
            const SubIcon = lens.icon;
            const isSubActive = pathname === lens.path;
            return (
              <Link
                key={lens.id}
                href={lens.path}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-all',
                  isSubActive
                    ? `text-${core.color} bg-${core.color}/10`
                    : 'text-gray-500 hover:text-gray-300 hover:bg-lattice-elevated'
                )}
                aria-current={isSubActive ? 'page' : undefined}
              >
                <SubIcon className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">{lens.tabLabel || lens.name}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
});

/**
 * Category-grouped extensions with search filter and collapsible sections.
 * Respects sovereign role gating — sovereign-only lenses hidden from regular users.
 */
const CategoryGroupedExtensions = memo(function CategoryGroupedExtensions({
  pathname,
  userRole,
  searchQuery,
  onSearchChange,
  expandedCategories,
  onToggleCategory,
}: {
  pathname: string;
  userRole: string;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  expandedCategories: Set<string>;
  onToggleCategory: (category: string) => void;
}) {
  // Get all extension categories filtered by user role
  const categoryGroups = useMemo(
    () => getExtensionsByCategory(userRole),
    [userRole]
  );

  // Filter lenses by search query
  const filteredGroups = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return categoryGroups;

    return categoryGroups
      .map((group) => ({
        ...group,
        lenses: group.lenses.filter((lens) => {
          const entry = getLensById(lens.id);
          const haystack = [
            lens.name,
            lens.description,
            ...(entry?.keywords || []),
          ]
            .join(' ')
            .toLowerCase();
          return haystack.includes(q);
        }),
      }))
      .filter((group) => group.lenses.length > 0);
  }, [categoryGroups, searchQuery]);

  // When searching, all matching categories should appear expanded
  const isSearching = searchQuery.trim().length > 0;

  return (
    <div className="mt-2 space-y-1">
      {/* Search input */}
      <div className="px-2 mb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filter lenses..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-lattice-elevated border border-lattice-border rounded-md
                       text-gray-200 placeholder-gray-500 focus:outline-none focus:border-neon-cyan/50 transition-colors"
            aria-label="Filter extension lenses"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              aria-label="Clear search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Category sections */}
      {filteredGroups.map((group) => {
        const isExpanded = isSearching || expandedCategories.has(group.category);

        return (
          <div key={group.category}>
            {/* Category header — clickable to toggle */}
            <button
              onClick={() => onToggleCategory(group.category)}
              className="w-full flex items-center gap-2 px-3 py-1 text-xs uppercase tracking-wider hover:bg-lattice-elevated/50 rounded-md transition-colors"
              aria-expanded={isExpanded}
            >
              <ChevronRight
                className={cn(
                  'w-3 h-3 text-gray-500 transition-transform',
                  isExpanded && 'rotate-90'
                )}
              />
              <span className={group.color}>{group.category}</span>
              <span className="ml-auto text-gray-600 text-[10px] font-mono">
                {group.lenses.length}
              </span>
            </button>

            {/* Lens items within category */}
            {isExpanded && (
              <div className="mt-0.5 space-y-0.5 ml-2">
                {group.lenses.map((lens) => (
                  <ExtensionLensLink
                    key={lens.id}
                    lens={lens}
                    pathname={pathname}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Empty search state */}
      {filteredGroups.length === 0 && searchQuery && (
        <p className="px-3 py-2 text-xs text-gray-500 italic">
          No lenses match &ldquo;{searchQuery}&rdquo;
        </p>
      )}

      {/* Hub link */}
      <Link
        href="/hub"
        className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 hover:text-neon-cyan transition-colors"
      >
        <span>View all in Hub</span>
        <ChevronRight className="w-3 h-3" />
      </Link>
    </div>
  );
});

/**
 * Sub-Lens Tree Section — lazy-loads the hierarchical sub-lens registry
 * from /api/sub-lens/tree and renders expandable parent → child links.
 *
 * Each parent row has a chevron; children are only rendered after the first
 * expand (lazy hydration). Expanded state persists in localStorage under
 * `concord:sidebar:sub-lens:expanded`.
 */
const SUBLENS_STORAGE_KEY = 'concord:sidebar:sub-lens:expanded';

const SubLensTreeSection = memo(function SubLensTreeSection({
  pathname,
}: {
  pathname: string;
}) {
  const [tree, setTree] = useState<SubLensTreeNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [hydrated, setHydrated] = useState(false);

  // Hydrate expanded state from localStorage (client-only).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(SUBLENS_STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setExpanded(new Set(arr));
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  // Persist expanded state to localStorage.
  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        SUBLENS_STORAGE_KEY,
        JSON.stringify(Array.from(expanded)),
      );
    } catch {
      /* ignore quota / privacy errors */
    }
  }, [expanded, hydrated]);

  // Fetch the tree once on first mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const t = await getSubLensTree();
        if (!cancelled) {
          setTree(t);
          setError(t.length === 0);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-expand the parent of the currently active sub-lens route.
  useEffect(() => {
    if (!pathname) return;
    const match = pathname.match(/^\/lenses\/([^/]+)\/([^/]+)/);
    if (match) {
      const [, parent] = match;
      setExpanded((prev) => {
        if (prev.has(parent)) return prev;
        const next = new Set(prev);
        next.add(parent);
        return next;
      });
    }
  }, [pathname]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (loading && !tree) {
    return (
      <div className="px-3 py-2 text-xs text-gray-500 italic">
        Loading tree&hellip;
      </div>
    );
  }

  if (error || !tree || tree.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-gray-600 italic">
        Sub-lens tree unavailable
      </div>
    );
  }

  return (
    <div className="space-y-0.5 mb-4">
      {tree.map((node) => (
        <SubLensTreeNodeItem
          key={node.id}
          node={node}
          pathname={pathname}
          isExpanded={expanded.has(node.id)}
          onToggle={() => toggle(node.id)}
        />
      ))}
    </div>
  );
});

/** Single parent row + its children, rendered only when expanded. */
const SubLensTreeNodeItem = memo(function SubLensTreeNodeItem({
  node,
  pathname,
  isExpanded,
  onToggle,
}: {
  node: SubLensTreeNode;
  pathname: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const parentHref = `/lenses/${node.id}`;
  const isParentActive = pathname === parentHref;
  const activeSubMatch = pathname.match(/^\/lenses\/([^/]+)\/([^/]+)/);
  const isChildActive =
    activeSubMatch && activeSubMatch[1] === node.id;
  const childCount = node.children?.length ?? 0;

  const parentLabel = node.id.charAt(0).toUpperCase() + node.id.slice(1);

  return (
    <div>
      <div className="flex items-center">
        <Link
          href={parentHref}
          className={cn(
            'flex-1 flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-all',
            isParentActive || isChildActive
              ? 'bg-neon-purple/10 text-neon-purple'
              : 'text-gray-400 hover:bg-lattice-elevated hover:text-white',
          )}
          aria-current={isParentActive ? 'page' : undefined}
        >
          <Layers className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">{parentLabel}</span>
          <span className="ml-auto text-[10px] font-mono text-gray-600">
            {childCount}
          </span>
        </Link>
        {childCount > 0 && (
          <button
            onClick={onToggle}
            className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors rounded"
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${parentLabel} sub-lenses`}
            aria-expanded={isExpanded}
          >
            <ChevronDown
              className={cn(
                'w-3 h-3 transition-transform',
                isExpanded && 'rotate-180',
              )}
            />
          </button>
        )}
      </div>

      {isExpanded && childCount > 0 && (
        <div className="ml-5 mt-0.5 mb-1 space-y-0.5 border-l border-lattice-border pl-2">
          {node.children.map((child) => {
            const parts = child.id.split('.');
            const leaf = parts.slice(1).join('.') || parts[0];
            const href = `/lenses/${parts[0]}/${parts.slice(1).join('.')}`;
            const isActive = pathname === href;
            const label = leaf
              .replace(/-/g, ' ')
              .replace(/\b\w/g, (c) => c.toUpperCase());
            return (
              <Link
                key={child.id}
                href={href}
                className={cn(
                  'block px-2 py-1 rounded text-[11px] truncate transition-all',
                  isActive
                    ? 'text-neon-purple bg-neon-purple/10'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-lattice-elevated',
                )}
                title={child.id}
                aria-current={isActive ? 'page' : undefined}
              >
                {label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
});

/** Single extension lens link inside a category group */
const ExtensionLensLink = memo(function ExtensionLensLink({
  lens,
  pathname,
}: {
  lens: LensEntry;
  pathname: string;
}) {
  const Icon = lens.icon;
  const isActive = pathname === lens.path;

  return (
    <Link
      href={lens.path}
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-all',
        isActive
          ? 'text-neon-blue bg-neon-blue/10'
          : 'text-gray-500 hover:text-gray-300 hover:bg-lattice-elevated'
      )}
      title={lens.description}
    >
      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="truncate">{lens.name}</span>
    </Link>
  );
});
