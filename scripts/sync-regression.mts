/**
 * Focused sync regression checks for folder-sync merge / snapshot classification.
 * Run: npx --yes tsx scripts/sync-regression.mts
 */
import { classifySnapshotText, mergeStores, sameStore } from '../src/sync.ts'
import type { Book, Entry, Store } from '../src/types.ts'

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
    books: [],
    entries: [],
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
  assert(merged.deletedBooks.some((t) => t.id === 'b1'), 'book tombstone retained')
  assert(merged.deletedEntries.some((t) => t.id === 'e1'), 'entry tombstone retained')
}

console.log('#18 same-day entries with different ids are both kept')
{
  const local = store({
    books: [book({ id: 'b1', title: 'Shared' })],
    entries: [entry({ id: 'local-day', bookId: 'b1', date: '2026-03-01', title: 'A', body: 'from A', updatedAt: '2026-03-01T10:00:00.000Z' })],
  })
  const remote = store({
    books: [book({ id: 'b1', title: 'Shared' })],
    entries: [entry({ id: 'remote-day', bookId: 'b1', date: '2026-03-01', title: 'B', body: 'from B', updatedAt: '2026-03-01T11:00:00.000Z' })],
  })
  const merged = mergeStores(local, remote)
  const ids = new Set(merged.entries.map((item) => item.id))
  assert(ids.has('local-day'), 'keeps local same-day entry')
  assert(ids.has('remote-day'), 'keeps remote same-day entry')
}

console.log('#20 newer book updatedAt wins')
{
  const local = store({
    books: [book({ id: 'b1', title: 'Local', pages: 'cream', updatedAt: '2026-01-01T00:00:00.000Z' })],
  })
  const remote = store({
    books: [book({ id: 'b1', title: 'Remote', pages: 'ruled', updatedAt: '2026-02-01T00:00:00.000Z' })],
  })
  const merged = mergeStores(local, remote)
  assert(merged.books[0]?.pages === 'ruled', 'remote book pages win on newer updatedAt')
  assert(merged.books[0]?.title === 'Remote', 'remote book title wins on newer updatedAt')
}

console.log('#22 empty snapshot text is missing (recoverable)')
{
  assert(classifySnapshotText('').status === 'missing', 'empty string => missing')
  assert(classifySnapshotText('   \n').status === 'missing', 'whitespace => missing')
  assert(classifySnapshotText('{not-json').status === 'unreadable', 'broken json => unreadable')
  const ready = classifySnapshotText(
    JSON.stringify({ app: 'BookJournal', books: [], entries: [], savedAt: '2026-01-01T00:00:00.000Z' }),
  )
  assert(ready.status === 'ready', 'valid snapshot => ready')
}

console.log('#24 mergeStores is pure over prev (functional-update safe)')
{
  const prev = store({
    books: [book({ id: 'b1', title: 'Local' })],
    entries: [entry({ id: 'e-new', bookId: 'b1', date: '2026-04-01', title: 'Typing', updatedAt: '2026-04-01T12:00:00.000Z' })],
  })
  const remote = store({
    books: [book({ id: 'b1', title: 'Local' })],
    entries: [entry({ id: 'e-old', bookId: 'b1', date: '2026-03-01', title: 'Older', updatedAt: '2026-03-01T12:00:00.000Z' })],
  })
  const once = mergeStores(prev, remote)
  const twice = mergeStores(prev, remote)
  assert(sameStore(once, twice), 'mergeStores is deterministic')
  assert(
    once.entries.some((item) => item.id === 'e-new') && once.entries.some((item) => item.id === 'e-old'),
    'functional merge onto prev keeps in-flight local entry and remote entry',
  )
}

console.log('#26 divergent same-id edits keep a conflict copy')
{
  const local = store({
    books: [book({ id: 'b1', title: 'Shared' })],
    entries: [
      entry({
        id: 'e1',
        bookId: 'b1',
        date: '2026-05-01',
        title: 'Local edit',
        body: 'local body',
        updatedAt: '2026-05-01T10:00:00.000Z',
      }),
    ],
  })
  const remote = store({
    books: [book({ id: 'b1', title: 'Shared' })],
    entries: [
      entry({
        id: 'e1',
        bookId: 'b1',
        date: '2026-05-01',
        title: 'Remote edit',
        body: 'remote body',
        updatedAt: '2026-05-01T11:00:00.000Z',
      }),
    ],
  })
  const merged = mergeStores(local, remote)
  const winner = merged.entries.find((item) => item.id === 'e1')
  const conflict = merged.entries.find((item) => item.id === 'e1__conflict')
  assert(winner?.title === 'Remote edit', 'newer updatedAt wins primary id')
  assert(Boolean(conflict), 'loser preserved as conflict copy')
  assert(conflict?.title.startsWith('[Conflict] '), 'conflict title is marked')
  assert(conflict?.body === 'local body', 'conflict copy keeps losing body')
}

console.log('#28 skip write when merged equals remote')
{
  const local = store({
    books: [book({ id: 'b1', title: 'Book', updatedAt: '2026-01-01T00:00:00.000Z' })],
    entries: [entry({ id: 'e1', bookId: 'b1', date: '2026-01-02', title: 'Old', updatedAt: '2026-01-02T00:00:00.000Z' })],
  })
  const remote = store({
    books: [book({ id: 'b1', title: 'Book', updatedAt: '2026-02-01T00:00:00.000Z' })],
    entries: [
      entry({ id: 'e1', bookId: 'b1', date: '2026-01-02', title: 'Old', updatedAt: '2026-01-02T00:00:00.000Z' }),
      entry({ id: 'e2', bookId: 'b1', date: '2026-02-02', title: 'New remote', updatedAt: '2026-02-02T00:00:00.000Z' }),
    ],
  })
  const merged = mergeStores(local, remote)
  assert(sameStore(merged, remote), 'adopting newer remote yields merged === remote (skip rewrite)')
  assert(!sameStore(merged, local), 'local was stale so store should update')
}

console.log('#9/#10 source contracts')
{
  const fs = await import('node:fs/promises')
  const source = await fs.readFile(new URL('../src/useFolderSync.ts', import.meta.url), 'utf8')
  assert(source.includes('pushGeneration'), '#9 push generation guard present')
  assert(
    /if \(generation === pushGeneration\.current\) setStatus\('synced'\)/.test(source),
    '#9 synced only for latest generation',
  )
  assert(/const reconnect = syncNow/.test(source), '#10 reconnect aliases syncNow')
  assert(!/const reconnect = useCallback\(async \(\) => \{[\s\S]*await push\(true\)/.test(source), '#10 no duplicated reconnect body')
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll sync regression checks passed')
