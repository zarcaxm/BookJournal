/**
 * Owned merge regressions for PR #11. Does not modify Reviewer repro assertions.
 * Run: node --test --test-concurrency=1 --experimental-strip-types --test-timeout=10000 scripts/folder-sync.merge.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeStores, readSnapshot, sameStore } from '../src/sync.ts'
import { isConflictId, primaryEntryFor, type Book, type Entry, type Store } from '../src/types.ts'

const T = (m: number) => new Date(Date.UTC(2026, 9, 19, 12, m)).toISOString()
const book = (over: Partial<Book> = {}): Book => ({
  id: 'b1',
  title: 'Book',
  author: '',
  intention: '',
  cover: 'oxblood',
  pages: 'cream',
  createdAt: T(0),
  updatedAt: T(0),
  ...over,
})
const entry = (over: Partial<Entry> = {}): Entry => ({
  id: 'e1',
  bookId: 'b1',
  date: '2026-10-19',
  title: 'Day',
  body: 'v1',
  publishedTitle: null,
  publishedBody: null,
  status: 'draft',
  updatedAt: T(1),
  publishedAt: null,
  ...over,
})
const store = (over: Partial<Store> = {}): Store => ({
  books: [],
  entries: [],
  deletedBooks: [],
  deletedEntries: [],
  ...over,
})

test('unknown base: divergent same-id keeps LOCAL and REMOTE text', () => {
  const local = store({ books: [book()], entries: [entry({ body: 'LOCAL TEXT', updatedAt: T(2) })] })
  const remote = store({ books: [book()], entries: [entry({ body: 'REMOTE TEXT', updatedAt: T(5) })] })
  const m = mergeStores(local, remote)
  const bodies = m.entries.map((e) => e.body).join('\n')
  assert.match(bodies, /LOCAL TEXT/)
  assert.match(bodies, /REMOTE TEXT/)
  assert.equal(m.entries.find((e) => e.id === 'e1')?.body, 'REMOTE TEXT')
  assert.ok(m.entries.some((e) => isConflictId(e.id) && e.body.includes('LOCAL TEXT')))
})

test('known base: ordinary local edit does not create a conflict', () => {
  const base = store({ books: [book()], entries: [entry({ body: 'v1', updatedAt: T(1) })] })
  const remote = store({ books: [book()], entries: [entry({ body: 'v1', updatedAt: T(1) })] })
  const local = store({ books: [book()], entries: [entry({ body: 'v1 plus more', updatedAt: T(2) })] })
  const m = mergeStores(local, remote, base)
  assert.equal(m.entries.filter((e) => isConflictId(e.id)).length, 0)
  assert.equal(m.entries[0]?.body, 'v1 plus more')
})

test('same-day collision preserves draft and published text in the accessible entry', () => {
  const a = store({
    books: [book()],
    entries: [
      entry({
        id: 'eA',
        body: 'draft A',
        publishedTitle: 'Pub A',
        publishedBody: 'published A',
        status: 'published',
        publishedAt: T(1),
        updatedAt: T(2),
      }),
    ],
  })
  const b = store({
    books: [book()],
    entries: [
      entry({
        id: 'eB',
        body: 'draft B',
        publishedTitle: 'Pub B',
        publishedBody: 'published B',
        status: 'published',
        publishedAt: T(1),
        updatedAt: T(3),
      }),
    ],
  })
  const m = mergeStores(a, b)
  const shown = primaryEntryFor(m.entries, 'b1', '2026-10-19')
  assert.ok(shown)
  assert.match(shown.body, /draft A/)
  assert.match(shown.body, /draft B/)
  assert.ok(
    (shown.publishedBody && /published A/.test(shown.publishedBody) && /published B/.test(shown.publishedBody)) ||
      (/published A/.test(shown.body) && /published B/.test(shown.publishedBody ?? '')),
  )
})

test('repeated concurrent merge does not multiply conflict copies', () => {
  const base = store({ books: [book()], entries: [entry({ body: 'base', updatedAt: T(0) })] })
  const local = store({ books: [book()], entries: [entry({ body: 'device A', updatedAt: T(3) })] })
  const remote = store({ books: [book()], entries: [entry({ body: 'device B', updatedAt: T(9) })] })
  const once = mergeStores(local, remote, base)
  const again = mergeStores(once, remote, base)
  const thrice = mergeStores(again, again, base)
  assert.ok(sameStore(again, thrice))
  const conflictCount = once.entries.filter((e) => isConflictId(e.id)).length
  assert.equal(again.entries.filter((e) => isConflictId(e.id)).length, conflictCount)
  assert.ok(once.entries.some((e) => e.body.includes('device A')))
  assert.ok(once.entries.some((e) => e.body.includes('device B')))
})

test('tombstone beats fast-clock remote stamp', () => {
  const remote = store({ books: [book()], entries: [entry({ updatedAt: T(10) })] })
  const local = store({ books: [book()], deletedEntries: [{ id: 'e1', deletedAt: T(6) }] })
  assert.equal(mergeStores(local, remote).entries.length, 0)
})

test('empty snapshot text is missing; truncated JSON is unreadable', async () => {
  const fake = (text: string | null) =>
    ({
      async getFileHandle() {
        if (text === null) throw new DOMException('missing', 'NotFoundError')
        return {
          async getFile() {
            return {
              async text() {
                return text
              },
            }
          },
        }
      },
    }) as unknown as FileSystemDirectoryHandle
  assert.equal((await readSnapshot(fake(''))).status, 'missing')
  assert.equal((await readSnapshot(fake('{"books":[{"id"'))).status, 'unreadable')
})
