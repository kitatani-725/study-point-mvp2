import './style.css'
import './lib/pangleNativeBridge.js'
import { supabase } from './lib/supabase'
import { AD_PLACEMENTS, logAdConfigInDev } from './lib/adConfig.js'
import {
  logBannerPlacementsInDev,
  preloadHomeBannerAd,
  schedulePangleBannerRefresh,
} from './lib/pangleBanner.js'
import { checkWorkToolPresence, hasAnyAllowedWorkTool } from './lib/workToolCheck.js'
import {
  bindOnboardingDelegation,
  buildOnboardingOverlayHtml,
  markOnboardingComplete,
  migrateOnboardingForLegacyUser,
  ONBOARDING_LAST_INDEX,
  ONBOARDING_SLIDE_IDS,
  focusOnboardingNicknameInput,
  shouldShowOnboarding,
} from './lib/onboarding.js'

/** iPhone Safari 等のピンチ拡大を抑止（viewport と併用） */
function installViewportZoomGuard() {
  const blockGesture = (e) => e.preventDefault()
  const opts = { passive: false }
  document.addEventListener('gesturestart', blockGesture, opts)
  document.addEventListener('gesturechange', blockGesture, opts)
  document.addEventListener('gestureend', blockGesture, opts)
}
installViewportZoomGuard()

// --- user_id（匿名ユーザー識別子） ---
// 初回起動時のみ生成し、localStorage の `user_id` に保存して使い回す
const USER_ID_STORAGE_KEY = 'user_id'
function getUserId() {
  const existing = localStorage.getItem(USER_ID_STORAGE_KEY)
  if (existing) return existing
  let id = ''
  try {
    id = crypto.randomUUID()
  } catch {
    id = 'u_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
  }
  localStorage.setItem(USER_ID_STORAGE_KEY, id)
  return id
}

// --- 定数・ストレージキー ---
const STORAGE_KEYS = {
  points: 'sp_points',
  pigTickets: 'sp_pig_tickets',
  hourglasses: 'sp_hourglasses',
  todayEarned: 'sp_today_earned',
  /** 当日の作業セッション間で引き継ぐ「次の砂時計までの進捗秒」JSON `{ d: 'YYYY-MM-DD', s: number }` */
  hourglassCarryToday: 'sp_hourglass_carry_today',
  /** 当日の砂時計上限後超過作業秒 `{ d: 'YYYY-MM-DD', s: number }` */
  overflowWorkToday: 'sp_overflow_work_today',
  /** 当日の超過ボーナス豚チケット付与済み枚数 `{ d: 'YYYY-MM-DD', n: number }` */
  overflowPigTicketsToday: 'sp_overflow_pig_tickets_today',
  hourglassEarnedLog: 'sp_hourglass_earned_log', // { "YYYY-MM-DD": earnedCount }
  hourglassEarnedTotal: 'sp_hourglass_earned_total',
  boostActive: 'sp_boost_active',
  boostDate: 'sp_boost_date',
  lastDate: 'sp_last_date', // 日付リセット用 'YYYY-MM-DD'
  workLog: 'sp_work_log', // { "YYYY-MM-DD": totalSec }
  diaries: 'sp_diaries',   // { "YYYY-MM-DD": "本文" }
  missionClaims: 'sp_mission_claims', // { "missionId": "YYYY-MM-DD" } 受け取り済み日
  missionLastLogin: 'sp_mission_last_login', // ログインミッション用 'YYYY-MM-DD'
  loginDays: 'sp_login_days', // { "YYYY-MM-DD": true } 累計ログイン日
  gameGiftClaimDate: 'sp_game_gift_claim_date', // プレゼント（321）受取日 'YYYY-MM-DD'（当日なら 121 表示・無効）
  /** users.username のローカルキャッシュ（表示高速化。正式な保存先は Supabase） */
  usernameCache: 'sp_username_cache',
  /** 互換: 旧ニックネームキー（初回のみ読み込みに使用） */
  nickname: 'sp_nickname',
  /** ニックネーム保存完了＝初回登録完了（友達招待コード適用の前提） */
  registrationComplete: 'sp_registration_complete',
  /** 紹介者報酬の reward_logs 通知済みカーソル（created_at ISO） */
  referrerRewardLogLastSeenAt: 'sp_referrer_reward_log_last_seen_at',
  /** 旧キー（uuid id 用・移行後に削除） */
  referrerRewardLogMaxId: 'sp_referrer_reward_log_max_id',
}
const REFERRAL_REFERRER_NOTIFY_MESSAGE = 'あなたの紹介コードが入力されました'
const REFERRAL_REFERRER_REWARD_POINTS = 1000
const REFERRAL_REFERRED_REWARD_POINTS = 2000
const REFERRAL_MAX_REFERRER_REWARDS = 4
/** ポイント最終増減日からの有効期限（日） */
const POINTS_EXPIRE_DAYS = 365
/** アカウント画面：利用規約・プライバシーポリシー（Notion） */
const TERMS_OF_SERVICE_URL =
  'https://achieved-bread-6e8.notion.site/3670f0e1059f80b2aa2bed75670e8ea1?pvs=143'
const PRIVACY_POLICY_URL =
  'https://achieved-bread-6e8.notion.site/36a0f0e1059f80459b14e08e0995a286?source=copy_link'
const DEFAULT_USERNAME = '名無し'
const USERNAME_MAX_LEN = 20
const MAX_HOURGLASSES = 7
const DEFAULT_HOURGLASSES = 0
/** 通常作業: 砂時計1個あたりの必要作業時間（秒） */
const WORK_SECONDS_PER_HOURGLASS = 25 * 60
/** ブースト中: 砂時計1個あたりの必要作業時間（秒） */
const BOOST_WORK_SECONDS_PER_HOURGLASS = 20 * 60
/** 手元（動き）判定の実行間隔（秒） */
const HAND_CHECK_INTERVAL_SECONDS = 5 * 60
/** 砂時計満タン後の超過作業ボーナス：1日あたりの豚チケット付与上限 */
const OVERFLOW_PIG_TICKET_DAILY_LIMIT = 3

/** reward_logs.reward_type（確定版） */
const REWARD_TYPES = new Set([
  'get_15',
  'get_80',
  'mission',
  'roulette',
  'manual_adjust',
  'cm',
  'gift',
  'offerwall_1',
  'offerwall_2',
  'offer_1',
  'offer_2',
  'referral_referred',
  'referral_referrer',
  'gift_code',
])
const PIG_TICKET_LOG_TYPES = new Set([
  'ad_bonus',
  'mission',
  'roulette_use',
  'manual_adjust',
  'campaign',
  'gift_code',
  'overflow_bonus',
])

// --- 状態 ---
let state = {
  userId: '',
  /** Supabase users.username（キャッシュは localStorage.usernameCache） */
  username: DEFAULT_USERNAME,
  /** アカウント画面のユーザー名変更モーダル */
  nicknameModalOpen: false,
  /** 初回起動オンボーディング（300.svg〜304.svg） */
  onboardingActive: false,
  onboardingStep: 0,
  /** アカウント画面のアイコン選択モーダル */
  iconModalOpen: false,
  /** 選択中ポイ丸（icon_master） */
  selectedIconKey: 'default_01',
  selectedIconAssetPath: '/assets/icon/default_01.svg',
  /** アイコン選択モーダル用：所持一覧 */
  userIconsPicker: [],
  userIconsLoading: false,
  points: 0,
  pointsRowId: null,
  pigTickets: 0,
  hourglasses: DEFAULT_HOURGLASSES,
  maxHourglasses: MAX_HOURGLASSES,
  modalMessage: null,
  /**
   * 作業セッション系 state（A案）
   *
   * ルール:
   * - 更新は原則 workSession 経由（開始 / 一時停止・再開 / 終了 / 自動一時停止）
   * - 状態判定は原則 getWorkSessionPhase() 経由（render の表示分岐含む）
   *
   * 例外:
   * - elapsedSec / sessionGrantedCount / lastTickAt は tick() が更新する（タイマー進行の本体）
   * - handleBackHome() は結果画面離脱時の後片付けとして一部を直接リセットする
   */
  isWorking: false, // 作業セッション実行中フラグ（work 画面の根本状態）
  isPaused: false, // 一時停止状態（手動・自動一時停止で true）
  sessionStartAt: null, // セッション開始時刻（将来の計測・分析用途を含む）
  elapsedSec: 0, // 現在セッションの経過秒数（tick() が加算）
  lastTickAt: null, // 直前 tick 実行時刻（delta 計算の基準）
  todayEarned: 0,
  /** 当日のみ有効。セッション終了後も保持し、次回作業の砂時計カウントに加算する進捗秒（付与に回した分は差し引く） */
  hourglassCarrySecToday: 0,
  sessionGrantedCount: 0, // 今回セッションで付与した砂時計数（result 表示にも使用）
  /** 今回セッションで砂時計上限により超過扱いになった作業秒（セッション内のみ） */
  sessionOverflowWorkSec: 0,
  /** 当日：砂時計上限後の超過作業秒（チケット未換算の端数含む） */
  overflowWorkSecondsToday: 0,
  /** 当日：超過ボーナスで獲得済みの豚チケット枚数 */
  overflowPigTicketsToday: 0,
  /** 今回の作業終了で獲得した超過ボーナス豚チケット枚数（結果画面表示用） */
  overflowPigTicketsGrantedThisSession: 0,
  screen: 'home', // 画面遷移状態（phase 判定でも参照）
  garaponSpinning: false,
  /** ルーレット累積回転角（deg）— 再描画後も位置が続くように保持 */
  garaponWheelDeg: 0,
  /** ルーレット⭐️：未所持の roulette_eligible アイコン（スピン前に更新） */
  rouletteEligibleIcons: [],
  /** ガラポン：ヘルプオーバーレイ */
  garaponHelpOpen: false,
  // カレンダー
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth() + 1,
  selectedDate: null, // 'YYYY-MM-DD' | null（日付タップで詳細表示）
  diaryEditDate: null, // 日記編集中の日付
  diaryEditText: '',
  /** 作業ログ画面：study_daily_logs のキャッシュ */
  workLogDailyLogs: null,
  workLogLoading: false,
  workLogError: null,
  /** 0=直近7日（今日を含む）。1=その前の7日… */
  workLogWeekOffset: 0,
  /** 友達招待 */
  referralCode: null,
  referralCodeLoading: false,
  referralAlreadyApplied: false,
  referralPanelOpen: false,
  // C: ブースト
  boostActive: false,
  boostDate: '', // 'YYYY-MM-DD'
  lastDate: '', // 日付リセット用
  // 暗幕
  darkMode: false,
  // 背景による自動一時停止（作業セッション補助フラグ）
  autoPaused: false, // 自動一時停止が発生したか（表示制御補助）
  autoPausedReason: null, // 自動一時停止理由: 'background' | 'motion' | null
  // ブースト確認モーダル
  boostConfirmOpen: false,
  // 獲得モーダル
  rewardPopup: null, // { type: 'points' | 'ticket', amount: number }
  /** 獲得モーダル：次の1回だけ下から出現アニメーション */
  rewardPopupNeedsEntryAnim: false,
  /** 共通モーダル管理（legacy フラグと同期） */
  activeModal: null, // 'code' | 'nickname' | 'reward' | 'referralReward' | 'giftSuccess' | 'mission' | 'boost' | 'message'
  modalPayload: null,
  // カメラ（作業画面）
  cameraError: null, // 権限拒否時などのメッセージ
  // 作業画面：10秒経過でタイマー開始（phase: countdown / running）
  workCountdownDone: false, // 10秒カウントダウン完了フラグ
  workCountdownTimeoutId: null, // カウントダウン用 setTimeout ID（clear 対象）
  // 作業終了確認（phase: endConfirm）
  endConfirmOpen: false, // 終了確認モーダル表示フラグ
  endConfirmResumeTickOnCancel: false, // endConfirmを開く直前がrunningだった場合の復帰フラグ
  endConfirmResumeCountdownOnCancel: false, // endConfirmを開く直前がcountdownだった場合の復帰フラグ
  // ミッション
  missionScreenOpen: false,
  missionTab: 'daily', // 'daily' | 'weekly' | 'monthly' | 'total'
  missionDefinitions: {
    daily: [],
    weekly: [],
    monthly: [],
    lifetime: [],
  },
  missionProgresses: {},
  lastLoginDate: '', // ログインミッション用 'YYYY-MM-DD'
  /** ゲーム画面プレゼント：この日付と同日なら本日受取済み（121.svg） */
  gameGiftClaimDate: '',
  /** ゲーム画面「獲得履歴」：Supabase reward_logs */
  rewardHistoryOpen: false,
  rewardHistoryLoading: false,
  rewardHistoryItems: null,
  rewardHistoryError: null,
  /** 作業開始時の初回道具判定が完了したら true（成功時は即タイマー／失敗時は救済10秒後） */
  workToolCheckDone: true,
  /** 最初の 3 秒（手元配置・準備）が終わったら true → この後から AI 判定 */
  toolCheckPrepareDone: true,
  /** AI 12 秒で失敗した場合のみ true → 救済の 10 秒カウントダウン文言を出す */
  toolCheckUsedRescuePath: false,
  /** 道具 AI 成功時、短く「認識できました／作業を開始します」を出す */
  toolCheckSuccessFlash: false,
  /** 終了確認: 道具判定中に開いた場合、キャンセルで判定を再開 */
  endConfirmResumeToolCheckOnCancel: false,
  /** 動き判定: 連続「動きなし」回数（動き検知で 0 にリセット） */
  motionFailCount: 0,
  // --- 通知（toast）---
  toastQueue: [],
  activeToast: null, // { id, type, message, createdAt }
  toastLastShownAt: {}, // { [dedupeKey]: number }
  toastNextId: 1,
  /** 通信・付与などの処理中フラグ（UI は patchLoadingUI で部分更新） */
  loading: {
    get15: false,
    video80: false,
    boost: false,
    applyCode: false,
    saveNickname: false,
    fetchPoints: false,
    fetchPigTickets: false,
    claimMission: false,
    saveStudyLog: false,
    exchange: false,
    garapon: false,
    referrerNotify: false,
    saveIcon: false,
  },
}
let tickIntervalId = null
/** 作業画面用カメラストリーム（再レンダ時も維持し、終了時に stopCamera で破棄） */
let cameraStream = null
/** 作業画面専用（loading 統合対象外） */
let isWorkStartProcessing = false
let isConfirmEndProcessing = false
let toastHideTimerId = null
let toastRemoveTimerId = null

function syncLegacyLoadingFlag(key) {
  const busy = !!state.loading[key]
  switch (key) {
    case 'get15':
      break
    case 'video80':
      break
    case 'boost':
      break
    case 'applyCode':
      break
    case 'saveNickname':
      break
    case 'referrerNotify':
      break
    case 'garapon':
      state.garaponSpinning = busy
      break
    default:
      break
  }
}

function snapshotLoadingState() {
  return { ...state.loading }
}

function formatLoadingStateBrief() {
  const active = Object.entries(state.loading)
    .filter(([, v]) => v)
    .map(([k]) => k)
  return active.length ? active.join(',') : 'idle'
}

function setLoading(key, value, options = {}) {
  const { silent = false, skipPatch = false } = options
  if (!(key in state.loading)) {
    console.warn('[loading] unknown key', key)
    return
  }
  const next = !!value
  const prev = state.loading[key]
  state.loading[key] = next
  syncLegacyLoadingFlag(key)
  if (!silent && prev !== next) {
    console.log(next ? `[loading] start ${key}` : `[loading] end ${key}`)
    console.log('[loading] state:', formatLoadingStateBrief())
  }
  if (!skipPatch) patchLoadingUI([key])
}

function isLoading(key) {
  return !!state.loading[key]
}

async function withLoading(key, asyncFn, options = {}) {
  const { blockedReturn, skipPatch = false } = options
  if (isLoading(key)) {
    console.log('[loading] blocked', key)
    return blockedReturn
  }
  setLoading(key, true, { skipPatch })
  try {
    return await asyncFn()
  } finally {
    setLoading(key, false, { skipPatch })
  }
}

function patchLoadingUI(keys) {
  const affected = keys ?? Object.keys(state.loading)
  if (affected.some((k) => ['get15', 'video80', 'boost'].includes(k))) {
    if (state.screen === 'home' && document.querySelector('#app .home-viewport')) {
      patchHomeActionButtons()
      patchHomeBoostModalButtons()
    }
  }
  if (affected.includes('applyCode')) patchAccountCodeApplyUI()
  if (affected.includes('saveNickname')) patchAccountNicknameSaveUI()
  if (affected.includes('saveIcon')) patchIconPickerButtonsUI()
  if (affected.includes('claimMission') && state.screen === 'home') {
    patchHomeMissionClaimButtons()
  }
  if (affected.includes('garapon') && state.screen === 'garapon') {
    patchGaraponSpinButton()
  }
  if (affected.includes('exchange')) patchExchangeButtons()
}

function patchAccountCodeApplyUI() {
  const input = document.querySelector('[data-referral-input]')
  const applyBtn = document.querySelector('[data-account-action="apply-code"]')
  const busy = isLoading('applyCode')
  if (input) {
    input.disabled = busy
    input.setAttribute('aria-busy', busy ? 'true' : 'false')
  }
  if (applyBtn) {
    applyBtn.disabled = busy
    applyBtn.setAttribute('aria-busy', busy ? 'true' : 'false')
    const label = busy ? '処理中…' : 'コード入力'
    if (applyBtn.textContent !== label) applyBtn.textContent = label
  }
}

function patchAccountNicknameSaveUI() {
  const saveBtn = document.querySelector('[data-account-action="save-username"]')
  if (!saveBtn) return
  const busy = isLoading('saveNickname')
  saveBtn.disabled = busy
  saveBtn.setAttribute('aria-busy', busy ? 'true' : 'false')
  saveBtn.setAttribute('aria-disabled', busy ? 'true' : 'false')
  const label = busy ? '保存中…' : '保存'
  if (saveBtn.textContent !== label) saveBtn.textContent = label
}

function patchIconPickerButtonsUI() {
  const busy = isLoading('saveIcon')
  document.querySelectorAll('[data-icon-pick]').forEach((btn) => {
    btn.disabled = busy
    btn.setAttribute('aria-busy', busy ? 'true' : 'false')
  })
}

function patchHomeBoostModalButtons() {
  const yesBtn = document.querySelector('[data-modal-boost-yes]')
  const noBtn = document.querySelector('[data-modal-boost-no]')
  const busy = isLoading('boost')
  if (yesBtn) {
    yesBtn.disabled = busy
    yesBtn.setAttribute('aria-busy', busy ? 'true' : 'false')
  }
  if (noBtn) noBtn.disabled = busy
}

function patchHomeMissionClaimButtons() {
  const busy = isLoading('claimMission')
  document.querySelectorAll('[data-mission-claim]').forEach((btn) => {
    btn.disabled = busy
    btn.setAttribute('aria-busy', busy ? 'true' : 'false')
  })
  const claimAll = document.querySelector('[data-mission-claim-all]')
  if (claimAll) {
    const missions = getMissionsForTab(state.missionTab)
    const hasUnclaimed = missions.some((m) => isMissionCompleted(m) && !isMissionClaimed(m))
    claimAll.disabled = busy || !hasUnclaimed
    claimAll.setAttribute('aria-busy', busy ? 'true' : 'false')
  }
}

function patchGaraponSpinButton() {
  const btn = document.querySelector('[data-garapon-spin]')
  if (!btn) return
  const canSpin = state.pigTickets >= 5 && !isLoading('garapon')
  btn.disabled = !canSpin
  btn.setAttribute('aria-busy', isLoading('garapon') ? 'true' : 'false')
}

function patchExchangeButtons() {
  const busy = isLoading('exchange')
  document.querySelectorAll('[data-account-action="account-exchange"], [data-game-exchange]').forEach((btn) => {
    btn.disabled = busy
    btn.setAttribute('aria-busy', busy ? 'true' : 'false')
  })
}

function resetLoadingOnScreenChange(from, to) {
  console.log('[loading] reset on screen change', { from, to, state: formatLoadingStateBrief() })
  if (from === 'garapon' && to !== 'garapon' && isLoading('garapon') && !document.querySelector('.garapon-wheel-inner')) {
    setLoading('garapon', false, { silent: true })
  }
  patchLoadingUI()
}

function debugLoadingState() {
  console.log('[loading] state:', snapshotLoadingState(), {
    garaponSpinning: state.garaponSpinning,
    screen: state.screen,
    activeModal: state.activeModal,
  })
}

if (import.meta.env?.DEV) {
  window.debugLoadingState = debugLoadingState
}

// --- API通信共通化 ---
const API_USER_MESSAGES = {
  default: '通信に失敗しました。しばらくしてからお試しください。',
  network: '通信に失敗しました。しばらくしてからお試しください。',
  save: '保存に失敗しました。',
  applyCode: 'コードの適用に失敗しました。しばらくしてからお試しください。',
  fetchPoints: 'ポイント取得に失敗しました。',
  fetchPigTickets: 'チケット取得に失敗しました。',
  claimMission: 'ミッション報酬の受け取りに失敗しました。',
  rewardHistory: '履歴を読み込めませんでした。',
}

const apiDebugState = {
  lastError: null,
  recent: [],
  maxRecent: 40,
}

function pushApiLog(label, status, error = null) {
  apiDebugState.recent.push({
    label,
    status,
    at: new Date().toISOString(),
    error: error ? normalizeApiError(error) : null,
  })
  if (apiDebugState.recent.length > apiDebugState.maxRecent) {
    apiDebugState.recent.splice(0, apiDebugState.recent.length - apiDebugState.maxRecent)
  }
}

/** @returns {{ category: string, code: string, message: string, raw: * }} */
function normalizeApiError(error) {
  if (!error) return { category: 'unknown', code: '', message: '', raw: null }
  if (error.category && 'code' in error && 'message' in error) return error
  const code = String(error.code ?? error.status ?? error.statusCode ?? '').trim()
  const message = String(error.message ?? error).trim()
  const msgLower = message.toLowerCase()
  let category = 'unknown'
  if (code === '22P02' || msgLower.includes('invalid input syntax for type uuid')) {
    category = 'invalid_uuid'
  } else if (code === '23505' || code === '409') {
    category = 'duplicate'
  } else if (code === '400' || code.startsWith('PGRST')) {
    category = 'bad_request'
  } else if (
    code === '401' ||
    code === '403' ||
    msgLower.includes('rls') ||
    msgLower.includes('permission') ||
    msgLower.includes('jwt')
  ) {
    category = 'auth'
  } else if (
    msgLower.includes('failed to fetch') ||
    msgLower.includes('network') ||
    msgLower.includes('load failed') ||
    error.name === 'TypeError'
  ) {
    category = 'network'
  } else if (code === 'no_row' || code === 'PGRST116') {
    category = 'not_found'
  } else if (code === 'already_loading') {
    category = 'already_loading'
  }
  return { category, code, message, raw: error }
}

function logApiFailed(label, normalized) {
  console.warn(
    `[api] failed ${label}`,
    `[api:error] code=${normalized.code || '-'} message=${normalized.message || '-'} category=${normalized.category}`
  )
}

function isSupabaseResult(value) {
  return value != null && typeof value === 'object' && ('error' in value || 'data' in value)
}

/**
 * @param {string} label
 * @param {() => Promise<*>} fn Supabase の { data, error } または任意の値を返す
 * @param {{ silent?: boolean }} options
 * @returns {Promise<{ ok: boolean, data: *, error: * }>}
 */
async function runApi(label, fn, options = {}) {
  const { silent = false } = options
  if (!silent) {
    console.log(`[api] start ${label}`)
    pushApiLog(label, 'start')
  }
  try {
    const result = await fn()
    if (isSupabaseResult(result)) {
      if (result.error) {
        const normalized = normalizeApiError(result.error)
        logApiFailed(label, normalized)
        apiDebugState.lastError = { label, at: Date.now(), ...normalized }
        if (!silent) pushApiLog(label, 'failed', normalized)
        return { ok: false, data: result.data ?? null, error: normalized }
      }
      if (!silent) {
        console.log(`[api] success ${label}`)
        pushApiLog(label, 'success')
      }
      return { ok: true, data: result.data ?? null, error: null }
    }
    if (!silent) {
      console.log(`[api] success ${label}`)
      pushApiLog(label, 'success')
    }
    return { ok: true, data: result ?? null, error: null }
  } catch (error) {
    const normalized = normalizeApiError(error)
    console.error(`[api] exception ${label}`, error)
    apiDebugState.lastError = { label, at: Date.now(), ...normalized }
    if (!silent) pushApiLog(label, 'exception', normalized)
    return { ok: false, data: null, error: normalized }
  }
}

function getApiUserMessage(error, messageKey = 'default') {
  const norm = error?.category ? error : normalizeApiError(error)
  if (norm.category === 'already_loading') return null
  if (messageKey && API_USER_MESSAGES[messageKey]) return API_USER_MESSAGES[messageKey]
  if (norm.category === 'network') return API_USER_MESSAGES.network
  return API_USER_MESSAGES.default
}

function notifyApiFailure(error, messageKey = 'default') {
  const msg = getApiUserMessage(error, messageKey)
  if (msg) showToast({ type: 'error', message: msg, dedupeKey: `api:${messageKey}:${msg}` })
}

async function runApiWithLoading(loadingKey, label, fn, options = {}) {
  if (isLoading(loadingKey)) {
    console.log(`[api] skipped ${label} already loading`)
    pushApiLog(label, 'skipped')
    return {
      ok: false,
      data: null,
      error: normalizeApiError({ code: 'already_loading', message: 'already loading' }),
      skipped: true,
    }
  }
  return withLoading(loadingKey, () => runApi(label, fn, options), { skipPatch: options.skipPatch })
}

function debugApiState() {
  console.log('[api] debug', {
    lastError: apiDebugState.lastError,
    recent: apiDebugState.recent.slice(-15),
    loading: snapshotLoadingState(),
  })
}

if (import.meta.env?.DEV) {
  window.debugApiState = debugApiState
}

/** 獲得モーダル連続オープン防止（実機二重タップ等） */
let lastRewardPopupOpenedAt = 0
const REWARD_POPUP_OPEN_DEBOUNCE_MS = 500
/** render() 1回分だけ獲得シートの出現アニメを付与 */
let rewardSheetAnimThisRender = false
/** アカウント画面表示ごとに紹介者報酬同期を1回だけ試行 */
let accountReferrerSyncArmed = false
let lastReferrerRewardSyncAt = 0
let referrerRewardSyncWarned = false
const REFERRER_REWARD_SYNC_MIN_INTERVAL_MS = 60_000
let lastPauseResumeTapAt = 0
const PAUSE_RESUME_GUARD_MS = 300
const missionClaimLocks = new Set()

// --- 将来のインターステシャル広告用（今はダミー） ---
function showInterstitialAfterWorkEnd() {
  console.log('[ad:interstitial] work_end_home_return')
}
function showInterstitialOnAppLaunch() {
  console.log('[ad:interstitial] app_launch')
}
function showInterstitialAfterRouletteEvery3Spins() {
  console.log('[ad:interstitial] roulette_every_3_spins')
}

function preloadHomeBannerAdTask() {
  return preloadHomeBannerAd()
}

function preloadRewardedAds() {
  console.log('[ad:rewarded] preload start')
  console.log('[ad:rewarded] preload complete dummy')
}

function preloadInterstitialAds() {
  console.log('[ad:interstitial] preload start')
  console.log('[ad:interstitial] preload complete dummy')
}

function preloadOfferwallSdk() {
  console.log('[ad:offerwall] preload start')
  console.log('[ad:offerwall] preload complete dummy')
}

const bootStartedAt = performance.now()

function bootMsSinceStart() {
  return Math.round(performance.now() - bootStartedAt)
}

function bootDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runBootTask(label, fn) {
  const t0 = performance.now()
  try {
    const result = await fn()
    console.log(`[boot] ${label}`, { ok: true, ms: Math.round(performance.now() - t0) })
    return result
  } catch (e) {
    console.warn(`[boot] ${label}`, {
      ok: false,
      ms: Math.round(performance.now() - t0),
      error: e?.message || String(e),
    })
    return null
  }
}

function restoreWorkSessionIfNeeded() {
  if (state.isWorking && state.screen === 'work') {
    console.log('[boot] workSession restore', {
      screen: state.screen,
      phase: getWorkSessionPhase(),
      elapsedSec: state.elapsedSec,
    })
    return true
  }
  return false
}

async function loadMissionProgressLight() {
  if (
    !(state.missionDefinitions?.daily?.length ||
      state.missionDefinitions?.weekly?.length ||
      state.missionDefinitions?.monthly?.length ||
      state.missionDefinitions?.lifetime?.length)
  ) {
    await fetchMissionDefinitions()
  }
  await fetchMissionProgresses()
  if (state.screen === 'home' && document.querySelector('#app .home-viewport')) {
    patchHomeScreen()
  }
}

async function runBootLayer1() {
  console.log('[boot] layer1 start', { totalMs: bootMsSinceStart() })
  const layerStarted = performance.now()
  await runBootTask('homeBannerAd', preloadHomeBannerAdTask)
  await runBootTask('missionProgressLight', loadMissionProgressLight)
  console.log('[boot] layer1 end', {
    ms: Math.round(performance.now() - layerStarted),
    totalMs: bootMsSinceStart(),
  })
  void runBootLayer2()
}

async function runBootLayer2() {
  await bootDelay(1000)
  console.log('[boot] layer2 start', { totalMs: bootMsSinceStart() })
  const layerStarted = performance.now()
  await Promise.all([
    runBootTask('rewardedAdPreload', preloadRewardedAds),
    runBootTask('interstitialPreload', preloadInterstitialAds),
  ])
  if (
    !(state.missionDefinitions?.daily?.length ||
      state.missionDefinitions?.weekly?.length ||
      state.missionDefinitions?.monthly?.length ||
      state.missionDefinitions?.lifetime?.length)
  ) {
    await runBootTask('missionDefinitions', fetchMissionDefinitions)
  }
  await runBootTask('ensureMissionProgresses', ensureMissionProgressesForActiveMissions)
  await runBootTask('missionProgresses', fetchMissionProgresses)
  await runBootTask('referrerCursor', seedReferrerRewardLogCursor)
  await runBootTask('referrerSync', syncReferrerRewardNotifications)
  await runBootTask('defaultIcons', () => ensureDefaultIconsForUser(state.userId))
  await runBootTask('username', fetchUsernameFromSupabase)
  await runBootTask('rouletteEligible', () => refreshRouletteEligibleIconsCache(state.userId))
  showInterstitialOnAppLaunch()
  if (state.screen === 'home' && document.querySelector('#app .home-viewport')) {
    patchHomeScreen()
  }
  console.log('[boot] layer2 end', {
    ms: Math.round(performance.now() - layerStarted),
    totalMs: bootMsSinceStart(),
  })
  void runBootLayer3()
}

async function runBootLayer3() {
  await bootDelay(2000)
  console.log('[boot] layer3 start', { totalMs: bootMsSinceStart() })
  const layerStarted = performance.now()
  await runBootTask('offerwallSdk', preloadOfferwallSdk)
  console.log('[boot] layer3 end', {
    ms: Math.round(performance.now() - layerStarted),
    totalMs: bootMsSinceStart(),
  })
  console.log('[boot] complete', { totalMs: bootMsSinceStart(), userId: state.userId })
}
let rouletteSpinCountForInterstitial = 0
let pendingRouletteInterstitialAfterRewardClose = false

/**
 * 将来のリワード広告（例: AdMob）差し替え用。実SDKは入れない。
 * 視聴完了扱いのときのみ true を返す想定。
 * @returns {Promise<boolean>}
 */
async function showRewardedAdFor80Points() {
  console.log('[ad:rewarded] 80_points start')
  console.log('[ad:rewarded] 80_points complete dummy')
  return true
}

/**
 * 将来のリワード広告（例: AdMob）差し替え用。実SDKは入れない。
 * @returns {Promise<boolean>}
 */
async function showRewardedAdForBoost() {
  console.log('[ad:rewarded] boost start')
  console.log('[ad:rewarded] boost complete dummy')
  return true
}

const TOOL_CHECK_PREPARE_MS = 3000
const TOOL_CHECK_MAX_MS = 12000
const TOOL_CHECK_INTERVAL_MS = 1000
const TOOL_CHECK_SUCCESS_UI_MS = 900
const TOOL_CHECK_JPEG_QUALITY = 0.85

/** 作業 running 中の動き判定: HAND_CHECK_INTERVAL_SECONDS（5分）ごと */
const MOTION_CHECK_INTERVAL_MS = HAND_CHECK_INTERVAL_SECONDS * 1000
const MOTION_CHECK_WINDOW_MS = 10 * 1000
const MOTION_SAMPLE_INTERVAL_MS = 200
/** キャプチャ長辺（px）。小さめでパフォーマンス優先 */
const MOTION_CAPTURE_MAX_SIDE = 96
/** ピクセルごとに |ΔR|+|ΔG|+|ΔB| がこれを超えたら「変化あり」とみなす */
const MOTION_PIXEL_CHANNEL_DELTA_SUM = 42
/** 変化ピクセルが全体のこの割合を超えたら 1 サンプルで動きあり */
const MOTION_CHANGED_PIXEL_RATIO_THRESHOLD = 0.025

let toolCheckPrepareTimeoutId = null
let toolCheckIntervalId = null
let toolCheckHardStopTimeoutId = null
let toolCheckSuccessClearTimeoutId = null
let toolCheckTickBusy = false

/** @type {ReturnType<typeof setTimeout>|null} 次の動き判定までのスケジュール */
let motionCheckTimeoutId = null
/** @type {ReturnType<typeof setInterval>|null} 判定ウィンドウ内のフレームサンプリング */
let motionCheckIntervalId = null
/** @type {ReturnType<typeof setTimeout>|null} 判定ウィンドウ（10秒）終了 */
let motionCheckWindowTimeoutId = null
let isMotionChecking = false
/** @type {Uint8ClampedArray|null} 直前フレームの ImageData.data（差分用） */
let lastMotionFrameData = null
/** @type {number|null} 直近で完了した動き判定の終了時刻（epoch ms） */
let lastMotionCheckAt = null

/** 作業終了時に +1 するデイリーミッションの mission_key 候補（Supabase `missions` と一致させる） */
const DAILY_WORK_SESSION_MISSION_KEYS = ['daily_study', 'daily_work']

function getTodayKey() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

/** 今週の月曜日（ローカル日付）を YYYY-MM-DD で返す（ウィークリーミッションの区切り） */
function getWeekStartKey() {
  const d = new Date()
  const day = d.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diffToMonday)
  monday.setHours(0, 0, 0, 0)
  return (
    monday.getFullYear() +
    '-' +
    String(monday.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(monday.getDate()).padStart(2, '0')
  )
}

function getWeekDateKeys() {
  const [y, mo, da] = getWeekStartKey().split('-').map(Number)
  const monday = new Date(y, mo - 1, da)
  const keys = []
  for (let i = 0; i < 7; i++) {
    const x = new Date(monday)
    x.setDate(monday.getDate() + i)
    keys.push(
      x.getFullYear() +
        '-' +
        String(x.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(x.getDate()).padStart(2, '0')
    )
  }
  return keys
}

function getMonthKey() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
}

function getIsoWeekInfo(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
  return { year: d.getUTCFullYear(), week }
}

function countWorkDaysThisWeek() {
  const log = getWorkLog()
  return getWeekDateKeys().filter((k) => (log[k] || 0) > 0).length
}

function countDiaryDaysThisWeek() {
  const diaries = getDiaries()
  return getWeekDateKeys().filter((k) => String(diaries[k] || '').trim().length > 0).length
}

function countLoginDaysThisWeek() {
  const days = getLoginDays()
  return getWeekDateKeys().filter((k) => days[k]).length
}

function getWeekTotalWorkSec() {
  const log = getWorkLog()
  return getWeekDateKeys().reduce((sum, k) => sum + (log[k] || 0), 0)
}

function getHourglassEarnedLog() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.hourglassEarnedLog)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function addHourglassEarned(dateKey, amount) {
  if (amount <= 0) return
  const log = getHourglassEarnedLog()
  log[dateKey] = (log[dateKey] || 0) + amount
  localStorage.setItem(STORAGE_KEYS.hourglassEarnedLog, JSON.stringify(log))
  const total = Math.max(0, parseInt(localStorage.getItem(STORAGE_KEYS.hourglassEarnedTotal) || '0', 10))
  localStorage.setItem(STORAGE_KEYS.hourglassEarnedTotal, String(total + amount))
}

function getHourglassEarnedOn(dateKey) {
  const log = getHourglassEarnedLog()
  return log[dateKey] || 0
}

function getHourglassEarnedThisWeek() {
  const log = getHourglassEarnedLog()
  return getWeekDateKeys().reduce((sum, k) => sum + (log[k] || 0), 0)
}

function getHourglassEarnedThisMonth() {
  const log = getHourglassEarnedLog()
  const prefix = getMonthKey() + '-'
  return Object.entries(log).reduce((sum, [key, count]) => (key.startsWith(prefix) ? sum + count : sum), 0)
}

function getHourglassEarnedTotal() {
  const n = parseInt(localStorage.getItem(STORAGE_KEYS.hourglassEarnedTotal) || '0', 10)
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

function getConsecutiveHourglassEarnDays() {
  const log = getHourglassEarnedLog()
  let count = 0
  let d = new Date()
  for (let i = 0; i < 366; i++) {
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    if ((log[key] || 0) > 0) {
      count++
      d.setDate(d.getDate() - 1)
    } else {
      break
    }
  }
  return count
}

function isGameGiftClaimedToday() {
  return state.gameGiftClaimDate === getTodayKey()
}
function escapeHtml(s) {
  const div = document.createElement('div')
  div.textContent = s
  return div.innerHTML
}

/** 入力・DB 値を users.username 用に正規化（空は 名無し、最大 USERNAME_MAX_LEN） */
function normalizeUsernameForStorage(raw) {
  const s = String(raw ?? '').trim()
  if (s.length === 0) return DEFAULT_USERNAME
  return s.length > USERNAME_MAX_LEN ? s.slice(0, USERNAME_MAX_LEN) : s
}

function markRegistrationComplete() {
  try {
    localStorage.setItem(STORAGE_KEYS.registrationComplete, 'true')
  } catch {
    /* ignore */
  }
}

function isRegistrationComplete() {
  try {
    return localStorage.getItem(STORAGE_KEYS.registrationComplete) === 'true'
  } catch {
    return false
  }
}

function normalizeReferralCodeInput(raw) {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
}

function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  const bytes = new Uint8Array(7)
  crypto.getRandomValues(bytes)
  for (let i = 0; i < 7; i++) {
    code += chars[bytes[i] % chars.length]
  }
  return code
}

async function ensureReferralCode(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('referral_code')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (data?.referral_code) return data.referral_code

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateReferralCode()
    const { data: updated, error: updateError } = await supabase
      .from('users')
      .update({ referral_code: code })
      .eq('user_id', userId)
      .select('referral_code')
      .maybeSingle()
    if (!updateError && updated?.referral_code) return updated.referral_code
    if (updateError?.code !== '23505') throw updateError
  }
  throw new Error('referral_code generation failed')
}

async function fetchReferralAlreadyApplied(referredUserId) {
  const { data, error } = await supabase
    .from('referrals')
    .select('id')
    .eq('referred_user_id', referredUserId)
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return !!data
}

async function countReferrerRewardedReferrals(referrerUserId) {
  const { count, error } = await supabase
    .from('referrals')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_user_id', referrerUserId)
    .eq('reward_granted', true)
  if (error) throw error
  return count ?? 0
}

async function saveRewardLogForUser(userId, rewardType, amount, note = '') {
  if (!REWARD_TYPES.has(rewardType)) {
    console.warn('[api] saveRewardLog unknown_reward_type', { rewardType })
  }
  const res = await runApi(
    'saveRewardLog',
    () =>
      supabase
        .from('reward_logs')
        .insert({
          user_id: userId,
          reward_type: rewardType,
          amount,
          note: note ?? '',
        })
        .select('id')
        .maybeSingle(),
    { silent: true }
  )
  if (!res.ok) throw res.error?.raw ?? new Error(res.error?.message || 'saveRewardLog failed')
  return res
}

/** ポイント増減時の有効期限フィールド（last_point_activity_at / points_expire_at） */
function getPointsExpireFields() {
  const now = new Date()
  const expiresAt = new Date(now.getTime())
  expiresAt.setUTCDate(expiresAt.getUTCDate() + POINTS_EXPIRE_DAYS)
  return {
    last_point_activity_at: now.toISOString(),
    points_expire_at: expiresAt.toISOString(),
  }
}

/** points 行の point 更新と同時に有効期限を更新（savePoints / addPointsForUser 共通） */
async function updatePointsRowWithExpire({ point, rowId, userId }) {
  console.log('[pointsExpire] update start')
  const targetId = rowId ?? state.pointsRowId
  const uid = userId ?? (state.userId || getUserId())
  const updatePayload = {
    point,
    ...getPointsExpireFields(),
  }
  try {
    const q = supabase
      .from('points')
      .update(updatePayload)
      .select('id, user_id, point, last_point_activity_at, points_expire_at')

    const { data: updatedRows, error } =
      targetId != null
        ? await q.eq('id', targetId)
        : await q.eq('user_id', uid).order('id', { ascending: true }).limit(1)

    if (error) {
      console.error('[pointsExpire] update failed', error)
      return { ok: false, error }
    }
    const updateRow = Array.isArray(updatedRows) ? (updatedRows[0] ?? null) : updatedRows
    if (!updateRow) {
      const noRowError = new Error('no row updated')
      console.error('[pointsExpire] update failed', noRowError)
      return { ok: false, error: noRowError }
    }
    console.log('[pointsExpire] update success', {
      pointsRowId: updateRow.id,
      point: updateRow.point,
      last_point_activity_at: updateRow.last_point_activity_at,
      points_expire_at: updateRow.points_expire_at,
    })
    return { ok: true, row: updateRow }
  } catch (e) {
    console.error('[pointsExpire] update failed', e)
    return { ok: false, error: e }
  }
}

async function addPointsForUser(targetUserId, amount, rewardType = 'manual_adjust', note = '') {
  const addAmount = Math.floor(Number(amount) || 0)
  if (!Number.isFinite(addAmount) || addAmount <= 0) return

  const { data: rows, error: selectError } = await supabase
    .from('points')
    .select('id, point')
    .eq('user_id', targetUserId)
    .order('id', { ascending: true })
    .limit(1)
  if (selectError) throw selectError

  let row = rows?.[0] ?? null
  if (!row) {
    const { data: inserted, error: insertError } = await supabase
      .from('points')
      .insert({ user_id: targetUserId, point: 0 })
      .select('id, point')
      .maybeSingle()
    if (insertError) throw insertError
    row = inserted
  }
  if (!row?.id) throw new Error('points row missing')

  const nextPoint = (Number(row.point) || 0) + addAmount
  const updateResult = await updatePointsRowWithExpire({
    point: nextPoint,
    rowId: row.id,
    userId: targetUserId,
  })
  if (!updateResult.ok) throw updateResult.error

  await saveRewardLogForUser(targetUserId, rewardType, addAmount, note)
}

async function loadReferralAccountData() {
  if (state.referralCodeLoading) return
  state.referralCodeLoading = true
  console.log('[referral] load code start')
  try {
    const userId = state.userId || getUserId()
    const code = await ensureReferralCode(userId)
    state.referralCode = code
    state.referralAlreadyApplied = await fetchReferralAlreadyApplied(userId)
    console.log('[referral] load code success', { userId, code, applied: state.referralAlreadyApplied })
  } catch (e) {
    console.error('[referral] load code failed', e)
  } finally {
    state.referralCodeLoading = false
    if (state.screen === 'account') render()
  }
}

/** @returns {'success'|'abort'|'not_referral'} */
async function tryApplyReferralCode(code) {
  console.log('[code] try referral')
  const userId = state.userId || getUserId()
  if (!isRegistrationComplete()) {
    showToast('ニックネーム登録後に招待コードを適用できます')
    return 'abort'
  }

  const myCode = state.referralCode || (await ensureReferralCode(userId))
  state.referralCode = myCode
  if (code === myCode) {
    console.log('[referral] self referral blocked')
    showToast('自分の招待コードは使えません')
    return 'abort'
  }

  const referrerRes = await runApi('applyReferral.lookupReferrer', () =>
    supabase.from('users').select('user_id, referral_code').eq('referral_code', code).maybeSingle()
  )
  if (!referrerRes.ok) throw referrerRes.error?.raw ?? new Error(referrerRes.error?.message)
  const referrer = referrerRes.data
  if (!referrer?.user_id) return 'not_referral'

  if (state.referralAlreadyApplied || (await fetchReferralAlreadyApplied(userId))) {
    state.referralAlreadyApplied = true
    console.log('[referral] already applied')
    showToast('すでに招待コードを適用済みです')
    render()
    return 'abort'
  }

  const rewardedCount = await countReferrerRewardedReferrals(referrer.user_id)
  const referrerRewardPoints =
    rewardedCount < REFERRAL_MAX_REFERRER_REWARDS ? REFERRAL_REFERRER_REWARD_POINTS : 0
  const referredRewardPoints = REFERRAL_REFERRED_REWARD_POINTS

  const referralInsertRes = await runApi('applyReferral.insertReferral', () =>
    supabase
      .from('referrals')
      .insert({
        referrer_user_id: referrer.user_id,
        referred_user_id: userId,
        referral_code: code,
        referrer_reward_points: referrerRewardPoints,
        referred_reward_points: referredRewardPoints,
        status: 'completed',
        reward_granted: false,
      })
      .select('id')
      .maybeSingle()
  )
  const insertError = referralInsertRes.ok ? null : referralInsertRes.error?.raw

  if (!referralInsertRes.ok) {
    if (referralInsertRes.error?.code === '23505' || insertError?.code === '23505') {
      state.referralAlreadyApplied = true
      console.log('[referral] already applied')
      showToast('すでに招待コードを適用済みです')
      render()
      return 'abort'
    }
    throw insertError ?? referralInsertRes.error
  }
  const referralRow = referralInsertRes.data
  if (!referralRow?.id) throw new Error('referral insert returned no id')

  await addPoints(referredRewardPoints, 'referral_referred', '友達招待（被紹介）', { skipRender: true })
  console.log('[referral] reward referred success')

  if (referrerRewardPoints > 0) {
    await addPointsForUser(referrer.user_id, referrerRewardPoints, 'referral_referrer', '友達招待（紹介）')
    console.log('[referral] reward referrer success')
  }

  const grantRes = await runApi('applyReferral.grantFlag', () =>
    supabase
      .from('referrals')
      .update({ reward_granted: true })
      .eq('id', referralRow.id)
      .eq('reward_granted', false)
  )
  if (!grantRes.ok) throw grantRes.error?.raw ?? new Error(grantRes.error?.message)

  state.referralAlreadyApplied = true
  state.referralPanelOpen = false
  console.log('[code] referral success')
  openRewardPopupWithGuard({ type: 'points', amount: referredRewardPoints }, MODAL_TYPES.REFERRAL_REWARD)
  render()
  return 'success'
}

function normalizeGiftCodeRewardType(rewardType) {
  const t = String(rewardType || '').trim().toLowerCase()
  if (t === 'point') return 'points'
  if (t === 'pig_ticket') return 'pig_tickets'
  return t
}

function isGiftCodeIconReward(rewardType) {
  return normalizeGiftCodeRewardType(rewardType) === 'icon'
}

function isGiftCodePointsReward(rewardType) {
  return normalizeGiftCodeRewardType(rewardType) === 'points'
}

function isGiftCodePigTicketsReward(rewardType) {
  return normalizeGiftCodeRewardType(rewardType) === 'pig_tickets'
}

async function applyGiftCode(code) {
  const userId = state.userId || getUserId()
  const giftRes = await runApi('applyGiftCode.fetch', () =>
    supabase
      .from('gift_codes')
      .select(
        'id, code, reward_type, reward_amount, reward_icon_key, max_uses, used_count, starts_at, expires_at, is_active'
      )
      .eq('code', code)
      .maybeSingle()
  )
  if (!giftRes.ok) {
    console.error('[giftCode] fetch failed', giftRes.error)
    throw giftRes.error?.raw ?? new Error(giftRes.error?.message)
  }
  const giftRow = giftRes.data
  if (!giftRow) {
    console.log('[giftCode] invalid')
    showToast('無効なコードです')
    return
  }

  if (!giftRow.is_active) {
    console.log('[giftCode] inactive')
    showToast('無効なコードです')
    return
  }

  const now = Date.now()
  if (giftRow.starts_at && new Date(giftRow.starts_at).getTime() > now) {
    console.log('[giftCode] invalid')
    showToast('無効なコードです')
    return
  }
  if (giftRow.expires_at && new Date(giftRow.expires_at).getTime() < now) {
    console.log('[giftCode] expired')
    showToast('このコードは期限切れです')
    return
  }

  const maxUses = giftRow.max_uses == null ? null : Number(giftRow.max_uses)
  const usedCount = Number(giftRow.used_count) || 0
  if (maxUses != null && Number.isFinite(maxUses) && usedCount >= maxUses) {
    console.log('[giftCode] max uses reached')
    showToast('このコードは上限に達しました')
    return
  }

  const redemptionCheckRes = await runApi('applyGiftCode.checkRedemption', () =>
    supabase
      .from('gift_code_redemptions')
      .select('id')
      .eq('user_id', userId)
      .eq('gift_code_id', giftRow.id)
      .maybeSingle()
  )
  if (!redemptionCheckRes.ok) {
    console.error('[giftCode] redemption check failed', redemptionCheckRes.error)
    throw redemptionCheckRes.error?.raw ?? new Error(redemptionCheckRes.error?.message)
  }
  if (redemptionCheckRes.data) {
    console.log('[giftCode] already used')
    showToast('このコードはすでに使用済みです')
    return
  }

  const rewardType = normalizeGiftCodeRewardType(giftRow.reward_type)
  const rewardAmount = Math.floor(Number(giftRow.reward_amount) || 0)
  const rewardIconKey = String(giftRow.reward_icon_key || '').trim()

  if (isGiftCodeIconReward(rewardType)) {
    if (!rewardIconKey) {
      console.log('[giftCode] invalid icon reward')
      showToast('無効なコードです')
      return
    }
    const masterRes = await runApi('applyGiftCode.iconMaster', () =>
      supabase.from('icon_master').select('icon_key, is_active').eq('icon_key', rewardIconKey).maybeSingle()
    )
    if (!masterRes.ok) {
      console.error('[giftCode] icon master fetch failed', masterRes.error)
      throw masterRes.error?.raw ?? new Error(masterRes.error?.message)
    }
    if (!masterRes.data?.icon_key || masterRes.data.is_active !== true) {
      console.log('[giftCode] invalid icon master')
      showToast('無効なコードです')
      return
    }
  } else if (isGiftCodePointsReward(rewardType) || isGiftCodePigTicketsReward(rewardType)) {
    if (rewardAmount <= 0) {
      console.log('[giftCode] invalid')
      showToast('無効なコードです')
      return
    }
  } else {
    console.log('[giftCode] invalid reward_type', { rewardType })
    showToast('無効なコードです')
    return
  }

  const redemptionInsertRes = await runApi('applyGiftCode.insertRedemption', () =>
    supabase.from('gift_code_redemptions').insert({
      user_id: userId,
      gift_code_id: giftRow.id,
      code: giftRow.code,
      reward_type: rewardType,
      reward_amount: rewardAmount,
    })
  )
  if (!redemptionInsertRes.ok) {
    if (redemptionInsertRes.error?.code === '23505') {
      console.log('[giftCode] already used')
      showToast('このコードはすでに使用済みです')
      return
    }
    console.error('[giftCode] redemption insert failed', redemptionInsertRes.error)
    throw redemptionInsertRes.error?.raw ?? new Error(redemptionInsertRes.error?.message)
  }
  console.log('[giftCode] redemption saved')

  if (isGiftCodeIconReward(rewardType)) {
    const grantRes = await grantIconToUser(userId, rewardIconKey, 'gift_code', giftRow.code)
    if (!grantRes.ok) {
      console.error('[giftCode] icon grant failed', grantRes.error)
      throw grantRes.error?.raw ?? new Error(grantRes.error?.message ?? 'icon grant failed')
    }
    if (grantRes.granted) {
      openRewardPopupWithGuard(
        {
          type: 'icon',
          iconKey: rewardIconKey,
          granted: true,
          message: '限定アイコンを獲得しました',
        },
        MODAL_TYPES.GIFT_SUCCESS
      )
      console.log('[giftCode] reward icon success', { iconKey: rewardIconKey })
    } else {
      console.log('[giftCode] reward icon already owned', { iconKey: rewardIconKey })
      showToast('すでに所持しています')
    }
  } else if (isGiftCodePointsReward(rewardType)) {
    openRewardPopupWithGuard({ type: 'points', amount: rewardAmount }, MODAL_TYPES.GIFT_SUCCESS)
    await addPoints(rewardAmount, 'gift_code', `ギフトコード:${giftRow.code}`, { skipRender: true })
    console.log('[giftCode] reward points success')
    showToast(`ギフトコードで${rewardAmount.toLocaleString()}ptを獲得しました`)
  } else {
    openRewardPopupWithGuard({ type: 'ticket', amount: rewardAmount }, MODAL_TYPES.GIFT_SUCCESS)
    await addPigTickets(rewardAmount, 'gift_code', `ギフトコード:${giftRow.code}`, { skipRender: true })
    console.log('[giftCode] reward pig tickets success')
    showToast(`ギフトコードで豚チケット${rewardAmount}枚を獲得しました`)
  }

  const countRes = await runApi('applyGiftCode.updateUsedCount', () =>
    supabase
      .from('gift_codes')
      .update({
        used_count: usedCount + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', giftRow.id)
  )
  if (!countRes.ok) {
    console.error('[giftCode] used_count update failed', countRes.error)
    throw countRes.error?.raw ?? new Error(countRes.error?.message)
  }
  console.log('[giftCode] used_count updated')

  state.referralPanelOpen = false
  console.log('[giftCode] apply success')
  if (state.screen === 'account' && document.querySelector('#app .account-screen')) {
    removeModalOverlay(MODAL_TYPES.CODE)
    patchAccountScreen()
  } else {
    render()
  }
}

async function applyCodeInput(rawInput) {
  return withLoading('applyCode', async () => {
    console.log('[code] apply start')
    const code = normalizeReferralCodeInput(rawInput)
    if (!code) {
      showToast('コードを入力してください')
      return
    }

    const referralResult = await tryApplyReferralCode(code)
    if (referralResult === 'success' || referralResult === 'abort') return

    console.log('[code] try gift')
    await applyGiftCode(code)
  }).catch((e) => {
    console.error('[giftCode] apply failed', e)
    notifyApiFailure(e, 'applyCode')
  })
}

function normalizeRewardPopupItems(rewardPopup) {
  if (!rewardPopup) return []
  if (Array.isArray(rewardPopup.items)) {
    return rewardPopup.items
      .map((x) => ({
        type: x?.type,
        amount: Number(x?.amount),
        iconKey: x?.iconKey,
        granted: x?.granted,
        message: x?.message,
      }))
      .filter((x) => {
        if (x.type === 'icon') return !!x.granted && !!x.iconKey
        return (x.type === 'points' || x.type === 'ticket') && Number.isFinite(x.amount) && x.amount > 0
      })
  }
  if (rewardPopup.type === 'icon' && rewardPopup.granted && rewardPopup.iconKey) {
    return [{
      type: 'icon',
      iconKey: rewardPopup.iconKey,
      granted: true,
      message: rewardPopup.message,
    }]
  }
  const amount = Number(rewardPopup.amount)
  if ((rewardPopup.type === 'points' || rewardPopup.type === 'ticket') && Number.isFinite(amount) && amount > 0) {
    return [{ type: rewardPopup.type, amount }]
  }
  return []
}

function buildRewardModalOverlayHtml(
  rewardPopup,
  overlayAttr = 'data-global-reward-overlay',
  closeAttr = 'data-global-reward-close',
  closeExtraAttrs = '',
  modalType = null
) {
  if (!rewardPopup) return ''
  const rewardType = modalType || state.activeModal || MODAL_TYPES.REWARD
  const closeBtnAttrs = closeExtraAttrs ? `${closeAttr} ${closeExtraAttrs}` : closeAttr
  return `
    <div class="modal-overlay modal-overlay--reward app-modal-overlay app-modal-open modal-open" data-modal-overlay data-modal-type="${rewardType}" ${overlayAttr}>
      <div class="modal-content modal-content--reward app-modal-content">
        <div class="reward-sheet${rewardSheetEntryClass()}">
          ${buildRewardSheetTopHtml(rewardPopup)}
          <div class="reward-sheet-banner" data-ad-placement="${AD_PLACEMENTS.BANNER_REWARD_MODAL}" role="img" aria-label="広告エリア">
            <span class="ad-banner-dummy">300x250 banner</span>
          </div>
          <button class="reward-sheet-close" type="button" ${closeBtnAttrs}>閉じる</button>
        </div>
      </div>
    </div>
  `
}

function buildAccountRewardOverlayHtml(rewardPopup) {
  return buildRewardModalOverlayHtml(
    rewardPopup,
    'data-account-reward-overlay',
    'data-account-reward-close',
    'data-account-action="close-account-reward" data-modal-action="close" data-modal-type="reward"',
    state.activeModal || MODAL_TYPES.REWARD
  )
}

function bindRewardModalOverlay(app, overlayAttr, closeAttr) {
  const overlay = app.querySelector(`[${overlayAttr}]`)
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal()
    })
  }
  app.querySelector(`[${closeAttr}]`)?.addEventListener('click', () => closeModal())
}

function buildRewardSheetTopHtml(rewardPopup) {
  const items = normalizeRewardPopupItems(rewardPopup)
  if (items.length === 0) return ''
  const hasIcon = items.some((item) => item.type === 'icon')
  const hasPoints = items.some((item) => item.type === 'points')
  const topClassExtra =
    items.length > 1
      ? ` reward-sheet-top--multi${hasIcon && hasPoints ? ' reward-sheet-top--icon-points' : ''}`
      : ''
  return `<div class="reward-sheet-top${topClassExtra}">
    ${items
      .map((item) => {
        if (item.type === 'icon') {
          const src = resolveIconAssetPath(item.iconKey, null)
          return `<div class="reward-sheet-item reward-sheet-item--icon">
      <div class="reward-sheet-icon-wrap reward-sheet-icon-wrap--icon">
        <img src="${escapeHtml(src)}" class="reward-sheet-icon reward-sheet-icon--icon" alt="">
      </div>
      <p class="reward-sheet-message">${escapeHtml(item.message || '新しいアイコンを獲得しました')}</p>
    </div>`
        }
        return `<div class="reward-sheet-item">
      <div class="reward-sheet-icon-wrap">
        <img src="${item.type === 'points' ? '/assets/220.svg' : '/assets/31.svg'}" class="reward-sheet-icon reward-sheet-icon--${item.type === 'points' ? 'points' : 'ticket'}" alt="">
      </div>
      <div class="reward-sheet-amount">${item.amount}</div>
    </div>`
      })
      .join('')}
  </div>`
}

function rewardSheetEntryClass() {
  return rewardSheetAnimThisRender ? '' : ' reward-sheet--stable'
}

/** 今回の DOM 更新で獲得シートの下からスライド入場を再生する（1回だけ消費） */
function consumeRewardSheetEntryAnim() {
  const wants = !!(state.rewardPopup && state.rewardPopupNeedsEntryAnim)
  rewardSheetAnimThisRender = wants
  if (wants) state.rewardPopupNeedsEntryAnim = false
  return wants
}

/** insertAdjacentHTML 直後など、初回ペイント前に CSS 入場アニメを確実に走らせる */
function kickRewardSheetEntryAnim(overlayRoot) {
  const sheet = overlayRoot?.querySelector?.('.reward-sheet')
  if (!sheet || sheet.classList.contains('reward-sheet--stable')) return
  sheet.classList.add('reward-sheet--stable')
  void sheet.offsetHeight
  requestAnimationFrame(() => {
    sheet.classList.remove('reward-sheet--stable')
  })
}

/** 共通モーダル種別（activeModal と data-modal-type で使用） */
const MODAL_TYPES = Object.freeze({
  CODE: 'code',
  NICKNAME: 'nickname',
  REWARD: 'reward',
  REFERRAL_REWARD: 'referralReward',
  GIFT_SUCCESS: 'giftSuccess',
  MISSION: 'mission',
  BOOST: 'boost',
  MESSAGE: 'message',
  GARAPON_HELP: 'garaponHelp',
  MISSION_PANEL: 'missionPanel',
  ICON: 'icon',
})

const REWARD_LIKE_MODAL_TYPES = new Set([
  MODAL_TYPES.REWARD,
  MODAL_TYPES.REFERRAL_REWARD,
  MODAL_TYPES.GIFT_SUCCESS,
  MODAL_TYPES.MISSION,
])

let isModalOpenInProgress = false

function isRewardLikeModalType(type) {
  return REWARD_LIKE_MODAL_TYPES.has(type)
}

function inferActiveModalType() {
  if (state.activeModal) return state.activeModal
  if (state.referralPanelOpen) return MODAL_TYPES.CODE
  if (state.nicknameModalOpen) return MODAL_TYPES.NICKNAME
  if (state.iconModalOpen) return MODAL_TYPES.ICON
  if (state.boostConfirmOpen) return MODAL_TYPES.BOOST
  if (state.modalMessage) return MODAL_TYPES.MESSAGE
  if (state.missionScreenOpen) return MODAL_TYPES.MISSION_PANEL
  if (state.garaponHelpOpen) return MODAL_TYPES.GARAPON_HELP
  if (state.rewardPopup) return MODAL_TYPES.REWARD
  return null
}

function isModalOpen(type) {
  if (type) {
    if (state.activeModal === type) return true
    switch (type) {
      case MODAL_TYPES.CODE:
        return state.referralPanelOpen
      case MODAL_TYPES.NICKNAME:
        return state.nicknameModalOpen
      case MODAL_TYPES.ICON:
        return state.iconModalOpen
      case MODAL_TYPES.BOOST:
        return state.boostConfirmOpen
      case MODAL_TYPES.MESSAGE:
        return !!state.modalMessage
      case MODAL_TYPES.MISSION_PANEL:
        return state.missionScreenOpen
      case MODAL_TYPES.GARAPON_HELP:
        return state.garaponHelpOpen
      default:
        if (isRewardLikeModalType(type)) return !!state.rewardPopup
        return false
    }
  }
  return !!inferActiveModalType()
}

function syncLegacyModalFlagsFromActive(type, payload) {
  state.referralPanelOpen = type === MODAL_TYPES.CODE
  state.nicknameModalOpen = type === MODAL_TYPES.NICKNAME
  state.iconModalOpen = type === MODAL_TYPES.ICON
  state.boostConfirmOpen = type === MODAL_TYPES.BOOST
  state.missionScreenOpen = type === MODAL_TYPES.MISSION_PANEL
  state.garaponHelpOpen = type === MODAL_TYPES.GARAPON_HELP
  state.modalMessage =
    type === MODAL_TYPES.MESSAGE ? (typeof payload === 'string' ? payload : payload?.message ?? '') : null
  if (isRewardLikeModalType(type)) {
    state.rewardPopup = payload ?? null
    state.rewardPopupNeedsEntryAnim = true
  }
}

function clearModalStateForType(type) {
  switch (type) {
    case MODAL_TYPES.CODE:
      state.referralPanelOpen = false
      break
    case MODAL_TYPES.NICKNAME:
      state.nicknameModalOpen = false
      break
    case MODAL_TYPES.ICON:
      state.iconModalOpen = false
      state.userIconsLoading = false
      break
    case MODAL_TYPES.BOOST:
      state.boostConfirmOpen = false
      break
    case MODAL_TYPES.MESSAGE:
      state.modalMessage = null
      break
    case MODAL_TYPES.MISSION_PANEL:
      state.missionScreenOpen = false
      break
    case MODAL_TYPES.GARAPON_HELP:
      state.garaponHelpOpen = false
      break
    default:
      if (!type || isRewardLikeModalType(type)) {
        state.rewardPopup = null
        state.rewardPopupNeedsEntryAnim = false
      }
      break
  }
  if (!type || state.activeModal === type) {
    state.activeModal = null
    state.modalPayload = null
  }
}

function clearAllModalState() {
  state.activeModal = null
  state.modalPayload = null
  state.referralPanelOpen = false
  state.nicknameModalOpen = false
  state.iconModalOpen = false
  state.userIconsLoading = false
  state.boostConfirmOpen = false
  state.modalMessage = null
  state.missionScreenOpen = false
  state.garaponHelpOpen = false
  state.rewardPopup = null
  state.rewardPopupNeedsEntryAnim = false
}

/** 共通 overlay 種別（獲得履歴・ミッション一覧・ガラポンヘルプ等） */
const OVERLAY_EXTRA_TYPES = Object.freeze({
  MISSION_PANEL: MODAL_TYPES.MISSION_PANEL,
  REWARD_HISTORY: 'rewardHistory',
  GARAPON_HELP: MODAL_TYPES.GARAPON_HELP,
})

const REWARD_OVERLAY_SELECTORS = [
  '[data-account-reward-overlay]',
  '[data-global-reward-overlay]',
  '[data-game-reward-overlay]',
  '[data-garapon-modal-overlay]',
  '#app > .modal-overlay.modal-overlay--reward[data-modal-overlay]',
]

const OVERLAY_SELECTORS_BY_TYPE = {
  [MODAL_TYPES.CODE]: ['[data-referral-overlay]', '.referral-modal-overlay'],
  [MODAL_TYPES.NICKNAME]: ['[data-nickname-modal-overlay]', '.nickname-modal-overlay'],
  [MODAL_TYPES.ICON]: ['[data-icon-modal-overlay]', '.icon-picker-modal-overlay'],
  reward: REWARD_OVERLAY_SELECTORS,
  [MODAL_TYPES.GARAPON_HELP]: ['[data-garapon-help-overlay]'],
  [MODAL_TYPES.MISSION_PANEL]: ['[data-mission-overlay]'],
  [OVERLAY_EXTRA_TYPES.REWARD_HISTORY]: ['[data-reward-history-overlay]'],
}

const OVERLAY_QUERY_SELECTORS = [
  '.app-modal-overlay',
  '[data-modal-overlay]',
  '[data-referral-overlay]',
  '[data-nickname-modal-overlay]',
  '[data-icon-modal-overlay]',
  '[data-mission-overlay]',
  '[data-reward-history-overlay]',
  '[data-garapon-help-overlay]',
  '[data-account-reward-overlay]',
  '[data-global-reward-overlay]',
  '[data-game-reward-overlay]',
  '[data-garapon-modal-overlay]',
]

function getAppEl() {
  return document.querySelector('#app')
}

function getSelectorsForOverlayType(modalType) {
  if (!modalType || modalType === 'reward' || isRewardLikeModalType(modalType)) {
    return OVERLAY_SELECTORS_BY_TYPE.reward
  }
  return OVERLAY_SELECTORS_BY_TYPE[modalType] || [`[data-modal-type="${modalType}"]`]
}

function collectOverlayElements(app = getAppEl()) {
  if (!app) return []
  const seen = new Set()
  const nodes = []
  OVERLAY_QUERY_SELECTORS.forEach((sel) => {
    app.querySelectorAll(sel).forEach((el) => {
      if (seen.has(el)) return
      seen.add(el)
      nodes.push(el)
    })
  })
  return nodes
}

function countUniqueOverlays() {
  return collectOverlayElements().length
}

function logOverlayCount() {
  console.log('[overlay] count:', countUniqueOverlays())
}

function isOverlayTypeOpen(modalType) {
  switch (modalType) {
    case MODAL_TYPES.CODE:
      return state.referralPanelOpen
    case MODAL_TYPES.NICKNAME:
      return state.nicknameModalOpen
    case MODAL_TYPES.ICON:
      return state.iconModalOpen
    case MODAL_TYPES.BOOST:
      return state.boostConfirmOpen
    case MODAL_TYPES.MESSAGE:
      return !!state.modalMessage
    case MODAL_TYPES.MISSION_PANEL:
    case OVERLAY_EXTRA_TYPES.MISSION_PANEL:
      return state.missionScreenOpen
    case MODAL_TYPES.GARAPON_HELP:
    case OVERLAY_EXTRA_TYPES.GARAPON_HELP:
      return state.garaponHelpOpen
    case OVERLAY_EXTRA_TYPES.REWARD_HISTORY:
      return state.rewardHistoryOpen
    default:
      if (modalType === 'reward' || isRewardLikeModalType(modalType)) return !!state.rewardPopup
      return false
  }
}

function applyOverlayOpenClasses(el, open, modalType) {
  if (!el) return
  el.classList.add('app-modal-overlay')
  el.classList.toggle('app-modal-open', open)
  el.classList.toggle('modal-open', open)
  if (modalType) {
    if (open) el.setAttribute('data-modal-type', modalType)
    else el.removeAttribute('data-modal-type')
  }
  if (open && !el.hasAttribute('data-modal-overlay')) {
    el.setAttribute('data-modal-overlay', '')
  }
  el.style.pointerEvents = open ? '' : 'none'
}

function removeModalOverlay(modalType) {
  const app = getAppEl()
  if (!app) return 0
  let removed = 0
  getSelectorsForOverlayType(modalType).forEach((sel) => {
    app.querySelectorAll(sel).forEach((el) => {
      el.remove()
      removed += 1
    })
  })
  if (removed > 0) {
    console.log('[overlay] remove', modalType)
    logOverlayCount()
  }
  return removed
}

function removeAllRewardOverlays() {
  return removeModalOverlay('reward')
}

function removeDuplicateOverlaysForType(modalType) {
  const app = getAppEl()
  if (!app) return 0
  const nodes = []
  getSelectorsForOverlayType(modalType).forEach((sel) => {
    app.querySelectorAll(sel).forEach((el) => {
      if (!nodes.includes(el)) nodes.push(el)
    })
  })
  if (nodes.length <= 1) return 0
  let removed = 0
  for (let i = 1; i < nodes.length; i++) {
    nodes[i].remove()
    removed += 1
  }
  if (removed > 0) console.log('[overlay] duplicate removed', modalType, removed)
  return removed
}

function mountModalOverlayHtml(html, modalType) {
  const app = getAppEl()
  if (!app || !html) return null
  removeDuplicateOverlaysForType(modalType)
  removeModalOverlay(modalType)
  const wrap = document.createElement('div')
  wrap.innerHTML = html.trim()
  const overlay = wrap.firstElementChild
  if (!overlay) return null
  applyOverlayOpenClasses(overlay, true, modalType)
  if (!overlay.hasAttribute('data-modal-overlay')) {
    overlay.setAttribute('data-modal-overlay', '')
  }
  if (modalType === 'reward' || isRewardLikeModalType(modalType)) {
    overlay.classList.add('modal-overlay--reward')
  }
  app.appendChild(overlay)
  console.log('[overlay] create', modalType)
  logOverlayCount()
  return overlay
}

function ensureModalOverlay(modalType, htmlOrBuilder) {
  if (!isOverlayTypeOpen(modalType)) {
    removeModalOverlay(modalType)
    return null
  }
  removeDuplicateOverlaysForType(modalType)
  const app = getAppEl()
  if (!app) return null
  const selectors = getSelectorsForOverlayType(modalType)
  let overlay = null
  for (const sel of selectors) {
    overlay = app.querySelector(sel)
    if (overlay) break
  }
  if (!overlay) {
    const html = typeof htmlOrBuilder === 'function' ? htmlOrBuilder() : htmlOrBuilder
    overlay = mountModalOverlayHtml(html, modalType)
  } else {
    applyOverlayOpenClasses(overlay, true, modalType)
  }
  return overlay
}

function getHomeShellOverlay() {
  const app = getAppEl()
  if (!app) return null
  return app.querySelector('.modal-overlay[data-modal-overlay]:not([data-garapon-help-overlay]):not([data-garapon-modal-overlay])')
}

function syncHomeShellOverlay() {
  const overlay = getHomeShellOverlay()
  if (!overlay) return
  const open = !!(state.boostConfirmOpen || state.rewardPopup || state.modalMessage)
  const type = open ? inferActiveModalType() || MODAL_TYPES.MESSAGE : ''
  overlay.classList.add('app-modal-overlay', 'modal-overlay')
  overlay.classList.toggle('modal-open', open)
  overlay.classList.toggle('app-modal-open', open)
  overlay.classList.toggle('modal-overlay--reward', !!state.rewardPopup)
  if (type) overlay.setAttribute('data-modal-type', type)
  else overlay.removeAttribute('data-modal-type')
  overlay.style.pointerEvents = open ? '' : 'none'
}

function syncMissionPanelOverlay() {
  const overlay = document.querySelector('[data-mission-overlay]')
  if (!overlay) return
  const open = state.missionScreenOpen
  overlay.classList.add('app-modal-overlay', 'mission-overlay')
  overlay.classList.toggle('mission-overlay--open', open)
  overlay.classList.toggle('app-modal-open', open)
  overlay.classList.toggle('modal-open', open)
  overlay.setAttribute('data-modal-type', OVERLAY_EXTRA_TYPES.MISSION_PANEL)
  overlay.style.pointerEvents = open ? '' : 'none'
}

function syncRewardHistoryOverlay() {
  const overlay = document.querySelector('[data-reward-history-overlay]')
  if (!overlay) return
  const open = state.rewardHistoryOpen
  overlay.classList.add('app-modal-overlay', 'reward-history-overlay')
  overlay.classList.toggle('app-modal-open', open)
  overlay.classList.toggle('modal-open', open)
  overlay.setAttribute('data-modal-type', OVERLAY_EXTRA_TYPES.REWARD_HISTORY)
  overlay.style.pointerEvents = open ? '' : 'none'
}

function unlockOverlayBodyIfNeeded() {
  syncBodyScrollLock()
  const locked = document.documentElement.classList.contains('app-scroll-locked')
  if (!locked) {
    console.log('[overlay] body unlocked')
    document.body.style.overflow = ''
    document.body.style.pointerEvents = ''
    document.documentElement.style.pointerEvents = ''
    console.log('[overlay] pointer restored')
  }
}

function cleanupOrphanOverlays() {
  let removed = 0
  if (!state.referralPanelOpen) removed += removeModalOverlay(MODAL_TYPES.CODE)
  if (!state.nicknameModalOpen) removed += removeModalOverlay(MODAL_TYPES.NICKNAME)
  if (!state.iconModalOpen) removed += removeModalOverlay(MODAL_TYPES.ICON)
  if (!state.rewardPopup) removed += removeAllRewardOverlays()
  if (!state.rewardHistoryOpen) removed += removeModalOverlay(OVERLAY_EXTRA_TYPES.REWARD_HISTORY)
  if (!state.garaponHelpOpen) removed += removeModalOverlay(OVERLAY_EXTRA_TYPES.GARAPON_HELP)

  syncHomeShellOverlay()
  syncMissionPanelOverlay()
  syncRewardHistoryOverlay()

  Object.values(MODAL_TYPES).forEach((t) => removeDuplicateOverlaysForType(t))
  removeDuplicateOverlaysForType('reward')
  removeDuplicateOverlaysForType(OVERLAY_EXTRA_TYPES.MISSION_PANEL)

  if (removed > 0) console.log('[overlay] cleanup orphan', removed)
  if (removed > 0) console.log('[overlay] cleanup garapon/mission', { removed })
  unlockOverlayBodyIfNeeded()
  logOverlayCount()
}

/** DOM 上のモーダル overlay を state に合わせて掃除 */
function removeOrphanModalOverlays() {
  cleanupOrphanOverlays()
  if (countUniqueOverlays() === 0) {
    console.log('[modal] overlay cleanup', { removed: 0 })
  }
}

function debugOverlayState() {
  const overlays = collectOverlayElements().map((el) => ({
    type: el.getAttribute('data-modal-type'),
    classes: el.className,
    pointerEvents: getComputedStyle(el).pointerEvents,
    display: getComputedStyle(el).display,
    zIndex: getComputedStyle(el).zIndex,
  }))
  console.log('[overlay] debug', {
    count: overlays.length,
    overlays,
    activeModal: state.activeModal,
    referralPanelOpen: state.referralPanelOpen,
    nicknameModalOpen: state.nicknameModalOpen,
    rewardPopup: !!state.rewardPopup,
    missionScreenOpen: state.missionScreenOpen,
    rewardHistoryOpen: state.rewardHistoryOpen,
    garaponHelpOpen: state.garaponHelpOpen,
    bodyClasses: document.body.className,
    htmlClasses: document.documentElement.className,
    scrollLocked: document.documentElement.classList.contains('app-scroll-locked'),
  })
}

if (import.meta.env?.DEV) {
  window.debugOverlayState = debugOverlayState
  window.debugWorkSessionState = debugWorkSessionState
}

function refreshModalsUI() {
  if (isActiveWorkOnWorkScreen()) {
    console.log('[render] skip modal-refresh during work')
    return
  }
  if (state.screen === 'home' && document.querySelector('#app .home-viewport')) {
    if (shouldPatchHomeScreen(false)) patchHomeScreen()
    else render({ reason: 'modal-refresh' })
    return
  }
  if (state.screen === 'account' && document.querySelector('#app .account-screen')) {
    if (shouldPatchAccountScreen(false)) patchAccountScreen()
    else render({ reason: 'modal-refresh' })
    return
  }
  if (state.screen === 'garapon' && document.querySelector('#app .garapon-screen')) {
    if (shouldPatchGaraponScreen(false)) patchGaraponScreen()
    else render({ reason: 'modal-refresh' })
    return
  }
  if (state.screen === 'game' && document.querySelector('#app .game-viewport')) {
    if (shouldPatchGameScreen(false)) patchGameScreen()
    else render({ reason: 'modal-refresh' })
    return
  }
  render({ reason: 'modal-refresh' })
}

/**
 * @param {string} type MODAL_TYPES
 * @param {*} payload
 * @param {{ force?: boolean, closeOthers?: boolean }} options
 */
function openModal(type, payload = {}, options = {}) {
  const { force = false, closeOthers = true } = options
  if (isModalOpenInProgress) {
    console.log('[modal] duplicate open ignored', type, 'in progress')
    return false
  }
  if (isModalOpen(type) && !force) {
    console.log('[modal] duplicate open ignored', type)
    return false
  }
  if (isRewardLikeModalType(type)) {
    if (state.rewardPopup && !force) {
      console.log('[modal] duplicate open ignored', type)
      return false
    }
    const now = Date.now()
    if (now - lastRewardPopupOpenedAt < REWARD_POPUP_OPEN_DEBOUNCE_MS && !force) {
      console.log('[modal] duplicate open ignored', type, 'debounce')
      return false
    }
    lastRewardPopupOpenedAt = now
  }
  if (closeOthers) {
    const current = inferActiveModalType()
    if (current && current !== type) closeAllModals({ silent: true })
  }
  isModalOpenInProgress = true
  try {
    state.activeModal = type
    state.modalPayload = payload ?? null
    syncLegacyModalFlagsFromActive(type, payload)
    console.log('[modal] open', type)
    refreshModalsUI()
    cleanupOrphanOverlays()
    return true
  } finally {
    isModalOpenInProgress = false
  }
}

function closeModalByType(type) {
  if (!type) return
  if (!isModalOpen(type)) {
    console.warn('[account] modal close failed', type, 'already closed')
    return
  }
  clearModalStateForType(type)
  console.log('[modal] close', type)
  refreshModalsUI()
  cleanupOrphanOverlays()
}

function closeAllModals(options = {}) {
  const { silent = false } = options
  clearAllModalState()
  console.log('[modal] close all')
  if (!silent) refreshModalsUI()
  cleanupOrphanOverlays()
}

function openRewardPopupWithGuard(nextPopup, rewardModalType = MODAL_TYPES.REWARD) {
  const type = isRewardLikeModalType(rewardModalType) ? rewardModalType : MODAL_TYPES.REWARD
  return openModal(type, nextPopup, { closeOthers: true })
}

function isValidReferrerRewardCursorAt(iso) {
  if (!iso || iso === '0') return false
  return Number.isFinite(Date.parse(iso))
}

function getReferrerRewardLastSeenAt() {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.referrerRewardLogLastSeenAt)
    if (isValidReferrerRewardCursorAt(stored)) return stored
    const legacy = localStorage.getItem(STORAGE_KEYS.referrerRewardLogMaxId)
    if (legacy != null) {
      localStorage.removeItem(STORAGE_KEYS.referrerRewardLogMaxId)
    }
  } catch {
    /* ignore */
  }
  return null
}

function setReferrerRewardLastSeenAt(iso) {
  if (!isValidReferrerRewardCursorAt(iso)) return
  try {
    localStorage.setItem(STORAGE_KEYS.referrerRewardLogLastSeenAt, iso)
  } catch {
    /* ignore */
  }
}

async function seedReferrerRewardLogCursor() {
  if (getReferrerRewardLastSeenAt()) return

  const userId = state.userId || getUserId()
  const res = await runApi('seedReferrerRewardCursor', () =>
    supabase
      .from('reward_logs')
      .select('created_at')
      .eq('user_id', userId)
      .eq('reward_type', 'referral_referrer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  , { silent: true })
  if (!res.ok) return
  const cursor = res.data?.created_at ?? new Date().toISOString()
  setReferrerRewardLastSeenAt(cursor)
}

/** 紹介者報酬（他端末でコード適用）の未通知分を検出し、文言→獲得モーダル */
async function syncReferrerRewardNotifications() {
  if (isLoading('referrerNotify')) return
  if (state.rewardPopup || isLoading('applyCode')) return
  if (state.screen === 'work' || state.screen === 'result') return
  if (Date.now() - lastReferrerRewardSyncAt < REFERRER_REWARD_SYNC_MIN_INTERVAL_MS) return

  lastReferrerRewardSyncAt = Date.now()
  return withLoading('referrerNotify', async () => {
    const userId = state.userId || getUserId()
    if (!userId) return

    let lastSeenAt = getReferrerRewardLastSeenAt()
    if (!lastSeenAt) {
      await seedReferrerRewardLogCursor()
      lastSeenAt = getReferrerRewardLastSeenAt()
      if (!lastSeenAt) return
    }

    const logsRes = await runApi('syncReferrerReward.fetchLogs', () =>
      supabase
        .from('reward_logs')
        .select('id, amount, created_at')
        .eq('user_id', userId)
        .eq('reward_type', 'referral_referrer')
        .gt('created_at', lastSeenAt)
        .order('created_at', { ascending: true })
    )
    if (!logsRes.ok) throw logsRes.error?.raw ?? new Error(logsRes.error?.message)
    const logs = Array.isArray(logsRes.data) ? logsRes.data : []
    if (!logs.length) return

    let maxCreatedAt = lastSeenAt
    for (const row of logs) {
      if (row.created_at && row.created_at > maxCreatedAt) maxCreatedAt = row.created_at
    }
    setReferrerRewardLastSeenAt(maxCreatedAt)

    const totalPoints = logs.reduce((sum, row) => sum + (Math.floor(Number(row.amount)) || 0), 0)
    if (totalPoints <= 0) return

    await fetchPoints()
    if (state.rewardPopup) return

    showToast(REFERRAL_REFERRER_NOTIFY_MESSAGE)
    await new Promise((resolve) => setTimeout(resolve, 800))
    if (state.rewardPopup || isLoading('applyCode')) return

    const opened = openRewardPopupWithGuard({ type: 'points', amount: totalPoints }, MODAL_TYPES.REFERRAL_REWARD)
    if (opened) {
      console.log('[referral] referrer reward popup', { totalPoints, count: logs.length })
      render()
    }
  }, { skipPatch: true }).catch((e) => {
    if (!referrerRewardSyncWarned) {
      referrerRewardSyncWarned = true
      console.warn('[referral] sync referrer reward notifications failed', e?.message || e)
    }
  })
}

function scheduleReferrerRewardSyncForAccountScreen() {
  if (state.screen !== 'account') return
  if (accountReferrerSyncArmed) return
  accountReferrerSyncArmed = true
  void syncReferrerRewardNotifications()
}

function checkDateReset() {
  const todayKey = getTodayKey()
  if (state.boostDate !== todayKey) {
    state.boostActive = false
    state.boostDate = todayKey
    state.todayEarned = 0
    state.hourglassCarrySecToday = 0
    state.overflowWorkSecondsToday = 0
    state.overflowPigTicketsToday = 0
    console.log('[overflowBonus] reset daily')
    state.lastDate = todayKey
    saveState()
  }
}

/** 砂時計付与間隔（秒）。ブースト中は20分。 */
function getIntervalSec() {
  return state.boostActive ? BOOST_WORK_SECONDS_PER_HOURGLASS : WORK_SECONDS_PER_HOURGLASS
}

/** 超過ボーナス豚チケットの付与間隔（秒）。作業終了時点のブースト状態で判定。 */
function getOverflowTicketIntervalSec() {
  return state.boostActive ? BOOST_WORK_SECONDS_PER_HOURGLASS : WORK_SECONDS_PER_HOURGLASS
}

function isHourglassGrantBlockedByCap() {
  return state.todayEarned >= MAX_HOURGLASSES || state.hourglasses >= MAX_HOURGLASSES
}

function accumulateSessionOverflowWork(deltaSec) {
  if (!Number.isFinite(deltaSec) || deltaSec <= 0) return
  if (!isHourglassGrantBlockedByCap()) return
  state.sessionOverflowWorkSec += deltaSec
}

async function applyOverflowPigTicketBonus(sessionOverflowSec) {
  console.log('[overflowBonus] start')
  state.overflowPigTicketsGrantedThisSession = 0

  if (state.overflowPigTicketsToday >= OVERFLOW_PIG_TICKET_DAILY_LIMIT) {
    console.log('[overflowBonus] daily limit reached')
    return
  }

  const sec = Math.max(0, Number(sessionOverflowSec) || 0)
  if (sec > 0) {
    console.log('[overflowBonus] eligible seconds:', sec)
    state.overflowWorkSecondsToday += sec
  }

  const interval = getOverflowTicketIntervalSec()
  console.log('[overflowBonus] interval:', interval)

  if (state.hourglasses >= MAX_HOURGLASSES) {
    console.log('[overflowBonus] hourglass full')
  }

  const totalTicketsFromSeconds = Math.floor(state.overflowWorkSecondsToday / interval)
  const headroom = OVERFLOW_PIG_TICKET_DAILY_LIMIT - state.overflowPigTicketsToday
  const toGrant = Math.min(totalTicketsFromSeconds, headroom)
  if (toGrant <= 0) return

  await addPigTickets(toGrant, 'overflow_bonus', '超過作業ボーナス', { skipRender: true })
  state.overflowWorkSecondsToday -= toGrant * interval
  state.overflowPigTicketsToday += toGrant
  state.overflowPigTicketsGrantedThisSession = toGrant
  console.log('[overflowBonus] granted tickets:', toGrant)

  if (state.overflowPigTicketsToday >= OVERFLOW_PIG_TICKET_DAILY_LIMIT) {
    console.log('[overflowBonus] daily limit reached')
    state.overflowWorkSecondsToday = 0
  }
}

function loadState() {
  console.log('[init] loadState', { op: 'start' })
  const savedHourglasses = localStorage.getItem(STORAGE_KEYS.hourglasses)
  const savedTodayEarned = localStorage.getItem(STORAGE_KEYS.todayEarned)
  const savedBoostActive = localStorage.getItem(STORAGE_KEYS.boostActive)
  const savedBoostDate = localStorage.getItem(STORAGE_KEYS.boostDate)
  if (savedHourglasses != null) {
    const h = parseInt(savedHourglasses, 10)
    state.hourglasses = Math.min(MAX_HOURGLASSES, Math.max(0, h))
  }
  if (savedTodayEarned != null) state.todayEarned = Math.min(MAX_HOURGLASSES, Math.max(0, parseInt(savedTodayEarned, 10)))
  if (savedBoostActive != null) state.boostActive = savedBoostActive === 'true'
  if (savedBoostDate != null) state.boostDate = savedBoostDate
  const savedLastDate = localStorage.getItem(STORAGE_KEYS.lastDate)
  if (savedLastDate != null) state.lastDate = savedLastDate
  else state.lastDate = getTodayKey()
  const savedLastLogin = localStorage.getItem(STORAGE_KEYS.missionLastLogin)
  if (savedLastLogin != null) state.lastLoginDate = savedLastLogin
  const savedGameGift = localStorage.getItem(STORAGE_KEYS.gameGiftClaimDate)
  if (savedGameGift != null) state.gameGiftClaimDate = savedGameGift
  const cachedUsername =
    localStorage.getItem(STORAGE_KEYS.usernameCache) ?? localStorage.getItem(STORAGE_KEYS.nickname)
  if (cachedUsername != null && String(cachedUsername).trim() !== '') {
    state.username = normalizeUsernameForStorage(cachedUsername)
  } else {
    state.username = DEFAULT_USERNAME
  }
  try {
    const rawCarry = localStorage.getItem(STORAGE_KEYS.hourglassCarryToday)
    if (rawCarry) {
      const o = JSON.parse(rawCarry)
      const tk = getTodayKey()
      if (o && o.d === tk && Number.isFinite(o.s) && o.s >= 0) {
        state.hourglassCarrySecToday = o.s
      }
    }
    const rawOverflowWork = localStorage.getItem(STORAGE_KEYS.overflowWorkToday)
    if (rawOverflowWork) {
      const o = JSON.parse(rawOverflowWork)
      const tk = getTodayKey()
      if (o && o.d === tk && Number.isFinite(o.s) && o.s >= 0) {
        state.overflowWorkSecondsToday = o.s
      }
    }
    const rawOverflowTickets = localStorage.getItem(STORAGE_KEYS.overflowPigTicketsToday)
    if (rawOverflowTickets) {
      const o = JSON.parse(rawOverflowTickets)
      const tk = getTodayKey()
      if (o && o.d === tk && Number.isFinite(o.n) && o.n >= 0) {
        state.overflowPigTicketsToday = Math.min(OVERFLOW_PIG_TICKET_DAILY_LIMIT, o.n)
      }
    }
  } catch {
    /* ignore */
  }
  console.log('[init] checkDateReset', { op: 'start' })
  checkDateReset()
  console.log('[init] checkDateReset', { op: 'done' })
  console.log('[init] loadState', { op: 'done' })
}

function saveState() {
  localStorage.setItem(STORAGE_KEYS.hourglasses, String(state.hourglasses))
  localStorage.setItem(STORAGE_KEYS.todayEarned, String(state.todayEarned))
  localStorage.setItem(STORAGE_KEYS.boostActive, String(state.boostActive))
  localStorage.setItem(STORAGE_KEYS.boostDate, String(state.boostDate))
  localStorage.setItem(STORAGE_KEYS.lastDate, String(state.lastDate))
  if (state.lastLoginDate) localStorage.setItem(STORAGE_KEYS.missionLastLogin, state.lastLoginDate)
  localStorage.setItem(STORAGE_KEYS.gameGiftClaimDate, state.gameGiftClaimDate || '')
  localStorage.setItem(STORAGE_KEYS.usernameCache, state.username || DEFAULT_USERNAME)
  try {
    localStorage.setItem(
      STORAGE_KEYS.hourglassCarryToday,
      JSON.stringify({ d: getTodayKey(), s: state.hourglassCarrySecToday })
    )
    localStorage.setItem(
      STORAGE_KEYS.overflowWorkToday,
      JSON.stringify({ d: getTodayKey(), s: state.overflowWorkSecondsToday })
    )
    localStorage.setItem(
      STORAGE_KEYS.overflowPigTicketsToday,
      JSON.stringify({ d: getTodayKey(), n: state.overflowPigTicketsToday })
    )
  } catch {
    /* ignore */
  }
}

// --- カレンダー用：日別作業時間・日記 ---
function getWorkLog() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.workLog)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}
function addWorkSeconds(dateKey, sec) {
  const log = getWorkLog()
  log[dateKey] = (log[dateKey] || 0) + sec
  localStorage.setItem(STORAGE_KEYS.workLog, JSON.stringify(log))
}
function getWorkSeconds(dateKey) {
  const log = getWorkLog()
  return log[dateKey] || 0
}
function getDiaries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.diaries)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}
function getDiary(dateKey) {
  return getDiaries()[dateKey] || ''
}
function setDiary(dateKey, text) {
  const trimmed = String(text).slice(0, 200)
  const diaries = getDiaries()
  diaries[dateKey] = trimmed
  localStorage.setItem(STORAGE_KEYS.diaries, JSON.stringify(diaries))
  void saveStudyDailyLogDiaryText({
    userId: state.userId || getUserId(),
    logDate: dateKey,
    diaryText: trimmed,
  })
}
/** 月の合計作業時間（秒） */
function getMonthTotalSec(year, month) {
  const log = getWorkLog()
  const prefix = year + '-' + String(month).padStart(2, '0') + '-'
  return Object.entries(log).reduce((sum, [key, sec]) => {
    return key.startsWith(prefix) ? sum + sec : sum
  }, 0)
}
/** 連続継続日数（今日から遡って作業した日が何日続いているか） */
function getConsecutiveDays() {
  const log = getWorkLog()
  let count = 0
  let d = new Date()
  for (let i = 0; i < 366; i++) {
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    if (log[key] && log[key] > 0) {
      count++
      d.setDate(d.getDate() - 1)
    } else {
      break
    }
  }
  return count
}
/** 合計作業日数（作業した日数） */
function getTotalWorkDays() {
  const log = getWorkLog()
  return Object.values(log).filter((sec) => sec > 0).length
}
/** 日記を書いた日数（全期間） */
function getDiaryDaysCount() {
  const diaries = getDiaries()
  return Object.values(diaries).filter((text) => String(text).trim().length > 0).length
}
/** ログイン日マップの取得 */
function getLoginDays() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.loginDays)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}
function addLoginDay(dateKey) {
  const days = getLoginDays()
  if (!days[dateKey]) {
    days[dateKey] = true
    localStorage.setItem(STORAGE_KEYS.loginDays, JSON.stringify(days))
    return true
  }
  return false
}
/** 累計ログイン日数 */
function getTotalLoginDays() {
  const days = getLoginDays()
  return Object.keys(days).length
}
function formatWorkTime(sec) {
  if (sec < 60) return '0分'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}時間${m}分`
  return `${m}分`
}
/** 指定年月のカレンダー用配列 [ null, null, 1, 2, ... ]（日曜始まり） */
function getCalendarDays(year, month) {
  const first = new Date(year, month - 1, 1)
  const last = new Date(year, month, 0)
  const startWeekday = first.getDay()
  const daysInMonth = last.getDate()
  const arr = []
  for (let i = 0; i < startWeekday; i++) arr.push(null)
  for (let d = 1; d <= daysInMonth; d++) arr.push(d)
  return arr
}
function toDateKey(year, month, day) {
  return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0')
}

// --- ミッション ---
function getPeriodKey(category, date = new Date()) {
  if (category === 'daily') {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')
  }
  if (category === 'weekly') {
    const { year, week } = getIsoWeekInfo(date)
    return `${year}-W${String(week).padStart(2, '0')}`
  }
  if (category === 'monthly') {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0')
  }
  return 'lifetime'
}

function getMissionTabCategory(tab) {
  return tab === 'total' ? 'lifetime' : tab
}

function getMissionProgressStateKey(missionKey, periodKey) {
  return `${missionKey}::${periodKey}`
}

function getMissionProgress(missionKey, category) {
  const periodKey = getPeriodKey(category)
  return state.missionProgresses[getMissionProgressStateKey(missionKey, periodKey)] || null
}

function isMissionCompleted(mission) {
  const progress = getMissionProgress(mission.mission_key, mission.category)
  return !!progress?.is_completed
}

function isMissionClaimed(mission) {
  const progress = getMissionProgress(mission.mission_key, mission.category)
  return !!progress?.is_claimed
}

const fetchMissionDefinitions = async () => {
  const res = await runApi('fetchMissionDefinitions', () =>
    supabase
      .from('missions')
      .select(
        'category, mission_key, title, target_value, reward_type, reward_amount, reward_icon_key, sort_order, is_active'
      )
      .eq('is_active', true)
      .order('category', { ascending: true })
      .order('sort_order', { ascending: true })
  )
  if (!res.ok) return
  const grouped = { daily: [], weekly: [], monthly: [], lifetime: [] }
  for (const row of res.data || []) {
    if (!grouped[row.category]) continue
    grouped[row.category].push(row)
  }
  state.missionDefinitions = grouped
}

const ensureMissionProgressExists = async (missionKey, category, options = {}) => {
  const { logStart = true, failCollector = null } = options
  const userId = state.userId || getUserId()
  const periodKey = getPeriodKey(category)
  if (logStart) {
    console.log('[missions] ensure start', { missionKey, category, periodKey })
  }
  const collectFail = (errorLike) => {
    if (!Array.isArray(failCollector)) return
    failCollector.push({
      missionKey,
      category,
      message: errorLike?.message || 'unknown error',
      code: errorLike?.code ?? null,
    })
  }
  try {
    const { data, error } = await supabase
      .from('mission_progresses')
      .select('*')
      .eq('user_id', userId)
      .eq('mission_key', missionKey)
      .eq('period_key', periodKey)
      .limit(1)
    if (error) {
      console.error('[missions] failed', error)
      collectFail(error)
      return null
    }
    const existing = data?.[0] ?? null
    if (existing) return existing
    const { data: inserted, error: insertError } = await supabase
      .from('mission_progresses')
      .insert({
        user_id: userId,
        mission_key: missionKey,
        period_key: periodKey,
        progress_value: 0,
        is_completed: false,
        is_claimed: false,
      })
      .select('*')
      .maybeSingle()
    if (insertError) {
      console.error('[missions] failed', insertError)
      collectFail(insertError)
      return null
    }
    if (!inserted) {
      collectFail({ message: 'mission progress insert returned no row', code: null })
      return null
    }
    return inserted
  } catch (e) {
    console.error('[missions] failed', e)
    collectFail(e)
    return null
  }
}

const updateMissionProgress = async (missionKey, category, amount = 1) => {
  const userId = state.userId || getUserId()
  const periodKey = getPeriodKey(category)
  try {
    const mission = (state.missionDefinitions[category] || []).find((m) => m.mission_key === missionKey)
    if (!mission) {
      console.warn('[missions] definition missing — skip update', { missionKey, category, periodKey })
      return false
    }
    const ensured = await ensureMissionProgressExists(missionKey, category)
    if (!ensured) return
    const nextValue = Math.max(0, Number(ensured.progress_value || 0) + Number(amount || 0))
    const isCompleted = nextValue >= Number(mission.target_value || 0)
    const { data: updated, error } = await supabase
      .from('mission_progresses')
      .update({
        progress_value: nextValue,
        is_completed: isCompleted,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('mission_key', missionKey)
      .eq('period_key', periodKey)
      .select('*')
      .maybeSingle()
    if (error) {
      console.error('[missions] failed', error)
      return
    }
    if (updated) state.missionProgresses[getMissionProgressStateKey(missionKey, periodKey)] = updated
    console.log('[missions] update success', { missionKey, category, periodKey, progressValue: nextValue, isCompleted })
    return true
  } catch (e) {
    console.error('[missions] failed', e)
    return false
  }
}

/** `missions` に行があるときだけ更新（未定義のキーでは何もしない・warn も出さない） */
async function updateMissionProgressWhenDefined(missionKey, category, amount = 1) {
  const mission = (state.missionDefinitions[category] || []).find((m) => m.mission_key === missionKey)
  if (!mission) return false
  return updateMissionProgress(missionKey, category, amount)
}

/** 累計作業秒を足すライフタイムミッション（DB に無いキーはクライアントから呼ばない） */
const LIFETIME_WORK_SESSION_SEC_MISSION_KEYS = [
  'lifetime_work_time_10h',
  'lifetime_work_time_30h',
  'lifetime_work_time_50h',
  'lifetime_work_time_100h',
  'lifetime_work_time_500h',
]

function getActiveDailyWorkMissionKey() {
  const daily = state.missionDefinitions.daily || []
  for (const key of DAILY_WORK_SESSION_MISSION_KEYS) {
    if (daily.some((m) => m.mission_key === key)) return key
  }
  return null
}

/** 作業セッション終了時のミッション進捗（終了確定後・結果画面へ遷移する前に await すること） */
async function applyWorkSessionEndMissionProgress(elapsedSec) {
  if (elapsedSec <= 0) return
  const workKey = getActiveDailyWorkMissionKey()
  if (workKey) {
    await updateMissionProgress(workKey, 'daily', 1)
  } else {
    console.warn(
      '[missions] デイリー「作業」ミッションが definitions にありません。Supabase の missions.mission_key を次のいずれかにしてください:',
      DAILY_WORK_SESSION_MISSION_KEYS
    )
  }
  await Promise.all(
    LIFETIME_WORK_SESSION_SEC_MISSION_KEYS.map((key) =>
      updateMissionProgressWhenDefined(key, 'lifetime', elapsedSec)
    )
  )
}

/**
 * study_sessions に1セッション分を保存（作業終了時）
 * @returns {Promise<void>}
 */
async function saveStudySession({ userId, startedAt, endedAt, durationSeconds, earnedHourglasses }) {
  const res = await runApi('saveStudySession', () =>
    supabase.from('study_sessions').insert({
      user_id: userId,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration_seconds: durationSeconds,
      earned_hourglasses: earnedHourglasses,
      status: 'completed',
    })
  )
  if (!res.ok) throw res.error?.raw ?? new Error(res.error?.message || 'saveStudySession failed')
}

/**
 * study_daily_logs の当日行を作成または total_seconds を加算（diary_text は維持）
 * @returns {Promise<void>}
 */
async function upsertStudyDailyLog({ userId, logDate, durationSecondsToAdd }) {
  const nowIso = new Date().toISOString()
  const selectRes = await runApi('saveStudyDailyLog.select', () =>
    supabase
      .from('study_daily_logs')
      .select('total_seconds, diary_text')
      .eq('user_id', userId)
      .eq('log_date', logDate)
      .maybeSingle()
  )
  if (!selectRes.ok) throw selectRes.error?.raw ?? new Error(selectRes.error?.message)

  const existing = selectRes.data
  if (!existing) {
    const insertRes = await runApi('saveStudyDailyLog.insert', () =>
      supabase.from('study_daily_logs').insert({
        user_id: userId,
        log_date: logDate,
        total_seconds: durationSecondsToAdd,
        diary_text: null,
        updated_at: nowIso,
      })
    )
    if (!insertRes.ok) throw insertRes.error?.raw ?? new Error(insertRes.error?.message)
  } else {
    const prevTotal = Number(existing.total_seconds) || 0
    const updateRes = await runApi('saveStudyDailyLog.update', () =>
      supabase
        .from('study_daily_logs')
        .update({
          total_seconds: prevTotal + durationSecondsToAdd,
          updated_at: nowIso,
        })
        .eq('user_id', userId)
        .eq('log_date', logDate)
    )
    if (!updateRes.ok) throw updateRes.error?.raw ?? new Error(updateRes.error?.message)
  }
}

/**
 * study_daily_logs.diary_text を保存（total_seconds は維持。行がなければ作成）
 * @returns {Promise<void>}
 */
async function saveStudyDailyLogDiaryText({ userId, logDate, diaryText }) {
  try {
    console.log('[studyLog] save diary start', { logDate })
    const nowIso = new Date().toISOString()
    const trimmed = String(diaryText).slice(0, 200)
    const textToStore = trimmed.trim() ? trimmed : null

    const { data: existing, error: selectError } = await supabase
      .from('study_daily_logs')
      .select('total_seconds, diary_text')
      .eq('user_id', userId)
      .eq('log_date', logDate)
      .maybeSingle()
    if (selectError) throw selectError

    if (!existing) {
      const { error: insertError } = await supabase.from('study_daily_logs').insert({
        user_id: userId,
        log_date: logDate,
        total_seconds: Math.max(0, Math.floor(getWorkSeconds(logDate) || 0)),
        diary_text: textToStore,
        updated_at: nowIso,
      })
      if (insertError) throw insertError
    } else {
      const { error: updateError } = await supabase
        .from('study_daily_logs')
        .update({
          diary_text: textToStore,
          updated_at: nowIso,
        })
        .eq('user_id', userId)
        .eq('log_date', logDate)
      if (updateError) throw updateError
    }
    console.log('[studyLog] save diary success', { logDate })
  } catch (e) {
    console.error('[studyLog] save diary failed', e)
  }
}

/** カレンダー表示用：Supabase の日記を localStorage に取り込む（失敗時はローカルのみ） */
async function hydrateDiariesFromSupabase() {
  const userId = state.userId || getUserId()
  try {
    const { data, error } = await supabase
      .from('study_daily_logs')
      .select('log_date, diary_text')
      .eq('user_id', userId)
      .not('diary_text', 'is', null)
    if (error) throw error
    const diaries = getDiaries()
    let changed = false
    for (const row of data || []) {
      if (!row?.log_date || row.diary_text == null) continue
      const remote = String(row.diary_text).slice(0, 200)
      if (remote !== (diaries[row.log_date] || '')) {
        diaries[row.log_date] = remote
        changed = true
      }
    }
    if (changed) {
      localStorage.setItem(STORAGE_KEYS.diaries, JSON.stringify(diaries))
    }
    return changed
  } catch (e) {
    console.error('[studyLog] hydrate diaries failed', e)
    return false
  }
}

/**
 * 作業終了後の学習ログ保存（失敗しても呼び出し元の終了処理は止めない）
 * durationSeconds は tick で加算された elapsedSec（一時停止・道具判定・カウントダウンは含まない）
 */
async function saveStudyLogAfterWorkEnd({ durationSeconds, earnedHourglasses, endedAt, logDate }) {
  const durationSec = Math.floor(Number(durationSeconds) || 0)
  if (durationSec <= 0) return

  return withLoading(
    'saveStudyLog',
    async () => {
      const userId = state.userId || getUserId()
      const ended = endedAt instanceof Date ? endedAt : new Date(endedAt)
      const startedAt = new Date(ended.getTime() - durationSec * 1000)
      const earned = Math.max(0, Math.floor(Number(earnedHourglasses) || 0))

      await saveStudySession({
        userId,
        startedAt,
        endedAt: ended,
        durationSeconds: durationSec,
        earnedHourglasses: earned,
      })
      await upsertStudyDailyLog({
        userId,
        logDate,
        durationSecondsToAdd: durationSec,
      })
    },
    { skipPatch: true }
  ).catch((e) => {
    console.error('[studyLog] save failed', e)
    notifyApiFailure(e, 'save')
  })
}

/** @returns {Promise<Array<{ log_date: string, total_seconds: number }>>} */
async function fetchStudyDailyLogsForUser() {
  const userId = state.userId || getUserId()
  const res = await runApi('fetchStudyDailyLogs', () =>
    supabase
      .from('study_daily_logs')
      .select('log_date, total_seconds')
      .eq('user_id', userId)
      .order('log_date', { ascending: true })
  )
  if (!res.ok) throw res.error?.raw ?? new Error(res.error?.message)
  return Array.isArray(res.data) ? res.data : []
}

/** @param {Array<{ log_date: string, total_seconds: number }>} rows */
function buildStudyDailyLogMap(rows) {
  const map = Object.create(null)
  for (const row of rows || []) {
    if (!row?.log_date) continue
    map[row.log_date] = Number(row.total_seconds) || 0
  }
  return map
}

function dateToKey(dt) {
  return (
    dt.getFullYear() +
    '-' +
    String(dt.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(dt.getDate()).padStart(2, '0')
  )
}

function addDaysToDateKey(dateKey, deltaDays) {
  const [y, m, d] = dateKey.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + deltaDays)
  return dateToKey(dt)
}

function formatChartDateLabel(dateKey) {
  const parts = dateKey.split('-')
  const month = parts[1]
  const day = parts[2]
  return `${month}/${day}`
}

/** 棒グラフ用：7日分（weekOffset 0 なら今日を右端に含む直近7日） */
function getWorkLogChartDays(weekOffset) {
  const todayKey = getTodayKey()
  const endKey = weekOffset === 0 ? todayKey : addDaysToDateKey(todayKey, -weekOffset * 7)
  const days = []
  for (let i = 6; i >= 0; i--) {
    const dateKey = addDaysToDateKey(endKey, -i)
    const label = dateKey === todayKey ? '今日' : formatChartDateLabel(dateKey)
    days.push({ dateKey, label })
  }
  return days
}

function computeStudyLogYMaxMinutes(minutesArray) {
  const max = Math.max(0, ...minutesArray)
  if (max <= 0) return 80
  return Math.max(20, Math.ceil(max / 20) * 20)
}

function buildWorkLogBarChartSvg(chartDays, logMap) {
  const W = 320
  const H = 168
  const padL = 32
  const padR = 8
  const padT = 8
  const padB = 26
  const chartW = W - padL - padR
  const chartH = H - padT - padB
  const minutes = chartDays.map((d) => Math.floor((logMap[d.dateKey] || 0) / 60))
  const yMax = computeStudyLogYMaxMinutes(minutes)
  const tickValues = [0, 0.25, 0.5, 0.75, 1].map((r) => Math.round(yMax * r))
  const uniqTicks = [...new Set(tickValues)].sort((a, b) => a - b)
  const gap = chartW / chartDays.length
  const barW = Math.max(12, gap * 0.52)

  let parts = [
    `<svg class="worklog-chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="直近7日間の作業時間">`,
  ]
  for (const t of uniqTicks) {
    const y = padT + chartH - (yMax > 0 ? (t / yMax) * chartH : 0)
    parts.push(
      `<line class="worklog-chart-grid" x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}"/>`,
      `<text class="worklog-chart-y-label" x="${padL - 4}" y="${y + 3.5}" text-anchor="end">${t}</text>`
    )
  }
  chartDays.forEach((day, i) => {
    const min = minutes[i]
    const barH = yMax > 0 ? (min / yMax) * chartH : 0
    const x = padL + gap * i + (gap - barW) / 2
    const y = padT + chartH - barH
    const cx = padL + gap * i + gap / 2
    parts.push(`<rect class="worklog-chart-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="3"/>`)
    parts.push(
      `<text class="worklog-chart-x-label" x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle">${escapeHtml(day.label)}</text>`
    )
  })
  parts.push('</svg>')
  return parts.join('')
}

function computeConsecutiveStudyDaysFromMap(logMap) {
  let count = 0
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  for (let i = 0; i < 366; i++) {
    const key = dateToKey(d)
    if ((logMap[key] || 0) > 0) {
      count++
      d.setDate(d.getDate() - 1)
    } else {
      break
    }
  }
  return count
}

function computeWeekStudySeconds(logMap) {
  const todayKey = getTodayKey()
  const [y, m, day] = todayKey.split('-').map(Number)
  const dt = new Date(y, m - 1, day)
  dt.setDate(dt.getDate() - dt.getDay())
  const weekStart = dateToKey(dt)
  let sum = 0
  for (const [key, sec] of Object.entries(logMap)) {
    if (key >= weekStart && key <= todayKey) sum += Number(sec) || 0
  }
  return sum
}

function computeMonthStudySeconds(logMap) {
  const prefix = getTodayKey().slice(0, 7)
  return Object.entries(logMap).reduce((sum, [key, sec]) => {
    return key.startsWith(prefix) ? sum + (Number(sec) || 0) : sum
  }, 0)
}

function computeTotalStudySeconds(logMap) {
  return Object.values(logMap).reduce((sum, sec) => sum + (Number(sec) || 0), 0)
}

/** 作業ログサマリー（今週・今月・累計）：常に「〇時間〇分」 */
function formatStudyLogDurationHoursMinutes(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}時間${m}分`
}

async function refreshWorkLogData() {
  if (state.workLogLoading) return
  state.workLogLoading = true
  state.workLogError = null
  render()
  try {
    state.workLogDailyLogs = await fetchStudyDailyLogsForUser()
  } catch (e) {
    state.workLogError = e
    state.workLogDailyLogs = []
    console.error('[workLog] fetch failed', e)
  } finally {
    state.workLogLoading = false
    render()
  }
}

function bindWorkLogScreenEvents(app) {
  app.querySelector('[data-worklog-back]')?.addEventListener('click', () => {
    changeScreen('calendar', { reason: 'worklog-back' })
  })
  app.querySelector('[data-worklog-prev]')?.addEventListener('click', () => {
    state.workLogWeekOffset += 1
    render()
  })
  app.querySelector('[data-worklog-next]')?.addEventListener('click', () => {
    if (state.workLogWeekOffset <= 0) return
    state.workLogWeekOffset -= 1
    render()
  })
}

const fetchMissionProgresses = async () => {
  const userId = state.userId || getUserId()
  const res = await runApi('fetchMissionProgresses', () =>
    supabase.from('mission_progresses').select('*').eq('user_id', userId)
  )
  if (!res.ok) return
  const map = {}
  for (const row of res.data || []) {
    if (!row?.mission_key) continue
    map[getMissionProgressStateKey(row.mission_key, row.period_key)] = row
  }
  state.missionProgresses = map
}

const ensureMissionProgressesForActiveMissions = async () => {
  const userId = state.userId || getUserId()
  console.log('[init] ensureMissionProgresses', {
    op: 'start',
    userId,
    pointsRowId: state.pointsRowId,
  })
  const defs = [
    ...(state.missionDefinitions.daily || []),
    ...(state.missionDefinitions.weekly || []),
    ...(state.missionDefinitions.monthly || []),
    ...(state.missionDefinitions.lifetime || []),
  ]
  const startedAt = Date.now()
  const failDetails = []
  let successCount = 0
  let failCount = 0
  for (const m of defs) {
    const row = await ensureMissionProgressExists(m.mission_key, m.category, {
      logStart: false,
      failCollector: failDetails,
    })
    if (row == null) failCount++
    else successCount++
  }
  const durationMs = Date.now() - startedAt
  console.log('[init] ensureMissionProgresses summary', {
    defsCount: defs.length,
    successCount,
    failCount,
    durationMs,
    userId,
  })
  if (failCount > 0) {
    console.warn('[init] ensureMissionProgresses failed missions', failDetails)
  }
}

const claimMissionReward = async (missionKey, category, options = {}) => {
  if (missionClaimLocks.has(missionKey)) {
    console.log('[mission] claim blocked', missionKey, 'lock')
    return null
  }
  return withLoading(
    'claimMission',
    async () => {
      missionClaimLocks.add(missionKey)
      const { suppressPopup = false } = options
      const userId = state.userId || getUserId()
      const periodKey = getPeriodKey(category)
      try {
        console.log('[mission] claim start', { missionKey, category })
        const mission = (state.missionDefinitions[category] || []).find((m) => m.mission_key === missionKey)
        if (!mission) {
          console.error('[missions] failed', new Error(`mission not found: ${missionKey} (${category})`))
          return null
        }
        const progress = await ensureMissionProgressExists(missionKey, category)
        if (!progress || !progress.is_completed || progress.is_claimed) return null

        if (state.rewardPopup) clearModalStateForType(state.activeModal || MODAL_TYPES.REWARD)
        let reward = null
        if (mission.reward_type === 'point') {
          await addPoints(mission.reward_amount, 'mission', mission.title, { skipRender: true })
          reward = { type: 'points', amount: Number(mission.reward_amount) || 0 }
        } else if (mission.reward_type === 'pig_ticket') {
          await addPigTickets(mission.reward_amount, 'mission', mission.title, { skipRender: true })
          reward = { type: 'ticket', amount: Number(mission.reward_amount) || 0 }
        } else if (mission.reward_type === 'icon') {
          const iconKey = String(mission.reward_icon_key || '').trim()
          if (!iconKey) {
            console.error('[missions] failed', new Error(`mission icon reward missing reward_icon_key: ${missionKey}`))
            return null
          }
          const sourceRef = `${missionKey}:${periodKey}`
          const grantRes = await grantIconToUser(userId, iconKey, 'mission', sourceRef)
          if (!grantRes.ok) {
            notifyApiFailure(grantRes.error, 'claimMission')
            return null
          }
          reward = {
            type: 'icon',
            iconKey,
            granted: grantRes.granted,
            duplicate: grantRes.duplicate,
          }
          if (grantRes.duplicate) {
            console.log('[mission] icon reward skipped (already owned)', { missionKey, iconKey, sourceRef })
          }
        } else {
          console.error('[missions] failed', new Error(`unsupported reward_type: ${mission.reward_type}`))
          return null
        }

        const claimRes = await runApi('claimMission', () =>
          supabase
            .from('mission_progresses')
            .update({
              is_claimed: true,
              claimed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('user_id', userId)
            .eq('mission_key', missionKey)
            .eq('period_key', periodKey)
            .eq('is_claimed', false)
            .select('*')
            .maybeSingle()
        )
        if (!claimRes.ok || !claimRes.data) {
          console.log('[mission] claim failed', missionKey)
          notifyApiFailure(claimRes.error, 'claimMission')
          return null
        }
        state.missionProgresses[getMissionProgressStateKey(missionKey, periodKey)] = claimRes.data
        await fetchMissionProgresses()
        if (!suppressPopup && reward) {
          if (reward.type === 'icon' && reward.granted) {
            console.log('[mission] reward open', { missionKey, reward })
            openRewardPopupWithGuard({ items: [reward] }, MODAL_TYPES.MISSION)
          } else if (reward.type === 'points' && reward.amount > 0) {
            console.log('[mission] reward open', { missionKey, reward })
            openRewardPopupWithGuard({ items: [reward] }, MODAL_TYPES.MISSION)
          } else if (reward.type === 'ticket' && reward.amount > 0) {
            console.log('[mission] reward open', { missionKey, reward })
            openRewardPopupWithGuard({ items: [reward] }, MODAL_TYPES.MISSION)
          }
        }
        console.log('[mission] claim success', { missionKey, category, periodKey })
        if (state.screen === 'home' && document.querySelector('#app .home-viewport')) {
          patchHomeScreen()
        } else {
          render()
        }
        if (reward?.type === 'icon') return reward.granted ? reward : null
        return reward && reward.amount > 0 ? reward : null
      } catch (e) {
        console.log('[mission] claim failed', missionKey, e?.message || e)
        console.error('[missions] failed', e)
        notifyApiFailure(e, 'claimMission')
        return null
      } finally {
        missionClaimLocks.delete(missionKey)
      }
    },
    { blockedReturn: null, skipPatch: true }
  )
}

function getMissionsForTab(tab) {
  const category = getMissionTabCategory(tab)
  return state.missionDefinitions[category] || []
}

/** 日記を書ける日付か（今日〜過去3日以内。未来は不可） */
function canWriteDiaryForDate(dateKey) {
  const today = getTodayKey()
  if (dateKey > today) return false
  const [y, m, d] = dateKey.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const todayDate = new Date()
  todayDate.setHours(0, 0, 0, 0)
  date.setHours(0, 0, 0, 0)
  const diffMs = todayDate - date
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000))
  return diffDays <= 3
}

// --- 作業タイマー tick ---
function computeHourglassGrant() {
  const intervalSec = getIntervalSec()
  const effectiveSec = state.hourglassCarrySecToday + state.elapsedSec
  const potentialGrant = Math.floor(effectiveSec / intervalSec)
  return Math.min(
    potentialGrant - state.sessionGrantedCount,
    MAX_HOURGLASSES - state.todayEarned,
    MAX_HOURGLASSES - state.hourglasses
  )
}

function applyHourglassGrant(toGive) {
  if (toGive <= 0) return
  state.sessionGrantedCount += toGive
  state.todayEarned += toGive
  state.hourglasses += toGive
  state.hourglasses = Math.min(MAX_HOURGLASSES, state.hourglasses)
  state.todayEarned = Math.min(MAX_HOURGLASSES, state.todayEarned)
  addHourglassEarned(getTodayKey(), toGive)
  void updateMissionProgress('daily_hourglass_1', 'daily', toGive)
  void updateMissionProgress('weekly_hourglass_5', 'weekly', toGive)
  void updateMissionProgress('weekly_hourglass_10', 'weekly', toGive)
  void updateMissionProgress('weekly_hourglass_20', 'weekly', toGive)
  void updateMissionProgress('monthly_hourglass_30', 'monthly', toGive)
  void updateMissionProgress('monthly_hourglass_50', 'monthly', toGive)
  void updateMissionProgress('monthly_hourglass_70', 'monthly', toGive)
  void updateMissionProgress('lifetime_hourglass_100', 'lifetime', toGive)
  void updateMissionProgress('lifetime_hourglass_300', 'lifetime', toGive)
  void updateMissionProgress('lifetime_hourglass_500', 'lifetime', toGive)
  saveState()
}

function refreshAfterTick() {
  if (state.screen === 'work') updateWorkTimerDisplay()
  else render()
}

function tick() {
  if (!state.isWorking || state.isPaused) return
  if (!state.workToolCheckDone || !state.workCountdownDone) return
  const now = Date.now()
  const deltaSec = (now - state.lastTickAt) / 1000
  state.elapsedSec += deltaSec
  state.lastTickAt = now

  const toGive = computeHourglassGrant()
  applyHourglassGrant(toGive)
  if (isHourglassGrantBlockedByCap()) {
    accumulateSessionOverflowWork(deltaSec)
  }
  refreshAfterTick()
}

/** 作業計測用の 1 秒タイマーを開始（呼び出しは原則 workSession 経由。tick の中身は触らない） */
function startTick() {
  if (tickIntervalId) {
    console.log('[tick] startTick', { action: 'skip', hasInterval: true })
    return
  }
  state.lastTickAt = Date.now()
  tickIntervalId = setInterval(tick, 1000)
  console.log('[tick] startTick', { action: 'start', hasInterval: !!tickIntervalId })
}

/** 作業計測用の 1 秒タイマーを停止（呼び出しは原則 workSession または tick 内の条件） */
function stopTick() {
  const hadInterval = !!tickIntervalId
  if (tickIntervalId) {
    clearInterval(tickIntervalId)
    tickIntervalId = null
  }
  console.log('[tick] stopTick', { hadInterval, hasInterval: !!tickIntervalId })
}

/**
 * 作業セッションのタイマー・判定・（任意で）カメラを停止。何度呼んでも安全。
 * @param {string} reason
 * @param {{ shouldStopCamera?: boolean, closeEndConfirm?: boolean, stopTick?: boolean, stopToolCheck?: boolean, stopMotionCheck?: boolean, clearCountdown?: boolean }} [options]
 */
function ensureWorkSessionTeardown(reason = 'unknown', options = {}) {
  const callerStack = new Error().stack ?? ''
  const caller =
    callerStack
      .split('\n')
      .slice(2, 5)
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' <- ') || 'unknown'
  console.log('[teardown-callstack]', { reason, caller, options })

  const {
    shouldStopCamera = false,
    closeEndConfirm = false,
    stopTick: shouldStopTick = true,
    stopToolCheck = true,
    stopMotionCheck = true,
    clearCountdown = true,
  } = options

  console.log('[work:teardown] reason=', reason)

  if (shouldStopTick) {
    console.log('[work:teardown] stop tick')
    stopTick()
  }

  if (stopToolCheck) {
    console.log('[work:teardown] cleanup tool')
    cleanupToolCheck(reason)
  }

  if (stopMotionCheck) {
    console.log('[work:teardown] cleanup motion')
    cleanupMotionCheck(reason)
  }

  if (clearCountdown && state.workCountdownTimeoutId != null) {
    console.log('[work:teardown] clear countdown')
    clearTimeout(state.workCountdownTimeoutId)
    state.workCountdownTimeoutId = null
  }

  if (closeEndConfirm) {
    state.endConfirmOpen = false
  }

  if (shouldStopCamera === true) {
    console.log('[work:teardown] stop camera')
    stopCamera()
    unlockWorkScreenOrientation()
  }

  console.log('[work:teardown] done')
}

function debugWorkSessionState() {
  console.log('[work:debug] session state', {
    isWorking: state.isWorking,
    screen: state.screen,
    isPaused: state.isPaused,
    endConfirmOpen: state.endConfirmOpen,
    workToolCheckDone: state.workToolCheckDone,
    workCountdownDone: state.workCountdownDone,
    tickIntervalId: tickIntervalId != null,
    workCountdownTimeoutId: state.workCountdownTimeoutId,
    cameraStreamActive: !!cameraStream,
    motionChecking: isMotionChecking,
    toolCheckPrepareTimeoutId: toolCheckPrepareTimeoutId != null,
    toolCheckIntervalId: toolCheckIntervalId != null,
    toolCheckHardStopTimeoutId: toolCheckHardStopTimeoutId != null,
    toolCheckSuccessClearTimeoutId: toolCheckSuccessClearTimeoutId != null,
    motionCheckTimeoutId: motionCheckTimeoutId != null,
    motionCheckIntervalId: motionCheckIntervalId != null,
    motionCheckWindowTimeoutId: motionCheckWindowTimeoutId != null,
    phase: getWorkSessionPhase(),
  })
}

function normalizeToastInput(input) {
  if (input == null) return null
  if (typeof input === 'string') {
    const msg = input.trim()
    if (!msg) return null
    return { type: 'info', message: msg }
  }
  if (typeof input === 'object') {
    const msg = String(input.message ?? '').trim()
    if (!msg) return null
    const type = input.type === 'success' || input.type === 'error' || input.type === 'info' ? input.type : 'info'
    const durationMs = Number(input.durationMs)
    return {
      type,
      message: msg,
      durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : undefined,
      dedupeKey: input.dedupeKey ? String(input.dedupeKey) : undefined,
    }
  }
  const msg = String(input).trim()
  if (!msg) return null
  return { type: 'info', message: msg }
}

function getToastDedupeKey(t) {
  return t.dedupeKey || `${t.type}:${t.message}`
}

function cleanupToastTimers() {
  if (toastHideTimerId) {
    clearTimeout(toastHideTimerId)
    toastHideTimerId = null
  }
  if (toastRemoveTimerId) {
    clearTimeout(toastRemoveTimerId)
    toastRemoveTimerId = null
  }
}

function removeActiveToast(reason = 'auto') {
  const active = state.activeToast
  state.activeToast = null
  cleanupToastTimers()
  const el = document.querySelector('[data-app-toast="active"]')
  if (el) {
    el.classList.remove('toast-visible')
    toastRemoveTimerId = setTimeout(() => el.remove(), 320)
  }
  console.log('[toast] remove', { reason, active })
}

function renderToast(toast) {
  // 既存の toast が残っていたら掃除（旧 showToast 互換）
  document.querySelectorAll('.toast').forEach((node) => {
    if (node.getAttribute('data-app-toast') !== 'active') node.remove()
  })

  let el = document.querySelector('[data-app-toast="active"]')
  if (!el) {
    el = document.createElement('div')
    el.className = 'toast'
    el.setAttribute('data-app-toast', 'active')
    document.body.appendChild(el)
  }

  // 見た目は変えない（type で class は増やさない）
  el.textContent = toast.message
  requestAnimationFrame(() => el.classList.add('toast-visible'))
}

function flushToastQueue() {
  if (state.activeToast) return
  const next = state.toastQueue.shift()
  if (!next) return
  state.activeToast = next
  console.log('[toast] show', { type: next.type, message: next.message })
  renderToast(next)

  const duration = next.durationMs ?? 2000
  cleanupToastTimers()
  toastHideTimerId = setTimeout(() => {
    removeActiveToast('timeout')
    // 次を表示
    setTimeout(() => flushToastQueue(), 0)
  }, duration)
}

/**
 * showToast('文字列') 互換 + showToast({type,message}) 新API
 * - 重複防止（短時間で同一dedupeKeyは無視）
 * - キューで同時表示は1件
 */
function showToast(input) {
  const t = normalizeToastInput(input)
  if (!t) return

  const dedupeKey = getToastDedupeKey(t)
  const now = Date.now()
  const last = Number(state.toastLastShownAt[dedupeKey] || 0)
  if (now - last < 800) {
    console.log('[toast] duplicate ignored', { dedupeKey })
    return
  }
  state.toastLastShownAt[dedupeKey] = now

  const toast = {
    id: state.toastNextId++,
    type: t.type,
    message: t.message,
    durationMs: t.durationMs,
    createdAt: now,
    dedupeKey,
  }

  // キュー側にも同一dedupeKeyがいたら追加しない
  if (state.toastQueue.some((x) => x.dedupeKey === dedupeKey)) {
    console.log('[toast] duplicate ignored', { dedupeKey, where: 'queue' })
    return
  }
  if (state.activeToast?.dedupeKey === dedupeKey) {
    console.log('[toast] duplicate ignored', { dedupeKey, where: 'active' })
    return
  }

  state.toastQueue.push(toast)
  flushToastQueue()
}

function cleanupOrphanToasts() {
  // active が無いのにDOMだけ残っているケースを掃除（透明残留防止）
  if (!state.activeToast) {
    const el = document.querySelector('[data-app-toast="active"]')
    if (el) {
      el.remove()
      console.log('[toast] remove', { reason: 'orphan_dom' })
    }
  }
}

function formatElapsed(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function updateWorkTimerDisplay() {
  const text = formatElapsed(state.elapsedSec)
  const timer = document.querySelector('[data-work-timer]')
  const overlayTimer = document.querySelector('[data-work-dark-overlay-timer]')
  if (timer) timer.textContent = text
  if (overlayTimer) overlayTimer.textContent = text
}

let workScreenDelegationBound = false
let workOrientationLocked = false
let workCameraOrientationRefreshTimer = null
/** 縦UIのまま物理的に横へ傾けた（devicemotion / orientationchange） */
let workCameraPhysLandscape = false
let workDeviceMotionListening = false

/** #work-camera に付与する表示クラス（rotate 90/180deg は使わない） */
const WORK_CAMERA_CLASS_USER_MIRROR = 'work-camera--user-mirror'
const WORK_CAMERA_CLASS_PHYS_LANDSCAPE = 'work-camera--phys-landscape'
const WORK_CAMERA_DISPLAY_CLASSES = [
  WORK_CAMERA_CLASS_USER_MIRROR,
  WORK_CAMERA_CLASS_PHYS_LANDSCAPE,
]

function isPhysicallyLandscapeWhilePortraitUi() {
  if (window.innerWidth > window.innerHeight) return true
  const angle = getScreenOrientationAngle()
  if (angle === 90 || angle === 270) return true
  const video = document.querySelector('#work-camera')
  if (video?.videoWidth > 0 && video.videoWidth > video.videoHeight) return true
  return workCameraPhysLandscape
}

function isIOSPlatform() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

function syncPlatformBodyClasses() {
  const ios = isIOSPlatform()
  document.documentElement.classList.toggle('is-ios', ios)
  document.body.classList.toggle('is-ios', ios)
}

function isLayoutPortrait() {
  return window.innerHeight >= window.innerWidth
}

function isActiveWorkOnWorkScreen() {
  return state.screen === 'work' && state.isWorking
}

/** 作業中に work 以外へ遷移してよいか（結果画面のホーム戻りは handleBackHome 経由） */
function canNavigateAwayFromActiveWork(nextScreen, reason) {
  if (!isActiveWorkOnWorkScreen()) return true
  if (nextScreen === 'work') return true
  console.warn('[nav] blocked: leave work during session', {
    from: state.screen,
    to: nextScreen,
    reason,
    phase: getWorkSessionPhase(),
  })
  return false
}

async function lockWorkScreenOrientation() {
  const ori = screen.orientation
  if (!ori?.lock) {
    console.log('[orientation] lock unavailable')
    return
  }
  try {
    await ori.lock('portrait-primary')
    workOrientationLocked = true
    console.log('[orientation] locked portrait-primary')
  } catch (err) {
    console.log('[orientation] lock failed', err?.message || String(err))
  }
}

function unlockWorkScreenOrientation() {
  if (!workOrientationLocked) return
  try {
    screen.orientation?.unlock?.()
    console.log('[orientation] unlocked')
  } catch (err) {
    console.log('[orientation] unlock failed', err?.message || String(err))
  }
  workOrientationLocked = false
}

function getScreenOrientationAngle() {
  if (typeof window.orientation === 'number' && window.orientation !== 0) {
    const a = window.orientation % 360
    return a < 0 ? a + 360 : a
  }
  if (typeof screen.orientation?.angle === 'number') {
    return screen.orientation.angle
  }
  return 0
}

function getWorkCameraTrackSettings() {
  const track = cameraStream?.getVideoTracks?.()?.[0]
  if (!track?.getSettings) return {}
  try {
    return track.getSettings()
  } catch {
    return {}
  }
}

/**
 * #work-camera の表示クラス（rotate 90/180 は使わない。フロントのみ左右ミラー可）
 * @param {HTMLVideoElement|null} videoEl
 */
function resolveWorkCameraDisplayState(videoEl) {
  const trackSettings = getWorkCameraTrackSettings()
  const facingMode = trackSettings.facingMode ?? 'user'
  const videoWidth = videoEl?.videoWidth ?? 0
  const videoHeight = videoEl?.videoHeight ?? 0
  const classes = []

  if (!videoEl || videoEl.readyState < 2 || !videoWidth || !videoHeight) {
    return {
      classes,
      reason: 'not-ready',
      physLandscape: false,
      facingMode,
      videoWidth,
      videoHeight,
      trackWidth: trackSettings.width ?? null,
      trackHeight: trackSettings.height ?? null,
    }
  }

  // iOS フロントカメラ: 縦持ち=左右ミラーのみ / 物理横持ち=上下反転のみ（同時適用しない）
  if (isIOSPlatform() && facingMode === 'user') {
    const physLandscape = isPhysicallyLandscapeWhilePortraitUi()
    if (physLandscape) {
      classes.push(WORK_CAMERA_CLASS_PHYS_LANDSCAPE)
    } else {
      classes.push(WORK_CAMERA_CLASS_USER_MIRROR)
    }
    return {
      classes,
      reason: physLandscape ? 'ios-flip-y-only' : 'ios-mirror-x-only',
      physLandscape,
      facingMode,
      videoWidth,
      videoHeight,
      trackWidth: trackSettings.width ?? null,
      trackHeight: trackSettings.height ?? null,
    }
  }

  return {
    classes,
    reason: 'no-display-class',
    physLandscape: false,
    facingMode,
    videoWidth,
    videoHeight,
    trackWidth: trackSettings.width ?? null,
    trackHeight: trackSettings.height ?? null,
  }
}

function logCameraFinalCheck(displayState, video, triggerSource) {
  const computed = video ? getComputedStyle(video) : null
  const appliedTransform = computed?.transform === 'none' ? '(cleared)' : computed?.transform || '(cleared)'
  const appliedClass = displayState.classes.join(' ') || '(none)'
  const payload = {
    source: triggerSource,
    facingMode: displayState.facingMode,
    videoWidth: displayState.videoWidth,
    videoHeight: displayState.videoHeight,
    trackWidth: displayState.trackWidth,
    trackHeight: displayState.trackHeight,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    screenOrientationType: screen.orientation?.type ?? null,
    screenOrientationAngle: getScreenOrientationAngle(),
    physLandscape: displayState.physLandscape ?? isPhysicallyLandscapeWhilePortraitUi(),
    htmlIsIos: document.documentElement.classList.contains('is-ios'),
    bodyIsIos: document.body.classList.contains('is-ios'),
    appliedClass,
    appliedTransform,
    objectFit: computed?.objectFit ?? null,
    objectPosition: computed?.objectPosition ?? null,
    reason: displayState.reason,
    inlineTransform: video?.style?.transform || '',
  }
  console.log('[camera-final-check]', payload)
  console.log(
    `[camera-final-check] summary source=${payload.source} reason=${payload.reason} phys=${payload.physLandscape} class=${payload.appliedClass} transform=${payload.appliedTransform}`
  )
}

function resetWorkCameraVideoDisplay(videoEl) {
  const video = videoEl || document.querySelector('#work-camera')
  if (!video) return
  video.style.transform = ''
  video.style.transformOrigin = ''
  video.classList.remove(...WORK_CAMERA_DISPLAY_CLASSES)
  video.style.removeProperty('--work-camera-cover-scale')
  workCameraPhysLandscape = false
  stopWorkDeviceMotionListener()
}

function syncWorkCameraVideoDisplay(triggerSource = 'sync') {
  const video = document.querySelector('#work-camera')
  if (!video) {
    console.log('[camera] sync skip', { triggerSource, reason: 'no-video-element' })
    return
  }
  if (state.screen !== 'work') {
    console.log('[camera] sync skip', {
      triggerSource,
      reason: 'not-work-screen',
      screen: state.screen,
    })
    return
  }

  // rotate 補正は使わない（inline transform は常にクリア）
  video.style.transform = ''
  video.style.transformOrigin = ''
  video.style.objectFit = 'cover'
  video.style.objectPosition = 'center center'

  const displayState = resolveWorkCameraDisplayState(video)
  video.classList.remove(...WORK_CAMERA_DISPLAY_CLASSES)
  displayState.classes.forEach((cls) => video.classList.add(cls))

  logCameraFinalCheck(displayState, video, triggerSource)
}

/** @deprecated 互換エイリアス */
function syncWorkCameraVideoTransform(triggerSource) {
  syncWorkCameraVideoDisplay(triggerSource)
}

/**
 * 縦画面ロック中の物理横持ちを重力で推定（DeviceOrientation 許可不要）
 * @returns {boolean|null} true=横置き相当, false=縦持ち相当, null=判定保留
 */
function inferPhysLandscapeFromGravity(x, y, z) {
  if (x == null || y == null) return null
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  const az = Math.abs(z ?? 0)
  if (ay > 7 && ay > ax * 1.15) return false
  if (ax > 6 && ax > ay * 1.1 && az < 9.5) return true
  return null
}

function onWorkDeviceMotion(event) {
  if (!isActiveWorkOnWorkScreen()) return
  const g = event.accelerationIncludingGravity
  if (!g) return
  const next = inferPhysLandscapeFromGravity(g.x, g.y, g.z)
  if (next === null || next === workCameraPhysLandscape) return
  workCameraPhysLandscape = next
  console.log('[camera] motion physLandscape=', next, {
    x: Number(g.x?.toFixed(2)),
    y: Number(g.y?.toFixed(2)),
    z: Number(g.z?.toFixed(2)),
  })
  syncWorkCameraVideoDisplay('device-motion')
}

function startWorkDeviceMotionListener() {
  if (workDeviceMotionListening || !window.DeviceMotionEvent) return
  window.addEventListener('devicemotion', onWorkDeviceMotion, true)
  workDeviceMotionListening = true
  console.log('[camera] devicemotion listener started')
}

function stopWorkDeviceMotionListener() {
  if (!workDeviceMotionListening) return
  window.removeEventListener('devicemotion', onWorkDeviceMotion, true)
  workDeviceMotionListening = false
  console.log('[camera] devicemotion listener stopped')
}

function bindWorkCameraVideoListeners(videoEl) {
  if (!videoEl || videoEl.dataset.workCameraListeners === '1') return
  videoEl.dataset.workCameraListeners = '1'
  videoEl.addEventListener(
    'resize',
    () => syncWorkCameraVideoDisplay('video-resize'),
    { passive: true }
  )
  videoEl.addEventListener(
    'loadedmetadata',
    () => syncWorkCameraVideoDisplay('video-loadedmetadata'),
    { passive: true }
  )
}

/**
 * iOS Safari: 端末の向きが変わったときプレビュー再同期（CSS rotate は使わない）
 */
function scheduleWorkCameraOrientationRefresh(source) {
  if (!isActiveWorkOnWorkScreen() || !cameraStream) return
  if (workCameraOrientationRefreshTimer != null) {
    clearTimeout(workCameraOrientationRefreshTimer)
  }
  workCameraOrientationRefreshTimer = setTimeout(() => {
    workCameraOrientationRefreshTimer = null
    void refreshWorkCameraPreviewOnOrientation(source)
  }, 120)
}

async function refreshWorkCameraPreviewOnOrientation(source) {
  const video = document.querySelector('#work-camera')
  if (!video || !cameraStream || state.screen !== 'work') return
  console.log('[camera] orientation refresh start', {
    source,
    physLandscape: workCameraPhysLandscape,
  })
  try {
    const track = cameraStream.getVideoTracks()[0]
    if (track?.applyConstraints) {
      await track.applyConstraints({ facingMode: { ideal: 'user' } })
    }
  } catch (err) {
    console.log('[camera] applyConstraints skip', err?.message || String(err))
  }
  try {
    video.srcObject = null
    await new Promise((r) => requestAnimationFrame(r))
    await attachCameraToVideo(video)
    syncWorkCameraVideoDisplay(`orientation-refresh:${source}`)
    console.log('[camera] orientation refresh done', { source })
  } catch (err) {
    console.error('[camera] orientation refresh fail', err)
  }
}

/** resize / orientationchange 時（作業中は patch せずカメラ・ヒントのみ） */
function handleWorkViewportChange(source) {
  if (!isActiveWorkOnWorkScreen()) return
  if (isIOSPlatform() && source === 'orientation') {
    workCameraPhysLandscape = true
    console.log('[camera] orientationchange → physLandscape=true')
    scheduleWorkCameraOrientationRefresh(source)
  } else {
    syncWorkCameraVideoDisplay(source)
  }
  updateWorkTimerDisplay()
  const hint = document.querySelector('[data-work-landscape-hint]')
  if (hint) {
    const showPortraitHint = !isLayoutPortrait()
    hint.hidden = !showPortraitHint
    if (showPortraitHint) hint.textContent = '縦向きでお使いください'
  }
}

/** 作業画面 UI 用の派生状態（full render / patch 共通） */
function computeWorkScreenUi() {
  const workPhase = getWorkSessionPhase()
  const showPortraitHint = !isLayoutPortrait()
  const isCheckingToolPhase = workPhase === WORK_SESSION_PHASE.CHECKING_TOOL
  const isCountdownPhase = workPhase === WORK_SESSION_PHASE.COUNTDOWN
  const isPausedPhase = workPhase === WORK_SESSION_PHASE.PAUSED
  const isRunningPhase = workPhase === WORK_SESSION_PHASE.RUNNING
  const isEndConfirmPhase = workPhase === WORK_SESSION_PHASE.END_CONFIRM
  const hasCountdownCompleted =
    isRunningPhase || ((isPausedPhase || isEndConfirmPhase) && state.workCountdownDone)
  const showRescueCountdownHint =
    (isCountdownPhase || isPausedPhase || isEndConfirmPhase) &&
    !hasCountdownCompleted &&
    state.toolCheckUsedRescuePath
  const showNormalCountdownHint =
    (isCountdownPhase || isPausedPhase || isEndConfirmPhase) &&
    !hasCountdownCompleted &&
    !state.toolCheckUsedRescuePath
  const isWorkPaused = isPausedPhase || (isEndConfirmPhase && state.isPaused)
  const isBackgroundAutoPaused = isPausedPhase && state.autoPausedReason === 'background'
  const isMotionAutoPaused = isPausedPhase && state.autoPausedReason === 'motion'
  const showManualPauseHint =
    hasCountdownCompleted && !isBackgroundAutoPaused && !isMotionAutoPaused && isWorkPaused
  const pauseLabel = isWorkPaused ? '再開' : '一時停止'
  const pauseHudDisabled = isEndConfirmPhase || isCheckingToolPhase
  const endHudDisabled = isEndConfirmPhase

  return {
    workPhase,
    showPortraitHint,
    isCheckingToolPhase,
    pauseLabel,
    pauseHudDisabled,
    endHudDisabled,
    showManualPauseHint,
    isBackgroundAutoPaused,
    isMotionAutoPaused,
    showRescueCountdownHint,
    showNormalCountdownHint,
    toolCheckSuccessFlash: state.toolCheckSuccessFlash,
    toolCheckPrepareDone: state.toolCheckPrepareDone,
    darkMode: state.darkMode,
    boostActive: state.boostActive,
    cameraError: state.cameraError,
    endConfirmOpen: state.endConfirmOpen,
    timerText: formatElapsed(state.elapsedSec),
  }
}

function buildWorkPopMarkup(ui) {
  const parts = []
  if (ui.toolCheckSuccessFlash) {
    parts.push('<p class="work-pop">認識できました<br>作業を開始します</p>')
  }
  if (ui.isCheckingToolPhase && !ui.toolCheckSuccessFlash && !ui.toolCheckPrepareDone) {
    parts.push('<p class="work-pop">画面を認識中です。手元を写してください</p>')
  }
  if (ui.isCheckingToolPhase && !ui.toolCheckSuccessFlash && ui.toolCheckPrepareDone) {
    parts.push('<p class="work-pop">画像を認識中です。手元を写してください</p>')
  }
  if (ui.showRescueCountdownHint) {
    parts.push('<p class="work-pop">タイマーは10秒後に自動で開始します</p>')
  }
  if (ui.showNormalCountdownHint) {
    parts.push('<p class="work-pop">手元を写してください<br>タイマーは10秒後にスタートします</p>')
  }
  if (ui.showManualPauseHint) {
    parts.push('<p class="work-pop">一時停止</p>')
  }
  if (ui.isBackgroundAutoPaused) {
    parts.push(
      '<p class="work-pop work-pop-autopause">画面から離れたため一時停止になりました。再開ボタンをタップしてください</p>'
    )
  }
  if (ui.isMotionAutoPaused) {
    parts.push(
      '<p class="work-pop work-pop-autopause">画面を認識できませんでした。続けるには再開ボタンを押してください</p>'
    )
  }
  return parts.join('')
}

function buildWorkScreenHtml() {
  return `
    <div class="work-screen workRoot" data-work-root>
      <video id="work-camera" class="work-video" muted playsinline webkit-playsinline autoplay disablePictureInPicture></video>
      <div class="workHUD" data-work-hud>
        <p class="landscapeHint" data-work-landscape-hint hidden>縦向きでお使いください</p>
        <p class="boost-status" data-work-boost-status hidden>ブースト中（20分で砂時計+1）</p>
        <div class="work-timer" data-work-timer>00:00</div>
        <p class="camera-error" data-work-camera-error hidden></p>
        <div class="work-buttons">
          <div class="dark-mode-toggle" data-dark-mode-toggle>
            <span class="dark-mode-label" data-work-dark-label>暗幕 OFF</span>
            <button class="dark-mode-switch" type="button" data-btn-dark-toggle data-work-dark-toggle aria-pressed="false" aria-label="暗幕 OFF"></button>
          </div>
          <button class="work-pause-btn" type="button" data-btn-pause-resume data-work-pause-button>一時停止</button>
          <button class="work-end-btn" type="button" data-btn-end-work data-work-end-button>終了</button>
        </div>
      </div>
      <div data-work-pops></div>
      <div class="dark-overlay" data-work-dark-overlay data-dark-overlay hidden>
        <div class="dark-overlay-timer" data-work-dark-overlay-timer data-dark-overlay-timer>00:00</div>
        <p class="dark-overlay-hint">タップで暗幕を解除</p>
      </div>
    </div>
    <div class="end-confirm-modal-overlay" data-work-end-confirm data-end-confirm-overlay hidden>
      <div class="end-confirm-modal" role="dialog" aria-labelledby="end-confirm-title">
        <p id="end-confirm-title" class="end-confirm-title">終了しますか</p>
        <div class="end-confirm-actions">
          <button class="end-confirm-btn end-confirm-btn-end" type="button" data-end-confirm-yes>終了</button>
          <button class="end-confirm-btn end-confirm-btn-cancel" type="button" data-end-confirm-cancel>キャンセル</button>
        </div>
      </div>
    </div>
  `
}

function cleanupDuplicateWorkEndConfirmOverlays() {
  const all = document.querySelectorAll('[data-work-end-confirm]')
  if (all.length <= 1) return
  all.forEach((el, index) => {
    if (index > 0) {
      el.remove()
      console.log('[work:endConfirm] duplicate removed')
    }
  })
}

function blurIfFocusInside(element) {
  if (!element) return
  const active = document.activeElement
  if (active && element.contains(active) && typeof active.blur === 'function') {
    active.blur()
  }
}

/** 終了確認オーバーレイの表示（[hidden] だけでは .end-confirm-modal-overlay の display:flex に負けるため style も同期） */
function syncWorkEndConfirmOverlay(endConfirm, isOpen) {
  if (!endConfirm) return
  const open = !!isOpen
  if (!open) {
    blurIfFocusInside(endConfirm)
  }
  endConfirm.hidden = !open
  endConfirm.setAttribute('aria-hidden', open ? 'false' : 'true')
  endConfirm.classList.toggle('end-confirm-modal-overlay--closed', !open)
  endConfirm.style.display = open ? 'flex' : 'none'
  endConfirm.style.pointerEvents = open ? 'auto' : 'none'
}

function bindWorkScreenDelegationOnce() {
  if (workScreenDelegationBound) return
  workScreenDelegationBound = true
  const app = document.querySelector('#app')
  if (!app) return
  app.addEventListener('click', (e) => {
    if (state.screen !== 'work') return
    if (e.target.closest('[data-btn-pause-resume]')) {
      workSession.togglePauseResume()
      return
    }
    if (e.target.closest('[data-btn-end-work]')) {
      workSession.requestEndDialog()
      return
    }
    if (e.target.closest('[data-btn-dark-toggle]')) {
      handleDarkToggle()
      return
    }
    if (e.target.closest('[data-work-dark-overlay]')) {
      handleDarkOverlayTap()
      return
    }
    if (e.target.closest('[data-end-confirm-yes]')) {
      void workSession.confirmEnd().catch((err) => console.error('[workSession] confirmEnd', err))
      return
    }
    if (e.target.closest('[data-end-confirm-cancel]')) {
      workSession.cancelEndDialog()
      return
    }
    const endOverlay = e.target.closest('[data-end-confirm-overlay]')
    if (endOverlay && e.target === endOverlay) {
      workSession.cancelEndDialog()
    }
  })
}

function shouldPatchWorkScreen(forceFull) {
  if (forceFull) return false
  if (state.screen !== 'work') return false
  return !!document.querySelector('[data-work-root]')
}

function patchWorkScreen() {
  if (state.screen !== 'work') return false
  const root = document.querySelector('[data-work-root]')
  if (!root) return false

  console.log('[work:patch] start')
  const ui = computeWorkScreenUi()

  console.log('[work:patch] timer')
  updateWorkTimerDisplay()

  const hud = root.querySelector('[data-work-hud]')
  if (hud) {
    hud.classList.toggle('workHUD-dark', ui.darkMode)
  }

  const timerEl = root.querySelector('[data-work-timer]')
  if (timerEl) {
    timerEl.classList.toggle('work-timer-center', ui.darkMode)
  }

  const landscapeHint = root.querySelector('[data-work-landscape-hint]')
  if (landscapeHint) landscapeHint.hidden = !ui.showPortraitHint

  const boostEl = root.querySelector('[data-work-boost-status]')
  if (boostEl) boostEl.hidden = !ui.boostActive

  const cameraErr = root.querySelector('[data-work-camera-error]')
  if (cameraErr) {
    if (ui.cameraError) {
      cameraErr.textContent = ui.cameraError
      cameraErr.hidden = false
    } else {
      cameraErr.hidden = true
    }
  }

  console.log('[work:patch] pause')
  const pauseBtn = root.querySelector('[data-work-pause-button]')
  if (pauseBtn) {
    pauseBtn.textContent = ui.pauseLabel
    pauseBtn.disabled = ui.pauseHudDisabled
  }
  const endBtn = root.querySelector('[data-work-end-button]')
  if (endBtn) endBtn.disabled = ui.endHudDisabled

  const darkLabel = root.querySelector('[data-work-dark-label]')
  if (darkLabel) darkLabel.textContent = `暗幕 ${ui.darkMode ? 'ON' : 'OFF'}`
  const darkSwitch = root.querySelector('[data-work-dark-toggle]')
  if (darkSwitch) {
    darkSwitch.classList.toggle('is-on', ui.darkMode)
    darkSwitch.setAttribute('aria-pressed', ui.darkMode ? 'true' : 'false')
    darkSwitch.setAttribute('aria-label', `暗幕 ${ui.darkMode ? 'ON' : 'OFF'}`)
  }

  console.log('[work:patch] dark')
  const darkOverlay = root.querySelector('[data-work-dark-overlay]')
  if (darkOverlay) {
    darkOverlay.hidden = !ui.darkMode
    darkOverlay.style.display = ui.darkMode ? 'flex' : 'none'
    darkOverlay.style.pointerEvents = ui.darkMode ? 'auto' : 'none'
  }

  console.log('[work:patch] phase')
  const pops = root.querySelector('[data-work-pops]')
  if (pops) pops.innerHTML = buildWorkPopMarkup(ui)

  cleanupDuplicateWorkEndConfirmOverlays()
  const endConfirm = document.querySelector('#app [data-work-end-confirm]')
  syncWorkEndConfirmOverlay(endConfirm, ui.endConfirmOpen)
  if (ui.endConfirmOpen) {
    console.log('[work:patch] endConfirm open')
  } else {
    console.log('[work:patch] endConfirm close')
  }

  syncChromeBodyClasses()
  return true
}

/** 作業画面中は patch を優先。DOM 未生成時は full render */
function refreshWorkScreenUI(options = {}) {
  const forceFull = options.forceFull === true
  if (shouldPatchWorkScreen(forceFull)) {
    patchWorkScreen()
    console.log('[render] patch work screen', { reason: options.reason || 'work-ui' })
    return
  }
  render({ ...options, forceFull: true, reason: options.reason || 'work-ui-full' })
}

const BASE_WIDTH = 1080

/** 画面幅に基づくスケール係数（スマホ実機で適切なサイズになるよう幅基準） */
function getViewportScale() {
  return window.innerWidth / BASE_WIDTH
}

/** Home の 1080×1790 コンテナをスマホ幅に合わせてスケール（幅基準で画面いっぱいに表示） */
function applyHomeScale() {
  const container = document.querySelector('.home-container')
  const wrapper = document.querySelector('.home-scale-wrapper')
  if (!container) return
  const baseHeight = 1790
  const scale = getViewportScale()
  container.style.transform = `scale(${scale})`
  if (wrapper) {
    wrapper.style.width = `${BASE_WIDTH * scale}px`
    wrapper.style.height = `${baseHeight * scale}px`
  }
}

const GAME_BASE_WIDTH = 375

const OFFICIAL_SNS_LINKS = {
  instagram:
    'https://www.instagram.com/wakupork777?igsh=Z3BpOHYwcTZtY3Js&utm_source=qr',
  x: 'https://x.com/gkxlk7net146290?s=11',
  tiktok: 'https://www.tiktok.com/@wakupokustvila?_r=1&_t=ZS-97C2ORRvjeR',
}

/** 豚ガラポン: 等級→ポイント・配色ラベル */
const GARAPON_TIER_POINTS = { 6: 50, 5: 100, 4: 300, 3: 1000, 2: 5000, 1: 10000 }
const GARAPON_STAR_BONUS_POINTS = 50
/** ⭐️枠（ルーレット限定アイコン） */
const GARAPON_SLOT_STAR = 'star'
const GARAPON_SEGMENT_COUNT = 7
const GARAPON_SEGMENT_DEG = 360 / GARAPON_SEGMENT_COUNT
const GARAPON_STAR_WEIGHT = 0.2
/** ⭐️あり時: 6→37% 5→35% 4→5% 3→2% 2→0.6% 1→0.4% ⭐️→20%（合計100%） */
const GARAPON_ROLL_TABLE_WITH_STAR = [
  [6, 0.37],
  [5, 0.35],
  [4, 0.05],
  [3, 0.02],
  [2, 0.006],
  [1, 0.004],
  [GARAPON_SLOT_STAR, GARAPON_STAR_WEIGHT],
]
/** アイコンコンプリート時（⭐️なし）: 6→48% 5→44% 4→5% 3→2% 2→0.6% 1→0.4%（合計100%） */
const GARAPON_ROLL_TABLE_COMPLETE = [
  [6, 0.48],
  [5, 0.44],
  [4, 0.05],
  [3, 0.02],
  [2, 0.006],
  [1, 0.004],
]

function buildGaraponRollTable(starEligible) {
  return starEligible ? GARAPON_ROLL_TABLE_WITH_STAR : GARAPON_ROLL_TABLE_COMPLETE
}

function rollGaraponSlot(starEligible) {
  const table = buildGaraponRollTable(starEligible)
  let u = Math.random()
  for (const [slot, prob] of table) {
    if (u < prob) return slot
    u -= prob
  }
  return 1
}

function garaponSlotToSegmentIndex(slot) {
  if (slot === GARAPON_SLOT_STAR) return GARAPON_SEGMENT_COUNT - 1
  return 6 - slot
}

function garaponSegmentIndexToSlot(segmentIndex) {
  if (segmentIndex >= GARAPON_SEGMENT_COUNT - 1) return GARAPON_SLOT_STAR
  return 6 - segmentIndex
}

/** 累積回転角 totalDeg のとき、上の矢印で止まっている枠（1〜6等 or ⭐️） */
function garaponSlotAtPointer(totalDeg) {
  const W = ((totalDeg % 360) + 360) % 360
  const a = ((360 - W) % 360 + 360) % 360
  const segmentIndex = Math.min(
    GARAPON_SEGMENT_COUNT - 1,
    Math.floor(a / GARAPON_SEGMENT_DEG)
  )
  return garaponSegmentIndexToSlot(segmentIndex)
}

/** @deprecated 互換用。garaponSlotAtPointer を使用 */
function garaponTierAtPointer(totalDeg) {
  const slot = garaponSlotAtPointer(totalDeg)
  return slot === GARAPON_SLOT_STAR ? 6 : slot
}

function buildGaraponWheelLabelsHtml() {
  return `
                  <span class="garapon-wheel-label" data-tier="6" style="--i:0">6</span>
                  <span class="garapon-wheel-label" data-tier="5" style="--i:1">5</span>
                  <span class="garapon-wheel-label" data-tier="4" style="--i:2">4</span>
                  <span class="garapon-wheel-label" data-tier="3" style="--i:3">3</span>
                  <span class="garapon-wheel-label" data-tier="2" style="--i:4">2</span>
                  <span class="garapon-wheel-label" data-tier="1" style="--i:5">1</span>
                  <span class="garapon-wheel-label garapon-wheel-label--star" data-tier="star" style="--i:6" aria-label="⭐️">⭐️</span>`
}

function createGaraponSpinSourceRef() {
  const rand = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 12)
  return `roulette:${Date.now()}:${rand}`
}

function pickRandomRouletteIconKey(rows) {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return null
  const row = list[Math.floor(Math.random() * list.length)]
  return row?.icon_key || null
}

let garaponAppDelegationBound = false
let gameAppDelegationBound = false
let gameGiftClaimInProgress = false

const GARAPON_HELP_ROULETTE_ICON_NAMES = [
  'ルーレット ⭐️ 1',
  'ルーレット ⭐️ 2',
  'ルーレット ⭐️ 3',
  'ルーレット ⭐️ 4',
  'ルーレット ⭐️ 5',
]

function buildGaraponHelpTierRowsHtml() {
  return [6, 5, 4, 3, 2, 1]
    .map(
      (tier) =>
        `<li class="garapon-help-tier-row"><span class="garapon-help-tier-label">${tier}等</span><span class="garapon-help-tier-pt">${GARAPON_TIER_POINTS[tier]} pt</span></li>`
    )
    .join('')
}

function buildGaraponHelpIconListHtml(iconRows) {
  const names =
    Array.isArray(iconRows) && iconRows.length
      ? iconRows.map((row) => String(row.display_name || row.icon_key || '').trim()).filter(Boolean)
      : GARAPON_HELP_ROULETTE_ICON_NAMES
  if (!names.length) {
    return '<li class="garapon-help-icon-name garapon-help-icon-name--empty">（登録なし）</li>'
  }
  return names.map((name) => `<li class="garapon-help-icon-name">${escapeHtml(name)}</li>`).join('')
}

function buildGaraponHelpBodySectionsHtml(iconRows) {
  return `
          <section class="garapon-help-section">
            <h3 class="garapon-help-section-title">各等のポイント</h3>
            <ul class="garapon-help-tier-list">${buildGaraponHelpTierRowsHtml()}</ul>
          </section>
          <section class="garapon-help-section">
            <h3 class="garapon-help-section-title">⭐️の報酬</h3>
            <p class="garapon-help-text">⭐️に止まると、<strong>未所持</strong>のルーレット限定アイコンを1つランダムで獲得できます。さらにボーナス<strong>${GARAPON_STAR_BONUS_POINTS} pt</strong>が付きます。</p>
            <p class="garapon-help-text garapon-help-text--sub">既に所持しているアイコンが当選した場合は、ボーナス<strong>${GARAPON_STAR_BONUS_POINTS} pt</strong>のみ獲得します。</p>
            <p class="garapon-help-text garapon-help-text--sub">5種すべて所持済みの場合、ルーレットに⭐️枠は出ません（6等〜1等のみ）。</p>
          </section>
          <section class="garapon-help-section">
            <h3 class="garapon-help-section-title">ルーレット限定アイコン</h3>
            <ul class="garapon-help-icon-list">${buildGaraponHelpIconListHtml(iconRows)}</ul>
          </section>`
}

function buildGaraponHelpOverlayHtml(iconRows = null) {
  return `<div class="modal-overlay modal-open garapon-help-overlay app-modal-overlay app-modal-open" data-garapon-help-overlay data-modal-overlay data-modal-type="${MODAL_TYPES.GARAPON_HELP}">
        <div class="garapon-help-sheet app-modal-content" role="dialog" aria-modal="true" aria-label="ガラポンヘルプ">
          <button type="button" class="garapon-help-close" data-modal-action="close" data-modal-type="${MODAL_TYPES.GARAPON_HELP}" aria-label="閉じる">×</button>
          <h2 class="garapon-help-title">ヘルプ</h2>
          <div class="garapon-help-body">${buildGaraponHelpBodySectionsHtml(iconRows)}</div>
        </div>
      </div>`
}

async function patchGaraponHelpIconList() {
  if (!state.garaponHelpOpen || state.screen !== 'garapon') return
  const masterRes = await fetchRouletteEligibleIconMaster()
  if (!state.garaponHelpOpen) return
  const iconRows = masterRes.ok ? masterRes.data : null
  const body = document.querySelector('[data-garapon-help-overlay] .garapon-help-body')
  if (!body) return
  body.innerHTML = buildGaraponHelpBodySectionsHtml(iconRows)
}

function openGaraponHelp() {
  console.log('[garapon] open help')
  openModal(MODAL_TYPES.GARAPON_HELP, null, { closeOthers: false })
  void patchGaraponHelpIconList()
}

function closeGaraponHelp() {
  console.log('[garapon] overlay close', 'help')
  closeModalByType(MODAL_TYPES.GARAPON_HELP)
}

function openMissionPanel() {
  console.log('[mission] panel open')
  openModal(MODAL_TYPES.MISSION_PANEL, null, { closeOthers: false })
}

function closeMissionPanel() {
  console.log('[mission] overlay close', 'panel')
  closeModalByType(MODAL_TYPES.MISSION_PANEL)
}

function patchGaraponTicketDisplay() {
  const el = document.querySelector('[data-garapon-tickets]')
  if (el) el.textContent = `×${state.pigTickets}`
}

function patchGaraponOverlays() {
  const app = getAppEl()
  if (!app || state.screen !== 'garapon') return

  if (state.garaponHelpOpen) {
    ensureModalOverlay(MODAL_TYPES.GARAPON_HELP, () => buildGaraponHelpOverlayHtml())
    void patchGaraponHelpIconList()
  } else {
    removeModalOverlay(MODAL_TYPES.GARAPON_HELP)
  }

  const existingReward = app.querySelector('[data-garapon-modal-overlay]')
  if (state.rewardPopup) {
    const rewardType = state.activeModal || MODAL_TYPES.REWARD
    if (!existingReward) {
      const wantsAnim = consumeRewardSheetEntryAnim()
      app.insertAdjacentHTML(
        'beforeend',
        buildRewardModalOverlayHtml(
          state.rewardPopup,
          'data-garapon-modal-overlay',
          'data-modal-close',
          'data-modal-action="close" data-modal-type="reward"',
          rewardType
        )
      )
      const overlay = app.querySelector('[data-garapon-modal-overlay]')
      if (overlay && wantsAnim) kickRewardSheetEntryAnim(overlay)
    }
    const overlay = app.querySelector('[data-garapon-modal-overlay]')
    if (overlay) applyOverlayOpenClasses(overlay, true, rewardType)
  } else if (existingReward) {
    existingReward.remove()
    console.log('[overlay] remove', 'garaponReward')
  }

  syncBodyScrollLock()
}

function shouldPatchGaraponScreen(forceFull) {
  if (forceFull || state.screen !== 'garapon') return false
  if (!document.querySelector('#app .garapon-screen')) return false
  return true
}

function patchGaraponScreen() {
  if (isLoading('garapon')) {
    console.log('[garapon] patch skipped during spin')
  }
  syncChromeBodyClasses()
  updateFooterActive('garapon')
  patchGaraponTicketDisplay()
  patchGaraponSpinButton()
  patchGaraponOverlays()
  cleanupOrphanOverlays()
  syncBodyScrollLock()
  applyGaraponScale()
  schedulePangleBannerRefresh()
}

function bindGaraponAppDelegationOnce() {
  if (garaponAppDelegationBound) return
  garaponAppDelegationBound = true
  bindModalAppDelegationOnce()
  const app = document.querySelector('#app')
  if (!app) return

  app.addEventListener('click', (e) => {
    if (state.screen !== 'garapon') return

    if (e.target.closest('[data-garapon-help]')) {
      openGaraponHelp()
      return
    }
    if (e.target.closest('[data-garapon-help-close]')) {
      closeGaraponHelp()
      return
    }
    const helpOverlay = e.target.closest('[data-garapon-help-overlay]')
    if (helpOverlay && e.target === helpOverlay) {
      closeGaraponHelp()
      return
    }

    if (e.target.closest('[data-garapon-spin]')) {
      void handleGaraponSpin()
      return
    }

    if (e.target.closest('[data-garapon-back]')) {
      if (isLoading('garapon')) {
        console.log('[garapon] spin blocked', 'back')
        showToast({ type: 'info', message: 'ガラポンが回転中です' })
        return
      }
      if (state.rewardPopup) {
        closeModal()
        return
      }
      if (state.garaponHelpOpen) {
        closeGaraponHelp()
        return
      }
      changeScreen('game', {
        reason: 'garapon-back',
        beforeChange: () => {
          state.rewardPopup = null
          state.garaponHelpOpen = false
        },
      })
      return
    }

    const rewardOverlay = e.target.closest('[data-garapon-modal-overlay]')
    if (rewardOverlay && e.target === rewardOverlay) {
      closeModal()
      return
    }
    if (e.target.closest('[data-modal-close]')) {
      closeModal()
    }
  })
}

async function handleGaraponSpin() {
  if (isLoading('garapon')) {
    console.log('[garapon] spin blocked')
    return
  }
  if (state.pigTickets < 5) {
    showToast({ type: 'info', message: '豚チケットが足りません（5枚必要）' })
    return
  }

  console.log('[garapon] spin start')
  return withLoading('garapon', async () => {
    if (state.garaponHelpOpen) {
      state.garaponHelpOpen = false
      state.activeModal = null
      removeModalOverlay(MODAL_TYPES.GARAPON_HELP)
    }
    if (state.rewardPopup) {
      clearModalStateForType(state.activeModal || MODAL_TYPES.REWARD)
      const rewardEl = getAppEl()?.querySelector('[data-garapon-modal-overlay]')
      rewardEl?.remove()
    }

    const consumed = await usePigTickets(5, 'roulette_use', 'ガラポン消費', { skipRender: true })
    if (!consumed) {
      console.log('[garapon] spin failed', 'no tickets')
      showToast({ type: 'info', message: '豚チケットが足りません（5枚必要）' })
      patchGaraponScreen()
      return
    }

    patchGaraponTicketDisplay()
    patchGaraponSpinButton()

    const eligibleRes = await getEligibleRouletteIconsForUser()
    const eligibleIcons = eligibleRes.ok ? eligibleRes.data : []
    state.rouletteEligibleIcons = eligibleIcons
    const starEligible = eligibleIcons.length > 0
    const slot = rollGaraponSlot(starEligible)
    const prevDeg = state.garaponWheelDeg || 0
    const segmentIndex = garaponSlotToSegmentIndex(slot)
    const spins = 6 + Math.floor(Math.random() * 2)
    const r = ((prevDeg % 360) + 360) % 360
    const halfSegment = GARAPON_SEGMENT_DEG / 2
    const targetResidue = ((-halfSegment - segmentIndex * GARAPON_SEGMENT_DEG) % 360 + 360) % 360
    const adjust = (targetResidue - r + 360) % 360
    const delta = spins * 360 + adjust
    const nextDeg = prevDeg + delta
    const spinSourceRef = createGaraponSpinSourceRef()

    await new Promise((resolve, reject) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const inner = document.querySelector('.garapon-wheel-inner')
          if (!inner) {
            console.log('[garapon] spin failed', 'wheel missing')
            void addPigTickets(5, 'manual_adjust', 'ガラポン失敗時の返却', { skipRender: true }).catch((e) =>
              console.error('[pig_tickets] failed', e)
            )
            patchGaraponScreen()
            reject(new Error('garapon wheel missing'))
            return
          }
          inner.style.transition = 'none'
          inner.style.transform = `rotate(${prevDeg}deg)`
          void inner.getBoundingClientRect()
          inner.style.transition = 'transform 5.5s cubic-bezier(0.12, 0.75, 0.18, 1)'
          inner.style.transform = `rotate(${nextDeg}deg)`

          const onEnd = (ev) => {
            if (ev.propertyName !== 'transform') return
            inner.removeEventListener('transitionend', onEnd)
            state.garaponWheelDeg = nextDeg
            const awardSlot = garaponSlotAtPointer(nextDeg)
            if (awardSlot !== slot) {
              console.warn('[garapon] slot vs wheel mismatch', { rolled: slot, atPointer: awardSlot, nextDeg })
            }

            const finishSpin = async () => {
              if (awardSlot === GARAPON_SLOT_STAR) {
                const latestRes = await getEligibleRouletteIconsForUser()
                const latestEligible = latestRes.ok ? latestRes.data : []
                state.rouletteEligibleIcons = latestEligible
                const iconKey = pickRandomRouletteIconKey(latestEligible)
                if (!iconKey) {
                  console.warn('[garapon] star slot but no eligible icons', { spinSourceRef })
                  showToast({ type: 'info', message: '獲得できるアイコンがありませんでした' })
                  patchGaraponTicketDisplay()
                  patchGaraponOverlays()
                  resolve()
                  return
                }
                const grantRes = await grantIconToUser(
                  state.userId || getUserId(),
                  iconKey,
                  'roulette',
                  spinSourceRef
                )
                if (!grantRes.ok) {
                  console.error('[garapon] icon grant failed', grantRes.error)
                  notifyApiFailure(grantRes.error, 'default')
                  patchGaraponTicketDisplay()
                  patchGaraponOverlays()
                  resolve()
                  return
                }
                console.log('[garapon] spin success', { awardSlot, iconKey, granted: grantRes.granted })
                const bonusPt = GARAPON_STAR_BONUS_POINTS
                if (grantRes.granted) {
                  console.log('[garapon] result open icon + points', { iconKey, bonusPt })
                  const opened = openRewardPopupWithGuard({
                    items: [
                      {
                        type: 'icon',
                        iconKey,
                        granted: true,
                        message: '新しいアイコンを獲得しました！',
                      },
                      { type: 'points', amount: bonusPt },
                    ],
                  })
                  if (opened) patchGaraponOverlays()
                } else {
                  console.log('[garapon] icon already owned', { iconKey, spinSourceRef, bonusPt })
                  showToast({ type: 'info', message: 'このアイコンは既に所持しています' })
                  const opened = openRewardPopupWithGuard({ type: 'points', amount: bonusPt })
                  if (opened) patchGaraponOverlays()
                }
                await addPoints(bonusPt, 'roulette', `⭐️:${spinSourceRef}`, { skipRender: true }).catch(
                  (err) => {
                    console.error('[garapon] star bonus points failed', err)
                    notifyApiFailure(err, 'default')
                  }
                )
                await refreshRouletteEligibleIconsCache()
              } else {
                const awardTier = awardSlot
                const awardPt = GARAPON_TIER_POINTS[awardTier]
                console.log('[garapon] spin success', { awardTier, awardPt })
                console.log('[garapon] result open')
                const opened = openRewardPopupWithGuard({ type: 'points', amount: awardPt })
                if (opened) patchGaraponOverlays()
                await addPoints(awardPt, 'roulette', `等級${awardTier}`, { skipRender: true }).catch((err) => {
                  console.error('[garapon] spin failed', err)
                  notifyApiFailure(err, 'default')
                })
              }
              rouletteSpinCountForInterstitial += 1
              pendingRouletteInterstitialAfterRewardClose = rouletteSpinCountForInterstitial % 3 === 0
              saveState()
              patchGaraponTicketDisplay()
              patchGaraponOverlays()
              resolve()
            }

            void finishSpin()
          }
          inner.addEventListener('transitionend', onEnd)
        })
      })
    }).catch(() => {
      /* loading cleared in withLoading finally */
    })
  })
}

/** Game の 375×(可変) コンテナをスマホ幅に合わせてスケール（幅基準） */
function applyGameScale() {
  const container = document.querySelector('.game-container')
  const wrapper = document.querySelector('.game-scale-wrapper')
  if (!container) return
  const baseHeight = Number(container.getAttribute('data-base-height') || '667')
  const scale = window.innerWidth / GAME_BASE_WIDTH
  container.style.transform = `scale(${scale})`
  if (wrapper) {
    wrapper.style.width = `${GAME_BASE_WIDTH * scale}px`
    wrapper.style.height = `${baseHeight * scale}px`
  }
}

function patchGamePointsDisplay() {
  const el = document.querySelector('.game-points-value')
  if (el) el.textContent = String(state.points)
}

function patchGameGiftButton() {
  const btn = document.querySelector('[data-game-gift]')
  if (!btn) return
  const giftClaimed = isGameGiftClaimedToday()
  btn.disabled = giftClaimed
  btn.setAttribute(
    'aria-label',
    giftClaimed ? '本日のプレゼントは受け取り済みです' : 'プレゼントボックス'
  )
  const img = btn.querySelector('.game-gift-img')
  if (img) img.src = `/assets/${giftClaimed ? '121' : '321'}.svg`
}

function patchGameRewardOverlay() {
  const app = getAppEl()
  if (!app || state.screen !== 'game') return

  const existing = app.querySelector('[data-game-reward-overlay]')
  if (state.rewardPopup) {
    const rewardType = state.activeModal || MODAL_TYPES.REWARD
    if (!existing) {
      const wantsAnim = consumeRewardSheetEntryAnim()
      app.insertAdjacentHTML(
        'beforeend',
        buildRewardModalOverlayHtml(
          state.rewardPopup,
          'data-game-reward-overlay',
          'data-game-reward-close',
          'data-modal-action="close" data-modal-type="reward"',
          rewardType
        )
      )
      const overlay = app.querySelector('[data-game-reward-overlay]')
      if (overlay && wantsAnim) kickRewardSheetEntryAnim(overlay)
    } else {
      applyOverlayOpenClasses(existing, true, rewardType)
    }
  } else if (existing) {
    existing.remove()
    console.log('[overlay] remove', 'gameReward')
  }

  syncBodyScrollLock()
}

function buildRewardHistoryBodyHtml() {
  if (state.rewardHistoryLoading) {
    return '<p class="reward-history-status">読み込み中…</p>'
  }
  if (state.rewardHistoryError) {
    return `<p class="reward-history-error">${escapeHtml(state.rewardHistoryError)}</p>`
  }
  if (!state.rewardHistoryItems || state.rewardHistoryItems.length === 0) {
    return '<p class="reward-history-status">まだ獲得履歴がありません</p>'
  }
  return `<ul class="reward-history-list">${state.rewardHistoryItems
    .map((row) => {
      const amt = Number(row.amount)
      const pt = Number.isFinite(amt)
        ? `${amt >= 0 ? '+' : ''}${amt} pt`
        : escapeHtml(String(row.amount))
      return `<li class="reward-history-row">
              <div class="reward-history-row-meta">${escapeHtml(formatRewardLogAt(row.created_at))}</div>
              <div class="reward-history-row-main"><span class="reward-history-type">${escapeHtml(
                rewardTypeLabelJa(row.reward_type)
              )}</span><span class="reward-history-amount">${pt}</span></div>
            </li>`
    })
    .join('')}</ul>`
}

function buildRewardHistoryOverlayHtml() {
  return `
    <div class="reward-history-overlay app-modal-overlay app-modal-open modal-open" data-reward-history-overlay data-modal-overlay data-modal-type="${OVERLAY_EXTRA_TYPES.REWARD_HISTORY}">
      <div class="reward-history-dialog" role="dialog" aria-labelledby="reward-history-title">
        <h3 id="reward-history-title" class="reward-history-title">獲得履歴</h3>
        <div class="reward-history-body">
          ${buildRewardHistoryBodyHtml()}
        </div>
        <div class="reward-history-footer">
          <button type="button" class="reward-history-close-btn" data-reward-history-close>閉じる</button>
        </div>
      </div>
    </div>`
}

function patchRewardHistoryOverlay() {
  const app = getAppEl()
  if (!app || state.screen !== 'game') return

  const existing = app.querySelector('[data-reward-history-overlay]')
  if (state.rewardHistoryOpen) {
    if (!existing) {
      app.insertAdjacentHTML('beforeend', buildRewardHistoryOverlayHtml())
    } else {
      const body = existing.querySelector('.reward-history-body')
      if (body) body.innerHTML = buildRewardHistoryBodyHtml()
      applyOverlayOpenClasses(existing, true, OVERLAY_EXTRA_TYPES.REWARD_HISTORY)
    }
  } else if (existing) {
    existing.remove()
    console.log('[overlay] remove', 'rewardHistory')
  }

  syncBodyScrollLock()
}

function shouldPatchGameScreen(forceFull) {
  if (forceFull || state.screen !== 'game') return false
  return !!document.querySelector('#app .game-viewport')
}

function patchGameScreen() {
  syncChromeBodyClasses()
  updateFooterActive('game')
  patchGamePointsDisplay()
  patchGameGiftButton()
  patchGameRewardOverlay()
  patchRewardHistoryOverlay()
  cleanupOrphanOverlays()
  syncBodyScrollLock()
  applyGameScale()
  schedulePangleBannerRefresh()
}

function bindGameAppDelegationOnce() {
  if (gameAppDelegationBound) return
  gameAppDelegationBound = true
  bindModalAppDelegationOnce()
  const app = document.querySelector('#app')
  if (!app) return

  app.addEventListener('click', (e) => {
    if (state.screen !== 'game') return

    if (e.target.closest('[data-game-history]')) {
      openRewardHistory().catch((err) => console.error(err))
      return
    }
    if (e.target.closest('[data-game-exchange]')) {
      if (isLoading('exchange')) return
      void withLoading('exchange', async () => {
        alert('準備中')
      })
      return
    }
    if (e.target.closest('[data-game-garapon]')) {
      changeScreen('garapon', {
        reason: 'game-garapon',
        beforeChange: () => {
          state.rewardPopup = null
          state.garaponHelpOpen = false
        },
      })
      return
    }
    if (e.target.closest('[data-game-slot]')) {
      alert('準備中')
      return
    }
    const snsBtn = e.target.closest('[data-game-sns]')
    if (snsBtn) {
      const snsKey = snsBtn.getAttribute('data-game-sns')
      const snsUrl =
        snsKey === '122'
          ? OFFICIAL_SNS_LINKS.instagram
          : snsKey === '123'
            ? OFFICIAL_SNS_LINKS.x
            : snsKey === '124'
              ? OFFICIAL_SNS_LINKS.tiktok
              : null
      if (snsUrl) window.open(snsUrl, '_blank')
      return
    }
    if (e.target.closest('[data-game-gift]')) {
      if (isGameGiftClaimedToday()) return
      void handleGameGiftClaim()
      return
    }
    const gameRewardOverlay = e.target.closest('[data-game-reward-overlay]')
    if (gameRewardOverlay && e.target === gameRewardOverlay) {
      closeModal()
      return
    }
    const rewardHistoryOverlay = e.target.closest('[data-reward-history-overlay]')
    if (rewardHistoryOverlay && e.target === rewardHistoryOverlay) {
      closeRewardHistory()
      return
    }
    if (e.target.closest('[data-reward-history-close]')) {
      closeRewardHistory()
    }
  })
}

/** ガラポン画面 375×667 デザインコンテナを幅基準でスケール */
function applyGaraponScale() {
  const container = document.querySelector('.garapon-container')
  const wrapper = document.querySelector('.garapon-scale-wrapper--garapon')
  if (!container) return
  const baseHeight = Number(container.getAttribute('data-base-height') || '667')
  const scale = window.innerWidth / GAME_BASE_WIDTH
  container.style.transform = `scale(${scale})`
  if (wrapper) {
    wrapper.style.width = `${GAME_BASE_WIDTH * scale}px`
    wrapper.style.height = `${baseHeight * scale}px`
  }
}

// --- カメラ（作業画面） ---
/** ユーザー操作（作業開始ボタン）の直後にのみ呼ぶ。iOS ではジェスチャー直後でないと取得できない */
async function requestCameraInUserGesture() {
  let permissionSnapshot = 'unknown'
  let mediaAttemptResult = 'not_called'

  try {
    console.log('[camera] mediaDevices exists:', !!navigator.mediaDevices)
    console.log('[camera] permission status:', 'checking')
    console.log('[camera] secure context:', window.isSecureContext, 'origin:', window.location.origin)
    if (!window.isSecureContext) {
      state.cameraError = 'このページではカメラを使えません。HTTPSまたはlocalhostで開いてください'
      console.error('[camera] getUserMedia failed', 'NotAllowedError', 'Insecure context')
      mediaAttemptResult = 'skipped_insecure'
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      state.cameraError = 'このブラウザはカメラ取得に対応していません'
      console.error('[camera] getUserMedia failed', 'NotSupportedError', 'mediaDevices.getUserMedia is unavailable')
      mediaAttemptResult = 'skipped_no_api'
      return
    }
    try {
      if (navigator.permissions?.query) {
        try {
          const p = await navigator.permissions.query({ name: 'camera' })
          permissionSnapshot = p.state
          console.log('[camera] permission status:', p.state)
        } catch (permErr) {
          permissionSnapshot = 'unavailable'
          console.log('[camera] permission status:', 'unavailable', permErr?.name, permErr?.message)
        }
      } else {
        permissionSnapshot = 'permissions_api_unsupported'
        console.log('[camera] permission status:', 'permissions API not supported')
      }
      let stream = null
      try {
        console.log('[camera] getUserMedia start', 'facingMode user(ideal)')
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'user' } },
          audio: false,
        })
      } catch (e1) {
        console.warn('[camera] getUserMedia retry with generic video', e1?.name, e1?.message)
        console.log('[camera] getUserMedia start', 'generic video:true')
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      }
      console.log('[camera] stream success', stream?.id)
      console.log('[camera] stream tracks', stream.getTracks().map((t) => ({
        kind: t.kind,
        label: t.label,
        enabled: t.enabled,
        readyState: t.readyState,
        muted: t.muted,
      })))
      cameraStream = stream
      state.cameraError = null
      mediaAttemptResult = 'ok'
      console.log('[camera] getUserMedia success', { hasStream: !!cameraStream })
    } catch (err) {
      mediaAttemptResult = 'fail'
      console.error('[camera] getUserMedia fail', {
        hasStream: false,
        name: err?.name,
        message: err?.message,
      })
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        state.cameraError = 'カメラが許可されていない可能性があります。Safariのサイト設定を確認してください'
      } else if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') {
        state.cameraError = 'カメラが他アプリで使用中です。不要なアプリを閉じて再試行してください'
      } else if (err?.name === 'OverconstrainedError' || err?.name === 'ConstraintNotSatisfiedError') {
        state.cameraError = 'カメラ条件が端末に合わず起動できませんでした。再試行してください'
      } else {
        state.cameraError = `カメラ起動に失敗しました（${err?.name || 'unknown'}）`
      }
      cameraStream = null
    }
  } finally {
    console.log('[camera] requestCamera summary', {
      isSecureContext: window.isSecureContext,
      permission: permissionSnapshot,
      mediaAttemptResult,
      hasStream: !!cameraStream,
    })
  }
}

/** iOS Safari: muted / playsInline をプロパティで明示し、メタデータ後に play */
async function attachCameraToVideo(videoEl) {
  console.log('[camera] video element found:', !!videoEl)
  if (!videoEl || !cameraStream) {
    console.log('[camera] attach skip', { hasVideoEl: !!videoEl, hasStream: !!cameraStream })
    return
  }
  videoEl.setAttribute('playsinline', '')
  videoEl.setAttribute('webkit-playsinline', '')
  videoEl.setAttribute('muted', '')
  videoEl.setAttribute('autoplay', '')
  videoEl.playsInline = true
  videoEl.muted = true
  videoEl.defaultMuted = true
  videoEl.autoplay = true
  try {
    videoEl.disablePictureInPicture = true
  } catch {
    /* ignore */
  }
  if (videoEl.srcObject && videoEl.srcObject !== cameraStream) {
    try {
      videoEl.srcObject = null
    } catch {
      /* ignore */
    }
  }
  videoEl.srcObject = cameraStream
  console.log('[camera] srcObject set')
  await new Promise((resolve) => {
    if (videoEl.readyState >= 1) {
      resolve()
      return
    }
    const done = () => {
      clearTimeout(tid)
      resolve()
    }
    videoEl.addEventListener('loadedmetadata', done, { once: true })
    videoEl.addEventListener('canplay', done, { once: true })
    const tid = setTimeout(done, 2500)
  })
  await new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  })
  try {
    await videoEl.play()
    console.log('[camera] video play success', { hasStream: !!cameraStream })
  } catch (err) {
    console.error('[camera] video play fail', {
      hasStream: !!cameraStream,
      name: err?.name,
      message: err?.message,
    })
  }
  bindWorkCameraVideoListeners(videoEl)
  syncWorkCameraVideoDisplay('attach')
}

function stopCamera() {
  resetWorkCameraVideoDisplay()
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop())
    cameraStream = null
  }
  state.cameraError = null
}

function cleanupToolCheck(reason) {
  if (toolCheckPrepareTimeoutId != null) {
    clearTimeout(toolCheckPrepareTimeoutId)
    toolCheckPrepareTimeoutId = null
  }
  if (toolCheckIntervalId != null) {
    clearInterval(toolCheckIntervalId)
    toolCheckIntervalId = null
  }
  if (toolCheckHardStopTimeoutId != null) {
    clearTimeout(toolCheckHardStopTimeoutId)
    toolCheckHardStopTimeoutId = null
  }
  if (toolCheckSuccessClearTimeoutId != null) {
    clearTimeout(toolCheckSuccessClearTimeoutId)
    toolCheckSuccessClearTimeoutId = null
  }
  toolCheckTickBusy = false
  console.log('[toolCheck] cleanup', reason || '')
}

/** running と同条件（getWorkSessionPhase===RUNNING と一致。フェーズ定義より前でも使える） */
function shouldScheduleMotionCheck() {
  if (state.screen !== 'work' || !state.isWorking) return false
  if (state.endConfirmOpen || state.isPaused) return false
  if (!state.workToolCheckDone || !state.workCountdownDone) return false
  return true
}

function cleanupMotionCheck(reason) {
  if (motionCheckTimeoutId != null) {
    clearTimeout(motionCheckTimeoutId)
    motionCheckTimeoutId = null
  }
  if (motionCheckIntervalId != null) {
    clearInterval(motionCheckIntervalId)
    motionCheckIntervalId = null
  }
  if (motionCheckWindowTimeoutId != null) {
    clearTimeout(motionCheckWindowTimeoutId)
    motionCheckWindowTimeoutId = null
  }
  isMotionChecking = false
  lastMotionFrameData = null
  console.log('[motionCheck] cleanup', reason || '')
}

/** @returns {{ data: Uint8ClampedArray, w: number, h: number } | null} */
function captureMotionFrameRaw(maxSide = MOTION_CAPTURE_MAX_SIDE) {
  const video = document.querySelector('#work-camera')
  if (!video || video.readyState < 2) return null
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return null
  const scale = Math.min(maxSide / vw, maxSide / vh, 1)
  const w = Math.max(1, Math.round(vw * scale))
  const h = Math.max(1, Math.round(vh * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  try {
    ctx.drawImage(video, 0, 0, w, h)
  } catch (e) {
    console.log('[motionCheck] capture error', e?.message || String(e))
    return null
  }
  const img = ctx.getImageData(0, 0, w, h)
  return { data: img.data, w, h }
}

/**
 * @param {Uint8ClampedArray} prev
 * @param {Uint8ClampedArray} curr
 * @param {number} w
 * @param {number} h
 * @returns {number} 変化ピクセル比率（0〜1）
 */
function computeMotionChangedRatio(prev, curr, w, h) {
  const total = w * h
  let changed = 0
  for (let i = 0; i < total * 4; i += 4) {
    const d =
      Math.abs(curr[i] - prev[i]) +
      Math.abs(curr[i + 1] - prev[i + 1]) +
      Math.abs(curr[i + 2] - prev[i + 2])
    if (d > MOTION_PIXEL_CHANNEL_DELTA_SUM) changed++
  }
  return changed / total
}

function scheduleNextMotionCheck() {
  if (motionCheckTimeoutId != null) {
    clearTimeout(motionCheckTimeoutId)
    motionCheckTimeoutId = null
  }
  if (!shouldScheduleMotionCheck()) return
  console.log('[motionCheck] schedule next', { delayMs: MOTION_CHECK_INTERVAL_MS })
  motionCheckTimeoutId = setTimeout(() => {
    motionCheckTimeoutId = null
    beginMotionCheckWindow()
  }, MOTION_CHECK_INTERVAL_MS)
}

function applyMotionAutoPause() {
  if (state.screen !== 'work' || !state.isWorking || state.isPaused) return
  ensureWorkSessionTeardown('motion_auto_pause', {
    shouldStopCamera: false,
    stopToolCheck: false,
    clearCountdown: true,
  })
  state.isPaused = true
  state.autoPaused = true
  state.autoPausedReason = 'motion'
  state.motionFailCount = 0
  refreshWorkScreenUI({ reason: 'motion_auto_pause' })
}

function finishMotionCheckWindow(sawMotion) {
  if (motionCheckIntervalId != null) {
    clearInterval(motionCheckIntervalId)
    motionCheckIntervalId = null
  }
  if (motionCheckWindowTimeoutId != null) {
    clearTimeout(motionCheckWindowTimeoutId)
    motionCheckWindowTimeoutId = null
  }
  isMotionChecking = false
  lastMotionFrameData = null
  lastMotionCheckAt = Date.now()

  if (sawMotion) {
    state.motionFailCount = 0
  } else {
    state.motionFailCount += 1
    console.log('[motionCheck] no motion')
    if (state.motionFailCount >= 3) {
      console.log('[motionCheck] fail count', state.motionFailCount)
      console.log('[motionCheck] auto pause')
      applyMotionAutoPause()
      return
    }
  }
  console.log('[motionCheck] fail count', state.motionFailCount)
  scheduleNextMotionCheck()
}

function beginMotionCheckWindow() {
  if (!shouldScheduleMotionCheck()) return
  if (isMotionChecking) {
    console.warn('[motionCheck] skip start: already checking')
    return
  }
  isMotionChecking = true
  lastMotionFrameData = null
  console.log('[motionCheck] start', { windowMs: MOTION_CHECK_WINDOW_MS })

  const windowState = { sawMotion: false }

  motionCheckIntervalId = setInterval(() => {
    if (!shouldScheduleMotionCheck()) {
      cleanupMotionCheck('aborted_not_running_phase')
      return
    }
    const snap = captureMotionFrameRaw()
    if (!snap) {
      console.log('[motionCheck] sample', { skipped: true })
      return
    }
    const { data, w, h } = snap
    let ratio = 0
    let compared = false
    if (lastMotionFrameData && lastMotionFrameData.length === data.length) {
      ratio = computeMotionChangedRatio(lastMotionFrameData, data, w, h)
      compared = true
      if (ratio >= MOTION_CHANGED_PIXEL_RATIO_THRESHOLD) {
        if (!windowState.sawMotion) {
          console.log('[motionCheck] detected', { changedRatio: Number(ratio.toFixed(4)) })
        }
        windowState.sawMotion = true
      }
    }
    lastMotionFrameData = new Uint8ClampedArray(data)
    console.log('[motionCheck] sample', {
      compared,
      changedRatio: compared ? Number(ratio.toFixed(4)) : null,
      threshold: MOTION_CHANGED_PIXEL_RATIO_THRESHOLD,
      w,
      h,
    })
  }, MOTION_SAMPLE_INTERVAL_MS)

  motionCheckWindowTimeoutId = setTimeout(() => {
    motionCheckWindowTimeoutId = null
    finishMotionCheckWindow(windowState.sawMotion)
  }, MOTION_CHECK_WINDOW_MS)
}

/** カメラ映像を最大辺 ~256px の JPEG Blob にする（AI 差し込み用） */
function captureWorkCameraFrameForToolCheck(maxSide = 256) {
  const video = document.querySelector('#work-camera')
  if (!video || video.readyState < 2) return Promise.resolve(null)
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return Promise.resolve(null)
  const scale = Math.min(maxSide / vw, maxSide / vh, 1)
  const w = Math.max(1, Math.round(vw * scale))
  const h = Math.max(1, Math.round(vh * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  try {
    ctx.drawImage(video, 0, 0, w, h)
  } catch (e) {
    console.log('[toolCheck] error', e?.message || String(e))
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', TOOL_CHECK_JPEG_QUALITY)
  })
}

// --- 描画（ホームは DOM 差分更新、画面遷移時のみ #app 全置換） ---
let lastRenderedScreen = null
let lastHomeModalSig = ''
let lastHomeMissionSig = ''
let homeAppDelegationBound = false
let accountAppDelegationBound = false
let modalAppDelegationBound = false

/** 画面上部モーダル表示中は背面をスクロール不可にする */
const APP_SCROLL_LOCK_SELECTOR =
  '.app-modal-overlay.app-modal-open, .app-modal-overlay.modal-open, .modal-overlay.modal-open, .modal-overlay.app-modal-open, .reward-history-overlay.app-modal-open, [data-referral-overlay].app-modal-open, [data-nickname-modal-overlay].app-modal-open, [data-icon-modal-overlay].app-modal-open, .mission-overlay.mission-overlay--open, .mission-overlay.app-modal-open, [data-onboarding-overlay]'

function syncBodyScrollLock() {
  const app = document.querySelector('#app')
  const locked = !!(app && app.querySelector(APP_SCROLL_LOCK_SELECTOR))
  document.documentElement.classList.toggle('app-scroll-locked', locked)
}

const SCREEN_CHROME_BG = {
  home: '#F8F6EF',
  game: '#F8F6EF',
  garapon: '#F8F6EF',
  account: '#F8F6EF',
  calendar: '#F8F6EF',
  worklog: '#F8F6EF',
  work: '#111111',
  result: '#F8F6EF',
}

/** 画面ごとに html / safe-area / theme-color の背景を各画面本体と揃える */
function syncScreenChromeBg(screen = state.screen) {
  const key = screen || 'home'
  const bg = SCREEN_CHROME_BG[key] ?? SCREEN_CHROME_BG.home
  document.documentElement.dataset.screen = key
  document.documentElement.style.setProperty('--screen-chrome-bg', bg)
  const themeMeta = document.querySelector('meta[name="theme-color"]')
  if (themeMeta) themeMeta.setAttribute('content', bg)
}

function syncChromeBodyClasses() {
  syncPlatformBodyClasses()
  syncScreenChromeBg()
  document.body.classList.toggle('garapon-screen-active', state.screen === 'garapon')
  document.body.classList.toggle('work-screen-active', state.screen === 'work')
  const banner = document.querySelector('.app-banner-under-footer')
  if (banner) {
    banner.style.display = state.screen === 'work' || state.screen === 'garapon' ? 'none' : ''
  }
}

const SCREEN_SHELL_SELECTOR = {
  home: '.home-viewport',
  account: '.account-screen',
  calendar: '.calendar-screen',
  game: '.game-viewport',
  garapon: '.garapon-screen',
  worklog: '.worklog-screen',
  work: '.work-screen',
  result: '.result-screen',
}

function hasScreenShell(screen) {
  const sel = SCREEN_SHELL_SELECTOR[screen]
  if (!sel) return false
  return !!document.querySelector(`#app ${sel}`)
}

/** フッターの data-nav キー（controller / home / account / calendar） */
function screenToFooterNavKey(screen) {
  if (screen === 'game' || screen === 'garapon') return 'controller'
  if (screen === 'home') return 'home'
  if (screen === 'account') return 'account'
  if (screen === 'calendar' || screen === 'worklog') return 'calendar'
  return null
}

function updateFooterActive(screen) {
  const activeKey = screenToFooterNavKey(screen)
  document.querySelectorAll('.app-footer-nav').forEach((btn) => {
    const navKey = btn.getAttribute('data-nav')
    const isActive = activeKey != null && navKey === activeKey
    btn.classList.toggle('app-footer-nav--active', isActive)
    if (isActive) btn.setAttribute('aria-current', 'page')
    else btn.removeAttribute('aria-current')
  })
  console.log('[footer] active updated', activeKey || 'none')
}

/**
 * 画面遷移（作業画面の検知・カメラ処理は呼び出し元のまま）
 * @returns {boolean} 遷移したか
 */
function changeScreen(nextScreen, options = {}) {
  const prev = state.screen
  const reason = options.reason || 'screen-change'
  const forceFull = options.forceFull !== false
  const scrollTop = options.scrollTop !== false

  if (prev === nextScreen) {
    console.log('[nav] same screen ignored', { screen: nextScreen, reason })
    console.log('[render] skip same-screen', { screen: nextScreen, reason })
    return false
  }

  if (!canNavigateAwayFromActiveWork(nextScreen, reason)) {
    return false
  }

  console.log('[nav] screen change', { from: prev, to: nextScreen, reason })
  if (typeof options.beforeChange === 'function') options.beforeChange()
  resetLoadingOnScreenChange(prev, nextScreen)
  cleanupOrphanToasts()
  if (prev === 'home' && nextScreen !== 'home' && state.missionScreenOpen) {
    clearModalStateForType(MODAL_TYPES.MISSION_PANEL)
    syncMissionPanelOverlay()
  }
  if (prev === 'garapon' && nextScreen !== 'garapon') {
    if (state.garaponHelpOpen) clearModalStateForType(MODAL_TYPES.GARAPON_HELP)
    console.log('[overlay] cleanup garapon/mission', { from: prev, to: nextScreen })
  }
  if (prev === 'account' && nextScreen !== 'account') closeAccountLocalModalsOnLeave()
  if (prev === 'work' && state.isWorking && nextScreen !== 'work') {
    ensureWorkSessionTeardown('screen_leave', { shouldStopCamera: true, closeEndConfirm: true })
  }
  state.screen = nextScreen
  updateFooterActive(nextScreen)
  render({ forceFull, reason })
  if (scrollTop) scrollToTopOnScreenChange()
  return true
}

/** フッターナビ用（ホーム / アカウント / カレンダー / ゲーム） */
function navigateToScreen(nextScreen) {
  const prev = state.screen
  const reason = 'footer-nav'
  if (prev === nextScreen) {
    console.log('[nav] same screen ignored', { screen: nextScreen, reason })
    console.log('[render] skip same-screen', { screen: nextScreen, reason })
    return
  }
  if (isActiveWorkOnWorkScreen()) {
    console.warn('[nav] footer nav blocked during work', { from: prev, to: nextScreen, reason })
    return
  }
  if (prev === 'result') showInterstitialAfterWorkEnd()
  changeScreen(nextScreen, { reason, forceFull: true })
}

function updatePointTextEl(el, points) {
  if (!el) return
  const text = String(points)
  el.textContent = text
  el.classList.toggle('point-text--many-digits', text.length >= 5)
  el.classList.toggle('point-text--more-digits', text.length >= 6)
}

function buildHomeHourglassHtml(hourglasses) {
  return Array(MAX_HOURGLASSES)
    .fill(0)
    .map((_, i) => `<img src="/assets/145.svg" class="hg ${i < hourglasses ? 'filled' : 'empty'}" alt="砂時計">`)
    .join('')
}

function buildMissionListInnerHtml(missionsSorted) {
  if (missionsSorted.length === 0) return '<p class="mission-empty">ミッションはありません</p>'
  return missionsSorted
    .map((m) => {
      const done = isMissionCompleted(m)
      const claimed = isMissionClaimed(m)
      const rewardIcon =
        m.reward_type === 'icon'
          ? `<img src="${escapeHtml(resolveIconAssetPath(m.reward_icon_key, null))}" class="mission-reward-icon" alt="">`
          : m.reward_type === 'point'
            ? '<img src="/assets/220.svg" class="mission-reward-icon" alt="">'
            : '<img src="/assets/31.svg" class="mission-reward-icon" alt="">'
      const rewardLabel = m.reward_type === 'icon' ? '' : `X${m.reward_amount}`
      const itemClass = claimed ? 'mission-item--claimed' : done ? 'mission-item--done' : ''
      const itemTag = done && !claimed ? 'button' : 'div'
      const itemAttrs = done && !claimed ? `type="button" data-mission-claim="${m.mission_key}"` : ''
      return `<${itemTag} class="mission-item ${itemClass}" ${itemAttrs}>
            <div class="mission-reward">${rewardIcon}<span class="mission-reward-qty">${rewardLabel}</span></div>
            <div class="mission-label">${escapeHtml(m.title)}</div>
          </${itemTag}>`
    })
    .join('')
}

function getMissionDisplayOrder(m) {
  const target = Number(m.target_value)
  const sort = Number(m.sort_order)
  if (m.category === 'lifetime' && Number.isFinite(target)) return target
  if (Number.isFinite(sort)) return sort
  return Number.isFinite(target) ? target : 0
}

function sortMissionsForDisplay(missions) {
  return [...missions].sort((a, b) => {
    const aClaimed = isMissionClaimed(a)
    const bClaimed = isMissionClaimed(b)
    const aDone = isMissionCompleted(a)
    const bDone = isMissionCompleted(b)
    if (aClaimed && !bClaimed) return 1
    if (!aClaimed && bClaimed) return -1
    if (aDone && !bDone) return -1
    if (!aDone && bDone) return 1
    const orderA = getMissionDisplayOrder(a)
    const orderB = getMissionDisplayOrder(b)
    if (orderA !== orderB) return orderA - orderB
    return String(a.mission_key).localeCompare(String(b.mission_key))
  })
}

function getHomeMissionSig() {
  const missions = getMissionsForTab(state.missionTab)
  return missions
    .map(
      (m) =>
        `${m.mission_key}:${isMissionCompleted(m) ? 1 : 0}:${isMissionClaimed(m) ? 1 : 0}:${m.reward_type}:${m.reward_amount}:${m.reward_icon_key || ''}`
    )
    .join('|')
}

function getHomeModalSig() {
  const needsAnim = !!(state.rewardPopup && state.rewardPopupNeedsEntryAnim)
  return [
    state.boostConfirmOpen ? 'boost' : '',
    state.modalMessage || '',
    state.rewardPopup ? JSON.stringify(normalizeRewardPopupItems(state.rewardPopup)) : '',
    needsAnim ? 'anim1' : 'anim0',
  ].join('::')
}

function buildHomeModalInnerHtml() {
  const { modalMessage } = state
  if (state.boostConfirmOpen) {
    return `
        <h3 class="modal-title">ブーストしますか？</h3>
        <p class="modal-text">動画広告視聴で本日中作業時間25分あたり<br>1個砂時計→20分で1個砂時計が<br>貯まるようになります<br>ブーストして効率よく砂時計をゲットしよう！</p>
        <div class="modal-actions">
          <button class="modal-btn modal-btn-yes" type="button" data-modal-boost-yes>はい</button>
          <button class="modal-btn modal-btn-no" type="button" data-modal-boost-no>いいえ</button>
        </div>`
  }
  if (state.rewardPopup) {
    return `
        <div class="reward-sheet${rewardSheetEntryClass()}">
        ${buildRewardSheetTopHtml(state.rewardPopup)}
          <div class="reward-sheet-banner" data-ad-placement="${AD_PLACEMENTS.BANNER_REWARD_MODAL}" role="img" aria-label="広告エリア">
            <span class="ad-banner-dummy">300x250 banner</span>
          </div>
          <button class="reward-sheet-close" type="button" data-modal-close data-modal-action="close" data-modal-type="reward">閉じる</button>
        </div>`
  }
  if (modalMessage) {
    return `
        <p class="modal-message">${escapeHtml(modalMessage)}</p>
        <button class="modal-close" type="button" data-modal-close>閉じる</button>`
  }
  return `
        <p class="modal-message"></p>
        <button class="modal-close" type="button" data-modal-close hidden>閉じる</button>`
}

function applyMissionPanelScale() {
  const missionPanel = document.querySelector('[data-mission-panel]')
  if (!missionPanel) return
  const scale = Math.min(window.innerWidth / 450, window.innerHeight / 630, 1)
  missionPanel.style.transform = `scale(${scale})`
}

function patchHomeHourglasses(hourglasses) {
  const track = document.querySelector('.home-hourglass-track')
  if (!track) return
  const html = buildHomeHourglassHtml(hourglasses)
  if (track.innerHTML !== html) track.innerHTML = html
}

function patchHomeStats() {
  patchHomePigImage()
  updatePointTextEl(document.querySelector('[data-point-display]'), state.points)
  const ticketEl = document.querySelector('[data-ticket-display]')
  if (ticketEl) ticketEl.textContent = String(state.pigTickets)
  patchHomeHourglasses(state.hourglasses)
  const missionBtn = document.querySelector('[data-mission-open]')
  if (!missionBtn) return
  const hasUnclaimed = getMissionsForTab(state.missionTab).some(
    (m) => isMissionCompleted(m) && !isMissionClaimed(m)
  )
  let badge = missionBtn.querySelector('.home-mission-badge')
  if (hasUnclaimed && !badge) {
    badge = document.createElement('span')
    badge.className = 'home-mission-badge'
    badge.setAttribute('aria-hidden', 'true')
    missionBtn.insertBefore(badge, missionBtn.firstChild)
  } else if (!hasUnclaimed && badge) {
    badge.remove()
  }
}

function patchHomeActionButtons() {
  const canConsume = state.hourglasses >= 1
  const btn15 = document.querySelector('[data-btn-15]')
  const btnVideo = document.querySelector('[data-btn-video]')
  const btnBoost = document.querySelector('[data-btn-boost]')
  if (btn15) {
    btn15.disabled = !canConsume || isLoading('get15')
    btn15.setAttribute('aria-busy', isLoading('get15') ? 'true' : 'false')
  }
  if (btnVideo) {
    btnVideo.disabled = !canConsume || isLoading('video80')
    btnVideo.setAttribute('aria-busy', isLoading('video80') ? 'true' : 'false')
  }
  if (btnBoost) {
    btnBoost.disabled = state.boostActive || isLoading('boost')
    const label = state.boostActive ? 'ブースト中' : '▶ 視聴でブースト'
    if (btnBoost.textContent !== label) btnBoost.textContent = label
  }
}

function patchHomeModals() {
  syncHomeShellOverlay()
  const overlay = getHomeShellOverlay()
  if (!overlay) return
  const open = !!(state.boostConfirmOpen || state.rewardPopup || state.modalMessage)
  overlay.classList.toggle('modal-open', open)
  overlay.classList.toggle('app-modal-open', open)
  overlay.classList.toggle('modal-overlay--reward', !!state.rewardPopup)
  const content = overlay.querySelector('.modal-content')
  if (!content) return
  content.classList.toggle('modal-content--reward', !!state.rewardPopup)
  const sig = getHomeModalSig()
  if (sig === lastHomeModalSig) return
  lastHomeModalSig = sig
  content.innerHTML = buildHomeModalInnerHtml()
  patchHomeBoostModalButtons()
}

function patchHomeMissionOverlay() {
  syncMissionPanelOverlay()
  const overlay = document.querySelector('[data-mission-overlay]')
  if (!overlay) return
  overlay.classList.toggle('mission-overlay--open', state.missionScreenOpen)
  const sig = `${state.missionScreenOpen}|${state.missionTab}|${getHomeMissionSig()}`
  const missions = getMissionsForTab(state.missionTab)
  const hasUnclaimed = missions.some((m) => isMissionCompleted(m) && !isMissionClaimed(m))
  const claimAll = overlay.querySelector('[data-mission-claim-all]')
  if (claimAll) claimAll.disabled = !hasUnclaimed
  patchHomeMissionClaimButtons()
  if (sig === lastHomeMissionSig) {
    applyMissionPanelScale()
    return
  }
  lastHomeMissionSig = sig
  overlay.querySelectorAll('[data-mission-tab]').forEach((btn) => {
    const tab = btn.getAttribute('data-mission-tab')
    btn.classList.toggle('mission-tab--active', tab === state.missionTab)
  })
  const list = overlay.querySelector('.mission-list')
  if (list) list.innerHTML = buildMissionListInnerHtml(sortMissionsForDisplay(missions))
  applyMissionPanelScale()
}

function getReferralCodeDisplayText() {
  return state.referralCodeLoading ? '読み込み中…' : state.referralCode || '—'
}

function buildReferralOverlayHtml() {
  const referralCodeDisplay = escapeHtml(getReferralCodeDisplayText())
  return `<div class="referral-modal-overlay app-modal-overlay app-modal-open modal-open" data-referral-overlay data-modal-overlay data-modal-type="${MODAL_TYPES.CODE}">
      <div class="referral-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="referral-modal-title">
        <button type="button" class="referral-modal-close" data-modal-action="close" data-modal-type="code" data-account-action="close-code-modal" aria-label="閉じる">×</button>
        <h2 id="referral-modal-title" class="referral-modal-title">コード入力</h2>
        <section class="account-referral" aria-label="友達招待の内容">
        <p class="account-referral-label">あなたの招待コード</p>
        <p class="account-referral-code">${referralCodeDisplay}</p>
        <p class="account-referral-hint">友達を1人招待するごとに1,000pt</p>
        <p class="account-referral-hint">最大4人まで</p>
        ${state.referralAlreadyApplied ? '<p class="account-referral-applied">招待コードを適用済みです</p>' : ''}
        <input
          type="text"
          id="account-referral-input"
          class="account-referral-input"
          data-referral-input
          maxlength="20"
          autocomplete="off"
          aria-label="コード入力"
          placeholder="招待コード・ギフトコードを入力"
          ${isLoading('applyCode') ? 'disabled' : ''}
        />
        <button
          type="button"
          class="account-btn account-referral-apply"
          data-account-action="apply-code"
          ${isLoading('applyCode') ? 'disabled' : ''}
        >${isLoading('applyCode') ? '処理中…' : 'コード入力'}</button>
      </section>
      </div>
    </div>`
}

function buildIconPickerGridHtml() {
  if (state.userIconsLoading) {
    return '<p class="icon-picker-status">読み込み中…</p>'
  }
  const items = state.userIconsPicker || []
  if (!items.length) {
    return '<p class="icon-picker-status">所持アイコンがありません</p>'
  }
  const selected = state.selectedIconKey || DEFAULT_SELECTED_ICON_KEY
  return `<div class="icon-picker-grid" role="list">${items
    .map((item) => {
      const isSelected = item.iconKey === selected
      return `<button type="button" class="icon-picker-item${isSelected ? ' icon-picker-item--selected' : ''}" role="listitem" data-icon-pick data-icon-key="${escapeHtml(item.iconKey)}" aria-pressed="${isSelected ? 'true' : 'false'}" aria-label="${escapeHtml(item.displayName)}" ${isLoading('saveIcon') ? 'disabled' : ''}>
        <img src="${escapeHtml(item.assetPath)}" alt="" class="icon-picker-item-img" decoding="async">
        ${buildIconPickerDisplayNameHtml(item.displayName)}
      </button>`
    })
    .join('')}</div>`
}

function buildIconPickerModalHtml() {
  return `<div class="icon-picker-modal-overlay app-modal-overlay app-modal-open modal-open" data-icon-modal-overlay data-modal-overlay data-modal-type="${MODAL_TYPES.ICON}">
      <div class="icon-picker-modal" role="dialog" aria-labelledby="icon-picker-modal-title" aria-modal="true">
        <h3 id="icon-picker-modal-title" class="icon-picker-modal-title">アイコンを選ぶ</h3>
        ${buildIconPickerGridHtml()}
        <div class="icon-picker-modal-actions">
          <button type="button" class="icon-picker-modal-btn icon-picker-modal-btn-secondary" data-modal-action="close" data-modal-type="${MODAL_TYPES.ICON}" data-account-action="close-icon-modal">閉じる</button>
        </div>
      </div>
    </div>`
}

function patchIconPickerModalContent(overlay) {
  const gridHost = overlay.querySelector('.icon-picker-modal')
  if (!gridHost) return
  const title = gridHost.querySelector('.icon-picker-modal-title')
  const actions = gridHost.querySelector('.icon-picker-modal-actions')
  let statusOrGrid = gridHost.querySelector('.icon-picker-status, .icon-picker-grid')
  const nextHtml = buildIconPickerGridHtml()
  if (statusOrGrid) {
    const wrap = document.createElement('div')
    wrap.innerHTML = nextHtml
    const nextEl = wrap.firstElementChild
    if (nextEl) statusOrGrid.replaceWith(nextEl)
  } else if (actions) {
    actions.insertAdjacentHTML('beforebegin', nextHtml)
  } else if (title) {
    title.insertAdjacentHTML('afterend', nextHtml)
  }
}

function buildNicknameModalHtml() {
  return `<div class="nickname-modal-overlay app-modal-overlay app-modal-open modal-open" data-nickname-modal-overlay data-modal-overlay data-modal-type="${MODAL_TYPES.NICKNAME}">
      <div class="nickname-modal" role="dialog" aria-labelledby="nickname-modal-title" aria-modal="true">
        <h3 id="nickname-modal-title" class="nickname-modal-title">ニックネーム変更</h3>
        <label class="nickname-modal-label" for="nickname-modal-input">表示名（最大${USERNAME_MAX_LEN}文字、空欄は「${DEFAULT_USERNAME}」）</label>
        <input type="text" id="nickname-modal-input" class="nickname-modal-input" maxlength="${USERNAME_MAX_LEN}" autocomplete="username" data-nickname-input />
        <div class="nickname-modal-actions">
          <button type="button" class="nickname-modal-btn nickname-modal-btn-secondary" data-modal-action="close" data-modal-type="nickname" data-account-action="cancel-username-modal">キャンセル</button>
          <button type="button" class="nickname-modal-btn nickname-modal-btn-primary" data-modal-action="save-username" data-account-action="save-username">保存</button>
        </div>
      </div>
    </div>`
}

function patchReferralModalContent(overlay) {
  const codeEl = overlay.querySelector('.account-referral-code')
  if (codeEl) codeEl.textContent = getReferralCodeDisplayText()
  patchAccountCodeApplyUI()
  let appliedEl = overlay.querySelector('.account-referral-applied')
  if (state.referralAlreadyApplied) {
    if (!appliedEl) {
      const hint = overlay.querySelector('.account-referral-hint:last-of-type')
      if (hint) {
        hint.insertAdjacentHTML('afterend', '<p class="account-referral-applied">招待コードを適用済みです</p>')
      }
    }
  } else if (appliedEl) {
    appliedEl.remove()
  }
}

function patchAccountModals() {
  const app = document.querySelector('#app')
  if (!app || state.screen !== 'account') return

  const toggle = app.querySelector('[data-referral-toggle]')
  if (toggle) toggle.setAttribute('aria-expanded', state.referralPanelOpen ? 'true' : 'false')

  if (state.referralPanelOpen) {
    const referralOverlay = ensureModalOverlay(MODAL_TYPES.CODE, buildReferralOverlayHtml)
    if (referralOverlay) patchReferralModalContent(referralOverlay)
  } else {
    removeModalOverlay(MODAL_TYPES.CODE)
  }

  if (state.nicknameModalOpen) {
    const hadNicknameOverlay = !!app.querySelector('[data-nickname-modal-overlay]')
    ensureModalOverlay(MODAL_TYPES.NICKNAME, buildNicknameModalHtml)
    if (!hadNicknameOverlay) {
      const input = app.querySelector('[data-nickname-input]')
      if (input) {
        input.value = state.username || DEFAULT_USERNAME
        requestAnimationFrame(() => {
          input.focus()
          input.select()
        })
      }
    }
  } else {
    removeModalOverlay(MODAL_TYPES.NICKNAME)
  }

  if (state.iconModalOpen) {
    const overlay = ensureModalOverlay(MODAL_TYPES.ICON, buildIconPickerModalHtml)
    if (overlay) patchIconPickerModalContent(overlay)
  } else {
    removeModalOverlay(MODAL_TYPES.ICON)
  }

  if (state.rewardPopup) {
    const rewardType = state.activeModal || MODAL_TYPES.REWARD
    const existingReward = app.querySelector('[data-account-reward-overlay]')
    if (!existingReward) {
      const wantsAnim = consumeRewardSheetEntryAnim()
      app.insertAdjacentHTML(
        'beforeend',
        buildRewardModalOverlayHtml(
          state.rewardPopup,
          'data-account-reward-overlay',
          'data-account-reward-close',
          'data-account-action="close-account-reward" data-modal-action="close" data-modal-type="reward"',
          rewardType
        )
      )
      const overlay = app.querySelector('[data-account-reward-overlay]')
      if (overlay && wantsAnim) kickRewardSheetEntryAnim(overlay)
    } else {
      applyOverlayOpenClasses(existingReward, true, rewardType)
    }
  } else {
    removeAllRewardOverlays()
  }
}

function closeReferralPanel() {
  closeModalByType(MODAL_TYPES.CODE)
}

function openReferralPanel() {
  openModal(MODAL_TYPES.CODE, null, { closeOthers: true })
  if (state.referralCode === null && !state.referralCodeLoading) {
    void loadReferralAccountData()
  }
}

function closeNicknameModal() {
  closeModalByType(MODAL_TYPES.NICKNAME)
}

function openNicknameModal() {
  openModal(MODAL_TYPES.NICKNAME, null, { closeOthers: true })
}

function closeIconModal() {
  closeModalByType(MODAL_TYPES.ICON)
}

function openIconModal() {
  openModal(MODAL_TYPES.ICON, null, { closeOthers: true })
  void loadUserIconsForPicker()
}

async function loadUserIconsForPicker() {
  state.userIconsLoading = true
  state.userIconsPicker = []
  refreshModalsUI()
  const userId = state.userId || getUserId()
  await ensureDefaultIconsForUser(userId)
  const [res, masterRes] = await Promise.all([fetchUserIcons(userId), fetchIconMaster()])
  state.userIconsLoading = false
  const masterRows = masterRes.ok && Array.isArray(masterRes.data) ? masterRes.data : []
  if (!res.ok) {
    logApiFailed('fetchUserIcons', res.error)
    state.userIconsPicker = buildDefaultIconPickerItems(masterRows)
    logIconAssetPaths('picker fallback catalog', state.userIconsPicker)
    refreshModalsUI()
    return res
  }
  const rows = Array.isArray(res.data) ? res.data : []
  state.userIconsPicker = buildUserIconsPickerItems(rows, masterRows)
  logIconAssetPaths('picker loaded', state.userIconsPicker)
  refreshModalsUI()
  return { ok: true, data: state.userIconsPicker, error: null }
}

function patchHomePigImage() {
  const img = document.querySelector('.home-pig')
  if (!img) return
  const src = getSelectedIconAssetPath()
  const prev = img.getAttribute('src')
  if (prev !== src) {
    img.setAttribute('src', src)
    console.log('[icons] home pig image updated', {
      selectedIconKey: state.selectedIconKey,
      prevSrc: prev,
      nextSrc: src,
    })
  }
}

function patchAccountUserIcon() {
  const wrap = document.querySelector('.account-user-icon')
  if (!wrap) return
  const src = getSelectedIconAssetPath()
  let img = wrap.querySelector('img')
  if (!img) {
    wrap.innerHTML = `<img src="${escapeHtml(src)}" class="account-user-icon-img" alt="" decoding="async">`
    return
  }
  if (img.getAttribute('src') !== src) img.setAttribute('src', src)
}

async function handleAccountSelectIcon(iconKey) {
  const key = String(iconKey || '').trim()
  if (!key || isLoading('saveIcon')) return
  return withLoading('saveIcon', async () => {
    const res = await setSelectedIcon(null, key)
    if (!res.ok) {
      notifyApiFailure(res.error, 'save')
      return
    }
    const picked = state.userIconsPicker.find((item) => item.iconKey === key)
    if (picked) {
      state.selectedIconKey = picked.iconKey
      state.selectedIconAssetPath = resolveIconAssetPath(picked.iconKey, picked.assetPath)
    } else {
      await loadSelectedIconIntoState()
    }
    logSelectedIconState('selected icon saved')
    closeIconModal()
    patchAccountUserIcon()
    patchHomePigImage()
    if (state.screen === 'home') {
      render({ reason: 'icon-selected' })
      patchHomePigImage()
    } else if (state.screen === 'account') {
      render({ reason: 'icon-selected' })
    }
  }).catch((e) => {
    console.error('[icons] select icon failed', e?.message || String(e), e)
    notifyApiFailure(e, 'save')
  })
}

async function handleAccountApplyCode() {
  const input = document.querySelector('[data-referral-input]')
  await applyCodeInput(input?.value ?? '')
}

async function handleAccountSaveUsername() {
  const nicknameInput = document.querySelector('[data-nickname-input]')
  const raw = nicknameInput?.value ?? ''
  await saveUsernameFromInput(raw, { closeNicknameModal: true })
}

async function saveUsernameFromInput(raw, { closeNicknameModal = false } = {}) {
  const next = normalizeUsernameForStorage(raw)
  const userId = state.userId || getUserId()
  return withLoading('saveNickname', async () => {
    const res = await runApi('saveNickname', () =>
      supabase.from('users').update({ username: next }).eq('user_id', userId)
    )
    if (!res.ok) {
      notifyApiFailure(res.error, 'save')
      return false
    }
    state.username = next
    markRegistrationComplete()
    saveState()
    if (closeNicknameModal) closeModalByType(MODAL_TYPES.NICKNAME)
    return true
  }).catch((e) => {
    console.error('[user] update username failed', e?.message || String(e), e)
    notifyApiFailure(e, 'save')
    return false
  })
}

function renderOnboardingOverlay() {
  if (!state.onboardingActive) {
    document.querySelector('[data-onboarding-overlay]')?.remove()
    syncBodyScrollLock()
    return
  }

  const html = buildOnboardingOverlayHtml(state.onboardingStep, {
    usernameMaxLen: USERNAME_MAX_LEN,
  })
  const existing = document.querySelector('[data-onboarding-overlay]')
  if (existing) {
    existing.outerHTML = html
  } else {
    document.body.insertAdjacentHTML('beforeend', html)
  }
  syncBodyScrollLock()

  if (state.onboardingStep === ONBOARDING_LAST_INDEX) {
    const input = document.querySelector('[data-onboarding-nickname-input]')
    if (input && !input.value) {
      input.value = state.username === DEFAULT_USERNAME ? '' : state.username
    }
    if (input && !input.dataset.focusedOnce) {
      input.dataset.focusedOnce = '1'
      focusOnboardingNicknameInput()
    }
  }
}

function finishOnboarding() {
  state.onboardingActive = false
  state.onboardingStep = 0
  markOnboardingComplete()
  renderOnboardingOverlay()
}

async function finishOnboardingAndGoHome({ saveNickname = false } = {}) {
  if (saveNickname) {
    const input = document.querySelector('[data-onboarding-nickname-input]')
    const raw = input?.value ?? ''
    const ok = await saveUsernameFromInput(raw, { closeNicknameModal: false })
    if (!ok) return
  } else {
    const ok = await saveUsernameFromInput('', { closeNicknameModal: false })
    if (!ok) return
  }
  finishOnboarding()
  state.screen = 'home'
  render({ reason: 'onboarding-complete', forceFull: true })
}

function handleOnboardingNext() {
  if (state.onboardingStep < ONBOARDING_LAST_INDEX) {
    state.onboardingStep += 1
    renderOnboardingOverlay()
    return
  }
  void finishOnboardingAndGoHome({ saveNickname: true })
}

function handleOnboardingSkip() {
  if (state.onboardingStep < ONBOARDING_LAST_INDEX) {
    state.onboardingStep = ONBOARDING_LAST_INDEX
    renderOnboardingOverlay()
    return
  }
  void finishOnboardingAndGoHome({ saveNickname: false })
}

function maybeStartOnboardingAfterBoot() {
  migrateOnboardingForLegacyUser({
    username: state.username,
    defaultUsername: DEFAULT_USERNAME,
    registrationComplete: isRegistrationComplete(),
  })
  if (!shouldShowOnboarding()) return
  state.onboardingActive = true
  state.onboardingStep = 0
  renderOnboardingOverlay()
  console.log('[onboarding] started', { step: state.onboardingStep, slide: ONBOARDING_SLIDE_IDS[0] })
}

bindOnboardingDelegation({
  onNext: handleOnboardingNext,
  onSkip: handleOnboardingSkip,
})

function patchAccountScreen() {
  syncChromeBodyClasses()
  updateFooterActive('account')
  patchAccountUserIcon()
  const pts = document.querySelector('[data-account-points]')
  if (pts) {
    const text = String(state.points)
    pts.textContent = text
    pts.classList.toggle('account-points--many-digits', text.length >= 5)
    pts.classList.toggle('account-points--more-digits', text.length >= 6)
  }
  const nameEl = document.querySelector('.account-username')
  if (nameEl) nameEl.textContent = state.username || DEFAULT_USERNAME
  patchAccountModals()
  patchLoadingUI(['applyCode', 'saveNickname', 'saveIcon', 'exchange'])
  cleanupOrphanOverlays()
  syncBodyScrollLock()
  schedulePangleBannerRefresh()
}

function bindAccountAppDelegationOnce() {
  if (accountAppDelegationBound) return
  accountAppDelegationBound = true
  bindModalAppDelegationOnce()
  const app = document.querySelector('#app')
  if (!app) return

  app.addEventListener('click', (e) => {
    if (state.screen !== 'account') return

    if (e.target.matches('[data-referral-overlay]')) {
      console.log('[account] modal action handled', 'backdrop-code')
      closeReferralPanel()
      return
    }
    if (e.target.matches('[data-nickname-modal-overlay]')) {
      console.log('[account] modal action handled', 'backdrop-username')
      closeNicknameModal()
      return
    }
    if (e.target.matches('[data-icon-modal-overlay]')) {
      console.log('[account] modal action handled', 'backdrop-icon')
      closeIconModal()
      return
    }

    const iconPickEl = e.target.closest('[data-icon-pick]')
    if (iconPickEl) {
      const iconKey = iconPickEl.getAttribute('data-icon-key')
      if (iconKey) void handleAccountSelectIcon(iconKey)
      return
    }
    if (e.target.closest('[data-account-reward-overlay]') === e.target) {
      console.log('[account] modal action handled', 'backdrop-reward')
      closeModalByType(state.activeModal || MODAL_TYPES.REWARD)
      return
    }

    const actionEl = e.target.closest('[data-account-action]')
    if (!actionEl) return
    const action = actionEl.getAttribute('data-account-action')
    if (!action) return
    console.log('[account] modal action handled', action)

    switch (action) {
      case 'toggle-code-modal':
        if (state.referralPanelOpen) closeReferralPanel()
        else openReferralPanel()
        break
      case 'close-code-modal':
        closeReferralPanel()
        break
      case 'open-username-modal':
        openNicknameModal()
        break
      case 'open-icon-modal':
        openIconModal()
        break
      case 'close-icon-modal':
      case 'cancel-icon-modal':
        closeIconModal()
        break
      case 'cancel-username-modal':
      case 'close-username-modal':
        closeNicknameModal()
        break
      case 'apply-code':
        void handleAccountApplyCode()
        break
      case 'save-username':
        void handleAccountSaveUsername()
        break
      case 'close-account-reward':
        closeModalByType(state.activeModal || MODAL_TYPES.REWARD)
        break
      case 'account-exchange':
        if (isLoading('exchange')) return
        void withLoading('exchange', async () => {
          alert('準備中')
        })
        break
      case 'account-history':
        alert('準備中')
        break
      case 'account-terms':
        window.open(TERMS_OF_SERVICE_URL, '_blank', 'noopener,noreferrer')
        break
      case 'account-privacy':
        window.open(PRIVACY_POLICY_URL, '_blank', 'noopener,noreferrer')
        break
      default:
        console.warn('[account] modal close failed', 'unknown action', action)
    }
  })

  app.addEventListener('keydown', (e) => {
    if (state.screen !== 'account' || e.key !== 'Enter') return
    if (e.target.matches('[data-referral-input]')) {
      e.preventDefault()
      void handleAccountApplyCode()
    }
    if (e.target.matches('[data-nickname-input]')) {
      e.preventDefault()
      void handleAccountSaveUsername()
    }
  })
}

function patchHomeScreen() {
  consumeRewardSheetEntryAnim()
  syncChromeBodyClasses()
  updateFooterActive('home')
  patchHomeStats()
  patchHomeActionButtons()
  patchHomeModals()
  patchHomeMissionOverlay()
  patchLoadingUI()
  cleanupOrphanOverlays()
  syncBodyScrollLock()
  applyHomeScale()
  schedulePangleBannerRefresh()
}

function shouldPatchHomeScreen(forceFull) {
  if (forceFull || state.screen !== 'home') return false
  return !!document.querySelector('#app .home-viewport')
}

function shouldPatchAccountScreen(forceFull) {
  if (forceFull || state.screen !== 'account') return false
  if (!document.querySelector('#app .account-screen')) return false
  // コード入力・ニックネーム・アイコン変更は innerHTML 再生成が必要
  if (
    isModalOpen(MODAL_TYPES.CODE) ||
    isModalOpen(MODAL_TYPES.NICKNAME) ||
    isModalOpen(MODAL_TYPES.ICON)
  ) {
    return false
  }
  return true
}

function closeAccountLocalModalsOnLeave() {
  if (state.referralPanelOpen) clearModalStateForType(MODAL_TYPES.CODE)
  if (state.nicknameModalOpen) clearModalStateForType(MODAL_TYPES.NICKNAME)
  if (state.iconModalOpen) clearModalStateForType(MODAL_TYPES.ICON)
  removeOrphanModalOverlays()
}

function bindModalAppDelegationOnce() {
  if (modalAppDelegationBound) return
  modalAppDelegationBound = true
  const app = document.querySelector('#app')
  if (!app) return

  app.addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-modal-action]')
    if (!actionEl) return
    const action = actionEl.getAttribute('data-modal-action')
    const modalType = actionEl.getAttribute('data-modal-type')
    if (!action) return

    if (action === 'close' && modalType) {
      console.log('[account] modal action handled', 'close', modalType)
      if (modalType === MODAL_TYPES.MISSION_PANEL) {
        closeMissionPanel()
        return
      }
      if (modalType === MODAL_TYPES.GARAPON_HELP) {
        closeGaraponHelp()
        return
      }
      closeModalByType(modalType)
      return
    }
    if (action === 'close-account-reward') {
      closeModalByType(state.activeModal || MODAL_TYPES.REWARD)
      return
    }
    if (action === 'save-username' && state.screen === 'account') {
      console.log('[account] modal action handled', 'save-username')
      void handleAccountSaveUsername()
      return
    }
    if (action === 'apply-code' && state.screen === 'account') {
      console.log('[account] modal action handled', 'apply-code')
      void handleAccountApplyCode()
    }
  })
}

function closeHomeOverlayModal() {
  if (state.boostConfirmOpen) closeModalByType(MODAL_TYPES.BOOST)
  else if (state.rewardPopup) closeModalByType(inferActiveModalType() || MODAL_TYPES.REWARD)
  else if (state.modalMessage) closeModalByType(MODAL_TYPES.MESSAGE)
  else closeModal()
}

function bindHomeAppDelegationOnce() {
  if (homeAppDelegationBound) return
  homeAppDelegationBound = true
  bindModalAppDelegationOnce()
  const app = document.querySelector('#app')
  if (!app) return

  app.addEventListener('click', (e) => {
    if (state.screen !== 'home') return

    if (e.target.closest('[data-btn-15]')) {
      void handle15Click()
      return
    }
    if (e.target.closest('[data-btn-video]')) {
      void handleVideoClick()
      return
    }
    if (e.target.closest('[data-btn-start]')) {
      void workSession.start()
      return
    }
    if (e.target.closest('[data-btn-boost]')) {
      handleBoostClick()
      return
    }
    if (e.target.closest('[data-modal-close]')) {
      closeHomeOverlayModal()
      return
    }
    if (e.target.closest('[data-modal-boost-yes]')) {
      void handleBoostConfirmYes()
      return
    }
    if (e.target.closest('[data-modal-boost-no]')) {
      handleBoostConfirmNo()
      return
    }
    if (e.target.closest('[data-mission-open]')) {
      openMissionPanel()
      return
    }
    if (e.target.closest('[data-mission-close]')) {
      closeMissionPanel()
      return
    }
    const tabBtn = e.target.closest('[data-mission-tab]')
    if (tabBtn) {
      state.missionTab = tabBtn.getAttribute('data-mission-tab')
      render()
      return
    }
    const claimBtn = e.target.closest('[data-mission-claim]')
    if (claimBtn) {
      if (isLoading('claimMission')) return
      const missionId = claimBtn.getAttribute('data-mission-claim')
      const mission = getMissionsForTab(state.missionTab).find((m) => m.mission_key === missionId)
      if (mission) void claimMissionReward(mission.mission_key, mission.category)
      return
    }
    if (e.target.closest('[data-mission-claim-all]')) {
      if (isLoading('claimMission')) return
      void (async () => {
        const list = getMissionsForTab(state.missionTab)
        const claimable = list.filter((m) => isMissionCompleted(m) && !isMissionClaimed(m))
        if (claimable.length === 0) return
        const mergedRewards = { points: 0, ticket: 0, icons: [] }
        for (const m of claimable) {
          const reward = await claimMissionReward(m.mission_key, m.category, { suppressPopup: true })
          if (reward?.type === 'points') mergedRewards.points += reward.amount
          if (reward?.type === 'ticket') mergedRewards.ticket += reward.amount
          if (reward?.type === 'icon' && reward.granted) mergedRewards.icons.push(reward)
        }
        const popupItems = []
        if (mergedRewards.points > 0) popupItems.push({ type: 'points', amount: mergedRewards.points })
        if (mergedRewards.ticket > 0) popupItems.push({ type: 'ticket', amount: mergedRewards.ticket })
        popupItems.push(...mergedRewards.icons)
        if (popupItems.length > 0) {
          openRewardPopupWithGuard({ items: popupItems })
          render()
        }
      })()
      return
    }
    const modalOverlay = e.target.closest('[data-modal-overlay]')
    if (modalOverlay && e.target === modalOverlay) {
      closeHomeOverlayModal()
      return
    }
    const missionOverlay = e.target.closest('[data-mission-overlay]')
    if (missionOverlay && e.target.classList.contains('mission-backdrop')) {
      closeMissionPanel()
    }
  })
}

// --- 描画 ---
function render(options = {}) {
  const forceFull = options.forceFull === true
  const reason = options.reason || 'unspecified'

  if (isActiveWorkOnWorkScreen()) {
    if (shouldPatchWorkScreen(forceFull)) {
      patchWorkScreen()
      console.log('[render] patch work screen', { reason })
      return
    }
    if (!forceFull) {
      console.log('[render] guarded during work (no full)', { reason })
      patchWorkScreen()
      return
    }
    if (state.screen !== 'work') {
      console.warn('[render] work session drift corrected', { screen: state.screen, reason })
      state.screen = 'work'
    }
  }

  try {
  checkDateReset()
  if (state.screen !== 'account') {
    state.nicknameModalOpen = false
    state.iconModalOpen = false
    state.userIconsLoading = false
    accountReferrerSyncArmed = false
  }
  if (state.screen !== 'game') {
    resetRewardHistoryState()
  }
  syncChromeBodyClasses()
  updateFooterActive(state.screen)

  if (shouldPatchHomeScreen(forceFull)) {
    patchHomeScreen()
    return
  }
  if (shouldPatchAccountScreen(forceFull)) {
    patchAccountScreen()
    return
  }
  if (shouldPatchGaraponScreen(forceFull)) {
    patchGaraponScreen()
    return
  }

  if (shouldPatchGameScreen(forceFull)) {
    patchGameScreen()
    return
  }

  if (shouldPatchWorkScreen(forceFull)) {
    patchWorkScreen()
    console.log('[render] patch work screen', { reason })
    return
  }

  const fromScreen = lastRenderedScreen
  if (forceFull || fromScreen !== state.screen) {
    console.log('[render] full screen-change', { from: fromScreen, to: state.screen, reason })
  }

  lastRenderedScreen = state.screen
  lastHomeModalSig = ''
  lastHomeMissionSig = ''

  const { points, pigTickets, hourglasses, modalMessage, screen } = state
  const canConsume = hourglasses >= 1
  const rewardGrantBusy = isLoading('get15') || isLoading('video80')
  consumeRewardSheetEntryAnim()

  const hourglassSlots = buildHomeHourglassHtml(hourglasses)

  const app = document.querySelector('#app')
  const workPhase = getWorkSessionPhase()
  const isResultPhase = workPhase === WORK_SESSION_PHASE.RESULT

  if (screen === 'work') {
    console.log('[render] full work screen', { reason })
    bindWorkScreenDelegationOnce()
    app.innerHTML = buildWorkScreenHtml()
    cleanupDuplicateWorkEndConfirmOverlays()
    patchWorkScreen()
    const videoEl = app.querySelector('#work-camera')
    if (videoEl && cameraStream) {
      void attachCameraToVideo(videoEl).catch((e) => console.error('[camera] attach failed', e))
    }
    return
  }

  if (isResultPhase) {
    const sessionSec = state.elapsedSec
    const earned = state.sessionGrantedCount
    const overflowTickets = state.overflowPigTicketsGrantedThisSession
    const overflowBonusHtml =
      overflowTickets > 0
        ? `
      <div class="result-overflow-bonus">
        <p class="result-overflow-note">砂時計が満タンだったため、超過ボーナスとして豚チケットを獲得しました</p>
        <p class="result-overflow-tickets">超過ボーナス：豚チケット +${overflowTickets}</p>
      </div>`
        : ''
    if (overflowTickets > 0) {
      console.log('[overflowBonus] result ui shown', { tickets: overflowTickets })
    }
    app.innerHTML = `
    <div class="result-screen">
      <h2 class="result-title">作業完了</h2>
      <p class="result-time">今回の作業時間: <strong>${formatElapsed(sessionSec)}</strong></p>
      <p class="result-earned">今回獲得した砂時計: <strong>${earned}</strong></p>
      ${overflowBonusHtml}
      <button class="btn-back-home" type="button" data-btn-back-home>ホームに戻る</button>
    </div>
    `
    const btnBack = app.querySelector('[data-btn-back-home]')
    if (btnBack) btnBack.addEventListener('click', handleBackHome)
    return
  }

  if (screen === 'account') {
    scheduleReferrerRewardSyncForAccountScreen()
    if (state.referralPanelOpen && !state.referralCodeLoading && state.referralCode === null) {
      void loadReferralAccountData()
    }
    const accountRewardPopup = state.rewardPopup
    const referralPanelHtml = state.referralPanelOpen ? buildReferralOverlayHtml() : ''
    app.innerHTML = `
    <div class="account-screen">
      <div class="account-header">
        <div class="account-user-icon" aria-hidden="true">
          <img src="${escapeHtml(getSelectedIconAssetPath())}" class="account-user-icon-img" alt="" decoding="async">
        </div>
        <p class="account-username">${escapeHtml(state.username || DEFAULT_USERNAME)}</p>
        <p class="account-userid">user_id: ${escapeHtml(state.userId || '')}</p>
      </div>
      <div class="account-buttons">
        <div class="account-exchange-block">
          <div class="account-exchange-points">
            <img src="/assets/220.svg" class="account-coin" alt="">
            <span class="account-points ${String(points).length >= 5 ? 'account-points--many-digits' : ''} ${String(points).length >= 6 ? 'account-points--more-digits' : ''}" data-account-points>${points}</span>
          </div>
          <button type="button" class="account-btn account-btn-exchange" data-account-action="account-exchange">交換する</button>
        </div>
        <button type="button" class="account-btn" data-account-action="open-username-modal">ニックネーム変更</button>
        <button type="button" class="account-btn" data-account-action="open-icon-modal">アイコン変更</button>
        <div class="account-referral-between">
        <div class="ad-banner-account-inline" data-ad-placement="${AD_PLACEMENTS.BANNER_ACCOUNT}" role="img" aria-label="広告エリア">
          <span class="ad-banner-dummy">Account Banner 300x250</span>
        </div>
        <button
          type="button"
          class="account-referral-open"
          data-referral-toggle
          data-account-action="toggle-code-modal"
          aria-expanded="${state.referralPanelOpen ? 'true' : 'false'}"
          aria-label="コード入力"
        >
          <img src="/assets/240.svg" alt="" class="account-referral-open-img" decoding="async" />
        </button>
        <button type="button" class="account-btn" data-account-action="account-history">交換履歴</button>
        <button type="button" class="account-btn" data-account-action="account-terms">利用規約</button>
        </div>
        <button type="button" class="account-btn" data-account-action="account-privacy">プライバシーポリシー</button>
      </div>
    </div>
    ${referralPanelHtml}
    ${accountRewardPopup ? buildAccountRewardOverlayHtml(accountRewardPopup) : ''}
    ${state.nicknameModalOpen ? buildNicknameModalHtml() : ''}
    ${state.iconModalOpen ? buildIconPickerModalHtml() : ''}
    <!-- （320×100固定バナーは削除） -->
    `
    bindAccountAppDelegationOnce()
    if (state.nicknameModalOpen) {
      const nicknameInput = app.querySelector('[data-nickname-input]')
      if (nicknameInput) {
        nicknameInput.value = state.username || DEFAULT_USERNAME
        requestAnimationFrame(() => {
          nicknameInput.focus()
          nicknameInput.select()
        })
      }
    }
    schedulePangleBannerRefresh()
    return
  }

  if (screen === 'worklog') {
    if (!state.workLogLoading && state.workLogDailyLogs === null && !state.workLogError) {
      void refreshWorkLogData()
    }
    const logMap = buildStudyDailyLogMap(state.workLogDailyLogs || [])
    const chartDays = getWorkLogChartDays(state.workLogWeekOffset)
    const chartSvg = buildWorkLogBarChartSvg(chartDays, logMap)
    const consecutiveDays = computeConsecutiveStudyDaysFromMap(logMap)
    const weekSec = computeWeekStudySeconds(logMap)
    const monthSec = computeMonthStudySeconds(logMap)
    const totalSec = computeTotalStudySeconds(logMap)
    const canGoNext = state.workLogWeekOffset > 0
    app.innerHTML = `
    <div class="worklog-screen">
      <header class="worklog-header">
        <button type="button" class="worklog-back-btn" data-worklog-back aria-label="戻る">←</button>
        <h1 class="worklog-title">作業ログ</h1>
        <span class="worklog-header-spacer" aria-hidden="true"></span>
      </header>
      ${
        state.workLogLoading
          ? '<p class="worklog-status">読み込み中…</p>'
          : state.workLogError
            ? '<p class="worklog-status worklog-status--error">データの取得に失敗しました</p>'
            : ''
      }
      <div class="worklog-chart-wrap">
        <button type="button" class="worklog-chart-nav" data-worklog-prev aria-label="前の7日間">‹</button>
        <div class="worklog-chart-panel">
          ${chartSvg}
        </div>
        <button type="button" class="worklog-chart-nav" data-worklog-next aria-label="次の7日間" ${canGoNext ? '' : 'disabled'}>›</button>
      </div>
      <div class="worklog-stat-list">
        <div class="worklog-stat-item">
          <span class="worklog-stat-label">連続作業記録</span>
          <strong class="worklog-stat-value">${consecutiveDays}日</strong>
        </div>
        <div class="worklog-stat-item">
          <span class="worklog-stat-label">今週の作業記録</span>
          <strong class="worklog-stat-value">${escapeHtml(formatStudyLogDurationHoursMinutes(weekSec))}</strong>
        </div>
        <div class="worklog-stat-item">
          <span class="worklog-stat-label">今月の作業記録</span>
          <strong class="worklog-stat-value">${escapeHtml(formatStudyLogDurationHoursMinutes(monthSec))}</strong>
        </div>
        <div class="worklog-stat-item">
          <span class="worklog-stat-label">累計の作業記録</span>
          <strong class="worklog-stat-value">${escapeHtml(formatStudyLogDurationHoursMinutes(totalSec))}</strong>
        </div>
      </div>
    </div>
    ${buildRewardModalOverlayHtml(state.rewardPopup)}
    `
    bindWorkLogScreenEvents(app)
    bindRewardModalOverlay(app, 'data-global-reward-overlay', 'data-global-reward-close')
    return
  }

  if (screen === 'calendar') {
    void hydrateDiariesFromSupabase().then((changed) => {
      if (changed && state.screen === 'calendar') {
        render({ forceFull: true, reason: 'calendar-diary-hydrate' })
      }
    })
    const y = state.calendarYear
    const m = state.calendarMonth
    const todayKey = getTodayKey()
    const days = getCalendarDays(y, m)
    const selectedKey = state.selectedDate
    const diaryEditDate = state.diaryEditDate
    const diaryEditText = state.diaryEditText
    const calendarCells = days.map((day) => {
      if (day === null) return '<button type="button" class="calendar-cell calendar-cell-empty" tabindex="-1" aria-hidden="true"></button>'
      const key = toDateKey(y, m, day)
      const hasWork = getWorkSeconds(key) > 0
      const isToday = key === todayKey
      const isSelected = key === selectedKey
      return `<button type="button" class="calendar-cell ${isSelected ? 'calendar-cell-selected' : ''}" data-calendar-date="${key}">
        <span class="calendar-cell-num">${day}</span>
        ${hasWork ? '<span class="calendar-cell-star" aria-hidden="true">★</span>' : ''}
        ${isToday ? '<span class="calendar-cell-today" aria-hidden="true"></span>' : ''}
      </button>`
    }).join('')
    const selectedDetail = selectedKey ? (() => {
      const sec = getWorkSeconds(selectedKey)
      const [y2, m2, d2] = selectedKey.split('-').map(Number)
      const label = `${m2}月${d2}日`
      const diary = diaryEditDate === selectedKey ? diaryEditText : getDiary(selectedKey)
      const isEditing = diaryEditDate === selectedKey
      const isFuture = selectedKey > todayKey
      const canWriteDiary = canWriteDiaryForDate(selectedKey)
      return { label, sec, diary, isEditing, isFuture, canWriteDiary }
    })() : null
    app.innerHTML = `
    <div class="calendar-screen">
      <div class="calendar-header">
        <button type="button" class="calendar-nav-btn" data-calendar-prev>前の月へ</button>
        <h1 class="calendar-title">${y}年${m}月</h1>
        <button type="button" class="calendar-nav-btn" data-calendar-next>次の月へ</button>
      </div>
      <div class="calendar-summary-row">
        <div class="calendar-pig-wrap">
          <img src="/assets/30.svg" class="calendar-pig" alt="">
        </div>
        <div class="calendar-summary">
          <button type="button" class="calendar-worklog-btn" data-open-worklog>作業ログを見る</button>
        </div>
      </div>
      <div class="calendar-weekdays">
        <span class="calendar-wd calendar-wd-sun">Su</span><span class="calendar-wd">Mo</span><span class="calendar-wd">Tu</span><span class="calendar-wd">We</span><span class="calendar-wd">Th</span><span class="calendar-wd">Fr</span><span class="calendar-wd">Sa</span>
      </div>
      <div class="calendar-grid">
        ${calendarCells}
      </div>
      ${selectedDetail ? `
      <div class="calendar-detail">
        <div class="calendar-detail-card">
          <p class="calendar-detail-date">${selectedDetail.label}</p>
          <p class="calendar-detail-time">作業時間 ${formatWorkTime(selectedDetail.sec)}</p>
          <div class="calendar-detail-diary">
            <p class="calendar-detail-diary-label">日記</p>
            ${selectedDetail.isFuture
              ? `<p class="calendar-diary-notice calendar-diary-notice-future">未来の日付には日記を書けません</p>`
              : !selectedDetail.canWriteDiary
                ? `<p class="calendar-diary-notice">日記は過去3日分までしか書けません</p>${selectedDetail.diary ? `<p class="calendar-diary-text">${escapeHtml(selectedDetail.diary)}</p>` : ''}`
                : selectedDetail.isEditing
                  ? `<div class="calendar-diary-edit">
                      <textarea class="calendar-diary-input" data-diary-input maxlength="200" placeholder="200字以内">${escapeHtml(selectedDetail.diary || '')}</textarea>
                      <p class="calendar-diary-count">${(selectedDetail.diary || '').length}/200</p>
                      <div class="calendar-diary-actions">
                        <button type="button" class="calendar-diary-btn calendar-diary-save" data-diary-save>保存</button>
                        <button type="button" class="calendar-diary-btn calendar-diary-cancel" data-diary-cancel>キャンセル</button>
                      </div>
                    </div>`
                  : `<button type="button" class="calendar-diary-add" data-diary-add>+</button>
                    ${selectedDetail.diary ? `<p class="calendar-diary-text">${escapeHtml(selectedDetail.diary)}</p>` : ''}`
            }
          </div>
        </div>
      </div>
      ` : ''}
    </div>
    ${buildRewardModalOverlayHtml(state.rewardPopup)}
    `
    bindRewardModalOverlay(app, 'data-global-reward-overlay', 'data-global-reward-close')
    app.querySelector('[data-open-worklog]')?.addEventListener('click', () => {
      changeScreen('worklog', {
        reason: 'calendar-worklog',
        beforeChange: () => {
          state.workLogWeekOffset = 0
          state.workLogDailyLogs = null
        },
      })
    })
    app.querySelectorAll('[data-calendar-date]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-calendar-date')
        state.selectedDate = state.selectedDate === key ? null : key
        state.diaryEditDate = null
        state.diaryEditText = ''
        render()
      })
    })
    app.querySelector('[data-calendar-prev]')?.addEventListener('click', () => {
      if (state.calendarMonth === 1) {
        state.calendarYear--
        state.calendarMonth = 12
      } else state.calendarMonth--
      state.selectedDate = null
      render()
    })
    app.querySelector('[data-calendar-next]')?.addEventListener('click', () => {
      if (state.calendarMonth === 12) {
        state.calendarYear++
        state.calendarMonth = 1
      } else state.calendarMonth++
      state.selectedDate = null
      render()
    })
    const diaryInput = app.querySelector('[data-diary-input]')
    if (diaryInput) {
      diaryInput.focus()
      diaryInput.addEventListener('input', () => {
        state.diaryEditText = diaryInput.value
        const countEl = app.querySelector('.calendar-diary-count')
        if (countEl) countEl.textContent = `${diaryInput.value.length}/200`
      })
    }
    app.querySelector('[data-diary-save]')?.addEventListener('click', () => {
      if (!state.selectedDate || !canWriteDiaryForDate(state.selectedDate)) return
      const input = app.querySelector('[data-diary-input]')
      const text = input ? input.value : state.diaryEditText
      const previous = getDiary(state.selectedDate)
      setDiary(state.selectedDate, text)
      if (!String(previous).trim() && String(text).trim()) {
        void updateMissionProgress('daily_diary', 'daily', 1)
        void updateMissionProgress('weekly_diary_3', 'weekly', 1)
        void updateMissionProgress('weekly_diary_5', 'weekly', 1)
      }
      state.diaryEditDate = null
      state.diaryEditText = ''
      render()
    })
    app.querySelector('[data-diary-cancel]')?.addEventListener('click', () => {
      state.diaryEditDate = null
      state.diaryEditText = ''
      render()
    })
    app.querySelector('[data-diary-add]')?.addEventListener('click', () => {
      if (state.selectedDate && canWriteDiaryForDate(state.selectedDate)) {
        state.diaryEditDate = state.selectedDate
        state.diaryEditText = getDiary(state.selectedDate)
        render()
      }
    })
    return
  }

  if (screen === 'garapon') {
    console.log('[garapon] open panel')
    void refreshRouletteEligibleIconsCache()
    const canSpin = pigTickets >= 5 && !isLoading('garapon')
    const wheelDeg = state.garaponWheelDeg || 0
    app.innerHTML = `
    <div class="garapon-screen">
      <div class="garapon-viewport">
        <div class="garapon-scale-wrapper garapon-scale-wrapper--garapon">
          <div class="garapon-container" data-base-height="724">
            <button type="button" class="garapon-back" data-garapon-back aria-label="戻る">←</button>
            <img src="/assets/132.svg" alt="ポイントルーレット" class="garapon-title-img" width="230" height="41" decoding="async" />
            <button type="button" class="garapon-help" data-garapon-help aria-label="ヘルプ">?</button>
            <img src="/assets/130.svg" alt="" class="garapon-mascot" width="90" height="108" aria-hidden="true" decoding="async" />
            <div class="garapon-wheel-zone" aria-hidden="true">
              <div class="garapon-pointer"></div>
              <div class="garapon-wheel-outer">
                <div class="garapon-wheel-inner" style="transform: rotate(${wheelDeg}deg)">
                  ${buildGaraponWheelLabelsHtml()}
                </div>
              </div>
            </div>
            <button type="button" class="garapon-spin-btn" data-garapon-spin ${canSpin ? '' : 'disabled'}>
              <img src="/assets/31.svg" alt="" class="garapon-spin-ticket-icon" width="28" height="28" decoding="async" />
              <span>×5で回す</span>
            </button>
            <div class="garapon-balance-column">
              <div class="garapon-balance-pill" aria-label="所持豚チケット">
                <img src="/assets/31.svg" alt="" class="garapon-balance-icon" width="24" height="24" decoding="async" />
                <span data-garapon-tickets>×${pigTickets}</span>
              </div>
              <div class="garapon-ad-banner-slot" data-ad-placement="${AD_PLACEMENTS.BANNER_ROULETTE}" role="img" aria-label="広告バナー予定地 300×250">
                <span class="ad-banner-dummy">300×250 banner</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    `
    bindGaraponAppDelegationOnce()
    patchGaraponScreen()
    return
  }

  if (screen === 'game') {
    const giftClaimed = isGameGiftClaimedToday()
    const secondaryIds = ['223', '221', '222', '224', '225']
    const secondaryButtonAssets = { '223': '324', '221': '322', '222': '323', '224': '325', '225': '326' }
    const secondaryButtons = secondaryIds
      .map(
        (id, idx) => {
          const tops = [416.4, 477.6, 538, 599, 660.2]
          const top = tops[idx] ?? (366.4 + idx * 61.2)
          const assetId = secondaryButtonAssets[id] ?? id
          return `
      <button type="button" class="game-btn" data-game-slot="${id}" data-game-top="${top}" aria-label="ゲーム ${id}">
        <img src="/assets/${assetId}.svg" alt="" class="game-btn-img" decoding="async" />
      </button>`
        }
      )
      .join('')
    const rewardHistoryHtml = state.rewardHistoryOpen ? buildRewardHistoryOverlayHtml() : ''
    app.innerHTML = `
    <div class="game-viewport">
      <div class="game-scale-wrapper">
        <div class="game-container" data-base-height="1250">
          <img src="/assets/92.svg" alt="" class="game-pig-img" decoding="async" />
          <div class="game-points" aria-label="所持ポイント">
            <img src="/assets/220.svg" alt="" class="game-points-icon" decoding="async" />
            <span class="game-points-value">${points}</span>
          </div>
          <div class="game-tickets" aria-label="豚チケット枚数">
            <img src="/assets/31.svg" alt="" class="game-tickets-icon" decoding="async" />
            <span class="game-tickets-value">${pigTickets}</span>
          </div>

          <div class="game-action-row" role="group" aria-label="ポイントアクション">
            <button type="button" class="game-action-btn" data-game-history>獲得履歴</button>
            <button type="button" class="game-action-btn" data-game-exchange>交換する</button>
          </div>

          <button type="button" class="game-garapon" data-game-garapon aria-label="豚ガラポンはこちら">
            <img src="/assets/330.svg" alt="" class="game-garapon-img" decoding="async" />
          </button>

          <img src="/assets/140.svg" alt="" class="game-banner-140" decoding="async" />

          <div class="game-secondary">
            ${secondaryButtons}
          </div>

          <div class="game-ad-banner-slot" data-ad-placement="${AD_PLACEMENTS.BANNER_GAME}" role="img" aria-label="広告バナー予定地 300×250">
            <span class="ad-banner-dummy">300×250 banner</span>
          </div>

          <div class="game-gift-wrap">
            ${giftClaimed ? '' : '<img src="/assets/200.svg" alt="" class="game-gift-badge" decoding="async" aria-hidden="true" />'}
            <button type="button" class="game-gift" data-game-gift aria-label="${giftClaimed ? '本日のプレゼントは受け取り済みです' : 'プレゼントボックス'}" ${giftClaimed ? 'disabled' : ''}>
              <img src="/assets/${giftClaimed ? '121' : '321'}.svg" alt="" class="game-gift-img" width="320" height="320" decoding="async" />
            </button>
          </div>

          <p class="game-sns-label">各種SNSはこちら↓↓</p>
          <div class="game-sns-row" role="group" aria-label="SNSリンク">
            <button type="button" class="game-sns-btn sns-instagram" data-game-sns="122" aria-label="Instagram">
              <img src="/assets/122.svg" alt="" class="game-sns-icon" width="120" height="120" decoding="async" />
            </button>
            <button type="button" class="game-sns-btn sns-x" data-game-sns="123" aria-label="X">
              <img src="/assets/123.svg" alt="" class="game-sns-icon" width="120" height="120" decoding="async" />
            </button>
            <button type="button" class="game-sns-btn sns-tiktok" data-game-sns="124" aria-label="TikTok">
              <img src="/assets/124.svg" alt="" class="game-sns-icon" width="120" height="120" decoding="async" />
            </button>
          </div>
        </div>
      </div>
    </div>
    ${rewardHistoryHtml}
    `
    bindGameAppDelegationOnce()
    applyGameScale()
    app.querySelectorAll('.game-btn[data-game-top]').forEach((el) => {
      const top = el.getAttribute('data-game-top')
      if (top != null) el.style.top = `${top}px`
    })
    patchGameRewardOverlay()
    schedulePangleBannerRefresh()
    return
  }

  // screen === 'home' — 1080×1790 基準・絶対配置
  if (screen === 'home') {
    state.lastLoginDate = getTodayKey()
    localStorage.setItem(STORAGE_KEYS.missionLastLogin, state.lastLoginDate)
    const loginAdded = addLoginDay(state.lastLoginDate)
    if (loginAdded) {
      void updateMissionProgress('daily_login', 'daily', 1)
      void updateMissionProgress('weekly_login_3', 'weekly', 1)
      void updateMissionProgress('weekly_login_5', 'weekly', 1)
      void updateMissionProgress('monthly_login_10', 'monthly', 1)
      void updateMissionProgress('monthly_login_20', 'monthly', 1)
      void updateMissionProgress('lifetime_login_1', 'lifetime', 1)
      void updateMissionProgress('lifetime_login_10', 'lifetime', 1)
      void updateMissionProgress('lifetime_login_30', 'lifetime', 1)
      void updateMissionProgress('lifetime_login_31', 'lifetime', 1)
      void updateMissionProgress('lifetime_login_50', 'lifetime', 1)
      void updateMissionProgress('lifetime_login_100', 'lifetime', 1)
      void updateMissionProgress('lifetime_login_101', 'lifetime', 1)
      void updateMissionProgress('lifetime_login_300', 'lifetime', 1)
      void updateMissionProgress('lifetime_login_365', 'lifetime', 1)
      void updateMissionProgress('lifetime_login_366', 'lifetime', 1)
      void updateMissionProgress('lifetime_login_500', 'lifetime', 1)
      void updateMissionProgress('lifetime_login_1000', 'lifetime', 1)
    }
  }
  const missionTab = state.missionTab
  const missions = getMissionsForTab(missionTab)
  const missionsSorted = sortMissionsForDisplay(missions)
  const hasUnclaimed = missions.some((m) => isMissionCompleted(m) && !isMissionClaimed(m))
  app.innerHTML = `
  <div class="home-viewport">
    <div class="home-scale-wrapper">
    <div class="home-container">
      <div class="home-top-strip-bg" aria-hidden="true"></div>
      <!-- (1) 豚チケット | ミッション | コイン＋pt -->
      <div class="home-top-boxes">
        <div class="home-ticket-box" data-ticket-box>
          <img src="/assets/31.svg" class="home-ticket-icon" alt="">
          <span class="home-ticket-count" data-ticket-display>${pigTickets}</span>
        </div>
        <button type="button" class="home-mission-btn" data-mission-open aria-label="ミッション">
          ${hasUnclaimed ? '<span class="home-mission-badge" aria-hidden="true"></span>' : ''}
          <img src="/assets/33.svg" class="home-mission-icon" alt="">
        </button>
        <div class="home-point-box" data-point-box>
          <img src="/assets/220.svg" class="home-point-coin" alt="">
          <span class="point-text ${String(points).length >= 5 ? 'point-text--many-digits' : ''} ${String(points).length >= 6 ? 'point-text--more-digits' : ''}" data-point-display>${points}</span>
        </div>
      </div>
      <!-- (2) ブタ -->
      <div class="home-pig-wrapper">
        <img src="${escapeHtml(getSelectedIconAssetPath())}" class="home-pig" alt="ブタ">
      </div>
      <!-- (3) 砂時計 横スクロール列（7枠・4個見える） -->
      <div class="home-hourglass-row">
        <div class="home-hourglass-track">
          ${hourglassSlots}
        </div>
      </div>
      <!-- (4) 動画を見て80＋豚チケット獲得 -->
      <button class="home-btn home-btn-video" type="button" data-btn-video ${!canConsume || rewardGrantBusy ? 'disabled' : ''}>
        <span>▶ 動画を見て</span>
        <img src="/assets/220.svg" class="home-btn-coin" alt="">
        <span>80＋</span>
        <img src="/assets/31.svg" class="home-btn-inline-icon" alt="豚チケット">
        <span>獲得</span>
      </button>
      <!-- (5) 15獲得 -->
      <button class="home-btn home-btn-15" type="button" data-btn-15 ${!canConsume || rewardGrantBusy ? 'disabled' : ''}>
        <img src="/assets/220.svg" class="home-btn-coin" alt="">
        15獲得
      </button>
      <!-- (6) 作業開始（円） -->
      <button class="home-btn home-btn-start" type="button" data-btn-start>
        作業開始
      </button>
      <!-- (7) 視聴でブースト -->
      <button class="home-btn home-btn-boost" type="button" data-btn-boost${state.boostActive ? ' disabled' : ''}>
        ${state.boostActive ? 'ブースト中' : '▶ 視聴でブースト'}
      </button>
    </div>
    </div>
  </div>

  <!-- （320×100固定バナーは削除） -->

  <!-- モーダル（ブースト確認 or 獲得結果） -->
  <div class="modal-overlay app-modal-overlay ${state.boostConfirmOpen || state.rewardPopup || modalMessage ? 'modal-open app-modal-open' : ''} ${state.rewardPopup ? 'modal-overlay--reward' : ''}" data-modal-overlay data-modal-type="${inferActiveModalType() || ''}">
    <div class="modal-content app-modal-content ${state.rewardPopup ? 'modal-content--reward' : ''}">
      ${state.boostConfirmOpen ? `
        <h3 class="modal-title">ブーストしますか？</h3>
        <p class="modal-text">動画広告視聴で本日中作業時間25分あたり<br>1個砂時計→20分で1個砂時計が<br>貯まるようになります<br>ブーストして効率よく砂時計をゲットしよう！</p>
        <div class="modal-actions">
          <button class="modal-btn modal-btn-yes" type="button" data-modal-boost-yes>はい</button>
          <button class="modal-btn modal-btn-no" type="button" data-modal-boost-no>いいえ</button>
        </div>
      ` : state.rewardPopup ? `
        <div class="reward-sheet${rewardSheetEntryClass()}">
        ${buildRewardSheetTopHtml(state.rewardPopup)}
          <div class="reward-sheet-banner" data-ad-placement="${AD_PLACEMENTS.BANNER_REWARD_MODAL}" role="img" aria-label="広告エリア">
            <span class="ad-banner-dummy">300x250 banner</span>
          </div>
          <button class="reward-sheet-close" type="button" data-modal-close data-modal-action="close" data-modal-type="reward">閉じる</button>
        </div>
      ` : `
        <p class="modal-message">${modalMessage || ''}</p>
        <button class="modal-close" type="button" data-modal-close>閉じる</button>
      `}
    </div>
  </div>

  <!-- ミッションオーバーレイ（ホーム上に表示） -->
  <div class="mission-overlay app-modal-overlay ${state.missionScreenOpen ? 'mission-overlay--open app-modal-open modal-open' : ''}" data-mission-overlay data-modal-type="${OVERLAY_EXTRA_TYPES.MISSION_PANEL}">
    <div class="mission-backdrop" data-mission-close></div>
    <div class="mission-panel-wrap">
      <button type="button" class="mission-panel-close" data-mission-close aria-label="閉じる">×</button>
      <div class="mission-panel" data-mission-panel>
      <div class="mission-tabs">
        <button type="button" class="mission-tab ${missionTab === 'daily' ? 'mission-tab--active' : ''}" data-mission-tab="daily">デイリー</button>
        <button type="button" class="mission-tab ${missionTab === 'weekly' ? 'mission-tab--active' : ''}" data-mission-tab="weekly">ウィークリー</button>
        <button type="button" class="mission-tab ${missionTab === 'monthly' ? 'mission-tab--active' : ''}" data-mission-tab="monthly">月間</button>
        <button type="button" class="mission-tab ${missionTab === 'total' ? 'mission-tab--active' : ''}" data-mission-tab="total">累計</button>
      </div>
      <div class="mission-list">
        ${buildMissionListInnerHtml(missionsSorted)}
      </div>
      <button type="button" class="mission-claim-all" data-mission-claim-all ${!hasUnclaimed ? 'disabled' : ''}>すべて受け取る</button>
    </div>
    </div>
  </div>
`

  bindHomeAppDelegationOnce()
  applyHomeScale()
  applyMissionPanelScale()
  schedulePangleBannerRefresh()
  } finally {
    renderOnboardingOverlay()
    syncBodyScrollLock()
    cleanupOrphanOverlays()
    cleanupOrphanToasts()
  }
}

// --- 砂時計消費：15獲得 ---
async function handle15Click() {
  if (state.hourglasses < 1) return
  return withLoading('get15', async () => {
    state.hourglasses -= 1
    saveState()
    if (!openRewardPopupWithGuard({ type: 'points', amount: 15 })) return
    await addPoints(15, 'get_15', '15獲得ボタン', { skipRender: true })
    render()
  })
}

// --- 砂時計消費：動画で80pt＋豚チケット1枚獲得（リワード広告完了後のみ付与） ---
async function handleVideoClick() {
  if (state.hourglasses < 1) return
  return withLoading('video80', async () => {
    const rewardedOk = await showRewardedAdFor80Points()
    if (!rewardedOk) return
    state.hourglasses -= 1
    saveState()
    if (
      !openRewardPopupWithGuard({
        items: [
          { type: 'points', amount: 80 },
          { type: 'ticket', amount: 1 },
        ],
      })
    ) {
      return
    }
    await addPigTickets(1, 'ad_bonus', '動画視聴報酬', { skipRender: true })
    await addPoints(80, 'get_80', '動画視聴報酬', { skipRender: true })
    render()
  })
}

function resetRewardHistoryState() {
  state.rewardHistoryOpen = false
  state.rewardHistoryLoading = false
  state.rewardHistoryItems = null
  state.rewardHistoryError = null
}

function closeRewardHistory() {
  resetRewardHistoryState()
  render()
}

function closeModal(type) {
  const hadReward = !!state.rewardPopup
  const modalType =
    typeof type === 'string' && type.length > 0 ? type : state.activeModal || null
  if (modalType) {
    closeModalByType(modalType)
  } else if (state.activeModal) {
    closeModalByType(state.activeModal)
  } else {
    clearAllModalState()
    removeOrphanModalOverlays()
    console.log('[modal] overlay cleanup')
    refreshModalsUI()
  }
  resetRewardHistoryState()
  if (hadReward && !state.rewardPopup && pendingRouletteInterstitialAfterRewardClose) {
    pendingRouletteInterstitialAfterRewardClose = false
    showInterstitialAfterRouletteEvery3Spins()
  }
}

async function handleGameGiftClaim() {
  if (gameGiftClaimInProgress) return
  const today = getTodayKey()
  if (state.gameGiftClaimDate === today) return
  gameGiftClaimInProgress = true
  try {
    state.gameGiftClaimDate = today
    saveState()
    if (!openRewardPopupWithGuard({ type: 'points', amount: 10 })) return
    await addPoints(10, 'gift', 'ゲームプレゼント（1日1回）', { skipRender: true })
    patchGamePointsDisplay()
    patchGameGiftButton()
  } catch (err) {
    console.error(err)
  } finally {
    gameGiftClaimInProgress = false
  }
}

function scrollToTopOnScreenChange() {
  window.scrollTo(0, 0)
  document.documentElement.scrollTop = 0
  document.body.scrollTop = 0
  const app = document.querySelector('#app')
  if (app) app.scrollTop = 0
}

/**
 * 作業セッションの UI 上のフェーズ（state の真偽から派生。state に冗長フィールドは足さない）
 *
 * 判定順: result → idle →（作業中のみ）endConfirm → paused → checkingTool → countdown → running
 *
 * | フェーズ       | 条件（派生） | isWorking | workToolCheckDone | workCountdownDone | … |
 * |---------------|-------------|-----------|-------------------|-------------------|---|
 * | checkingTool  | 開始直後の道具 AI（最大12秒）または成功→カウントダウン直前の短い表示 | true | false | false | … |
 * | countdown     | 道具判定完了後の10秒待ち | true | true | false | … |
 *
 * | フェーズ     | 条件（派生） | isWorking | screen | endConfirmOpen | workCountdownDone | isPaused | startTick | 主に有効な操作 | 主な遷移元（司令塔） |
 * |-------------|-------------|-----------|--------|----------------|-------------------|----------|-----------|--------------|---------------------|
 * | idle        | 上記以外で作業セッション外 | false | home 等 | false | 任意 | 任意 | オフ | ホーム「作業開始」 | — |
 * | result      | 終了確定後のサマリー | false | result | false | 任意 | 任意 | オフ | 「ホームに戻る」 | confirmEnd |
 * | endConfirm  | 終了確認モーダル表示中 | true | work | true | 任意 | 任意 | 継続（モーダルでは tick を止めない） | 確定／キャンセル | requestEndDialog |
 * | paused      | 一時停止中（手動 or 自動） | true | work | false | 任意 | true | オフ | 再開／終了／暗幕 | togglePauseResume, applyBackgroundAutoPause |
 * | checkingTool | 初回道具判定（3秒準備→AI最大12秒／経過時間は加算しない） | true | work | false | false | false | オフ | 終了／暗幕（一時停止は無効） | start → _startToolCheck |
 * | countdown   | 10秒経過前かつ未一時停止（道具判定完了後） | true | work | false | false | false | オフ | 一時停止／終了／暗幕 | _beginWorkCountdownAfterToolCheck |
 * | running     | 本番計測中 | true | work | false | true | false | オン | 一時停止／終了／暗幕 | _afterCountdownStartTick, togglePauseResume(再開) |
 *
 * ※ countdown / checkingTool 中に一時停止すると isPaused が先に立つためフェーズは paused になる（従来挙動のまま）。
 */
/** @typedef {'idle'|'checkingTool'|'countdown'|'running'|'paused'|'endConfirm'|'result'} WorkSessionPhase */

const WORK_SESSION_PHASE = Object.freeze({
  IDLE: 'idle',
  CHECKING_TOOL: 'checkingTool',
  COUNTDOWN: 'countdown',
  RUNNING: 'running',
  PAUSED: 'paused',
  END_CONFIRM: 'endConfirm',
  RESULT: 'result',
})

/** 現在の作業セッション UI フェーズを返す（デバッグ・可読性用。挙動判定の正は従来どおり state） */
function getWorkSessionPhase() {
  // ルール: render / UI 表示分岐で作業セッション状態を読むときは、この関数の戻り値を第一選択にする。
  // （複数フラグの直読みは、既存挙動維持のため必要な最小限に限定）
  if (state.screen === 'result') return WORK_SESSION_PHASE.RESULT
  if (state.screen !== 'work' || !state.isWorking) return WORK_SESSION_PHASE.IDLE
  if (state.endConfirmOpen) return WORK_SESSION_PHASE.END_CONFIRM
  if (state.isPaused) return WORK_SESSION_PHASE.PAUSED
  if (!state.workToolCheckDone) return WORK_SESSION_PHASE.CHECKING_TOOL
  if (!state.workCountdownDone) return WORK_SESSION_PHASE.COUNTDOWN
  return WORK_SESSION_PHASE.RUNNING
}

/**
 * 作業セッション司令塔（開始・一時停止/再開・終了フローの入り口をここに集約）
 *
 * - UI / イベントからは workSession のメソッドのみを呼ぶ（このファイル内も同様）
 * - 新機能を追加する際も「作業系の実行入口」は workSession に追加し、UI から直接 state を更新しない
 * - 1秒タイマー tick の interval 開始/停止は原則ここ経由（終了確定・手動一時停止・自動一時停止・開始カウントダウン完了）
 * - tick() 本体・砂時計付与ロジックは変更しない
 * - 画面の再描画はこれまで通り各メソッド末尾で render（tick 中の軽量更新は tick 内の updateWorkTimerDisplay のまま）
 * - 「今どのフェーズか」は getWorkSessionPhase() を参照（state は変更しない）
 */
const workSession = {
  /** 10秒カウントダウン終了後：本計測用の tick を開始する（司令塔内だけから呼ぶ） */
  _afterCountdownStartTick() {
    state.workCountdownDone = true
    state.workCountdownTimeoutId = null
    state.lastTickAt = Date.now()
    startTick()
    scheduleNextMotionCheck()
    refreshWorkScreenUI({ reason: 'after_countdown_start' })
  },

  /** 道具判定完了後に 10 秒カウントダウン（初回本番タイマー開始前）をセット */
  _beginWorkCountdownAfterToolCheck() {
    if (state.workCountdownTimeoutId) {
      clearTimeout(state.workCountdownTimeoutId)
      state.workCountdownTimeoutId = null
    }
    state.workCountdownTimeoutId = setTimeout(() => {
      workSession._afterCountdownStartTick()
    }, 10000)
  },

  _startToolCheck() {
    if (!state.isWorking || state.screen !== 'work') return
    if (state.workToolCheckDone) return
    if (toolCheckPrepareTimeoutId != null || toolCheckIntervalId != null || toolCheckHardStopTimeoutId != null) {
      console.warn('[guard] tool check already running')
      return
    }
    cleanupToolCheck('restart')
    state.toolCheckPrepareDone = false
    state.toolCheckUsedRescuePath = false

    console.log('[toolCheck] prepare start')

    toolCheckPrepareTimeoutId = setTimeout(() => {
      toolCheckPrepareTimeoutId = null
      if (!state.isWorking || state.workToolCheckDone) return
      console.log('[toolCheck] prepare done')
      state.toolCheckPrepareDone = true
      refreshWorkScreenUI({ reason: 'tool_prepare_done' })

      console.log('[toolCheck] start')
      toolCheckHardStopTimeoutId = setTimeout(() => {
        toolCheckHardStopTimeoutId = null
        if (!state.isWorking || state.workToolCheckDone) return
        console.log('[toolCheck] timeout auto start')
        cleanupToolCheck('timeout')
        state.workToolCheckDone = true
        state.toolCheckSuccessFlash = false
        state.toolCheckUsedRescuePath = true
        workSession._beginWorkCountdownAfterToolCheck()
        refreshWorkScreenUI({ reason: 'tool_timeout_countdown' })
      }, TOOL_CHECK_MAX_MS)

      toolCheckIntervalId = setInterval(() => {
        void workSession._toolCheckTick()
      }, TOOL_CHECK_INTERVAL_MS)
      void workSession._toolCheckTick()
    }, TOOL_CHECK_PREPARE_MS)
  },

  async _toolCheckTick() {
    if (!state.toolCheckPrepareDone) return
    if (!state.isWorking || state.workToolCheckDone || state.endConfirmOpen || state.toolCheckSuccessFlash) return
    if (toolCheckTickBusy) return
    toolCheckTickBusy = true
    try {
      const blob = await captureWorkCameraFrameForToolCheck(256)
      if (!blob) {
        return
      }
      let result
      try {
        result = await checkWorkToolPresence(blob)
      } catch (e) {
        console.log('[toolCheck] error', e?.message || String(e))
        return
      }
      const passed = result?.ok === true && hasAnyAllowedWorkTool(result.detectedTools)
      if (passed) {
        console.log('[toolCheck] detected', result.detectedTools, result.confidence != null ? { c: result.confidence } : '')
        cleanupToolCheck('detected')
        state.toolCheckSuccessFlash = true
        refreshWorkScreenUI({ reason: 'tool_detected' })
        toolCheckSuccessClearTimeoutId = setTimeout(() => {
          toolCheckSuccessClearTimeoutId = null
          state.toolCheckSuccessFlash = false
          state.workToolCheckDone = true
          state.workCountdownDone = true
          state.toolCheckUsedRescuePath = false
          state.lastTickAt = Date.now()
          startTick()
          scheduleNextMotionCheck()
          refreshWorkScreenUI({ reason: 'tool_success_start' })
        }, TOOL_CHECK_SUCCESS_UI_MS)
      }
    } finally {
      toolCheckTickBusy = false
    }
  },

  /** 作業開始（ホーム「作業開始」から） */
  async start() {
    if (isWorkStartProcessing) {
      console.warn('[guard] start skipped: already starting')
      return
    }
    if (state.isWorking) {
      console.warn('[guard] start skipped: already starting')
      return
    }
    isWorkStartProcessing = true
    try {
      await requestCameraInUserGesture()
      // 前回セッションの tick / toolCheck / motion 残存をクリア（新規開始の前処理。カメラは止めない）
      ensureWorkSessionTeardown('session_start_prep', { shouldStopCamera: false })
      state.motionFailCount = 0
      state.screen = 'work'
      state.isWorking = true
      state.isPaused = false
      state.autoPausedReason = null
      state.sessionStartAt = Date.now()
      state.elapsedSec = 0
      state.sessionGrantedCount = 0
      state.sessionOverflowWorkSec = 0
      state.lastTickAt = Date.now()
      state.workToolCheckDone = false
      state.toolCheckPrepareDone = false
      state.toolCheckUsedRescuePath = false
      state.toolCheckSuccessFlash = false
      state.workCountdownDone = false
      state.endConfirmOpen = false
      state.endConfirmResumeTickOnCancel = false
      state.endConfirmResumeCountdownOnCancel = false
      state.endConfirmResumeToolCheckOnCancel = false
      state.autoPaused = false
      state.autoPausedReason = null
      console.log('[work:endConfirm] close', { reason: 'session_start' })
      render({ forceFull: true, reason: 'work_session_start' })
      const videoEl = document.querySelector('#work-camera')
      if (videoEl && cameraStream) {
        await attachCameraToVideo(videoEl)
      }
      // 端末の縦画面ロックに任せる（JS で portrait 固定すると iOS カメラプレビューがずれることがある）
      if (isIOSPlatform()) {
        startWorkDeviceMotionListener()
      }
      syncWorkCameraVideoDisplay('session-start')
      workSession._startToolCheck()
      console.log('[workSession] start', {
        phase: getWorkSessionPhase(),
        hasStream: !!cameraStream,
      })
    } finally {
      isWorkStartProcessing = false
    }
  },

  /** 一時停止 / 再開（作業画面ボタン） */
  togglePauseResume() {
    const now = Date.now()
    if (now - lastPauseResumeTapAt < PAUSE_RESUME_GUARD_MS) {
      console.warn('[guard] pause skipped: rapid tap')
      return
    }
    lastPauseResumeTapAt = now
    state.isPaused = !state.isPaused
    if (state.isPaused) {
      ensureWorkSessionTeardown('pause', {
        shouldStopCamera: false,
        stopToolCheck: false,
        clearCountdown: true,
      })
    } else {
      state.autoPaused = false
      state.autoPausedReason = null
      state.lastTickAt = Date.now()
      if (
        state.workToolCheckDone &&
        !state.workCountdownDone &&
        !state.toolCheckSuccessFlash
      ) {
        workSession._beginWorkCountdownAfterToolCheck()
      } else if (state.workToolCheckDone && state.workCountdownDone) {
        startTick()
        scheduleNextMotionCheck()
      }
    }
    refreshWorkScreenUI({ reason: 'toggle_pause_resume' })
  },

  /** 終了ボタン → 確認モーダル */
  requestEndDialog() {
    if (state.endConfirmOpen) {
      console.log('[workSession] requestEndDialog skip', { phase: getWorkSessionPhase() })
      return
    }
    const wasRunning = !state.isPaused && state.workCountdownDone
    const wasToolChecking = !state.workToolCheckDone
    const wasCountdownOnly =
      !state.isPaused && state.workToolCheckDone && !state.workCountdownDone && !state.toolCheckSuccessFlash
    ensureWorkSessionTeardown('end_confirm_dialog', {
      shouldStopCamera: false,
      closeEndConfirm: false,
      stopTick: wasRunning,
      stopToolCheck: wasToolChecking,
      stopMotionCheck: true,
      clearCountdown: wasCountdownOnly,
    })
    state.endConfirmResumeTickOnCancel = wasRunning
    state.endConfirmResumeCountdownOnCancel = wasCountdownOnly
    state.endConfirmResumeToolCheckOnCancel = wasToolChecking
    if (wasRunning) {
      state.isPaused = true
    }
    state.endConfirmOpen = true
    console.log('[work:endConfirm] open')
    console.log('[workSession] requestEndDialog', {
      phase: getWorkSessionPhase(),
      wasRunning,
      wasCountdownOnly,
      wasToolChecking,
    })
    refreshWorkScreenUI({ reason: 'end_confirm_open' })
  },

  /** 終了確認で確定 → 記録・カメラ停止・結果画面へ */
  async confirmEnd() {
    if (isConfirmEndProcessing) {
      console.warn('[guard] confirmEnd skipped: already processing')
      return
    }
    isConfirmEndProcessing = true
    try {
      console.log('[workSession] confirmEnd', {
        phase: getWorkSessionPhase(),
        elapsedSec: state.elapsedSec,
      })
      blurIfFocusInside(document.querySelector('#app [data-work-end-confirm]'))
      ensureWorkSessionTeardown('confirmEnd', { shouldStopCamera: true, closeEndConfirm: true })
      state.motionFailCount = 0
      state.toolCheckSuccessFlash = false
      const elapsed = state.elapsedSec
      const earnedHourglasses = state.sessionGrantedCount
      const endedAt = new Date()
      if (elapsed > 0) {
        addWorkSeconds(getTodayKey(), elapsed)
        await applyWorkSessionEndMissionProgress(elapsed)
        void saveStudyLogAfterWorkEnd({
          durationSeconds: elapsed,
          earnedHourglasses,
          endedAt,
          logDate: getTodayKey(),
        })
      }
      const intervalSec = getIntervalSec()
      state.hourglassCarrySecToday = Math.max(
        0,
        state.hourglassCarrySecToday + elapsed - state.sessionGrantedCount * intervalSec
      )
      await applyOverflowPigTicketBonus(state.sessionOverflowWorkSec || 0)
      state.sessionOverflowWorkSec = 0
      state.isWorking = false
      state.autoPaused = false
      state.autoPausedReason = null
      state.endConfirmOpen = false
      state.endConfirmResumeTickOnCancel = false
      state.endConfirmResumeCountdownOnCancel = false
      state.endConfirmResumeToolCheckOnCancel = false
      state.workToolCheckDone = true
      state.toolCheckPrepareDone = true
      state.toolCheckUsedRescuePath = false
      state.toolCheckSuccessFlash = false
      state.screen = 'result'
      document.body.classList.remove('work-screen-active')
      saveState()
      render({ forceFull: true, reason: 'work_confirm_end' })
    } finally {
      isConfirmEndProcessing = false
    }
  },

  cancelEndDialog() {
    console.log('[workSession] cancelEndDialog', {
      phase: getWorkSessionPhase(),
      resumeTick: state.endConfirmResumeTickOnCancel,
      resumeCountdown: state.endConfirmResumeCountdownOnCancel,
      resumeToolCheck: state.endConfirmResumeToolCheckOnCancel,
    })
    state.endConfirmOpen = false
    console.log('[work:endConfirm] close', { reason: 'cancel' })
    if (state.endConfirmResumeToolCheckOnCancel) {
      state.toolCheckSuccessFlash = false
      state.toolCheckPrepareDone = false
      workSession._startToolCheck()
    } else if (state.endConfirmResumeTickOnCancel) {
      // running -> endConfirm -> cancel: tick を再開
      state.isPaused = false
      state.lastTickAt = Date.now()
      startTick()
      scheduleNextMotionCheck()
    } else if (state.endConfirmResumeCountdownOnCancel) {
      // countdown -> endConfirm -> cancel: 安全策として10秒カウントダウンを再セットして復帰
      if (state.workCountdownTimeoutId) {
        clearTimeout(state.workCountdownTimeoutId)
      }
      state.workCountdownDone = false
      if (state.autoPausedReason !== 'background') {
        state.workCountdownTimeoutId = setTimeout(() => {
          workSession._afterCountdownStartTick()
        }, 10000)
      }
    }
    state.endConfirmResumeTickOnCancel = false
    state.endConfirmResumeCountdownOnCancel = false
    state.endConfirmResumeToolCheckOnCancel = false
    refreshWorkScreenUI({ reason: 'end_confirm_cancel' })
  },

  /** タブ非表示・フォーカス喪失時の自動一時停止（司令塔経由で tick を止める） */
  applyBackgroundAutoPause() {
    if (state.screen !== 'work' || !state.isWorking || state.isPaused) return
    if (!state.workToolCheckDone) return
    ensureWorkSessionTeardown('background_pause', {
      shouldStopCamera: false,
      stopToolCheck: false,
      clearCountdown: true,
    })
    state.isPaused = true
    state.autoPaused = true
    state.autoPausedReason = 'background'
    refreshWorkScreenUI({ reason: 'background_auto_pause' })
  },
}

// --- 暗幕トグル ---
/** 暗幕ON/OFF。カメラは停止せず裏で起動したまま */
function handleDarkToggle() {
  state.darkMode = !state.darkMode
  refreshWorkScreenUI({ reason: 'dark_toggle' })
}

// --- 暗幕タップで解除 ---
function handleDarkOverlayTap() {
  state.darkMode = false
  refreshWorkScreenUI({ reason: 'dark_overlay_tap' })
}

// --- 画面から離れた時の自動一時停止（司令塔へ委譲） ---
function doAutoPause() {
  workSession.applyBackgroundAutoPause()
}

// --- ホームに戻る ---
function handleBackHome() {
  if (state.screen !== 'result') {
    console.warn('[nav] handleBackHome blocked', {
      screen: state.screen,
      isWorking: state.isWorking,
      reason: 'not-result-screen',
    })
    return
  }
  // 作業終了後の結果画面 → ホームに戻る直前（将来のインターステシャル差し込み点）
  ensureWorkSessionTeardown('result_back_home', { shouldStopCamera: true, closeEndConfirm: true })
  showInterstitialAfterWorkEnd()
  state.elapsedSec = 0
  state.sessionStartAt = null
  state.lastTickAt = null
  state.sessionGrantedCount = 0
  state.sessionOverflowWorkSec = 0
  state.overflowPigTicketsGrantedThisSession = 0
  changeScreen('home', { reason: 'work-result-back' })
}

// --- 視聴でブースト：確認モーダルを開く ---
function handleBoostClick() {
  if (state.boostActive) return
  openModal(MODAL_TYPES.BOOST, null, { closeOthers: true })
}

// --- ブースト確認「はい」（リワード広告完了後のみ有効化） ---
async function handleBoostConfirmYes() {
  return withLoading('boost', async () => {
    const rewardedOk = await showRewardedAdForBoost()
    if (!rewardedOk) return
    state.boostActive = true
    state.boostDate = getTodayKey()
    saveState()
    showToast('ブーストが有効になりました')
    closeModalByType(MODAL_TYPES.BOOST)
    if (state.screen === 'home' && document.querySelector('#app .home-viewport')) {
      patchHomeActionButtons()
    }
  })
}

// --- ブースト確認「いいえ」 ---
function handleBoostConfirmNo() {
  closeModalByType(MODAL_TYPES.BOOST)
}

// --- フッターナビ（左から：コントローラー・ホーム・アカウント・カレンダー） ---
document.querySelector('[data-nav="controller"]')?.addEventListener('click', () => {
  navigateToScreen('game')
})
document.querySelector('[data-nav="home"]')?.addEventListener('click', () => {
  navigateToScreen('home')
})
document.querySelector('[data-nav="account"]')?.addEventListener('click', () => {
  navigateToScreen('account')
})
document.querySelector('[data-nav="calendar"]')?.addEventListener('click', () => {
  navigateToScreen('calendar')
})

// =============================================================================
// アプリ起動（4レイヤー boot）
// Layer 0: ホーム表示前に必須（blocking）
// Layer 1: ホーム表示直後（バナー広告・ミッション件数など）
// Layer 2: 1秒後（reward/interstitial preload・ミッション本番・紹介通知など）
// Layer 3: 3秒後（offerwall など lazy）
// =============================================================================

console.log('[boot] start', { ms: 0 })
syncPlatformBodyClasses()
logAdConfigInDev()
logBannerPlacementsInDev()
loadState()
state.userId = getUserId()
console.log('[init] userId confirmed', { userId: state.userId })

const ensureUserExists = async () => {
  const userId = state.userId || getUserId()
  console.log('[init] ensureUserExists', {
    op: 'start',
    userId,
    pointsRowId: state.pointsRowId,
  })
  try {
    const { data: userRow, error: userSelectError } = await supabase
      .from('users')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()
    if (userSelectError) {
      console.error('[supabase] ensureUserExists', {
        userId,
        op: 'select',
        message: userSelectError.message,
        code: userSelectError.code,
        details: userSelectError,
      })
      console.warn('[init] ensureUserExists', {
        op: 'warn',
        step: 'select',
        message: userSelectError.message,
        code: userSelectError.code,
        details: userSelectError,
        userId,
        pointsRowId: state.pointsRowId,
      })
    }
    if (!userRow) {
      const { error: userInsertError } = await supabase
        .from('users')
        .insert({ user_id: userId, username: DEFAULT_USERNAME })
      if (userInsertError) {
        console.error('[supabase] ensureUserExists', {
          userId,
          op: 'insert',
          message: userInsertError.message,
          code: userInsertError.code,
          details: userInsertError,
        })
        console.error('[init] ensureUserExists', {
          op: 'fail',
          step: 'insert',
          message: userInsertError.message,
          code: userInsertError.code,
          details: userInsertError,
          userId,
          pointsRowId: state.pointsRowId,
        })
        return
      }
      console.log('[supabase] ensureUserExists', { userId, op: 'insert_ok' })
    } else {
      markRegistrationComplete()
    }
    void ensureReferralCode(userId).catch((e) =>
      console.error('[referral] ensure code on init failed', e)
    )
    console.log('[init] ensureUserExists', {
      op: 'success',
      userId,
      pointsRowId: state.pointsRowId,
    })
  } catch (e) {
    console.error('[supabase] ensureUserExists', { userId, op: 'exception', message: e?.message, details: e })
    console.error('[init] ensureUserExists', {
      op: 'fail',
      step: 'exception',
      message: e?.message,
      details: e,
      userId,
      pointsRowId: state.pointsRowId,
    })
  }
}

async function fetchUsernameFromSupabase() {
  const userId = state.userId || getUserId()
  console.log('[user] fetch username start', { userId })
  try {
    const { data, error } = await supabase.from('users').select('username').eq('user_id', userId).maybeSingle()
    if (error) throw error
    if (!data) {
      console.warn('[user] fetch username no row', { userId })
      return
    }
    let name = DEFAULT_USERNAME
    const u = data.username
    if (u != null && String(u).trim() !== '') {
      name = normalizeUsernameForStorage(String(u))
    }
    state.username = name
    saveState()
    console.log('[user] fetch username success', { userId, username: name })
  } catch (e) {
    console.error('[user] fetch username failed', e?.message || String(e), e)
  }
}

const DEFAULT_ICON_KEYS = ['default_01', 'default_04', 'default_05']
/** 廃止済み — ピッカーに出さない（user_icons に残っていても非表示） */
const HIDDEN_ICON_KEYS = new Set(['default_02', 'default_03'])
const DEFAULT_SELECTED_ICON_KEY = 'default_01'
const DEFAULT_ICON_ASSET_PATH = '/assets/icon/default_01.svg'
/** DB が旧パスのままでも default_xx の表示パスを正す（表示名は icon_master 参照） */
const DEFAULT_ICON_ASSET_OVERRIDES = Object.freeze({
  default_01: '/assets/icon/default_01.svg',
  default_04: '/assets/icon/default_04.svg',
  default_05: '/assets/icon/default_05.svg',
})

function resolveIconDisplayName(displayNameFromDb, iconKey) {
  const name = String(displayNameFromDb || '').trim()
  const key = String(iconKey || '').trim()
  return name || key
}

/** 表示用: 最初の星文字以降を2行目に分離（DB の display_name は変更しない） */
const ICON_PICKER_STAR_CHAR_PATTERN = /[★☆⭐]/u

function splitIconDisplayNameForPicker(displayName) {
  const name = String(displayName || '')
  const match = name.match(ICON_PICKER_STAR_CHAR_PATTERN)
  if (!match || match.index == null) {
    return { base: name.trim(), stars: '' }
  }
  const starIndex = match.index
  return {
    base: name.slice(0, starIndex).trimEnd(),
    stars: name.slice(starIndex).trim(),
  }
}

function buildIconPickerDisplayNameHtml(displayName) {
  const { base, stars } = splitIconDisplayNameForPicker(displayName)
  if (!stars) {
    return `<span class="icon-picker-item-name">${escapeHtml(base || displayName)}</span>`
  }
  return `<span class="icon-picker-item-name icon-picker-item-name--split">
    <span class="icon-picker-item-name-base">${escapeHtml(base)}</span>
    <span class="icon-picker-item-name-stars">${escapeHtml(stars)}</span>
  </span>`
}

function indexIconMasterByKey(masterRows) {
  return new Map(
    (masterRows || []).map((row) => [row.icon_key, row]).filter(([key]) => key)
  )
}

function buildIconPickerItemFromMaster(masterRow, iconKeyFallback = '') {
  const iconKey = String(masterRow?.icon_key || iconKeyFallback || '').trim()
  if (!iconKey) return null
  return {
    iconKey,
    displayName: resolveIconDisplayName(masterRow?.display_name, iconKey),
    assetPath: resolveIconAssetPath(iconKey, masterRow?.asset_path),
    sortOrder: Number(masterRow?.sort_order) || 0,
  }
}

function buildIconPickerItemFallback(iconKey) {
  const key = String(iconKey || '').trim()
  if (!key) return null
  return {
    iconKey: key,
    displayName: key,
    assetPath: resolveIconAssetPath(key, null),
    sortOrder: 0,
  }
}

/** default_xx はカタログの実ファイルパスを優先（DB が旧 /assets/icons/ のままでも表示を正す） */
function resolveIconAssetPath(iconKey, assetPathFromDb) {
  const override = DEFAULT_ICON_ASSET_OVERRIDES[iconKey]
  if (override) return override
  const path = String(assetPathFromDb || '').trim()
  if (path) {
    if (path.startsWith('/assets/icons/')) {
      return path.replace('/assets/icons/', '/assets/icon/')
    }
    return path
  }
  const key = String(iconKey || '').trim()
  if (key) return `/assets/icon/${key}.svg`
  return DEFAULT_ICON_ASSET_PATH
}

function logIconAssetPaths(label, items) {
  const assets = (items || []).map((item) => ({
    iconKey: item.iconKey ?? item.icon_key,
    assetPath: item.assetPath ?? item.asset_path ?? resolveIconAssetPath(item.iconKey ?? item.icon_key, item.asset_path),
  }))
  const uniquePaths = [...new Set(assets.map((a) => a.assetPath))]
  console.log(`[icons] ${label}`, {
    assets,
    uniquePathCount: uniquePaths.length,
    pathsDistinct: uniquePaths.length === assets.length && assets.length > 0,
  })
}

function logSelectedIconState(label) {
  console.log(`[icons] ${label}`, {
    selectedIconKey: state.selectedIconKey,
    selectedIconAssetPath: getSelectedIconAssetPath(),
  })
}

function buildDefaultIconPickerItems(masterRows = []) {
  const masterByKey = indexIconMasterByKey(masterRows)
  const items = DEFAULT_ICON_KEYS.map((key) => buildIconPickerItemFromMaster(masterByKey.get(key), key)).filter(
    Boolean
  )
  if (items.length) return sortIconPickerItems(items)
  return sortIconPickerItems(DEFAULT_ICON_KEYS.map((key) => buildIconPickerItemFallback(key)).filter(Boolean))
}

function sortIconPickerItems(items) {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.iconKey.localeCompare(b.iconKey))
}

function buildUserIconsPickerItems(rows, masterRows = []) {
  const masterByKey = indexIconMasterByKey(masterRows)
  const normalized = (rows || [])
    .map(normalizeUserIconPickerRow)
    .filter((item) => {
      if (!item.iconKey || HIDDEN_ICON_KEYS.has(item.iconKey)) return false
      const raw = (rows || []).find((row) => row.icon_key === item.iconKey)
      const master = raw?.icon_master
      const m = Array.isArray(master) ? master[0] : master
      return !m || m.is_active !== false
    })
  const byKey = new Map(normalized.map((item) => [item.iconKey, item]))
  for (const key of DEFAULT_ICON_KEYS) {
    if (!byKey.has(key)) {
      const fromMaster = buildIconPickerItemFromMaster(masterByKey.get(key), key)
      if (fromMaster) byKey.set(key, fromMaster)
    }
  }
  return sortIconPickerItems([...byKey.values()])
}

function getSelectedIconAssetPath() {
  const path = String(state.selectedIconAssetPath || '').trim()
  return path || DEFAULT_ICON_ASSET_PATH
}

function applySelectedIconToState(iconRow) {
  if (iconRow?.icon_key && !HIDDEN_ICON_KEYS.has(iconRow.icon_key)) {
    state.selectedIconKey = iconRow.icon_key
    state.selectedIconAssetPath = resolveIconAssetPath(iconRow.icon_key, iconRow.asset_path)
    return
  }
  state.selectedIconKey = DEFAULT_SELECTED_ICON_KEY
  state.selectedIconAssetPath = DEFAULT_ICON_ASSET_PATH
}

function normalizeUserIconPickerRow(row) {
  const master = row?.icon_master
  const m = Array.isArray(master) ? master[0] : master
  const iconKey = row?.icon_key
  if (m) {
    return buildIconPickerItemFromMaster({ ...m, icon_key: m.icon_key || iconKey }, iconKey)
  }
  return buildIconPickerItemFallback(iconKey)
}

async function loadSelectedIconIntoState(userId) {
  const res = await fetchSelectedIcon(userId)
  if (!res.ok) {
    applySelectedIconToState(null)
    return res
  }
  applySelectedIconToState(res.data)
  logSelectedIconState('selected icon loaded')
  return { ok: true, data: res.data, error: null }
}

async function fetchIconMaster() {
  return runApi('fetchIconMaster', () =>
    supabase.from('icon_master').select('*').eq('is_active', true).order('sort_order', { ascending: true })
  )
}

async function fetchUserIcons(userId) {
  const uid = userId || state.userId || getUserId()
  return runApi('fetchUserIcons', () =>
    supabase
      .from('user_icons')
      .select(
        'id, user_id, icon_key, acquired_at, source, source_ref, icon_master(display_name, asset_path, sort_order, is_active)'
      )
      .eq('user_id', uid)
      .order('acquired_at', { ascending: true })
  )
}

async function fetchUserIconKeys(userId) {
  const uid = userId || state.userId || getUserId()
  return runApi('fetchUserIconKeys', () =>
    supabase.from('user_icons').select('icon_key').eq('user_id', uid)
  )
}

async function fetchRouletteEligibleIconMaster() {
  return runApi('fetchRouletteEligibleIconMaster', () =>
    supabase
      .from('icon_master')
      .select('icon_key, display_name, asset_path, sort_order')
      .eq('is_active', true)
      .eq('roulette_eligible', true)
      .order('sort_order', { ascending: true })
  )
}

async function getEligibleRouletteIconsForUser(userId) {
  const uid = userId || state.userId || getUserId()
  const [masterRes, ownedRes] = await Promise.all([
    fetchRouletteEligibleIconMaster(),
    fetchUserIconKeys(uid),
  ])
  if (!masterRes.ok) {
    return { ok: false, data: [], error: masterRes.error }
  }
  const ownedKeys = new Set(
    (Array.isArray(ownedRes.data) ? ownedRes.data : []).map((row) => row.icon_key).filter(Boolean)
  )
  const eligible = (Array.isArray(masterRes.data) ? masterRes.data : []).filter(
    (row) => row?.icon_key && !ownedKeys.has(row.icon_key)
  )
  return { ok: true, data: eligible, error: null }
}

async function refreshRouletteEligibleIconsCache(userId) {
  const res = await getEligibleRouletteIconsForUser(userId)
  if (!res.ok) {
    state.rouletteEligibleIcons = []
    return res
  }
  state.rouletteEligibleIcons = res.data
  console.log('[icons] roulette eligible cache', {
    count: state.rouletteEligibleIcons.length,
    keys: state.rouletteEligibleIcons.map((row) => row.icon_key),
  })
  return res
}

function isDuplicateKeyApiError(error) {
  const code = String(error?.code ?? '').trim()
  const category = String(error?.category ?? '').trim()
  const message = String(error?.message ?? '').toLowerCase()
  return (
    code === '23505' ||
    code === '409' ||
    category === 'duplicate' ||
    message.includes('duplicate key') ||
    message.includes('unique constraint')
  )
}

async function ensureDefaultIconsForUser(userId) {
  const uid = String(userId || state.userId || getUserId() || '').trim()
  if (!uid) {
    const err = normalizeApiError({ message: 'missing userId' })
    logApiFailed('ensureDefaultIconsForUser', err)
    return { ok: false, data: null, error: err }
  }
  console.log('[icons] ensureDefaultIconsForUser start', { userId: uid })
  const existingRes = await runApi('ensureDefaultIconsForUser.selectExisting', () =>
    supabase.from('user_icons').select('icon_key').eq('user_id', uid).in('icon_key', DEFAULT_ICON_KEYS)
  )
  if (!existingRes.ok) {
    logApiFailed('ensureDefaultIconsForUser', existingRes.error)
    return existingRes
  }
  const ownedKeys = new Set(
    (Array.isArray(existingRes.data) ? existingRes.data : []).map((row) => row.icon_key).filter(Boolean)
  )
  const rowsToGrant = DEFAULT_ICON_KEYS.filter((iconKey) => !ownedKeys.has(iconKey)).map((iconKey) => ({
    user_id: uid,
    icon_key: iconKey,
    source: 'default_grant',
  }))
  if (rowsToGrant.length > 0) {
    const insertRes = await runApi('ensureDefaultIconsForUser.upsert', () =>
      supabase.from('user_icons').upsert(rowsToGrant, {
        onConflict: 'user_id,icon_key',
        ignoreDuplicates: true,
      })
    )
    if (!insertRes.ok && !isDuplicateKeyApiError(insertRes.error)) {
      logApiFailed('ensureDefaultIconsForUser', insertRes.error)
      return insertRes
    }
    if (!insertRes.ok) {
      console.log('[icons] ensureDefaultIconsForUser grant skipped (already owned)', {
        userId: uid,
        keys: DEFAULT_ICON_KEYS,
      })
    }
  } else {
    console.log('[icons] ensureDefaultIconsForUser grant skipped (all defaults owned)', { userId: uid })
  }
  const selectRes = await runApi('ensureDefaultIconsForUser.selectUser', () =>
    supabase.from('users').select('selected_icon_key').eq('user_id', uid).maybeSingle()
  )
  if (!selectRes.ok) {
    logApiFailed('ensureDefaultIconsForUser', selectRes.error)
    return selectRes
  }
  if (!selectRes.data?.selected_icon_key) {
    const updateRes = await runApi('ensureDefaultIconsForUser.setSelected', () =>
      supabase
        .from('users')
        .update({ selected_icon_key: DEFAULT_SELECTED_ICON_KEY })
        .eq('user_id', uid)
        .is('selected_icon_key', null)
    )
    if (!updateRes.ok) {
      logApiFailed('ensureDefaultIconsForUser', updateRes.error)
      return updateRes
    }
  }
  console.log('[icons] ensureDefaultIconsForUser success', { userId: uid })
  return { ok: true, data: null, error: null }
}

/**
 * 任意 icon_key をユーザーに付与（ミッション / ガラポン / ギフトコード等から共通利用予定）
 * @param {string} userId
 * @param {string} iconKey
 * @param {string} source 例: 'mission' | 'roulette' | 'gift_code' | 'default_grant'
 * @param {string|null} [sourceRef] 例: mission_key / gift_code_id
 * @returns {Promise<{ ok: boolean, granted: boolean, duplicate: boolean, data: object|null, error: object|null }>}
 */
async function grantIconToUser(userId, iconKey, source, sourceRef = null) {
  const uid = String(userId || state.userId || getUserId() || '').trim()
  const key = String(iconKey || '').trim()
  const src = String(source || '').trim()
  const ref = sourceRef == null || sourceRef === '' ? null : String(sourceRef).trim()
  if (!uid || !key || !src) {
    const err = normalizeApiError({ message: 'userId, iconKey, source are required' })
    logApiFailed('grantIconToUser', err)
    return { ok: false, granted: false, duplicate: false, data: null, error: err }
  }
  console.log('[icons] grantIconToUser start', { userId: uid, iconKey: key, source: src, sourceRef: ref })

  const masterRes = await runApi('grantIconToUser.master', () =>
    supabase.from('icon_master').select('icon_key, is_active').eq('icon_key', key).maybeSingle()
  )
  if (!masterRes.ok) {
    logApiFailed('grantIconToUser', masterRes.error)
    return { ok: false, granted: false, duplicate: false, data: null, error: masterRes.error }
  }
  if (!masterRes.data?.icon_key || masterRes.data.is_active !== true) {
    const err = normalizeApiError({ code: 'invalid_icon', message: 'icon_key not found or inactive' })
    logApiFailed('grantIconToUser', err)
    return { ok: false, granted: false, duplicate: false, data: null, error: err }
  }

  const existingRes = await runApi('grantIconToUser.checkOwned', () =>
    supabase
      .from('user_icons')
      .select('id, user_id, icon_key, acquired_at, source, source_ref')
      .eq('user_id', uid)
      .eq('icon_key', key)
      .maybeSingle()
  )
  if (!existingRes.ok) {
    logApiFailed('grantIconToUser', existingRes.error)
    return { ok: false, granted: false, duplicate: false, data: null, error: existingRes.error }
  }

  if (existingRes.data) {
    const logRes = await insertIconGrantLog({
      userId: uid,
      iconKey: key,
      source: src,
      sourceRef: ref,
      grantResult: 'already_owned',
    })
    if (!logRes.ok) {
      logApiFailed('grantIconToUser', logRes.error)
      return { ok: false, granted: false, duplicate: true, data: existingRes.data, error: logRes.error }
    }
    console.log('[icons] grantIconToUser skipped (already owned)', { userId: uid, iconKey: key, source: src })
    return { ok: true, granted: false, duplicate: true, data: existingRes.data, error: null }
  }

  const insertRes = await runApi('grantIconToUser.insertUserIcon', () =>
    supabase
      .from('user_icons')
      .insert({
        user_id: uid,
        icon_key: key,
        source: src,
        source_ref: ref,
      })
      .select('id, user_id, icon_key, acquired_at, source, source_ref')
      .maybeSingle()
  )
  if (!insertRes.ok) {
    if (isDuplicateKeyApiError(insertRes.error)) {
      const dupRes = await runApi('grantIconToUser.selectOwnedAfterDup', () =>
        supabase
          .from('user_icons')
          .select('id, user_id, icon_key, acquired_at, source, source_ref')
          .eq('user_id', uid)
          .eq('icon_key', key)
          .maybeSingle()
      )
      await insertIconGrantLog({
        userId: uid,
        iconKey: key,
        source: src,
        sourceRef: ref,
        grantResult: 'already_owned',
      })
      console.log('[icons] grantIconToUser skipped (duplicate race)', { userId: uid, iconKey: key })
      return {
        ok: true,
        granted: false,
        duplicate: true,
        data: dupRes.data ?? null,
        error: null,
      }
    }
    logApiFailed('grantIconToUser', insertRes.error)
    return { ok: false, granted: false, duplicate: false, data: null, error: insertRes.error }
  }

  const logRes = await insertIconGrantLog({
    userId: uid,
    iconKey: key,
    source: src,
    sourceRef: ref,
    grantResult: 'granted',
  })
  if (!logRes.ok) {
    logApiFailed('grantIconToUser', logRes.error)
    return { ok: false, granted: true, duplicate: false, data: insertRes.data, error: logRes.error }
  }

  console.log('[icons] grantIconToUser success', {
    userId: uid,
    iconKey: key,
    source: src,
    acquiredAt: insertRes.data?.acquired_at,
  })
  return { ok: true, granted: true, duplicate: false, data: insertRes.data, error: null }
}

async function insertIconGrantLog({ userId, iconKey, source, sourceRef, grantResult }) {
  return runApi('insertIconGrantLog', () =>
    supabase.from('icon_grant_logs').insert({
      user_id: userId,
      icon_key: iconKey,
      source,
      source_ref: sourceRef,
      grant_result: grantResult,
    })
  )
}

async function fetchSelectedIcon(userId) {
  const uid = userId || state.userId || getUserId()
  const userRes = await runApi('fetchSelectedIcon.user', () =>
    supabase.from('users').select('selected_icon_key').eq('user_id', uid).maybeSingle()
  )
  if (!userRes.ok) return userRes
  const iconKey = userRes.data?.selected_icon_key
  if (!iconKey) {
    return { ok: true, data: null, error: null }
  }
  const iconRes = await runApi('fetchSelectedIcon.icon', () =>
    supabase.from('icon_master').select('*').eq('icon_key', iconKey).maybeSingle()
  )
  if (!iconRes.ok) return iconRes
  return { ok: true, data: iconRes.data ?? null, error: null }
}

async function setSelectedIcon(userId, iconKey) {
  const uid = userId || state.userId || getUserId()
  const key = String(iconKey || '').trim()
  if (!key) {
    const err = normalizeApiError({ message: 'iconKey required' })
    logApiFailed('setSelectedIcon', err)
    return { ok: false, data: null, error: err }
  }
  const ownRes = await runApi('setSelectedIcon.check', () =>
    supabase.from('user_icons').select('icon_key').eq('user_id', uid).eq('icon_key', key).maybeSingle()
  )
  if (!ownRes.ok) return ownRes
  if (!ownRes.data) {
    const err = normalizeApiError({ code: 'not_owned', message: 'icon not owned by user' })
    logApiFailed('setSelectedIcon', err)
    return { ok: false, data: null, error: err }
  }
  return runApi('setSelectedIcon.update', () =>
    supabase.from('users').update({ selected_icon_key: key }).eq('user_id', uid)
  )
}

const ensurePointsRowExists = async () => {
  const userId = state.userId || getUserId()
  const pointsRowIdBefore = state.pointsRowId
  console.log('[init] ensurePointsRowExists', { op: 'start', userId, pointsRowId: pointsRowIdBefore })
  console.log('[supabase] ensurePointsRowExists', { userId, pointsRowId: pointsRowIdBefore, op: 'start' })
  try {
    const { data: rows, error: pointsSelectError } = await supabase
      .from('points')
      .select('id, user_id, point')
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .limit(1)
    const pointRow = rows?.[0] ?? null
    if (pointsSelectError) {
      console.error('[supabase] ensurePointsRowExists', {
        userId,
        op: 'select',
        message: pointsSelectError.message,
        code: pointsSelectError.code,
        details: pointsSelectError,
      })
      console.error('[init] ensurePointsRowExists', {
        op: 'fail',
        step: 'select',
        message: pointsSelectError.message,
        code: pointsSelectError.code,
        details: pointsSelectError,
        userId,
        pointsRowId: state.pointsRowId,
      })
      return
    }

    if (pointRow) {
      state.pointsRowId = pointRow.id
      console.log('[supabase] ensurePointsRowExists', {
        userId,
        pointsRowId: state.pointsRowId,
        op: 'row_exists',
        outcome: 'ok',
      })
      console.log('[init] ensurePointsRowExists', {
        op: 'success',
        step: 'row_exists',
        userId,
        pointsRowId: state.pointsRowId,
      })
      return
    }

    const { data: insertedRow, error: pointsInsertError } = await supabase
      .from('points')
      .insert({ user_id: userId, point: 0 })
      .select('id, user_id, point')
      .maybeSingle()

    if (pointsInsertError) {
      console.error('[supabase] ensurePointsRowExists', {
        userId,
        op: 'insert',
        message: pointsInsertError.message,
        code: pointsInsertError.code,
        details: pointsInsertError,
      })
      console.error('[init] ensurePointsRowExists', {
        op: 'fail',
        step: 'insert',
        message: pointsInsertError.message,
        code: pointsInsertError.code,
        details: pointsInsertError,
        userId,
        pointsRowId: state.pointsRowId,
      })
      return
    }

    if (insertedRow?.id != null) {
      state.pointsRowId = insertedRow.id
      console.log('[supabase] ensurePointsRowExists', {
        userId,
        pointsRowId: state.pointsRowId,
        op: 'insert',
        outcome: 'ok',
      })
      console.log('[init] ensurePointsRowExists', {
        op: 'success',
        step: 'insert',
        userId,
        pointsRowId: state.pointsRowId,
      })
    } else {
      const { data: vRows, error: verifyErr } = await supabase
        .from('points')
        .select('id, user_id, point')
        .eq('user_id', userId)
        .order('id', { ascending: true })
        .limit(1)
      const verifyRow = vRows?.[0] ?? null
      if (verifyErr) {
        console.error('[supabase] ensurePointsRowExists', {
          userId,
          op: 'verify_select',
          message: verifyErr.message,
          code: verifyErr.code,
          details: verifyErr,
        })
        console.error('[init] ensurePointsRowExists', {
          op: 'fail',
          step: 'verify_select',
          message: verifyErr.message,
          code: verifyErr.code,
          details: verifyErr,
          userId,
          pointsRowId: state.pointsRowId,
        })
      }
      state.pointsRowId = verifyRow?.id ?? null
      console.log('[supabase] ensurePointsRowExists', {
        userId,
        pointsRowId: state.pointsRowId,
        op: 'verify',
        outcome: state.pointsRowId != null ? 'ok' : 'no_row',
      })
      if (state.pointsRowId != null) {
        console.log('[init] ensurePointsRowExists', {
          op: 'success',
          step: 'verify',
          userId,
          pointsRowId: state.pointsRowId,
        })
      } else {
        console.warn('[init] ensurePointsRowExists', {
          op: 'fail',
          step: 'verify',
          message: 'no row after insert',
          userId,
          pointsRowId: state.pointsRowId,
        })
      }
    }
  } catch (e) {
    console.error('[supabase] ensurePointsRowExists', { userId, op: 'exception', message: e?.message, details: e })
    console.error('[init] ensurePointsRowExists', {
      op: 'fail',
      step: 'exception',
      message: e?.message,
      details: e,
      userId,
      pointsRowId: state.pointsRowId,
    })
  }
}

const fetchPoints = async (options = {}) => {
  const { skipRender = false } = options
  if (isLoading('fetchPoints')) {
    console.log('[api] skipped fetchPoints already loading')
    return { ok: false, data: null, error: normalizeApiError({ code: 'already_loading' }), skipped: true }
  }
  return withLoading('fetchPoints', async () => {
    const userId = state.userId || getUserId()
    const res = await runApi('fetchPoints', () =>
      supabase.from('points').select('*').eq('user_id', userId).order('id', { ascending: true }).limit(1)
    )
    if (!res.ok) return res
    const row = Array.isArray(res.data) ? res.data[0] : res.data
    if (!row) {
      const noRow = normalizeApiError({ code: 'no_row', message: 'points row not found' })
      logApiFailed('fetchPoints', noRow)
      return { ok: false, data: null, error: noRow }
    }
    state.pointsRowId = row.id ?? null
    const point = Number(row.point ?? 0)
    state.points = Number.isFinite(point) ? Math.max(0, point) : 0
    if (!skipRender) {
      if (isActiveWorkOnWorkScreen()) {
        console.log('[render] skip fetchPoints render during work')
      } else {
        render({ reason: 'fetchPoints' })
      }
    }
    return { ok: true, data: row, error: null }
  }, { skipPatch: true })
}

const savePoints = async () => {
  const userId = state.userId || getUserId()
  const rawPoint = Number(state.points)
  const point = Number.isFinite(rawPoint) ? Math.max(0, rawPoint) : 0
  state.points = point
  const updateResult = await updatePointsRowWithExpire({ point, rowId: state.pointsRowId, userId })
  if (!updateResult.ok) {
    logApiFailed('savePoints', normalizeApiError(updateResult.error))
    return { ok: false, data: null, error: normalizeApiError(updateResult.error) }
  }
  const updateRow = updateResult.row
  if (updateRow) {
    state.pointsRowId = updateRow.id ?? state.pointsRowId
    const saved = Number(updateRow.point ?? point)
    state.points = Number.isFinite(saved) ? Math.max(0, saved) : point
  }
  return { ok: true, data: updateRow, error: null }
}

const ensurePigTicketsRowExists = async () => {
  const userId = state.userId || getUserId()
  console.log('[init] ensurePigTicketsRowExists', { op: 'start', userId, pointsRowId: state.pointsRowId })
  console.log('[pig_tickets] ensure start', userId)
  try {
    const { data: rows, error: selectError } = await supabase
      .from('pig_tickets')
      .select('user_id, ticket_count')
      .eq('user_id', userId)
      .limit(1)
    const row = rows?.[0] ?? null
    if (selectError) {
      console.error('[pig_tickets] failed', selectError)
      console.error('[init] ensurePigTicketsRowExists', {
        op: 'fail',
        step: 'select',
        message: selectError.message,
        code: selectError.code,
        details: selectError,
        userId,
        pointsRowId: state.pointsRowId,
      })
      return
    }
    if (row) {
      console.log('[pig_tickets] ensure exists', row)
      console.log('[init] ensurePigTicketsRowExists', {
        op: 'success',
        step: 'row_exists',
        userId,
        pointsRowId: state.pointsRowId,
      })
      return
    }
    const { error: insertError } = await supabase
      .from('pig_tickets')
      .insert({ user_id: userId, ticket_count: 0 })
    if (insertError) {
      console.error('[pig_tickets] failed', insertError)
      console.error('[init] ensurePigTicketsRowExists', {
        op: 'fail',
        step: 'insert',
        message: insertError.message,
        code: insertError.code,
        details: insertError,
        userId,
        pointsRowId: state.pointsRowId,
      })
      return
    }
    console.log('[pig_tickets] ensure insert success', userId)
    console.log('[init] ensurePigTicketsRowExists', {
      op: 'success',
      step: 'insert',
      userId,
      pointsRowId: state.pointsRowId,
    })
  } catch (e) {
    console.error('[pig_tickets] failed', e)
    console.error('[init] ensurePigTicketsRowExists', {
      op: 'fail',
      step: 'exception',
      message: e?.message,
      details: e,
      userId,
      pointsRowId: state.pointsRowId,
    })
  }
}

const fetchPigTickets = async (options = {}) => {
  const { skipRender = false } = options
  if (isLoading('fetchPigTickets')) {
    console.log('[api] skipped fetchPigTickets already loading')
    return { ok: false, data: null, error: normalizeApiError({ code: 'already_loading' }), skipped: true }
  }
  return withLoading('fetchPigTickets', async () => {
    const userId = state.userId || getUserId()
    const res = await runApi('fetchPigTickets', () =>
      supabase.from('pig_tickets').select('user_id, ticket_count').eq('user_id', userId).limit(1)
    )
    if (!res.ok) return res
    const row = Array.isArray(res.data) ? res.data[0] : res.data
    if (!row) {
      const noRow = normalizeApiError({ code: 'no_row', message: 'pig_tickets row not found' })
      logApiFailed('fetchPigTickets', noRow)
      return { ok: false, data: null, error: noRow }
    }
    const tickets = Number(row.ticket_count ?? 0)
    state.pigTickets = Number.isFinite(tickets) ? Math.max(0, tickets) : 0
    if (!skipRender) {
      render()
    }
    return { ok: true, data: row, error: null }
  }, { skipPatch: true })
}

const savePigTickets = async () => {
  const userId = state.userId || getUserId()
  const count = Math.max(0, Number(state.pigTickets) || 0)
  state.pigTickets = Number.isFinite(count) ? count : 0
  const res = await runApi('savePigTickets', () =>
    supabase
      .from('pig_tickets')
      .update({
        ticket_count: state.pigTickets,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .select('user_id, ticket_count, updated_at')
      .maybeSingle()
  , { silent: true })
  if (!res.ok) logApiFailed('savePigTickets', res.error)
  return res
}

const savePigTicketLog = async (amount, logType, note = '') => {
  const userId = state.userId || getUserId()
  if (!PIG_TICKET_LOG_TYPES.has(logType)) {
    console.warn('[api] savePigTicketLog unknown log_type', logType)
  }
  return runApi(
    'savePigTicketLog',
    () =>
      supabase
        .from('pig_ticket_logs')
        .insert({
          user_id: userId,
          amount,
          log_type: logType,
          note: note ?? '',
        })
        .select('id')
        .maybeSingle(),
    { silent: true }
  )
}

const addPigTickets = async (amount, logType = 'manual_adjust', note = '', options = {}) => {
  const { skipRender = false } = options
  const addAmount = Number(amount)
  if (!Number.isFinite(addAmount) || addAmount <= 0) return
  state.pigTickets += addAmount
  if (!skipRender) {
    if (isActiveWorkOnWorkScreen()) console.log('[render] skip addPigTickets render during work')
    else render({ reason: 'addPigTickets' })
  }
  await savePigTickets()
  await savePigTicketLog(addAmount, logType, note)
}

const usePigTickets = async (amount, logType = 'manual_adjust', note = '', options = {}) => {
  const { skipRender = false } = options
  const useAmount = Number(amount)
  if (!Number.isFinite(useAmount) || useAmount <= 0) return false
  if (state.pigTickets < useAmount) return false
  state.pigTickets -= useAmount
  if (!skipRender) {
    if (isActiveWorkOnWorkScreen()) console.log('[render] skip usePigTickets render during work')
    else render({ reason: 'usePigTickets' })
  }
  else if (state.screen === 'garapon') patchGaraponScreen()
  await savePigTickets()
  await savePigTicketLog(-useAmount, logType, note)
  return true
}

async function saveRewardLog(rewardType, amount, note = '') {
  const userId = state.userId || getUserId()
  return saveRewardLogForUser(userId, rewardType, amount, note)
}

function rewardTypeLabelJa(rewardType) {
  const map = {
    get_15: '15ポイント獲得',
    get_80: '動画視聴（80）',
    mission: 'ミッション',
    roulette: 'ルーレット',
    manual_adjust: '手動・その他',
    cm: 'CM',
    gift: 'プレゼント',
    referral_referred: '友達招待（被紹介）',
    referral_referrer: '友達招待（紹介）',
    gift_code: 'ギフトコード',
    offerwall_1: 'オファーウォール',
    offerwall_2: 'オファーウォール',
    offer_1: 'オファー',
    offer_2: 'オファー',
  }
  return map[rewardType] || rewardType
}

function formatRewardLogAt(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return String(iso)
  }
}

async function openRewardHistory() {
  state.rewardHistoryOpen = true
  state.rewardHistoryLoading = true
  state.rewardHistoryError = null
  state.rewardHistoryItems = null
  render()
  const userId = state.userId || getUserId()
  const res = await runApi('fetchRewardLogs', () =>
    supabase
      .from('reward_logs')
      .select('id, reward_type, amount, note, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200)
  )
  if (!res.ok) {
    state.rewardHistoryError = getApiUserMessage(res.error, 'rewardHistory')
    state.rewardHistoryItems = []
  } else {
    state.rewardHistoryItems = Array.isArray(res.data) ? res.data : []
  }
  state.rewardHistoryLoading = false
  render()
}

const addPoints = async (amount, rewardType = 'manual_adjust', note = '', options = {}) => {
  const { skipRender = false } = options
  const userId = state.userId || getUserId()
  console.log('[points] addPoints', { userId, pointsRowId: state.pointsRowId, amount, rewardType, op: 'start' })
  state.points += amount
  if (!skipRender) {
    if (isActiveWorkOnWorkScreen()) console.log('[render] skip addPoints render during work')
    else render({ reason: 'addPoints' })
  }
  await savePoints()
  await saveRewardLog(rewardType, amount, note)
}

// --- 初回起動（非同期 IIFE）: Layer 0 完了後にホーム初回 render、以降は background boot ---
syncScreenChromeBg(state.screen)
;(async () => {
  try {
    localStorage.removeItem(STORAGE_KEYS.points)
  } catch {}
  try {
    localStorage.removeItem(STORAGE_KEYS.pigTickets)
  } catch {}

  console.log('[boot] layer0 start', { totalMs: bootMsSinceStart() })
  const layer0Started = performance.now()

  await runBootTask('ensureUserExists', () => ensureUserExists())
  await Promise.all([
    runBootTask('points', async () => {
      await ensurePointsRowExists()
      await fetchPoints({ skipRender: true })
    }),
    runBootTask('pigTickets', async () => {
      await ensurePigTicketsRowExists()
      await fetchPigTickets({ skipRender: true })
    }),
    runBootTask('selectedIcon', () => loadSelectedIconIntoState(state.userId)),
  ])
  await runBootTask('workSessionRestore', async () => restoreWorkSessionIfNeeded())

  console.log('[boot] layer0 end', {
    ms: Math.round(performance.now() - layer0Started),
    totalMs: bootMsSinceStart(),
  })

  render({ forceFull: true, reason: 'boot-layer0' })
  console.log('[boot] first render', {
    ms: bootMsSinceStart(),
    screen: state.screen,
    points: state.points,
    pigTickets: state.pigTickets,
  })

  maybeStartOnboardingAfterBoot()

  void runBootLayer1()
})().catch((e) =>
  console.error('[boot] failed', {
    step: 'unhandled_rejection',
    message: e?.message,
    details: e,
    userId: state.userId,
    pointsRowId: state.pointsRowId,
    totalMs: bootMsSinceStart(),
  })
)

// --- 背景検知（一度だけ登録） ---
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    console.log('[visibility] hidden', { screen: state.screen, isWorking: state.isWorking })
    doAutoPause()
  } else {
    console.log('[visibility] visible', { screen: state.screen, isWorking: state.isWorking })
  }
})
window.addEventListener('blur', () => {
  console.log('[blur]', { screen: state.screen, isWorking: state.isWorking })
  doAutoPause()
})

// --- リサイズ時にスケール再計算 ---
window.addEventListener('resize', () => {
  if (isActiveWorkOnWorkScreen() && document.querySelector('[data-work-root]')) {
    handleWorkViewportChange('resize')
    return
  }
  if (state.screen === 'home' && document.querySelector('.home-container')) {
    applyHomeScale()
    applyMissionPanelScale()
  }
  if (state.screen === 'game' && document.querySelector('.game-container')) {
    applyGameScale()
  }
  if (state.screen === 'garapon' && document.querySelector('.garapon-container')) {
    applyGaraponScale()
  }
})

window.addEventListener('orientationchange', () => {
  handleWorkViewportChange('orientation')
})

if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', () => {
    if (state.isWorking) {
      console.warn('[hmr] module update during work — avoid saving files; session may reset on full reload')
    }
  })
}

if (import.meta.env?.DEV) {
  window.debugWorkCameraOrientation = () => {
    syncWorkCameraVideoDisplay('manual-debug')
  }
  window.grantIconToUser = grantIconToUser
}

