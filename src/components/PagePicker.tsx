import { PAGES, type PageId } from '../types.ts'

export function PagePicker({ value, onChange }: { value: PageId; onChange: (pages: PageId) => void }) {
  return (
    <div className="page-picker" role="group" aria-label="Page style">
      {PAGES.map((pages) => (
        <button
          key={pages.id}
          type="button"
          className="page-choice"
          aria-pressed={value === pages.id}
          title={pages.note}
          onClick={() => onChange(pages.id)}
        >
          <span className={`page-sample ${pages.id}`} aria-hidden="true" />
          <span>{pages.label}</span>
        </button>
      ))}
    </div>
  )
}
