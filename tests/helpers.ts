import { cutMesh } from '../src/geometry/cut';
import { signedVolume } from '../src/geometry/mesh';

/** 断面を含めた閉じたかけらの体積（原点基準）。断面の三角形分割が正しいことの確認に使う */
export function closedVolume(side: ReturnType<typeof cutMesh>['pos']): number {
  return signedVolume(side.surface) + signedVolume(side.cap);
}
