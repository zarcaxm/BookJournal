import { addMonths, calendarCells, monthLabel, startOfMonth, toDateKey } from '../dates.ts'
import { Icon } from './Icon.tsx'
import { entryHasWriting, entryInBook, entryIsDirty, type Entry } from '../types.ts'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function dayState(entry: Entry | undefined) {
  if (!entry) return 'empty'
  if (entryIsDirty(entry)) return 'dirty'
  if (entryInBook(entry)) return 'published'
  if (entryHasWriting(entry)) return 'draft'
  return 'empty'
}

export function Calendar({
  month,
  selectedDate,
  entries,
  onMonth,
  onSelect,
}: {
  month: Date
  selectedDate: string
  entries: Entry[]
  onMonth: (month: Date) => void
  onSelect: (date: string) => void
}) {
  const today = toDateKey(new Date())
  const byDate = new Map(entries.map((entry) => [entry.date, entry]))
  const cells = calendarCells(month)
  const showingToday = month.getFullYear() === new Date().getFullYear() && month.getMonth() === new Date().getMonth()

  return (
    <section className="calendar" aria-label="Journal calendar">
      <div className="calendar-nav">
        <button type="button" className="icon-button" aria-label="Previous month" onClick={() => onMonth(addMonths(month, -1))}>
          <Icon name="chevron-left" />
        </button>
        <h2>{monthLabel(month)}</h2>
        <button type="button" className="icon-button" aria-label="Next month" onClick={() => onMonth(addMonths(month, 1))}>
          <Icon name="chevron-right" />
        </button>
      </div>
      {!showingToday ? (
        <button
          type="button"
          className="btn ghost small today-jump"
          onClick={() => {
            const todayDate = new Date()
            onMonth(startOfMonth(todayDate))
            onSelect(toDateKey(todayDate))
          }}
        >
          Jump to today
        </button>
      ) : null}
      <div className="weekdays" aria-hidden="true">
        {WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="days">
        {cells.map((cell) => {
          const entry = byDate.get(cell.key)
          const state = dayState(entry)
          const label = cell.date.toLocaleDateString(undefined, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })
          const status =
            state === 'published'
              ? 'in the book'
              : state === 'draft'
                ? 'draft'
                : state === 'dirty'
                  ? 'edits not yet in the book'
                  : 'empty'
          return (
            <button
              key={cell.key}
              type="button"
              className={`day ${cell.inMonth ? '' : 'outside'} ${cell.key === today ? 'today' : ''} ${cell.key === selectedDate ? 'selected' : ''} ${state}`}
              aria-pressed={cell.key === selectedDate}
              aria-label={`${label}, ${status}`}
              onClick={() => onSelect(cell.key)}
            >
              <span>{cell.date.getDate()}</span>
              <i className="mark" />
            </button>
          )
        })}
      </div>
      <ul className="legend">
        <li><i className="mark draft" /> Draft</li>
        <li><i className="mark published" /> In the book</li>
        <li><i className="mark dirty" /> Unpublished edits</li>
      </ul>
    </section>
  )
}
