/**
 * Focused sync regression checks. Prefer scripts/reviewer-merge.test.ts for the full suite.
 * Run: npx --yes tsx scripts/sync-regression.mts
 */
import { classifySnapshotText, mergeStores, sameStore } from '../src/sync.ts'
import { isConflictId, primaryEntryFor, type Book, type Entry, type Store } from '../src/types.ts'

let failed = 0

function assert(condition: unknown, message: string) {
  if (condition) {
    console.log(`  ok  ${message}`)
    return
  }
  failed += 1
  console.error(`  FAIL ${message}`)
}

function book(partial: Partial<Book> & Pick<Book, 'id' | 'title'>): Book {
  const createdAt = partial.createdAt ?? '2026-01-01T00:00:00.000Z'
  return {
    id: partial.id,
    title: partial.title,
    author: partial.author ?? '',
    intention: partial.intention ?? '',
    cover: partial.cover ?? 'oxblood',
    pages: partial.pages ?? 'cream',
    createdAt,
    updatedAt: partial.updatedAt ?? createdAt,
  }
}

function entry(partial: Partial<Entry> & Pick<Entry, 'id' | 'bookId' | 'date'>): Entry {
  return {
    id: partial.id,
    bookId: partial.bookId,
    date: partial.date,
    title: partial.title ?? '',
    body: partial.body ?? '',
    publishedTitle: partial.publishedTitle ?? null,
    publishedBody: partial.publishedBody ?? null,
    status: partial.status ?? 'draft',
    updatedAt: partial.updatedAt ?? '2026-01-01T00:00:00.000Z',
    publishedAt: partial.publishedAt ?? null,
  }
}

function store(partial: Partial<Store> = {}): Store {
  return {
    books: partial.books ?? [],
    entries: partial.entries ?? [],
    deletedBooks: partial.deletedBooks ?? [],
    deletedEntries: partial.deletedEntries ?? [],
  }
}

console.log('#16 tombstones keep deletions')
{
  const local = store({
    deletedBooks: [{ id: 'b1', deletedAt: '2026-02-01T00:00:00.000Z' }],
    deletedEntries: [{ id: 'e1', deletedAt: '2026-02-01T00:00:00.000Z' }],
  })
  const remote = store({
    books: [book({ id: 'b1', title: 'Gone' })],
    entries: [entry({ id: 'e1', bookId: 'b1', date: '2026-01-02', title: 'Old' })],
  })
  const merged = mergeStores(local, remote)
  assert(merged.books.length === 0, 'deleted book stays deleted')
  assert(merged.entries.length === 0, 'deleted entry stays deleted')
}

console.log('#18 same-day entries fold into one accessible entry')
{
  const local = store({
    books: [book({ id: 'b1', title: 'Shared' })],
    entries: [
      entry({
        id: 'local-day',
        bookId: 'b1',
        date: '2026-03-01',
        title: 'A',
        body: 'from A',
        updatedAt: '2026-03-01T10:00:00.000Z',
      }),
    ],
  })
  const remote = store({
    books: [book({ id: 'b1', title: 'Shared' })],
    entries: [
      entry({
        id: 'remote-day',
        bookId: 'b1',
        date: '2026-03-01',
        title: 'B',
        body: 'from B',
        updatedAt: '2026-03-01T11:00:00.000Z',
      }),
    ],
  })
  const merged = mergeStores(local, remote)
  const shown = primaryEntryFor(merged.entries, 'b1', '2026-03-01')
  assert(merged.entries.filter((item) => !isConflictId(item.id)).length === 1, 'one primary entry per day')
  assert(Boolean(shown && /from A/.test(shown.body) && /from B/.test(shown.body)), 'composer sees both texts')
}

