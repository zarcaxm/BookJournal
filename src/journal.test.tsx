import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { JournalProvider, useJournal } from './journal.tsx'
import type { DayDraft } from './types.ts'

function Harness() {
  const journal = useJournal()
  const book = journal.books[0]
  const entry = book ? journal.entryFor(book.id, journal.selectedDate) : undefined
  const published = book ? journal.publishedEntries(book.id) : []

  return (
    <div>
      <div data-testid="ready">{journal.ready ? 'yes' : 'no'}</div>
      <div data-testid="view">{journal.view.name}</div>
      <div data-testid="book-count">{journal.books.length}</div>
      <div data-testid="entry-count">{book ? journal.entriesFor(book.id).length : 0}</div>
      <div data-testid="published-count">{published.length}</div>
      <div data-testid="selected-date">{journal.selectedDate}</div>
      <div data-testid="entry-status">{entry?.status ?? 'none'}</div>
      <div data-testid="entry-title">{entry?.title ?? ''}</div>
      <div data-testid="entry-body">{entry?.body ?? ''}</div>
      <div data-testid="published-title">{entry?.publishedTitle ?? ''}</div>
      <div data-testid="book-pages">{book?.pages ?? ''}</div>
      <div data-testid="book-id">{book?.id ?? ''}</div>

      <button
        type="button"
        onClick={() =>
          journal.createBook({
            title: '  Field Notes  ',
            intention: '  Daily  ',
            cover: 'forest',
            pages: 'ruled',
          })
        }
      >
        create
      </button>
      <button type="button" onClick={() => book && journal.openLibrary()}>
        library
      </button>
      <button type="button" onClick={() => book && journal.openManuscript(book.id)}>
        manuscript
      </button>
      <button type="button" onClick={() => book && journal.openJournal(book.id, '2024-03-15')}>
        journal-day
      </button>
      <button type="button" onClick={() => book && journal.setBookPages(book.id, 'night')}>
        pages
      </button>
      <button type="button" onClick={() => book && journal.deleteBook(book.id)}>
        delete
      </button>
      <button
        type="button"
        onClick={() => book && journal.saveDay(book.id, journal.selectedDate, draft('Chapter', 'Hello world'))}
      >
        save
      </button>
      <button
        type="button"
        onClick={() => book && journal.saveDay(book.id, journal.selectedDate, draft('', ''))}
      >
        clear-draft
      </button>
      <button
        type="button"
        onClick={() => book && journal.saveDay(book.id, journal.selectedDate, draft('  ', '  '))}
      >
        clear-whitespace
      </button>
      <button
        type="button"
        onClick={() => book && journal.publishDay(book.id, journal.selectedDate, draft('Chapter', 'Hello world'))}
      >
        publish
      </button>
      <button
        type="button"
        onClick={() => book && journal.publishDay(book.id, journal.selectedDate, draft('', 'Hello'))}
      >
        publish-incomplete
      </button>
      <button
        type="button"
        onClick={() =>
          book && journal.saveDay(book.id, journal.selectedDate, draft('Edited', 'Hello world revised'))
        }
      >
        edit-after-publish
      </button>
      <button
        type="button"
        onClick={() => {
          if (!book) return
          const current = journal.entryFor(book.id, journal.selectedDate)
          if (current) journal.unpublishDay(current.id)
        }}
      >
        unpublish
      </button>
      <button
        type="button"
        onClick={() => {
          if (!book) return
          const current = journal.entryFor(book.id, journal.selectedDate)
          if (!current) return
          journal.saveDay(book.id, journal.selectedDate, draft('', ''))
          journal.unpublishDay(current.id)
        }}
      >
        unpublish-empty
      </button>
    </div>
  )
}

function draft(title: string, body: string): DayDraft {
  return { title, body }
}

async function renderJournal() {
  const result = render(
    <JournalProvider>
      <Harness />
    </JournalProvider>,
  )
  await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('yes'))
  return result
}

beforeEach(() => {
  localStorage.clear()
})

