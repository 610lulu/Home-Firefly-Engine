// Spiral Firefly v2.2 - Three.js dev simulator
// - 固定 Pi Camera 视角(主)
// - 可旋转副视角(开发调试)
// - 胶囊人随机走动(避开装置)
// - 按人身高 → 灯段(从下往上累计亮,光流延时)
// - 段编号 = 螺旋高度 0(底)→ 5(顶)

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ============================================================
// Config
// ============================================================
const SPIRAL = { height: 3.0, radius: 0.6, turns: 5, totalLeds: 300 };
const SEG_COUNT = 6;
const SEG_SIZE = SPIRAL.totalLeds / SEG_COUNT;  // 50
const WALK_AREA = 5.0;
const SPIRAL_KEEPOUT = 1.0;

// 身高 → 段号 映射(0=底, 5=顶)
// 拓宽身高范围:大人 1.5-2.0m 触段 5,小孩 0.6-1.3m 触段 0
const HEIGHT_LEVELS = [
  { minH: 0.0,  maxH: 0.8,  seg: 0 },  // 小孩矮(0.6-0.8 触段 0)
  { minH: 0.8,  maxH: 1.1,  seg: 1 },  // 小孩低
  { minH: 1.1,  maxH: 1.4,  seg: 2 },  // 小孩高 / 大人下蹲
  { minH: 1.4,  maxH: 1.7,  seg: 3 },  // 大人站
  { minH: 1.7,  maxH: 1.9,  seg: 4 },  // 大人站高
  { minH: 1.9,  maxH: 3.0,  seg: 5 },  // 伸手/举高
];

// 灯色
const COLOR_ACTIVE = new THREE.Color(0xffb048);
const COLOR_IDLE   = new THREE.Color(0x100800);
const COLOR_SEG_DEBUG = [
  new THREE.Color(0x4ec9b0),  // seg 0: 青
  new THREE.Color(0x06d6a0),  // seg 1: 绿
  new THREE.Color(0xffd166),  // seg 2: 黄
  new THREE.Color(0xff8da1),  // seg 3: 粉
  new THREE.Color(0xb085ff),  // seg 4: 紫
  new THREE.Color(0x7fc8ff),  // seg 5: 蓝
];

// 互动参数
const CROWD_MAX = 30;        // 30 人封顶全亮(超过触发 homecoming)
const DIST_MAX_EFFECT = 5.0; // 5m 内有效,5m 外几乎无效
const HEIGHT_GAUSSIAN_SIGMA = 0.6;  // 身高对段影响的"模糊度"

// 呼吸参数(全局最大幅度,实际幅度由距离因子调节)
const BREATH_FREQ = 0.5;     // 0.5 Hz, 2 秒一个周期
const MAX_BREATH_AMP = 0.50; // 最大 ±50%(近圈用这个),远圈会降低

// Homecoming 光流参数(方案 C:逐颗循环,每颗亮+延迟熄)
const HOMECOMING_RISE_MS = 10000;  // 10 秒总时长
const HOMECOMING_PEAK_MS = 500;    // 每颗 LED 到达峰值的时间(0.5s)
const HOMECOMING_FADE_MS = 4500;   // 每颗 LED 衰减时间(4.5s)——10s 内任意时刻约 150 颗在亮

// ============================================================
// State
// ============================================================
const state = {
  people: [],
  // 段强度(连续值,0..1,不是 Set)
  baseIntensity: new Array(SEG_COUNT).fill(0),    // 基础强度(慢 lerp)
  segmentIntensity: new Array(SEG_COUNT).fill(0),  // 实际强度 = 基础 × 呼吸
  targetIntensity: new Array(SEG_COUNT).fill(0),   // 目标强度(每帧重算)
  adultRatio: 0,
  childRatio: 0,
  avgDistanceBreath: 0,  // 0..1,所有人距离呼吸幅度的平均
  // Homecoming 状态
  homecoming: false,                  // 当前是否在 homecoming 模式
  homecomingStartTime: 0,             // 进入 homecoming 的时间(ms)
  homecomingEndTime: 0,               // 退出 homecoming 的时间(用于延迟熄灭)
  homecomingLedProgress: null,        // 每颗 LED 进度 [0..1],homecoming 时用
  segmentIntensityLed: null,          // 每颗 LED 实际强度(渲染用)
  speedMul: 1.0,
  paused: false,
  wledPaused: false,
  showSegDebug: false,
  meshType: 'capsule',
  lastTs: performance.now(),
  lastWledPost: 0,
};

// ============================================================
// Scene
// ============================================================
const app = document.getElementById('app');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0a);
scene.fog = new THREE.Fog(0x0a0a0a, 10, 22);

// --- 灯光:让 StandardMaterial 可见 ---
const ambient = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambient);
const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
keyLight.position.set(5, 8, 5);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xffb048, 0.3);
fillLight.position.set(-3, 4, -3);
scene.add(fillLight);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(devicePixelRatio);
app.appendChild(renderer.domElement);

// --- 主视角:固定 Pi Camera(3.3m 高,朝下)---
const camHeight = 3.3;
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 50);
camera.position.set(0, camHeight, 0);
camera.lookAt(0, 0, 0);

