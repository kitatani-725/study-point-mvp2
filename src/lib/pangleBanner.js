/**
 * Pangle バナー広告（Web 層）
 *
 * Pangle の公式 Banner SDK は Android / iOS ネイティブ向けです。
 * 本ファイルは WebView 内の HTML からネイティブ SDK を呼ぶブリッジ層です。
 *
 * ネイティブ側は `window.StudyPointPangleAds` を注入してください:
 *   - initialize({ appId }) => Promise<void>  (任意・初回のみ)
 *   - loadBanner({ appId, placementId, placementKey, width, height, container }) => Promise<{ success: boolean, error?: string }>
 *   - destroyBanner({ placementKey, placementId }) => Promise<void>  (任意)
 *   - isAvailable() => boolean  (任意)
 *
 * ブリッジ未実装・env 未設定・読み込み失敗時は既存のグレー仮枠を表示します。
 */
import {
  AD_PLACEMENTS,
  detectAdPlatform,
  getPangleAppId,
  getPanglePlacementId,
} from './adConfig.js'

/** @type {readonly string[]} */
export const BANNER_PLACEMENT_KEYS = [
  AD_PLACEMENTS.BANNER_HOME,
  AD_PLACEMENTS.BANNER_ACCOUNT,
  AD_PLACEMENTS.BANNER_REWARD_MODAL,
  AD_PLACEMENTS.BANNER_ROULETTE,
  AD_PLACEMENTS.BANNER_GAME,
]

/** 広告枠ごとの想定サイズ（px） */
export const BANNER_SLOT_SPECS = {
  [AD_PLACEMENTS.BANNER_HOME]: { width: 320, height: 50 },
  [AD_PLACEMENTS.BANNER_ACCOUNT]: { width: 300, height: 250 },
  [AD_PLACEMENTS.BANNER_REWARD_MODAL]: { width: 300, height: 250 },
  [AD_PLACEMENTS.BANNER_ROULETTE]: { width: 300, height: 250 },
  [AD_PLACEMENTS.BANNER_GAME]: { width: 300, height: 250 },
}

const DUMMY_LABELS = {
  [AD_PLACEMENTS.BANNER_HOME]: '320×50 banner',
  [AD_PLACEMENTS.BANNER_ACCOUNT]: 'Account Banner 300×250',
  [AD_PLACEMENTS.BANNER_REWARD_MODAL]: '300×250 banner',
  [AD_PLACEMENTS.BANNER_ROULETTE]: '300×250 banner',
  [AD_PLACEMENTS.BANNER_GAME]: '300×250 banner',
}

/** @type {WeakMap<HTMLElement, { placementKey: string, state?: string, loading?: boolean }>} */
const slotState = new WeakMap()

let sdkInitPromise = null
let sdkInitAppId = null

function maskAdId(id) {
  if (!id) return null
  if (id.length <= 4) return '****'
  return `****${id.slice(-4)}`
}

function logBannerDev(placementKey, message, extra) {
  if (!import.meta.env.DEV) return
  if (extra !== undefined) {
    console.log(`[ad:banner] ${placementKey} ${message}`, extra)
    return
  }
  console.log(`[ad:banner] ${placementKey} ${message}`)
}

function getPangleBannerBridge() {
  const bridge = window.StudyPointPangleAds
  if (bridge && typeof bridge.loadBanner === 'function') {
    return bridge
  }
  return null
}

function isBannerPlacementKey(placementKey) {
  return BANNER_PLACEMENT_KEYS.includes(placementKey)
}

function ensureBannerSlotStructure(container, placementKey) {
  container.classList.add('ad-banner-slot')
  let host = container.querySelector('.pangle-banner-host')
  if (!host) {
    host = document.createElement('div')
    host.className = 'pangle-banner-host'
    host.setAttribute('aria-hidden', 'true')
    host.hidden = true
    container.prepend(host)
  }
  let dummy = container.querySelector('.ad-banner-dummy')
  if (!dummy) {
    dummy = document.createElement('span')
    dummy.className = 'ad-banner-dummy'
    dummy.textContent = DUMMY_LABELS[placementKey] || 'banner'
    container.appendChild(dummy)
  }
  return { host, dummy }
}

function applySlotVisualState(container, state) {
  const { host, dummy } = ensureBannerSlotStructure(
    container,
    container.getAttribute('data-ad-placement') || ''
  )
  container.dataset.adState = state
  container.classList.toggle('ad-banner-slot--loaded', state === 'loaded')
  container.classList.toggle('ad-banner-slot--loading', state === 'loading')
  container.classList.toggle('ad-banner-slot--placeholder', state === 'placeholder' || state === 'failed')

  const showAd = state === 'loaded'
  host.hidden = !showAd
  dummy.hidden = showAd
}

async function ensureSdkInitialized(appId) {
  const bridge = getPangleBannerBridge()
  if (!bridge) return false
  if (typeof bridge.isAvailable === 'function' && !bridge.isAvailable()) {
    return false
  }
  if (typeof bridge.initialize !== 'function') {
    return true
  }
  if (sdkInitPromise && sdkInitAppId === appId) {
    await sdkInitPromise
    return true
  }
  sdkInitAppId = appId
  sdkInitPromise = Promise.resolve(bridge.initialize({ appId }))
  await sdkInitPromise
  return true
}

