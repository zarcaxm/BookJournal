import { useState } from 'react'
import { wordCount } from '../dates.ts'
import { useJournal } from '../journal.tsx'
import { coverOf, entryHasWriting, entryInBook, entryIsDirty, pagesOf, type Book } from '../types.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'
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

export function Library() {
  const { books, entries, createBook, deleteBook } = useJournal()
  const [creating, setCreating] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Book | null>(null)
  const publishedWords = entries
    .filter((entry) => entry.status === 'published')
    .reduce((sum, entry) => sum + wordCount(entry.publishedBody ?? ''), 0)

  return (
    <main className="library">
      <header className="mast">
        <div>
          <p className="eyebrow">BookJournal</p>
          <h1>A shelf of books you write by the day.</h1>
          <p className="lede">
            Open a book and keep your thoughts on the calendar. Publish a day when it belongs in the manuscript.
            Export a PDF when the book feels ready.
          </p>
        </div>
        <button type="button" className="btn primary" onClick={() => setCreating(true)}>
          New book
        </button>
      </header>

      <p className="shelf-count">
        {books.length === 0
          ? 'Kept in this browser.'
          : `${books.length === 1 ? '1 book' : `${books.length} books`}${
              publishedWords > 0 ? ` · ${publishedWords.toLocaleString()} published words` : ''
            } · kept in this browser`}
      </p>

      {books.length === 0 ? (
        <section className="empty-shelf">
          <h2>The shelf is clear.</h2>
          <p>Start a book, write into a day, and publish it when the page is finished.</p>
        </section>
      ) : (
        <section className="shelf" aria-label="Books">
          {books.map((book) => (
            <BookCard key={book.id} book={book} onDelete={setPendingDelete} />
          ))}
        </section>
      )}

      <NewBookDialog open={creating} onClose={() => setCreating(false)} onCreate={createBook} />
      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete ? `Delete “${pendingDelete.title}”?` : 'Delete book?'}
        body="The journal and the manuscript for this book will be removed from this browser."
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
