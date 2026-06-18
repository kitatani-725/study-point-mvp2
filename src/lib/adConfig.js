/** Pangle 広告枠キー（Placement 名の一元管理） */
export const AD_PLACEMENTS = {
  BANNER_HOME: 'banner_home',
  BANNER_ACCOUNT: 'banner_account',
  BANNER_REWARD_MODAL: 'banner_reward_modal',
  BANNER_ROULETTE: 'banner_roulette',
  BANNER_GAME: 'banner_game',
  REWARDED_80PT: 'rewarded_80pt',
  REWARDED_BOOST: 'rewarded_boost',
  REWARDED_HOURGLASS: 'rewarded_hourglass',
  INTERSTITIAL_APP_RESUME: 'interstitial_app_resume',
  INTERSTITIAL_WORK_END: 'interstitial_work_end',
  INTERSTITIAL_ROULETTE_3SPINS: 'interstitial_roulette_3spins',
}

/**
 * Pangle 管理画面の広告枠 ↔ アプリ内の対応
 * （.env のキー名は PLACEMENT_ENV_KEYS を参照）
 */
export const AD_PLACEMENT_DESCRIPTIONS = {
  [AD_PLACEMENTS.BANNER_HOME]:
    'ホーム画面バナー | Pangle: ホーム画面バナー | DOM: .app-banner-under-footer (320×50)',
  [AD_PLACEMENTS.BANNER_ACCOUNT]:
    'アカウント画面バナー | Pangle: アカウント画面バナー | DOM: .ad-banner-account-inline (300×250)',
  [AD_PLACEMENTS.BANNER_REWARD_MODAL]:
    '獲得モーダルバナー | Pangle: 獲得モーダルバナー | DOM: .reward-sheet-banner (300×250)',
  [AD_PLACEMENTS.BANNER_ROULETTE]:
    'ポイントルーレットバナー | Pangle: ポイントルーレットバナー | DOM: .garapon-ad-banner-slot (300×250)',
  [AD_PLACEMENTS.BANNER_GAME]:
    'ゲーム画面バナー | Pangle: ゲーム画面バナー | DOM: .game-ad-banner-slot (300×250)',
  [AD_PLACEMENTS.REWARDED_80PT]:
    'CMを見てリワード | Pangle: cmを見てリワード | 将来: showRewardedAdFor80Points（動画を見て80＋豚チケット）',
  [AD_PLACEMENTS.REWARDED_BOOST]:
    'ブーストリワード | Pangle: ブーストリワード | 将来: showRewardedAdForBoost',
  [AD_PLACEMENTS.REWARDED_HOURGLASS]:
    '砂時計リワード | Pangle: 砂時計リワード | 将来: 砂時計消費系リワード（現状UI未接続）',
  [AD_PLACEMENTS.INTERSTITIAL_APP_RESUME]:
    '再起動インステ | Pangle: 再起動インステ | 将来: showInterstitialOnAppLaunch',
  [AD_PLACEMENTS.INTERSTITIAL_WORK_END]:
    'ワークエンドインステ | Pangle: ワークエンドインステ | 将来: showInterstitialAfterWorkEnd',
  [AD_PLACEMENTS.INTERSTITIAL_ROULETTE_3SPINS]:
    'ルーレット3回インステ | Pangle: ルーレット3回インステ | 将来: showInterstitialAfterRouletteEvery3Spins',
}

