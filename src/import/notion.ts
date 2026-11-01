import { toDateKey } from '../dates.ts'

export type NotionMarkdownFile = {
  /** Basename or relative path, e.g. `Journal/2024-03-15.md` */
  name: string
  content: string
  /** File last-modified time in ms since epoch, when available */
  lastModified?: number
}

export type ParsedNotionEntry = {
  title: string
  body: string
  date: string
  sourceName: string
}

export type NotionImportPlan = {
  bookTitle: string
  entries: ParsedNotionEntry[]
}

const NOTION_ID_SUFFIX = /\s+[0-9a-f]{32}$/i
const ISO_DATE = /\b(20\d{2})-(\d{2})-(\d{2})\b/
const SLASH_DATE = /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/
const MONTH_NAMES =
  'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec'
const LONG_DATE = new RegExp(
  `\\b(${MONTH_NAMES})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`,
  'i',
)
const FRONTMATTER_DATE_KEYS = /^(?:date|created|created at|created_at|published|published at)$/i

const MONTH_INDEX: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
}

function basename(path: string) {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || path
}

function parentFolderName(path: string) {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length < 2) return null
  return stripNotionFilename(parts[parts.length - 2])
}

/** Strip Notion's trailing page-id hex and `.md` extension from a filename. */
export function stripNotionFilename(name: string) {
  let base = basename(name)
  base = base.replace(/\.md$/i, '')
  base = base.replace(NOTION_ID_SUFFIX, '')
  return base.trim() || 'Untitled'
}

function padDate(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const probe = new Date(year, month - 1, day)
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) {
    return null
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Find the first plausible calendar date in free text. */
export function extractDateFromText(text: string): string | null {
  const iso = text.match(ISO_DATE)
  if (iso) return padDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const long = text.match(LONG_DATE)
  if (long) {
    const month = MONTH_INDEX[long[1].toLowerCase()]
    if (month !== undefined) return padDate(Number(long[3]), month + 1, Number(long[2]))
  }

  const slash = text.match(SLASH_DATE)
  if (slash) {
    // Prefer ISO-ish day-month when day > 12; otherwise treat as month/day (US-ish Notion default).
    const a = Number(slash[1])
    const b = Number(slash[2])
    const year = Number(slash[3])
    if (a > 12) return padDate(year, b, a)
    return padDate(year, a, b)
  }

  return null
}

type Frontmatter = { body: string; fields: Record<string, string> }

function parseFrontmatter(content: string): Frontmatter {
  const trimmed = content.replace(/^\uFEFF/, '')
  if (!trimmed.startsWith('---')) return { body: trimmed, fields: {} }
  const end = trimmed.indexOf('\n---', 3)
  if (end === -1) return { body: trimmed, fields: {} }
  const raw = trimmed.slice(3, end).trim()
  const body = trimmed.slice(end + 4).replace(/^\r?\n/, '')
  const fields: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.*)$/)
    if (!match) continue
    const key = match[1].trim()
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    fields[key] = value
  }
  return { body, fields }
}

function dateFromFrontmatter(fields: Record<string, string>): string | null {
  for (const [key, value] of Object.entries(fields)) {
    if (!FRONTMATTER_DATE_KEYS.test(key)) continue
    const found = extractDateFromText(value)
    if (found) return found
  }
  return null
}

/** Pull Notion property lines like `Created: March 1, 2024 9:00 AM` from the top of a page. */
function peelNotionProperties(body: string): { body: string; date: string | null } {
  const lines = body.split(/\r?\n/)
  const kept: string[] = []
  let date: string | null = null
  let i = 0
  let acceptedHeading = false
  let peeledProperty = false

  while (i < lines.length && i < 20) {
    const raw = lines[i]
    const line = raw.trim()

    if (!line) {
      // Keep leading blanks before any real content; skip blanks between properties.
      if (!acceptedHeading && !peeledProperty) kept.push(raw)
      i += 1
      continue
    }

    if (!acceptedHeading && !peeledProperty && /^#{1,6}\s/.test(line)) {
      kept.push(raw)
      acceptedHeading = true
      i += 1
      continue
    }

    const prop = line.match(/^([A-Za-z][A-Za-z0-9 /_-]{0,40}):\s+(.+)$/)
    if (prop) {
      if (FRONTMATTER_DATE_KEYS.test(prop[1].trim()) && !date) {
        date = extractDateFromText(prop[2])
      }
      peeledProperty = true
      i += 1
      continue
    }

    break
  }

  kept.push(...lines.slice(i))
  return { body: kept.join('\n').replace(/^\n+/, ''), date }
}

function decodeEntities(text: string) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

