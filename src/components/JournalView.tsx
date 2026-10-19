import { useState } from 'react'
import { parseDateKey, startOfMonth } from '../dates.ts'
import { useJournal } from '../journal.tsx'
import { BookChrome } from './BookChrome.tsx'
import { Calendar } from './Calendar.tsx'
import { Composer } from './Composer.tsx'

export function JournalView({ bookId }: { bookId: string }) {
  const { books, selectedDate, openJournal, entriesFor, entryFor, saveDay, publishDay, unpublishDay } = useJournal()
  const book = books.find((item) => item.id === bookId)
  const [month, setMonth] = useState(() => startOfMonth(parseDateKey(selectedDate)))

  if (!book) return null

  const entries = entriesFor(book.id)
  const entry = entryFor(book.id, selectedDate)

  return (
    <BookChrome book={book} mode="journal">
      <div className="desk">
        <Calendar
          month={month}
          selectedDate={selectedDate}
          entries={entries}
          onMonth={setMonth}
          onSelect={(date) => {
            openJournal(book.id, date)
            const next = parseDateKey(date)
            if (next.getMonth() !== month.getMonth() || next.getFullYear() !== month.getFullYear()) {
              setMonth(startOfMonth(next))
            }
          }}
        />
        <Composer
          key={`${book.id}:${selectedDate}`}
          date={selectedDate}
          entry={entry}
          onSave={(draft) => saveDay(book.id, selectedDate, draft)}
          onPublish={(draft) => publishDay(book.id, selectedDate, draft)}
          onUnpublish={() => {
            if (entry) unpublishDay(entry.id)
          }}
        />
      </div>
    </BookChrome>
  )
}
