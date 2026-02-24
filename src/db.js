/**
 * SyncedDB setup for memo app.
 * Store name is user-editable; syncs with backend (VITE_API_URL).
 * @see https://www.npmjs.com/package/synceddb
 */
import { openDB, SyncManager } from 'synceddb';

const DB_NAME = 'memo-app';
const DEFAULT_API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const API_BASE_KEY = 'memo-app-api-base';
const STORE_NAMES_KEY = 'memo-app-store-names';
const CURRENT_STORE_KEY = 'memo-app-current-store';

/** Backend와 동일: 영문/숫자/언더스코어/하이픈만 허용 */
export const STORE_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

export function getApiBase() {
  return localStorage.getItem(API_BASE_KEY) || DEFAULT_API_BASE;
}

/**
 * 서버 주소만 localStorage에 저장. 서버 연결/404 여부는 검사하지 않음.
 * 변경 시 기존 SyncManager를 중지하고, 다음 getSyncManager() 호출 시 새 주소로 재연결됨.
 */
export function setApiBase(url) {
  const trimmed = url?.trim().replace(/\/+$/, '') || '';
  if (!trimmed) return false;
  try {
    new URL(trimmed);
  } catch {
    return false;
  }
  localStorage.setItem(API_BASE_KEY, trimmed);
  if (syncManagerInstance) {
    syncManagerInstance.stop();
    syncManagerInstance = null;
    syncManagerPromise = null;
  }
  return true;
}

let dbPromise = null;
let syncManagerInstance = null;
let syncManagerPromise = null;

export function getStoreNames() {
  try {
    const raw = localStorage.getItem(STORE_NAMES_KEY);
    return raw ? JSON.parse(raw) : ['memos'];
  } catch {
    return ['memos'];
  }
}

function setStoreNames(names) {
  localStorage.setItem(STORE_NAMES_KEY, JSON.stringify([...new Set(names)]));
}

export function getCurrentStoreName() {
  return localStorage.getItem(CURRENT_STORE_KEY) || 'memos';
}

export function setCurrentStoreName(name) {
  if (name && STORE_NAME_REGEX.test(name)) {
    localStorage.setItem(CURRENT_STORE_KEY, name);
  }
}

/** 새 스토어 이름을 등록하고 DB를 재오픈할 수 있도록 연결 해제 */
export function addStoreName(name) {
  if (!name || !STORE_NAME_REGEX.test(name)) return;
  const names = getStoreNames();
  if (names.includes(name)) return;
  names.push(name);
  setStoreNames(names);
  closeDB();
}

export function closeDB() {
  if (dbPromise) {
    dbPromise.then((db) => db.close()).catch(() => {});
    dbPromise = null;
  }
  syncManagerInstance = null;
  syncManagerPromise = null;
}

export function getDB() {
  if (!dbPromise) {
    const storeNames = getStoreNames();
    const version = Math.max(1, storeNames.length);
    dbPromise = openDB(DB_NAME, version, {
      upgrade(database) {
        for (const name of storeNames) {
          if (!database.objectStoreNames.contains(name)) {
            database.createObjectStore(name, { keyPath: 'id' });
          }
        }
      },
    });
  }
  return dbPromise;
}

export function getSyncManager() {
  if (!syncManagerInstance) {
    syncManagerPromise = getDB().then((database) => {
      syncManagerInstance = new SyncManager(database, getApiBase(), {
        buildFetchParams(storeName, offset) {
          const params = new URLSearchParams({ size: '100' });
          if (offset) {
            params.set('after', offset.updatedAt);
            params.set('after_id', String(offset.id));
          }
          return params;
        },
      });
      syncManagerInstance.start();
      return syncManagerInstance;
    });
  }
  return syncManagerInstance;
}

/** SyncManager가 준비될 때까지 기다림 */
export function getSyncManagerAsync() {
  getSyncManager();
  if (syncManagerInstance) return Promise.resolve(syncManagerInstance);
  return syncManagerPromise || Promise.resolve(null);
}

/**
 * 서버에서 강제로 한 번 가져오기. 실패 시 에러 메시지 반환.
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export async function triggerSync() {
  try {
    const manager = await getSyncManagerAsync();
    if (!manager?.fetchLoop) {
      return { ok: false, message: '동기화 매니저가 아직 준비되지 않았습니다.' };
    }
    let fetchError = null;
    const originalOnError = manager.onfetcherror?.bind(manager);
    manager.onfetcherror = (err) => {
      fetchError = err;
      if (originalOnError) originalOnError(err);
    };
    await manager.fetchLoop.run();
    manager.onfetcherror = originalOnError;
    if (fetchError) {
      const msg = fetchError.response
        ? `${fetchError.response.status} ${fetchError.response.statusText || ''}`.trim() || fetchError.message
        : fetchError.message;
      return { ok: false, message: msg };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e?.message || String(e) };
  }
}
