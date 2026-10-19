/**
 * Owned hook regressions for PR #11. Bounded timers; always unmount.
 * Run: node --test --test-concurrency=1 --experimental-strip-types --test-timeout=15000 scripts/folder-sync.hook.test.ts
 */
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' })
const g = globalThis as typeof globalThis & {
  window: Window & typeof globalThis
  document: Document
  localStorage: Storage
  DOMException: typeof DOMException
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
g.window = dom.window as unknown as Window & typeof globalThis
g.document = dom.window.document
g.localStorage = dom.window.localStorage
g.DOMException = dom.window.DOMException
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true })
g.IS_REACT_ACT_ENVIRONMENT = false

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { useFolderSync } = await import('../src/useFolderSync.ts')
type Store = import('../src/types.ts').Store

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms))
async function until(fn: () => boolean, ms = 4000) {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout')
    await tick(10)
  }
}

const T = (m: number) => new Date(Date.UTC(2026, 9, 19, 12, m)).toISOString()
const BOOK = {
  id: 'b1',
  title: 'Book',
  author: '',
  intention: '',
  cover: 'oxblood' as const,
  pages: 'cream' as const,
  createdAt: T(0),
  updatedAt: T(0),
}
const ENTRY = {
  id: 'e1',
  bookId: 'b1',
  date: '2026-10-19',
  title: 'Day',
  body: 'v1',
  publishedTitle: null,
  publishedBody: null,
  status: 'draft' as const,
  updatedAt: T(1),
  publishedAt: null,
}
const empty: Store = { books: [], entries: [], deletedBooks: [], deletedEntries: [] }

type Gate = { wait: Promise<void>; open: () => void }
const gate = (): Gate => {
  let open!: () => void
  const wait = new Promise<void>((resolve) => {
    open = resolve
  })
  return { wait, open }
}

function makeFolder(initial: string | null) {
  const f = {
    text: initial,
    writes: 0,
    reads: 0,
    readGate: null as Gate | null,
    writeGate: null as Gate | null,
    handle: {
      name: 'Drive',
      kind: 'directory',
      async queryPermission() {
        return 'granted' as const
      },
      async requestPermission() {
        return 'granted' as const
      },
      async getFileHandle(_n: string, opts?: { create?: boolean }) {
        if (f.text === null) {
          if (!opts?.create) throw new DOMException('missing', 'NotFoundError')
          f.text = ''
        }
        return {
          async getFile() {
            return {
              async text() {
                f.reads += 1
                await tick(2)
                if (f.readGate) await f.readGate.wait
                return f.text ?? ''
              },
            }
          },
          async createWritable() {
            let buf = ''
            return {
              async write(s: string) {
                buf += s
              },
              async close() {
                await tick(2)
                if (f.writeGate) await f.writeGate.wait
                f.text = buf
                f.writes += 1
              },
              async abort() {},
            }
          },
        }
      },
    },
  }
  return f
}

type Mount = {
  api: { store: Store; setStore: (u: (s: Store) => Store) => void; sync: ReturnType<typeof useFolderSync> }
  unmount: () => void
}

const mounts: Mount[] = []

function mount(initial: Store, folder: ReturnType<typeof makeFolder>): Mount {
  localStorage.clear()
  ;(window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker = async () => folder.handle
  const api = {} as Mount['api']
  function Harness() {
    const [store, setStore] = React.useState(initial)
    const sync = useFolderSync(store, setStore)
    api.store = store
    api.setStore = setStore
    api.sync = sync
    return null
  }
  const el = document.createElement('div')
  const root = createRoot(el)
  root.render(React.createElement(Harness))
  const mounted: Mount = {
    api,
    unmount: () => {
      root.unmount()
      localStorage.clear()
    },
  }
  mounts.push(mounted)
  return mounted
}

afterEach(() => {
  while (mounts.length) mounts.pop()?.unmount()
})

const snapshot = (s: Partial<Store>) =>
  JSON.stringify({
    version: 1,
    app: 'BookJournal',
    savedAt: T(1),
    books: [],
    entries: [],
    deletedBooks: [],
    deletedEntries: [],
    ...s,
  })

test('connect adopts remote and reaches synced', async () => {
  const folder = makeFolder(snapshot({ books: [BOOK], entries: [ENTRY] }))
  const { api } = mount(empty, folder)
  await tick(20)
  await api.sync.connect()
  await until(() => api.sync.status === 'synced' || api.sync.status === 'error')
  assert.equal(api.sync.status, 'synced')
  assert.equal(api.store.entries.length, 1)
})

test('edit during read is kept in memory', async () => {
  const folder = makeFolder(snapshot({ books: [BOOK], entries: [ENTRY] }))
  const { api } = mount({ ...empty, books: [BOOK], entries: [ENTRY] }, folder)
  await tick(20)
  await api.sync.connect()
  await until(() => api.sync.status === 'synced')
  folder.readGate = gate()
  const pending = api.sync.syncNow()
  await until(() => folder.reads >= 2)
  api.setStore((s) => ({
    ...s,
    entries: s.entries.map((e) => (e.id === 'e1' ? { ...e, body: 'typed during sync', updatedAt: T(30) } : e)),
  }))
  folder.readGate.open()
  await pending
  await tick(50)
  assert.equal(api.store.entries.find((e) => e.id === 'e1')?.body, 'typed during sync')
  assert.equal(api.sync.status, 'synced')
})

test('disconnect during write does not restore meta', async () => {
  const folder = makeFolder(null)
  const { api } = mount({ ...empty, books: [BOOK] }, folder)
  await tick(20)
  folder.writeGate = gate()
  const pending = api.sync.connect()
  await until(() => folder.text === '' || folder.reads > 0 || api.sync.status === 'syncing')
  await tick(10)
  await api.sync.disconnect()
  folder.writeGate.open()
  await pending.catch(() => {})
  await tick(30)
  assert.equal(localStorage.getItem('bookjournal.sync.v1'), null)
  assert.equal(api.sync.status, 'disconnected')
})

test('ordinary edit does not spawn a conflict entry', async () => {
  const folder = makeFolder(null)
  const { api } = mount({ ...empty, books: [BOOK], entries: [ENTRY] }, folder)
  await tick(20)
  await api.sync.connect()
  await until(() => api.sync.status === 'synced')
  api.setStore((s) => ({
    ...s,
    entries: s.entries.map((e) => (e.id === 'e1' ? { ...e, body: 'v1 and more', updatedAt: T(50) } : e)),
  }))
  await until(() => api.sync.status === 'synced', 5000)
  await tick(200)
  assert.equal(api.store.entries.length, 1)
  assert.equal(api.store.entries[0]?.body, 'v1 and more')
})

test('permission denial leaves folder recoverable via reconnect', async () => {
  const folder = makeFolder(null)
  let permission: PermissionState = 'granted'
  folder.handle.queryPermission = async () => permission
  folder.handle.requestPermission = async () => permission
  const { api } = mount({ ...empty, books: [BOOK], entries: [ENTRY] }, folder)
  await tick(20)
  await api.sync.connect()
  await until(() => api.sync.status === 'synced')
  permission = 'prompt'
  const denied = api.sync.syncNow()
  await until(() => api.sync.status === 'syncing' || api.sync.status === 'needs-permission')
  await denied
  await until(() => api.sync.status !== 'syncing')
  assert.equal(api.sync.status, 'needs-permission')
  assert.ok(api.sync.folderName)
  permission = 'granted'
  const recovered = api.sync.reconnect()
  await recovered
  await until(() => api.sync.status === 'synced')
  assert.equal(api.sync.status, 'synced')
})
