import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  clearFolderHandle,
  loadFolderHandle,
  loadSyncMeta,
  permissionState,
  pickSyncFolder,
  readSnapshot,
  saveFolderHandle,
  saveSyncMeta,
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

function isEmpty(store: Store) {
  return store.books.length === 0 && store.entries.length === 0
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function syncErrorMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Permission to use the folder was denied.'
    if (error.name === 'SecurityError') return 'This browser blocked access to the folder.'
    if (error.name === 'NotFoundError') return 'The folder could not be found. It may have been moved.'
  }
  return 'The folder could not be reached.'
}

export function useFolderSync(store: Store, replaceStore: (store: Store) => void): FolderSync {
  const supported = syncSupported()
  const [meta, setMeta] = useState<SyncMeta | null>(() => loadSyncMeta())
  const [status, setStatus] = useState<FolderSyncStatus>(() => {
    if (!syncSupported()) return 'unsupported'
    return loadSyncMeta() ? 'needs-permission' : 'disconnected'
  })
  const [error, setError] = useState<string | null>(null)
  const handleRef = useRef<FileSystemDirectoryHandle | null>(null)
  const storeRef = useRef(store)
  const replaceRef = useRef(replaceStore)
  const writeQueue = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    storeRef.current = store
  }, [store])

  useEffect(() => {
    replaceRef.current = replaceStore
  }, [replaceStore])

  const push = useCallback(async (snapshot: Store, requestPermission = false) => {
    const handle = handleRef.current
    if (!handle) return
    setStatus('syncing')
    setError(null)
    try {
      const permission = await permissionState(handle, requestPermission)
      if (permission !== 'granted') {
        setStatus('needs-permission')
        return
      }
      const write = writeQueue.current.then(async () => {
        const savedAt = await writeSnapshot(handle, snapshot)
        const next: SyncMeta = { folderName: handle.name, lastSyncedAt: savedAt }
        saveSyncMeta(next)
        setMeta(next)
      })
      writeQueue.current = write.catch(() => {})
      await write
      setStatus('synced')
    } catch (cause) {
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
          saveSyncMeta(null)
          setMeta(null)
          setStatus('disconnected')
          return
        }
        handleRef.current = handle
        const permission = await permissionState(handle)
        if (cancelled) return
        if (permission === 'granted') {
          await push(storeRef.current)
        } else if (permission === 'denied') {
          saveSyncMeta(null)
          setMeta(null)
          setStatus('disconnected')
          void clearFolderHandle()
        } else {
          setStatus('needs-permission')
        }
      } catch {
        if (!cancelled) {
          setStatus('disconnected')
          setMeta(null)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [supported, push])

  useEffect(() => {
    if (!handleRef.current) return
    const timer = window.setTimeout(() => {
      void push(store)
    }, 800)
    return () => window.clearTimeout(timer)
  }, [store, push])

  const connect = useCallback(async () => {
    if (!syncSupported()) {
      setStatus('unsupported')
      return
    }
    setStatus('connecting')
    setError(null)
    try {
      const handle = await pickSyncFolder()
      const permission = await permissionState(handle)
      if (permission !== 'granted') {
        setError('Permission to write to the folder was not granted.')
        setStatus('needs-permission')
        return
      }
      handleRef.current = handle
      try {
        await saveFolderHandle(handle)
      } catch {
        // The folder still works for this session if the browser cannot remember it.
      }
      const next: SyncMeta = { folderName: handle.name, lastSyncedAt: null }
      saveSyncMeta(next)
      setMeta(next)

      const existing = await readSnapshot(handle)
      if (existing && isEmpty(storeRef.current) && !isEmpty(existing.store)) {
        replaceRef.current(existing.store)
        const adopted: SyncMeta = { folderName: handle.name, lastSyncedAt: existing.savedAt }
        saveSyncMeta(adopted)
        setMeta(adopted)
        setStatus('synced')
        return
      }

      await push(storeRef.current)
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
    let handle = handleRef.current
    if (!handle) {
      try {
        handle = await loadFolderHandle()
      } catch {
        handle = null
      }
    }
    if (!handle) {
      setStatus('disconnected')
      return
    }
    handleRef.current = handle
    await push(storeRef.current, true)
  }, [push])

  const reconnect = useCallback(async () => {
    let handle = handleRef.current
    if (!handle) {
      try {
        handle = await loadFolderHandle()
      } catch {
        handle = null
      }
    }
    if (!handle) {
      setStatus('disconnected')
      return
    }
    handleRef.current = handle
    await push(storeRef.current, true)
  }, [push])

  const disconnect = useCallback(async () => {
    handleRef.current = null
    saveSyncMeta(null)
    setMeta(null)
    setError(null)
    setStatus(syncSupported() ? 'disconnected' : 'unsupported')
    try {
      await clearFolderHandle()
    } catch {
      // Nothing else depends on the stored handle.
    }
  }, [])

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
