import { Document, Font, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { formatLong, spanLabel, wordCount } from '../dates.ts'
import { coverOf, type Book, type Entry, type PageId } from '../types.ts'

Font.registerHyphenationCallback((word) => {
  if (word.length <= 18) return [word]
  const parts: string[] = []
  for (let index = 0; index < word.length; index += 18) parts.push(word.slice(index, index + 18))
  return parts
})

const PAGE_LOOK: Record<
  PageId,
  { paper: string; ink: string; muted: string; font: string; bold: string; italic: string; size: number }
> = {
  cream: { paper: '#fbf7f0', ink: '#221e1a', muted: '#8a7d6d', font: 'Times-Roman', bold: 'Times-Bold', italic: 'Times-Italic', size: 11 },
  ruled: { paper: '#f3f6fb', ink: '#1c3148', muted: '#6d7c90', font: 'Times-Roman', bold: 'Times-Bold', italic: 'Times-Italic', size: 11 },
  typewriter: { paper: '#f3ecdc', ink: '#2a241c', muted: '#7a7064', font: 'Courier', bold: 'Courier-Bold', italic: 'Courier-Oblique', size: 10 },
  night: { paper: '#1c1916', ink: '#f4ecdf', muted: '#b5a894', font: 'Times-Roman', bold: 'Times-Bold', italic: 'Times-Italic', size: 11 },
  press: { paper: '#fcfcfb', ink: '#141414', muted: '#5c5c5c', font: 'Times-Roman', bold: 'Times-Bold', italic: 'Times-Italic', size: 12 },
}

const styles = StyleSheet.create({
  cover: {
    backgroundColor: '#fbf7f0',
    padding: 48,
    justifyContent: 'space-between',
    fontFamily: 'Times-Roman',
    color: '#221e1a',
  },
  band: {
    marginHorizontal: -48,
    marginTop: -48,
    height: 168,
    paddingHorizontal: 48,
    paddingTop: 56,
  },
  brand: {
    fontSize: 9,
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    color: '#f6ecd8',
  },
  coverTitle: {
    fontFamily: 'Times-Bold',
    fontSize: 32,
    lineHeight: 1.15,
    marginTop: 18,
  },
  coverAuthor: {
    marginTop: 14,
    fontSize: 13,
    fontFamily: 'Times-Italic',
  },
  intention: {
    fontFamily: 'Times-Italic',
    fontSize: 13,
    lineHeight: 1.55,
    marginTop: 28,
    maxWidth: 320,
  },
  coverMeta: {
    fontSize: 10,
    color: '#6a6156',
    letterSpacing: 0.4,
  },
  page: {
    backgroundColor: '#fbf7f0',
    paddingTop: 58,
    paddingBottom: 56,
    paddingHorizontal: 48,
    fontFamily: 'Times-Roman',
    fontSize: 11,
    lineHeight: 1.55,
    color: '#221e1a',
  },
  running: {
    position: 'absolute',
    top: 28,
    left: 48,
    right: 48,
    fontSize: 8,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: '#8a7d6d',
  },
  entry: {
    marginBottom: 18,
  },
  date: {
    fontSize: 9,
    letterSpacing: 0.6,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  entryTitle: {
    fontSize: 16,
    marginBottom: 8,
  },
  marginRule: {
    position: 'absolute',
    top: 52,
    bottom: 48,
    left: 36,
    width: 0.8,
    backgroundColor: '#c45a56',
  },
  paragraph: {
    marginBottom: 8,
  },
  footer: {
    position: 'absolute',
    bottom: 28,
    left: 48,
    right: 48,
    textAlign: 'center',
    fontSize: 9,
    color: '#8a7d6d',
  },
})

function paragraphs(body: string) {
  return body
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.split('\n').map((line) => line.trimEnd()).filter((line) => line.length > 0))
    .filter((lines) => lines.length > 0)
}

export function BookDocument({ book, entries }: { book: Book; entries: Entry[] }) {
  const cover = coverOf(book.cover)
  const look = PAGE_LOOK[book.pages]
  const dates = entries.map((entry) => entry.date)
  const words = entries.reduce((sum, entry) => sum + wordCount(entry.publishedBody ?? ''), 0)
  const meta = [
    entries.length === 1 ? '1 day' : `${entries.length} days`,
    words === 1 ? '1 word' : `${words.toLocaleString()} words`,
    spanLabel(dates),
  ]
    .filter(Boolean)
    .join('  ·  ')

  return (
    <Document title={book.title} author={book.author || undefined} subject="BookJournal manuscript">
      <Page size="A5" style={[styles.cover, { backgroundColor: look.paper, color: look.ink }]}>
        <View>
          <View style={[styles.band, { backgroundColor: cover.cloth, color: cover.foil }]}>
            <Text style={[styles.brand, { color: cover.foil }]}>BookJournal</Text>
            <Text style={[styles.coverTitle, { color: cover.foil }]}>{book.title}</Text>
            {book.author ? <Text style={[styles.coverAuthor, { color: cover.foil }]}>{book.author}</Text> : null}
          </View>
          {book.intention ? (
            <Text style={[styles.intention, { color: look.ink, fontFamily: look.italic }]}>{book.intention}</Text>
          ) : null}
        </View>
        <Text style={[styles.coverMeta, { color: look.muted }]}>{meta}</Text>
      </Page>
      <Page
        size="A5"
        style={[
          styles.page,
          {
            backgroundColor: look.paper,
            color: look.ink,
            fontFamily: look.font,
            fontSize: look.size,
            paddingLeft: book.pages === 'ruled' ? 56 : 48,
          },
        ]}
      >
        {book.pages === 'ruled' ? <View style={styles.marginRule} fixed /> : null}
        <Text style={[styles.running, { color: look.muted, fontFamily: look.font }]} fixed>
          {book.title}
        </Text>
        {entries.map((entry) => {
          const title = entry.publishedTitle?.trim()
          return (
            <View key={entry.id} style={styles.entry}>
              <Text style={[styles.date, { color: look.muted, fontFamily: look.font }]}>{formatLong(entry.date)}</Text>
              {title ? <Text style={[styles.entryTitle, { fontFamily: look.bold }]}>{title}</Text> : null}
              {paragraphs(entry.publishedBody ?? '').map((lines, index) => (
                <Text key={`${entry.id}-${index}`} style={[styles.paragraph, { fontFamily: look.font }]}>
                  {lines.join('\n')}
                </Text>
              ))}
            </View>
          )
        })}
        <Text
          style={[styles.footer, { color: look.muted, fontFamily: look.font }]}
          fixed
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
        />
      </Page>
    </Document>
  )
}
