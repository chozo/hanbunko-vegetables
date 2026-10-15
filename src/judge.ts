import { CONFIG } from './config';

export interface Judgement {
  /** 丸める前の片側の割合（%） */
  rawPercentA: number;
  /** 表示用に丸めた割合（%）。A + B は必ず 100 になる */
  percentA: number;
  percentB: number;
  displayA: string;
  displayB: string;
  /** 丸めた値から求めた誤差（%） */
  errorPercent: number;
  errorDisplay: string;
  success: boolean;
}

/**
 * 体積比を判定する。
 * 表示と判定の食い違いを防ぐため、割合を表示桁の整数単位に丸めてから、その整数で誤差としきい値を比べる。
 * B 側は 100 から A 側を引いて求めるので、表示の合計は常に 100 になる。
 */
export function judgeVolumes(
  volumeA: number,
  totalVolume: number,
  cfg: { thresholdPercent: number; displayDecimals: number } = CONFIG.judge,
): Judgement {
  const raw = totalVolume > 0 ? (volumeA / totalVolume) * 100 : 0;
  const f = 10 ** cfg.displayDecimals;
  const unitsA = Math.min(100 * f, Math.max(0, Math.round(raw * f)));
  const unitsB = 100 * f - unitsA;
  const errUnits = Math.abs(unitsA - 50 * f);
  const thrUnits = Math.round(cfg.thresholdPercent * f);
  return {
    rawPercentA: raw,
    percentA: unitsA / f,
    percentB: unitsB / f,
    displayA: (unitsA / f).toFixed(cfg.displayDecimals),
    displayB: (unitsB / f).toFixed(cfg.displayDecimals),
    errorPercent: errUnits / f,
    errorDisplay: (errUnits / f).toFixed(cfg.displayDecimals),
    success: errUnits <= thrUnits,
  };
}
