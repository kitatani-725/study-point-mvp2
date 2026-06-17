import * as tf from '@tensorflow/tfjs'

/** Teachable Machine での「道具あり」クラス名 */
const COLLECT_LABEL = 'コレクト'
/** この確率以上なら ok: true */
const CONFIDENCE_MIN = 0.85

let loadPromise = null

function modelRootUrl() {
  const base = import.meta.env.BASE_URL || '/'
  const normalized = base.endsWith('/') ? base : `${base}/`
  return `${normalized}ai/work-tool-model`
}

async function ensureModelAndMeta() {
  if (!loadPromise) {
    loadPromise = (async () => {
      await tf.ready()
      const root = modelRootUrl()
      const modelUrl = `${root}/model.json`
      const metaUrl = `${root}/metadata.json`
      const [model, meta] = await Promise.all([
        tf.loadLayersModel(modelUrl),
        fetch(metaUrl).then((r) => {
          if (!r.ok) throw new Error(`metadata.json HTTP ${r.status}`)
          return r.json()
        }),
      ])
      return { model, meta }
    })()
  }
  return loadPromise
}

/**
 * 作業道具の有無を Teachable Machine 画像分類モデルで判定。
 * 「コレクト」の softmax 確率が CONFIDENCE_MIN 以上なら ok: true。
 */
export async function checkWorkToolPresence(imageBlob) {
  if (!imageBlob || imageBlob.size === 0) {
    return { ok: false, detectedTools: [], reason: '画像なし' }
  }
  try {
    const { model, meta } = await ensureModelAndMeta()
    const labels = meta.labels || []
    const imageSize = Number(meta.imageSize) || 224
    const collectIdx = labels.indexOf(COLLECT_LABEL)
    if (collectIdx < 0) {
      console.warn('[toolCheck] メタデータにラベルがありません', COLLECT_LABEL, labels)
      return { ok: false, detectedTools: [], reason: 'ラベル設定エラー' }
    }

    let bitmap
    try {
      bitmap = await createImageBitmap(imageBlob)
    } catch (e) {
      console.log('[toolCheck] error', e?.message || String(e))
      return { ok: false, detectedTools: [], reason: '画像デコード失敗' }
    }

    let predTensor
    try {
      predTensor = tf.tidy(() => {
        const x = tf.browser
          .fromPixels(bitmap)
          .resizeNearestNeighbor([imageSize, imageSize])
          .expandDims(0)
          .toFloat()
          .div(127.5)
          .sub(1)
        return model.predict(x)
      })
    } finally {
      bitmap.close()
    }

    const scores = await predTensor.data()
    predTensor.dispose()

    const pCollect = scores[collectIdx]
    const ok = pCollect >= CONFIDENCE_MIN

    return {
      ok,
      detectedTools: ok ? [COLLECT_LABEL] : [],
      confidence: pCollect,
      reason: ok ? undefined : `コレクト ${(pCollect * 100).toFixed(1)}% < ${CONFIDENCE_MIN * 100}%`,
    }
  } catch (e) {
    console.log('[toolCheck] error', e?.message || String(e))
    return { ok: false, detectedTools: [], reason: e?.message || '推論エラー' }
  }
}

/** モデルと突き合わせるラベル（TM の「コレクト」含む） */
export const WORK_TOOL_CATEGORIES = ['本', 'ペン', '紙', 'パソコン', 'キーボード', COLLECT_LABEL]

export function hasAnyAllowedWorkTool(detectedTools) {
  if (!Array.isArray(detectedTools) || detectedTools.length === 0) return false
  const allow = new Set(WORK_TOOL_CATEGORIES)
  return detectedTools.some((t) => allow.has(String(t).trim()))
}
