import { describe, expect, it } from 'vitest'
import {
  addMonths,
  calendarCells,
  formatLong,
  formatShort,
  monthLabel,
  parseDateKey,
  spanLabel,
  startOfMonth,
  toDateKey,
  wordCount,
} from './dates.ts'

describe('toDateKey', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(toDateKey(new Date(2024, 0, 5))).toBe('2024-01-05')
    expect(toDateKey(new Date(2024, 11, 31))).toBe('2024-12-31')
  })
})

describe('parseDateKey', () => {
  it('parses a date key into a local Date', () => {
    const date = parseDateKey('2024-03-15')
    expect(date.getFullYear()).toBe(2024)
    expect(date.getMonth()).toBe(2)
    expect(date.getDate()).toBe(15)
  })
})

describe('startOfMonth / addMonths', () => {
  it('returns the first day of the month', () => {
    const start = startOfMonth(new Date(2024, 5, 18))
    expect(toDateKey(start)).toBe('2024-06-01')
  })

  it('shifts months without carrying day overflow', () => {
    expect(toDateKey(addMonths(new Date(2024, 0, 31), 1))).toBe('2024-02-01')
    expect(toDateKey(addMonths(new Date(2024, 0, 1), -1))).toBe('2023-12-01')
  })
})

describe('monthLabel / formatLong / formatShort', () => {
  it('labels months and dates for display', () => {
    expect(monthLabel(new Date(2024, 2, 1))).toMatch(/March/)
    expect(monthLabel(new Date(2024, 2, 1))).toMatch(/2024/)
    expect(formatLong('2024-03-15')).toMatch(/2024/)
    expect(formatShort('2024-03-15')).toMatch(/2024/)
  })
})

describe('calendarCells', () => {
  it('returns 42 cells starting on Monday of the first week', () => {
    // March 2024 starts on Friday; Monday lead-in is 2024-02-26
    const cells = calendarCells(new Date(2024, 2, 1))
    expect(cells).toHaveLength(42)
    expect(cells[0].key).toBe('2024-02-26')
    expect(cells[0].inMonth).toBe(false)
    expect(cells[4].key).toBe('2024-03-01')
    expect(cells[4].inMonth).toBe(true)
    expect(cells[34].key).toBe('2024-03-31')
    expect(cells[34].inMonth).toBe(true)
    expect(cells[35].inMonth).toBe(false)
  })
})

describe('wordCount', () => {
  it('counts words and ignores empty/whitespace input', () => {
    expect(wordCount('')).toBe(0)
    expect(wordCount('   ')).toBe(0)
    expect(wordCount('one')).toBe(1)
    expect(wordCount('  one   two\tthree  ')).toBe(3)
  })
})

describe('spanLabel', () => {
  it('returns empty for no dates', () => {
    expect(spanLabel([])).toBe('')
  })

  it('returns a single short date when all dates match', () => {
    expect(spanLabel(['2024-03-15', '2024-03-15'])).toBe(formatShort('2024-03-15'))
  })

  it('returns a sorted range for distinct dates', () => {
    expect(spanLabel(['2024-03-20', '2024-03-10'])).toBe(
      `${formatShort('2024-03-10')} – ${formatShort('2024-03-20')}`,
    )
  })
})
