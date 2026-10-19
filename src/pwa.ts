import { registerSW } from 'virtual:pwa-register'

const updateIntervalMs = 60 * 60 * 1000

export function registerAppUpdates() {
  if (!('serviceWorker' in navigator)) return

  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => {
        void registration.update()
      }
      window.setInterval(check, updateIntervalMs)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
    },
  })
}
