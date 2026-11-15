import Dexie, { Table } from 'dexie';

// DTU record for offline storage
export interface DTURecord {
  id: string;
  tier: 'regular' | 'mega' | 'hyper' | 'shadow';
  content: string;
  summary: string;
  timestamp: string;
  parentId?: string;
  tags?: string[];
  resonance?: number;
  synced: boolean;
  localOnly?: boolean;
  _version?: number;           // Category 2: Optimistic locking version
  _serverTimestamp?: string;   // Category 4: Server-authoritative timestamp
}

// Pending action for sync
interface PendingAction {
  id: string;
  type: 'create' | 'update' | 'delete';
  entity: 'dtu' | 'chat' | 'market';
  payload: unknown;
  timestamp: string;
  attempts: number;
  fingerprint?: string;  // Category 4: Dedup fingerprint
  quarantined?: boolean; // Category 4: Quarantine after max attempts
}

// Chat message for offline
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  synced: boolean;
}

// ---- Conflict Resolution (Category 4: Offline Sync) ----
export interface ConflictRecord {
  id: string;
  entityType: 'dtu' | 'chat' | 'market';
  entityId: string;
  localVersion: unknown;
  serverVersion: unknown;
  resolution: 'pending' | 'local_wins' | 'server_wins' | 'merged';
  createdAt: string;
}

// Chat session for multi-session conversation workspace
export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  archived: boolean;
  folder?: string;
  messageCount: number;
  lastMessagePreview?: string;
  compressionCount: number;
}

// Session message — stored per-session in IndexedDB
export interface SessionMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  imageBase64?: string;
  meta?: Record<string, unknown>;
}

// Offline database using Dexie
class ConcordDB extends Dexie {
  dtus!: Table<DTURecord, string>;
  pendingActions!: Table<PendingAction, string>;
  chatMessages!: Table<ChatMessage, string>;
  conflicts!: Table<ConflictRecord, string>;
  chatSessions!: Table<ChatSession, string>;
  sessionMessages!: Table<SessionMessage, string>;

  constructor() {
    super('ConcordDB');

    // Schema version 3: adds chatSessions + sessionMessages tables
    this.version(3).stores({
      dtus: 'id, tier, timestamp, parentId, synced',
      pendingActions: 'id, type, entity, timestamp, fingerprint',
      chatMessages: 'id, role, timestamp, synced',
      conflicts: 'id, entityType, entityId, resolution, createdAt',
      chatSessions: 'id, pinned, archived, updatedAt, folder',
      sessionMessages: 'id, sessionId, role, timestamp',
    });

    // Schema version 2: adds conflicts table, fingerprint+quarantine on pendingActions
    this.version(2).stores({
      dtus: 'id, tier, timestamp, parentId, synced',
      pendingActions: 'id, type, entity, timestamp, fingerprint',
      chatMessages: 'id, role, timestamp, synced',
      conflicts: 'id, entityType, entityId, resolution, createdAt',
    }).upgrade(tx => {
      // Migration from v1: no data changes needed, just schema
      return tx.table('pendingActions').toCollection().modify(action => {
        if (!action.fingerprint) {
          action.fingerprint = generateFingerprint(action.type, action.entity, action.payload);
        }
      });
    });

    // Keep v1 for existing databases that haven't upgraded
    this.version(1).stores({
      dtus: 'id, tier, timestamp, parentId, synced',
      pendingActions: 'id, type, entity, timestamp',
      chatMessages: 'id, role, timestamp, synced',
    });
  }
}

// ---- Dedup Fingerprint (Category 4: Replay Prevention) ----
function generateFingerprint(type: string, entity: string, payload: unknown): string {
  // Create a deterministic hash of the action for dedup
  const data = JSON.stringify({ type, entity, payload });
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return `fp_${Math.abs(hash).toString(36)}`;
}

// ---- Clock Normalization (Category 4: Offline Sync) ----
// Track offset between local and server clocks
let _serverClockOffset = 0;

export function updateClockOffset(serverTimestamp: string): void {
  const serverTime = new Date(serverTimestamp).getTime();
  const localTime = Date.now();
  if (!isNaN(serverTime)) {
    _serverClockOffset = serverTime - localTime;
  }
}

