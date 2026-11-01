import { describe, expect, it } from 'vitest'
import {
  buildNotionImport,
  extractDateFromText,
  markdownToPlainText,
  parseNotionMarkdownFile,
  stripNotionFilename,
} from './notion.ts'

describe('stripNotionFilename', () => {
  it('removes the .md extension and Notion page id suffix', () => {
    expect(stripNotionFilename('Morning pages abcdef0123456789abcdef0123456789.md')).toBe(
      'Morning pages',
    )
    expect(stripNotionFilename('Nested/Week one.md')).toBe('Week one')
  })
})

describe('extractDateFromText', () => {
  it('parses ISO, long, and slash dates', () => {
    expect(extractDateFromText('Note 2024-03-15 draft')).toBe('2024-03-15')
    expect(extractDateFromText('March 5, 2024')).toBe('2024-03-05')
    expect(extractDateFromText('15/03/2024')).toBe('2024-03-15')
    expect(extractDateFromText('03/15/2024')).toBe('2024-03-15')
  })

  it('returns null when no date is present', () => {
    expect(extractDateFromText('Just a title')).toBeNull()
  })
})

describe('markdownToPlainText', () => {
  it('strips common Markdown markers while keeping readable text', () => {
    const plain = markdownToPlainText(
      [
        '# Heading',
        '',
        'A **bold** and *italic* word with a [link](https://example.com).',
        '',
        '- first',
        '- second',
        '',
        '> quoted',
        '',
        '`code` and ![alt text](https://img)',
      ].join('\n'),
    )

    expect(plain).toContain('Heading')
    expect(plain).toContain('A bold and italic word with a link.')
    expect(plain).toContain('first')
    expect(plain).toContain('second')
    expect(plain).toContain('quoted')
    expect(plain).toContain('code')
    expect(plain).toContain('alt text')
    expect(plain).not.toContain('**')
    expect(plain).not.toContain('https://example.com')
  })
})

describe('parseNotionMarkdownFile', () => {
  it('uses filename dates and the first heading as title', () => {
    const entry = parseNotionMarkdownFile(
      {
        name: '2024-07-04 Independence.md',
        content: '# Independence\n\nFireworks and notes.',
      },
      '2026-11-01',
    )

    expect(entry).toEqual({
      title: 'Independence',
      body: 'Fireworks and notes.',
      date: '2024-07-04',
      sourceName: '2024-07-04 Independence.md',
    })
  })

  it('reads dates from YAML frontmatter and Notion Created lines', () => {
    const fromFm = parseNotionMarkdownFile(
      {
        name: 'untitled.md',
        content: '---\nDate: 2023-12-01\n---\n# Snow\n\nQuiet morning.',
      },
      '2026-11-01',
    )
    expect(fromFm?.date).toBe('2023-12-01')
    expect(fromFm?.title).toBe('Snow')
    expect(fromFm?.body).toBe('Quiet morning.')

    const fromCreated = parseNotionMarkdownFile(
      {
        name: 'Entry.md',
        content: '# Entry\n\nCreated: January 9, 2025 8:15 AM\nTags: journal\n\nWrote at dawn.',
      },
      '2026-11-01',
    )
    expect(fromCreated?.date).toBe('2025-01-09')
    expect(fromCreated?.body).toBe('Wrote at dawn.')
    expect(fromCreated?.body).not.toContain('Created:')
  })

  it('falls back to lastModified then today', () => {
    const fromMtime = parseNotionMarkdownFile(
      {
        name: 'Loose note.md',
        content: 'No dates here, just words.',
        lastModified: new Date(2022, 4, 20, 15, 0, 0).getTime(),
      },
      '2026-11-01',
    )
    expect(fromMtime?.date).toBe('2022-05-20')

    const fromToday = parseNotionMarkdownFile(
      {
        name: 'Loose note.md',
        content: 'Still no date.',
      },
      '2026-11-01',
    )
    expect(fromToday?.date).toBe('2026-11-01')
  })
})

describe('buildNotionImport', () => {
  it('builds a book from a folder of dated pages and publishes-ready entries', () => {
    const plan = buildNotionImport(
      [
        {
          name: 'Field Notes/2024-01-01 New year.md',
          content: '# New year\n\nStarted the book.',
        },
        {
          name: 'Field Notes/2024-01-02 Next day.md',
          content: '# Next day\n\nKept writing.',
        },
        {
          name: 'Field Notes/ignore.csv',
          content: 'Name,Date\nSkip,me',
        },
      ],
      { today: '2026-11-01' },
    )

    expect(plan.bookTitle).toBe('Field Notes')
    expect(plan.entries).toHaveLength(2)
    expect(plan.entries.map((entry) => entry.date)).toEqual(['2024-01-01', '2024-01-02'])
    expect(plan.entries[0].body).toBe('Started the book.')
  })

  it('avoids colliding dates by shifting later duplicates forward', () => {
    const plan = buildNotionImport(
      [
        {
          name: 'a.md',
          content: '# One\n\nCreated: 2024-06-01\n\nFirst.',
        },
        {
          name: 'b.md',
          content: '# Two\n\nCreated: 2024-06-01\n\nSecond.',
        },
      ],
      { bookTitle: 'Collision', today: '2026-11-01' },
    )

    expect(plan.bookTitle).toBe('Collision')
    expect(plan.entries.map((entry) => entry.date)).toEqual(['2024-06-01', '2024-06-02'])
  })

  it('uses a single page title as the book title', () => {
    const plan = buildNotionImport(
      [
        {
          name: 'Solo page.md',
          content: '# Solo page\n\nOnly one.',
        },
      ],
      { today: '2026-11-01' },
    )
    expect(plan.bookTitle).toBe('Solo page')
    expect(plan.entries).toHaveLength(1)
  })
})
