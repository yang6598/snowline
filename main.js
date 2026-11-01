import * as THREE from 'three';

/* =========================================================
   雪线 · Snowline
   极简剪影滑雪 —— 黄昏下滑，滑过之处开出发光的花
   ========================================================= */

// ---------- 基础 ----------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();

const VIEW_H = 34;
function viewSize() {
  const aspect = window.innerWidth / window.innerHeight;
  return { w: VIEW_H * aspect, h: VIEW_H };
}
let vs = viewSize();

const camera = new THREE.OrthographicCamera(-vs.w / 2, vs.w / 2, vs.h / 2, -vs.h / 2, 0.1, 2000);
camera.position.set(0, 0, 100);
camera.lookAt(0, 0, 0);

// ---------- 地形函数 ----------
function terrainY(x) {
  return Math.sin(x * 0.0105) * 13.5
       + Math.sin(x * 0.0267 + 1.7) * 6.2
       + Math.sin(x * 0.0612 + 0.4) * 2.3
       + Math.sin(x * 0.173) * 0.62;
}
function terrainSlope(x) {
  return Math.cos(x * 0.0105) * 13.5 * 0.0105
       + Math.cos(x * 0.0267 + 1.7) * 6.2 * 0.0267
       + Math.cos(x * 0.0612 + 0.4) * 2.3 * 0.0612
       + Math.cos(x * 0.173) * 0.62 * 0.173;
}

// ---------- 程序化贴图 ----------
function glowTexture() {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,246,220,0.7)');
  g.addColorStop(0.65, 'rgba(255,214,150,0.18)');
  g.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const GLOW = glowTexture();

// ---------- 天空 ----------
const skyUniforms = {
  uTop: { value: new THREE.Color(0x3d3560) },
  uMid: { value: new THREE.Color(0x7a5270) },
  uBot: { value: new THREE.Color(0xe8a07a) },
  uNight: { value: 0 },
  uAurora: { value: 0 },
  uTime: { value: 0 },
};
const sky = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    depthWrite: false,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec2 vUv;
      uniform vec3 uTop, uMid, uBot;
      uniform float uNight, uAurora, uTime;
      void main() {
        float h = vUv.y;
        vec3 col = mix(uBot, uMid, smoothstep(0.12, 0.66, h));
        col = mix(col, uTop, smoothstep(0.58, 1.0, h));
        float glow = exp(-pow((h - 0.40) * 4.2, 2.0));
        col += vec3(1.0, 0.62, 0.38) * glow * (0.5 - uNight * 0.42);
        if (uAurora > 0.001) {
          float band = exp(-pow((h - 0.60) * 5.0, 2.0));
          float w = sin(vUv.x * 46.0 + uTime * 0.6) * 0.5 + sin(vUv.x * 27.0 - uTime * 0.35) * 0.5;
          col += vec3(0.25, 0.95, 0.55) * band * (0.45 + 0.55 * w) * uAurora * 0.5;
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  })
);
sky.position.z = -500;
scene.add(sky);

