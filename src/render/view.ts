// 描画の土台：レンダラー、カメラ、ライト、ブルーム、画面サイズへの追従
import {
  ACESFilmicToneMapping,
  CanvasTexture,
  DirectionalLight,
  HalfFloatType,
  HemisphereLight,
  PerspectiveCamera,
  PMREMGenerator,
  PointLight,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CONFIG } from '../config';

export class View {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly flashLight: PointLight;
  width = 1;
  height = 1;
  private dpr = 1;
  private maxDpr: number;
  /** 野菜（外接球の半径 1）がちょうど収まるカメラ距離 */
  baseDistance = 6;
  distanceScale = 1;
  private frameTimes: number[] = [];

  constructor(readonly canvas: HTMLCanvasElement, readonly host: HTMLElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.maxDpr = Math.min(window.devicePixelRatio || 1, CONFIG.render.maxPixelRatio);
    this.dpr = this.maxDpr;

    this.camera = new PerspectiveCamera(CONFIG.render.fov, 1, 0.1, 100);
    this.scene.background = makeBackground();

    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.scene.add(new HemisphereLight(0xdfe8ff, 0x302040, 0.9));
    const key = new DirectionalLight(0xfff4e6, 2.6);
    key.position.set(2.5, 4, 5);
    this.scene.add(key);
    const rim = new DirectionalLight(0x9fb8ff, 1.6);
    rim.position.set(-4, 2, -3);
    this.scene.add(rim);
    const fill = new DirectionalLight(0xffd6f0, 0.6);
    fill.position.set(-3, -2, 4);
    this.scene.add(fill);
    this.flashLight = new PointLight(0xffffff, 0, 6, 1.5);
    this.scene.add(this.flashLight);

    const rt = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: this.dpr <= 1.5 ? 4 : 2 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new Vector2(256, 256), CONFIG.fx.bloomStrength, CONFIG.fx.bloomRadius, CONFIG.fx.bloomThreshold);
    // 大きなぼかし段の寄与を抑え、光が画面全体の霞にならないようにする
    this.bloom.compositeMaterial.uniforms.bloomFactors.value = CONFIG.fx.bloomFactors;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  resize(): void {
    const r = this.host.getBoundingClientRect();
    this.width = Math.max(1, Math.round(r.width));
    this.height = Math.max(1, Math.round(r.height));
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(this.dpr);
    this.composer.setSize(this.width, this.height);
    // ブルームは半分の解像度で十分（スマホの負荷対策）
    this.bloom.setSize((this.width * this.dpr) / 2, (this.height * this.dpr) / 2);
    this.camera.aspect = this.width / this.height;
    const vHalf = (CONFIG.render.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    this.baseDistance = CONFIG.render.fitMargin / Math.sin(Math.min(vHalf, hHalf));
    this.updateCamera();
  }

  updateCamera(): void {
    this.camera.position.set(0, 0, this.baseDistance * this.distanceScale);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** パーティクルの大きさを画面の高さに合わせるための係数 */
  get pointScale(): number {
    return (this.height * this.dpr) / (2 * Math.tan((CONFIG.render.fov * Math.PI) / 360));
  }

  render(dtMs: number): void {
    this.composer.render();
    this.adapt(dtMs);
  }

  /** フレームが重いときは解像度を段階的に下げる */
  private adapt(dtMs: number): void {
    if (dtMs <= 0 || dtMs > 200) return;
    this.frameTimes.push(dtMs);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if (avg > CONFIG.render.slowFrameMs && this.dpr > 1) {
      this.dpr = Math.max(1, this.dpr - 0.25);
      this.resize();
    }
  }

  /** CSS px（表示領域の左上基準）を NDC に */
  toNdc(x: number, y: number): Vector2 {
    return new Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
  }

  /** 画面上の点を、z = planeZ の平面上のワールド座標に */
  screenToWorld(x: number, y: number, planeZ = 0): Vector3 {
    const n = this.toNdc(x, y);
    const p = new Vector3(n.x, n.y, 0.5).unproject(this.camera);
    const dir = p.sub(this.camera.position);
    const t = (planeZ - this.camera.position.z) / dir.z;
    return this.camera.position.clone().addScaledVector(dir, t);
  }

  /** 画面上の点を通る視線の方向（単位ベクトル） */
  rayDir(x: number, y: number): Vector3 {
    const n = this.toNdc(x, y);
    return new Vector3(n.x, n.y, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
  }

  worldToScreen(p: Vector3): Vector2 {
    const v = p.clone().project(this.camera);
    return new Vector2(((v.x + 1) / 2) * this.width, ((1 - v.y) / 2) * this.height);
  }
}

function makeBackground(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#1d1640');
  grad.addColorStop(0.55, '#2a1f55');
  grad.addColorStop(1, '#130f2a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