// --- 副视角:开发调试用(可旋转,占满主视图)---
const devCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 50);
devCamera.position.set(5, 2.5, 5);
devCamera.lookAt(0, 1.5, 0);
const controls = new OrbitControls(devCamera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.target.set(0, 1.5, 0);
controls.minDistance = 2;
controls.maxDistance = 12;
controls.maxPolarAngle = Math.PI * 0.85;  // 防止转到地下

// ============================================================
// World
// ============================================================
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(10, 10),
  new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const grid = new THREE.GridHelper(10, 20, 0x303030, 0x202020);
scene.add(grid);

// FOV footprint ring(摄像头视野在地面的覆盖圆)
const fovRing = new THREE.Mesh(
  new THREE.RingGeometry(2.4, 2.5, 64),
  new THREE.MeshBasicMaterial({ color: 0x4a4a4a, side: THREE.DoubleSide, transparent: true, opacity: 0.3 }),
);
fovRing.rotation.x = -Math.PI / 2;
fovRing.position.y = 0.01;
scene.add(fovRing);

// --- 距离感应圈(3 圈虚线,2m / 3.5m / 5m)---
// 内圈 = 近(< 2m,强贡献),中圈 = 中(2-3.5m,中等),外圈 = 远(3.5-5m,弱)
function makeDashedRing(radius, color, opacity = 0.6) {
  // 用 Line 画虚线圆
  const segments = 128;
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(a) * radius, 0.015, Math.sin(a) * radius));
  }
  const geom = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineDashedMaterial({
    color: color,
    dashSize: 0.15,
    gapSize: 0.1,
    transparent: true,
    opacity: opacity,
  });
  const line = new THREE.Line(geom, mat);
  line.computeLineDistances();  // 必须:虚线才显示
  return line;
}

const ringInner = makeDashedRing(2.0, 0xffb048, 0.7);   // 近圈:橙(强)
const ringMid   = makeDashedRing(3.5, 0xffd166, 0.55);  // 中圈:黄(中)
const ringOuter = makeDashedRing(5.0, 0x7fc8ff, 0.4);   // 远圈:蓝(弱)
scene.add(ringInner);
scene.add(ringMid);
scene.add(ringOuter);

// 距离圈标签(Sprite 文字)
function makeLabelSprite(text, color = '#ffffff') {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = color;
  ctx.font = 'bold 36px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.8, 0.2, 1);
  return sprite;
}

const labelInner = makeLabelSprite('2m (强)', '#ffb048');
labelInner.position.set(0, 0.3, 2.0);
scene.add(labelInner);

const labelMid = makeLabelSprite('3.5m (中)', '#ffd166');
labelMid.position.set(0, 0.3, 3.5);
scene.add(labelMid);

const labelOuter = makeLabelSprite('5m (弱)', '#7fc8ff');
labelOuter.position.set(0, 0.3, 5.0);
scene.add(labelOuter);

// --- 螺旋 ---
const spiralPoints = [];
for (let i = 0; i <= 200; i++) {
  const t = i / 200;
  const a = t * Math.PI * 2 * SPIRAL.turns;
  spiralPoints.push(new THREE.Vector3(
    Math.cos(a) * SPIRAL.radius,
    t * SPIRAL.height,
    Math.sin(a) * SPIRAL.radius,
  ));
}
const spiralCurve = new THREE.CatmullRomCurve3(spiralPoints);

const helix = new THREE.Mesh(
  new THREE.TubeGeometry(spiralCurve, 300, 0.012, 8, false),
  new THREE.MeshBasicMaterial({ color: 0x3a3a3a }),
);
scene.add(helix);

// 3 根纵向支撑
for (let i = 0; i < 3; i++) {
  const a = (i / 3) * Math.PI * 2;
  const strut = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, SPIRAL.height, 6),
    new THREE.MeshBasicMaterial({ color: 0x2a2a2a }),
  );
  strut.position.set(Math.cos(a) * SPIRAL.radius, SPIRAL.height / 2, Math.sin(a) * SPIRAL.radius);
  scene.add(strut);
}

// 顶/底圈
[0, SPIRAL.height].forEach(y => {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(SPIRAL.radius, 0.015, 6, 64),
    new THREE.MeshBasicMaterial({ color: 0x404040 }),
  );
  ring.position.y = y;
  ring.rotation.x = Math.PI / 2;
  scene.add(ring);
});

// ============================================================
// Pi Camera 安装:顶部横梁中央夹具固定
// ============================================================
// 设计:在顶圈上方 0.05m 加 1 根直径 2cm 的横梁(直径方向贯穿)
//  Pi Camera 用 3D 打印夹具固定在横梁中央,镜头朝下
//  减震:夹具底部嵌 2mm 硅胶垫
const TOP_Y = SPIRAL.height;
const CAM_HOLDER_Y = TOP_Y + 0.05;  // 横梁位置

// 1. 顶框横梁(直径方向贯穿,从 -r 到 +r,直径 2cm)
const topBeam = new THREE.Mesh(
  new THREE.CylinderGeometry(0.012, 0.012, SPIRAL.radius * 2, 8),
  new THREE.MeshBasicMaterial({ color: 0x555555 }),
);
topBeam.position.set(0, CAM_HOLDER_Y, 0);
topBeam.rotation.z = Math.PI / 2;  // 横躺
scene.add(topBeam);

// 2. Pi Camera 夹具(简化:1 个长方体包住相机主体,2mm 厚,25×25×10mm)
const camHolder = new THREE.Mesh(
  new THREE.BoxGeometry(0.04, 0.025, 0.025),
  new THREE.MeshBasicMaterial({ color: 0x222222 }),
);
camHolder.position.set(0, CAM_HOLDER_Y - 0.045, 0);  // 横梁下方 4.5cm
scene.add(camHolder);

// 3. Pi Camera 本体(镜头圆筒 + 主体方块)
// 镜头圆筒(直径 8mm,长 5mm,朝下)
const camLens = new THREE.Mesh(
  new THREE.CylinderGeometry(0.008, 0.008, 0.012, 12),
  new THREE.MeshBasicMaterial({ color: 0x000000 }),
);
camLens.position.set(0, CAM_HOLDER_Y - 0.07, 0);
scene.add(camLens);

