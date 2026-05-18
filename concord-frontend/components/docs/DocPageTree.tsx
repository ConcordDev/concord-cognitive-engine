'use client';

import { useState } from 'react';
import { ChevronRight, ChevronDown, FileText, Plus } from 'lucide-react';

interface Doc {
  id: string;
  title: string;
  icon?: string | null;
  parent_id?: string | null;
}

interface Props {
  docs: Doc[];
  rootDocs: Doc[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreateChild: (parentId: string) => void;
}

export function DocPageTree({ docs, rootDocs, activeId, onSelect, onCreateChild }: Props) {
  return (
    <div className="space-y-0.5">
      {rootDocs.length === 0 ? (
        <div className="text-xs text-white/40 px-2 py-4 text-center">
          No documents yet. Create one with the + button above.
        </div>
      ) : (
        rootDocs.map((doc) => (
          <DocNode
            key={doc.id}
            doc={doc}
            allDocs={docs}
            depth={0}
            activeId={activeId}
            onSelect={onSelect}
            onCreateChild={onCreateChild}
          />
        ))
      )}
    </div>
  );
}

function DocNode({ doc, allDocs, depth, activeId, onSelect, onCreateChild }: {
  doc: Doc;
  allDocs: Doc[];
  depth: number;
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreateChild: (parentId: string) => void;
}) {
  const children = allDocs.filter((d) => d.parent_id === doc.id);
  const [expanded, setExpanded] = useState(depth < 1);
  const isActive = activeId === doc.id;
  const hasChildren = children.length > 0;
  return (
    <div>
      <div
        className={`group flex items-center gap-1 px-1 py-1 rounded text-sm cursor-pointer hover:bg-white/5 ${
          isActive ? 'bg-cyan-500/10 text-cyan-200' : 'text-white/80'
        }`}
        style={{ paddingLeft: 4 + depth * 12 }}
        onClick={() => onSelect(doc.id)}
      >
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded((x) => !x); }}
          className="p-0.5 rounded hover:bg-white/10"
        >
          {hasChildren
            ? (expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />)
            : <span className="w-3 h-3 inline-block" />}
        </button>
        <span className="text-white/40 text-xs">{doc.icon || <FileText className="w-3.5 h-3.5 inline" />}</span>
        <span className="flex-1 truncate">{doc.title || 'Untitled'}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onCreateChild(doc.id); }}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/10"
          title="Add child page"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
      {expanded && hasChildren && (
        <div>
          {children.map((c) => (
            <DocNode
              key={c.id}
              doc={c}
              allDocs={allDocs}
              depth={depth + 1}
              activeId={activeId}
              onSelect={onSelect}
              onCreateChild={onCreateChild}
            />
          ))}
        </div>
      )}
    </div>
  );
}
