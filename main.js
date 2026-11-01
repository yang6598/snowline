import * as THREE from 'three';

/* =========================================================
   雪线 · Snowline
   第三人称极简剪影滑雪
   —— 黄昏下滑，滑过之处开出光的花
   ========================================================= */

// ===================== 基础 =====================
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const FOG_NEAR = 210, FOG_FAR = 950;
scene.fog = new THREE.Fog(0x8a6a7a, FOG_NEAR, FOG_FAR);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.4, 4000);
camera.position.set(-11, 6, 0);

// ===================== 世界参数 =====================
const LANE_HALF = 15;       // 雪道半宽
const X_START = -700;
const X_END = 6400;
const DIST_FULL = 2600;     // 天色走到极光所需距离

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
// 雪道横向微翘（U 形槽）
function bank(z) {
  const t = Math.min(1, Math.abs(z) / LANE_HALF);
  return t * t * 1.05;
}
// 峡谷壁高度场
function canyonY(x, z) {
  const az = Math.abs(z);
  if (az <= LANE_HALF) return terrainY(x) + bank(z);
  const d = az - LANE_HALF;
  const t = Math.min(1, d / 26);
  const peak = 6.2 + Math.sin(x * 0.021 + 1.3) * 2.6 + Math.sin(x * 0.0087) * 2.0;
  return terrainY(x) + bank(LANE_HALF) + Math.pow(t, 0.85) * peak + Math.sin(x * 0.06 + az) * 0.5 * t;
}

// ===================== 程序化贴图 =====================
function glowTexture() {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,248,228,0.72)');
  g.addColorStop(0.6, 'rgba(255,216,155,0.16)');
  g.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const GLOW = glowTexture();

// ===================== 天空穹顶 =====================
const skyUniforms = {
  uTop: { value: new THREE.Color(0x3d3560) },
  uMid: { value: new THREE.Color(0x7a5270) },
  uBot: { value: new THREE.Color(0xe8a07a) },
  uNight: { value: 0 },
  uAurora: { value: 0 },
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.52, 0.085, 0.85).normalize() },
  uMoonDir: { value: new THREE.Vector3(0.48, 0.56, 0.68).normalize() },
};