// ---------- 星 ----------
const STAR_N = 260;
const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(STAR_N * 3);
const starCol = new Float32Array(STAR_N * 3);
for (let i = 0; i < STAR_N; i++) {
  starPos[i * 3] = (Math.random() - 0.5) * 2600;
  starPos[i * 3 + 1] = 4 + Math.random() * 60;
  starPos[i * 3 + 2] = -420;
  const b = 0.5 + Math.random() * 0.5;
  starCol[i * 3] = b; starCol[i * 3 + 1] = b; starCol[i * 3 + 2] = b * 1.05;
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
const starMat = new THREE.PointsMaterial({
  size: 0.85, vertexColors: true, transparent: true, opacity: 0,
  depthWrite: false, sizeAttenuation: true,
});
const stars = new THREE.Points(starGeo, starMat);
stars.frustumCulled = false;
scene.add(stars);

// ---------- 远山剪影（视差层） ----------
function makeRidge(opts) {
  const { x0, x1, step, yBase, amp, freqs, color, z, parallax, cols } = opts;
  const pts = [];
  for (let x = x0; x <= x1; x += step) {
    let y = yBase;
    for (const [f, a, p] of freqs) y += Math.sin(x * f + p) * a;
    pts.push([x, y]);
  }
  const verts = [];
  const idx = [];
  pts.forEach(([x, y], i) => {
    verts.push(x, y, 0);
    verts.push(x, yBase - 220, 0);
    if (i > 0) {
      const a = (i - 1) * 2, b = (i - 1) * 2 + 1, c = i * 2, d = i * 2 + 1;
      idx.push(a, b, c, b, d, c);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, depthWrite: false }));
  mesh.position.z = z;
  mesh.userData.parallax = parallax;
  mesh.userData.cols = cols;
  return mesh;
}

const ridges = [];
ridges.push(makeRidge({
  x0: -800, x1: 9000, step: 26, yBase: -6, amp: 0,
  freqs: [[0.0024, 10, 0.6], [0.0061, 5, 2.1], [0.0135, 2, 0.2]],
  color: 0xa1788e, z: -300, parallax: 0.20,
  cols: [0xa1788e, 0x232a4d, 0x24505a],
}));
ridges.push(makeRidge({
  x0: -800, x1: 9000, step: 20, yBase: -10, amp: 0,
  freqs: [[0.0034, 7.5, 1.4], [0.0085, 3.8, 0.3], [0.019, 1.4, 2.2]],
  color: 0x7c6486, z: -200, parallax: 0.42,
  cols: [0x7c6486, 0x1a2040, 0x1c4048],
}));
ridges.push(makeRidge({
  x0: -800, x1: 9000, step: 14, yBase: -13, amp: 0,
  freqs: [[0.0047, 5, 2.6], [0.0118, 2.6, 1.1], [0.028, 0.9, 0.7]],
  color: 0x584a6e, z: -120, parallax: 0.62,
  cols: [0x584a6e, 0x181d38, 0x143038],
}));
ridges.forEach((r) => scene.add(r));

// ---------- 雪坡 ----------
const SNOW_X0 = -600;
const SNOW_X1 = 9000;
const SNOW_DX = 2;

let snowTintMat = null;

function buildSnow() {
  const topPos = [];
  const topCol = [];
  const bodyPos = [];
  const bodyCol = [];
  const idxTop = [];
  const idxBody = [];

  const cTop = new THREE.Color(0xfbfdff);
  const cTopSoft = new THREE.Color(0xdfe9f8);
  const cDeep = new THREE.Color(0x252a48);

  let n = 0;
  for (let x = SNOW_X0; x <= SNOW_X1; x += SNOW_DX) {
    const y = terrainY(x);
    // 亮边（雪面）
    topPos.push(x, y, 0);
    topPos.push(x, y - 0.75, 0);
    topCol.push(cTop.r, cTop.g, cTop.b);
    topCol.push(cTopSoft.r, cTopSoft.g, cTopSoft.b);
    // 雪层主体
    bodyPos.push(x, y - 0.75, 0);
    bodyPos.push(x, -160, 0);
    bodyCol.push(cTopSoft.r, cTopSoft.g, cTopSoft.b);
    bodyCol.push(cDeep.r, cDeep.g, cDeep.b);

    if (n > 0) {
      const a = (n - 1) * 2, b = (n - 1) * 2 + 1, c = n * 2, d = n * 2 + 1;
      idxTop.push(a, b, c, b, d, c);
      idxBody.push(a, b, c, b, d, c);
    }
    n++;
  }

  const gTop = new THREE.BufferGeometry();
  gTop.setAttribute('position', new THREE.Float32BufferAttribute(topPos, 3));
  gTop.setAttribute('color', new THREE.Float32BufferAttribute(topCol, 3));
  gTop.setIndex(idxTop);
  snowTintMat = new THREE.MeshBasicMaterial({ vertexColors: true });

  const gBody = new THREE.BufferGeometry();
  gBody.setAttribute('position', new THREE.Float32BufferAttribute(bodyPos, 3));
  gBody.setAttribute('color', new THREE.Float32BufferAttribute(bodyCol, 3));
  gBody.setIndex(idxBody);
  const mTop = new THREE.Mesh(gTop, snowTintMat);
  const mBody = new THREE.Mesh(gBody, snowTintMat);

  scene.add(mBody);
  scene.add(mTop);
}
buildSnow();

// ---------- 滑雪者剪影 ----------
const skier = new THREE.Group();
const darkMat = new THREE.MeshBasicMaterial({ color: 0x14141f });
const scarfMat = new THREE.MeshBasicMaterial({ color: 0xd4703f, side: THREE.DoubleSide });

const bodyMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.62, 4, 12), darkMat);
bodyMesh.position.set(0, 1.05, 0);
bodyMesh.rotation.z = 0.22;
skier.add(bodyMesh);

