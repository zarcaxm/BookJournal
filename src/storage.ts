import { COVERS, PAGES, type Book, type CoverId, type Entry, type EntryStatus, type PageId, type Store } from './types.ts'

const KEY = 'bookjournal.v1'
const COVER_IDS = new Set<string>(COVERS.map((cover) => cover.id))
const PAGE_IDS = new Set<string>(PAGES.map((pages) => pages.id))

const EMPTY: Store = { books: [], entries: [] }

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

export function cleanStore(value: unknown): Store {
  if (!value || typeof value !== 'object') return EMPTY
  const parsed = value as Partial<Store>
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
}

export function loadStore(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY
    return cleanStore(JSON.parse(raw))
  } catch {
    return EMPTY
  }
}

export function saveStore(store: Store) {
  localStorage.setItem(KEY, JSON.stringify(store))
}
