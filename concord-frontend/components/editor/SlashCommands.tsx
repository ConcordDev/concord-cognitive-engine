'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Fuse from 'fuse.js';
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code,
  Image,
  Table,
  Minus,
  FileText,
  Link2,
  Calendar,
  Tag,
  AtSign,
  Brain,
  Sparkles,
  Search,
  GitBranch,
  MessageSquare,
  Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Editor } from '@tiptap/core';

// Helper: extract selected text from editor for AI actions
function getEditorSelectedText(editor: Editor): string {
  const { from, to } = editor.state.selection;
  if (from === to) return editor.state.selection.$anchor.parent.textContent;
  return editor.state.doc.textBetween(from, to, ' ');
}

// Helper: dispatch typed CustomEvent for cross-component communication
function dispatchEditorEvent(name: string, detail?: Record<string, unknown>) {
  document.dispatchEvent(new CustomEvent(name, { detail }));
}

export interface SlashCommand {
  id: string;
  icon: React.ComponentType<{ className?: string; size?: number | string }>;
  label: string;
  description: string;
  keywords: string[];
  category: 'basic' | 'media' | 'advanced' | 'dtu' | 'ai';
  action: (editor: Editor) => void;
}

// Default slash commands
export const defaultCommands: SlashCommand[] = [
  // Basic
  {
    id: 'text',
    icon: Type,
    label: 'Text',
    description: 'Plain text paragraph',
    keywords: ['paragraph', 'plain', 'text'],
    category: 'basic',
    action: (editor) => editor.chain().focus().setParagraph().run()
  },
  {
    id: 'h1',
    icon: Heading1,
    label: 'Heading 1',
    description: 'Large heading',
    keywords: ['h1', 'heading', 'title', 'large'],
    category: 'basic',
    action: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run()
  },
  {
    id: 'h2',
    icon: Heading2,
    label: 'Heading 2',
    description: 'Medium heading',
    keywords: ['h2', 'heading', 'subtitle', 'medium'],
    category: 'basic',
    action: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run()
  },
  {
    id: 'h3',
    icon: Heading3,
    label: 'Heading 3',
    description: 'Small heading',
    keywords: ['h3', 'heading', 'small'],
    category: 'basic',
    action: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run()
  },
  {
    id: 'bullet',
    icon: List,
    label: 'Bullet List',
    description: 'Create a bullet list',
    keywords: ['bullet', 'list', 'unordered', 'ul'],
    category: 'basic',
    action: (editor) => editor.chain().focus().toggleBulletList().run()
  },
  {
    id: 'numbered',
    icon: ListOrdered,
    label: 'Numbered List',
    description: 'Create a numbered list',
    keywords: ['numbered', 'list', 'ordered', 'ol'],
    category: 'basic',
    action: (editor) => editor.chain().focus().toggleOrderedList().run()
  },
  {
    id: 'todo',
    icon: CheckSquare,
    label: 'To-do List',
    description: 'Create a task list',
    keywords: ['todo', 'task', 'checkbox', 'checklist'],
    category: 'basic',
    action: (editor) => editor.chain().focus().toggleTaskList().run()
  },
  {
    id: 'quote',
    icon: Quote,
    label: 'Quote',
    description: 'Create a blockquote',
    keywords: ['quote', 'blockquote', 'citation'],
    category: 'basic',
    action: (editor) => editor.chain().focus().toggleBlockquote().run()
  },
  {
    id: 'code',
    icon: Code,
    label: 'Code Block',
    description: 'Insert code snippet',
    keywords: ['code', 'snippet', 'programming'],
    category: 'basic',
    action: (editor) => editor.chain().focus().toggleCodeBlock().run()
  },
  {
    id: 'divider',
    icon: Minus,
    label: 'Divider',
    description: 'Insert horizontal line',
    keywords: ['divider', 'line', 'separator', 'hr'],
    category: 'basic',
    action: (editor) => editor.chain().focus().setHorizontalRule().run()
  },

  // Media
  {
    id: 'image',
    icon: Image,
    label: 'Image',
    description: 'Insert an image',
    keywords: ['image', 'picture', 'photo', 'img'],
    category: 'media',
    action: (editor) => {
      const url = window.prompt('Enter image URL');
      if (url) {
        editor.chain().focus().setImage({ src: url }).run();
      }
    }
  },
  {
    id: 'table',
    icon: Table,
    label: 'Table',
    description: 'Insert a table',
    keywords: ['table', 'grid', 'spreadsheet'],
    category: 'media',
    action: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
  },
  {
    id: 'link',
    icon: Link2,
    label: 'Link',
    description: 'Insert a link',
    keywords: ['link', 'url', 'href'],
    category: 'media',
    action: (editor) => {
      const url = window.prompt('Enter URL');
      if (url) {
        editor.chain().focus().setLink({ href: url }).run();
      }
    }
  },

  // DTU specific
  {
    id: 'dtu-link',
    icon: Brain,
    label: 'Link DTU',
    description: 'Link to another DTU',
    keywords: ['dtu', 'link', 'reference', 'connect'],
    category: 'dtu',
    action: (editor) => {
      dispatchEditorEvent('toggle-global-search', { mode: 'dtu-link', editorCallback: (id: string, title: string) => {
        editor.chain().focus().insertContent(`[[${title}|dtu:${id}]]`).run();
      }});
    }
  },
  {
    id: 'dtu-embed',
    icon: FileText,
    label: 'Embed DTU',
    description: 'Embed DTU content inline',
    keywords: ['dtu', 'embed', 'transclusion'],
    category: 'dtu',
    action: (editor) => {
      dispatchEditorEvent('toggle-global-search', { mode: 'dtu-embed', editorCallback: (id: string, title: string) => {
        editor.chain().focus().insertContent(`{{embed:${id}|${title}}}`).run();
      }});
    }
  },
  {
    id: 'tag',
    icon: Tag,
    label: 'Add Tag',
    description: 'Add a tag to this DTU',
    keywords: ['tag', 'label', 'category'],
    category: 'dtu',
    action: (editor) => {
      const tag = window.prompt('Enter tag name:');
      if (tag) {
        editor.chain().focus().insertContent(`#${tag.replace(/\s+/g, '-')}`).run();
      }
    }
  },
  {
    id: 'mention',
    icon: AtSign,
    label: 'Mention',
    description: 'Mention a person or DTU',
    keywords: ['mention', 'at', 'person', 'user'],
    category: 'dtu',
    action: (editor) => {
      dispatchEditorEvent('toggle-global-search', { mode: 'mention', editorCallback: (id: string, name: string) => {
        editor.chain().focus().insertContent(`@${name}`).run();
      }});
    }
  },
  {
    id: 'date',
    icon: Calendar,
    label: 'Date',
    description: 'Insert a date',
    keywords: ['date', 'calendar', 'time', 'deadline'],
    category: 'dtu',
    action: (editor) => {
      const today = new Date().toLocaleDateString();
      editor.chain().focus().insertContent(`@${today}`).run();
    }
  },

  // AI
  {
    id: 'ai-expand',
    icon: Sparkles,
    label: 'AI: Expand',
    description: 'Expand on selected text with AI',
    keywords: ['ai', 'expand', 'elaborate', 'more'],
    category: 'ai',
    action: (editor) => {
      const selectedText = getEditorSelectedText(editor);
      dispatchEditorEvent('toggle-ai-assist', { selectedText, action: 'expand' });
    }
  },
  {
    id: 'ai-summarize',
    icon: Zap,
    label: 'AI: Summarize',
    description: 'Summarize selected text',
    keywords: ['ai', 'summarize', 'tldr', 'brief'],
    category: 'ai',
    action: (editor) => {
      const selectedText = getEditorSelectedText(editor);
      dispatchEditorEvent('toggle-ai-assist', { selectedText, action: 'summarize' });
    }
  },
  {
    id: 'ai-question',
    icon: MessageSquare,
    label: 'AI: Ask Question',
    description: 'Ask AI about selected text',
    keywords: ['ai', 'question', 'ask', 'help'],
    category: 'ai',
    action: (editor) => {
      const selectedText = getEditorSelectedText(editor);
      dispatchEditorEvent('toggle-ai-assist', { selectedText, action: 'question' });
    }
  },
  {
    id: 'ai-connections',
    icon: GitBranch,
    label: 'AI: Find Connections',
    description: 'Find related DTUs',
    keywords: ['ai', 'connections', 'related', 'similar'],
    category: 'ai',
    action: (editor) => {
      const selectedText = getEditorSelectedText(editor);
      dispatchEditorEvent('toggle-ai-assist', { selectedText, action: 'connections' });
    }
  }
];