// 镜头玻璃(深色圆形)
const camGlass = new THREE.Mesh(
  new THREE.CircleGeometry(0.006, 16),
  new THREE.MeshBasicMaterial({ color: 0x1a3a5a }),
);
camGlass.position.set(0, CAM_HOLDER_Y - 0.076, 0);
camGlass.rotation.x = -Math.PI / 2;  // 朝下
scene.add(camGlass);

// 4. 减震垫(横梁和夹具之间,2mm 厚硅胶)
const damper = new THREE.Mesh(
  new THREE.CylinderGeometry(0.015, 0.015, 0.003, 12),
  new THREE.MeshBasicMaterial({ color: 0xffaa44 }),
);
damper.position.set(0, CAM_HOLDER_Y - 0.027, 0);
scene.add(damper);

// 5. 标签:"Pi Camera V3 / 102° / 横梁夹具固定"
// 用精灵文字 + 引导线
function makeTextSprite(text, color = 0xffffff, bg = 0x000000) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 22px sans-serif';
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.5, 0.1, 1);
  return sprite;
}

const camLabel = makeTextSprite('Pi Camera V3 · 102°', 0xffd166);
camLabel.position.set(0.35, CAM_HOLDER_Y - 0.04, 0);
scene.add(camLabel);

const beamLabel = makeTextSprite('横梁 + 减震夹具', 0x9aa0a6);
beamLabel.position.set(-0.35, CAM_HOLDER_Y + 0.02, 0);
scene.add(beamLabel);

// 6. 引导线(从相机指向地面中心,显示 FOV 中心轴)
const fovAxisGeom = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, CAM_HOLDER_Y - 0.07, 0),
  new THREE.Vector3(0, 0, 0),
]);
const fovAxis = new THREE.Line(
  fovAxisGeom,
  new THREE.LineDashedMaterial({ color: 0xffd166, dashSize: 0.1, gapSize: 0.05, transparent: true, opacity: 0.4 }),
);
fovAxis.computeLineDistances();
scene.add(fovAxis);

// 7. FOV 锥体(可视化 102° 视野,透明黄色)
// 用 ConeGeometry 模拟,顶部 = 相机位置,底部 = 地面 5m × 5m 圈
// 锥角 ≈ 51°(102° / 2),锥高 = 3.25m → 半径 = 3.25 × tan(51°) ≈ 4m
const fovHalfAngle = 51 * Math.PI / 180;
const fovConeRadius = (CAM_HOLDER_Y - 0.07) * Math.tan(fovHalfAngle);
const fovConeHeight = CAM_HOLDER_Y - 0.07;
const fovCone = new THREE.Mesh(
  new THREE.ConeGeometry(fovConeRadius, fovConeHeight, 32, 1, true),
  new THREE.MeshBasicMaterial({
    color: 0xffd166,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
);
// Cone 默认顶点在上,底在 z=-h/2;我们要把顶点放在相机位置,开口向下
// 因此旋转 180°(绕 X 轴)
fovCone.rotation.x = Math.PI;
fovCone.position.set(0, (CAM_HOLDER_Y - 0.07) / 2, 0);
scene.add(fovCone);

// --- 300 LED InstancedMesh (BasicMaterial 颜色直接控制,无需光照) ---
const ledGeo = new THREE.SphereGeometry(0.025, 8, 8);
const ledMat = new THREE.MeshBasicMaterial({ vertexColors: true });
const leds = new THREE.InstancedMesh(ledGeo, ledMat, SPIRAL.totalLeds);
scene.add(leds);

// --- 每颗 LED 加一个发光光晕(小,加色叠加) ---
const haloGeo = new THREE.SphereGeometry(0.05, 6, 6);
const haloMat = new THREE.MeshBasicMaterial({
  color: 0xffb048,
  transparent: true,
  opacity: 0.35,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const halos = new THREE.InstancedMesh(haloGeo, haloMat, SPIRAL.totalLeds);
scene.add(halos);

const dummyObj = new THREE.Object3D();
const tmpColor = new THREE.Color();
for (let i = 0; i < SPIRAL.totalLeds; i++) {
  dummyObj.position.copy(spiralCurve.getPoint(i / SPIRAL.totalLeds));
  dummyObj.updateMatrix();
  leds.setMatrixAt(i, dummyObj.matrix);
  halos.setMatrixAt(i, dummyObj.matrix);
  leds.setColorAt(i, tmpColor.copy(COLOR_IDLE));
  halos.setColorAt(i, tmpColor.copy(COLOR_IDLE));
}
leds.instanceMatrix.needsUpdate = true;
halos.instanceMatrix.needsUpdate = true;
leds.instanceColor.needsUpdate = true;
halos.instanceColor.needsUpdate = true;

// --- 段编号标记(每段顶部画一个小数字牌)---
const segLabels = [];
for (let i = 0; i < SEG_COUNT; i++) {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffb048';
  ctx.font = 'bold 48px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(i), 32, 32);

  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(0.25, 0.25, 0.25);
  // Place at the middle of each segment, sticking out radially
  const midI = i * SEG_SIZE + SEG_SIZE / 2;
  const t = midI / SPIRAL.totalLeds;
  const a = t * Math.PI * 2 * SPIRAL.turns;
  const px = Math.cos(a) * (SPIRAL.radius + 0.15);
  const py = t * SPIRAL.height;
  const pz = Math.sin(a) * (SPIRAL.radius + 0.15);
  sprite.position.set(px, py, pz);
  sprite.visible = false;  // 默认不显示,调试时再开
  scene.add(sprite);
  segLabels.push(sprite);
}

// ============================================================
// Person (capsule)
// ============================================================
const PERSON_COLORS = {
  adult: [0x4ec9b0, 0xb085ff, 0x7fc8ff, 0x06d6a0, 0xffffff, 0xef476f],   // 大人:冷色系 + 白
  child: [0xffd166, 0xff8da1, 0xff6b9d, 0xffa94d, 0xffec99, 0xffd43b],  // 小孩:暖色系
};

function makeLabelCanvas(text, bgColor, fgColor) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 80;
  const ctx = canvas.getContext('2d');
  // 背景圆角矩形
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(8, 12, 240, 56, 12) : ctx.rect(8, 12, 240, 56);
  ctx.fill();
  // 文字
  ctx.fillStyle = fgColor;
  ctx.font = 'bold 38px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 40);
  return canvas;
}

function makePersonMesh() {
  // 50/50 随机分大人/小孩
  const isAdult = Math.random() < 0.5;
  const palette = isAdult ? PERSON_COLORS.adult : PERSON_COLORS.child;
  const bodyColor = palette[Math.floor(Math.random() * palette.length)];

  let bodyHeight, bodyRadius, labelText, labelBg, labelFg;
  if (isAdult) {
    // 大人:1.6-1.9m
    bodyHeight = 0.5 + Math.random() * 0.3;  // 0.5-0.8(身体段)
    bodyRadius = 0.14;
    labelText = 'ADULT';
    labelBg = 'rgba(78, 201, 176, 0.85)';    // 青绿底
    labelFg = '#0a0a0a';
  } else {
    // 小孩:0.9-1.3m
    bodyHeight = 0.25 + Math.random() * 0.2;  // 0.25-0.45
    bodyRadius = 0.10;
    labelText = 'CHILD';
    labelBg = 'rgba(255, 209, 102, 0.9)';    // 暖黄底
    labelFg = '#0a0a0a';
  }

  const group = new THREE.Group();

  // 身体
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(bodyRadius, bodyHeight, 6, 12),
    new THREE.MeshStandardMaterial({
      color: bodyColor,
      emissive: bodyColor,
      emissiveIntensity: 0.3,
      roughness: 0.5,
    }),
  );
  body.position.y = bodyHeight / 2 + bodyRadius;
  group.add(body);

  // 头
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(bodyRadius * 0.9, 12, 12),
    new THREE.MeshStandardMaterial({
      color: 0xffd9b3,
      emissive: 0xffd9b3,
      emissiveIntensity: 0.2,
      roughness: 0.5,
    }),
  );
  head.position.y = bodyHeight + bodyRadius * 1.7;
  group.add(head);

  // 头顶标签
  const labelCanvas = makeLabelCanvas(labelText, labelBg, labelFg);
  const labelTex = new THREE.CanvasTexture(labelCanvas);
  const labelMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthTest: false });
  const labelSprite = new THREE.Sprite(labelMat);
  labelSprite.scale.set(0.5, 0.156, 1);
  labelSprite.position.y = bodyHeight + bodyRadius * 2.2 + 0.3;
  labelSprite.renderOrder = 999;  // 始终在最前
  group.add(labelSprite);

  return { group, isAdult };
}

