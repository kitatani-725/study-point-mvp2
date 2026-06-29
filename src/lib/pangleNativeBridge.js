/**
 * iOS/Android ネイティブ Pangle SDK ↔ Web ブリッジ
 *
 * pangleBanner.js が期待する window.StudyPointPangleAds を提供します。
 * Capacitor ネイティブプラグイン StudyPointPangleAds へ委譲します。
 */
import { Capacitor, registerPlugin } from '@capacitor/core'

const NativeStudyPointPangleAds = registerPlugin('StudyPointPangleAds')

function isNativePangleSupported() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'
}

function shouldLogPangleDiagnostics() {
  if (import.meta.env.DEV) return true
  if (import.meta.env.VITE_AD_DEBUG_LOG === '1') return true
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'
}

function logBridge(message, extra) {
  if (!shouldLogPangleDiagnostics()) return
  if (extra !== undefined) {
    console.log(`[ad:bridge] ${message}`, extra)
    return
  }
  console.log(`[ad:bridge] ${message}`)
}

function rectFromContainer(container) {
  if (!container || typeof container.getBoundingClientRect !== 'function') {
    return { x: 0, y: 0, width: 0, height: 0 }
  }

  // .pangle-banner-host は読み込み前 hidden のため rect が 0 になる — 親スロットへフォールバック
  let el = container
  let rect = el.getBoundingClientRect()
  while (el && (rect.width <= 0 || rect.height <= 0) && el.parentElement) {
    el = el.parentElement
    rect = el.getBoundingClientRect()
  }

  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  }
}

function installStudyPointPangleAdsBridge() {
  if (typeof window === 'undefined') return
  if (window.StudyPointPangleAds) return

  window.StudyPointPangleAds = {
    isAvailable() {
      return isNativePangleSupported()
    },

    async initialize({ appId } = {}) {
      if (!isNativePangleSupported()) return
      logBridge('initialize start', { appId: appId ? `****${String(appId).slice(-4)}` : null })
      try {
        await NativeStudyPointPangleAds.initialize({ appId })
        logBridge('initialize complete')
      } catch (err) {
        logBridge('initialize failed', { error: err?.message || String(err) })
        throw err
      }
    },

    async loadBanner({ appId, placementId, placementKey, width, height, container } = {}) {
      if (!isNativePangleSupported()) {
        logBridge('loadBanner skipped', { reason: 'bridge_unavailable' })
        return { success: false, error: 'bridge_unavailable' }
      }

      const rect = rectFromContainer(container)
      logBridge('loadBanner start', {
        placementKey,
        placementId: placementId ? `****${String(placementId).slice(-4)}` : null,
        width,
        height,
        rect,
      })

      const result = await NativeStudyPointPangleAds.loadBanner({
        appId,
        placementId,
        placementKey,
        width,
        height,
        x: rect.x,
        y: rect.y,
      })

      if (result?.success === false) {
        logBridge('loadBanner failed', {
          placementKey,
          error: result.error || 'load_failed',
          errorDetails: result.errorDetails || null,
        })
      } else {
        logBridge('loadBanner complete', { placementKey })
      }

      return result
    },

    async showBanner({ placementKey } = {}) {
      if (!isNativePangleSupported()) return
      await NativeStudyPointPangleAds.showBanner({ placementKey })
    },

    async hideBanner({ placementKey } = {}) {
      if (!isNativePangleSupported()) return
      await NativeStudyPointPangleAds.hideBanner({ placementKey })
    },

    async destroyBanner({ placementKey, placementId } = {}) {
      if (!isNativePangleSupported()) return
      await NativeStudyPointPangleAds.destroyBanner({ placementKey, placementId })
    },
  }
}

installStudyPointPangleAdsBridge()