const headMesh = new THREE.Mesh(new THREE.CircleGeometry(0.33, 20), darkMat);
headMesh.position.set(0.14, 1.82, 0);
skier.add(headMesh);

const legMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.5, 3, 8), darkMat);
legMesh.position.set(-0.14, 0.42, 0);
legMesh.rotation.z = -0.16;
skier.add(legMesh);
const legMesh2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.5, 3, 8), darkMat);
legMesh2.position.set(0.22, 0.42, 0);
legMesh2.rotation.z = 0.1;
skier.add(legMesh2);

// 滑雪板（上翘）
const boardShape = new THREE.Shape();
boardShape.moveTo(-0.95, 0);
boardShape.lineTo(-0.72, 0.14);
boardShape.lineTo(0.78, 0.14);
boardShape.lineTo(1.02, 0.26);
boardShape.lineTo(1.08, 0.12);
boardShape.lineTo(0.78, -0.02);
boardShape.lineTo(-0.72, -0.02);
boardShape.closePath();
const board = new THREE.Mesh(new THREE.ShapeGeometry(boardShape), darkMat);
board.position.set(0, 0.12, 0);
skier.add(board);

// 围巾（随速度飘）
const scarfGeo = new THREE.PlaneGeometry(0.9, 0.16, 8, 1);
const scarf = new THREE.Mesh(scarfGeo, scarfMat);
scarf.position.set(-0.42, 1.62, 0);
scarf.rotation.z = -0.2;
skier.add(scarf);
const scarfBase = scarfGeo.attributes.position.array.slice();

skier.position.set(0, terrainY(0), 0);
skier.position.z = 1;
scene.add(skier);

// 雪雾拖尾
const TRAIL_N = 40;
const trailGeo = new THREE.BufferGeometry();
const trailPos = new Float32Array(TRAIL_N * 3);
const trailCol = new Float32Array(TRAIL_N * 3);
for (let i = 0; i < TRAIL_N; i++) {
  const k = 1 - i / TRAIL_N;
  trailCol[i * 3] = 0.90 * k;
  trailCol[i * 3 + 1] = 0.95 * k;
  trailCol[i * 3 + 2] = 1.0 * k;
}
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
const trail = new THREE.Points(trailGeo, new THREE.PointsMaterial({
  size: 0.5, map: GLOW, vertexColors: true, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55,
}));
trail.frustumCulled = false;
trail.position.z = 0.5;
scene.add(trail);

// ---------- 光花（滑过的痕迹） ----------
const FLOWER_MAX = 150;
const flowers = [];
const flowerGroup = new THREE.Group();
flowerGroup.position.z = 0.8;
scene.add(flowerGroup);

const petalGeo = new THREE.SphereGeometry(0.16, 7, 6);
const petalMat = new THREE.MeshBasicMaterial({ color: 0xe2603a });
const coreMat = new THREE.MeshBasicMaterial({ color: 0x5f2a16 });
const stemMat = new THREE.MeshBasicMaterial({ color: 0xa8b6d8, transparent: true, opacity: 0.55 });
const stemGeo = new THREE.CylinderGeometry(0.035, 0.05, 1, 5);

function createFlower() {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.position.y = 0.5;
  g.add(stem);

  const head = new THREE.Group();
  head.position.y = 1;
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 7), coreMat);
  head.add(core);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const p = new THREE.Mesh(petalGeo, petalMat);
    p.position.set(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0);
    p.scale.set(1, 0.72, 0.8);
    head.add(p);
  }
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: GLOW, color: 0xffc985, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.45,
  }));
  halo.scale.setScalar(2.8);
  head.add(halo);
  g.add(head);

  g.userData = { head, halo, grow: 0, sway: Math.random() * Math.PI * 2 };
  g.scale.setScalar(0.001);
  g.userData.targetScale = 2.0;
  flowerGroup.add(g);
  return g;
}
for (let i = 0; i < FLOWER_MAX; i++) {
  const f = createFlower();
  f.visible = false;
  flowers.push(f);
}
let flowerWrite = 0;
let flowerPlanted = 0;