class Person {
  constructor() {
    const { group, isAdult } = makePersonMesh();
    this.mesh = group;
    this.isAdult = isAdult;
    this.pos = this._randomPos();
    this.heading = Math.random() * Math.PI * 2;
    this.speed = 0.3 + Math.random() * 0.5;
    // 身高:大人 1.5-2.0m(覆盖段 2-5),小孩 0.6-1.3m(覆盖段 0-2)
    if (isAdult) {
      this.height = 1.5 + Math.random() * 0.5;
    } else {
      this.height = 0.6 + Math.random() * 0.7;
    }
    this.mesh.position.copy(this.pos);
    scene.add(this.mesh);
  }

  _randomPos() {
    for (let i = 0; i < 20; i++) {
      const x = (Math.random() - 0.5) * WALK_AREA * 2;
      const z = (Math.random() - 0.5) * WALK_AREA * 2;
      if (Math.hypot(x, z) > SPIRAL_KEEPOUT) {
        return new THREE.Vector3(x, 0, z);
      }
    }
    return new THREE.Vector3(2, 0, 0);
  }

  update(dt) {
    if (state.paused) return;
    if (Math.random() < dt * 0.3) {
      this.heading += (Math.random() - 0.5) * Math.PI * 0.6;
    }
    const dx = Math.cos(this.heading) * this.speed * state.speedMul * dt;
    const dz = Math.sin(this.heading) * this.speed * state.speedMul * dt;
    this.pos.x += dx;
    this.pos.z += dz;
    if (Math.abs(this.pos.x) > WALK_AREA) { this.pos.x = Math.sign(this.pos.x) * WALK_AREA; this.heading += Math.PI; }
    if (Math.abs(this.pos.z) > WALK_AREA) { this.pos.z = Math.sign(this.pos.z) * WALK_AREA; this.heading += Math.PI; }
    const distToCenter = Math.hypot(this.pos.x, this.pos.z);
    if (distToCenter < SPIRAL_KEEPOUT) {
      const pushAngle = Math.atan2(this.pos.z, this.pos.x);
      this.pos.x = Math.cos(pushAngle) * SPIRAL_KEEPOUT;
      this.pos.z = Math.sin(pushAngle) * SPIRAL_KEEPOUT;
      this.heading = pushAngle + Math.PI / 2 + (Math.random() - 0.5);
    }
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = -this.heading + Math.PI / 2;
  }

