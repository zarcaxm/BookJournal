export function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseDateKey(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

export function monthLabel(date: Date) {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export function formatLong(key: string) {
  return parseDateKey(key).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function formatShort(key: string) {
  return parseDateKey(key).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function calendarCells(month: Date) {
  const first = startOfMonth(month)
  const lead = (first.getDay() + 6) % 7
  const start = new Date(first)
  start.setDate(first.getDate() - lead)

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return {
      date,
      key: toDateKey(date),
      inMonth: date.getMonth() === month.getMonth(),
    }
  })
}

export function wordCount(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

export function spanLabel(dates: string[]) {
  if (dates.length === 0) return ''
  const sorted = [...dates].sort()
  const first = formatShort(sorted[0])
  const last = formatShort(sorted[sorted.length - 1])
  return first === last ? first : `${first} – ${last}`
}
