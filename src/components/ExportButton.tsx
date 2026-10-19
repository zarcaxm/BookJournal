import { useState } from 'react'
import { downloadBookPdf } from '../pdf/download.tsx'
import type { Book, Entry } from '../types.ts'

export function ExportButton({
  book,
  entries,
  prominent = false,
}: {
  book: Book
  entries: Entry[]
  prominent?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = entries.length > 0

  async function exportPdf() {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      await downloadBookPdf(book, entries)
    } catch {
      setError('The PDF could not be created.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={prominent ? 'export-block' : 'export-inline'}>
      <button
        type="button"
        className={prominent ? 'btn primary' : 'btn quiet'}
        disabled={!ready || busy}
        onClick={() => void exportPdf()}
      >
        {busy ? 'Preparing PDF…' : 'Export PDF'}
      </button>
      {!ready ? <p className="hint">Publish at least one day to export the book.</p> : null}
      {error ? <p className="hint warn">{error}</p> : null}
    </div>
  )
}
