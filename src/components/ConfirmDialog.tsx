import { useEffect, useRef } from 'react'

type ConfirmDialogProps = {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({ open, title, body, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
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
          ref.current?.close()
          onConfirm()
        }}
      >
        <h2>{title}</h2>
        <p className="lede">{body}</p>
        <div className="sheet-actions">
          <button type="button" className="btn quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn danger">
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  )
}
