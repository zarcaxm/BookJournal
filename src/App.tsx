import { JournalProvider, useJournal } from './journal.tsx'
import { JournalView } from './components/JournalView.tsx'
import { Library } from './components/Library.tsx'
import { ManuscriptView } from './components/ManuscriptView.tsx'

function Shell() {
  const { view, books } = useJournal()
  if (view.name !== 'library' && !books.some((book) => book.id === view.bookId)) {
    return <Library />
  }
  if (view.name === 'journal') return <JournalView bookId={view.bookId} />
  if (view.name === 'manuscript') return <ManuscriptView bookId={view.bookId} />
  return <Library />
}

export default function App() {
  return (
    <JournalProvider>
      <Shell />
    </JournalProvider>
  )
}
