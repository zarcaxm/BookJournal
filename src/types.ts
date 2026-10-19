export const COVERS = [
  { id: 'oxblood', label: 'Oxblood', cloth: '#7d3228', foil: '#f6ecd8' },
  { id: 'forest', label: 'Forest', cloth: '#23483d', foil: '#e7f0d8' },
  { id: 'navy', label: 'Navy', cloth: '#1d3148', foil: '#e7eef6' },
  { id: 'olive', label: 'Olive', cloth: '#5c5830', foil: '#f6f1d4' },
  { id: 'ink', label: 'Ink', cloth: '#2a2724', foil: '#f4efe6' },
  { id: 'sand', label: 'Sand', cloth: '#c4b396', foil: '#2c261f' },
] as const

export type CoverId = (typeof COVERS)[number]['id']

export const PAGES = [
  { id: 'cream', label: 'Cream', note: 'Warm blank paper' },
  { id: 'ruled', label: 'Ruled', note: 'Lined notebook' },
  { id: 'typewriter', label: 'Typewriter', note: 'Ribbon and monospace' },
  { id: 'night', label: 'Night', note: 'Dark pages' },
  { id: 'press', label: 'Press', note: 'Printed book' },
] as const

export type PageId = (typeof PAGES)[number]['id']

export type Book = {
  id: string
  title: string
  author: string
  intention: string
  cover: CoverId
  pages: PageId
  createdAt: string
}

export type EntryStatus = 'draft' | 'published'

export type Entry = {
  id: string
  bookId: string
  date: string
  title: string
  body: string
  publishedTitle: string | null
  publishedBody: string | null
  status: EntryStatus
  updatedAt: string
  publishedAt: string | null
}

export type DayDraft = {
  title: string
  body: string
}

export type Store = {
  books: Book[]
  entries: Entry[]
}

export type View =
  | { name: 'library' }
  | { name: 'journal'; bookId: string }
  | { name: 'manuscript'; bookId: string }

export function coverOf(id: CoverId) {
  return COVERS.find((cover) => cover.id === id) ?? COVERS[0]
}

export function pagesOf(id: PageId) {
  return PAGES.find((pages) => pages.id === id) ?? PAGES[0]
}

export function entryInBook(entry: Entry) {
  return entry.status === 'published' && Boolean(entry.publishedBody?.trim() || entry.publishedTitle?.trim())
}

export function entryIsDirty(entry: Entry) {
  if (!entryInBook(entry)) return false
  return entry.title !== (entry.publishedTitle ?? '') || entry.body !== (entry.publishedBody ?? '')
}

export function entryHasWriting(entry: Entry) {
  return Boolean(entry.title.trim() || entry.body.trim())
}