console.log('#20/#22/#26/#28 smoke')
{
  const stale = store({ books: [book({ id: 'b1', title: 'Local', pages: 'cream', updatedAt: '2026-01-01T00:00:00.000Z' })] })
  const newer = store({ books: [book({ id: 'b1', title: 'Remote', pages: 'ruled', updatedAt: '2026-02-01T00:00:00.000Z' })] })
  assert(mergeStores(stale, newer).books[0]?.pages === 'ruled', 'newer book updatedAt wins')
  assert(classifySnapshotText('').status === 'missing', 'empty => missing')
  assert(classifySnapshotText('{not-json').status === 'unreadable', 'broken => unreadable')

  const base = store({
    books: [book({ id: 'b1', title: 'Shared' })],
    entries: [entry({ id: 'e1', bookId: 'b1', date: '2026-05-01', body: 'v1', updatedAt: '2026-05-01T10:00:00.000Z' })],
  })
  const remote = store({
    books: [book({ id: 'b1', title: 'Shared' })],
    entries: [entry({ id: 'e1', bookId: 'b1', date: '2026-05-01', body: 'v1', updatedAt: '2026-05-01T10:00:00.000Z' })],
  })
  const local = store({
    books: [book({ id: 'b1', title: 'Shared' })],
    entries: [entry({ id: 'e1', bookId: 'b1', date: '2026-05-01', body: 'v2', updatedAt: '2026-05-01T11:00:00.000Z' })],
  })
  const ordinary = mergeStores(local, remote, base)
  assert(ordinary.entries.length === 1 && !isConflictId(ordinary.entries[0].id), 'ordinary edit with base has no conflict copy')

  const firstConnect = mergeStores(
    store({
      books: [book({ id: 'b1', title: 'Shared' })],
      entries: [entry({ id: 'e1', bookId: 'b1', date: '2026-05-01', body: 'LOCAL TEXT', updatedAt: '2026-05-01T02:00:00.000Z' })],
    }),
    store({
      books: [book({ id: 'b1', title: 'Shared' })],
      entries: [entry({ id: 'e1', bookId: 'b1', date: '2026-05-01', body: 'REMOTE TEXT', updatedAt: '2026-05-01T05:00:00.000Z' })],
    }),
  )
  const firstBodies = firstConnect.entries.map((item) => item.body).join('\n')
  assert(/LOCAL TEXT/.test(firstBodies) && /REMOTE TEXT/.test(firstBodies), 'unknown-base divergent same-id keeps both texts')

  const deleted = mergeStores(
    store({ books: [book({ id: 'b1', title: 'Shared' })], deletedEntries: [{ id: 'e1', deletedAt: '2026-05-01T06:00:00.000Z' }] }),
    store({
      books: [book({ id: 'b1', title: 'Shared' })],
      entries: [entry({ id: 'e1', bookId: 'b1', date: '2026-05-01', updatedAt: '2026-05-01T10:00:00.000Z' })],
    }),
  )
  assert(deleted.entries.length === 0, 'tombstone beats fast-clock remote stamp')

  const concurrentBase = store({
    books: [book({ id: 'b1', title: 'Shared' })],
    entries: [entry({ id: 'e1', bookId: 'b1', date: '2026-05-01', body: 'base', updatedAt: '2026-05-01T01:00:00.000Z' })],
  })
  const concurrent = mergeStores(
    store({
      books: [book({ id: 'b1', title: 'Shared' })],
      entries: [entry({ id: 'e1', bookId: 'b1', date: '2026-05-01', body: 'A', updatedAt: '2026-05-01T03:00:00.000Z' })],
    }),
    store({
      books: [book({ id: 'b1', title: 'Shared' })],
      entries: [entry({ id: 'e1', bookId: 'b1', date: '2026-05-01', body: 'B', updatedAt: '2026-05-01T09:00:00.000Z' })],
    }),
    concurrentBase,
  )
  const bodies = concurrent.entries.map((item) => item.body)
  assert(bodies.includes('A') && bodies.includes('B'), 'concurrent edits with base keep both bodies')

  assert(sameStore(mergeStores(remote, remote), remote), 'identical merge is no-op')
}

console.log('#9/#10 source contracts')
{
  const fs = await import('node:fs/promises')
  const source = await fs.readFile(new URL('../src/useFolderSync.ts', import.meta.url), 'utf8')
  assert(source.includes('pushGeneration'), '#9 push generation guard present')
  assert(source.includes('connectionGeneration'), '#5 disconnect generation present')
  assert(source.includes('const local = storeRef.current'), '#1 merge computed outside setStore updater')
  assert(source.includes('prev === local ? merged'), '#1/#24 updater re-merges if prev advanced')
  assert(/const reconnect = syncNow/.test(source), '#10 reconnect aliases syncNow')
  assert(source.includes("loadSyncMeta() ? 'connecting'"), '#8 starts connecting not needs-permission')
  assert(source.includes("statusRef.current === 'needs-permission'"), '#7 skips push while paused')
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll sync regression checks passed')