describe('JournalProvider', () => {
  it('starts on the library with no books', async () => {
    await renderJournal()
    expect(screen.getByTestId('view')).toHaveTextContent('library')
    expect(screen.getByTestId('book-count')).toHaveTextContent('0')
  })

  it('creates a trimmed book and opens its journal', async () => {
    const user = userEvent.setup()
    await renderJournal()

    await user.click(screen.getByRole('button', { name: 'create' }))

    expect(screen.getByTestId('view')).toHaveTextContent('journal')
    expect(screen.getByTestId('book-count')).toHaveTextContent('1')
    expect(screen.getByTestId('book-pages')).toHaveTextContent('ruled')
    expect(screen.getByTestId('book-id')).not.toHaveTextContent('')

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('bookjournal.v1') ?? '{}') as {
        books: Array<{ title: string; author: string; intention: string }>
      }
      expect(saved.books[0]).toMatchObject({
        title: 'Field Notes',
        author: '',
        intention: 'Daily',
      })
    })
  })

  it('navigates between library, journal, and manuscript', async () => {
    const user = userEvent.setup()
    await renderJournal()
    await user.click(screen.getByRole('button', { name: 'create' }))

    await user.click(screen.getByRole('button', { name: 'manuscript' }))
    expect(screen.getByTestId('view')).toHaveTextContent('manuscript')

    await user.click(screen.getByRole('button', { name: 'library' }))
    expect(screen.getByTestId('view')).toHaveTextContent('library')

    await user.click(screen.getByRole('button', { name: 'journal-day' }))
    expect(screen.getByTestId('view')).toHaveTextContent('journal')
    expect(screen.getByTestId('selected-date')).toHaveTextContent('2024-03-15')
  })

  it('saves, updates, and clears draft entries', async () => {
    const user = userEvent.setup()
    await renderJournal()
    await user.click(screen.getByRole('button', { name: 'create' }))

    await user.click(screen.getByRole('button', { name: 'save' }))
    expect(screen.getByTestId('entry-count')).toHaveTextContent('1')
    expect(screen.getByTestId('entry-status')).toHaveTextContent('draft')
    expect(screen.getByTestId('entry-title')).toHaveTextContent('Chapter')
    expect(screen.getByTestId('entry-body')).toHaveTextContent('Hello world')

    await user.click(screen.getByRole('button', { name: 'clear-draft' }))
    expect(screen.getByTestId('entry-count')).toHaveTextContent('0')
    expect(screen.getByTestId('entry-status')).toHaveTextContent('none')
  })

  it('does not create an entry for empty drafts', async () => {
    const user = userEvent.setup()
    await renderJournal()
    await user.click(screen.getByRole('button', { name: 'create' }))
    await user.click(screen.getByRole('button', { name: 'clear-whitespace' }))

    expect(screen.getByTestId('entry-count')).toHaveTextContent('0')
  })

  it('publishes entries and tracks dirty edits', async () => {
    const user = userEvent.setup()
    await renderJournal()
    await user.click(screen.getByRole('button', { name: 'create' }))

    await user.click(screen.getByRole('button', { name: 'publish-incomplete' }))
    expect(screen.getByTestId('entry-count')).toHaveTextContent('0')

    await user.click(screen.getByRole('button', { name: 'publish' }))
    expect(screen.getByTestId('entry-status')).toHaveTextContent('published')
    expect(screen.getByTestId('published-count')).toHaveTextContent('1')
    expect(screen.getByTestId('published-title')).toHaveTextContent('Chapter')

    await user.click(screen.getByRole('button', { name: 'edit-after-publish' }))
    expect(screen.getByTestId('entry-title')).toHaveTextContent('Edited')
    expect(screen.getByTestId('published-title')).toHaveTextContent('Chapter')
    expect(screen.getByTestId('published-count')).toHaveTextContent('1')
  })

  it('unpublishes while keeping draft writing, or removes empty entries', async () => {
    const user = userEvent.setup()
    await renderJournal()
    await user.click(screen.getByRole('button', { name: 'create' }))
    await user.click(screen.getByRole('button', { name: 'publish' }))

    await user.click(screen.getByRole('button', { name: 'unpublish' }))
    expect(screen.getByTestId('entry-status')).toHaveTextContent('draft')
    expect(screen.getByTestId('published-count')).toHaveTextContent('0')
    expect(screen.getByTestId('published-title')).toHaveTextContent('')
    expect(screen.getByTestId('entry-title')).toHaveTextContent('Chapter')

    await user.click(screen.getByRole('button', { name: 'publish' }))
    await user.click(screen.getByRole('button', { name: 'unpublish-empty' }))
    expect(screen.getByTestId('entry-count')).toHaveTextContent('0')
  })

  it('updates page style and deletes a book with its entries', async () => {
    const user = userEvent.setup()
    await renderJournal()
    await user.click(screen.getByRole('button', { name: 'create' }))
    await user.click(screen.getByRole('button', { name: 'save' }))
    await user.click(screen.getByRole('button', { name: 'pages' }))

    expect(screen.getByTestId('book-pages')).toHaveTextContent('night')
    expect(screen.getByTestId('entry-count')).toHaveTextContent('1')

    await user.click(screen.getByRole('button', { name: 'delete' }))
    expect(screen.getByTestId('view')).toHaveTextContent('library')
    expect(screen.getByTestId('book-count')).toHaveTextContent('0')
    expect(screen.getByTestId('entry-count')).toHaveTextContent('0')
  })
})

describe('useJournal', () => {
  it('throws outside the provider', () => {
    expect(() => render(<Harness />)).toThrow(/useJournal must be used within JournalProvider/)
  })
})
