// 調整用の値はすべてここに集める。
// ゲームの判定・操作感・演出時間・描画負荷を変えるときは、このファイルだけを編集すればよい。

export const CONFIG = {
  judge: {
    /** 成功とみなす誤差（%）。誤差 = |片側の体積 / 全体 × 100 − 50| */
    thresholdPercent: 1.0,
    /** 体積比を表示する小数点以下の桁数。判定もこの桁に丸めた値で行う（表示と判定を一致させる） */
    displayDecimals: 1,
  },

  input: {
    /** 回転パッドの感度（CSS px あたりのラジアン） */
    rotateSensitivity: 0.0105,
    /** キーボード（矢印キー）1回あたりの回転量（ラジアン） */
    keyRotateStep: 0.06,
    /** 姿勢リセットにかける時間（秒） */
    resetDuration: 0.35,
    /** 切断に必要なスワイプの最小長さ（CSS px） */
    minSwipePx: 40,
    /** 切断に必要なスワイプの最小長さ（表示領域の短辺に対する割合）。大きい方を採用 */
    minSwipeFraction: 0.14,
    /** 野菜のシルエット判定に使うグリッドの細かさ（長辺方向のマス数） */
    silhouetteGrid: 160,
  },

  timing: {
    /** 切断確定直後のヒットストップ（秒） */
    hitStop: 0.075,
    /** 直線の斬撃が光る時間（秒） */
    slashFlash: 0.3,
    /** かけらが離れる時間（秒） */
    separate: 0.75,
    /** 断面が強く光り続ける時間（秒） */
    glowHold: 0.28,
    /** 断面の発光が落ち着くまでの時間（秒） */
    glowDecay: 0.85,
    /** 切断から結果表示までの時間（秒）。この時点で発光はほぼ消えている */
    resultDelay: 1.3,
    /** 結果表示から「次へ」「もう一度」ボタンを押せるようになるまで（秒） */
    buttonDelay: 0.7,
    /** 次の野菜の登場アニメーション（秒） */
    appear: 0.55,
  },

  fx: {
    /** 2つのかけらの間に必ず空けるすき間（野菜の半径に対する割合）。奥でつながって見えないようにする */
    separateGap: 0.24,
    /** 断面を見せるためにかけらを傾ける角度（ラジアン） */
    openAngle: 0.62,
    /** 切断後にカメラを引く倍率 */
    cameraPullBack: 1.32,
    /** 断面の発光の最大強度（HDR） */
    capGlowPeak: 2.6,
    /** 切断時に断面からあふれる光の粒の数 */
    capParticles: 170,
    /** 成功時の祝福の粒の数 */
    celebrateParticles: 240,
    /** パーティクルの上限（スマホ負荷対策） */
    maxParticles: 1800,
    /** 刃の軌跡が残る時間（秒） */
    trailLife: 0.22,
    bloomStrength: 0.9,
    bloomRadius: 0,
    /** ブルームの各ぼかし段（細かい→粗い）の重み。粗い段を強くすると画面全体が霞む */
    bloomFactors: [1.0, 0.8, 0.45, 0.16, 0.05],
    bloomThreshold: 2.2,
  },

  render: {
    /** devicePixelRatio の上限 */
    maxPixelRatio: 2,
    /** 平均フレーム時間がこれを超えたら解像度を下げる（ミリ秒） */
    slowFrameMs: 24,
    /** 断面テクスチャの長辺ピクセル数 */
    capTextureSize: 384,
    /** タッチ端末（スマホ）での断面テクスチャの長辺。生成時間はピクセル数に比例する */
    capTextureSizeTouch: 256,
    /** カメラの縦画角（度） */
    fov: 30,
    /** 野菜の外接球に対する画面の余白倍率 */
    fitMargin: 1.38,
  },

  audio: {
    masterVolume: 0.55,
  },
};

export type Config = typeof CONFIG;
