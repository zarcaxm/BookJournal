import { useJournal } from '../journal.tsx'
import type { FolderSyncStatus } from '../useFolderSync.ts'

function lastSyncLabel(value: string | null) {
  if (!value) return 'Not synced yet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not synced yet'
  return `Last synced ${date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })}`
}

function describe(status: FolderSyncStatus, folderName: string | null, lastSyncedAt: string | null, error: string | null) {
  switch (status) {
    case 'unsupported':
      return {
        title: 'Folder sync is unavailable',
        detail: 'This browser cannot open a folder on disk. Try Chrome or Edge over HTTPS.',
      }
    case 'disconnected':
      return {
        title: 'Back up to Google Drive',
        detail:
          'Choose the Google Drive folder on this computer to keep a copy of every book and entry on disk.',
      }
    case 'connecting':
      return { title: 'Choosing a folder…', detail: 'Pick the folder Google Drive keeps on this computer.' }
    case 'needs-permission':
      return {
        title: folderName ? `Access to ${folderName} is paused` : 'Folder access is paused',
        detail: 'Allow BookJournal to write to the folder again to resume syncing.',
      }
    case 'syncing':
      return {
        title: folderName ? `Syncing to ${folderName}…` : 'Syncing…',
        detail: 'Writing the latest books and entries.',
      }
    case 'synced':
      return {
        title: folderName ? `Synced to ${folderName}` : 'Synced',
        detail: lastSyncLabel(lastSyncedAt),
      }
    case 'error':
      return { title: 'Sync needs attention', detail: error ?? 'The folder could not be reached.' }
  }
}

export function SyncStatus({ compact = false }: { compact?: boolean }) {
  const { sync } = useJournal()
  const { status, folderName, lastSyncedAt, error } = sync
  const { title, detail } = describe(status, folderName, lastSyncedAt, error)
  const busy = status === 'syncing' || status === 'connecting'

  return (
    <section className={`sync-card${compact ? ' compact' : ''}`} aria-live="polite">
      <span className="sync-dot" data-status={status} aria-hidden="true" />
      <div className="sync-copy">
        <p className="sync-title">{title}</p>
        <p className="sync-detail">{detail}</p>
      </div>
      <div className="sync-actions">
        {status === 'unsupported' ? null : status === 'disconnected' ? (
          <button type="button" className="btn primary" onClick={() => void sync.connect()}>
            Choose folder
          </button>
        ) : status === 'needs-permission' ? (
          <button type="button" className="btn primary" onClick={() => void sync.reconnect()}>
            Allow access
          </button>
        ) : status === 'error' ? (
          <>
            <button type="button" className="btn primary" onClick={() => void sync.syncNow()}>
              Try again
            </button>
            <button type="button" className="text-button" onClick={() => void sync.disconnect()}>
              Disconnect
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn quiet" disabled={busy} onClick={() => void sync.syncNow()}>
              {busy ? 'Syncing…' : 'Sync now'}
            </button>
            <button type="button" className="text-button" onClick={() => void sync.disconnect()}>
              Disconnect
            </button>
          </>
        )}
      </div>
    </section>
  )
}
