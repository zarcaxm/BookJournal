declare module 'virtual:pwa-register' {
  type RegisterSWOptions = {
    immediate?: boolean
    onRegisteredSW?: (swScriptUrl: string, registration: ServiceWorkerRegistration | undefined) => void
  }

  export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>
}
