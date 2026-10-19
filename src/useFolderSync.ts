import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  clearFolderHandle,
  loadFolderHandle,
  loadSyncBase,
  loadSyncMeta,
  mergeStores,
  permissionState,
  pickSyncFolder,
  readSnapshot,
  saveFolderHandle,
  saveSyncBase,
  saveSyncMeta,
  sameStore,
  SnapshotUnreadableError,
  syncSupported,
  writeSnapshot,
  type SyncMeta,
} from './sync.ts'
import type { Store } from './types.ts'

export type FolderSyncStatus =
  | 'unsupported'
  | 'disconnected'
  | 'connecting'
  | 'needs-permission'
  | 'syncing'
  | 'synced'
  | 'error'

export type FolderSync = {
  status: FolderSyncStatus
  folderName: string | null
  lastSyncedAt: string | null
  error: string | null
  connect: () => Promise<void>
  syncNow: () => Promise<void>
  reconnect: () => Promise<void>
  disconnect: () => Promise<void>
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function syncErrorMessage(error: unknown) {
  if (error instanceof SnapshotUnreadableError) return error.message
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Permission to use the folder was denied.'
    if (error.name === 'SecurityError') return 'This browser blocked access to the folder.'
    if (error.name === 'NotFoundError') return 'The folder could not be found. It may have been moved.'
  }
  return 'The folder could not be reached.'
}

