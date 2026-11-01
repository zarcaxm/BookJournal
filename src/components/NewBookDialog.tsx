import { useEffect, useRef, useState } from 'react'
import { COVERS, type CoverId, type PageId } from '../types.ts'
import { PagePicker } from './PagePicker.tsx'

type NewBookDialogProps = {
  open: boolean
  onClose: () => void
  onCreate: (input: { title: string; intention: string; cover: CoverId; pages: PageId }) => void
}

export function NewBookDialog({ open, onClose, onCreate }: NewBookDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const [title, setTitle] = useState('')
  const [intention, setIntention] = useState('')
  const [cover, setCover] = useState<CoverId>('navy')
  const [pages, setPages] = useState<PageId>('cream')

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      dialog.querySelector('input')?.focus()
    }
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    if (!open) return
    setTitle('')
    setIntention('')
    setCover('navy')
    setPages('cream')
  }, [open])

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
          if (!title.trim()) return
          ref.current?.close()
          onCreate({ title, intention, cover, pages })
        }}
      >
        <p className="eyebrow">New book</p>
        <h2>Create a book</h2>
        <label>
          Title
          <input
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Working title"
          />
        </label>
        <label>
          Intention
          <textarea
            value={intention}
            onChange={(event) => setIntention(event.target.value)}
            placeholder="Optional note on what this book is for."
            rows={3}
          />
        </label>
        <fieldset>
          <legend>Page style</legend>
          <PagePicker value={pages} onChange={setPages} />
        </fieldset>
        <fieldset>
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
          <button type="submit" className="btn primary">
            Create book
          </button>
        </div>
      </form>
    </dialog>
  )
}
