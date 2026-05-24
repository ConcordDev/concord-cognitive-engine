'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GitBranch,
  ChevronRight,
  ChevronDown,
  Sparkles,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';

interface LineageNode {
  id: string;
  title: string;
  tier: 'regular' | 'mega' | 'hyper' | 'shadow';
  createdAt: Date;
  children: LineageNode[];
  parent?: string;
  metadata?: {
    synthesizedFrom?: string[];
    consolidatedInto?: string;
    version?: number;
  };
}

interface LineageTreeProps {
  root: LineageNode;
  selectedId?: string;
  onNodeClick?: (node: LineageNode) => void;
  className?: string;
  showTimeline?: boolean;
}

const tierConfig = {
  regular: { color: 'bg-gray-500', ring: 'ring-gray-500', label: 'Regular' },
  mega: { color: 'bg-neon-cyan', ring: 'ring-neon-cyan', label: 'MEGA' },
  hyper: { color: 'bg-neon-purple', ring: 'ring-neon-purple', label: 'HYPER' },
  shadow: { color: 'bg-gray-700', ring: 'ring-gray-700', label: 'Shadow' }
};

export function LineageTree({
  root,
  selectedId,
  onNodeClick,
  className,
  showTimeline = false
}: LineageTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set([root.id]));
  const [zoom, setZoom] = useState(1);
  const [timelineView, setTimelineView] = useState(showTimeline);

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const expandAll = () => {
    const getAllIds = (node: LineageNode): string[] => {
      return [node.id, ...node.children.flatMap(getAllIds)];
    };
    setExpandedIds(new Set(getAllIds(root)));
  };

  const collapseAll = () => {
    setExpandedIds(new Set([root.id]));
  };

  return (
    <div className={cn('flex flex-col h-full bg-lattice-bg', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-lattice-border">
        <div className="flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-neon-cyan" />
          <span className="font-medium text-white">Lineage Tree</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTimelineView(!timelineView)}
            className={cn(
              'px-2 py-1 text-xs transition-colors',
              timelineView ? 'text-neon-cyan' : 'text-gray-400 hover:text-white'
            )}
          >
            {timelineView ? 'Tree view' : 'Timeline'}
          </button>
          <button
            onClick={expandAll}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white transition-colors"
          >
            Expand all
          </button>
          <button
            onClick={collapseAll}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white transition-colors"
          >
            Collapse all
          </button>
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={() => setZoom(z => Math.max(0.5, z - 0.1))}
              className="p-1 text-gray-400 hover:text-white transition-colors"
            aria-label="Zoom out">
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs text-gray-400 w-10 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(z => Math.min(2, z + 0.1))}
              className="p-1 text-gray-400 hover:text-white transition-colors"
            aria-label="Zoom in">
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Tree content */}
      <div
        className="flex-1 overflow-auto p-4"
        style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
      >
        {timelineView ? (
          <LineageTimeline
            nodes={[root]}
            selectedId={selectedId}
            onNodeClick={onNodeClick}
          />
        ) : (
          <TreeNode
            node={root}
            depth={0}
            isExpanded={expandedIds.has(root.id)}
            onToggle={() => toggleExpanded(root.id)}
            onClick={() => onNodeClick?.(root)}
            isSelected={selectedId === root.id}
            expandedIds={expandedIds}
            onNodeToggle={toggleExpanded}
            onNodeClick={onNodeClick}
            selectedId={selectedId}
          />
        )}
      </div>

      {/* Legend */}
      <div className="px-4 py-2 border-t border-lattice-border bg-lattice-surface/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {Object.entries(tierConfig).map(([tier, config]) => (
              <div key={tier} className="flex items-center gap-1.5">
                <div className={cn('w-3 h-3 rounded-full', config.color)} />
                <span className="text-xs text-gray-400">{config.label}</span>
              </div>
            ))}
          </div>
          <span className="text-xs text-gray-400">
            {countNodes(root)} total nodes
          </span>
        </div>
      </div>
    </div>
  );
}

interface TreeNodeProps {
  node: LineageNode;
  depth: number;
  isExpanded: boolean;
  onToggle: () => void;
  onClick: () => void;
  isSelected: boolean;
  expandedIds: Set<string>;
  onNodeToggle: (id: string) => void;
  onNodeClick?: (node: LineageNode) => void;
  selectedId?: string;
}

