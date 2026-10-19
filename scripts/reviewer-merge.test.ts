// Adapted from the independent Reviewer repro suite. Run:
// node --test --experimental-strip-types scripts/reviewer-merge.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeStores, readSnapshot, sameStore } from '../src/sync.ts'
import { primaryEntryFor, isConflictId } from '../src/types.ts'
import type { Book, Entry, Store } from '../src/types.ts'

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
const conflicts = (s: Store) => s.entries.filter((e) => isConflictId(e.id))

test('#16 deleted book stays deleted', () => {
  const remote = store({ books: [book()], entries: [entry()] })
  const local = store({ deletedBooks: [{ id: 'b1', deletedAt: T(5) }], deletedEntries: [{ id: 'e1', deletedAt: T(5) }] })
  const m = mergeStores(local, remote)
  assert.equal(m.books.length, 0)
  assert.equal(m.entries.length, 0)
})

test('#16 cleared draft stays deleted', () => {
  const remote = store({ books: [book()], entries: [entry()] })
  const local = store({ books: [book()], deletedEntries: [{ id: 'e1', deletedAt: T(5) }] })
  assert.equal(mergeStores(local, remote).entries.length, 0)
})

test('#18 same-day entries are folded into one accessible entry', () => {
  const a = store({ books: [book()], entries: [entry({ id: 'eA', body: 'A wrote this', updatedAt: T(2) })] })
  const b = store({ books: [book()], entries: [entry({ id: 'eB', body: 'B wrote this', updatedAt: T(3) })] })
  const m = mergeStores(a, b)
  assert.equal(m.entries.filter((e) => !isConflictId(e.id)).length, 1)
  const shown = primaryEntryFor(m.entries, 'b1', '2026-10-19')
  assert.ok(shown)
  assert.match(shown.body, /A wrote this/)
  assert.match(shown.body, /B wrote this/)
})

test('#20 newer book change from another device wins', () => {
  const stale = store({ books: [book({ pages: 'cream', updatedAt: T(0) })] })
  const newer = store({ books: [book({ pages: 'night', updatedAt: T(4) })] })
  assert.equal(mergeStores(stale, newer).books[0].pages, 'night')
})

test('BLOCKER: a normal single-device edit does not create a [Conflict] copy', () => {
  const remote = store({ books: [book()], entries: [entry({ body: 'v1', updatedAt: T(1) })] })
  const local = store({ books: [book()], entries: [entry({ body: 'v1 plus more words', updatedAt: T(2) })] })
  const m = mergeStores(local, remote)
  assert.equal(conflicts(m).length, 0)
  assert.equal(m.entries.length, 1)
  assert.equal(m.entries[0].body, 'v1 plus more words')
})

test('BLOCKER: published entry edit does not duplicate the manuscript', () => {
  const pub = { status: 'published' as const, publishedTitle: 'Day', publishedBody: 'v1', publishedAt: T(1) }
  const remote = store({ books: [book()], entries: [entry({ ...pub, body: 'v1', updatedAt: T(1) })] })
  const local = store({
    books: [book()],
    entries: [entry({ ...pub, publishedBody: 'v2', body: 'v2', updatedAt: T(2) })],
  })
  const m = mergeStores(local, remote)
  const manuscript = m.entries.filter(
    (e) => e.status === 'published' && Boolean(e.publishedBody?.trim() || e.publishedTitle?.trim()),
  )
  assert.equal(manuscript.length, 1)
})

test('#26 concurrent edits with a sync base keep both bodies', () => {
  const base = store({ books: [book()], entries: [entry({ body: 'shared base', updatedAt: T(0) })] })
  const old = entry({ id: 'e1__conflict__old', title: '[Conflict] Day', body: 'first loser', updatedAt: T(1) })
  const local = store({ books: [book()], entries: [entry({ body: 'device A text', updatedAt: T(3) }), old] })
  const remote = store({
    books: [book()],
    entries: [entry({ body: 'device B text (fast clock)', updatedAt: T(9) }), old],
  })
  const m = mergeStores(local, remote, base)
  const bodies = m.entries.map((e) => e.body)
  assert.ok(bodies.includes('device A text'), "device A's text should survive somewhere")
  assert.ok(bodies.includes('device B text (fast clock)'), "device B's text should survive")
})

test('#26 clock skew: deletion is not resurrected by a fast-clock remote stamp', () => {
  const remote = store({ books: [book()], entries: [entry({ updatedAt: T(10) })] })
  const local = store({ books: [book()], deletedEntries: [{ id: 'e1', deletedAt: T(6) }] })
  assert.equal(mergeStores(local, remote).entries.length, 0)
})

test('#28 merge of identical stores is a no-op', () => {
  const s = store({ books: [book()], entries: [entry()] })
  assert.ok(sameStore(mergeStores(s, s), s))
})

test('#28 after an ordinary edit merge, the next merge is stable', () => {
  const remote = store({ books: [book()], entries: [entry({ body: 'v1', updatedAt: T(1) })] })
  const local = store({ books: [book()], entries: [entry({ body: 'v2', updatedAt: T(2) })] })
  const m1 = mergeStores(local, remote)
  const m2 = mergeStores(m1, m1)
  assert.ok(sameStore(m1, m2))
  assert.equal(conflicts(m1).length, 0)
})

function fakeDir(text: string | null) {
  return {
    name: 'Drive',
    async getFileHandle(_n: string) {
      if (text === null) throw new DOMException('nope', 'NotFoundError')
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
  } as unknown as FileSystemDirectoryHandle
}

test('#22 empty / whitespace file is treated as missing', async () => {
  assert.equal((await readSnapshot(fakeDir(''))).status, 'missing')
  assert.equal((await readSnapshot(fakeDir('  \n'))).status, 'missing')
})

test('#22 truncated JSON is reported unreadable (not overwritten)', async () => {
  assert.equal((await readSnapshot(fakeDir('{"books":[{"id"'))).status, 'unreadable')
})
