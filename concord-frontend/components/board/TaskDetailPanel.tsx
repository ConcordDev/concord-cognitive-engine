'use client';

import { useState } from 'react';
import {
  X, Plus, Paperclip, MessageSquare, Clock, CheckCircle2,
  Check, Circle, FileText, Upload, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { generateId } from '@/lib/utils';
import {
  type Task, type Priority, type TaskType, type Comment,
  columns, priorityConfig, typeConfig, labels, assignees,
  isOverdue, formatDate, avatarColor,
} from './board-shared';

export function TaskDetailPanel({
  task,
  onClose,
  onUpdate,
  onToggleSubtask,
  onDelete,
}: {
  task: Task;
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<Task>) => void;
  onToggleSubtask: (taskId: string, subtaskId: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [newSubtask, setNewSubtask] = useState('');
  const [newComment, setNewComment] = useState('');
  const [activeTab, setActiveTab] = useState<'details' | 'activity' | 'files'>('details');

  const col = columns.find((c) => c.id === task.status);

  return (
    <div data-lens-theme="board" className="p-5 space-y-5 min-h-full">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                onUpdate(task.id, { title: titleDraft });
                setEditingTitle(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onUpdate(task.id, { title: titleDraft });
                  setEditingTitle(false);
                }
              }}
              className="w-full text-lg font-bold bg-transparent border-b border-purple-500/50 text-white focus:outline-none pb-0.5"
            />
          ) : (
            <h2
              className="text-lg font-bold text-white cursor-pointer hover:text-purple-300 transition-colors"
              onClick={() => setEditingTitle(true)}
            >
              {task.title}
            </h2>
          )}
          {col && (
            <div className="flex items-center gap-1.5 mt-1">
              <div className={cn('w-2 h-2 rounded-full', col.color.replace('text-', 'bg-'))} />
              <span className={cn('text-xs', col.color)}>{col.name}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onDelete(task.id)}
            className="p-1 rounded-md hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors"
            title="Delete task"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-gray-400 leading-relaxed">
        {task.description || 'No description.'}
      </p>

      {/* Meta grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Assignee */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-gray-400">Assignee</label>
          <select
            value={task.assignee}
            onChange={(e) => onUpdate(task.id, { assignee: e.target.value })}
            className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded-md text-gray-300 focus:outline-none focus:border-purple-500/50"
          >
            {assignees.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        {/* Priority */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-gray-400">Priority</label>
          <select
            value={task.priority}
            onChange={(e) => onUpdate(task.id, { priority: e.target.value as Priority })}
            className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded-md text-gray-300 focus:outline-none focus:border-purple-500/50"
          >
            {Object.entries(priorityConfig).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        {/* Type */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-gray-400">Type</label>
          <select
            value={task.type}
            onChange={(e) => onUpdate(task.id, { type: e.target.value as TaskType })}
            className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded-md text-gray-300 focus:outline-none focus:border-purple-500/50"
          >
            {Object.entries(typeConfig).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        {/* Label */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-gray-400">Label</label>
          <select
            value={task.label}
            onChange={(e) => onUpdate(task.id, { label: e.target.value })}
            className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded-md text-gray-300 focus:outline-none focus:border-purple-500/50"
          >
            {labels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        {/* Due date */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-gray-400">Due Date</label>
          <input
            type="date"
            value={task.dueDate}
            onChange={(e) => onUpdate(task.id, { dueDate: e.target.value })}
            className={cn(
              'w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded-md focus:outline-none focus:border-purple-500/50',
              isOverdue(task.dueDate) && task.status !== 'done' ? 'text-red-400' : 'text-gray-300'
            )}
          />
        </div>

        {/* Estimate */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-gray-400">Estimate</label>
          <input
            type="text"
            value={task.estimate ?? ''}
            onChange={(e) => onUpdate(task.id, { estimate: e.target.value || undefined })}
            placeholder="e.g. 2h, 1d"
            className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded-md text-gray-300 focus:outline-none focus:border-purple-500/50"
          />
        </div>
      </div>

      {/* Progress */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[10px] uppercase tracking-wider text-gray-400">Progress</label>
          <span className="text-xs text-gray-400">{task.progress}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={task.progress}
          onChange={(e) => onUpdate(task.id, { progress: parseInt(e.target.value) })}
          className="w-full h-1.5 rounded-full appearance-none bg-white/10 accent-purple-500"
        />
      </div>

      {/* Tab switcher */}
      <div className="flex border-b border-white/[0.08]">
        {(['details', 'activity', 'files'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-3 py-2 text-xs font-medium capitalize border-b-2 transition-colors -mb-px',
              activeTab === tab
                ? 'border-purple-500 text-purple-300'
                : 'border-transparent text-gray-400 hover:text-gray-300'
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'details' && (
        <div className="space-y-4">
          {/* Subtasks */}
          <div>
            <h4 className="text-xs font-semibold text-gray-400 mb-2 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Subtasks ({task.subtasks.filter((s) => s.done).length}/{task.subtasks.length})
            </h4>
            <div className="space-y-1">
              {task.subtasks.map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => onToggleSubtask(task.id, sub.id)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-white/5 text-left transition-colors"
                >
                  {sub.done ? (
                    <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                  ) : (
                    <Circle className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
                  )}
                  <span
                    className={cn(
                      'text-sm',
                      sub.done ? 'text-gray-400 line-through' : 'text-gray-300'
                    )}
                  >
                    {sub.title}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex gap-1.5 mt-2">
              <input
                type="text"
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newSubtask.trim()) {
                    const updated = [
                      ...task.subtasks,
                      { id: generateId(), title: newSubtask.trim(), done: false },
                    ];
                    onUpdate(task.id, { subtasks: updated });
                    setNewSubtask('');
                  }
                }}
                placeholder="Add subtask..."
                className="flex-1 px-2 py-1 text-xs bg-white/5 border border-white/10 rounded-md text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/40"
              />
              <button
                onClick={() => {
                  if (newSubtask.trim()) {
                    const updated = [
                      ...task.subtasks,
                      { id: generateId(), title: newSubtask.trim(), done: false },
                    ];
                    onUpdate(task.id, { subtasks: updated });
                    setNewSubtask('');
                  }
                }}
                className="p-1 rounded-md bg-white/5 hover:bg-white/10 text-gray-400"
              aria-label="Add">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Comments */}
          <div>
            <h4 className="text-xs font-semibold text-gray-400 mb-2 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5" />
              Comments ({task.comments.length})
            </h4>
            <div className="space-y-2">
              {task.comments.map((c) => (
                <div
                  key={c.id}
                  className="p-2 rounded-md bg-white/[0.03] border border-white/[0.06]"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className={cn(
                        'w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white',
                        avatarColor(c.author)
                      )}
                    >
                      {c.author[0]}
                    </div>
                    <span className="text-xs font-medium text-gray-300">{c.author}</span>
                    <span className="text-[10px] text-gray-400">{formatDate(c.timestamp)}</span>
                  </div>
                  <p className="text-xs text-gray-400 pl-6">{c.text}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5 mt-2">
              <input
                type="text"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newComment.trim()) {
                    const updated: Comment[] = [
                      ...task.comments,
                      {
                        id: generateId(),
                        author: 'You',
                        text: newComment.trim(),
                        timestamp: new Date().toISOString(),
                      },
                    ];
                    onUpdate(task.id, { comments: updated, commentCount: updated.length });
                    setNewComment('');
                  }
                }}
                placeholder="Add comment..."
                className="flex-1 px-2 py-1 text-xs bg-white/5 border border-white/10 rounded-md text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/40"
              />
              <button
                onClick={() => {
                  if (newComment.trim()) {
                    const updated: Comment[] = [
                      ...task.comments,
                      {
                        id: generateId(),
                        author: 'You',
                        text: newComment.trim(),
                        timestamp: new Date().toISOString(),
                      },
                    ];
                    onUpdate(task.id, { comments: updated, commentCount: updated.length });
                    setNewComment('');
                  }
                }}
                className="p-1 rounded-md bg-purple-500/20 hover:bg-purple-500/30 text-purple-300"
              aria-label="Message">
                <MessageSquare className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'activity' && (
        <div className="space-y-2">
          {task.activity.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-4">No activity yet.</p>
          )}
          {task.activity.map((a) => (
            <div key={a.id} className="flex items-start gap-2 text-xs">
              <Clock className="w-3.5 h-3.5 text-gray-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-gray-400">{a.action}</p>
                <p className="text-gray-600 text-[10px]">{formatDate(a.timestamp)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'files' && (
        <div className="space-y-2">
          {task.files.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-4">No files attached.</p>
          )}
          {task.files.map((file, i) => (
            <div
              key={i}
              className="flex items-center gap-2 p-2 rounded-md bg-white/[0.03] border border-white/[0.06]"
            >
              <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span className="text-xs text-gray-300 truncate flex-1">{file}</span>
              <Paperclip className="w-3 h-3 text-gray-600 flex-shrink-0" />
            </div>
          ))}
          <button
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.click();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 w-full rounded-md border border-dashed border-white/10 text-xs text-gray-400 hover:text-gray-300 hover:border-white/20 transition-colors justify-center"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload file
          </button>
        </div>
      )}
    </div>
  );
}