const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(1500, 40, 28),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 uTop, uMid, uBot;
      uniform vec3 uSunDir, uMoonDir;
      uniform float uNight, uAurora, uTime;

      float band(vec3 d) {
        float t = uTime * 0.11;
        float a = sin(d.z * 4.6 + t * 1.7) * 0.5 + sin(d.z * 1.9 - t * 1.1) * 0.5;
        float b = sin(d.x * 7.2 + t * 2.3) * 0.42 + sin(d.x * 3.1 + t * 1.5) * 0.58;
        return a * 0.62 + b * 0.38;
      }

      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;

        vec3 col = mix(uBot, uMid, smoothstep(-0.06, 0.44, h));
        col = mix(col, uTop, smoothstep(0.30, 0.88, h));

        // 地平线暖光
        float hor = exp(-pow((h - 0.02) * 6.0, 2.0));
        col += vec3(1.0, 0.58, 0.34) * hor * 0.10 * (1.0 - uNight);

        // 低空云带
        float cl = exp(-pow((h - 0.085) * 13.0, 2.0));
        float cw = 0.45 + 0.55 * sin(d.z * 2.6 + uTime * 0.06) * sin(d.x * 1.4 - uTime * 0.04);
        vec3 cloudCol = mix(vec3(0.95, 0.80, 0.78), vec3(0.28, 0.33, 0.52), uNight);
        col = mix(col, cloudCol, cl * 0.30 * (0.4 + 0.6 * cw));

        // 太阳
        float sd = max(0.0, dot(d, uSunDir));
        float disk = smoothstep(0.9992, 0.99965, sd);
        float halo = pow(sd, 42.0) * 1.1 + pow(sd, 8.0) * 0.34 + pow(sd, 2.2) * 0.10;
        vec3 sunCol = mix(vec3(1.0, 0.88, 0.66), vec3(1.0, 0.52, 0.30), 0.45);
        float sunI = 1.0 - smoothstep(0.05, 0.5, uNight);
        col += sunCol * halo * sunI;
        col += vec3(1.0, 0.96, 0.86) * disk * 2.4 * sunI;

        // 月亮
        float md = max(0.0, dot(d, uMoonDir));
        float mdisk = smoothstep(0.99955, 0.99985, md);
        col += vec3(0.94, 0.96, 1.0) * mdisk * 2.6 * uNight;
        col += vec3(0.55, 0.68, 1.0) * pow(md, 90.0) * 0.9 * uNight;
        col += vec3(0.32, 0.44, 0.85) * pow(md, 10.0) * 0.10 * uNight;

        // 极光帷幕
        if (uAurora > 0.001) {
          float yBand = smoothstep(0.04, 0.26, h) * (1.0 - smoothstep(0.40, 0.82, h));
          float b = band(d);
          float curtain = pow(0.5 + 0.5 * b, 1.6);
          float rays = 0.55 + 0.45 * sin(d.z * 34.0 + uTime * 1.1 + b * 3.0);
          vec3 ac = mix(vec3(0.16, 0.92, 0.62), vec3(0.42, 0.52, 1.0), 0.5 + 0.5 * b);
          col += ac * yBand * curtain * rays * uAurora * 0.95;
          // 极光在地平线的反光
          float low = exp(-pow((h + 0.02) * 9.0, 2.0));
          col += vec3(0.20, 0.75, 0.60) * low * uAurora * 0.31 * (0.5 + 0.5 * b);
        }

        gl_FragColor = vec4(col, 1.0);
      }`,
  })
);
skyDome.renderOrder = -10;
skyDome.frustumCulled = false;
scene.add(skyDome);

// ===================== 星 =====================
const STAR_N = 420;
const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(STAR_N * 3);
const starCol = new Float32Array(STAR_N * 3);
for (let i = 0; i < STAR_N; i++) {
  // 上半球随机
  const u = Math.random() * Math.PI * 2;
  const v = Math.random() * 0.85 + 0.06;
  const r = 1300;
  const y = v;
  const rr = Math.sqrt(Math.max(0, 1 - y * y));
  starPos[i * 3] = Math.cos(u) * rr * r;
  starPos[i * 3 + 1] = y * r;
  starPos[i * 3 + 2] = Math.sin(u) * rr * r;
  const b = 0.4 + Math.random() * 0.6;
  starCol[i * 3] = b;
  starCol[i * 3 + 1] = b;
  starCol[i * 3 + 2] = b * 1.08;
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
const starMat = new THREE.PointsMaterial({
  size: 5.5, vertexColors: true, transparent: true, opacity: 0,
  depthWrite: false, sizeAttenuation: true, fog: false, map: GLOW,
  blending: THREE.AdditiveBlending,
});
const stars = new THREE.Points(starGeo, starMat);
stars.frustumCulled = false;
stars.renderOrder = -9;
scene.add(stars);

// ===================== 远山（正前方多层剪影墙） =====================
function makeRidgeLayer(opts) {
  const { dist, width, step, freqs, cols, alpha } = opts;
  const pts = [];
  for (let z = -width / 2; z <= width / 2 + 0.01; z += step) {
    let h = 0;
    for (const [f, a, p] of freqs) h += Math.sin(z * f + p) * a;
    h = Math.abs(h);
    pts.push([z, h]);
  }
  const verts = [], idx = [];
  pts.forEach(([z, h], i) => {
    verts.push(0, h, z);
    verts.push(0, -900, z);
    if (i > 0) {
      const a = (i - 1) * 2, b = (i - 1) * 2 + 1, c = i * 2, d = i * 2 + 1;
      idx.push(a, b, c, b, d, c);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ color: cols[0], depthWrite: false, fog: false, side: THREE.DoubleSide });
  if (alpha < 1) { mat.transparent = true; mat.opacity = alpha; }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.z = 0;
  mesh.userData = { dist, cols, base: -30 };
  mesh.frustumCulled = false;
  mesh.renderOrder = -8;
  return mesh;
}

const ridgeLayers = [];
ridgeLayers.push(makeRidgeLayer({
  dist: 2050, width: 7200, step: 30,
  freqs: [[0.0021, 130, 0.4], [0.0052, 62, 2.0], [0.0117, 22, 1.1]],
  cols: [0xb08f9e, 0x2c3358, 0x2a5560], alpha: 1,
}));
ridgeLayers.push(makeRidgeLayer({
  dist: 1420, width: 5200, step: 24,
  freqs: [[0.0027, 96, 1.2], [0.0066, 46, 0.4], [0.0148, 16, 2.4]],
  cols: [0x8f7285, 0x222a4c, 0x1f4550], alpha: 1,
}));
ridgeLayers.push(makeRidgeLayer({
  dist: 950, width: 3800, step: 18,
  freqs: [[0.0036, 66, 2.6], [0.0088, 30, 1.3], [0.0192, 11, 0.7]],
  cols: [0x6e5876, 0x1a2240, 0x173a44], alpha: 1,
}));
ridgeLayers.forEach((r) => scene.add(r));

// ===================== 雪道 =====================
let snowTintMat = null;

function buildTrack() {
  const dx = 4;
  const zSeg = 14;
  const dz = (LANE_HALF * 2) / zSeg;
  const pos = [], col = [], idx = [];

  const cCenter = new THREE.Color(0xe9f1fd);
  const cEdge = new THREE.Color(0xffffff);
  const cGroove = new THREE.Color(0xccdcf2);
  const tmp = new THREE.Color();

  let row = 0;
  for (let x = X_START; x <= X_END; x += dx, row++) {
    // 雪面明暗褶皱
    const fold = 0.5 + 0.5 * Math.sin(x * 0.052 + Math.sin(x * 0.013) * 2.0);
    for (let j = 0; j <= zSeg; j++) {
      const z = -LANE_HALF + j * dz;
      const e = Math.abs(z) / LANE_HALF;
      const y = terrainY(x) + bank(z);
      pos.push(x, y, z);

      // 中间被压过的雪道略灰，两侧新雪更白
      tmp.copy(cGroove).lerp(cCenter, 0.5 + 0.5 * e);
      if (e > 0.86) tmp.lerp(cEdge, (e - 0.86) / 0.14 * 0.9);
      const k = 0.90 + fold * 0.10;
      col.push(tmp.r * k, tmp.g * k, tmp.b * k);
    }
    if (row > 0) {
      const base = (row - 1) * (zSeg + 1);
      const cur = row * (zSeg + 1);
      for (let j = 0; j < zSeg; j++) {
        const a = base + j, b = base + j + 1, c = cur + j, d = cur + j + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  snowTintMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, snowTintMat);
  scene.add(mesh);
}
buildTrack();

// ===================== 峡谷两壁 =====================
function buildCanyonWall(sign) {
  const dx = 8;
  const zs = [0, 5, 12, 22, 40];
  const pos = [], col = [], idx = [];
  const cSnow = new THREE.Color(0xf2f7ff);
  const cMid = new THREE.Color(0x9aa9c9);
  const cDeep = new THREE.Color(0x2a2f52);
  const tmp = new THREE.Color();

  let row = 0;
  for (let x = X_START; x <= X_END; x += dx, row++) {
    for (let j = 0; j < zs.length; j++) {
      const z = sign * (LANE_HALF + zs[j]);
      const y = canyonY(x, z);
      pos.push(x, y, z);
      const t = j / (zs.length - 1);
      tmp.copy(cSnow).lerp(cMid, Math.min(1, t * 1.8));
      if (t > 0.5) tmp.lerp(cDeep, (t - 0.5) / 0.5);
      col.push(tmp.r, tmp.g, tmp.b);
    }
    if (row > 0) {
      const base = (row - 1) * zs.length;
      const cur = row * zs.length;
      for (let j = 0; j < zs.length - 1; j++) {
        const a = base + j, b = base + j + 1, c = cur + j, d = cur + j + 1;
        if (sign > 0) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }));
  scene.add(mesh);
}
buildCanyonWall(1);
buildCanyonWall(-1);

// ===================== 路边剪影树 =====================
(function buildTrees() {
  const count = 420;
  const trunkGeo = new THREE.CylinderGeometry(0.11, 0.16, 1, 5);
  trunkGeo.translate(0, 0.5, 0);
  const crownGeo = new THREE.ConeGeometry(1, 1, 7);
  crownGeo.translate(0, 0.5, 0);

  const mat = new THREE.MeshBasicMaterial({ color: 0x151a2e });
  const trunks = new THREE.InstancedMesh(trunkGeo, mat, count);
  const crowns = new THREE.InstancedMesh(crownGeo, mat, count);

  const dummy = new THREE.Object3D();
  let n = 0;
  for (let i = 0; i < count; i++) {
    const x = X_START + Math.random() * (X_END - X_START);
    const sign = Math.random() < 0.5 ? 1 : -1;
    const off = 4 + Math.random() * 15;
    const z = sign * (LANE_HALF + off);
    const y = canyonY(x, z);
    const h = 3.4 + Math.random() * 3.6;

    dummy.position.set(x, y - 0.3, z);
    dummy.rotation.set(0, Math.random() * 6.28, 0);
    dummy.scale.set(1, h * 0.42, 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(n, dummy.matrix);

    dummy.position.set(x, y - 0.3 + h * 0.30, z);
    dummy.scale.set(h * 0.30, h * 0.82, h * 0.30);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    crowns.setMatrixAt(n, dummy.matrix);
    n++;
  }
  trunks.count = n;
  crowns.count = n;
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  scene.add(trunks, crowns);
})();

// ===================== 滑雪者（第三人称背影） =====================
const skier = new THREE.Group();

const darkMat = new THREE.MeshBasicMaterial({ color: 0x101018 });
const dark2Mat = new THREE.MeshBasicMaterial({ color: 0x1b1b28 });
const scarfMat = new THREE.MeshBasicMaterial({ color: 0xe4713c, side: THREE.DoubleSide });
const bagMat = new THREE.MeshBasicMaterial({ color: 0xb8542c });

// 板
const boardShape = new THREE.Shape();
boardShape.moveTo(-1.15, -0.10);
boardShape.lineTo(-0.95, 0.02);
boardShape.lineTo(0.92, 0.02);
boardShape.lineTo(1.20, 0.16);
boardShape.lineTo(1.26, 0.02);
boardShape.lineTo(0.92, -0.12);
boardShape.lineTo(-0.95, -0.12);
boardShape.closePath();
const boardGeo = new THREE.ExtrudeGeometry(boardShape, { depth: 0.5, bevelEnabled: false });
boardGeo.translate(0, 0, -0.25);
const board = new THREE.Mesh(boardGeo, darkMat);
board.position.set(0, 0.16, 0);
skier.add(board);

// 腿
const legGeo = new THREE.CapsuleGeometry(0.15, 0.52, 3, 8);
const legL = new THREE.Mesh(legGeo, darkMat);
legL.position.set(0.02, 0.55, -0.15);
legL.rotation.z = -0.10;
skier.add(legL);
const legR = new THREE.Mesh(legGeo, darkMat);
legR.position.set(0.02, 0.55, 0.15);
legR.rotation.z = -0.10;
skier.add(legR);

// 身体
const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, 0.60, 4, 12), darkMat);
body.position.set(-0.06, 1.24, 0);
body.rotation.z = -0.28;
skier.add(body);

// 背包
const bag = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.52), bagMat);
bag.position.set(-0.36, 1.30, 0);
bag.rotation.z = -0.28;
skier.add(bag);

// 手臂
const armGeo = new THREE.CapsuleGeometry(0.09, 0.46, 3, 8);
const armL = new THREE.Mesh(armGeo, dark2Mat);
armL.position.set(0.16, 1.24, -0.40);
armL.rotation.set(0.2, 0, -0.9);
skier.add(armL);
const armR = new THREE.Mesh(armGeo, dark2Mat);
armR.position.set(0.16, 1.24, 0.40);
armR.rotation.set(-0.2, 0, -0.9);
skier.add(armR);

// 头
const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 14), darkMat);
head.position.set(0.06, 1.92, 0);
head.scale.set(1, 0.96, 0.94);
skier.add(head);
// 帽子/发
const hair = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), dark2Mat);
hair.position.set(0.04, 1.96, 0);
skier.add(hair);

// 围巾（向后上方飘，水平带）
const scarfGeo = new THREE.PlaneGeometry(1.15, 0.20, 12, 2);
scarfGeo.rotateX(-Math.PI / 2);
const scarf = new THREE.Mesh(scarfGeo, scarfMat);
scarf.position.set(-0.62, 2.02, 0);
scarf.rotation.z = 0.09;
skier.add(scarf);
const scarfBase = scarfGeo.attributes.position.array.slice();

// 角色柔光（让他从暗背景中浮起来）
const skierGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: GLOW, color: 0xffd7a8, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.26, fog: false,
}));
skierGlow.scale.setScalar(2.3);
skierGlow.position.set(-0.1, 1.1, 0);
skier.add(skierGlow);

// 脚下投影
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x33456b, transparent: true, opacity: 0.20, depthWrite: false });
const shadowMesh = new THREE.Mesh(new THREE.CircleGeometry(0.95, 24), shadowMat);
shadowMesh.rotation.x = -Math.PI / 2;
scene.add(shadowMesh);

skier.scale.setScalar(1.12);
skier.position.set(0, terrainY(0), 0);
scene.add(skier);

// ===================== 雪雾拖尾 =====================
const TRAIL_N = 46;
const trailGeo = new THREE.BufferGeometry();
const trailPos = new Float32Array(TRAIL_N * 3);
const trailCol = new Float32Array(TRAIL_N * 3);
for (let i = 0; i < TRAIL_N; i++) {
  const k = Math.pow(1 - i / TRAIL_N, 1.4);
  trailCol[i * 3] = 0.95 * k;
  trailCol[i * 3 + 1] = 0.97 * k;
  trailCol[i * 3 + 2] = 1.0 * k;
}
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
const trail = new THREE.Points(trailGeo, new THREE.PointsMaterial({
  size: 0.5, map: GLOW, vertexColors: true, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.45, fog: false,
}));
trail.frustumCulled = false;
scene.add(trail);

// ===================== 光花 =====================
const FLOWER_MAX = 170;
const flowers = [];
const flowerGroup = new THREE.Group();
scene.add(flowerGroup);

const petalGeo = new THREE.SphereGeometry(0.20, 8, 7);
const petalMat = new THREE.MeshBasicMaterial({ color: 0xe2603a });
const coreMat = new THREE.MeshBasicMaterial({ color: 0x6a2c14 });
const stemMat = new THREE.MeshBasicMaterial({ color: 0xc3cfeb, transparent: true, opacity: 0.6 });
const stemGeo = new THREE.CylinderGeometry(0.04, 0.06, 1, 5);

function createFlower() {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.position.y = 0.5;
  g.add(stem);

  const hd = new THREE.Group();
  hd.position.y = 1;
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 7), coreMat);
  hd.add(core);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const p = new THREE.Mesh(petalGeo, petalMat);
    p.position.set(Math.cos(a) * 0.24, Math.sin(a) * 0.24, 0);
    p.scale.set(1, 0.74, 0.8);
    p.rotation.z = a;
    hd.add(p);
  }
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: GLOW, color: 0xffc985, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5, fog: false,
  }));
  halo.scale.setScalar(3.2);
  hd.add(halo);
  g.add(hd);

  g.userData = { head: hd, halo, grow: 0, sway: Math.random() * Math.PI * 2, targetScale: 1.9 };
  g.scale.setScalar(0.001);
  g.visible = false;
  flowerGroup.add(g);
  return g;
}
for (let i = 0; i < FLOWER_MAX; i++) flowers.push(createFlower());
let flowerWrite = 0;

function plantFlower(x, z) {
  const f = flowers[flowerWrite];
  flowerWrite = (flowerWrite + 1) % FLOWER_MAX;
  f.position.set(x, terrainY(x) + bank(z) - 0.05, z);
  f.rotation.y = Math.random() * 6.28;
  f.visible = true;
  f.userData.grow = 0.001;
  f.scale.setScalar(0.001);
}

// ===================== 收集光点 =====================
const ORB_GAP = 35;
const ORB_COUNT = Math.floor((X_END - X_START - 120) / ORB_GAP);
const orbs = [];
const orbGroup = new THREE.Group();
scene.add(orbGroup);

for (let i = 0; i < ORB_COUNT; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: GLOW, color: 0xfff2d2, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 1, fog: false,
  }));
  const x = 60 + i * ORB_GAP + Math.random() * 10;
  const z = (Math.random() - 0.5) * (LANE_HALF * 1.55);
  s.position.set(x, terrainY(x) + bank(z) + 2.0 + Math.random() * 1.9, z);
  const sc = 1.7 + Math.random() * 0.5;
  s.scale.setScalar(sc);
  s.userData = { taken: false, baseY: s.position.y, phase: Math.random() * 6.28, baseScale: sc };
  orbGroup.add(s);
  orbs.push(s);
}
document.getElementById('orbs').parentElement.querySelector('em').textContent = '/ ' + ORB_COUNT;

// ===================== 飘雪 =====================
const SNOW_N = 520;
const snowGeo = new THREE.BufferGeometry();
const snowPos = new Float32Array(SNOW_N * 3);
for (let i = 0; i < SNOW_N; i++) {
  snowPos[i * 3] = -30 + Math.random() * 90;
  snowPos[i * 3 + 1] = -8 + Math.random() * 34;
  snowPos[i * 3 + 2] = (Math.random() - 0.5) * 64;
}
snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
const snowMat = new THREE.PointsMaterial({
  size: 0.30, color: 0xffffff, transparent: true, opacity: 0.6,
  map: GLOW, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
});
const snowPts = new THREE.Points(snowGeo, snowMat);
snowPts.frustumCulled = false;
scene.add(snowPts);

// ===================== 状态 =====================
const state = {
  x: 0,
  z: 0,
  y: terrainY(0),
  vz: 0,
  speed: 10,
  vy: 0,
  air: false,
  started: false,
  score: 0,
  flowersN: 0,
  distance: 0,
  spin: 0,
  boosting: false,
  boost: 1,
  steer: 0,
  lastFlowerX: -999,
};

const camPos = new THREE.Vector3(-11, terrainY(0) + 6, 0);
const camLook = new THREE.Vector3(14, terrainY(0) + 2, 0);

// ===================== 输入 =====================
const keys = { left: false, right: false, boost: false };
window.addEventListener('keydown', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = true;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = true;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.boost = true;
  if (e.code === 'Space') {
    e.preventDefault();
    if (state.started) jump();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.boost = false;
});

let touchX = null;
window.addEventListener('pointerdown', (e) => {
  if (!state.started) return;
  if (e.pointerType === 'touch') { touchX = e.clientX; return; }
  jump();
});
window.addEventListener('pointermove', (e) => {
  if (touchX !== null) {
    const dx = e.clientX - touchX;
    if (Math.abs(dx) > 6) {
      keys.left = dx < 0;
      keys.right = dx > 0;
    }
  }
});
window.addEventListener('pointerup', () => { touchX = null; keys.left = false; keys.right = false; });
window.addEventListener('pointercancel', () => { touchX = null; keys.left = false; keys.right = false; });

function jump() {
  if (state.air) return;
  state.air = true;
  state.vy = 11 + state.speed * 0.20;
  state.spin = 0;
  sfxJump();
}

// ===================== 音频引擎 =====================
const audio = {
  ctx: null,
  master: null,
  musicBus: null,
  windGain: null,
  delay: null,
  ready: false,
};

function initAudio() {
  if (audio.ready) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  audio.ctx = ctx;

  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  audio.master = master;

  // 混响（用程序化脉冲响应的简化版：多抽头延时）
  const musicBus = ctx.createGain();
  musicBus.gain.value = 0.0001;
  musicBus.connect(master);
  audio.musicBus = musicBus;
  musicBus.gain.exponentialRampToValueAtTime(0.30, ctx.currentTime + 4);

  // 立体延时
  const delay = ctx.createDelay(1.0);
  delay.delayTime.value = 0.34;
  const fb = ctx.createGain();
  fb.gain.value = 0.34;
  const wet = ctx.createGain();
  wet.gain.value = 0.30;
  delay.connect(fb);
  fb.connect(delay);
  delay.connect(wet);
  wet.connect(master);
  audio.delay = delay;

  // 风
  const len = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 700;
  bp.Q.value = 0.7;
  const windGain = ctx.createGain();
  windGain.gain.value = 0.0001;
  noise.connect(bp);
  bp.connect(windGain);
  windGain.connect(master);
  noise.start();
  windGain.gain.exponentialRampToValueAtTime(0.03, ctx.currentTime + 3);
  audio.windGain = windGain;

  audio.ready = true;
  startMusic();
}

/* ---------- 治愈系 lo-fi 音轨 ---------- */
const BPM = 92;
const BEAT = 60 / BPM;
const STEP = BEAT / 4;        // 十六分音符
const BAR = 16;               // 每小节 16 步
// Am7 – Fmaj7 – Cmaj7 – G(add9)
const CHORDS = [
  { root: 55.00, notes: [220.00, 261.63, 329.63, 392.00] },
  { root: 43.65, notes: [174.61, 220.00, 261.63, 329.63] },
  { root: 65.41, notes: [261.63, 329.63, 392.00, 493.88] },
  { root: 49.00, notes: [196.00, 246.94, 293.66, 392.00] },
];
const ARP_ORDER = [0, 2, 1, 3, 2, 1, 3, 2];

let musicTimer = null;
let nextStepTime = 0;
let stepIdx = 0;
let arpPtr = 0;
let melodyPtr = 0;

function startMusic() {
  const ctx = audio.ctx;
  nextStepTime = ctx.currentTime + 0.15;
  stepIdx = 0;
  musicTimer = setInterval(scheduleAhead, 25);
  scheduleAhead();
}

function scheduleAhead() {
  const ctx = audio.ctx;
  if (!ctx) return;
  while (nextStepTime < ctx.currentTime + 0.22) {
    playStep(stepIdx, nextStepTime);
    nextStepTime += STEP;
    stepIdx = (stepIdx + 1) % (BAR * 4);
  }
}

function playStep(s, t) {
  const bar = Math.floor(s / BAR);
  const pos = s % BAR;
  const chord = CHORDS[bar];
  const ctx = audio.ctx;

  // 和弦垫：每小节起点
  if (pos === 0) {
    playPad(chord, t, BEAT * 4 * 0.98);
    playBass(chord.root, t, BEAT * 1.6);
  }

  // 贝斯：第 3 拍再补一下
  if (pos === 8) playBass(chord.root * 1.5, t, BEAT * 0.9);

  // 轻鼓
  if (pos === 0 || pos === 7 || pos === 10) playKick(t, pos === 0 ? 0.55 : 0.34);
  if (pos % 2 === 0) playHat(t, pos % 4 === 0 ? 0.10 : 0.06);

  // 琶音：八分音符
  if (pos % 2 === 0) {
    const n = chord.notes[ARP_ORDER[arpPtr % ARP_ORDER.length]] * 2;
    arpPtr++;
    playArp(n, t, 0.055);
  }

  // 高处风铃：每两小节一次，制造治愈留白
  if (bar % 2 === 1 && pos === 12) {
    const n = chord.notes[3] * 4;
    playBell(n, t);
  }
  // 小旋律动机：第 2、4 小节
  if (bar === 1 || bar === 3) {
    const mel = [chord.notes[1] * 2, chord.notes[2] * 2, chord.notes[3] * 2, chord.notes[2] * 2];
    if (pos === 4 || pos === 6 || pos === 9 || pos === 13) {
      playLead(mel[melodyPtr % 4], t);
      melodyPtr++;
    }
  }
}

function playPad(chord, t, dur) {
  const ctx = audio.ctx;
  const bus = ctx.createGain();
  bus.gain.value = 0.0001;
  bus.connect(audio.musicBus);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(620, t);
  lp.frequency.linearRampToValueAtTime(1100, t + dur * 0.6);
  lp.frequency.linearRampToValueAtTime(700, t + dur);
  lp.Q.value = 0.6;
  lp.connect(bus);

  chord.notes.forEach((f, i) => {
    for (let d = 0; d < 2; d++) {
      const o = ctx.createOscillator();
      o.type = d === 0 ? 'triangle' : 'sine';
      o.frequency.value = f * (d === 0 ? 1 : 2.002);
      const g = ctx.createGain();
      g.gain.value = (d === 0 ? 0.22 : 0.07) / (1 + i * 0.35);
      o.connect(g);
      g.connect(lp);
      o.start(t);
      o.stop(t + dur + 1.6);
    }
  });

  bus.gain.setValueAtTime(0.0001, t);
  bus.gain.exponentialRampToValueAtTime(0.10, t + 0.75);
  bus.gain.exponentialRampToValueAtTime(0.070, t + dur * 0.8);
  bus.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.4);
}

function playBass(f, t, dur) {
  const ctx = audio.ctx;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(audio.musicBus);
  o.start(t);
  o.stop(t + dur + 0.1);
}

function playArp(f, t, vol) {
  const ctx = audio.ctx;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.value = f;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol * 2.2, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (p) { p.pan.value = (Math.random() - 0.5) * 0.6; o.connect(g); g.connect(p); p.connect(audio.musicBus); p.connect(audio.delay); }
  else { o.connect(g); g.connect(audio.musicBus); g.connect(audio.delay); }
  o.start(t);
  o.stop(t + 0.4);
}

function playLead(f, t) {
  const ctx = audio.ctx;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f, t);
  const o2 = ctx.createOscillator();
  o2.type = 'sine';
  o2.frequency.setValueAtTime(f * 2.001, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.045, t + 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
  const g2 = ctx.createGain();
  g2.gain.value = 0.25;
  o.connect(g); g.connect(audio.musicBus); g.connect(audio.delay);
  o2.connect(g2); g2.connect(g);
  o.start(t); o.stop(t + 0.85);
  o2.start(t); o2.stop(t + 0.85);
}

function playBell(f, t) {
  const ctx = audio.ctx;
  [1, 2.76, 5.4].forEach((mul, i) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * mul;
    const g = ctx.createGain();
    const v = 0.05 / (i + 1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6 / (i + 1));
    o.connect(g);
    g.connect(audio.musicBus);
    g.connect(audio.delay);
    o.start(t);
    o.stop(t + 1.8);
  });
}

function playKick(t, vol) {
  const ctx = audio.ctx;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(118, t);
  o.frequency.exponentialRampToValueAtTime(44, t + 0.10);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
  o.connect(g);
  g.connect(audio.musicBus);
  o.start(t);
  o.stop(t + 0.34);
}

let hatBuffer = null;
function playHat(t, vol) {
  const ctx = audio.ctx;
  if (!hatBuffer) {
    const len = Math.floor(ctx.sampleRate * 0.08);
    hatBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = hatBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  const s = ctx.createBufferSource();
  s.buffer = hatBuffer;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 6800;
  const g = ctx.createGain();
  g.gain.value = vol;
  s.connect(hp);
  hp.connect(g);
  g.connect(audio.musicBus);
  s.start(t);
}

// ---------- 音效 ----------
function sfxJump() {
  if (!audio.ready) return;
  const ctx = audio.ctx;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(420, t);
  o.frequency.exponentialRampToValueAtTime(760, t + 0.16);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
  o.connect(g); g.connect(audio.master);
  o.start(t); o.stop(t + 0.3);
}

function sfxPickup() {
  if (!audio.ready) return;
  const ctx = audio.ctx;
  const t = ctx.currentTime;
  const base = 740 * Math.pow(2, (state.score % 8) / 12);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(base, t);
  o.frequency.exponentialRampToValueAtTime(base * 1.5, t + 0.13);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.055, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
  o.connect(g); g.connect(audio.master);
  o.start(t); o.stop(t + 0.34);
}

function sfxLand() {
  if (!audio.ready) return;
  const ctx = audio.ctx;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(60, t + 0.18);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
  o.connect(g); g.connect(audio.master);
  o.start(t); o.stop(t + 0.3);
}

// ===================== UI 引用 =====================
const bootEl = document.getElementById('boot');
const introEl = document.getElementById('intro');
const uiEl = document.getElementById('ui');
const keysHintEl = document.getElementById('keysHint');
const distEl = document.getElementById('dist');
const speedEl = document.getElementById('speedVal');
const speedFillEl = document.getElementById('speedFill');
const orbsEl = document.getElementById('orbs');
const scoreEl = document.getElementById('score');
const phaseFillEl = document.getElementById('phaseFill');
const boostFillEl = document.getElementById('boostFill');
const boostWrapEl = document.getElementById('boostWrap');

const isTest = new URLSearchParams(location.search).get('auto') === '1';

requestAnimationFrame(() => {
  setTimeout(() => {
    if (isTest) { bootEl.remove(); }
    else bootEl.classList.add('gone');
  }, 120);
});

function begin() {
  if (state.started) return;
  state.started = true;
  if (isTest) {
    introEl.remove();
    bootEl.remove();
  } else {
    introEl.classList.add('gone');
  }
  uiEl.classList.add('show');
  initAudio();
  setTimeout(() => keysHintEl.classList.add('fade'), 11000);
}
introEl.addEventListener('click', begin);
if (isTest) setTimeout(begin, 300);

// 调试：?d=1500 直接跳到指定距离
{
  const d = parseFloat(new URLSearchParams(location.search).get('d') || '0');
  if (d > 0) {
    state.x = d;
    state.y = terrainY(d);
    state.distance = d;
    state.lastFlowerX = d;
    camPos.set(d - 11, terrainY(d) + 6, 0);
    camLook.set(d + 14, terrainY(d) + 2, 0);
    for (let fx = d - 110; fx < d - 8; fx += 7) plantFlower(fx, Math.sin(fx * 0.3) * 5);
  }
}

// ===================== 更新：角色 =====================
function updateSkier(dt, t) {
  const slope = terrainSlope(state.x);
  const ang = Math.atan(slope);

  // 转向
  const steerIn = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  state.steer += (steerIn - state.steer) * Math.min(1, dt * 9);
  const targetVz = state.steer * (state.air ? 9 : 15);
  state.vz += (targetVz - state.vz) * Math.min(1, dt * 7);
  state.z += state.vz * dt;
  const ZLIM = LANE_HALF - 1.6;
  if (state.z > ZLIM) { state.z = ZLIM; state.vz *= 0.3; }
  if (state.z < -ZLIM) { state.z = -ZLIM; state.vz *= 0.3; }

  // 冲刺
  const wantBoost = (keys.boost || state.boosting) && state.boost > 0.02 && !state.air;
  if (wantBoost) state.boost = Math.max(0, state.boost - dt * 0.30);
  else state.boost = Math.min(1, state.boost + dt * 0.13);

  if (!state.air) {
    const accel = -slope * 40;
    state.speed += (accel - 2.6) * dt;
    if (wantBoost) state.speed += 17 * dt;
    state.speed = Math.max(6, Math.min(48, state.speed));

    state.x += Math.cos(ang) * state.speed * dt;
    state.y = terrainY(state.x) + bank(state.z);

    if (slope > 0.22 && state.speed > 15) jump();
  } else {
    state.vy -= 36 * dt;
    state.x += Math.cos(ang * 0.4) * state.speed * dt;
    state.y += state.vy * dt;
    state.spin += dt * (state.speed * 0.10);
    const gy = terrainY(state.x) + bank(state.z);
    if (state.y <= gy) {
      state.y = gy;
      state.air = false;
      state.vy = 0;
      state.spin = 0;
      sfxLand();
      for (let i = 0; i < 7; i++) spawnPuff(state.x, gy, state.z);
    }
  }

  state.x = Math.min(state.x, X_END - 400);

  // 位姿
  skier.position.set(state.x, state.y, state.z);
  const leanZ = state.air ? state.spin : -ang * 0.9;
  skier.rotation.z = leanZ;
  skier.rotation.x = -state.steer * 0.30;
  skier.rotation.y = -state.steer * 0.16;

  // 投影
  {
    const gy = terrainY(state.x) + bank(state.z) + 0.03;
    shadowMesh.position.set(state.x, gy, state.z);
    const hAbove = Math.max(0, state.y - gy);
    const sc = Math.max(0.35, 1 - hAbove * 0.09);
    shadowMesh.scale.setScalar(sc);
    shadowMat.opacity = Math.max(0.04, 0.22 - hAbove * 0.028);
  }

  // 围巾飘动
  const arr = scarfGeo.attributes.position.array;
  const total = 13;
  for (let i = 0; i < arr.length; i += 3) {
    const col = i / 3;
    const u = (col % total) / (total - 1);   // 0 靠脖子 → 1 尾部
    const amp = (0.05 + state.speed * 0.010) * u * u;
    arr[i + 1] = scarfBase[i + 1] + Math.sin(t * 13 - u * 7) * amp;
    arr[i] = scarfBase[i] + Math.cos(t * 9 - u * 5) * amp * 0.6;
  }
  scarfGeo.attributes.position.needsUpdate = true;

  // 拖尾
  for (let i = TRAIL_N - 1; i > 0; i--) {
    trailPos[i * 3] = trailPos[(i - 1) * 3];
    trailPos[i * 3 + 1] = trailPos[(i - 1) * 3 + 1];
    trailPos[i * 3 + 2] = trailPos[(i - 1) * 3 + 2];
  }
  trailPos[0] = state.x - 1.0;
  trailPos[1] = state.y + 0.10;
  trailPos[2] = state.z;
  trailGeo.attributes.position.needsUpdate = true;

  // 种花（避开角色正后方，左右散开）
  if (!state.air && state.x - state.lastFlowerX > 7) {
    state.lastFlowerX = state.x;
    const side = Math.random() < 0.5 ? -1 : 1;
    plantFlower(state.x - 0.5, state.z + side * (1.4 + Math.random() * 2.2));
    state.flowersN++;
  }

  state.distance = Math.max(state.distance, state.x);
}

// ===================== 更新：粒子 =====================
const puffs = [];
function spawnPuff(x, y, z) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: GLOW, color: 0xffffff, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85, fog: false,
  }));
  s.position.set(x + (Math.random() - 0.5) * 1.2, y + 0.2, z + (Math.random() - 0.5) * 1.2);
  s.scale.setScalar(1);
  s.userData.life = 0.55;
  scene.add(s);
  puffs.push(s);
}
function updatePuffs(dt) {
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i];
    p.userData.life -= dt;
    p.position.y += dt * 1.4;
    p.position.x -= dt * 2.4;
    p.material.opacity = Math.max(0, p.userData.life * 1.5);
    p.scale.setScalar(1 + (0.55 - p.userData.life) * 5.5);
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
      f.userData.grow = Math.min(1, f.userData.grow + dt * 2.6);
      const g = f.userData.grow;
      const e = 1 - Math.pow(1 - g, 3);
      const over = 1 + Math.sin(g * Math.PI) * 0.20;
      f.scale.setScalar(e * over * f.userData.targetScale);
    }
    f.userData.head.rotation.z = Math.sin(t * 1.4 + f.userData.sway) * 0.14;
    if (Math.abs(f.position.x - state.x) < 70) {
      f.userData.halo.material.opacity = 0.62 + Math.sin(t * 2.2 + f.userData.sway) * 0.22;
    }
  }
}

function updateOrbs(dt, t) {
  for (const o of orbs) {
    if (o.userData.taken) continue;
    o.position.y = o.userData.baseY + Math.sin(t * 1.8 + o.userData.phase) * 0.38;
    const pulse = 1 + Math.sin(t * 2.6 + o.userData.phase) * 0.11;
    o.scale.setScalar(o.userData.baseScale * pulse);

    if (!state.started) continue;
    const dx = o.position.x - state.x;
    const dy = o.position.y - (state.y + 1.2);
    const dz = o.position.z - state.z;
    if (dx * dx + dy * dy + dz * dz < 7.5) {
      o.userData.taken = true;
      o.visible = false;
      state.score++;
      sfxPickup();
      for (let i = 0; i < 5; i++) spawnPuff(o.position.x, o.position.y, o.position.z);
    }
  }
}

function updateSnow(dt) {
  const arr = snowGeo.attributes.position.array;
  const cx = camPos.x, cy = camPos.y, cz = camPos.z;
  const flow = state.started ? state.speed * 0.42 + 4 : 2;
  for (let i = 0; i < SNOW_N; i++) {
    arr[i * 3] -= flow * dt;
    arr[i * 3 + 1] -= dt * (1.2 + (i % 7) * 0.2);
    if (arr[i * 3] < cx - 34 || arr[i * 3 + 1] < cy - 14) {
      arr[i * 3] = cx + 20 + Math.random() * 65;
      arr[i * 3 + 1] = cy - 8 + Math.random() * 30;
      arr[i * 3 + 2] = cz + (Math.random() - 0.5) * 66;
    }
    if (Math.abs(arr[i * 3 + 2] - cz) > 34) arr[i * 3 + 2] = cz + (Math.random() - 0.5) * 66;
  }
  snowGeo.attributes.position.needsUpdate = true;
}

// ===================== 更新：相机（第三人称越肩） =====================
function updateCamera(dt) {
  const spd = state.started ? state.speed : 8;
  const back = 9.2 + spd * 0.070 + (state.air ? 0.8 : 0);
  const up = 4.9 + spd * 0.030;

  const tx = state.x - back;
  const ty = state.y + up;
  const tz = state.z * 0.62;

  const k = 1 - Math.pow(0.0015, dt);
  camPos.x += (tx - camPos.x) * k;
  camPos.y += (ty - camPos.y) * k;
  camPos.z += (tz - camPos.z) * k;

  // 视线目标：角色前方，稍微高一点看路
  const lx = state.x + 14 + spd * 0.20;
  const ly = state.y + 0.8;
  const lz = state.z * 0.85;
  const lk = 1 - Math.pow(0.004, dt);
  camLook.x += (lx - camLook.x) * lk;
  camLook.y += (ly - camLook.y) * lk;
  camLook.z += (lz - camLook.z) * lk;

  camera.position.copy(camPos);
  camera.lookAt(camLook);

  // 速度带来的视野扩张
  const targetFov = 60 + Math.min(14, spd * 0.26);
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 1.6);
  camera.updateProjectionMatrix();

  // 天空/星跟随
  skyDome.position.copy(camPos);
  stars.position.copy(camPos);

  // 远山跟随（保持永远在正前方）
  for (const r of ridgeLayers) {
    r.position.x = camPos.x + r.userData.dist;
    r.position.y = camPos.y * 0.72 - 34;
  }
}

// ===================== 天色 =====================
const PHASES = [
  { t: 0.00, top: 0x3b3768, mid: 0x8a5c72, bot: 0xf0a877 },
  { t: 0.42, top: 0x232a5c, mid: 0x4a3a6a, bot: 0xa06a80 },
  { t: 0.72, top: 0x0e1533, mid: 0x1b2b52, bot: 0x40547e },
  { t: 1.00, top: 0x081f33, mid: 0x0d4450, bot: 0x2f6d66 },
];
const cA = new THREE.Color();
const cB = new THREE.Color();
const cC = new THREE.Color();
const cD = new THREE.Color();

function updateSky(t) {
  const p = Math.min(1, state.distance / DIST_FULL);
  let i = 0;
  while (i < PHASES.length - 2 && p > PHASES[i + 1].t) i++;
  const a = PHASES[i], b = PHASES[i + 1] || PHASES[i];
  const span = Math.max(0.0001, b.t - a.t);
  const f = Math.min(1, Math.max(0, (p - a.t) / span));

  skyUniforms.uTop.value.copy(cA.setHex(a.top)).lerp(cB.setHex(b.top), f);
  skyUniforms.uMid.value.copy(cA.setHex(a.mid)).lerp(cB.setHex(b.mid), f);
  skyUniforms.uBot.value.copy(cA.setHex(a.bot)).lerp(cB.setHex(b.bot), f);

  const night = Math.min(1, Math.max(0, (p - 0.22) / 0.46));
  const aurora = Math.min(1, Math.max(0, (p - 0.72) / 0.28));
  skyUniforms.uNight.value = night;
  skyUniforms.uAurora.value = aurora;
  skyUniforms.uTime.value = t;
  starMat.opacity = Math.pow(night, 0.8) * 0.95;

  // 雾色跟天空下缘同步
  scene.fog.color.copy(cC.copy(skyUniforms.uBot.value).lerp(skyUniforms.uMid.value, 0.35));

  // 远山
  for (const r of ridgeLayers) {
    const cols = r.userData.cols;
    cC.copy(cA.setHex(cols[0])).lerp(cB.setHex(cols[1]), night);
    if (aurora > 0) cC.lerp(cD.setHex(cols[2]), aurora * 0.85);
    r.material.color.copy(cC);
  }

  // 雪
  cC.copy(cA.setHex(0xffffff)).lerp(cB.setHex(0xb2c6ec), night);
  if (aurora > 0) cC.lerp(cD.setHex(0xaddfd6), aurora * 0.75);
  if (snowTintMat) snowTintMat.color.copy(cC);

  // 星与雪粒在夜里更亮
  snowMat.opacity = 0.42 + night * 0.28;
}

// ===================== UI =====================
let uiAcc = 0;
function updateUI(dt) {
  uiAcc += dt;
  if (uiAcc < 0.07) return;
  uiAcc = 0;

  distEl.textContent = String(Math.max(0, Math.floor(state.distance)));
  const kmh = Math.round(state.speed * 3.6);
  speedEl.textContent = String(kmh);
  speedFillEl.style.height = Math.min(100, (state.speed / 48) * 100) + '%';
  orbsEl.textContent = String(state.score);
  scoreEl.textContent = String(state.flowersN);
  phaseFillEl.style.width = (Math.min(1, state.distance / DIST_FULL) * 100) + '%';
  boostFillEl.style.width = (state.boost * 100) + '%';
  boostWrapEl.classList.toggle('low', state.boost < 0.25);
}

// ===================== 主循环 =====================
const clock = new THREE.Clock();
let elapsed = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  if (state.started) {
    updateSkier(dt, elapsed);
    updateOrbs(dt, elapsed);
    if (audio.ready && audio.windGain) {
      const target = 0.010 + Math.min(0.055, state.speed * 0.0016);
      audio.windGain.gain.value += (target - audio.windGain.gain.value) * Math.min(1, dt * 2);
    }
  } else {
    skier.position.y = terrainY(0) + Math.sin(elapsed * 1.1) * 0.05;
    skier.rotation.z = Math.sin(elapsed * 0.7) * 0.02;
  }

  updateFlowers(dt, elapsed);
  updatePuffs(dt);
  updateSnow(dt);
  updateCamera(dt);
  updateSky(elapsed);
  updateUI(dt);

  renderer.render(scene, camera);
}
animate();

// ===================== 自适应 =====================
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
