import { COVERS, PAGES, type Book, type CoverId, type Entry, type EntryStatus, type PageId, type Store } from './types.ts'

const BROWSER_KEY = 'bookjournal.v1'
const FILE_NAME = 'bookjournal.json'
const HANDLE_DB = 'bookjournal.handles'
const HANDLE_STORE = 'handles'
const HANDLE_KEY = 'folder'

const COVER_IDS = new Set<string>(COVERS.map((cover) => cover.id))
const PAGE_IDS = new Set<string>(PAGES.map((pages) => pages.id))

export const EMPTY_STORE: Store = { books: [], entries: [] }

export type StorageMode = 'browser' | 'folder'

export type StorageInfo = {
  mode: StorageMode
  folderName: string | null
  folderSupported: boolean
  needsPermission: boolean
}

let directoryHandle: FileSystemDirectoryHandle | null = null
let saveChain: Promise<void> = Promise.resolve()

function isCover(value: string): value is CoverId {
  return COVER_IDS.has(value)
}

function isPages(value: string): value is PageId {
  return PAGE_IDS.has(value)
}

function isStatus(value: unknown): value is EntryStatus {
  return value === 'draft' || value === 'published'
}

function cleanBook(value: unknown): Book | null {
  if (!value || typeof value !== 'object') return null
  const book = value as Partial<Book>
  if (typeof book.id !== 'string' || typeof book.title !== 'string') return null
  const cover = typeof book.cover === 'string' && isCover(book.cover) ? book.cover : 'oxblood'
  const pages = typeof book.pages === 'string' && isPages(book.pages) ? book.pages : 'cream'
  return {
    id: book.id,
    title: book.title,
    author: typeof book.author === 'string' ? book.author : '',
    intention: typeof book.intention === 'string' ? book.intention : '',
    cover,
    pages,
    createdAt: typeof book.createdAt === 'string' ? book.createdAt : new Date().toISOString(),
  }
}

function cleanEntry(value: unknown): Entry | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Partial<Entry>
  if (typeof entry.id !== 'string' || typeof entry.bookId !== 'string' || typeof entry.date !== 'string') {
    return null
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return null
  return {
    id: entry.id,
    bookId: entry.bookId,
    date: entry.date,
    title: typeof entry.title === 'string' ? entry.title : '',
    body: typeof entry.body === 'string' ? entry.body : '',
    publishedTitle: typeof entry.publishedTitle === 'string' ? entry.publishedTitle : null,
    publishedBody: typeof entry.publishedBody === 'string' ? entry.publishedBody : null,
    status: isStatus(entry.status) ? entry.status : 'draft',
    updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString(),
    publishedAt: typeof entry.publishedAt === 'string' ? entry.publishedAt : null,
  }
}

export function parseStore(raw: string): Store {
  try {
    const parsed = JSON.parse(raw) as Partial<Store>
    const books = Array.isArray(parsed.books)
      ? parsed.books.map(cleanBook).filter((book): book is Book => book !== null)
      : []
    const bookIds = new Set(books.map((book) => book.id))
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries
          .map(cleanEntry)
          .filter((entry): entry is Entry => entry !== null && bookIds.has(entry.bookId))
      : []
    return { books, entries }
  } catch {
    return EMPTY_STORE
  }
}

export function serializeStore(store: Store) {
  return `${JSON.stringify(store, null, 2)}\n`
}

export function folderStorageSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open storage database.'))
  })
}

async function saveDirectoryHandle(handle: FileSystemDirectoryHandle) {
  const db = await openHandleDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite')
    tx.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Could not remember the folder.'))
  })
  db.close()
}

async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openHandleDb()
  const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readonly')
    const request = tx.objectStore(HANDLE_STORE).get(HANDLE_KEY)
    request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null)
    request.onerror = () => reject(request.error ?? new Error('Could not read the remembered folder.'))
  })
  db.close()
  return handle
}

async function clearDirectoryHandle() {
  const db = await openHandleDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite')
    tx.objectStore(HANDLE_STORE).delete(HANDLE_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Could not forget the folder.'))
  })
  db.close()
}

async function ensurePermission(handle: FileSystemDirectoryHandle, interactive: boolean) {
  const options = { mode: 'readwrite' as const }
  const current = await handle.queryPermission(options)
  if (current === 'granted') return true
  if (!interactive) return false
  const next = await handle.requestPermission(options)
  return next === 'granted'
}

async function readStoreFromDirectory(handle: FileSystemDirectoryHandle): Promise<Store | null> {
  try {
    const fileHandle = await handle.getFileHandle(FILE_NAME)
    const file = await fileHandle.getFile()
    const raw = await file.text()
    return parseStore(raw)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null
    throw error
  }
}