function plantFlower(x) {
  const f = flowers[flowerWrite];
  flowerWrite = (flowerWrite + 1) % FLOWER_MAX;
  f.position.set(x, terrainY(x) - 0.1, 0);
  f.rotation.z = (Math.random() - 0.5) * 0.35;
  f.visible = true;
  f.userData.grow = 0.001;
  f.userData.phase = 0;
  f.scale.setScalar(0.001);
  flowerPlanted++;
}

// ---------- 收集光点 ----------
const ORB_COUNT = 110;
const orbs = [];
const orbGroup = new THREE.Group();
orbGroup.position.z = 0.9;
scene.add(orbGroup);

for (let i = 0; i < ORB_COUNT; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: GLOW, color: 0xfff0c8, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 1,
  }));
  const x = 40 + i * 34 + Math.random() * 12;
  s.position.set(x, terrainY(x) + 3.2 + Math.random() * 2.6, 0);
  s.scale.setScalar(1.5 + Math.random() * 0.5);
  s.userData = { taken: false, baseY: s.position.y, phase: Math.random() * 6.28, baseScale: s.scale.x };
  orbGroup.add(s);
  orbs.push(s);
}

// ---------- 雪粒 ----------
const SNOW_N = 400;
const snowGeo = new THREE.BufferGeometry();
const snowPos = new Float32Array(SNOW_N * 3);
for (let i = 0; i < SNOW_N; i++) {
  snowPos[i * 3] = (Math.random() - 0.5) * 80;
  snowPos[i * 3 + 1] = (Math.random() - 0.5) * 36;
  snowPos[i * 3 + 2] = -1 - Math.random() * 6;
}
snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
const snowMat = new THREE.PointsMaterial({
  size: 0.34, color: 0xffffff, transparent: true, opacity: 0.55,
  map: GLOW, depthWrite: false, blending: THREE.AdditiveBlending,
});
const snowPts = new THREE.Points(snowGeo, snowMat);
snowPts.frustumCulled = false;
scene.add(snowPts);

// ---------- 状态 ----------
const state = {
  x: 0,
  y: terrainY(0),
  speed: 9,
  vy: 0,
  air: false,
  started: false,
  score: 0,
  flowersN: 0,
  distance: 0,
  spin: 0,
  boosting: false,
  lastFlowerX: -999,
  nightT: 0,
};

const camPos = { x: 0, y: terrainY(0) + 5 };

// ---------- 输入 ----------
let holdTimer = 0;
window.addEventListener('pointerdown', () => {
  state.boosting = true;
  holdTimer = 0;
});
window.addEventListener('pointerup', () => {
  if (state.boosting && state.started && !state.air) jump();
  state.boosting = false;
});
window.addEventListener('pointercancel', () => { state.boosting = false; });
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (state.started && !state.air) jump();
  }
});

function jump() {
  if (state.air) return;
  state.air = true;
  state.vy = 11 + state.speed * 0.22;
  state.spin = 0;
}

// ---------- 音效（程序化，极轻） ----------
let audioCtx = null;
let windGain = null;
let padOsc = null;

function startAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || audioCtx) return;
  audioCtx = new AC();

  // 风声：白噪 + 低通 + 随速度变化
  const len = audioCtx.sampleRate * 2;
  const buffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  const bp = audioCtx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 620;
  bp.Q.value = 0.9;
  windGain = audioCtx.createGain();
  windGain.gain.value = 0.0001;
  noise.connect(bp);
  bp.connect(windGain);
  windGain.connect(audioCtx.destination);
  noise.start();
  windGain.gain.exponentialRampToValueAtTime(0.035, audioCtx.currentTime + 3);

  // 缓慢的和声垫
  const padGain = audioCtx.createGain();
  padGain.gain.value = 0.0001;
  padGain.connect(audioCtx.destination);
  padGain.gain.exponentialRampToValueAtTime(0.028, audioCtx.currentTime + 6);
  [110, 164.81, 220, 277.18].forEach((f, i) => {
    const o = audioCtx.createOscillator();
    o.type = i === 0 ? 'sine' : 'triangle';
    o.frequency.value = f;
    const g = audioCtx.createGain();
    g.gain.value = 0.25 / (i + 1);
    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 780;
    o.connect(lp); lp.connect(g); g.connect(padGain);
    o.start();
  });
}
function pickupSound() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  o.type = 'sine';
  const base = 660 + Math.min(state.score, 24) * 26;
  o.frequency.setValueAtTime(base, now);
  o.frequency.exponentialRampToValueAtTime(base * 1.5, now + 0.16);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.05, now + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(now); o.stop(now + 0.4);
}

