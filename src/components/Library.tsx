import { useState } from 'react'
import { wordCount } from '../dates.ts'
import { useJournal } from '../journal.tsx'
import type { StorageInfo } from '../storage.ts'
import { coverOf, entryHasWriting, entryInBook, entryIsDirty, pagesOf, type Book } from '../types.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { ImportNotionDialog } from './ImportNotionDialog.tsx'
import { NewBookDialog } from './NewBookDialog.tsx'

function volumeLabel(published: number, drafts: number) {
  if (published === 0 && drafts === 0) return 'Nothing written yet'
  const parts: string[] = []
  if (published > 0) parts.push(published === 1 ? '1 day in the book' : `${published} days in the book`)
  if (drafts > 0) parts.push(drafts === 1 ? '1 draft' : `${drafts} drafts`)
  return parts.join(' · ')
}

function BookCard({ book, onDelete }: { book: Book; onDelete: (book: Book) => void }) {
  const { openJournal, entriesFor } = useJournal()
  const cover = coverOf(book.cover)
  const entries = entriesFor(book.id)
  const published = entries.filter((entry) => entryInBook(entry)).length
  const drafts = entries.filter((entry) => entryIsDirty(entry) || (!entryInBook(entry) && entryHasWriting(entry))).length

  return (
    <article className="volume">
      <button type="button" className="cover" onClick={() => openJournal(book.id)} style={{ background: cover.cloth, color: cover.foil }}>
        <span className="cover-kicker">Book</span>
        <span className="cover-title">{book.title}</span>
        <span className="cover-author">{book.author || 'Unsigned'}</span>
      </button>
      <p className="volume-meta">
        {pagesOf(book.pages).label} · {volumeLabel(published, drafts)}
      </p>
      <button type="button" className="text-button" onClick={() => onDelete(book)}>
        Delete
      </button>
    </article>
  )
}

function storageLabel(storage: StorageInfo) {
  if (storage.mode === 'folder' && storage.folderName) {
    return `Saved in folder “${storage.folderName}” as bookjournal.json`
  }
  if (storage.needsPermission && storage.folderName) {
    return `Folder “${storage.folderName}” needs permission again`
  }
  return 'Stored in this browser until you choose a folder'
}

export function Library() {
  const {
    ready,
    books,
    entries,
    createBook,
    importBook,
    deleteBook,
    storage,
    saveError,
    linkFolder,
    reconnectFolder,
    unlinkFolder,
  } = useJournal()
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Book | null>(null)
  const [storageBusy, setStorageBusy] = useState(false)
  const publishedWords = entries
    .filter((entry) => entry.status === 'published')
    .reduce((sum, entry) => sum + wordCount(entry.publishedBody ?? ''), 0)

  async function runStorageAction(action: () => Promise<void>) {
    setStorageBusy(true)
    try {
      await action()
    } catch {
      // saveError is set by the provider
    } finally {
      setStorageBusy(false)
    }
  }

  return (
    <main className="library">
      <header className="mast">
        <div>
          <p className="eyebrow">BookJournal</p>
          <h1>Write a book, one day at a time.</h1>
          <p className="lede">
            Journal into the calendar, publish days into the manuscript, and export a PDF when you are ready.
          </p>
        </div>
        <div className="mast-actions">
          <button type="button" className="btn quiet" onClick={() => setImporting(true)} disabled={!ready}>
            Import from Notion
          </button>
          <button type="button" className="btn primary" onClick={() => setCreating(true)} disabled={!ready}>
            New book
          </button>
        </div>
      </header>

      <section className="storage-bar" aria-label="Storage">
        <div>
          <p className="shelf-count">
            {!ready
              ? 'Opening journal…'
              : books.length === 0
                ? storageLabel(storage)
                : `${books.length === 1 ? '1 book' : `${books.length} books`}${
                    publishedWords > 0 ? ` · ${publishedWords.toLocaleString()} published words` : ''
                  } · ${storageLabel(storage)}`}
          </p>
          <p className="storage-hint">
            Choose a folder to keep your journal as a file — a Google Drive sync folder works well.
          </p>
        </div>
        <div className="storage-actions">
          {storage.needsPermission ? (
            <button
              type="button"
              className="btn"
              disabled={!ready || storageBusy}
              onClick={() => void runStorageAction(reconnectFolder)}
            >
              Reconnect folder
            </button>
          ) : null}
          {storage.folderSupported ? (
            <button
              type="button"
              className="btn"
              disabled={!ready || storageBusy}
              onClick={() => void runStorageAction(linkFolder)}
            >
              {storage.mode === 'folder' ? 'Change folder' : 'Save to folder'}
            </button>
          ) : null}
          {storage.mode === 'folder' ? (
            <button
              type="button"
              className="text-button"
              disabled={!ready || storageBusy}
              onClick={() => void runStorageAction(unlinkFolder)}
            >
              Use browser only
            </button>
          ) : null}
        </div>
      </section>

      {saveError ? <p className="banner">{saveError}</p> : null}

      {books.length === 0 ? (
        <section className="empty-shelf">
          <h2>No books yet</h2>
          <p>Create a book, write into a day, then publish it when the page is finished.</p>
        </section>
      ) : (
        <section className="shelf" aria-label="Books">
          {books.map((book) => (
            <BookCard key={book.id} book={book} onDelete={setPendingDelete} />
          ))}
        </section>
      )}

      <NewBookDialog open={creating} onClose={() => setCreating(false)} onCreate={createBook} />
      <ImportNotionDialog
        open={importing}
        onClose={() => setImporting(false)}
        onImport={(input) => {
          setImporting(false)
          importBook(input)
        }}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete ? `Delete “${pendingDelete.title}”?` : 'Delete book?'}
        body="The journal and the manuscript for this book will be removed from your storage."
        confirmLabel="Delete book"
        onConfirm={() => {
          if (pendingDelete) deleteBook(pendingDelete.id)
          setPendingDelete(null)
        }}
        onClose={() => setPendingDelete(null)}
      />
    </main>
  )
}
