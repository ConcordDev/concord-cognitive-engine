// concord-frontend/lib/dtu-cache.ts
interface DTU {
  id: string;
  lens_id: string;
  creator: string;
  created_at: number;
  // Add other DTU properties as needed
}

class DTUCache {
  private db: IDBDatabase;
  private dbRequest: IDBRequest<IDBDatabase>;

  constructor() {
    this.dbRequest = indexedDB.open('concord-dtus', 1);
    this.dbRequest.onupgradeneeded = (event) => {
      const db = (event.target as IDBRequest<IDBDatabase>).result;
      db.createObjectStore('dtus', { keyPath: 'id' });
      const dtusStore = db.transaction.objectStore('dtus');
      dtusStore.createIndex('byLensId', 'lens_id');
      dtusStore.createIndex('byCreator', 'creator');
      dtusStore.createIndex('byCreatedAt', 'created_at');
    };
    this.dbRequest.onsuccess = (event) => {
      this.db = (event.target as IDBRequest<IDBDatabase>).result;
    };
  }

  async put(dtu: DTU) {
    const transaction = this.db.transaction(['dtus'], 'readwrite');
    const store = transaction.objectStore('dtus');
    const request = store.put(dtu);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async get(id: string) {
    const transaction = this.db.transaction(['dtus'], 'readonly');
    const store = transaction.objectStore('dtus');
    const request = store.get(id);
    return new Promise<DTU | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async listByLens(lensId: string) {
    const transaction = this.db.transaction(['dtus'], 'readonly');
    const store = transaction.objectStore('dtus');
    const index = store.index('byLensId');
    const request = index.getAll(IDBKeyRange.only(lensId));
    return new Promise<DTU[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async search(query: string) {
    const transaction = this.db.transaction(['dtus'], 'readonly');
    const store = transaction.objectStore('dtus');
    const request = store.getAll();
    return new Promise<DTU[]>((resolve, reject) => {
      request.onsuccess = () => {
        const results = request.result;
        const filteredResults = results.filter((dtu) => {
          // Implement search logic here
          return dtu.id.includes(query);
        });
        resolve(filteredResults);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async count() {
    const transaction = this.db.transaction(['dtus'], 'readonly');
    const store = transaction.objectStore('dtus');
    const request = store.count();
    return new Promise<number>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async clear() {
    const transaction = this.db.transaction(['dtus'], 'readwrite');
    const store = transaction.objectStore('dtus');
    const request = store.clear();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

export const dtuCache = new DTUCache();
