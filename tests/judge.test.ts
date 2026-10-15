import { describe, expect, it } from 'vitest';
import { judgeVolumes } from '../src/judge';

const cfg = { thresholdPercent: 1.0, displayDecimals: 1 };
const j = (pct: number) => judgeVolumes(pct, 100, cfg);

describe('成功判定（しきい値 1%）', () => {
  it('仕様の例', () => {
    expect(j(50).success).toBe(true);
    expect(j(49).success).toBe(true);
    expect(j(51).success).toBe(true);
    expect(j(48.9).success).toBe(false);
    expect(j(51.1).success).toBe(false);
  });

  it('表示は常に合計 100、誤差は表示値から計算される', () => {
    for (let p = 0; p <= 100; p += 0.0137) {
      const r = j(p);
      expect(r.percentA + r.percentB).toBeCloseTo(100, 9);
      expect(r.errorPercent).toBeCloseTo(Math.abs(r.percentA - 50), 9);
    }
  });

  it('表示上の値で判定が決まる（表示では成功範囲なのに失敗、が起きない）', () => {
    for (let p = 47; p <= 53; p += 0.00071) {
      const r = j(p);
      const shown = Number(r.displayA);
      const shownSuccess = Math.abs(shown - 50) <= 1.0 + 1e-9;
      expect(r.success).toBe(shownSuccess);
      // B 側から見ても同じ
      expect(Math.abs(Number(r.displayB) - 50) <= 1.0 + 1e-9).toBe(r.success);
    }
  });

  it('境界付近：48.95 は表示 49.0 で成功、48.94 は表示 48.9 で失敗', () => {
    expect(j(48.95).displayA).toBe('49.0');
    expect(j(48.95).success).toBe(true);
    expect(j(48.94).displayA).toBe('48.9');
    expect(j(48.94).success).toBe(false);
  });

  it('しきい値は設定で変えられる', () => {
    expect(judgeVolumes(48, 100, { thresholdPercent: 2, displayDecimals: 1 }).success).toBe(true);
    expect(judgeVolumes(49.5, 100, { thresholdPercent: 0.5, displayDecimals: 1 }).success).toBe(true);
    expect(judgeVolumes(49.4, 100, { thresholdPercent: 0.5, displayDecimals: 1 }).success).toBe(false);
    expect(judgeVolumes(49.06, 100, { thresholdPercent: 1, displayDecimals: 2 }).success).toBe(true);
    expect(judgeVolumes(48.99, 100, { thresholdPercent: 1, displayDecimals: 2 }).success).toBe(false);
  });
});
