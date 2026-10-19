import type { ReactNode } from 'react'
import { useJournal } from '../journal.tsx'
import type { Book } from '../types.ts'
import { ExportButton } from './ExportButton.tsx'
import { Icon } from './Icon.tsx'
import { PagePicker } from './PagePicker.tsx'
import { SyncStatus } from './SyncStatus.tsx'

export function BookChrome({
  book,
  mode,
  children,
}: {
  book: Book
  mode: 'journal' | 'manuscript'
  children: ReactNode
}) {
  const { openLibrary, openJournal, openManuscript, publishedEntries, saveError, setBookPages } = useJournal()
  const published = publishedEntries(book.id)

  return (
    <div className="workspace" data-pages={book.pages}>
      <header className="bookbar">
        <button type="button" className="btn ghost small back" onClick={openLibrary}>
          <Icon name="arrow-left" size={16} />
          Shelf
        </button>
        <div className="bookbar-title">
          <p className="eyebrow">{book.author || 'Unsigned'}</p>
          <h1>{book.title}</h1>
          {book.intention ? <p className="intention">{book.intention}</p> : null}
          <PagePicker value={book.pages} onChange={(pages) => setBookPages(book.id, pages)} />
        </div>
        <div className="bookbar-tools">
          <nav className="mode-switch" aria-label="Book sections">
            <button type="button" aria-current={mode === 'journal' ? 'page' : undefined} onClick={() => openJournal(book.id)}>
              Journal
            </button>
            <button
              type="button"
              aria-current={mode === 'manuscript' ? 'page' : undefined}
              onClick={() => openManuscript(book.id)}
            >
              Manuscript
              {published.length > 0 ? <span>{published.length}</span> : null}
            </button>
          </nav>
          <ExportButton book={book} entries={published} />
        </div>
      </header>
      {saveError ? <p className="banner">{saveError}</p> : null}
      <SyncStatus compact />
      {children}
    </div>
  )
}
