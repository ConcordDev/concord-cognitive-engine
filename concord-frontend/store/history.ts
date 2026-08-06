import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

// Generic action type for undo/redo
export interface HistoryAction {
  id: string;
  type: string;
  timestamp: number;
  description: string;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
}

interface HistoryState {
  past: HistoryAction[];
  future: HistoryAction[];
  maxSize: number;
  isUndoing: boolean;
  isRedoing: boolean;
}

interface HistoryActions {
  push: (action: Omit<HistoryAction, 'id' | 'timestamp'>) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
  getLastAction: () => HistoryAction | null;
}

export const useHistoryStore = create<HistoryState & HistoryActions>()(
  immer((set, get) => ({
    past: [],
    future: [],
    maxSize: 100,
    isUndoing: false,
    isRedoing: false,

    push: (action) => {
      const fullAction: HistoryAction = {
        ...action,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        timestamp: Date.now()
      };

      set((state) => {
        state.past.push(fullAction);
        // Trim if exceeds max size
        if (state.past.length > state.maxSize) {
          state.past = state.past.slice(-state.maxSize);
        }
        // Clear future on new action
        state.future = [];
      });
    },

    undo: async () => {
      const { past, isUndoing } = get();
      if (past.length === 0 || isUndoing) return;

      const action = past[past.length - 1];

      set((state) => {
        state.isUndoing = true;
      });

      try {
        await action.undo();

        set((state) => {
          state.past.pop();
          state.future.unshift(action);
          state.isUndoing = false;
        });
      } catch (error) {
        console.error('Undo failed:', error);
        set((state) => {
          state.isUndoing = false;
        });
      }
    },

    redo: async () => {
      const { future, isRedoing } = get();
      if (future.length === 0 || isRedoing) return;

      const action = future[0];

      set((state) => {
        state.isRedoing = true;
      });

      try {
        await action.redo();

        set((state) => {
          state.future.shift();
          state.past.push(action);
          state.isRedoing = false;
        });
      } catch (error) {
        console.error('Redo failed:', error);
        set((state) => {
          state.isRedoing = false;
        });
      }
    },

    canUndo: () => {
      const { past, isUndoing } = get();
      return past.length > 0 && !isUndoing;
    },

    canRedo: () => {
      const { future, isRedoing } = get();
      return future.length > 0 && !isRedoing;
    },

    clear: () => {
      set((state) => {
        state.past = [];
        state.future = [];
      });
    },

    getLastAction: () => {
      const { past } = get();
      return past.length > 0 ? past[past.length - 1] : null;
    }
  }))
);

// Helper hook for components to easily create undoable actions
export function createUndoableAction<T>(
  description: string,
  execute: () => T | Promise<T>,
  undoFn: (result: T) => void | Promise<void>
): () => Promise<T> {
  return async () => {
    const result = await execute();

    useHistoryStore.getState().push({
      type: 'action',
      description,
      undo: () => undoFn(result),
      redo: async () => { await execute(); }
    });

    return result;
  };
}

// Batch multiple actions into one undoable unit
export async function batchUndoable(
  description: string,
  actions: Array<{ execute: () => void | Promise<void>; undo: () => void | Promise<void> }>
) {
  // Execute all actions
  for (const action of actions) {
    await action.execute();
  }

  // Push as single undoable
  useHistoryStore.getState().push({
    type: 'batch',
    description,
    undo: async () => {
      // Undo in reverse order
      for (let i = actions.length - 1; i >= 0; i--) {
        await actions[i].undo();
      }
    },
    redo: async () => {
      for (const action of actions) {
        await action.execute();
      }
    }
  });
}
