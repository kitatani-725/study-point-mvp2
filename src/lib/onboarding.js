/** 初回起動オンボーディング（300.svg〜304.svg） */

export const ONBOARDING_STORAGE_KEY = 'sp_onboarding_complete'

export const ONBOARDING_SLIDE_IDS = ['300', '301', '302', '303', '304']

export const ONBOARDING_LAST_INDEX = ONBOARDING_SLIDE_IDS.length - 1

export function isOnboardingComplete() {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function markOnboardingComplete() {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true')
  } catch {}
}

export function shouldShowOnboarding() {
  return !isOnboardingComplete()
}

/** オンボーディング追加前から利用している既存ユーザー向け移行 */
export function migrateOnboardingForLegacyUser({ username, defaultUsername, registrationComplete }) {
  if (isOnboardingComplete()) return
  const hasCustomName =
    typeof username === 'string' &&
    username.trim() !== '' &&
    username !== defaultUsername
  if (registrationComplete && hasCustomName) {
    markOnboardingComplete()
  }
}

export function getOnboardingSlidePath(slideId) {
  return `/assets/${slideId}.svg`
}

export function buildOnboardingOverlayHtml(stepIndex, { usernameMaxLen, defaultUsername }) {
  const slideId = ONBOARDING_SLIDE_IDS[stepIndex] ?? ONBOARDING_SLIDE_IDS[0]
  const isNicknameSlide = stepIndex === ONBOARDING_LAST_INDEX
  const nextLabel = stepIndex >= 3 ? 'はじめる' : '次へ'

  return `
<div class="onboarding-overlay${isNicknameSlide ? ' onboarding-overlay--nickname' : ''}" data-onboarding-overlay>
  <div class="onboarding-stage">
    <img
      class="onboarding-slide-img"
      src="${getOnboardingSlidePath(slideId)}"
      alt=""
      width="405"
      height="720"
      draggable="false"
    />
    <button
      type="button"
      class="onboarding-hit onboarding-hit-skip"
      data-onboarding-skip
      aria-label="スキップ"
    ></button>
    <button
      type="button"
      class="onboarding-hit onboarding-hit-next"
      data-onboarding-next
      aria-label="${nextLabel}"
    ></button>
    <div class="onboarding-nickname-wrap" data-onboarding-nickname-wrap>
      <input
        type="text"
        class="onboarding-nickname-input"
        data-onboarding-nickname-input
        maxlength="${usernameMaxLen}"
        autocomplete="username"
        placeholder="${defaultUsername}"
        aria-label="ニックネーム"
      />
    </div>
  </div>
</div>`
}

let onboardingDelegationBound = false

export function bindOnboardingDelegation({ onNext, onSkip }) {
  if (onboardingDelegationBound) return
  onboardingDelegationBound = true

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-onboarding-next]')) {
      e.preventDefault()
      onNext()
      return
    }
    if (e.target.closest('[data-onboarding-skip]')) {
      e.preventDefault()
      onSkip()
    }
  })
}
