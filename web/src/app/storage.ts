// Per-device persistence. Every access is guarded: storage can be unavailable (private mode, blocked site data).

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: settings last for this visit only */
  }
}

// ---------------------------------------------------------------- remembered backup (IndexedDB)

const DB = 'backup-analyser';
const STORE = 'files';
const KEY = 'last';

export interface StoredBackup {
  name: string;
  savedAt: number;
  bytes: Uint8Array;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveBackup(b: StoredBackup): Promise<boolean> {
  try {
    await tx('readwrite', (s) => s.put(b, KEY));
    return true;
  } catch {
    return false;
  }
}

export async function loadBackup(): Promise<StoredBackup | undefined> {
  try {
    return (await tx<StoredBackup | undefined>('readonly', (s) => s.get(KEY))) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function forgetBackup(): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(KEY));
  } catch {
    /* nothing stored */
  }
}
