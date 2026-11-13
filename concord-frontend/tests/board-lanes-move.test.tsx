import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BoardLanes } from '@/components/board/BoardLanes';
import type { Task } from '@/components/board/board-shared';

const task = {
  id: 't1',
  title: 'Move me',
  description: '',
  status: 'todo',
  priority: 'medium',
  type: 'task',
  assignee: '',
  label: '',
  progress: 0,
  dueDate: '2026-11-10',
  attachments: 0,
  commentCount: 0,
  subtasks: [],
  comments: [],
  activity: [],
  files: [],
} as Task;

describe('board lane moves without a drag', () => {
  it('moves a card to Doing from the phone control', () => {
    const onMove = vi.fn();
    render(<BoardLanes tasks={[task]} onOpen={vi.fn()} onMove={onMove} onAdd={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move to Doing' }));
    expect(onMove).toHaveBeenCalledWith('t1', 'in_progress');
  });
});
