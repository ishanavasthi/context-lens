import type { EventEnvelope } from '@contextlens/shared';

const DB_NAME = 'contextlens';
const DB_VERSION = 1;
const STORE_NAME = 'events';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'event_id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function enqueueEvent(event: EventEnvelope): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(event);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function queueSize(): Promise<number> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const count = await requestToPromise(tx.objectStore(STORE_NAME).count());
    return count;
  } finally {
    db.close();
  }
}

export async function readBatch(limit: number): Promise<EventEnvelope[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const all = await requestToPromise<EventEnvelope[]>(tx.objectStore(STORE_NAME).getAll());
    return all.slice(0, limit);
  } finally {
    db.close();
  }
}

export async function deleteEvents(eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) {
    return;
  }
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const eventId of eventIds) {
      store.delete(eventId);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