export function getNormalizedTimestamp(): string {
  return new Date(Date.now() + _serverClockOffset).toISOString();
}

// ---- Max Attempts & Quarantine (Category 4: Offline Sync) ----
const MAX_SYNC_ATTEMPTS = 5;

// Singleton instance
let db: ConcordDB | null = null;

export function getDB(): ConcordDB {
  if (!db) {
    db = new ConcordDB();
  }
  return db;
}

// DTU operations
export const dtuOffline = {
  async getAll(): Promise<DTURecord[]> {
    return getDB().dtus.toArray();
  },

  async get(id: string): Promise<DTURecord | undefined> {
    return getDB().dtus.get(id);
  },

  async put(dtu: DTURecord): Promise<void> {
    await getDB().dtus.put(dtu);
  },

  async delete(id: string): Promise<void> {
    await getDB().dtus.delete(id);
  },

  async getUnsynced(): Promise<DTURecord[]> {
    return getDB().dtus.filter(dtu => !dtu.synced).toArray();
  },

  async markSynced(id: string): Promise<void> {
    await getDB().dtus.update(id, { synced: true });
  },

  async bulkPut(dtus: DTURecord[]): Promise<void> {
    await getDB().dtus.bulkPut(dtus);
  },

  // ---- Field-Level Merge (Tier 2: Offline Sync Upgrade) ----
  // Per-field LWW: if Device A edits `title` and Device B edits `tags`,
  // both changes are preserved instead of one overwriting the other.
  async mergeFromServer(serverDtu: DTURecord): Promise<'updated' | 'conflict' | 'merged' | 'skipped'> {
    const local = await getDB().dtus.get(serverDtu.id);
    if (!local) {
      // No local version, just save server version
      await getDB().dtus.put({ ...serverDtu, synced: true });
      return 'updated';
    }

    if (local.synced) {
      // Local is already synced, server wins
      await getDB().dtus.put({ ...serverDtu, synced: true });
      return 'updated';
    }

    // Local has unsynced changes - attempt field-level merge
    const mergeableFields: (keyof DTURecord)[] = ['content', 'summary', 'tags', 'resonance', 'parentId', 'tier'];
    const localFieldTs = (local as unknown as Record<string, unknown>)._fieldTimestamps as Record<string, string> | undefined || {};
    const serverFieldTs = (serverDtu as unknown as Record<string, unknown>)._fieldTimestamps as Record<string, string> | undefined || {};

    const merged: Record<string, unknown> = { ...local };
    let hadConflict = false;
    const conflictDetails: Array<{ field: string; localValue: unknown; serverValue: unknown }> = [];

    for (const field of mergeableFields) {
      const localVal = local[field];
      const serverVal = serverDtu[field];

      // If values are identical, skip
      if (JSON.stringify(localVal) === JSON.stringify(serverVal)) continue;

      // Both changed the same field - use per-field timestamp if available
      const localFieldTime = localFieldTs[field] ? new Date(localFieldTs[field]).getTime() : new Date(local.timestamp).getTime();
      const serverFieldTime = serverFieldTs[field] ? new Date(serverFieldTs[field]).getTime() : new Date(serverDtu._serverTimestamp || serverDtu.timestamp).getTime();

      if (serverFieldTime > localFieldTime) {
        // Server's version of this field is newer
        merged[field] = serverVal;
        hadConflict = true;
      } else {
        // Local version of this field is newer, keep it
        conflictDetails.push({ field, localValue: localVal, serverValue: serverVal });
      }
    }

    // Record the merge
    if (hadConflict || conflictDetails.length > 0) {
      await conflicts.record({
        entityType: 'dtu',
        entityId: serverDtu.id,
        localVersion: local,
        serverVersion: serverDtu,
        resolution: 'merged',
      });
    }

    // Apply merged result
    merged.synced = conflictDetails.length === 0; // Fully synced only if no local-wins fields remain
    merged._version = Math.max(local._version || 1, serverDtu._version || 1) + 1;
    await getDB().dtus.put(merged as unknown as DTURecord);

    return hadConflict ? 'merged' : 'skipped';
  },

  // Track field-level timestamps for per-field LWW
  async updateField(id: string, field: keyof DTURecord, value: unknown): Promise<void> {
    const dtu = await getDB().dtus.get(id);
    if (!dtu) return;

    const record = dtu as unknown as Record<string, unknown>;
    record[field] = value;
    record.synced = false;

    // Track when this specific field was last modified
    const fieldTs = (record._fieldTimestamps as Record<string, string>) || {};
    fieldTs[field] = getNormalizedTimestamp();
    record._fieldTimestamps = fieldTs;

    await getDB().dtus.put(record as unknown as DTURecord);
  },
};

