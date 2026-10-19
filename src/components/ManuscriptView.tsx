import { useState } from 'react'
import { formatLong, spanLabel, wordCount } from '../dates.ts'
import { useJournal } from '../journal.tsx'
import { entryIsDirty } from '../types.ts'
import { BookChrome } from './BookChrome.tsx'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { ExportButton } from './ExportButton.tsx'

export function ManuscriptView({ bookId }: { bookId: string }) {
  const { books, publishedEntries, openJournal, deleteBook } = useJournal()
  const [confirming, setConfirming] = useState(false)
  const book = books.find((item) => item.id === bookId)
  if (!book) return null

  const entries = publishedEntries(book.id)
  const words = entries.reduce((sum, entry) => sum + wordCount(entry.publishedBody ?? ''), 0)

  return (
    <BookChrome book={book} mode="manuscript">
      <article className="manuscript">
        <header className="manuscript-head">
          <p className="eyebrow">Manuscript</p>
          <h2>{book.title}</h2>
          <p className="lede">
            {entries.length === 0
              ? 'Nothing has been published yet. Days stay private in the journal until you add them to the book.'
              : `${entries.length === 1 ? '1 day' : `${entries.length} days`} · ${words.toLocaleString()} words${
                  entries.length > 0 ? ` · ${spanLabel(entries.map((entry) => entry.date))}` : ''
                }`}
          </p>
          <ExportButton book={book} entries={entries} prominent />
        </header>

        {entries.length === 0 ? (
          <button type="button" className="btn quiet" onClick={() => openJournal(book.id)}>
            Return to the journal
          </button>
        ) : (
          <ol className="chapters">
            {entries.map((entry) => {
              const pending = entryIsDirty(entry)
              const title = entry.publishedTitle?.trim()
              return (
                <li key={entry.id}>
                  <div className="chapter-head">
                    <div>
                      {title ? <p className="chapter-date">{formatLong(entry.date)}</p> : null}
                      <h3>{title || formatLong(entry.date)}</h3>
                    </div>
                    {pending ? <span className="status dirty">Newer draft in the journal</span> : null}
                  </div>
                  {entry.publishedBody?.split(/\n{2,}/).map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                  {pending ? (
                    <button type="button" className="text-button" onClick={() => openJournal(book.id, entry.date)}>
                      Open this day
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ol>
        )}

        <footer className="manuscript-foot">
          <button type="button" className="text-button danger-text" onClick={() => setConfirming(true)}>
            Delete this book
          </button>
        </footer>
      </article>
      <ConfirmDialog
        open={confirming}
        title={`Delete “${book.title}”?`}
        body="The journal and the manuscript for this book will be removed from this browser."
        confirmLabel="Delete book"
        onConfirm={() => deleteBook(book.id)}
        onClose={() => setConfirming(false)}
      />
    </BookChrome>
  )
}
