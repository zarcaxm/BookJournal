import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadStore, saveStore } from './storage.ts'
import type { Store } from './types.ts'

const KEY = 'bookjournal.v1'

const validStore: Store = {
  books: [
    {
      id: 'book-1',
      title: 'Field Notes',
      author: 'André',
      intention: 'Write daily',
      cover: 'forest',
      pages: 'ruled',
      createdAt: '2024-01-01T00:00:00.000Z',
    },
  ],
  entries: [
    {
      id: 'entry-1',
      bookId: 'book-1',
      date: '2024-03-15',
      title: 'Day one',
      body: 'Hello',
      publishedTitle: 'Day one',
      publishedBody: 'Hello',
      status: 'published',
      updatedAt: '2024-03-15T12:00:00.000Z',
      publishedAt: '2024-03-15T12:00:00.000Z',
    },
  ],
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('saveStore / loadStore', () => {
  it('round-trips a valid store', () => {
    saveStore(validStore)
    expect(loadStore()).toEqual(validStore)
  })

  it('returns an empty store when nothing is saved', () => {
    expect(loadStore()).toEqual({ books: [], entries: [] })
  })

  it('returns an empty store for invalid JSON', () => {
    localStorage.setItem(KEY, '{not-json')
    expect(loadStore()).toEqual({ books: [], entries: [] })
  })

  it('drops malformed books and orphaned entries', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        books: [
          { id: 'book-1', title: 'Keep me', cover: 'navy', pages: 'cream', createdAt: '2024-01-01T00:00:00.000Z' },
          { title: 'missing id' },
          null,
        ],
        entries: [
          {
            id: 'entry-1',
            bookId: 'book-1',
            date: '2024-03-15',
            title: 'Kept',
            body: 'Yes',
            status: 'draft',
            updatedAt: '2024-03-15T12:00:00.000Z',
          },
          {
            id: 'entry-2',
            bookId: 'missing-book',
            date: '2024-03-16',
            title: 'Orphan',
            body: 'No',
            status: 'draft',
            updatedAt: '2024-03-16T12:00:00.000Z',
          },
          { id: 'entry-3', bookId: 'book-1', date: 'bad-date' },
        ],
      }),
    )

    const store = loadStore()
    expect(store.books).toHaveLength(1)
    expect(store.books[0]).toMatchObject({
      id: 'book-1',
      title: 'Keep me',
      author: '',
      intention: '',
      cover: 'navy',
      pages: 'cream',
    })
    expect(store.entries).toHaveLength(1)
    expect(store.entries[0]).toMatchObject({
      id: 'entry-1',
      bookId: 'book-1',
      title: 'Kept',
      status: 'draft',
      publishedTitle: null,
      publishedBody: null,
      publishedAt: null,
    })
  })

  it('falls back to default cover/pages and draft status for bad values', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        books: [{ id: 'book-1', title: 'Fallback', cover: 'neon', pages: 'parchment' }],
        entries: [
          {
            id: 'entry-1',
            bookId: 'book-1',
            date: '2024-03-15',
            status: 'archived',
          },
        ],
      }),
    )

    const store = loadStore()
    expect(store.books[0].cover).toBe('oxblood')
    expect(store.books[0].pages).toBe('cream')
    expect(store.entries[0].status).toBe('draft')
    expect(store.entries[0].title).toBe('')
    expect(store.entries[0].body).toBe('')
  })
})
