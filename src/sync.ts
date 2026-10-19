import { cleanStore } from './storage.ts'
import type { Book, Entry, Store, Tombstone } from './types.ts'
import { isConflictId } from './types.ts'

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
          deletedBooks: store.deletedBooks,
          deletedEntries: store.deletedEntries,
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

export function classifySnapshotText(text: string): SnapshotRead {
  // Zero-byte files can be left behind by a failed write; treat them as missing so sync can recover.
  if (!text.trim()) return { status: 'missing' }
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
    savedAt: typeof (parsed as { savedAt?: unknown }).savedAt === 'string' ? (parsed as { savedAt: string }).savedAt : null,
  }
}

export async function readSnapshot(handle: FileSystemDirectoryHandle): Promise<SnapshotRead> {
  let file: FileSystemFileHandle
  try {
    file = await handle.getFileHandle(SYNC_FILE)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return { status: 'missing' }
    throw error
  }
  return classifySnapshotText(await (await file.getFile()).text())
}

function mergeTombstones(local: Tombstone[], remote: Tombstone[]) {
  const byId = new Map<string, Tombstone>()
  for (const item of [...remote, ...local]) {
    const previous = byId.get(item.id)
    if (!previous || item.deletedAt > previous.deletedAt) byId.set(item.id, item)
  }
  return byId
}

function newerByUpdatedAt<T extends { updatedAt: string }>(a: T, b: T) {
  return a.updatedAt >= b.updatedAt ? a : b
}

function entryFingerprint(entry: Entry) {
  return JSON.stringify({
    bookId: entry.bookId,
    date: entry.date,
    title: entry.title,
    body: entry.body,
    publishedTitle: entry.publishedTitle,
    publishedBody: entry.publishedBody,
    status: entry.status,
  })
}

function conflictTitle(title: string) {
  return title.startsWith('[Conflict] ') ? title : `[Conflict] ${title}`
}

function conflictEntry(loser: Entry): Entry {
  return {
    ...loser,
    id: `${loser.id}__conflict`,
    title: conflictTitle(loser.title),
    publishedTitle: loser.publishedTitle ? conflictTitle(loser.publishedTitle) : loser.publishedTitle,
  }
}

function isDeleted(tombstones: Map<string, Tombstone>, id: string, updatedAt: string) {
  const tombstone = tombstones.get(id)
  return Boolean(tombstone && tombstone.deletedAt >= updatedAt)
}

function orderBooks(local: Book[], remote: Book[], booksById: Map<string, Book>) {
  const books: Book[] = []
  const seen = new Set<string>()
  for (const book of local) {
    const merged = booksById.get(book.id)
    if (!merged || seen.has(book.id)) continue
    books.push(merged)
    seen.add(book.id)
  }
  for (const book of remote) {
    if (seen.has(book.id)) continue
    const merged = booksById.get(book.id)
    if (!merged) continue
    books.push(merged)
    seen.add(book.id)
  }
  return books
}

export function mergeStores(local: Store, remote: Store): Store {
  const deletedBooks = mergeTombstones(local.deletedBooks, remote.deletedBooks)
  const deletedEntries = mergeTombstones(local.deletedEntries, remote.deletedEntries)

  const remoteBooks = new Map(remote.books.map((book) => [book.id, book]))
  const localBooks = new Map(local.books.map((book) => [book.id, book]))
  const booksById = new Map<string, Book>()

  for (const id of new Set([...remoteBooks.keys(), ...localBooks.keys()])) {
    if (isConflictId(id)) continue
    const left = localBooks.get(id)
    const right = remoteBooks.get(id)
    const candidate = left && right ? newerByUpdatedAt(left, right) : (left ?? right)
    if (!candidate) continue
    if (isDeleted(deletedBooks, id, candidate.updatedAt)) continue
    booksById.set(id, candidate)
    deletedBooks.delete(id)
  }

  const remoteEntries = new Map(remote.entries.map((entry) => [entry.id, entry]))
  const localEntries = new Map(local.entries.map((entry) => [entry.id, entry]))
  const entriesById = new Map<string, Entry>()

  for (const id of new Set([...remoteEntries.keys(), ...localEntries.keys()])) {
    if (isConflictId(id)) {
      const existing = localEntries.get(id) ?? remoteEntries.get(id)
      if (existing && booksById.has(existing.bookId) && !isDeleted(deletedEntries, id, existing.updatedAt)) {
        entriesById.set(id, existing)
      }
      continue
    }

    const left = localEntries.get(id)
    const right = remoteEntries.get(id)
    if (left && right) {
      const winner = newerByUpdatedAt(left, right)
      const loser = winner === left ? right : left
      if (isDeleted(deletedEntries, id, winner.updatedAt)) continue
      if (!booksById.has(winner.bookId)) continue
      entriesById.set(id, winner)
      deletedEntries.delete(id)
      if (entryFingerprint(left) !== entryFingerprint(right)) {
        const copy = conflictEntry(loser)
        if (!entriesById.has(copy.id) && booksById.has(copy.bookId) && !isDeleted(deletedEntries, copy.id, copy.updatedAt)) {
          entriesById.set(copy.id, copy)
        }
      }
      continue
    }

    const entry = left ?? right
    if (!entry) continue
    if (isDeleted(deletedEntries, id, entry.updatedAt)) continue
    if (!booksById.has(entry.bookId)) continue
    entriesById.set(id, entry)
    deletedEntries.delete(id)
  }

  // Preserve remote-only / local-only conflict copies that were already stored.
  for (const entry of [...remote.entries, ...local.entries]) {
    if (!isConflictId(entry.id) || entriesById.has(entry.id)) continue
    if (!booksById.has(entry.bookId)) continue
    if (isDeleted(deletedEntries, entry.id, entry.updatedAt)) continue
    entriesById.set(entry.id, entry)
  }

  return {
    books: orderBooks(local.books, remote.books, booksById),
    entries: [...entriesById.values()],
    deletedBooks: [...deletedBooks.values()],
    deletedEntries: [...deletedEntries.values()],
  }
}

export function sameStore(a: Store, b: Store) {
  return JSON.stringify(a) === JSON.stringify(b)
}