/** Light Markdown → readable plain text for BookJournal entries. */
export function markdownToPlainText(markdown: string): string {
  let text = markdown.replace(/\r\n/g, '\n')

  text = text.replace(/```[\s\S]*?```/g, (block) => {
    const inner = block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')
    return inner.trimEnd()
  })
  text = text.replace(/~~~[\s\S]*?~~~/g, (block) => {
    const inner = block.replace(/^~~~[^\n]*\n?/, '').replace(/~~~$/, '')
    return inner.trimEnd()
  })

  text = text.replace(/^#{1,6}\s+/gm, '')
  text = text.replace(/^>\s?/gm, '')
  text = text.replace(/^(-{3,}|\*{3,}|_{3,})\s*$/gm, '')
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  text = text.replace(/`([^`]+)`/g, '$1')
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2')
  text = text.replace(/(\*|_)(.*?)\1/g, '$2')
  text = text.replace(/^[\t ]*[-*+]\s+/gm, '')
  text = text.replace(/^[\t ]*\d+\.\s+/gm, '')
  text = text.replace(/<\/?[^>]+>/g, '')
  text = decodeEntities(text)
  text = text.replace(/[ \t]+\n/g, '\n')
  text = text.replace(/\n{3,}/g, '\n\n')
  return text.trim()
}

function titleFromBody(body: string, fallback: string) {
  const heading = body.match(/^#{1,6}\s+(.+)$/m)
  if (heading) return heading[1].trim()
  const firstLine = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (firstLine && firstLine.length <= 120) return firstLine.replace(/^#+\s*/, '')
  return fallback
}

function bodyWithoutLeadingTitle(body: string, title: string) {
  const lines = body.split(/\r?\n/)
  const firstContent = lines.findIndex((line) => line.trim().length > 0)
  if (firstContent === -1) return ''
  const line = lines[firstContent].trim()
  const asHeading = line.replace(/^#{1,6}\s+/, '').trim()
  if (asHeading === title || line === title) {
    return lines
      .slice(firstContent + 1)
      .join('\n')
      .replace(/^\n+/, '')
      .trim()
  }
  return body.trim()
}

function dateFromLastModified(lastModified?: number): string | null {
  if (typeof lastModified !== 'number' || !Number.isFinite(lastModified)) return null
  return toDateKey(new Date(lastModified))
}

/**
 * Parse a single Notion-exported Markdown file into a draft entry.
 * Returns null when the file has no usable title or body.
 */
export function parseNotionMarkdownFile(
  file: NotionMarkdownFile,
  fallbackDate: string,
): ParsedNotionEntry | null {
  const sourceName = basename(file.name)
  if (sourceName.includes('.') && !/\.md$/i.test(sourceName)) return null

  const displayName = stripNotionFilename(file.name)
  const { body: withoutFm, fields } = parseFrontmatter(file.content)
  const peeled = peelNotionProperties(withoutFm)
  const rawBody = peeled.body

  const title = titleFromBody(rawBody, displayName)
  const bodyMarkdown = bodyWithoutLeadingTitle(rawBody, title)
  const body = markdownToPlainText(bodyMarkdown)
  const plainTitle = markdownToPlainText(title) || displayName

  if (!plainTitle.trim() && !body.trim()) return null

  const date =
    dateFromFrontmatter(fields) ??
    peeled.date ??
    extractDateFromText(displayName) ??
    extractDateFromText(title) ??
    extractDateFromText(rawBody.slice(0, 280)) ??
    dateFromLastModified(file.lastModified) ??
    fallbackDate

  return {
    title: plainTitle.trim() || 'Untitled',
    body,
    date,
    sourceName,
  }
}

function nextFreeDate(preferred: string, used: Set<string>): string {
  if (!used.has(preferred)) return preferred
  const [y, m, d] = preferred.split('-').map(Number)
  const cursor = new Date(y, m - 1, d)
  for (let i = 0; i < 3660; i += 1) {
    cursor.setDate(cursor.getDate() + 1)
    const key = toDateKey(cursor)
    if (!used.has(key)) return key
  }
  return preferred
}

function inferBookTitle(files: NotionMarkdownFile[], entries: ParsedNotionEntry[]): string {
  const folders = files
    .map((file) => parentFolderName(file.name))
    .filter((name): name is string => Boolean(name && name !== 'Export'))
  if (folders.length > 0) {
    const counts = new Map<string, number>()
    for (const folder of folders) counts.set(folder, (counts.get(folder) ?? 0) + 1)
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
    if (ranked[0]) return ranked[0][0]
  }
  if (entries.length === 1) return entries[0].title
  if (files.length === 1) return stripNotionFilename(files[0].name)
  return 'Imported from Notion'
}

export type BuildNotionImportOptions = {
  bookTitle?: string
  /** Override “today” for deterministic tests (YYYY-MM-DD). */
  today?: string
}

/** Map one or more Notion Markdown exports into a book title + dated entries. */
export function buildNotionImport(
  files: NotionMarkdownFile[],
  options: BuildNotionImportOptions = {},
): NotionImportPlan {
  const today = options.today ?? toDateKey(new Date())
  const markdownFiles = files.filter(
    (file) => /\.md$/i.test(basename(file.name)) || !basename(file.name).includes('.'),
  )

  const parsed = markdownFiles
    .map((file) => parseNotionMarkdownFile(file, today))
    .filter((entry): entry is ParsedNotionEntry => entry !== null)
    .filter((entry) => entry.title.trim() || entry.body.trim())

  const used = new Set<string>()
  const entries = parsed.map((entry) => {
    const date = nextFreeDate(entry.date, used)
    used.add(date)
    return { ...entry, date }
  })

  const bookTitle = (options.bookTitle?.trim() || inferBookTitle(markdownFiles, entries)).trim()

  return {
    bookTitle: bookTitle || 'Imported from Notion',
    entries,
  }
}

/** Read browser File objects into parser input (client-side only). */
export async function readMarkdownFiles(fileList: Iterable<File>): Promise<NotionMarkdownFile[]> {
  const files = [...fileList].filter((file) => /\.md$/i.test(file.name))
  return Promise.all(
    files.map(async (file) => ({
      name: file.webkitRelativePath || file.name,
      content: await file.text(),
      lastModified: file.lastModified,
    })),
  )
}