  getSegmentByHeight() {
    // 返回连续值:primary seg (0..5) + 段内位置 (0..1)
    // 例如 height=1.2 在段 2(1.0-1.4)中间 → primary=2, frac=0.5
    const h = this.height;
    for (const lv of HEIGHT_LEVELS) {
      if (h >= lv.minH && h < lv.maxH) {
        return {
          primary: lv.seg,
          frac: (h - lv.minH) / (lv.maxH - lv.minH),
        };
      }
    }
    return { primary: 0, frac: 0 };
  }

  getDistanceFromCenter() {
    return Math.hypot(this.pos.x, this.pos.z);
  }

  getDistanceFactor() {
    // 距离因子(按 3 个感应圈分段,差距温和拉大):
    // < 2m   → 1.0 (近:强)
    // 2-3.5m → 0.25 (中:中等)
    // 3.5-5m → 0.05 (远:弱)
    // > 5m   → 0.0
    const d = this.getDistanceFromCenter();
    if (d < 2.0) return 1.0;
    if (d < 3.5) return 0.25;
    if (d < 5.0) return 0.05;
    return 0.0;
  }

  getDistanceZone() {
    // 返回人所在的距离圈编号:0=近, 1=中, 2=远, 3=外
    const d = this.getDistanceFromCenter();
    if (d < 2.0) return 0;
    if (d < 3.5) return 1;
    if (d < 5.0) return 2;
    return 3;
  }

  // 呼吸幅度因子(近的人呼吸强,远的人几乎不呼吸)
  getBreathAmplitude() {
    // < 2m   → 0.60 (近:强烈呼吸)
    // 2-3.5m → 0.30 (中:中等呼吸)
    // 3.5-5m → 0.10 (远:弱呼吸)
    // > 5m   → 0.00
    const d = this.getDistanceFromCenter();
    if (d < 2.0) return 0.60;
    if (d < 3.5) return 0.30;
    if (d < 5.0) return 0.10;
    return 0.00;
  }

  dispose() {
    scene.remove(this.mesh);
    this.mesh.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    });
  }
}

// ============================================================
// People mgmt
// ============================================================
function addPerson() {
  state.people.push(new Person());
  updateUI();
}
function removePerson() {
  if (state.people.length === 0) return;
  const p = state.people.pop();
  p.dispose();
  updateUI();
}
function clearPeople() {
  state.people.forEach(p => p.dispose());
  state.people = [];
  updateUI();
}
function switchMeshType() {
  const old = state.people;
  clearPeople();
  state.meshType = state.meshType === 'capsule' ? 'cylinder' : 'capsule';
  old.forEach(() => addPerson());
}

// ============================================================
// Lighting (连续渐变模式)
// ============================================================
// 逻辑:
// 1. 每个段有一个 0..1 的"目标强度"
// 2. 每个段从 2 个相邻身高段贡献:人身高 h 落在段 primary,
//    段 primary 强度 += 1 - frac, 段 primary+1 强度 += frac
//    (身高越高,主段越强,上面段也带一点)
// 3. 段强度乘以人数因子(人数/CROWD_MAX,封顶 1)
// 4. 段强度乘以距离因子(人到装置的距离,近=1,远=0)
// 5. 实际渲染强度 = lerp(实际,目标, 0.08) 平滑过渡
function computeTargetIntensity() {
  const seg = new Array(SEG_COUNT).fill(0);
  const counts = new Array(SEG_COUNT).fill(0);
  let adultCount = 0;
  let childCount = 0;
  let nearBreathSum = 0;   // 近圈(2m 内)总呼吸幅度(0-1)
  let totalBreathSum = 0;  // 所有近圈+中圈总呼吸幅度

  for (const p of state.people) {
    const { primary, frac } = p.getSegmentByHeight();
    const distFactor = p.getDistanceFactor();
    const breathAmp = p.getBreathAmplitude();
    // 身高对段的贡献(主段 + 上一段)
    seg[primary] += (1 - frac) * distFactor;
    if (primary + 1 < SEG_COUNT) {
      seg[primary + 1] += frac * distFactor;
    }
    counts[primary]++;
    if (p.isAdult) adultCount++;
    else childCount++;
    // 距离呼吸累加(只算近圈+中圈的人,远圈呼吸太小可忽略)
    if (p.getDistanceZone() <= 1) {
      totalBreathSum += breathAmp;
    }
  }

  // 人数封顶因子(温和拉大,5 人时 = 0.30,15 人时 = 0.75)
  // 用 sqrt 而不是线性,前段增长快,后段变缓
  const crowdFactor = Math.min(1, Math.sqrt(state.people.length / CROWD_MAX));
  for (let i = 0; i < SEG_COUNT; i++) {
    seg[i] = Math.min(1, seg[i] * crowdFactor);  // clamp 到 [0, 1]
  }

  // 大人/小孩比例
  const total = adultCount + childCount;
  const adultRatio = total > 0 ? adultCount / total : 0;
  const childRatio = total > 0 ? childCount / total : 0;

  // 距离平均呼吸幅度(近+中):0..1
  // 3 个近圈人(每个 0.5)→ 平均 0.5
  const avgDistanceBreath = total > 0 ? totalBreathSum / total : 0;

  return { intensity: seg, counts, adultRatio, childRatio, avgDistanceBreath };
}

