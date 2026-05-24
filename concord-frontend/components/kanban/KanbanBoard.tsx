'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plus,
  GripVertical,
  Trash2,
  Clock,
  User,
  Pencil
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface KanbanCard {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  dueDate?: string;
  assignee?: string;
  color?: string;
  dtuId?: string;
}

interface KanbanColumn {
  id: string;
  title: string;
  cards: KanbanCard[];
  color?: string;
}

interface KanbanBoardProps {
  columns: KanbanColumn[];
  onMoveCard?: (cardId: string, fromColumn: string, toColumn: string, index: number) => void;
  onAddCard?: (columnId: string, title: string) => void;
  onUpdateCard?: (cardId: string, updates: Partial<KanbanCard>) => void;
  onDeleteCard?: (cardId: string, columnId: string) => void;
  onAddColumn?: (title: string) => void;
  onDeleteColumn?: (columnId: string) => void;
  onSelectCard?: (card: KanbanCard) => void;
  className?: string;
}

export function KanbanBoard({
  columns,
  onMoveCard,
  onAddCard,
  onUpdateCard,
  onDeleteCard,
  onAddColumn,
  onDeleteColumn,
  onSelectCard,
  className
}: KanbanBoardProps) {
  const [draggedCard, setDraggedCard] = useState<{ card: KanbanCard; columnId: string } | null>(null);
  const [addingToColumn, setAddingToColumn] = useState<string | null>(null);
  const [newCardTitle, setNewCardTitle] = useState('');
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnTitle, setNewColumnTitle] = useState('');
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editingCardTitle, setEditingCardTitle] = useState('');

  const handleDragStart = (card: KanbanCard, columnId: string) => {
    setDraggedCard({ card, columnId });
  };

  const handleDragEnd = () => {
    setDraggedCard(null);
  };

  const handleDrop = (columnId: string, index: number = -1) => {
    if (draggedCard && draggedCard.columnId !== columnId) {
      onMoveCard?.(draggedCard.card.id, draggedCard.columnId, columnId, index);
    }
    setDraggedCard(null);
  };

  const handleAddCard = (columnId: string) => {
    if (newCardTitle.trim()) {
      onAddCard?.(columnId, newCardTitle.trim());
      setNewCardTitle('');
      setAddingToColumn(null);
    }
  };

  const handleAddColumn = () => {
    if (newColumnTitle.trim()) {
      onAddColumn?.(newColumnTitle.trim());
      setNewColumnTitle('');
      setAddingColumn(false);
    }
  };

  const getColumnColor = (color?: string) => {
    if (color) return color;
    return 'bg-lattice-surface';
  };

  return (
    <div className={cn('flex h-full overflow-x-auto gap-4 p-4', className)}>
      {columns.map(column => (
        <div
          key={column.id}
          className="flex-shrink-0 w-72 flex flex-col"
          onDragOver={(e) => {
            e.preventDefault();
            e.currentTarget.classList.add('ring-2', 'ring-neon-cyan');
          }}
          onDragLeave={(e) => {
            e.currentTarget.classList.remove('ring-2', 'ring-neon-cyan');
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove('ring-2', 'ring-neon-cyan');
            handleDrop(column.id);
          }}
        >
          {/* Column header */}
          <div className={cn(
            'px-3 py-2 rounded-t-lg flex items-center justify-between',
            getColumnColor(column.color)
          )}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white">{column.title}</span>
              <span className="text-xs text-gray-400 bg-lattice-bg px-1.5 py-0.5 rounded">
                {column.cards.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setAddingToColumn(column.id)}
                className="p-1 text-gray-400 hover:text-white transition-colors"
              aria-label="Add">
                <Plus className="w-4 h-4" />
              </button>
              {onDeleteColumn && (
                <button
                  onClick={() => onDeleteColumn(column.id)}
                  className="p-1 text-gray-400 hover:text-red-400 transition-colors"
                aria-label="Delete">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Cards container */}
          <div className="flex-1 bg-lattice-bg/50 rounded-b-lg p-2 space-y-2 overflow-y-auto">
            {/* Add card input */}
            {addingToColumn === column.id && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="bg-lattice-surface rounded-lg p-2"
              >
                <input
                  type="text"
                  value={newCardTitle}
                  onChange={(e) => setNewCardTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddCard(column.id);
                    if (e.key === 'Escape') {
                      setAddingToColumn(null);
                      setNewCardTitle('');
                    }
                  }}
                  placeholder="Card title..."
                  className="w-full px-2 py-1 bg-lattice-bg border border-lattice-border rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan"
                  autoFocus
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => handleAddCard(column.id)}
                    className="flex-1 py-1 bg-neon-cyan text-black text-xs font-medium rounded hover:bg-neon-cyan/90 transition-colors"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => {
                      setAddingToColumn(null);
                      setNewCardTitle('');
                    }}
                    className="flex-1 py-1 bg-lattice-bg text-gray-400 text-xs rounded hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            )}

            {/* Cards */}
            {column.cards.map((card, _index) => (
              <motion.div
                key={card.id}
                layout
                draggable
                onDragStart={() => handleDragStart(card, column.id)}
                onDragEnd={handleDragEnd}
                onClick={() => onSelectCard?.(card)}
                className={cn(
                  'bg-lattice-surface border border-lattice-border rounded-lg p-3 cursor-pointer group',
                  'hover:border-gray-500 transition-colors',
                  draggedCard?.card.id === card.id && 'opacity-50'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  {editingCardId === card.id ? (
                    <input
                      type="text"
                      value={editingCardTitle}
                      onChange={(e) => setEditingCardTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          onUpdateCard?.(card.id, { title: editingCardTitle });
                          setEditingCardId(null);
                        }
                        if (e.key === 'Escape') setEditingCardId(null);
                      }}
                      onBlur={() => {
                        if (editingCardTitle.trim() && editingCardTitle !== card.title) {
                          onUpdateCard?.(card.id, { title: editingCardTitle });
                        }
                        setEditingCardId(null);
                      }}
                      className="flex-1 text-sm text-white bg-lattice-bg border border-lattice-border rounded px-1 py-0.5 focus:outline-none focus:border-neon-cyan"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <h3 className="text-sm text-white flex-1">{card.title}</h3>
                  )}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingCardId(card.id);
                        setEditingCardTitle(card.title);
                      }}
                      className="p-1 text-gray-400 hover:text-neon-cyan transition-colors"
                    aria-label="Edit">
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteCard?.(card.id, column.id);
                      }}
                      className="p-1 text-gray-400 hover:text-red-400 transition-colors"
                    aria-label="Delete">
                      <Trash2 className="w-3 h-3" />
                    </button>
                    <GripVertical className="w-3 h-3 text-gray-400 cursor-grab" />
                  </div>
                </div>

                {card.description && (
                  <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                    {card.description}
                  </p>
                )}

                {/* Tags */}
                {card.tags && card.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {card.tags.slice(0, 3).map(tag => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.5 text-[10px] bg-lattice-bg rounded text-gray-400"
                      >
                        {tag}
                      </span>
                    ))}
                    {card.tags.length > 3 && (
                      <span className="text-[10px] text-gray-400">
                        +{card.tags.length - 3}
                      </span>
                    )}
                  </div>
                )}

                {/* Footer */}
                {(card.dueDate || card.assignee) && (
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-lattice-border/50">
                    {card.dueDate && (
                      <span className="flex items-center gap-1 text-[10px] text-gray-400">
                        <Clock className="w-3 h-3" />
                        {new Date(card.dueDate).toLocaleDateString()}
                      </span>
                    )}
                    {card.assignee && (
                      <span className="flex items-center gap-1 text-[10px] text-gray-400">
                        <User className="w-3 h-3" />
                        {card.assignee}
                      </span>
                    )}
                  </div>
                )}
              </motion.div>
            ))}

            {column.cards.length === 0 && addingToColumn !== column.id && (
              <div className="py-8 text-center">
                <p className="text-xs text-gray-400">No cards</p>
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Add column */}
      {onAddColumn && (
        <div className="flex-shrink-0 w-72">
          {addingColumn ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-lattice-surface rounded-lg p-3"
            >
              <input
                type="text"
                value={newColumnTitle}
                onChange={(e) => setNewColumnTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddColumn();
                  if (e.key === 'Escape') {
                    setAddingColumn(false);
                    setNewColumnTitle('');
                  }
                }}
                placeholder="Column title..."
                className="w-full px-2 py-1 bg-lattice-bg border border-lattice-border rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan"
                autoFocus
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleAddColumn}
                  className="flex-1 py-1 bg-neon-cyan text-black text-xs font-medium rounded hover:bg-neon-cyan/90 transition-colors"
                >
                  Add Column
                </button>
                <button
                  onClick={() => {
                    setAddingColumn(false);
                    setNewColumnTitle('');
                  }}
                  className="flex-1 py-1 bg-lattice-bg text-gray-400 text-xs rounded hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          ) : (
            <button
              onClick={() => setAddingColumn(true)}
              className="w-full py-3 border-2 border-dashed border-lattice-border rounded-lg text-gray-400 hover:text-white hover:border-gray-500 transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Column
            </button>
          )}
        </div>
      )}
    </div>
  );
}