async function writeStoreToDirectory(handle: FileSystemDirectoryHandle, store: Store) {
  const fileHandle = await handle.getFileHandle(FILE_NAME, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(serializeStore(store))
  await writable.close()
}

export function loadBrowserStore(): Store {
  try {
    const raw = localStorage.getItem(BROWSER_KEY)
    if (!raw) return EMPTY_STORE
    return parseStore(raw)
  } catch {
    return EMPTY_STORE
  }
}

export function saveBrowserStore(store: Store) {
  localStorage.setItem(BROWSER_KEY, serializeStore(store).trimEnd())
}

export function getStorageInfo(): StorageInfo {
  return {
    mode: directoryHandle ? 'folder' : 'browser',
    folderName: directoryHandle?.name ?? null,
    folderSupported: folderStorageSupported(),
    needsPermission: false,
  }
}

export async function initStorage(): Promise<{ store: Store; info: StorageInfo }> {
  directoryHandle = null

  if (!folderStorageSupported()) {
    return {
      store: loadBrowserStore(),
      info: {
        mode: 'browser',
        folderName: null,
        folderSupported: false,
        needsPermission: false,
      },
    }
  }

  try {
    const remembered = await loadDirectoryHandle()
    if (!remembered) {
      return {
        store: loadBrowserStore(),
        info: {
          mode: 'browser',
          folderName: null,
          folderSupported: true,
          needsPermission: false,
        },
      }
    }

    const granted = await ensurePermission(remembered, false)
    if (!granted) {
      return {
        store: loadBrowserStore(),
        info: {
          mode: 'browser',
          folderName: remembered.name,
          folderSupported: true,
          needsPermission: true,
        },
      }
    }

    directoryHandle = remembered
    const fromFile = await readStoreFromDirectory(remembered)
    if (fromFile) {
      saveBrowserStore(fromFile)
      return {
        store: fromFile,
        info: {
          mode: 'folder',
          folderName: remembered.name,
          folderSupported: true,
          needsPermission: false,
        },
      }
    }

    const browserStore = loadBrowserStore()
    await writeStoreToDirectory(remembered, browserStore)
    return {
      store: browserStore,
      info: {
        mode: 'folder',
        folderName: remembered.name,
        folderSupported: true,
        needsPermission: false,
      },
    }
  } catch {
    directoryHandle = null
    return {
      store: loadBrowserStore(),
      info: {
        mode: 'browser',
        folderName: null,
        folderSupported: true,
        needsPermission: false,
      },
    }
  }
}

export async function saveStore(store: Store) {
  saveBrowserStore(store)
  const handle = directoryHandle
  if (!handle) return

  saveChain = saveChain
    .catch(() => undefined)
    .then(async () => {
      const granted = await ensurePermission(handle, false)
      if (!granted) throw new Error('Folder permission was revoked. Reconnect the folder to keep saving there.')
      await writeStoreToDirectory(handle, store)
    })
  await saveChain
}

export async function chooseJournalFolder(current: Store): Promise<{ store: Store; info: StorageInfo }> {
  if (!folderStorageSupported() || !window.showDirectoryPicker) {
    throw new Error('This browser cannot save to a folder. Try Chrome or Edge.')
  }

  const handle = await window.showDirectoryPicker({
    id: 'bookjournal',
    mode: 'readwrite',
  })

  const granted = await ensurePermission(handle, true)
  if (!granted) throw new Error('Permission to write in that folder was denied.')

  await saveDirectoryHandle(handle)
  directoryHandle = handle

  const existing = await readStoreFromDirectory(handle)
  const nextStore = existing ?? current
  if (!existing) await writeStoreToDirectory(handle, nextStore)
  saveBrowserStore(nextStore)

  return {
    store: nextStore,
    info: {
      mode: 'folder',
      folderName: handle.name,
      folderSupported: true,
      needsPermission: false,
    },
  }
}

export async function reconnectJournalFolder(current: Store): Promise<{ store: Store; info: StorageInfo }> {
  const remembered = await loadDirectoryHandle()
  if (!remembered) return chooseJournalFolder(current)

  const granted = await ensurePermission(remembered, true)
  if (!granted) throw new Error('Permission to write in that folder was denied.')

  directoryHandle = remembered
  const existing = await readStoreFromDirectory(remembered)
  const nextStore = existing ?? current
  if (!existing) await writeStoreToDirectory(remembered, nextStore)
  saveBrowserStore(nextStore)

  return {
    store: nextStore,
    info: {
      mode: 'folder',
      folderName: remembered.name,
      folderSupported: true,
      needsPermission: false,
    },
  }
}

export async function unlinkJournalFolder() {
  directoryHandle = null
  await clearDirectoryHandle()
}