// 计算每段的呼吸幅度
// 顶层段(5)用 adultRatio 决定,底层段(0)用 childRatio 决定
// 呼吸走 sin 的 0.5Hz 振荡
// 呼吸幅度 = 大人/小孩比例 × 距离平均呼吸幅度 × MAX_BREATH_AMP
//   距离近(全在 2m 内)= 1.0 → 呼吸最大
//   距离远(都在 5m 外)= 0.0 → 呼吸 0
function computeBreathPerSegment(adultRatio, childRatio, avgDistanceBreath, now) {
  const baseSin = Math.sin(now * 0.001 * Math.PI * 2 * BREATH_FREQ);  // -1..+1
  const breath = new Array(SEG_COUNT).fill(1.0);
  for (let i = 0; i < SEG_COUNT; i++) {
    // 段 i 的呼吸倾向:顶层偏 adult,底层偏 child
    const segmentT = i / (SEG_COUNT - 1);  // 0..1
    const ampScale = childRatio * (1 - segmentT) + adultRatio * segmentT;
    // 呼吸系数:1 ± ampScale × distanceFactor × MAX_BREATH_AMP
    breath[i] = 1.0 + baseSin * ampScale * avgDistanceBreath * MAX_BREATH_AMP;
  }
  return breath;
}

function updateLighting(now, dt) {
  const { intensity, counts, adultRatio, childRatio, avgDistanceBreath } = computeTargetIntensity();
  state.targetIntensity = intensity;
  state.adultRatio = adultRatio;
  state.childRatio = childRatio;
  state.avgDistanceBreath = avgDistanceBreath;

  // --- Homecoming 模式:总人数 > 30 触发 ---
  // 方案 C:逐颗循环,每颗 LED 亮+延迟熄,10s 后回归正常检测
  const totalPeople = state.people.length;
  // 清除已结束的冷却标记
  if (state.homecomingEndTime > 0 && now >= state.homecomingEndTime) {
    state.homecomingEndTime = 0;
  }
  // 触发条件:人数 > 30,且不在 homecoming,且不在冷却期
  if (totalPeople > CROWD_MAX && !state.homecoming && !state.homecomingEndTime) {
    state.homecoming = true;
    state.homecomingStartTime = now;
  }
  // 10s 后强制退出 homecoming,设置冷却期
  // 注意:homecoming 一旦启动,即使人数 < 30 也要走完 10s
  if (state.homecoming) {
    const elapsed = now - state.homecomingStartTime;
    if (elapsed >= HOMECOMING_RISE_MS) {
      state.homecoming = false;
      // 冷却期 = 每颗 LED 最大寿命,确保波带完全走完后再允许重新触发
      state.homecomingEndTime = now + HOMECOMING_PEAK_MS + HOMECOMING_FADE_MS;
    }
  }
  // 人数回落时,如果还在 homecoming 期间则继续(不重置 startTime)
  // 人数 > 30 且 homecoming=false 且 endTime 过期时,允许重新触发
  // (上述 line 632 已经处理)

  // 计算 homecoming 模式下每颗 LED 的目标强度
  // 方案 C:每颗 LED 在 t_i 时刻开始亮,300ms 到峰值,然后 1500ms 衰减到 0
  let homecomingIntensity = null;
  let homecomingLedProgress = null;
  if (state.homecoming) {
    const totalLeds = SPIRAL.totalLeds;
    homecomingIntensity = new Array(totalLeds).fill(0);
    homecomingLedProgress = new Array(totalLeds).fill(0);
    const elapsed = now - state.homecomingStartTime;
    // 每颗 LED 触发间隔:10s 内 300 颗都触发完
    const triggerInterval = HOMECOMING_RISE_MS / totalLeds;  // ~33ms
    // 人数溢出因子(超过 30 越多越亮)
    const overflow = Math.min(1, (totalPeople - CROWD_MAX) / CROWD_MAX);
    const baseIntensity = 0.5 + 0.5 * overflow;
    for (let i = 0; i < totalLeds; i++) {
      // LED i 触发时间(从 homecoming 开始)
      const t_i = i * triggerInterval;
      const localT = elapsed - t_i;
      let p = 0;
      if (localT < 0) {
        // 还没到触发时间
        p = 0;
      } else if (localT < HOMECOMING_PEAK_MS) {
        // 上升段:0 → 1,300ms
        p = localT / HOMECOMING_PEAK_MS;
      } else if (localT < HOMECOMING_PEAK_MS + HOMECOMING_FADE_MS) {
        // 衰减段:1 → 0,1500ms
        const fadeT = (localT - HOMECOMING_PEAK_MS) / HOMECOMING_FADE_MS;
        p = 1 - fadeT;
      } else {
        // 已熄灭
        p = 0;
      }
      homecomingLedProgress[i] = p;
      homecomingIntensity[i] = baseIntensity * p;
    }
  }

  // --- 选最终目标强度 ---
  // 优先级:homecoming 模式 > 正常模式
  let targetIntensity;
  if (homecomingIntensity) {
    // homecoming 模式:每颗 LED 独立强度(逐颗亮起)
    targetIntensity = homecomingIntensity;
    state.homecomingLedProgress = homecomingLedProgress;
  } else {
    // 正常模式:把"段级强度"扩展到每颗 LED
    targetIntensity = new Array(SPIRAL.totalLeds);
    for (let i = 0; i < SPIRAL.totalLeds; i++) {
      const segId = Math.floor(i / SEG_SIZE);
      targetIntensity[i] = intensity[segId];
    }
    state.homecomingLedProgress = null;
  }

  // 1. 基础强度走慢 lerp(2/秒)—— 但 homecoming 模式及熄灭期直接用 target
  //    (避免 lerp 抹平光流效果)
  const inHomecomingFlow = state.homecoming || state.homecomingEndTime > 0;
  if (inHomecomingFlow) {
    if (!state.baseIntensityLed) state.baseIntensityLed = new Array(SPIRAL.totalLeds).fill(0);
    for (let i = 0; i < SPIRAL.totalLeds; i++) {
      state.baseIntensityLed[i] = targetIntensity[i];
    }
  } else {
    if (!state.baseIntensityLed) state.baseIntensityLed = new Array(SPIRAL.totalLeds).fill(0);
    const baseLerp = 1 - Math.exp(-dt * 2);
    for (let i = 0; i < SPIRAL.totalLeds; i++) {
      state.baseIntensityLed[i] += (targetIntensity[i] - state.baseIntensityLed[i]) * baseLerp;
    }
  }

  // 2. 呼吸叠加(直接用 sin,不被 lerp 抹平)
  // homecoming 模式下不呼吸(让光流更纯粹)
  if (state.homecoming) {
    state.segmentIntensityLed = [...state.baseIntensityLed];
  } else {
    // 正常模式:段级呼吸应用到每颗 LED
    const breath = computeBreathPerSegment(adultRatio, childRatio, avgDistanceBreath, now);
    state.segmentIntensityLed = new Array(SPIRAL.totalLeds);
    for (let i = 0; i < SPIRAL.totalLeds; i++) {
      const segId = Math.floor(i / SEG_SIZE);
      state.segmentIntensityLed[i] = state.baseIntensityLed[i] * breath[segId];
    }
  }

  // 旧 segmentIntensity 数组(段级,用于 HUD 显示)
  for (let s = 0; s < SEG_COUNT; s++) {
    let sum = 0;
    for (let i = s * SEG_SIZE; i < (s + 1) * SEG_SIZE; i++) {
      sum += state.segmentIntensityLed[i];
    }
    state.segmentIntensity[s] = sum / SEG_SIZE;
  }

  return counts;
}