// ---------- 开场 ----------
const bootEl = document.getElementById('boot');
const introEl = document.getElementById('intro');
const hudEl = document.getElementById('hud');
const hintEl = document.getElementById('hint');
const distEl = document.getElementById('dist');
const scoreEl = document.getElementById('score');

requestAnimationFrame(() => {
  setTimeout(() => {
    if (isTest) bootEl.remove();
    else bootEl.classList.add('gone');
  }, 120);
});

const isTest = new URLSearchParams(location.search).get('auto') === '1';

function begin() {
  if (state.started) return;
  state.started = true;
  if (isTest) {
    introEl.remove();
    bootEl.remove();
  } else {
    introEl.classList.add('gone');
  }
  hudEl.classList.add('show');
  hintEl.classList.add('show');
  startAudio();
  setTimeout(() => hintEl.classList.remove('show'), 8000);
}
document.getElementById('startBtn').addEventListener('click', begin);
introEl.addEventListener('click', begin);
if (isTest) setTimeout(begin, 300);
// 调试：?d=1500 直接从指定距离开始（同步相机与角色，用于查看后期天色）
{
  const d = parseFloat(new URLSearchParams(location.search).get('d') || '0');
  if (d > 0) {
    state.x = d;
    state.y = terrainY(d);
    state.distance = d;
    state.lastFlowerX = d;
    camPos.x = d + 6.5;
    camPos.y = terrainY(d) + 5.2;
    // 预种一排花，供截图检验视觉效果
    for (let fx = d - 90; fx < d - 6; fx += 6) {
      plantFlower(fx);
    }
  }
}

// ---------- 更新 ----------
function updateSkier(dt, t) {
  const slope = terrainSlope(state.x);
  const ang = Math.atan(slope);

  if (!state.air) {
    // 坡度加速（下坡 slope<0 → 加速）
    const accel = -slope * 40;
    state.speed += (accel - 2.6) * dt;
    if (state.boosting) state.speed += 16 * dt;
    state.speed = Math.max(5, Math.min(46, state.speed));

    state.x += Math.cos(ang) * state.speed * dt;
    state.y = terrainY(state.x);

    // 冲到坡顶自动起跳
    if (slope > 0.22 && state.speed > 15) jump();
  } else {
    state.vy -= 36 * dt;
    state.x += Math.cos(ang * 0.4) * state.speed * dt;
    state.y += state.vy * dt;
    state.spin += dt * (state.speed * 0.12);
    const gy = terrainY(state.x);
    if (state.y <= gy) {
      state.y = gy;
      state.air = false;
      state.vy = 0;
      state.spin = 0;
      // 落地雪花
      for (let i = 0; i < 5; i++) spawnPuff(state.x, gy);
    }
  }

  // 限速避免跑出地图
  state.x = Math.min(state.x, SNOW_X1 - 400);

  // 位姿
  skier.position.x = state.x;
  skier.position.y = state.y;
  skier.rotation.z = state.air ? state.spin : -ang * 0.85;

  // 围巾飘动
  const arr = scarfGeo.attributes.position.array;
  for (let i = 0; i < arr.length; i += 3) {
    const idx = i / 3;
    const total = arr.length / 3;
    const v = (idx % 9) / 8;
    const amp = 0.10 + state.speed * 0.006;
    arr[i + 2] = scarfBase[i + 2] + Math.sin(t * 9 - v * 4) * amp * v;
    arr[i + 1] = scarfBase[i + 1] + Math.sin(t * 11 - v * 3) * amp * 0.6 * v;
  }
  scarfGeo.attributes.position.needsUpdate = true;

  // 拖尾
  for (let i = TRAIL_N - 1; i > 0; i--) {
    trailPos[i * 3] = trailPos[(i - 1) * 3];
    trailPos[i * 3 + 1] = trailPos[(i - 1) * 3 + 1];
    trailPos[i * 3 + 2] = trailPos[(i - 1) * 3 + 2];
  }
  trailPos[0] = state.x - 0.6;
  trailPos[1] = state.y + 0.06;
  trailPos[2] = 0;
  trailGeo.attributes.position.needsUpdate = true;

  // 种花（每 7 单位一朵）
  if (!state.air && state.x - state.lastFlowerX > 7) {
    state.lastFlowerX = state.x;
    plantFlower(state.x - 0.4);
    state.flowersN++;
    scoreEl.textContent = String(state.flowersN + state.score);
  }

  state.distance = Math.max(state.distance, state.x);
}

