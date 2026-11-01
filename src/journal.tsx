import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createContext, useContext } from 'react'
import { toDateKey } from './dates.ts'
import {
  chooseJournalFolder,
  EMPTY_STORE,
  getStorageInfo,
  initStorage,
  reconnectJournalFolder,
  saveStore,
  type StorageInfo,
  unlinkJournalFolder,
} from './storage.ts'
import type { Book, CoverId, DayDraft, Entry, PageId, View } from './types.ts'

type JournalContextValue = {
  ready: boolean
  books: Book[]
  entries: Entry[]
  view: View
  selectedDate: string
  saveError: string | null
  storage: StorageInfo
  openLibrary: () => void
  openJournal: (bookId: string, date?: string) => void
  openManuscript: (bookId: string) => void
  createBook: (input: { title: string; intention: string; cover: CoverId; pages: PageId }) => void
  setBookPages: (bookId: string, pages: PageId) => void
  deleteBook: (bookId: string) => void
  entryFor: (bookId: string, date: string) => Entry | undefined
  entriesFor: (bookId: string) => Entry[]
  publishedEntries: (bookId: string) => Entry[]
  saveDay: (bookId: string, date: string, draft: DayDraft) => void
  publishDay: (bookId: string, date: string, draft: DayDraft) => void
  unpublishDay: (entryId: string) => void
  linkFolder: () => Promise<void>
  reconnectFolder: () => Promise<void>
  unlinkFolder: () => Promise<void>
}

const JournalContext = createContext<JournalContextValue | null>(null)

function nowIso() {
  return new Date().toISOString()
}