// ============================================================
// LED colors
// ============================================================
function updateLeds() {
  const isHomecoming = state.homecoming;
  const totalLeds = SPIRAL.totalLeds;
  const ledIntensity = state.segmentIntensityLed;
  for (let i = 0; i < totalLeds; i++) {
    const segId = Math.floor(i / SEG_SIZE);
    const intensity = ledIntensity ? ledIntensity[i] : state.segmentIntensity[segId];
    let color;
    if (isHomecoming && state.homecomingLedProgress) {
      // Homecoming 模式:逐颗变色,暖(红橙)→冷(蓝紫)
      // progress 越高色相越冷
      const p = state.homecomingLedProgress[i];
      // hue: 0.08 (橙) → 0.65 (蓝紫)
      const hue = 0.08 + (0.65 - 0.08) * p;
      const sat = 1.0;
      const val = Math.max(0.05, intensity);  // 强度→亮度
      color = new THREE.Color().setHSL(hue, sat, val);
    } else if (state.showSegDebug) {
      // 调试:基础色 + 强度
      const base = COLOR_SEG_DEBUG[segId];
      color = base.clone().multiplyScalar(0.1 + intensity * 0.9);
    } else {
      // 正常模式:暗橙 → 亮橙(连续)
      color = COLOR_IDLE.clone().lerp(COLOR_ACTIVE, intensity);
    }
    leds.setColorAt(i, color);
    // 光晕
    const haloColor = (isHomecoming && state.homecomingLedProgress)
      ? color.clone().multiplyScalar(1.2)
      : state.showSegDebug
        ? color.clone().multiplyScalar(intensity * 1.5)
        : COLOR_ACTIVE.clone().multiplyScalar(intensity);
    halos.setColorAt(i, haloColor);
  }
  leds.instanceColor.needsUpdate = true;
  halos.instanceColor.needsUpdate = true;
}

// ============================================================
// Region bar UI
// ============================================================
const regionBarsEl = document.getElementById('region-bars');
const regionBars = [];
for (let i = 0; i < SEG_COUNT; i++) {
  const row = document.createElement('div');
  row.className = 'region-bar';
  row.innerHTML = `
    <span class="id">段${i}</span>
    <div class="bar"><div class="fill" style="width:0%"></div></div>
    <span class="cnt" style="width:18px;text-align:right">0</span>
  `;
  regionBarsEl.appendChild(row);
  regionBars.push({
    fill: row.querySelector('.fill'),
    cnt: row.querySelector('.cnt'),
  });
}
function updateUI() {
  document.getElementById('people-count').textContent = state.people.length;
}

// 段柱状条:同时显示强度(0..1)和人数
function updateRegionBars(counts) {
  const maxC = Math.max(1, ...counts, 1);
  counts.forEach((c, i) => {
    regionBars[i].fill.style.width = `${(state.segmentIntensity[i] * 100)}%`;
    regionBars[i].cnt.textContent = c;
  });
  // 暴露状态给 window 供调试
  window.__fireflyState = {
    homecoming: state.homecoming,
    homecomingEndTime: state.homecomingEndTime,
    segmentIntensity: [...state.segmentIntensity],
    baseIntensityLed: state.baseIntensityLed ? [...state.baseIntensityLed] : null,
    people: state.people.length,
  };
  // 模式指示
  const modeEl = document.getElementById('status-mode');
  if (modeEl) {
    if (state.homecoming) {
      modeEl.innerHTML = '🟠 <b>HOMECOMING</b>(光流)';
      modeEl.style.color = '#ff8da1';
    } else if (state.homecomingEndTime > 0) {
      modeEl.innerHTML = '🔵 <b>冷却中</b>(回归检测)';
      modeEl.style.color = '#7fc8ff';
    } else {
      modeEl.innerHTML = '⚪ 正常模式';
      modeEl.style.color = '#ffb048';
    }
  }
}