export function useFolderSync(store: Store, setStore: Dispatch<SetStateAction<Store>>): FolderSync {
  const supported = syncSupported()
  const [meta, setMeta] = useState<SyncMeta | null>(() => loadSyncMeta())
  const [status, setStatus] = useState<FolderSyncStatus>(() => {
    if (!syncSupported()) return 'unsupported'
    // Neutral until the async permission check finishes (#8).
    return loadSyncMeta() ? 'connecting' : 'disconnected'
  })
  const [error, setError] = useState<string | null>(null)
  const handleRef = useRef<FileSystemDirectoryHandle | null>(null)
  const storeRef = useRef(store)
  const setStoreRef = useRef(setStore)
  const statusRef = useRef(status)
  const writeQueue = useRef<Promise<void>>(Promise.resolve())
  const lastMergedJson = useRef<string | null>(null)
  const pushGeneration = useRef(0)
  const connectionGeneration = useRef(0)

  useEffect(() => {
    storeRef.current = store
  }, [store])

  useEffect(() => {
    setStoreRef.current = setStore
  }, [setStore])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  const clearConnectionState = useCallback(() => {
    handleRef.current = null
    saveSyncMeta(null)
    saveSyncBase(null)
    setMeta(null)
  }, [])

  const push = useCallback(async (requestPermission = false) => {
    const handle = handleRef.current
    if (!handle) return
    // Avoid syncing↔paused flicker while access is still blocked (#7).
    if (!requestPermission && statusRef.current === 'needs-permission') return

    const connection = connectionGeneration.current
    const generation = ++pushGeneration.current
    setStatus('syncing')
    setError(null)
    try {
      // Request permission before any other awaits so a click gesture still counts.
      const permission = await permissionState(handle, requestPermission)
      if (connection !== connectionGeneration.current || handleRef.current !== handle) return
      if (permission !== 'granted') {
        if (generation === pushGeneration.current) setStatus('needs-permission')
        return
      }
      const write = writeQueue.current.then(async () => {
        if (connection !== connectionGeneration.current || handleRef.current !== handle) return

        const snapshot = await readSnapshot(handle)
        if (connection !== connectionGeneration.current || handleRef.current !== handle) return
        if (snapshot.status === 'unreadable') {
          throw new SnapshotUnreadableError(snapshot.detail)
        }

        const remote = snapshot.status === 'ready' ? snapshot.store : null
        const base = loadSyncBase()
        // Compute outside the updater: React may defer updaters after setStatus('syncing'),
        // so capturing `merged` inside setStore left writeSnapshot(undefined) (blocker 1).
        const local = storeRef.current
        const merged: Store = remote ? mergeStores(local, remote, base) : local
        if (!sameStore(merged, local)) {
          storeRef.current = merged
          lastMergedJson.current = JSON.stringify(merged)
          setStoreRef.current((prev) => {
            const next = prev === local ? merged : remote ? mergeStores(prev, remote, base) : prev
            storeRef.current = next
            if (!sameStore(next, prev)) lastMergedJson.current = JSON.stringify(next)
            return sameStore(next, prev) ? prev : next
          })
        }

        if (connection !== connectionGeneration.current || handleRef.current !== handle) return

        if (remote && sameStore(merged, remote)) {
          const next: SyncMeta = {
            folderName: handle.name,
            lastSyncedAt: snapshot.status === 'ready' ? snapshot.savedAt : null,
          }
          saveSyncMeta(next)
          saveSyncBase(merged)
          setMeta(next)
          return
        }

        const savedAt = await writeSnapshot(handle, merged)
        if (connection !== connectionGeneration.current || handleRef.current !== handle) return

        const next: SyncMeta = { folderName: handle.name, lastSyncedAt: savedAt }
        saveSyncMeta(next)
        saveSyncBase(merged)
        setMeta(next)
      })
      writeQueue.current = write.catch(() => {})
      await write
      if (connection !== connectionGeneration.current || handleRef.current !== handle) return
      if (generation === pushGeneration.current) setStatus('synced')
    } catch (cause) {
      if (connection !== connectionGeneration.current || handleRef.current !== handle) return
      if (generation !== pushGeneration.current) return
      setError(syncErrorMessage(cause))
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    if (!supported) return
    let cancelled = false

    void (async () => {
      const saved = loadSyncMeta()
      if (!saved) return
      try {
        const handle = await loadFolderHandle()
        if (cancelled) return
        if (!handle) {
          clearConnectionState()
          setStatus('disconnected')
          return
        }
        handleRef.current = handle
        const permission = await permissionState(handle)
        if (cancelled) return
        if (permission === 'granted') {
          await push()
        } else if (permission === 'denied') {
          handleRef.current = null
          clearConnectionState()
          setStatus('disconnected')
          void clearFolderHandle()
        } else {
          setStatus('needs-permission')
        }
      } catch {
        if (!cancelled) {
          handleRef.current = null
          clearConnectionState()
          setStatus('disconnected')
          void clearFolderHandle()
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [supported, push, clearConnectionState])

  useEffect(() => {
    if (!handleRef.current) return
    if (status === 'needs-permission' || status === 'connecting' || status === 'disconnected') return
    if (lastMergedJson.current !== null && JSON.stringify(store) === lastMergedJson.current) {
      return
    }
    lastMergedJson.current = null
    const timer = window.setTimeout(() => {
      void push()
    }, 800)
    return () => window.clearTimeout(timer)
  }, [store, push, status])

  const connect = useCallback(async () => {
    if (!syncSupported()) {
      setStatus('unsupported')
      return
    }
    setStatus('connecting')
    setError(null)
    try {
      const handle = await pickSyncFolder()
      handleRef.current = handle
      connectionGeneration.current += 1
      const next: SyncMeta = { folderName: handle.name, lastSyncedAt: null }
      saveSyncMeta(next)
      setMeta(next)
      try {
        await saveFolderHandle(handle)
      } catch {
        // The folder still works for this session if the browser cannot remember it.
      }
      const permission = await permissionState(handle, true)
      if (permission !== 'granted') {
        setError('Permission to write to the folder was not granted.')
        setStatus('needs-permission')
        return
      }

      await push()
    } catch (cause) {
      if (isAbort(cause)) {
        setStatus(handleRef.current ? 'synced' : 'disconnected')
        return
      }
      setError(syncErrorMessage(cause))
      setStatus('error')
    }
  }, [push])

  const syncNow = useCallback(async () => {
    // Prefer the in-memory handle so requestPermission stays inside the user gesture.
    if (handleRef.current) {
      await push(true)
      return
    }
    let handle: FileSystemDirectoryHandle | null = null
    try {
      handle = await loadFolderHandle()
    } catch {
      handle = null
    }
    if (!handle) {
      setStatus('disconnected')
      return
    }
    handleRef.current = handle
    await push(true)
  }, [push])

  const reconnect = syncNow

  const disconnect = useCallback(async () => {
    connectionGeneration.current += 1
    pushGeneration.current += 1
    clearConnectionState()
    setError(null)
    setStatus(syncSupported() ? 'disconnected' : 'unsupported')
    try {
      await clearFolderHandle()
    } catch {
      // Nothing else depends on the stored handle.
    }
  }, [clearConnectionState])

  return useMemo(
    () => ({
      status,
      folderName: meta?.folderName ?? null,
      lastSyncedAt: meta?.lastSyncedAt ?? null,
      error,
      connect,
      syncNow,
      reconnect,
      disconnect,
    }),
    [status, meta, error, connect, syncNow, reconnect, disconnect],
  )
}
