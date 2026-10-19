import { cleanStore } from './storage.ts'
import type { Book, Entry, Store } from './types.ts'

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

export type SnapshotRead =
  | { status: 'missing' }
  | { status: 'ready'; store: Store; savedAt: string | null }
  | { status: 'unreadable'; detail: string }

export class SnapshotUnreadableError extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'SnapshotUnreadableError'
  }
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

function looksLikeSnapshot(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return Array.isArray(record.books) || Array.isArray(record.entries) || record.app === 'BookJournal'
}

export async function readSnapshot(handle: FileSystemDirectoryHandle): Promise<SnapshotRead> {
  let file: FileSystemFileHandle
  try {
    file = await handle.getFileHandle(SYNC_FILE)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return { status: 'missing' }
    throw error
  }
  const text = await (await file.getFile()).text()
  if (!text.trim()) {
    return {
      status: 'unreadable',
      detail: 'The backup file is empty or still downloading. Sync paused so it is not overwritten.',
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      status: 'unreadable',
      detail: 'The backup file is damaged or incomplete. Sync paused so it is not overwritten.',
    }
  }
  if (!looksLikeSnapshot(parsed)) {
    return {
      status: 'unreadable',
      detail: 'The backup file is not a BookJournal snapshot. Sync paused so it is not overwritten.',
    }
  }
  return {
    status: 'ready',
    store: cleanStore(parsed),
    savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : null,
  }
}

function newerEntry(a: Entry, b: Entry) {
  return a.updatedAt >= b.updatedAt ? a : b
}

export function mergeStores(local: Store, remote: Store): Store {
  const booksById = new Map<string, Book>()
  for (const book of remote.books) booksById.set(book.id, book)
  for (const book of local.books) booksById.set(book.id, book)

  const byId = new Map<string, Entry>()
  for (const entry of remote.entries) byId.set(entry.id, entry)
  for (const entry of local.entries) {
    const previous = byId.get(entry.id)
    byId.set(entry.id, previous ? newerEntry(entry, previous) : entry)
  }

  const byDay = new Map<string, Entry>()
  for (const entry of byId.values()) {
    const key = `${entry.bookId}:${entry.date}`
    const previous = byDay.get(key)
    byDay.set(key, previous ? newerEntry(entry, previous) : entry)
  }

  const bookIds = new Set(booksById.keys())
  const entries = [...byDay.values()].filter((entry) => bookIds.has(entry.bookId))

  const books: Book[] = []
  const seen = new Set<string>()
  for (const book of local.books) {
    const merged = booksById.get(book.id)
    if (!merged || seen.has(book.id)) continue
    books.push(merged)
    seen.add(book.id)
  }
  for (const book of remote.books) {
    if (seen.has(book.id)) continue
    const merged = booksById.get(book.id)
    if (!merged) continue
    books.push(merged)
    seen.add(book.id)
  }

  return { books, entries }
}

export function sameStore(a: Store, b: Store) {
  return JSON.stringify(a) === JSON.stringify(b)
}
