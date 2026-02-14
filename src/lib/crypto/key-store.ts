import type { StoredIdentity, StoredSignedPreKey, StoredOneTimePreKey, SessionRecord } from './types';

const DB_NAME = 'signal-crypto-store';
const DB_VERSION = 1;

const STORES = {
  IDENTITY: 'identityKeys',
  SIGNED_PREKEYS: 'signedPreKeys',
  ONE_TIME_PREKEYS: 'oneTimePreKeys',
  SESSIONS: 'sessions',
  METADATA: 'metadata',
} as const;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORES.IDENTITY)) {
        db.createObjectStore(STORES.IDENTITY, { keyPath: 'userId' });
      }
      if (!db.objectStoreNames.contains(STORES.SIGNED_PREKEYS)) {
        const store = db.createObjectStore(STORES.SIGNED_PREKEYS, { autoIncrement: true });
        store.createIndex('userId_keyId', ['userId', 'keyId'], { unique: true });
      }
      if (!db.objectStoreNames.contains(STORES.ONE_TIME_PREKEYS)) {
        const store = db.createObjectStore(STORES.ONE_TIME_PREKEYS, { autoIncrement: true });
        store.createIndex('userId_keyId', ['userId', 'keyId'], { unique: true });
      }
      if (!db.objectStoreNames.contains(STORES.SESSIONS)) {
        db.createObjectStore(STORES.SESSIONS, { keyPath: 'conversationId' });
      }
      if (!db.objectStoreNames.contains(STORES.METADATA)) {
        db.createObjectStore(STORES.METADATA, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbGet<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function dbGetByIndex<T>(storeName: string, indexName: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const request = index.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function dbPut<T>(storeName: string, value: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.put(value);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function dbDeleteByIndex(storeName: string, indexName: string, key: IDBValidKey): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const request = index.openCursor(key);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
      }
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// Identity keys
export async function getLocalIdentity(userId: string): Promise<StoredIdentity | undefined> {
  return dbGet<StoredIdentity>(STORES.IDENTITY, userId);
}

export async function saveLocalIdentity(identity: StoredIdentity): Promise<void> {
  return dbPut(STORES.IDENTITY, identity);
}

// Signed prekeys
export async function getSignedPreKey(userId: string, keyId: number): Promise<StoredSignedPreKey | undefined> {
  return dbGetByIndex<StoredSignedPreKey & { userId: string }>(STORES.SIGNED_PREKEYS, 'userId_keyId', [userId, keyId]);
}

export async function saveSignedPreKey(userId: string, preKey: StoredSignedPreKey): Promise<void> {
  return dbPut(STORES.SIGNED_PREKEYS, { userId, ...preKey });
}

// One-time prekeys
export async function getOneTimePreKey(userId: string, keyId: number): Promise<StoredOneTimePreKey | undefined> {
  return dbGetByIndex<StoredOneTimePreKey & { userId: string }>(STORES.ONE_TIME_PREKEYS, 'userId_keyId', [userId, keyId]);
}

export async function saveOneTimePreKey(userId: string, preKey: StoredOneTimePreKey): Promise<void> {
  return dbPut(STORES.ONE_TIME_PREKEYS, { userId, ...preKey });
}

export async function deleteOneTimePreKey(userId: string, keyId: number): Promise<void> {
  return dbDeleteByIndex(STORES.ONE_TIME_PREKEYS, 'userId_keyId', [userId, keyId]);
}

// Sessions
export async function getSession(conversationId: string): Promise<SessionRecord | undefined> {
  return dbGet<SessionRecord>(STORES.SESSIONS, conversationId);
}

export async function saveSession(session: SessionRecord): Promise<void> {
  return dbPut(STORES.SESSIONS, session);
}

// Metadata
export async function getMetadata(key: string): Promise<any> {
  const result = await dbGet<{ key: string; value: any }>(STORES.METADATA, key);
  return result?.value;
}

export async function setMetadata(key: string, value: any): Promise<void> {
  return dbPut(STORES.METADATA, { key, value });
}

// Clear all data (for logout)
export async function clearAllCryptoData(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const storeNames = Array.from(db.objectStoreNames);
    if (storeNames.length === 0) { db.close(); resolve(); return; }
    const tx = db.transaction(storeNames, 'readwrite');
    for (const storeName of storeNames) {
      tx.objectStore(storeName).clear();
    }
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