// ============================================================
// WLED bridge
// ============================================================
async function postState(counts) {
  if (state.wledPaused) return;
  const segs = [];
  for (let i = 0; i < SEG_COUNT; i++) {
    const intensity = state.segmentIntensity[i];
    segs.push({
      id: i,
      on: true,
      bri: Math.round(12 + intensity * 243),  // 12..255
      col: [[255, 176, 72]],
      fx: 0,
      sx: 0,
    });
  }
  const payload = {
    ts: Date.now(),
    people: state.people.length,
    target_intensity: state.targetIntensity,
    actual_intensity: state.segmentIntensity,
    region_heights: counts.map((c, i) => ({ seg: i, count: c, heightRange: HEIGHT_LEVELS[i] })),
    segments: segs,
  };
  // 静默尝试推给 Pi 5(无 Pi 时不报错)
  try {
    await fetch('http://localhost:8765/state', {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch (e) { /* ignore */ }

  // Region bars
  updateRegionBars(counts);
}

// ============================================================
// UI bindings
// ============================================================
document.getElementById('btn-add').onclick = addPerson;
document.getElementById('btn-remove').onclick = removePerson;
document.getElementById('btn-clear').onclick = clearPeople;
document.getElementById('btn-pause').onclick = (e) => {
  state.paused = !state.paused;
  e.target.textContent = state.paused ? '▶ 继续走动' : '⏸ 暂停走动';
};
document.getElementById('btn-wled-toggle').onclick = (e) => {
  state.wledPaused = !state.wledPaused;
  e.target.textContent = state.wledPaused ? '▶ 恢复 WLED' : '⏸ 暂停 WLED 输出';
};
document.getElementById('speed').oninput = (e) => {
  state.speedMul = parseFloat(e.target.value);
  document.getElementById('speed-val').textContent = state.speedMul.toFixed(1) + 'x';
};
document.getElementById('btn-mesh-capsule').onclick = (e) => {
  if (state.meshType === 'capsule') return;
  state.meshType = 'capsule';
  switchMeshType();
  e.target.classList.add('primary');
  document.getElementById('btn-mesh-cylinder').classList.remove('primary');
};
document.getElementById('btn-mesh-cylinder').onclick = (e) => {
  if (state.meshType === 'cylinder') return;
  state.meshType = 'cylinder';
  switchMeshType();
  e.target.classList.add('primary');
  document.getElementById('btn-mesh-cylinder').classList.add('primary');
  document.getElementById('btn-mesh-capsule').classList.remove('primary');
};
document.getElementById('btn-view-pi').onclick = (e) => {
  state.viewMode = 'pi';
  e.target.classList.add('primary');
  document.getElementById('btn-view-dev').classList.remove('primary');
};
document.getElementById('btn-view-dev').onclick = (e) => {
  state.viewMode = 'dev';
  e.target.classList.add('primary');
  document.getElementById('btn-view-pi').classList.remove('primary');
};
document.getElementById('btn-debug-seg').onclick = (e) => {
  state.showSegDebug = !state.showSegDebug;
  e.target.classList.toggle('primary', state.showSegDebug);
  for (const s of segLabels) s.visible = state.showSegDebug;
};

// 手动触发 homecoming(测试用)
document.getElementById('btn-trigger-homecoming').onclick = (e) => {
  if (!state.homecoming && !state.homecomingEndTime) {
    state.homecoming = true;
    state.homecomingStartTime = performance.now();
  }
};

state.viewMode = 'pi';

// ============================================================
// Render loop (双视图)
// ============================================================
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  devCamera.aspect = innerWidth / innerHeight;
  devCamera.updateProjectionMatrix();
  // Pi thumb 用 camera 全比例即可
  renderer.setSize(innerWidth, innerHeight);
});

function renderPiView() {
  // 主视角:Pi Camera 固定向下
  renderer.setViewport(0, 0, innerWidth, innerHeight);
  renderer.setScissor(0, 0, innerWidth, innerHeight);
  renderer.setScissorTest(false);
  renderer.clear();
  renderer.render(scene, camera);
}

function renderSplitView() {
  // 主视图 = 调试视角(占满),Pi 视角做缩略图(右上)
  const w = innerWidth, h = innerHeight;
  const thumbW = 280, thumbH = 200;
  const margin = 12;
  const thumbX = w - thumbW - margin - 220;  // 避开右下面板
  const thumbY = h - thumbH - margin;

  renderer.setScissorTest(false);
  // 主:调试视角(占满整屏)
  renderer.setViewport(0, 0, w, h);
  renderer.setScissor(0, 0, w, h);
  renderer.clear();
  renderer.render(scene, devCamera);

  // Pi 视角缩略图(用 setViewport 切到小区域)
  renderer.setViewport(thumbX, margin, thumbW, thumbH);
  renderer.setScissor(thumbX, margin, thumbW, thumbH);
  renderer.setScissorTest(true);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setScissorTest(false);
}

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.1, (now - state.lastTs) / 1000);
  state.lastTs = now;

  for (const p of state.people) p.update(dt);
  const counts = updateLighting(now, dt);
  updateLeds();

  if (state.viewMode === 'dev') {
    controls.update();
    renderSplitView();
  } else {
    renderPiView();
  }

  if (now - state.lastWledPost > 100) {
    postState(counts);
    state.lastWledPost = now;
  }
}

// Seed
for (let i = 0; i < 3; i++) addPerson();
// 默认调试视角(占满主视图),Pi 视角做缩略图
state.viewMode = 'dev';
document.getElementById('btn-view-pi').classList.remove('primary');
document.getElementById('btn-view-dev').classList.add('primary');

// 切到默认 dev 视角
// (种子人先放外面,animate 里只跑一次)
// 移除 Pi 视角缩略相关代码(在 v2.3 简化)
animate();