function TreeNode({
  node,
  depth,
  isExpanded,
  onToggle,
  onClick,
  isSelected,
  expandedIds,
  onNodeToggle,
  onNodeClick,
  selectedId
}: TreeNodeProps) {
  const config = tierConfig[node.tier];
  const hasChildren = node.children.length > 0;

  return (
    <div>
      {/* Node */}
      <div
        className={cn(
          'group flex items-center gap-2 py-1.5 rounded-lg transition-colors',
          isSelected ? 'bg-neon-cyan/10' : 'hover:bg-lattice-surface'
        )}
        style={{ paddingLeft: depth * 24 }}
      >
        {/* Expand/collapse button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={cn(
            'p-1 rounded transition-colors',
            hasChildren
              ? 'text-gray-400 hover:text-white hover:bg-lattice-border'
              : 'text-transparent'
          )}
          disabled={!hasChildren}
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </button>

        {/* Node content */}
        <button
          onClick={onClick}
          className="flex items-center gap-2 flex-1 min-w-0"
        >
          <div className={cn(
            'w-3 h-3 rounded-full flex-shrink-0',
            config.color,
            isSelected && `ring-2 ${config.ring}`
          )} />

          <span className={cn(
            'text-sm truncate',
            isSelected ? 'text-white font-medium' : 'text-gray-300'
          )}>
            {node.title}
          </span>

          {node.tier !== 'regular' && (
            <span className={cn(
              'text-[10px] px-1.5 py-0.5 rounded uppercase font-medium',
              node.tier === 'mega' ? 'bg-neon-cyan/20 text-neon-cyan' :
              node.tier === 'hyper' ? 'bg-neon-purple/20 text-neon-purple' :
              'bg-gray-500/20 text-gray-400'
            )}>
              {node.tier}
            </span>
          )}

          {node.metadata?.synthesizedFrom && (
            <span title="Synthesized"><Sparkles className="w-3.5 h-3.5 text-neon-purple" /></span>
          )}
        </button>

        {/* Timestamp */}
        <span className="text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
          {formatRelativeTime(node.createdAt)}
        </span>
      </div>

      {/* Children */}
      <AnimatePresence>
        {isExpanded && hasChildren && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
          >
            {/* Connection line */}
            <div
              className="relative"
              style={{ marginLeft: depth * 24 + 18 }}
            >
              <div className="absolute left-0 top-0 bottom-0 w-px bg-lattice-border" />

              {node.children.map((child, _index) => (
                <div key={child.id} className="relative">
                  {/* Horizontal connector */}
                  <div
                    className="absolute left-0 top-4 w-4 h-px bg-lattice-border"
                    style={{ marginLeft: -16 }}
                  />

                  <TreeNode
                    node={child}
                    depth={depth + 1}
                    isExpanded={expandedIds.has(child.id)}
                    onToggle={() => onNodeToggle(child.id)}
                    onClick={() => onNodeClick?.(child)}
                    isSelected={selectedId === child.id}
                    expandedIds={expandedIds}
                    onNodeToggle={onNodeToggle}
                    onNodeClick={onNodeClick}
                    selectedId={selectedId}
                  />
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function countNodes(node: LineageNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

// Timeline view of lineage
interface LineageTimelineProps {
  nodes: LineageNode[];
  selectedId?: string;
  onNodeClick?: (node: LineageNode) => void;
  className?: string;
}

export function LineageTimeline({
  nodes,
  selectedId,
  onNodeClick,
  className
}: LineageTimelineProps) {
  // Flatten and sort by date
  const flattenNodes = useCallback((node: LineageNode): LineageNode[] => {
    const flatten = (n: LineageNode): LineageNode[] => [n, ...n.children.flatMap(flatten)];
    return flatten(node);
  }, []);

  const allNodes = useMemo(() => {
    return nodes.flatMap(flattenNodes).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }, [nodes, flattenNodes]);

  return (
    <div className={cn('flex flex-col', className)}>
      {allNodes.map((node, index) => (
        <div key={node.id} className="flex gap-4">
          {/* Timeline line */}
          <div className="flex flex-col items-center">
            <div className={cn(
              'w-3 h-3 rounded-full',
              tierConfig[node.tier].color,
              selectedId === node.id && 'ring-2 ring-offset-2 ring-offset-lattice-bg ring-neon-cyan'
            )} />
            {index < allNodes.length - 1 && (
              <div className="w-px flex-1 bg-lattice-border" />
            )}
          </div>

          {/* Content */}
          <button
            onClick={() => onNodeClick?.(node)}
            className={cn(
              'flex-1 text-left pb-6',
              selectedId === node.id && 'opacity-100'
            )}
          >
            <div className="flex items-center gap-2">
              <span className={cn(
                'text-sm',
                selectedId === node.id ? 'text-white font-medium' : 'text-gray-300'
              )}>
                {node.title}
              </span>
              {node.tier !== 'regular' && (
                <span className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded uppercase',
                  node.tier === 'mega' ? 'bg-neon-cyan/20 text-neon-cyan' :
                  node.tier === 'hyper' ? 'bg-neon-purple/20 text-neon-purple' :
                  'bg-gray-500/20 text-gray-400'
                )}>
                  {node.tier}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {formatRelativeTime(node.createdAt)}
            </p>
          </button>
        </div>
      ))}
    </div>
  );
}