const categoryLabels: Record<string, string> = {
  basic: 'Basic Blocks',
  media: 'Media',
  dtu: 'DTU & Links',
  advanced: 'Advanced',
  ai: 'AI Assist'
};

interface SlashCommandMenuProps {
  editor: Editor;
  isOpen: boolean;
  onClose: () => void;
  position: { top: number; left: number };
  commands?: SlashCommand[];
}

export function SlashCommandMenu({
  editor,
  isOpen,
  onClose,
  position,
  commands = defaultCommands
}: SlashCommandMenuProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  // Fuzzy search
  const fuse = new Fuse(commands, {
    keys: ['label', 'description', 'keywords'],
    threshold: 0.4
  });

  const filteredCommands = query
    ? fuse.search(query).map(r => r.item)
    : commands;

  // Group by category
  const groupedCommands = filteredCommands.reduce((acc, cmd) => {
    if (!acc[cmd.category]) acc[cmd.category] = [];
    acc[cmd.category].push(cmd);
    return acc;
  }, {} as Record<string, SlashCommand[]>);

  // Flatten for navigation
  const flatCommands = Object.values(groupedCommands).flat();

  const executeCommand = useCallback((command: SlashCommand) => {
    command.action(editor);
    onClose();
    setQuery('');
  }, [editor, onClose]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, flatCommands.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (flatCommands[selectedIndex]) {
          executeCommand(flatCommands[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedIndex, flatCommands, executeCommand, onClose]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.15 }}
          style={{
            position: 'fixed',
            top: position.top,
            left: position.left,
            zIndex: 50
          }}
          className="w-80 bg-lattice-bg border border-lattice-border rounded-lg shadow-2xl overflow-hidden"
        >
          {/* Search Input */}
          <div className="p-2 border-b border-lattice-border">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-lattice-surface rounded">
              <Search className="w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search commands..."
                className="flex-1 bg-transparent text-white text-sm focus:outline-none placeholder-gray-500"
                autoFocus
              />
            </div>
          </div>

          {/* Commands List */}
          <div className="max-h-80 overflow-y-auto p-1">
            {Object.entries(groupedCommands).map(([category, cmds]) => (
              <div key={category} className="mb-2 last:mb-0">
                <div className="px-2 py-1">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {categoryLabels[category] || category}
                  </span>
                </div>
                {cmds.map((cmd) => {
                  const Icon = cmd.icon;
                  const globalIndex = flatCommands.indexOf(cmd);
                  const isSelected = globalIndex === selectedIndex;

                  return (
                    <button
                      key={cmd.id}
                      onClick={() => executeCommand(cmd)}
                      onMouseEnter={() => setSelectedIndex(globalIndex)}
                      className={cn(
                        'w-full flex items-center gap-3 px-2 py-2 rounded-md transition-colors text-left',
                        isSelected
                          ? 'bg-neon-cyan/20 text-white'
                          : 'text-gray-300 hover:bg-lattice-surface'
                      )}
                    >
                      <div className={cn(
                        'p-1.5 rounded',
                        isSelected ? 'bg-neon-cyan/30' : 'bg-lattice-surface'
                      )}>
                        <Icon className={cn(
                          'w-4 h-4',
                          isSelected ? 'text-neon-cyan' : 'text-gray-400'
                        )} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{cmd.label}</p>
                        <p className="text-xs text-gray-500 truncate">{cmd.description}</p>
                      </div>
                      {cmd.category === 'ai' && (
                        <Sparkles className="w-3 h-3 text-neon-purple" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}

            {flatCommands.length === 0 && (
              <div className="px-3 py-6 text-center">
                <p className="text-sm text-gray-400">No commands found</p>
              </div>
            )}
          </div>

          {/* Footer hint */}
          <div className="px-3 py-2 border-t border-lattice-border bg-lattice-surface/30">
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-lattice-surface border border-lattice-border rounded">↑↓</kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-lattice-surface border border-lattice-border rounded">↵</kbd>
                select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-lattice-surface border border-lattice-border rounded">esc</kbd>
                close
              </span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Hook to detect slash command trigger
export function useSlashCommand(editor: Editor | null) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!editor) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === '/' && !isOpen) {
        // Check if we're at the start of a line or after whitespace
        const { selection } = editor.state;
        const { $from } = selection;
        const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);

        if (textBefore === '' || textBefore.endsWith(' ')) {
          // Get cursor position
          const coords = editor.view.coordsAtPos(selection.from);
          setPosition({
            top: coords.bottom + 5,
            left: coords.left
          });
          setIsOpen(true);
        }
      }
    };

    editor.view.dom.addEventListener('keydown', handleKeyDown);
    return () => editor.view.dom.removeEventListener('keydown', handleKeyDown);
  }, [editor, isOpen]);

  return {
    isOpen,
    position,
    close: () => setIsOpen(false)
  };
}
