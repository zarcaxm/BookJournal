import { describe, expect, it } from 'vitest'
import { coverOf, entryHasWriting, entryInBook, entryIsDirty, pagesOf, type Entry } from './types.ts'

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'e1',
    bookId: 'b1',
    date: '2024-03-15',
    title: '',
    body: '',
    publishedTitle: null,
    publishedBody: null,
    status: 'draft',
    updatedAt: '2024-03-15T12:00:00.000Z',
    publishedAt: null,
    ...overrides,
  }
}

describe('coverOf / pagesOf', () => {
  it('resolves known ids', () => {
    expect(coverOf('navy').id).toBe('navy')
    expect(pagesOf('ruled').id).toBe('ruled')
  })

  it('falls back to the first option for unknown ids', () => {
    expect(coverOf('missing' as never).id).toBe('oxblood')
    expect(pagesOf('missing' as never).id).toBe('cream')
  })
})

describe('entryInBook', () => {
  it('is false for drafts and empty published snapshots', () => {
    expect(entryInBook(entry({ status: 'draft', publishedBody: 'x' }))).toBe(false)
    expect(entryInBook(entry({ status: 'published', publishedTitle: '  ', publishedBody: '  ' }))).toBe(false)
  })

  it('is true when published content exists', () => {
    expect(entryInBook(entry({ status: 'published', publishedTitle: 'Day one' }))).toBe(true)
    expect(entryInBook(entry({ status: 'published', publishedBody: 'Hello' }))).toBe(true)
  })
})

describe('entryIsDirty', () => {
  it('is false when the entry is not in the book', () => {
    expect(entryIsDirty(entry({ title: 'changed', body: 'changed' }))).toBe(false)
  })

  it('is false when draft matches the published snapshot', () => {
    expect(
      entryIsDirty(
        entry({
          status: 'published',
          title: 'Day one',
          body: 'Hello',
          publishedTitle: 'Day one',
          publishedBody: 'Hello',
        }),
      ),
    ).toBe(false)
  })

  it('is true when title or body diverges from the published snapshot', () => {
    expect(
      entryIsDirty(
        entry({
          status: 'published',
          title: 'Day one edited',
          body: 'Hello',
          publishedTitle: 'Day one',
          publishedBody: 'Hello',
        }),
      ),
    ).toBe(true)
    expect(
      entryIsDirty(
        entry({
          status: 'published',
          title: 'Day one',
          body: 'Hello world',
          publishedTitle: 'Day one',
          publishedBody: 'Hello',
        }),
      ),
    ).toBe(true)
  })
})

describe('entryHasWriting', () => {
  it('detects non-empty title or body', () => {
    expect(entryHasWriting(entry())).toBe(false)
    expect(entryHasWriting(entry({ title: '  ' }))).toBe(false)
    expect(entryHasWriting(entry({ title: 'Chapter' }))).toBe(true)
    expect(entryHasWriting(entry({ body: 'Words' }))).toBe(true)
  })
})