export function JournalProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [store, setStore] = useState(EMPTY_STORE)
  const [view, setView] = useState<View>({ name: 'library' })
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()))
  const [saveError, setSaveError] = useState<string | null>(null)
  const [storage, setStorage] = useState<StorageInfo>(getStorageInfo)

  useEffect(() => {
    let cancelled = false
    void initStorage().then(({ store: loaded, info }) => {
      if (cancelled) return
      setStore(loaded)
      setStorage(info)
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    void saveStore(store)
      .then(() => {
        if (!cancelled) setSaveError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : 'Could not save the journal.'
        setSaveError(message)
      })
    return () => {
      cancelled = true
    }
  }, [ready, store])

  const openLibrary = useCallback(() => setView({ name: 'library' }), [])

  const openJournal = useCallback((bookId: string, date?: string) => {
    if (date) setSelectedDate(date)
    setView({ name: 'journal', bookId })
  }, [])

  const openManuscript = useCallback((bookId: string) => {
    setView({ name: 'manuscript', bookId })
  }, [])

  const createBook = useCallback(
    (input: { title: string; intention: string; cover: CoverId; pages: PageId }) => {
      const book: Book = {
        id: crypto.randomUUID(),
        title: input.title.trim(),
        author: '',
        intention: input.intention.trim(),
        cover: input.cover,
        pages: input.pages,
        createdAt: nowIso(),
      }
      setStore((prev) => ({ ...prev, books: [book, ...prev.books] }))
      setSelectedDate(toDateKey(new Date()))
      setView({ name: 'journal', bookId: book.id })
    },
    [],
  )

  const setBookPages = useCallback((bookId: string, pages: PageId) => {
    setStore((prev) => ({
      ...prev,
      books: prev.books.map((book) => (book.id === bookId ? { ...book, pages } : book)),
    }))
  }, [])

  const deleteBook = useCallback((bookId: string) => {
    setStore((prev) => ({
      books: prev.books.filter((book) => book.id !== bookId),
      entries: prev.entries.filter((entry) => entry.bookId !== bookId),
    }))
    setView({ name: 'library' })
  }, [])

  const entryFor = useCallback(
    (bookId: string, date: string) => store.entries.find((entry) => entry.bookId === bookId && entry.date === date),
    [store.entries],
  )

  const entriesFor = useCallback(
    (bookId: string) =>
      store.entries.filter((entry) => entry.bookId === bookId).sort((a, b) => a.date.localeCompare(b.date)),
    [store.entries],
  )

  const publishedEntries = useCallback(
    (bookId: string) =>
      entriesFor(bookId).filter(
        (entry) => entry.status === 'published' && Boolean(entry.publishedBody?.trim() || entry.publishedTitle?.trim()),
      ),
    [entriesFor],
  )

  const saveDay = useCallback((bookId: string, date: string, draft: DayDraft) => {
    setStore((prev) => {
      const existing = prev.entries.find((entry) => entry.bookId === bookId && entry.date === date)
      const empty = !draft.title.trim() && !draft.body.trim()
      if (!existing) {
        if (empty) return prev
        const created: Entry = {
          id: crypto.randomUUID(),
          bookId,
          date,
          title: draft.title,
          body: draft.body,
          publishedTitle: null,
          publishedBody: null,
          status: 'draft',
          updatedAt: nowIso(),
          publishedAt: null,
        }
        return { ...prev, entries: [...prev.entries, created] }
      }
      if (empty && existing.status === 'draft') {
        return { ...prev, entries: prev.entries.filter((entry) => entry.id !== existing.id) }
      }
      if (existing.title === draft.title && existing.body === draft.body) return prev
      return {
        ...prev,
        entries: prev.entries.map((entry) =>
          entry.id === existing.id ? { ...entry, title: draft.title, body: draft.body, updatedAt: nowIso() } : entry,
        ),
      }
    })
  }, [])

  const publishDay = useCallback((bookId: string, date: string, draft: DayDraft) => {
    if (!draft.title.trim() || !draft.body.trim()) return
    setStore((prev) => {
      const existing = prev.entries.find((entry) => entry.bookId === bookId && entry.date === date)
      const publishedAt = existing?.publishedAt ?? nowIso()
      if (!existing) {
        const created: Entry = {
          id: crypto.randomUUID(),
          bookId,
          date,
          title: draft.title,
          body: draft.body,
          publishedTitle: draft.title,
          publishedBody: draft.body,
          status: 'published',
          updatedAt: nowIso(),
          publishedAt,
        }
        return { ...prev, entries: [...prev.entries, created] }
      }
      return {
        ...prev,
        entries: prev.entries.map((entry) =>
          entry.id === existing.id
            ? {
                ...entry,
                title: draft.title,
                body: draft.body,
                publishedTitle: draft.title,
                publishedBody: draft.body,
                status: 'published',
                updatedAt: nowIso(),
                publishedAt,
              }
            : entry,
        ),
      }
    })
  }, [])

  const unpublishDay = useCallback((entryId: string) => {
    setStore((prev) => ({
      ...prev,
      entries: prev.entries.flatMap((entry) => {
        if (entry.id !== entryId) return [entry]
        if (!entry.title.trim() && !entry.body.trim()) return []
        return [
          {
            ...entry,
            status: 'draft' as const,
            publishedTitle: null,
            publishedBody: null,
            publishedAt: null,
            updatedAt: nowIso(),
          },
        ]
      }),
    }))
  }, [])

  const linkFolder = useCallback(async () => {
    try {
      const next = await chooseJournalFolder(store)
      setStore(next.store)
      setStorage(next.info)
      setSaveError(null)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      const message = error instanceof Error ? error.message : 'Could not link that folder.'
      setSaveError(message)
      throw error
    }
  }, [store])

  const reconnectFolder = useCallback(async () => {
    try {
      const next = await reconnectJournalFolder(store)
      setStore(next.store)
      setStorage(next.info)
      setSaveError(null)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      const message = error instanceof Error ? error.message : 'Could not reconnect that folder.'
      setSaveError(message)
      throw error
    }
  }, [store])

  const unlinkFolder = useCallback(async () => {
    await unlinkJournalFolder()
    setStorage(getStorageInfo())
    setSaveError(null)
  }, [])

  const value = useMemo<JournalContextValue>(
    () => ({
      ready,
      books: store.books,
      entries: store.entries,
      view,
      selectedDate,
      saveError,
      storage,
      openLibrary,
      openJournal,
      openManuscript,
      createBook,
      setBookPages,
      deleteBook,
      entryFor,
      entriesFor,
      publishedEntries,
      saveDay,
      publishDay,
      unpublishDay,
      linkFolder,
      reconnectFolder,
      unlinkFolder,
    }),
    [
      ready,
      store.books,
      store.entries,
      view,
      selectedDate,
      saveError,
      storage,
      openLibrary,
      openJournal,
      openManuscript,
      createBook,
      setBookPages,
      deleteBook,
      entryFor,
      entriesFor,
      publishedEntries,
      saveDay,
      publishDay,
      unpublishDay,
      linkFolder,
      reconnectFolder,
      unlinkFolder,
    ],
  )

  return <JournalContext.Provider value={value}>{children}</JournalContext.Provider>
}

export function useJournal() {
  const value = useContext(JournalContext)
  if (!value) throw new Error('useJournal must be used within JournalProvider')
  return value
}
