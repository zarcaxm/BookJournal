import { pdf } from '@react-pdf/renderer'
import type { Book, Entry } from '../types.ts'
import { BookDocument } from './BookDocument.tsx'

export function pdfFileName(title: string) {
  const cleaned = title.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').trim() || 'Book'
  return `${cleaned}.pdf`
}

export async function downloadBookPdf(book: Book, entries: Entry[]) {
  const blob = await pdf(<BookDocument book={book} entries={entries} />).toBlob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = pdfFileName(book.title)
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
