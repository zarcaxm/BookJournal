import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatLong, wordCount } from '../dates.ts'
import { entryInBook, type DayDraft, type Entry } from '../types.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'

export function Composer({
  date,
  entry,
  onSave,
  onPublish,
  onUnpublish,
}: {
  date: string
  entry: Entry | undefined
  onSave: (draft: DayDraft) => void
  onPublish: (draft: DayDraft) => void
  onUnpublish: () => void
}) {
  const [title, setTitle] = useState(entry?.title ?? '')
  const [body, setBody] = useState(entry?.body ?? '')
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const draftRef = useRef<DayDraft>({ title, body })
  const savedRef = useRef<DayDraft>({ title: entry?.title ?? '', body: entry?.body ?? '' })
  draftRef.current = { title, body }

  useEffect(() => {
    function flush() {
      const current = draftRef.current
      const saved = savedRef.current
      if (current.title === saved.title && current.body === saved.body) return
      onSave(current)
      savedRef.current = current
    }
    const handle = window.setTimeout(flush, 350)
    return () => {
      window.clearTimeout(handle)
      flush()
    }
  }, [title, body, onSave])

  // Grow the page with the writing. Browsers without `field-sizing: content` get a JS fallback.
  useLayoutEffect(() => {
    const textarea = bodyRef.current
    if (!textarea || CSS.supports('field-sizing', 'content')) return
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [body])

  const inBook = entry ? entryInBook(entry) : false
  const dirty = inBook && (title !== (entry?.publishedTitle ?? '') || body !== (entry?.publishedBody ?? ''))
  const words = wordCount(body)
  const ready = title.trim().length > 0 && body.trim().length > 0
  const canPublish = ready && (!inBook || dirty)

  let status = 'Empty day'
  if (dirty) status = 'Edits are not in the book yet'
  else if (inBook) status = 'In the book'
  else if (title.trim() || body.trim()) status = 'Draft'

  let hint = words === 0 ? 'No words yet' : words === 1 ? '1 word' : `${words.toLocaleString()} words`
  if (body.trim() && !title.trim()) hint = `${hint} · Add a title before publishing`
  if (title.trim() && !body.trim()) hint = 'Write the entry before publishing'
  if (notice) hint = `${hint} · ${notice}`

  return (
    <section className="composer" aria-labelledby="day-heading">
      <header className="composer-head">
        <div>
          <p className="eyebrow">Day</p>
          <h2 id="day-heading">{formatLong(date)}</h2>
        </div>
        <p className={`status ${inBook && !dirty ? 'in-book' : ''} ${dirty ? 'dirty' : ''}`}>{status}</p>
      </header>
      <input
        className="entry-title"
        value={title}
        onChange={(event) => {
          setTitle(event.target.value)
          setNotice(null)
        }}
        placeholder="Title this day"
        aria-label={`Title for ${formatLong(date)}`}
        spellCheck
      />
      <textarea
        ref={bodyRef}
        value={body}
        onChange={(event) => {
          setBody(event.target.value)
          setNotice(null)
        }}
        placeholder="What stayed with you? This remains a draft until you publish it to the book."
        spellCheck
        aria-label={`Thoughts for ${formatLong(date)}`}
      />
      <footer className="composer-foot">
        <p className="hint">{hint}</p>
        <div className="composer-actions">
          {inBook ? (
            <button type="button" className="btn quiet" onClick={() => setConfirmingRemove(true)}>
              Remove from book
            </button>
          ) : null}
          <button
            type="button"
            className="btn primary"
            disabled={!canPublish}
            onClick={() => {
              const draft = { title, body }
              onPublish(draft)
              savedRef.current = draft
              setNotice(inBook ? 'The book was updated' : 'Published to the book')
            }}
          >
            {inBook ? 'Update the book' : 'Publish to the book'}
          </button>
        </div>
      </footer>
      <ConfirmDialog
        open={confirmingRemove}
        title="Remove this day from the book?"
        body="It leaves the manuscript and the PDF. The writing stays in the journal as a draft."
        confirmLabel="Remove from book"
        onConfirm={() => {
          onUnpublish()
          setConfirmingRemove(false)
          setNotice('Removed from the book')
        }}
        onClose={() => setConfirmingRemove(false)}
      />
    </section>
  )
}