const puffs = [];
function spawnPuff(x, y) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: GLOW, color: 0xffffff, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8,
  }));
  s.position.set(x, y + 0.2, 0.6);
  s.scale.setScalar(1);
  s.userData.life = 0.55;
  scene.add(s);
  puffs.push(s);
}
function updatePuffs(dt) {
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i];
    p.userData.life -= dt;
    p.position.y += dt * 1.2;
    p.position.x -= dt * 2;
    p.material.opacity = Math.max(0, p.userData.life * 1.4);
    p.scale.setScalar(1 + (0.55 - p.userData.life) * 5);
    if (p.userData.life <= 0) {
      scene.remove(p);
      p.material.dispose();
      puffs.splice(i, 1);
    }
  }
}

function updateFlowers(dt, t) {
  for (const f of flowers) {
    if (!f.visible) continue;
    if (f.userData.grow < 1) {
      f.userData.grow = Math.min(1, f.userData.grow + dt * 2.4);
      // 弹性生长
      const g = f.userData.grow;
      const e = 1 - Math.pow(1 - g, 3);
      const over = 1 + Math.sin(g * Math.PI) * 0.18;
      f.scale.setScalar(e * over * (f.userData.targetScale || 1));
    }
    f.userData.head.rotation.z = Math.sin(t * 1.4 + f.userData.sway) * 0.16;
    // 只在镜头附近更新光晕呼吸（省 GPU）
    if (Math.abs(f.position.x - state.x) < 60) {
      f.userData.halo.material.opacity = 0.72 + Math.sin(t * 2.2 + f.userData.sway) * 0.18;
    }
  }
}

function updateOrbs(dt, t) {
  for (const o of orbs) {
    if (o.userData.taken) continue;
    o.position.y = o.userData.baseY + Math.sin(t * 1.8 + o.userData.phase) * 0.35;
    const pulse = 1 + Math.sin(t * 2.6 + o.userData.phase) * 0.1;
    o.scale.setScalar(o.userData.baseScale * pulse);

    if (!state.started) continue;
    const dx = o.position.x - state.x;
    const dy = o.position.y - state.y;
    if (dx * dx + dy * dy < 4.2) {
      o.userData.taken = true;
      o.visible = false;
      state.score++;
      scoreEl.textContent = String(state.flowersN + state.score);
      pickupSound();
      for (let i = 0; i < 4; i++) spawnPuff(o.position.x, o.position.y);
    }
  }
}

function updateSnow(dt) {
  const arr = snowGeo.attributes.position.array;
  const camX = camPos.x;
  const camY = camPos.y;
  for (let i = 0; i < SNOW_N; i++) {
    arr[i * 3] -= (state.started ? state.speed * 0.32 + 3.5 : 1.2) * dt;
    if (arr[i * 3] < camX - 48) {
      arr[i * 3] = camX + 48;
      arr[i * 3 + 1] = camY + (Math.random() - 0.5) * 34;
    }
  }
  snowGeo.attributes.position.needsUpdate = true;
}

