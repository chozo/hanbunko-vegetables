// 野菜の 3D オブジェクト。切断前の表示、シルエット判定、実際の切断、かけらの動きを受け持つ。
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Plane,
  Quaternion,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import { CONFIG } from '../config';
import { cutMesh, type CapData, type CutResult, type PlaneDef } from '../geometry/cut';
import { signedVolume, type MeshData } from '../geometry/mesh';
import type { VegDef, VegModel } from '../vegetables/common';
import { makeCapMaterial, makeCapTexture, makeExtrasMaterial, makeSkinMaterial } from '../render/materials';
import type { View } from '../render/view';

export function meshToGeometry(m: MeshData | CapData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new BufferAttribute(m.normals, 3));
  if ('colors' in m) g.setAttribute('color', new BufferAttribute(m.colors, 3));
  if ('uvs' in m) g.setAttribute('uv', new BufferAttribute(m.uvs, 2));
  g.setIndex(new BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

/** ステージごとに一度だけ作る形状と材質（再挑戦では使い回す） */
export class VegAssets {
  readonly model: VegModel;
  readonly bodyGeo: BufferGeometry;
  readonly extrasGeo: BufferGeometry | null;
  readonly skinMat: Material;
  readonly extrasMat: Material;
  readonly totalVolume: number;
  /** 本体の中心（回転の中心） */
  readonly center: Vector3;
  /** 外接球の半径（本体と枝を含む） */
  readonly radius: number;
  /** 表示の倍率（半径で割って、野菜ごとの表示倍率をかけたもの） */
  readonly scale: number;

  constructor(readonly def: VegDef) {
    this.model = def.build();
    this.bodyGeo = meshToGeometry(this.model.body);
    this.extrasGeo = this.model.extras ? meshToGeometry(this.model.extras) : null;
    this.skinMat = makeSkinMaterial(def);
    this.extrasMat = makeExtrasMaterial(def);
    this.totalVolume = signedVolume(this.model.body);
    this.bodyGeo.computeBoundingBox();
    this.center = this.bodyGeo.boundingBox!.getCenter(new Vector3());
    let r = 0;
    const scan = (p: Float32Array) => {
      for (let i = 0; i < p.length; i += 3) r = Math.max(r, Math.hypot(p[i] - this.center.x, p[i + 1] - this.center.y, p[i + 2] - this.center.z));
    };
    scan(this.model.body.positions);
    if (this.model.extras) scan(this.model.extras.positions);
    this.radius = r;
    this.scale = (def.displayScale ?? 1) / r;
  }
}

export interface Piece {
  group: Group;
  /** 切断平面のどちら側か（+1: 法線側） */
  side: 1 | -1;
  volume: number;
  /** かけらの重心付近（ローカル座標） */
  centroidLocal: Vector3;
  capGeo: BufferGeometry;
}

export interface CutOutcome {
  result: CutResult;
  pieces: [Piece, Piece];
  /** 法線側の体積 */
  volumePos: number;
  volumeNeg: number;
  totalVolume: number;
  worldPlane: Plane;
  localPlane: PlaneDef;
  capMaterial: MeshStandardMaterial;
  capTexture: Texture;
  /** 切断時点のローカル→ワールド行列 */
  baseMatrix: Matrix4;
  capCenterWorld: Vector3;
  /** かけらの開き方（最初の配置時に一度だけ計算） */
  layout?: PieceLayout;
}

interface PieceLayout {
  axis: Vector3;
  pivot: Vector3;
  /** それぞれのかけらを平面から押し離す距離 */
  push: [number, number];
}

export class VegObject {
  readonly root = new Group();
  private readonly inner = new Group();
  readonly body: Mesh;
  readonly extras: Mesh | null;
  readonly initialQuat: Quaternion;
  outcome: CutOutcome | null = null;
  private disposables: { dispose(): void }[] = [];

  constructor(readonly assets: VegAssets) {
    const def = assets.def;
    this.body = new Mesh(assets.bodyGeo, assets.skinMat);
    this.extras = assets.extrasGeo ? new Mesh(assets.extrasGeo, assets.extrasMat) : null;
    this.inner.add(this.body);
    if (this.extras) this.inner.add(this.extras);
    this.inner.position.copy(assets.center).multiplyScalar(-1);
    this.root.add(this.inner);
    this.root.scale.setScalar(assets.scale);
    const [rx, ry, rz] = def.initialRotation;
    this.initialQuat = new Quaternion().setFromEuler(new Euler(rx, ry, rz));
    this.root.quaternion.copy(this.initialQuat);
  }

  /** ワールド空間の軸まわりに回す（回転パッド） */
  rotateWorld(axis: Vector3, angle: number): void {
    this.root.quaternion.premultiply(new Quaternion().setFromAxisAngle(axis, angle)).normalize();
  }

  /**
   * 画面上の野菜本体のシルエットをマス目に塗る。
   * スワイプが野菜の外から始まり外で終わるか、途中で野菜を横切るかの判定に使う。
   */
  silhouette(view: View): { grid: Uint8Array; gw: number; gh: number; cell: number } {
    const cell = Math.max(view.width, view.height) / CONFIG.input.silhouetteGrid;
    const gw = Math.ceil(view.width / cell), gh = Math.ceil(view.height / cell);
    const grid = new Uint8Array(gw * gh);
    this.root.updateMatrixWorld(true);
    const m = new Matrix4().multiplyMatrices(view.camera.projectionMatrix, view.camera.matrixWorldInverse).multiply(this.body.matrixWorld);
    const p = this.assets.model.body.positions;
    const nv = p.length / 3;
    const sx = new Float32Array(nv), sy = new Float32Array(nv);
    const e = m.elements;
    for (let i = 0; i < nv; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      const w = e[3] * x + e[7] * y + e[11] * z + e[15];
      sx[i] = (((e[0] * x + e[4] * y + e[8] * z + e[12]) / w + 1) / 2) * view.width / cell;
      sy[i] = ((1 - (e[1] * x + e[5] * y + e[9] * z + e[13]) / w) / 2) * view.height / cell;
    }
    const ix = this.assets.model.body.indices;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t], b = ix[t + 1], c = ix[t + 2];
      const x0 = Math.max(0, Math.floor(Math.min(sx[a], sx[b], sx[c])));
      const x1 = Math.min(gw - 1, Math.floor(Math.max(sx[a], sx[b], sx[c])));
      const y0 = Math.max(0, Math.floor(Math.min(sy[a], sy[b], sy[c])));
      const y1 = Math.min(gh - 1, Math.floor(Math.max(sy[a], sy[b], sy[c])));
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) grid[yy * gw + xx] = 1;
    }
    return { grid, gw, gh, cell };
  }

  /** 切らずに、平面の法線側にある体積の割合（%）だけを求める */
  previewPercent(worldPlane: Plane): number {
    this.root.updateMatrixWorld(true);
    const lp = worldPlane.clone().applyMatrix4(this.body.matrixWorld.clone().invert());
    const r = cutMesh(this.assets.model.body, { n: [lp.normal.x, lp.normal.y, lp.normal.z], c: lp.constant }, false);
    return (r.pos.volume / this.assets.totalVolume) * 100;
  }

  /** ワールド空間の平面で実際に切る */
  cut(worldPlane: Plane, view: View): CutOutcome {
    const def = this.assets.def;
    const model = this.assets.model;
    this.root.updateMatrixWorld(true);
    const M0 = this.body.matrixWorld.clone();
    const lp = worldPlane.clone().applyMatrix4(M0.clone().invert());
    const localPlane: PlaneDef = { n: [lp.normal.x, lp.normal.y, lp.normal.z], c: lp.constant };
    const res = cutMesh(model.body, localPlane);
    const resX = model.extras ? cutMesh(model.extras, localPlane) : null;
    const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    const capTexture = makeCapTexture(res, model, touch ? CONFIG.render.capTextureSizeTouch : CONFIG.render.capTextureSize);
    const capMaterial = makeCapMaterial(capTexture, def);
    const extrasCapMat = makeCapMaterial(null, def, new Color().setRGB(...model.extrasCapColor, 'srgb'));
    this.disposables.push(capTexture, capMaterial, extrasCapMat);

    const makePiece = (sideKey: 'pos' | 'neg'): Piece => {
      const side = res[sideKey];
      const group = new Group();
      group.matrixAutoUpdate = false;
      group.matrix.copy(M0);
      const surfGeo = meshToGeometry(side.surface);
      const capGeo = meshToGeometry(side.cap);
      group.add(new Mesh(surfGeo, this.assets.skinMat));
      const capMesh = new Mesh(capGeo, capMaterial);
      group.add(capMesh);
      this.disposables.push(surfGeo, capGeo);
      if (resX) {
        const xs = resX[sideKey];
        if (!xs.empty) {
          const g1 = meshToGeometry(xs.surface), g2 = meshToGeometry(xs.cap);
          group.add(new Mesh(g1, this.assets.extrasMat), new Mesh(g2, extrasCapMat));
          this.disposables.push(g1, g2);
        }
      }
      const c = new Vector3();
      const p = side.surface.positions;
      for (let i = 0; i < p.length; i += 3) c.add(new Vector3(p[i], p[i + 1], p[i + 2]));
      if (p.length) c.divideScalar(p.length / 3);
      return { group, side: sideKey === 'pos' ? 1 : -1, volume: side.volume, centroidLocal: c, capGeo };
    };
    const pieces: [Piece, Piece] = [makePiece('pos'), makePiece('neg')];

    // 断面の中心（ワールド）
    const cc = new Vector3();
    const cp = res.pos.cap.positions;
    for (let i = 0; i < cp.length; i += 3) cc.add(new Vector3(cp[i], cp[i + 1], cp[i + 2]));
    if (cp.length) cc.divideScalar(cp.length / 3);
    else cc.set(...res.origin);
    cc.applyMatrix4(M0);

    this.root.visible = false;
    void view;
    this.outcome = {
      result: res,
      pieces,
      volumePos: res.pos.volume,
      volumeNeg: res.neg.volume,
      totalVolume: this.assets.totalVolume,
      worldPlane: worldPlane.clone(),
      localPlane,
      capMaterial,
      capTexture,
      baseMatrix: M0,
      capCenterWorld: cc,
    };
    return this.outcome;
  }

  /**
   * かけらを離して断面を見せる。progress は 0..1。
   * 断面がカメラへ向くように傾けるとき、回転の軸を「断面のいちばん奥の点」に置く（本を奥側を綴じ目にして開く形）。
   * さらに、傾けたあとのかけらが切断平面をまたがないよう実際の頂点で測り、すき間が必ず空くだけ押し離す。
   * これで奥でつながって見えることがなく、2つのかけらは完全に分かれる。
   */
  layoutPieces(progress: number, cameraPos: Vector3): void {
    const o = this.outcome;
    if (!o) return;
    const L = (o.layout ??= this.computeLayout(o, cameraPos));
    const n = o.worldPlane.normal;
    o.pieces.forEach((pc, i) => {
      const d = L.push[i] * progress;
      const t = new Matrix4().makeTranslation(n.x * pc.side * d, n.y * pc.side * d, n.z * pc.side * d);
      pc.group.matrix.copy(t).multiply(this.hinge(L, pc.side, progress)).multiply(o.baseMatrix);
      pc.group.matrixWorldNeedsUpdate = true;
    });
  }

  private hinge(L: PieceLayout, side: number, progress: number): Matrix4 {
    const p = L.pivot;
    return new Matrix4()
      .makeTranslation(p.x, p.y, p.z)
      .multiply(new Matrix4().makeRotationAxis(L.axis, side * CONFIG.fx.openAngle * progress))
      .multiply(new Matrix4().makeTranslation(-p.x, -p.y, -p.z));
  }

  private computeLayout(o: CutOutcome, cameraPos: Vector3): PieceLayout {
    const n = o.worldPlane.normal;
    const vdir = o.capCenterWorld.clone().sub(cameraPos).normalize();
    const axis = new Vector3().crossVectors(n, vdir);
    if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0);
    axis.normalize();
    // 断面のいちばん奥（カメラから遠い）の点を綴じ目にする
    const pivot = o.capCenterWorld.clone();
    let far = -Infinity;
    const cp = o.result.pos.cap.positions;
    const v = new Vector3();
    for (let i = 0; i < cp.length; i += 3) {
      v.set(cp[i], cp[i + 1], cp[i + 2]).applyMatrix4(o.baseMatrix);
      const dd = v.dot(vdir);
      if (dd > far) {
        far = dd;
        pivot.copy(v);
      }
    }
    const L: PieceLayout = { axis, pivot, push: [0, 0] };
    // 傾けきった状態で、かけら（枝やヘタも含む）が平面の反対側へどれだけはみ出すかを測る
    const half = CONFIG.fx.separateGap / 2;
    o.pieces.forEach((pc, i) => {
      const m = this.hinge(L, pc.side, 1).multiply(o.baseMatrix);
      let minDist = Infinity;
      pc.group.traverse((obj) => {
        const g = (obj as Mesh).geometry as BufferGeometry | undefined;
        if (!g) return;
        const pos = g.getAttribute('position');
        for (let k = 0; k < pos.count; k++) {
          v.fromBufferAttribute(pos, k).applyMatrix4(m);
          minDist = Math.min(minDist, pc.side * o.worldPlane.distanceToPoint(v));
        }
      });
      L.push[i] = Math.max(0, half - (Number.isFinite(minDist) ? minDist : 0));
    });
    return L;
  }

  /** 今の配置での、かけら同士の最小すき間（各かけらの頂点と切断平面の距離の和の最小値。正なら完全に分かれている） */
  separation(): number {
    const o = this.outcome;
    if (!o) return NaN;
    const v = new Vector3();
    const mins = o.pieces.map((pc) => {
      let m = Infinity;
      pc.group.traverse((obj) => {
        const g = (obj as Mesh).geometry as BufferGeometry | undefined;
        if (!g) return;
        const pos = g.getAttribute('position');
        for (let k = 0; k < pos.count; k++) {
          v.fromBufferAttribute(pos, k).applyMatrix4(pc.group.matrix);
          m = Math.min(m, pc.side * o.worldPlane.distanceToPoint(v));
        }
      });
      return m;
    });
    return mins[0] + mins[1];
  }

  pieceWorldCenter(pc: Piece): Vector3 {
    return pc.centroidLocal.clone().applyMatrix4(pc.group.matrix);
  }

  /** 断面上のランダムな点（ワールド）と外向き法線 */
  sampleCap(pc: Piece, rnd: () => number): { p: Vector3; n: Vector3 } | null {
    const g = pc.capGeo;
    const idx = g.index;
    if (!idx || idx.count < 3) return null;
    const tri = Math.floor(rnd() * (idx.count / 3)) * 3;
    const pos = g.getAttribute('position');
    const a = new Vector3().fromBufferAttribute(pos, idx.getX(tri));
    const b = new Vector3().fromBufferAttribute(pos, idx.getX(tri + 1));
    const c = new Vector3().fromBufferAttribute(pos, idx.getX(tri + 2));
    let u = rnd(), v = rnd();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const ab = b.sub(a), ac = c.sub(a);
    const p = a.clone().addScaledVector(ab, u).addScaledVector(ac, v);
    const nrm = new Vector3().fromBufferAttribute(g.getAttribute('normal'), idx.getX(tri));
    p.applyMatrix4(pc.group.matrix);
    nrm.transformDirection(pc.group.matrix);
    return { p, n: nrm };
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}
