import { cleanStore } from './storage.ts'
import type { Store } from './types.ts'

export const SYNC_FILE = 'bookjournal.json'
const META_KEY = 'bookjournal.sync.v1'
const DB_NAME = 'bookjournal.files'
const DB_VERSION = 1
const HANDLE_STORE = 'handles'
const HANDLE_KEY = 'sync-folder'

export type SyncMeta = {
  folderName: string
  lastSyncedAt: string | null
}

export function syncSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

export function loadSyncMeta(): SyncMeta | null {
  try {
    const raw = localStorage.getItem(META_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SyncMeta>
    if (typeof parsed.folderName !== 'string' || !parsed.folderName) return null
    return {
      folderName: parsed.folderName,
      lastSyncedAt: typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : null,
    }
  } catch {
    return null
  }
}

export function saveSyncMeta(meta: SyncMeta | null) {
  if (!meta) localStorage.removeItem(META_KEY)
  else localStorage.setItem(META_KEY, JSON.stringify(meta))
}

export function pickSyncFolder() {
  return window.showDirectoryPicker({ id: 'bookjournal-sync', mode: 'readwrite', startIn: 'documents' })
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(HANDLE_STORE)) {
        request.result.createObjectStore(HANDLE_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the local database.'))
  })
}

async function withHandleStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, mode)
      const request = run(tx.objectStore(HANDLE_STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Could not update the local database.'))
    })
  } finally {
    db.close()
  }
}

export async function saveFolderHandle(handle: FileSystemDirectoryHandle) {
  await withHandleStore('readwrite', (store) => store.put(handle, HANDLE_KEY))
}

export async function loadFolderHandle() {
  const handle = await withHandleStore<FileSystemDirectoryHandle | undefined>('readonly', (store) =>
    store.get(HANDLE_KEY),
  )
  return handle ?? null
}

export async function clearFolderHandle() {
  await withHandleStore('readwrite', (store) => store.delete(HANDLE_KEY))
}

export async function permissionState(handle: FileSystemDirectoryHandle, request = false) {
  const descriptor = { mode: 'readwrite' as const }
  const state = await handle.queryPermission(descriptor)
  if (state === 'granted' || !request) return state
  return handle.requestPermission(descriptor)
}

export async function writeSnapshot(handle: FileSystemDirectoryHandle, store: Store) {
  const file = await handle.getFileHandle(SYNC_FILE, { create: true })
  const writable = await file.createWritable()
  const savedAt = new Date().toISOString()
  try {
    await writable.write(
      JSON.stringify(
        {
          version: 1,
          app: 'BookJournal',
          savedAt,
          books: store.books,
          entries: store.entries,
        },
        null,
        2,
      ),
    )
    await writable.close()
  } catch (error) {
    await writable.abort().catch(() => {})
    throw error
  }
  return savedAt
}

export async function readSnapshot(handle: FileSystemDirectoryHandle) {
  let file: FileSystemFileHandle
  try {
    file = await handle.getFileHandle(SYNC_FILE)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null
    throw error
  }
  const text = await (await file.getFile()).text()
  if (!text.trim()) return null
  try {
    const parsed = JSON.parse(text) as { savedAt?: unknown }
    return {
      store: cleanStore(parsed),
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : null,
    }
  } catch {
    return null
  }
}