const PLACEMENT_ENV_KEYS = {
  [AD_PLACEMENTS.BANNER_HOME]: {
    android: 'VITE_PANGLE_ANDROID_BANNER_HOME',
    ios: 'VITE_PANGLE_IOS_BANNER_HOME',
  },
  [AD_PLACEMENTS.BANNER_ACCOUNT]: {
    android: 'VITE_PANGLE_ANDROID_BANNER_ACCOUNT',
    ios: 'VITE_PANGLE_IOS_BANNER_ACCOUNT',
  },
  [AD_PLACEMENTS.BANNER_REWARD_MODAL]: {
    android: 'VITE_PANGLE_ANDROID_BANNER_REWARD_MODAL',
    ios: 'VITE_PANGLE_IOS_BANNER_REWARD_MODAL',
  },
  [AD_PLACEMENTS.BANNER_ROULETTE]: {
    android: 'VITE_PANGLE_ANDROID_BANNER_ROULETTE',
    ios: 'VITE_PANGLE_IOS_BANNER_ROULETTE',
  },
  [AD_PLACEMENTS.BANNER_GAME]: {
    android: 'VITE_PANGLE_ANDROID_BANNER_GAME',
    ios: 'VITE_PANGLE_IOS_BANNER_GAME',
  },
  [AD_PLACEMENTS.REWARDED_80PT]: {
    android: 'VITE_PANGLE_ANDROID_REWARDED_80PT',
    ios: 'VITE_PANGLE_IOS_REWARDED_80PT',
  },
  [AD_PLACEMENTS.REWARDED_BOOST]: {
    android: 'VITE_PANGLE_ANDROID_REWARDED_BOOST',
    ios: 'VITE_PANGLE_IOS_REWARDED_BOOST',
  },
  [AD_PLACEMENTS.REWARDED_HOURGLASS]: {
    android: 'VITE_PANGLE_ANDROID_REWARDED_HOURGLASS',
    ios: 'VITE_PANGLE_IOS_REWARDED_HOURGLASS',
  },
  [AD_PLACEMENTS.INTERSTITIAL_APP_RESUME]: {
    android: 'VITE_PANGLE_ANDROID_INTERSTITIAL_APP_RESUME',
    ios: 'VITE_PANGLE_IOS_INTERSTITIAL_APP_RESUME',
  },
  [AD_PLACEMENTS.INTERSTITIAL_WORK_END]: {
    android: 'VITE_PANGLE_ANDROID_INTERSTITIAL_WORK_END',
    ios: 'VITE_PANGLE_IOS_INTERSTITIAL_WORK_END',
  },
  [AD_PLACEMENTS.INTERSTITIAL_ROULETTE_3SPINS]: {
    android: 'VITE_PANGLE_ANDROID_INTERSTITIAL_ROULETTE_3SPINS',
    ios: 'VITE_PANGLE_IOS_INTERSTITIAL_ROULETTE_3SPINS',
  },
}

const APP_ID_ENV_KEYS = {
  android: 'VITE_PANGLE_ANDROID_APP_ID',
  ios: 'VITE_PANGLE_IOS_APP_ID',
}

function readEnvString(key) {
  const value = import.meta.env[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

/** @returns {'ios' | 'android' | 'unknown'} */
export function detectAdPlatform() {
  const ua = navigator.userAgent || ''
  if (/android/i.test(ua)) return 'android'
  if (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  ) {
    return 'ios'
  }
  return 'unknown'
}

/** 現在の OS に応じた Pangle App ID（未設定時は null） */
export function getPangleAppId(platform = detectAdPlatform()) {
  if (platform !== 'android' && platform !== 'ios') return null
  return readEnvString(APP_ID_ENV_KEYS[platform])
}

/** Placement キーに対応する .env 変数名（Android / iOS） */
export function getPlacementEnvKeys(placementKey) {
  return PLACEMENT_ENV_KEYS[placementKey] ?? null
}

/** 現在の OS に応じた Placement ID（未設定・未知 OS 時は null） */
export function getPanglePlacementId(placementKey, platform = detectAdPlatform()) {
  const mapping = PLACEMENT_ENV_KEYS[placementKey]
  if (!mapping) return null
  if (platform !== 'android' && platform !== 'ios') return null
  return readEnvString(mapping[platform])
}

function maskAdId(id) {
  if (!id) return null
  if (id.length <= 4) return '****'
  return `****${id.slice(-4)}`
}

/** 開発時のみ: OS 判定と App / Placement ID の設定有無をログ出力 */
export function logAdConfigInDev() {
  if (!import.meta.env.DEV) return

  const platform = detectAdPlatform()
  const appId = getPangleAppId(platform)
  const appEnvKey = APP_ID_ENV_KEYS[platform] ?? null

  console.log('[ad:config] platform', platform)
  console.log(
    '[ad:config] appId',
    appId
      ? `configured (${maskAdId(appId)}) env=${appEnvKey}`
      : `not configured env=${appEnvKey ?? 'n/a'}`
  )

  for (const placementKey of Object.values(AD_PLACEMENTS)) {
    const placementId = getPanglePlacementId(placementKey, platform)
    const envKeys = getPlacementEnvKeys(placementKey)
    const envKey =
      platform === 'android'
        ? envKeys?.android
        : platform === 'ios'
          ? envKeys?.ios
          : null
    const description = AD_PLACEMENT_DESCRIPTIONS[placementKey] ?? placementKey

    console.log(
      `[ad:config] placement ${placementKey}`,
      placementId
        ? `configured (${maskAdId(placementId)}) env=${envKey}`
        : `not configured env=${envKey ?? 'n/a'}`,
      description
    )
  }
}
