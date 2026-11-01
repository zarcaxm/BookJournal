import { useEffect, useId, useRef, useState } from 'react'
import { buildNotionImport, readMarkdownFiles, type NotionImportPlan } from '../import/notion.ts'
import { COVERS, type CoverId, type PageId } from '../types.ts'
import { PagePicker } from './PagePicker.tsx'

export type NotionImportInput = {
  title: string
  intention: string
  cover: CoverId
  pages: PageId
  entries: Array<{ date: string; title: string; body: string }>
}

type ImportNotionDialogProps = {
  open: boolean
  onClose: () => void
  onImport: (input: NotionImportInput) => void
}

export function ImportNotionDialog({ open, onClose, onImport }: ImportNotionDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileInputId = useId()
  const [title, setTitle] = useState('')
  const [intention, setIntention] = useState('Imported from a Notion Markdown export.')
  const [cover, setCover] = useState<CoverId>('forest')
  const [pages, setPages] = useState<PageId>('cream')
  const [plan, setPlan] = useState<NotionImportPlan | null>(null)
  const [fileLabel, setFileLabel] = useState('No Markdown files chosen')
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    if (!open) return
    setTitle('')
    setIntention('Imported from a Notion Markdown export.')
    setCover('forest')
    setPages('cream')
    setPlan(null)
    setFileLabel('No Markdown files chosen')
    setError(null)
    setReading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [open])

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setReading(true)
    setError(null)
    try {
      const markdown = await readMarkdownFiles(fileList)
      if (markdown.length === 0) {
        setPlan(null)
        setFileLabel('No Markdown files chosen')
        setError('Choose one or more .md files from a Notion Markdown & CSV export.')
        return
      }
      const next = buildNotionImport(markdown)
      if (next.entries.length === 0) {
        setPlan(null)
        setFileLabel(`${markdown.length} Markdown file${markdown.length === 1 ? '' : 's'}`)
        setError('Those files did not contain importable writing.')
        return
      }
      setPlan(next)
      setTitle((current) => current.trim() || next.bookTitle)
      setFileLabel(
        `${markdown.length} Markdown file${markdown.length === 1 ? '' : 's'} · ${next.entries.length} ${
          next.entries.length === 1 ? 'entry' : 'entries'
        }`,
      )
    } catch {
      setPlan(null)
      setError('Could not read those files.')
    } finally {
      setReading(false)
    }
  }

  const entryPreview = plan?.entries.slice(0, 5) ?? []
  const extraCount = plan ? Math.max(0, plan.entries.length - entryPreview.length) : 0

  return (
    <dialog
      ref={ref}
      className="modal"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
    >
      <form
        className="sheet"
        onSubmit={(event) => {
          event.preventDefault()
          if (!plan || !title.trim() || plan.entries.length === 0) return
          ref.current?.close()
          onImport({
            title,
            intention,
            cover,
            pages,
            entries: plan.entries.map((entry) => ({
              date: entry.date,
              title: entry.title,
              body: entry.body,
            })),
          })
        }}
      >
        <p className="eyebrow">Import</p>
        <h2>Import from Notion</h2>
        <p className="lede">
          In Notion, export a page or database as Markdown &amp; CSV, unzip it, then select the{' '}
          <code>.md</code> files here. They become one new book; existing books stay as they are.
        </p>

        <label htmlFor={fileInputId}>
          Markdown files
          <input
            id={fileInputId}
            ref={fileInputRef}
            className="import-file-input"
            type="file"
            accept=".md,text/markdown"
            multiple
            disabled={reading}
            onChange={(event) => void handleFiles(event.target.files)}
          />
          <span className="storage-hint">{reading ? 'Reading files…' : fileLabel}</span>
        </label>

        {error ? <p className="banner">{error}</p> : null}

        {plan ? (
          <div className="import-preview" aria-live="polite">
            <p className="shelf-count">
              Preview · {plan.entries.length} {plan.entries.length === 1 ? 'day' : 'days'}
            </p>
            <ul>
              {entryPreview.map((entry) => (
                <li key={`${entry.date}-${entry.sourceName}`}>
                  <span>{entry.date}</span>
                  <span>{entry.title || 'Untitled'}</span>
                </li>
              ))}
            </ul>
            {extraCount > 0 ? <p className="storage-hint">And {extraCount} more…</p> : null}
          </div>
        ) : null}

        <label>
          Book title
          <input
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Title for the imported book"
            disabled={!plan}
          />
        </label>
        <label>
          Intention
          <textarea
            value={intention}
            onChange={(event) => setIntention(event.target.value)}
            rows={2}
            disabled={!plan}
          />
        </label>
        <fieldset disabled={!plan}>
          <legend>Page style</legend>
          <PagePicker value={pages} onChange={setPages} />
        </fieldset>
        <fieldset disabled={!plan}>
          <legend>Cover</legend>
          <div className="swatches">
            {COVERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="swatch"
                aria-pressed={cover === item.id}
                aria-label={item.label}
                style={{ background: item.cloth }}
                onClick={() => setCover(item.id)}
              />
            ))}
          </div>
        </fieldset>
        <div className="sheet-actions">
          <button type="button" className="btn quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!plan || !title.trim() || reading}>
            Import book
          </button>
        </div>
      </form>
    </dialog>
  )
}