function updateCamera(dt) {
  const tx = state.x + 6.5;
  const ty = state.y + 5.2;
  const k = 1 - Math.pow(0.002, dt);
  camPos.x += (tx - camPos.x) * k;
  camPos.y += (ty - camPos.y) * k;
  camera.position.x = camPos.x;
  camera.position.y = camPos.y;

  // 天空铺满视野并跟随
  sky.scale.set(vs.w * 1.5, vs.h * 1.5, 1);
  sky.position.x = camPos.x;
  sky.position.y = camPos.y;

  // 视差（x 横向 + y 轻微跟随，让山脊贴着地平线）
  ridges.forEach((r) => {
    r.position.x = camPos.x * (1 - r.userData.parallax);
    r.position.y = camPos.y * (1 - r.userData.parallax) * 0.75;
  });

  // 星随相机
  stars.position.x = camPos.x * 0.14;
}

// 天色：黄昏 → 夜 → 极光
const PHASES = [
  { t: 0.0, top: 0x3d3560, mid: 0x7a5270, bot: 0xe8a07a },
  { t: 0.42, top: 0x1c2450, mid: 0x3d3566, bot: 0x9b6a86 },
  { t: 0.72, top: 0x0e1633, mid: 0x1a2a4e, bot: 0x3c4e78 },
  { t: 1.0, top: 0x0a2238, mid: 0x0e4452, bot: 0x2e6a63 },
];
const cA = new THREE.Color(), cB = new THREE.Color();
const cC = new THREE.Color(), cD = new THREE.Color();

function updateSky() {
  const p = Math.min(1, state.distance / 2600);
  let i = 0;
  while (i < PHASES.length - 2 && p > PHASES[i + 1].t) i++;
  const a = PHASES[i], b = PHASES[i + 1] || PHASES[i];
  const span = Math.max(0.0001, b.t - a.t);
  const f = Math.min(1, Math.max(0, (p - a.t) / span));
  skyUniforms.uTop.value.copy(cA.setHex(a.top)).lerp(cB.setHex(b.top), f);
  skyUniforms.uMid.value.copy(cA.setHex(a.mid)).lerp(cB.setHex(b.mid), f);
  skyUniforms.uBot.value.copy(cA.setHex(a.bot)).lerp(cB.setHex(b.bot), f);

  const night = Math.min(1, Math.max(0, (p - 0.25) / 0.45));
  const aurora = Math.min(1, Math.max(0, (p - 0.74) / 0.26));
  skyUniforms.uNight.value = night;
  skyUniforms.uAurora.value = aurora;
  skyUniforms.uTime.value = elapsed;
  starMat.opacity = night * 0.9;

  // 山随天色变化：黄昏 → 夜 → 极光
  for (const r of ridges) {
    const cols = r.userData.cols;
    cC.copy(cA.setHex(cols[0])).lerp(cB.setHex(cols[1]), night);
    if (aurora > 0) cC.lerp(cD.setHex(cols[2]), aurora);
    r.material.color.copy(cC);
  }

  // 雪色调：黄昏暖白 → 夜冷蓝 → 极光青白
  cC.copy(cA.setHex(0xffffff)).lerp(cB.setHex(0xaec2e8), night);
  if (aurora > 0) cC.lerp(cD.setHex(0xaadfd4), aurora);
  if (snowTintMat) snowTintMat.color.copy(cC);
}

// ---------- 主循环 ----------
const clock = new THREE.Clock();
let elapsed = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  if (state.started) {
    updateSkier(dt, elapsed);
    updateOrbs(dt, elapsed);
    state.nightT += dt;
    if (audioCtx && windGain) {
      const target = 0.012 + Math.min(0.05, state.speed * 0.0016);
      windGain.gain.value += (target - windGain.gain.value) * Math.min(1, dt * 2);
    }
    distEl.textContent = String(Math.floor(state.distance / 3));
  } else {
    skier.position.y = terrainY(0) + Math.sin(elapsed * 1.2) * 0.06;
  }

  updateFlowers(dt, elapsed);
  updatePuffs(dt);
  updateSnow(dt);
  updateCamera(dt);
  updateSky();

  renderer.render(scene, camera);
}
animate();

// ---------- 自适应 ----------
window.addEventListener('resize', () => {
  vs = viewSize();
  camera.left = -vs.w / 2;
  camera.right = vs.w / 2;
  camera.top = vs.h / 2;
  camera.bottom = -vs.h / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