// Pending actions operations
export const pendingActions = {
  async add(action: Omit<PendingAction, 'id' | 'timestamp' | 'attempts' | 'fingerprint'>): Promise<void> {
    const fingerprint = generateFingerprint(action.type, action.entity, action.payload);

    // ---- Replay Dedup (Category 4: Offline Sync) ----
    // Check if an identical action is already pending
    const existing = await getDB().pendingActions
      .where('fingerprint')
      .equals(fingerprint)
      .first();
    if (existing && !existing.quarantined) {
      // Duplicate action, skip
      return;
    }

    const id = `action-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    await getDB().pendingActions.add({
      ...action,
      id,
      timestamp: getNormalizedTimestamp(),
      attempts: 0,
      fingerprint,
    });
  },

  async getAll(): Promise<PendingAction[]> {
    // Exclude quarantined actions from normal sync flow
    return getDB().pendingActions
      .orderBy('timestamp')
      .filter(a => !a.quarantined)
      .toArray();
  },

  async getQuarantined(): Promise<PendingAction[]> {
    return getDB().pendingActions
      .filter(a => !!a.quarantined)
      .toArray();
  },

  async remove(id: string): Promise<void> {
    await getDB().pendingActions.delete(id);
  },

  async incrementAttempts(id: string): Promise<void> {
    const action = await getDB().pendingActions.get(id);
    if (action) {
      const newAttempts = action.attempts + 1;
      if (newAttempts >= MAX_SYNC_ATTEMPTS) {
        // ---- Quarantine (Category 4: Offline Sync) ----
        await getDB().pendingActions.update(id, {
          attempts: newAttempts,
          quarantined: true,
        });
      } else {
        await getDB().pendingActions.update(id, { attempts: newAttempts });
      }
    }
  },

  async clear(): Promise<void> {
    await getDB().pendingActions.clear();
  },
};

// ---- Conflict Records (Category 4: Offline Sync) ----
export const conflicts = {
  async record(conflict: Omit<ConflictRecord, 'id' | 'createdAt'>): Promise<void> {
    const id = `conflict-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    await getDB().conflicts.add({
      ...conflict,
      id,
      createdAt: getNormalizedTimestamp(),
    });
  },

  async getPending(): Promise<ConflictRecord[]> {
    return getDB().conflicts
      .where('resolution')
      .equals('pending')
      .toArray();
  },

  async resolve(id: string, resolution: ConflictRecord['resolution']): Promise<void> {
    await getDB().conflicts.update(id, { resolution });
  },

  async getRecent(limit = 20): Promise<ConflictRecord[]> {
    return getDB().conflicts
      .orderBy('createdAt')
      .reverse()
      .limit(limit)
      .toArray();
  },

  async clear(): Promise<void> {
    await getDB().conflicts.clear();
  },
};

// Chat messages operations
export const chatOffline = {
  async getRecent(limit = 50): Promise<ChatMessage[]> {
    return getDB()
      .chatMessages.orderBy('timestamp')
      .reverse()
      .limit(limit)
      .toArray()
      .then((msgs) => msgs.reverse());
  },

  async add(message: Omit<ChatMessage, 'id' | 'timestamp'>): Promise<void> {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    await getDB().chatMessages.add({
      ...message,
      id,
      timestamp: getNormalizedTimestamp(),
    });
  },

  async markSynced(id: string): Promise<void> {
    await getDB().chatMessages.update(id, { synced: true });
  },

  async clear(): Promise<void> {
    await getDB().chatMessages.clear();
  },
};

// Check if online
export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

// Online status listener
export function onOnlineStatusChange(callback: (online: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleOnline = () => callback(true);
  const handleOffline = () => callback(false);

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}
