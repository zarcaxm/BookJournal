import { advanceClock, cleanStore, nextIso } from './storage.ts'
import type { Book, Entry, Store, Tombstone } from './types.ts'
import { isConflictId, rootEntryId } from './types.ts'

export const SYNC_FILE = 'bookjournal.json'
const META_KEY = 'bookjournal.sync.v1'
const BASE_KEY = 'bookjournal.sync.base.v1'
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

export function loadSyncBase(): Store | null {
  try {
    const raw = localStorage.getItem(BASE_KEY)
    if (!raw) return null
    return cleanStore(JSON.parse(raw))
  } catch {
    return null
  }
}

export function saveSyncBase(store: Store | null) {
  if (!store) localStorage.removeItem(BASE_KEY)
  else localStorage.setItem(BASE_KEY, JSON.stringify(store))
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

/** Stable content identity for deduping conflict copies across retries. */
function recoverableContentKey(entry: Entry) {
  return JSON.stringify({
    bookId: entry.bookId,
    date: entry.date,
    title: entry.title.replace(/^\[Conflict\]\s+/, ''),
    body: entry.body,
    publishedTitle: entry.publishedTitle?.replace(/^\[Conflict\]\s+/, '') ?? null,
    publishedBody: entry.publishedBody,
    status: entry.status,
  })
}

function shortHash(value: string) {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0
  return Math.abs(hash).toString(36)
}

function conflictTitle(title: string) {
  return title.startsWith('[Conflict] ') ? title : `[Conflict] ${title}`
}

function combineText(primary: string, secondary: string, label: string) {
  const left = primary.trim()
  const right = secondary.trim()
  if (!right || left === right) return primary
  if (!left) return secondary
  return `${left}\n\n---\n${label}\n\n${right}`
}

function conflictEntry(loser: Entry): Entry {
  const root = rootEntryId(loser.id)
  const key = recoverableContentKey(loser)
  const body = combineText(
    loser.body,
    loser.publishedBody && loser.publishedBody.trim() !== loser.body.trim() ? loser.publishedBody : '',
    '[Published version]',
  )
  const titleBase = loser.title.replace(/^\[Conflict\]\s+/, '') || loser.publishedTitle || 'Conflict'
  return {
    ...loser,
    id: `${root}__conflict__${shortHash(key)}`,
    title: conflictTitle(titleBase),
    body,
    // Recoverable in the draft body; stay out of manuscript until resolved.
    publishedTitle: null,
    publishedBody: null,
    publishedAt: null,
    status: 'draft',
  }
}

function changedFromBase(entry: Entry, baseEntry: Entry | undefined) {
  if (!baseEntry) return true
  return entryFingerprint(entry) !== entryFingerprint(baseEntry)
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

function foldTwo(winner: Entry, loser: Entry): Entry {
  const publishedBody =
    winner.publishedBody?.trim()
      ? loser.publishedBody?.trim() && loser.publishedBody.trim() !== winner.publishedBody.trim()
        ? combineText(winner.publishedBody, loser.publishedBody, '[Conflict published from other device]')
        : winner.publishedBody
      : loser.publishedBody
  const publishedTitle =
    winner.publishedTitle?.trim()
      ? loser.publishedTitle?.trim() && loser.publishedTitle.trim() !== winner.publishedTitle.trim()
        ? `${winner.publishedTitle} / ${loser.publishedTitle}`
        : winner.publishedTitle
      : loser.publishedTitle

  let body = combineText(winner.body, loser.body, '[Conflict from other device]')
  if (loser.publishedBody?.trim() && loser.publishedBody.trim() !== loser.body.trim()) {
    body = combineText(body, loser.publishedBody, '[Conflict published from other device]')
  }
  if (winner.publishedBody?.trim() && winner.publishedBody.trim() !== winner.body.trim() && publishedBody !== winner.publishedBody) {
    // winner published already represented in publishedBody field
  }

  const title =
    winner.title.trim() === loser.title.trim()
      ? winner.title
      : [winner.title.trim(), loser.title.trim()].filter(Boolean).join(' / ')

  const published = Boolean(publishedBody?.trim() || publishedTitle?.trim())
  return {
    ...winner,
    title,
    body,
    publishedTitle: published ? publishedTitle : null,
    publishedBody: published ? publishedBody : null,
    publishedAt: winner.publishedAt ?? loser.publishedAt,
    status: published ? 'published' : winner.status === 'published' || loser.status === 'published' ? 'published' : 'draft',
    updatedAt: winner.updatedAt >= loser.updatedAt ? winner.updatedAt : loser.updatedAt,
  }
}

function foldSameDayEntries(entries: Entry[], deletedEntries: Map<string, Tombstone>) {
  const conflicts: Entry[] = []
  const primary: Entry[] = []
  for (const entry of entries) {
    if (isConflictId(entry.id)) conflicts.push(entry)
    else primary.push(entry)
  }

  const byDay = new Map<string, Entry[]>()
  for (const entry of primary) {
    const key = `${entry.bookId}:${entry.date}`
    const list = byDay.get(key)
    if (list) list.push(entry)
    else byDay.set(key, [entry])
  }

  const folded: Entry[] = []
  const now = nextIso()
  for (const group of byDay.values()) {
    if (group.length === 1) {
      folded.push(group[0])
      continue
    }
    group.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    let winner = group[0]
    for (const loser of group.slice(1)) {
      if (entryFingerprint(winner) === entryFingerprint(loser)) {
        deletedEntries.set(loser.id, { id: loser.id, deletedAt: now })
        continue
      }
      winner = foldTwo(winner, loser)
      deletedEntries.set(loser.id, { id: loser.id, deletedAt: now })
    }
    folded.push(winner)
  }

  const primaryById = new Map(folded.map((entry) => [entry.id, entry]))
  const keptConflicts: Entry[] = []
  const seenConflictKeys = new Set<string>()
  for (const entry of conflicts) {
    const key = recoverableContentKey(entry)
    if (seenConflictKeys.has(key) || alreadyPreserves(primaryById, entry)) {
      deletedEntries.set(entry.id, { id: entry.id, deletedAt: now })
      continue
    }
    seenConflictKeys.add(key)
    keptConflicts.push(entry)
  }

  return [...folded, ...keptConflicts]
}

function alreadyPreserves(entries: Map<string, Entry>, loser: Entry) {
  const key = recoverableContentKey(loser)
  const loserBody = loser.body.trim()
  const loserPublished = loser.publishedBody?.trim() ?? ''
  for (const entry of entries.values()) {
    if (entry.id === loser.id) continue
    if (recoverableContentKey(entry) === key) return true
    const sameDay = entry.bookId === loser.bookId && entry.date === loser.date
    const relatedConflict = isConflictId(entry.id) && rootEntryId(entry.id) === rootEntryId(loser.id)
    if (!sameDay && !relatedConflict) continue
    if (!loserBody || !entry.body.includes(loserBody)) continue
    if (!loserPublished || entry.body.includes(loserPublished) || entry.publishedBody?.includes(loserPublished)) {
      return true
    }
  }
  return false
}

export function mergeStores(local: Store, remote: Store, base: Store | null = null): Store {
  advanceClock(local)
  advanceClock(remote)
  if (base) advanceClock(base)

  const deletedBooks = mergeTombstones(local.deletedBooks, remote.deletedBooks)
  const deletedEntries = mergeTombstones(local.deletedEntries, remote.deletedEntries)
  const baseEntries = new Map((base?.entries ?? []).map((entry) => [entry.id, entry]))

  const remoteBooks = new Map(remote.books.map((book) => [book.id, book]))
  const localBooks = new Map(local.books.map((book) => [book.id, book]))
  const booksById = new Map<string, Book>()

  for (const id of new Set([...remoteBooks.keys(), ...localBooks.keys()])) {
    if (deletedBooks.has(id)) continue
    const left = localBooks.get(id)
    const right = remoteBooks.get(id)
    const candidate = left && right ? newerByUpdatedAt(left, right) : (left ?? right)
    if (!candidate) continue
    booksById.set(id, candidate)
  }

  const remoteEntries = new Map(remote.entries.map((entry) => [entry.id, entry]))
  const localEntries = new Map(local.entries.map((entry) => [entry.id, entry]))
  const entriesById = new Map<string, Entry>()

  for (const id of new Set([...remoteEntries.keys(), ...localEntries.keys()])) {
    if (deletedEntries.has(id)) continue

    if (isConflictId(id)) {
      const existing = localEntries.get(id) ?? remoteEntries.get(id)
      if (existing && booksById.has(existing.bookId)) entriesById.set(id, existing)
      continue
    }

    const left = localEntries.get(id)
    const right = remoteEntries.get(id)
    if (left && right) {
      if (!booksById.has(left.bookId) && !booksById.has(right.bookId)) continue
      if (entryFingerprint(left) === entryFingerprint(right)) {
        const winner = newerByUpdatedAt(left, right)
        if (booksById.has(winner.bookId)) entriesById.set(id, winner)
        continue
      }

      // With a known base: only one side changed → take that side (ordinary edit, no conflict).
      // With no base (first connect / lost meta): ancestry is unknown → keep both texts.
      const localChanged = !base || changedFromBase(left, baseEntries.get(id))
      const remoteChanged = !base || changedFromBase(right, baseEntries.get(id))
      const unknownAncestryOrBothChanged = !base || (localChanged && remoteChanged)

      if (unknownAncestryOrBothChanged) {
        const winner = newerByUpdatedAt(left, right)
        const loser = winner === left ? right : left
        if (booksById.has(winner.bookId)) {
          entriesById.set(id, winner)
          if (!alreadyPreserves(entriesById, loser)) {
            const copy = conflictEntry(loser)
            if (!deletedEntries.has(copy.id) && booksById.has(copy.bookId) && !entriesById.has(copy.id)) {
              entriesById.set(copy.id, copy)
            }
          }
        }
        continue
      }

      const chosen = localChanged ? left : right
      if (booksById.has(chosen.bookId)) entriesById.set(id, chosen)
      continue
    }

    const entry = left ?? right
    if (!entry) continue
    if (!booksById.has(entry.bookId)) continue
    entriesById.set(id, entry)
  }

  const folded = foldSameDayEntries([...entriesById.values()], deletedEntries)
  const merged = {
    books: orderBooks(local.books, remote.books, booksById),
    entries: folded,
    deletedBooks: [...deletedBooks.values()],
    deletedEntries: [...deletedEntries.values()],
  }
  advanceClock(merged)
  return merged
}

export function sameStore(a: Store, b: Store) {
  return JSON.stringify(a) === JSON.stringify(b)
}