/**
 * 1つのバナー枠に Pangle バナーをマウント（失敗時は仮枠）
 * @param {HTMLElement | null | undefined} container
 */
export async function mountPangleBanner(container) {
  if (!container || !(container instanceof HTMLElement)) return

  const placementKey = container.getAttribute('data-ad-placement')
  if (!placementKey || !isBannerPlacementKey(placementKey)) return

  const spec = BANNER_SLOT_SPECS[placementKey]
  if (!spec) return

  ensureBannerSlotStructure(container, placementKey)

  const platform = detectAdPlatform()
  const placementId = getPanglePlacementId(placementKey, platform)
  const appId = getPangleAppId(platform)

  if (!placementId || !appId) {
    applySlotVisualState(container, 'placeholder')
    slotState.set(container, { placementKey, state: 'placeholder' })
    logBannerDev(
      placementKey,
      placementId ? 'appId not configured, showing placeholder' : 'not configured, showing placeholder'
    )
    return
  }

  const bridge = getPangleBannerBridge()
  if (!bridge) {
    applySlotVisualState(container, 'placeholder')
    slotState.set(container, { placementKey, state: 'placeholder' })
    logBannerDev(placementKey, 'bridge unavailable, showing placeholder', {
      placementId: maskAdId(placementId),
    })
    return
  }

  const prev = slotState.get(container)
  if (prev?.placementKey === placementKey && prev?.state === 'loaded') {
    return
  }
  if (prev?.loading) {
    return
  }

  slotState.set(container, { placementKey, loading: true })
  applySlotVisualState(container, 'loading')
  logBannerDev(placementKey, 'load start', { placementId: maskAdId(placementId) })

  try {
    const initialized = await ensureSdkInitialized(appId)
    if (!initialized) {
      throw new Error('sdk_unavailable')
    }

    const host = container.querySelector('.pangle-banner-host')
    const result = await bridge.loadBanner({
      appId,
      placementId,
      placementKey,
      width: spec.width,
      height: spec.height,
      container: host,
    })

    if (result && result.success === false) {
      throw new Error(result.error || 'load_failed')
    }

    applySlotVisualState(container, 'loaded')
    slotState.set(container, { placementKey, state: 'loaded', loading: false })
    logBannerDev(placementKey, 'load complete', { placementId: maskAdId(placementId) })
  } catch (err) {
    applySlotVisualState(container, 'failed')
    slotState.set(container, { placementKey, state: 'failed', loading: false })
    logBannerDev(placementKey, 'load failed, showing placeholder', {
      placementId: maskAdId(placementId),
      error: err?.message || String(err),
    })
  }
}

/** バナー枠のマウントを解除（任意・ネイティブ destroy 対応） */
export async function unmountPangleBanner(container) {
  if (!container || !(container instanceof HTMLElement)) return
  const placementKey = container.getAttribute('data-ad-placement')
  if (!placementKey || !isBannerPlacementKey(placementKey)) return

  const bridge = getPangleBannerBridge()
  const platform = detectAdPlatform()
  const placementId = getPanglePlacementId(placementKey, platform)

  if (bridge && typeof bridge.destroyBanner === 'function' && placementId) {
    try {
      await bridge.destroyBanner({ placementKey, placementId })
    } catch (err) {
      logBannerDev(placementKey, 'destroy failed', { error: err?.message || String(err) })
    }
  }

  const host = container.querySelector('.pangle-banner-host')
  if (host) host.replaceChildren()
  slotState.delete(container)
  applySlotVisualState(container, 'placeholder')
}

/** document 内の `[data-ad-placement]` バナー枠を走査してマウント */
export function refreshPangleBanners(root = document) {
  const scope = root instanceof Document ? root : root?.ownerDocument || document
  const base = root instanceof Document ? root : root
  if (!base?.querySelectorAll) return

  base.querySelectorAll('[data-ad-placement]').forEach((el) => {
    const placementKey = el.getAttribute('data-ad-placement')
    if (isBannerPlacementKey(placementKey)) {
      void mountPangleBanner(el)
    }
  })
}

let bannerRefreshTimer = null

/** DOM 更新後にバナー再マウントを予約 */
export function schedulePangleBannerRefresh(root = document) {
  if (bannerRefreshTimer) clearTimeout(bannerRefreshTimer)
  bannerRefreshTimer = setTimeout(() => {
    bannerRefreshTimer = null
    refreshPangleBanners(root)
  }, 0)
}

/** ホーム下部バナーのプリロード（boot layer1） */
export async function preloadHomeBannerAd() {
  const banner = document.querySelector('.app-banner-under-footer')
  if (!banner) return
  await mountPangleBanner(banner)
}

/** 開発時: バナー枠の設定状況とブリッジ有無をログ */
export function logBannerPlacementsInDev() {
  if (!import.meta.env.DEV) return

  const platform = detectAdPlatform()
  const bridge = getPangleBannerBridge()
  console.log('[ad:banner] bridge', bridge ? 'available' : 'unavailable')

  for (const placementKey of BANNER_PLACEMENT_KEYS) {
    const placementId = getPanglePlacementId(placementKey, platform)
    console.log(
      `[ad:banner] placement ${placementKey}`,
      placementId ? `configured (${maskAdId(placementId)})` : 'not configured'
    )
  }
}
